"""
BVetter Analytics — core pipeline unit tests
=============================================
Fast, deterministic tests for the pure/stateless parts of arima_service.py
(no Flask app, no DB, no Excel file needed — importing the module doesn't
touch either). Run with:

    pytest api/analytics/test_forecast_core.py

Deliberately scoped to this one file rather than the whole api/analytics/
directory: test_eval.py is a figure-generation script (it trains real
models against the Excel dataset), not a fast/deterministic unit-test
module, so it's run separately.

The risk-classification tests below (_disease_risk_thresholds /
_disease_risk_label) cover the DISEASE-SPECIFIC pipeline, which has always
been a rule-based threshold, never a trained classifier.

The ALL-DISEASE pipeline is different: risk labeling there started as a
RandomForestClassifier, was broken by a later version that deliberately
trained it WITHOUT case-count features (to avoid it "trivially" reading the
threshold off lag_1) -- that version misclassified Tiaong, the barangay with
the highest case count in the whole dataset, as "Low/stable" risk, because
volume was exactly the one signal hidden from it. Rather than fix the actual
cause, it was replaced with a rule-based threshold identical in spirit to
the disease-specific one below. As of v3.2 it's a RandomForestClassifier
again, with case-count features restored (see arima_service.py's
get_all_disease_models() for the full history). Testing that classifier
meaningfully needs real training data, which this file deliberately avoids
importing -- its regression guard (verifying the highest-volume barangay is
never classified Low) lives in test_eval.py instead, where real models are
already loaded.
"""

import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(__file__))

from arima_service import (
    rmse,
    mape,
    forecast_confidence,
    adf_test_report,
    _forecast_is_runaway,
    _disease_risk_thresholds,
    _disease_risk_label,
)


# ─────────────────────────────────────────────────────────────────────────
# rmse / mape
# ─────────────────────────────────────────────────────────────────────────

def test_rmse_of_perfect_forecast_is_zero():
    assert rmse([1, 2, 3], [1, 2, 3]) == 0.0


def test_rmse_penalizes_error():
    assert rmse([0], [3]) == 3.0


def test_mape_reports_percentage_error():
    assert mape([100], [110]) == 10.0


def test_mape_ignores_zero_actuals_instead_of_dividing_by_zero():
    # All actuals are 0 -> nothing left after masking -> None, not a crash.
    assert mape([0, 0], [5, 3]) is None


# ─────────────────────────────────────────────────────────────────────────
# forecast_confidence
# ─────────────────────────────────────────────────────────────────────────

def test_confidence_is_high_for_a_narrow_interval_and_low_error():
    conf = forecast_confidence(predicted=10, lower=9, upper=11, mape_val=5)
    assert conf > 80


def test_confidence_is_low_for_an_interval_wider_than_the_estimate():
    # CI spans from near-zero to 3x the estimate -- the model doesn't know
    # the answer within a useful margin.
    conf = forecast_confidence(predicted=10, lower=0, upper=30, mape_val=80)
    assert conf < 40


def test_confidence_is_bounded_between_zero_and_hundred():
    conf = forecast_confidence(predicted=1, lower=0, upper=1000, mape_val=500)
    assert 0.0 <= conf <= 100.0


# ─────────────────────────────────────────────────────────────────────────
# adf_test_report — stationarity check ARIMA's order-selection relies on
# ─────────────────────────────────────────────────────────────────────────

def test_adf_flags_a_strong_linear_trend_as_non_stationary():
    # A noiseless ramp is a degenerate case for ADF (zero-variance
    # residuals) -- real case-count series always carry noise, so a
    # trend-plus-noise series is the realistic thing to check here.
    rng = np.random.default_rng(7)
    trending = pd.Series(np.arange(1, 61, dtype=float) + rng.normal(0, 0.3, size=60))
    report = adf_test_report(trending)
    assert report["is_stationary"] is False
    assert report["recommended_d"] == 1


def test_adf_flags_stable_noise_as_stationary():
    rng = np.random.default_rng(42)
    noise = pd.Series(10 + rng.normal(0, 0.5, size=200))  # flat around 10
    report = adf_test_report(noise)
    assert report["is_stationary"] is True
    assert report["recommended_d"] == 0


# ─────────────────────────────────────────────────────────────────────────
# _forecast_is_runaway — guards against implausible forecast spikes
# ─────────────────────────────────────────────────────────────────────────

def test_runaway_guard_catches_unrealistic_compounded_annual_forecast():
    # Two years of history; worst rolling-12-month total is 34 (matches the
    # real production example documented in arima_service.py). No single
    # historical month exceeds 4.
    year1 = [2, 3, 2, 4, 3, 2, 3, 4, 2, 3, 4, 2]  # sums to 34
    year2 = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2]  # sums to 18
    history = pd.Series(year1 + year2, dtype=float)

    # Each individual month (~20) stays under the per-month cap, but the
    # summed year (240) blows past what the annual history could support --
    # exactly the "looked fine month-by-month, unrealistic as a sum" case.
    forecast = [20] * 12
    assert _forecast_is_runaway(history, forecast) is True


def test_runaway_guard_allows_a_plausible_forecast():
    year1 = [2, 3, 2, 4, 3, 2, 3, 4, 2, 3, 4, 2]
    year2 = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2]
    history = pd.Series(year1 + year2, dtype=float)

    forecast = [3] * 12  # in line with historical pattern
    assert _forecast_is_runaway(history, forecast) is False


# ─────────────────────────────────────────────────────────────────────────
# Regression: risk classification must not repeat the Tiaong bug
# ─────────────────────────────────────────────────────────────────────────

def test_highest_volume_barangay_is_classified_high_risk():
    # 11 ordinary barangays plus one (index -1) that -- like the real
    # Tiaong case -- has by far the highest case count.
    peer_case_counts = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    high_volume_barangay_cases = 25

    thresholds = _disease_risk_thresholds(peer_case_counts + [high_volume_barangay_cases])

    assert _disease_risk_label(high_volume_barangay_cases, thresholds) == "High"


def test_lowest_volume_barangay_is_classified_low_risk():
    case_values = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 25]
    thresholds = _disease_risk_thresholds(case_values)

    assert _disease_risk_label(5, thresholds) == "Low"


def test_mid_volume_barangay_is_classified_medium_risk():
    case_values = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 25]
    thresholds = _disease_risk_thresholds(case_values)

    assert _disease_risk_label(12, thresholds) == "Medium"


def test_risk_thresholds_with_no_data_default_to_safe_low():
    thresholds = _disease_risk_thresholds([])
    assert _disease_risk_label(0, thresholds) == "Low"

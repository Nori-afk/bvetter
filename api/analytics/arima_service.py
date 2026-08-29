"""
BVetter Analytics Backend — v3.3 (leaked features removed from the classifier)
=======================================================================
Changes from v3.2:
  MODEL-3  : The four disease-mix ratio features are removed from
             FEATURE_COLS. They were current-month category counts over
             total_cases, and risk_class is a band on total_cases, so the
             classifier could reconstruct the label from its own inputs --
             it scored a perfect 100.0% held-out, and those four features
             alone scored 99.4% against a 67.7% baseline. Held-out accuracy
             is now 97.2%, and the High threshold lands on the band
             definition instead of firing early. See FEATURE_COLS.
Changes from v3.1 (retained):
  MODEL-1  : All-disease risk classification is a RandomForestClassifier again
             (it started as one, was replaced with a rule-based threshold after
             a real bug -- see get_all_disease_models() for the full history).
             This version includes past-only case-count features in training,
             which the buggy version deliberately excluded; that's what caused
             the bug, not the idea of a classifier itself.
  MODEL-2  : RandomForestRegressor removed entirely, from both the all-disease
             and disease-specific pipelines. It never actually produced a live
             forecast (RF-for-monthly was built, benchmarked poorly, and
             disabled in v3 already) -- it only powered a standalone case-count
             accuracy metric. ARIMA/SARIMA -- which already produced every real
             forecast -- now reports its own pooled accuracy in that metric's
             place.
Changes from v3 (retained):
  SPEED-1  : CACHE_TTL 300 → 600 s
  SPEED-2  : _sarima_order_search grid reduced 81 → 16 combos
  SPEED-3  : _ma_fallback bootstrap resamples 1000 → 200
  SPEED-4  : RF model warm-started at server boot (not on first request)
  SCALE-1  : For "year" period, predicted_cases = sum of 12 monthly ARIMA
              forecasts, matching the actual annual bar chart total.
              For "month" period, predicted_cases = next-month value (unchanged).
  SCALE-2  : Same annual-sum logic applied to disease-specific pipeline.
  DISPLAY  : arima_forecast in response capped at 3 values (insight panel only).
Everything else is identical to v3.
"""

import os
import warnings
import time
import numpy as np
import pandas as pd
import pymysql
import pymysql.cursors

from flask import Flask, request, jsonify
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.statespace.sarimax import SARIMAX
from statsmodels.tsa.stattools import adfuller

from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, accuracy_score, precision_recall_fscore_support, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from imblearn.over_sampling import SMOTE

warnings.filterwarnings("ignore")
app = Flask(__name__)


def _load_dotenv(path):
    """Minimal .env loader (mirrors config/env.php) so this service and the
    PHP layer read DB credentials from the same single source of truth."""
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if key and key not in os.environ:
                os.environ[key] = value.strip()


_load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env"))

EXCEL_PATH = os.path.join(os.path.dirname(__file__), "../../database/BaliwagVet_2023-2025.xlsx")

# Same DB this app's PHP layer connects to (api/config/connection.php) — kept
# overridable via env vars for deployments where the DB isn't local XAMPP.
DB_CONFIG = {
    "host":     os.environ.get("VBETTER_DB_HOST", "localhost"),
    "port":     int(os.environ.get("VBETTER_DB_PORT", "3306")),
    "user":     os.environ.get("VBETTER_DB_USER", "root"),
    "password": os.environ.get("VBETTER_DB_PASS", "root"),
    "database": os.environ.get("VBETTER_DB_NAME", "bvetter"),
    "charset":  "utf8mb4",
}


def db_connect():
    return pymysql.connect(cursorclass=pymysql.cursors.DictCursor, **DB_CONFIG)

_cache    = {}
# SPEED-7: raised 600s -> 6h. This was originally justified by "the source Excel
# only changes on a service restart", which stopped being true when the clinic
# gained the ability to upload a dataset. The TTL is still right, but it is no
# longer what keeps the data fresh: ensure_dataset_version_fresh() drops these
# entries the moment a new dataset version becomes active, so the long TTL now
# only spares repeated work WITHIN one version. There's no correctness reason to
# re-run an expensive ~15-20s
# disease-specific SARIMA search every 10 minutes. This makes every disease
# filter pay its cost once per server run instead of once per 10-minute window,
# matching how _all_disease_models/arima_cache already never expire.
CACHE_TTL = 21600

# Months of fitted history returned alongside a vaccination forecast, so the
# dashboard can plot the model's own input instead of a separately-queried
# series that may not match it.
FORECAST_HISTORY_MONTHS = 6


def cache_get(key):
    entry = _cache.get(key)
    return entry["data"] if entry and entry["expires"] > time.time() else None


def cache_set(key, data):
    _cache[key] = {"data": data, "expires": time.time() + CACHE_TTL}


# ════════════════════════════════════════════════════════════════════════
# UPLOADED DATASET VERSIONS
# ════════════════════════════════════════════════════════════════════════
#
# The clinic uploads its consultation workbook through api/dataset/dataset.php,
# which stores it in `historical_consultations` under a `dataset_versions` row
# and marks exactly one version active. This service reads that active version
# instead of the bundled Excel once one exists.
#
# FRESHNESS IS PULL-BASED, ON PURPOSE. PHP does fire an invalidation call after
# an upload, but that call is best-effort: if it fails, _all_disease_models and
# _consult_diagnosis_df would never expire on their own, and the upload would
# report success while every chart kept serving the old dataset until somebody
# restarted the service by hand. So the active version id is re-read here and
# compared against the one the caches were built from. One tiny indexed query
# per use buys immunity from that entire failure mode.

_active_dataset_version = None   # version id the current caches were built from


def load_active_dataset_version() -> int:
    """Active dataset_versions.id, or None when nothing has been uploaded yet."""
    try:
        conn = db_connect()
    except Exception:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM dataset_versions WHERE is_active = 1 LIMIT 1")
            row = cur.fetchone()
        return int(row["id"]) if row else None
    except Exception:
        # Table absent (upload feature not migrated yet) is a normal state:
        # it simply means "no uploads, use the Excel fallback".
        return None
    finally:
        conn.close()


def load_active_consult_rows() -> pd.DataFrame:
    """
    The active version's consultations, shaped like read_excel_sheet(
    "Consult_Diagnosis_3Y") returns them, so _load_consult_diagnosis_raw() can
    swap sources without its callers noticing. Returns None (not an empty frame)
    when there is no active version, so "nothing uploaded" stays distinguishable
    from "uploaded and genuinely empty".
    """
    version_id = load_active_dataset_version()
    if version_id is None:
        return None
    try:
        conn = db_connect()
    except Exception as e:
        print(f"[dataset] connect failed, falling back to Excel: {e}")
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT consultation_id, consultation_date, year, month_no, month,
                       barangay_id, barangay, animal_group, diagnosis, disease_category,
                       symptom_cluster, cases_reported, frequency_code, frequency_description,
                       season_pattern, risk_level, basis, system_use
                FROM historical_consultations
                WHERE dataset_version_id = %s
                ORDER BY year, month_no, consultation_id
            """, (version_id,))
            rows = cur.fetchall()
    except Exception as e:
        print(f"[dataset] query failed, falling back to Excel: {e}")
        return None
    finally:
        conn.close()

    if not rows:
        return None
    df = pd.DataFrame(rows)
    df.columns = [str(c).strip().lower() for c in df.columns]
    return df


def invalidate_disease_caches() -> dict:
    """
    Drops everything derived from the consultation dataset. Deliberately does
    NOT touch the vacc_* keys or _barangay_vacc_cache: a dataset upload says
    nothing about vaccination events, and those forecasts are expensive.
    """
    global _all_disease_models, _consult_diagnosis_df, _diagnosis_model, _disease_forecast_model

    stale = [k for k in list(_cache.keys()) if k.startswith("ds_") or k.startswith("hybrid_")]
    for key in stale:
        _cache.pop(key, None)

    had_models = bool(_all_disease_models)
    _all_disease_models = {}
    _consult_diagnosis_df = None
    # The diagnosis model trains on the same consultations, so a new dataset
    # version invalidates it too. Missing this would leave the symptom model
    # answering from the previous upload indefinitely -- it has no TTL either.
    _diagnosis_model = {}
    _disease_forecast_model = {}

    return {"forecast_keys_cleared": len(stale), "models_dropped": had_models}


def ensure_dataset_version_fresh():
    """
    Rebuild trigger. Call before anything that reads consultation data: if the
    active version id has moved since the caches were built, they are dropped so
    the next read repopulates them from the new version.
    """
    global _active_dataset_version
    current = load_active_dataset_version()
    if current != _active_dataset_version:
        if _active_dataset_version is not None or current is not None:
            result = invalidate_disease_caches()
            print(f"[dataset] active version {_active_dataset_version} -> {current}; "
                  f"cleared {result['forecast_keys_cleared']} cached forecast(s)")
        _active_dataset_version = current


# ════════════════════════════════════════════════════════════════════════
# SHARED UTILITIES
# ════════════════════════════════════════════════════════════════════════

def read_excel_sheet(sheet_name: str) -> pd.DataFrame:
    df_raw = pd.read_excel(EXCEL_PATH, sheet_name=sheet_name, header=None)
    header_row = None
    for i, row in df_raw.iterrows():
        if "year" in [str(v).strip().lower() for v in row.values if pd.notna(v)]:
            header_row = i
            break
    if header_row is None:
        raise ValueError(f"No header row with 'year' found in sheet: {sheet_name}")
    df = pd.read_excel(EXCEL_PATH, sheet_name=sheet_name, header=header_row)
    df.columns = [str(c).strip().lower() for c in df.columns]
    return df


def rmse(actual, predicted):
    return round(float(np.sqrt(np.mean((np.array(actual) - np.array(predicted)) ** 2))), 2)


def mape(actual, predicted):
    actual, predicted = np.array(actual, float), np.array(predicted, float)
    mask = actual != 0
    if not mask.any():
        return None
    return round(float(np.mean(np.abs((actual[mask] - predicted[mask]) / actual[mask])) * 100), 1)


def forecast_confidence(predicted: float, lower: float, upper: float, mape_val: float = None) -> float:
    """
    "Confidence" used to mean "how far past the risk threshold is the
    predicted number" -- a distance-from-cutoff measure that reported ~100%
    even for forecasts with 100%+ historical error and a prediction range
    wider than the estimate itself. This instead reflects actual forecast
    reliability, from two real signals:
      - How wide the prediction interval is relative to the point estimate.
        A range spanning from near-zero to several times the estimate means
        the model doesn't actually know the answer within a useful margin.
      - Historical accuracy (MAPE) from a real holdout test, when available.
    Both are capped so one very sparse series can't swing to a nonsensical
    value; a missing MAPE is treated as unknown (not assumed good).
    """
    predicted = max(float(predicted), 0.0)
    ci_width  = max(float(upper) - float(lower), 0.0)
    ci_ratio  = ci_width / max(predicted, 1.0)
    ci_uncertainty = min(1.0, ci_ratio / 2.0)  # a range >=2x the estimate = maximally uncertain

    if mape_val is not None:
        mape_uncertainty = min(1.0, float(mape_val) / 100.0)
        uncertainty = (ci_uncertainty + mape_uncertainty) / 2
    else:
        uncertainty = ci_uncertainty

    return round((1 - uncertainty) * 100, 1)


# ════════════════════════════════════════════════════════════════════════
# ARIMA HELPERS
# ════════════════════════════════════════════════════════════════════════

def adf_test_report(series: pd.Series) -> dict:
    """Augmented Dickey-Fuller stationarity test on a time series.

    Used both to pick ARIMA's differencing order (d) and, in the model
    evaluation report, to show whether the series was stationary before
    fitting -- a standard ARIMA validation/assumption check.
    """
    try:
        stat, pvalue, _, _, crit, _ = adfuller(series.dropna())
        stationary = pvalue < 0.05
        return {
            "statistic":       round(float(stat), 4),
            "p_value":         round(float(pvalue), 4),
            "critical_values": {k: round(float(v), 4) for k, v in crit.items()},
            "is_stationary":   bool(stationary),
            "recommended_d":   0 if stationary else 1,
        }
    except Exception as e:
        return {
            "statistic": None, "p_value": None, "critical_values": {},
            "is_stationary": None, "recommended_d": 1, "error": str(e),
        }


def _adf_d(series: pd.Series) -> int:
    return adf_test_report(series)["recommended_d"]


def _select_arima_order(series: pd.Series) -> tuple:
    d = _adf_d(series)
    best_aic, best_order = np.inf, (1, d, 1)
    for p, q in [(1, 1), (1, 0), (0, 1), (0, 0), (2, 1)]:
        try:
            r = ARIMA(series, order=(p, d, q)).fit(method_kwargs={"maxiter": 50})
            if r.aic < best_aic:
                best_aic, best_order = r.aic, (p, d, q)
        except Exception:
            pass
    return best_order


def _forecast_is_runaway(series: pd.Series, forecast: list, upper_ci: list = None) -> bool:
    """
    True if `forecast` blows past what the series' own history could
    plausibly support -- a sign that SARIMA/ARIMA order selection landed on
    a numerically unstable fit rather than a real trend. AIC picks the best
    in-sample fit, not the most stable one, so this can't be caught at
    order-selection time; it has to be checked after the fact, against two
    different scales:
      - any single forecasted month far beyond the worst month ever seen
        (catches an outright explosive per-step blowup)
      - the SUMMED forecast -- the number actually shown to users for a
        "year" view -- far beyond the worst rolling 12-month total ever
        seen. This is the one that matters most in practice: seen in
        production, a barangay whose worst year on record was 34 cases
        forecast to 237 the next year, while no single month in that
        12-month forecast looked obviously broken on its own (each was a
        moderate, plausible-looking value -- only the compounded sum was
        unrealistic).
    """
    hist_vals = series.dropna().values.astype(float)
    if len(hist_vals) == 0 or not forecast:
        return False

    hist_month_max = float(hist_vals.max())

    # If the series has undergone a level shift -- the recent tail sits far
    # below the earlier history (e.g. a data-source changeover, not a
    # seasonal dip) -- cap against that recent regime instead of the stale
    # historical peak. Otherwise a peak that's genuinely part of this same
    # series lets ARIMA "revert" a forecast toward a level that has no
    # bearing on what's actually happening now, and this guard -- built to
    # catch exactly that kind of unsupported jump -- waves it through
    # because the jump technically stayed under the old peak.
    tail_n = min(3, len(hist_vals))
    recent_tail_max = float(hist_vals[-tail_n:].max()) if tail_n else hist_month_max
    if len(hist_vals) >= 6 and hist_month_max > 0 and recent_tail_max <= hist_month_max * 0.3:
        hist_month_max = recent_tail_max

    month_cap = max(hist_month_max * 8, 15.0)
    if max(forecast) > month_cap:
        return True
    if upper_ci and max(upper_ci) > month_cap * 1.5:
        return True

    rolling_annual  = series.fillna(0).rolling(12, min_periods=1).sum()
    hist_annual_max = float(rolling_annual.max()) if not rolling_annual.empty else 0.0
    # Floor of 8 (not the month check's 15) because this is the check that
    # matters most for near-zero-history diseases: a barangay with a rock
    # steady 1 case/year for 3 straight years forecast to 26+ next year is
    # exactly the failure this guard exists for, and a floor of 15 let a
    # 26-vs-2 case (13x its own rolling-annual history) through untouched.
    annual_cap = max(hist_annual_max, 8.0) * 3 * (len(forecast) / 12.0)
    return sum(forecast) > annual_cap


def _fallback_forecast(series: pd.Series, steps: int) -> dict:
    vals = [float(v) for v in series.dropna().tail(3).values] or [0.0]
    last  = vals[-1]
    slope = (vals[-1] - vals[0]) / max(1, len(vals) - 1) if len(vals) >= 2 else 0
    fc    = [max(0.0, round(last + slope * (i + 1), 1)) for i in range(steps)]
    trend = "rising" if slope > 0.5 else ("falling" if slope < -0.5 else "stable")
    return {
        "forecast": fc,
        "lower_ci": [max(0.0, round(v * 0.8, 1)) for v in fc],
        "upper_ci": [round(v * 1.2, 1) for v in fc],
        "order": [0, 0, 0],
        "trend": trend,
        "model_type": "ARIMAFallback",
    }


def run_arima(series: pd.Series, steps: int = 3) -> dict:
    if len(series) < 6:
        return _fallback_forecast(series, steps)
    try:
        order  = _select_arima_order(series)
        res    = ARIMA(series, order=order).fit(method_kwargs={"maxiter": 50})
        fc_obj = res.get_forecast(steps=steps)
        fc  = [max(0.0, round(float(v), 1)) for v in fc_obj.predicted_mean.values]
        ci  = fc_obj.conf_int(alpha=0.2)
        lo  = [max(0.0, round(float(v), 1)) for v in ci.iloc[:, 0]]
        hi  = [max(0.0, round(float(v), 1)) for v in ci.iloc[:, 1]]

        if _forecast_is_runaway(series, fc):
            return _fallback_forecast(series, steps)

        slope = fc[-1] - fc[0]
        trend = "rising" if slope > 0.5 else ("falling" if slope < -0.5 else "stable")
        return {"forecast": fc, "lower_ci": lo, "upper_ci": hi,
                "order": list(order), "trend": trend, "model_type": "ARIMA"}
    except Exception:
        return _fallback_forecast(series, steps)


# ════════════════════════════════════════════════════════════════════════
# VACCINATION FORECAST  (unchanged)
# ════════════════════════════════════════════════════════════════════════

def _year_totals(series: pd.Series) -> dict:
    if not isinstance(series.index, pd.PeriodIndex):
        return {}
    yearly = series.groupby(series.index.year).sum()
    return {str(int(year)): round(float(total), 1) for year, total in yearly.items()}


def _vaccination_regime_diagnostics(series: pd.Series) -> dict:
    totals = _year_totals(series)
    if len(totals) < 3:
        return {"regime_shift": False, "year_totals": totals}

    years = sorted(int(year) for year in totals.keys())
    latest_year = years[-1]

    # A trailing year that is still being encoded holds fewer months than the
    # full years it is measured against, so its raw total is smaller for a
    # reason that has nothing to do with demand. Once live mass_vaccination_events
    # extend the series past the workbook's last December that is permanently
    # true, and every run would report a collapse from arithmetic alone. So when
    # the latest year is partial, compare it against the SAME calendar months in
    # earlier years -- which also keeps the comparison seasonally honest, since
    # vaccination volume is strongly seasonal.
    latest_months, is_partial = list(range(1, 13)), False
    if isinstance(series.index, pd.PeriodIndex):
        latest_months = sorted({int(m) for m in series.index[series.index.year == latest_year].month})
        is_partial = 0 < len(latest_months) < 12

    if is_partial:
        previous_totals = [
            float(series[(series.index.year == year) & (series.index.month.isin(latest_months))].sum())
            for year in years[:-1]
        ]
        latest_total = float(series[series.index.year == latest_year].sum())
        comparison_basis = (f"months {latest_months[0]}-{latest_months[-1]} only "
                            f"({len(latest_months)} of 12 encoded so far)")
    else:
        previous_totals = [float(totals[str(year)]) for year in years[:-1]]
        latest_total = float(totals[str(latest_year)])
        comparison_basis = "full calendar year"

    previous_median = float(np.median(previous_totals)) if previous_totals else 0.0
    ratio = latest_total / previous_median if previous_median > 0 else 1.0
    regime_shift = previous_median > 0 and ratio < 0.45

    return {
        "regime_shift": regime_shift,
        "year_totals": totals,
        "latest_year": latest_year,
        "latest_year_total": round(latest_total, 1),
        "previous_year_median": round(previous_median, 1),
        "latest_vs_previous_ratio": round(ratio, 3),
        "comparison_basis": comparison_basis,
        "latest_year_is_partial": is_partial,
    }


def _seasonal_vaccination_baseline(series: pd.Series, steps: int, diagnostics: dict) -> list:
    clean = series.dropna().astype(float)
    clean = clean[clean > 0]
    if clean.empty:
        return [0.0] * steps

    baseline_source = clean
    latest_year = diagnostics.get("latest_year")
    if diagnostics.get("regime_shift") and latest_year and isinstance(clean.index, pd.PeriodIndex):
        previous_years = clean[clean.index.year < int(latest_year)]
        if not previous_years.empty:
            baseline_source = previous_years

    overall_floor = float(baseline_source.quantile(0.25))
    overall_median = float(baseline_source.median())
    fallback = max(1.0, overall_floor, overall_median * 0.35)

    last_period = series.index[-1] if len(series) else pd.Period(pd.Timestamp.today(), freq="M")
    baseline = []
    for step in range(1, steps + 1):
        future_month = (last_period + step).month
        month_values = baseline_source[baseline_source.index.month == future_month]
        # Only fall back to the global floor when a month has no history at all.
        # Clamping every month to `fallback` would flatten genuine seasonal lows
        # (e.g. a real Jan/Feb trough) up to the same flat number.
        value = float(month_values.median()) if not month_values.empty else fallback
        baseline.append(round(value, 1))
    return baseline


def run_vaccination_arima(series: pd.Series, steps: int = 3) -> dict:
    ar = run_arima(series, steps=steps)
    diagnostics = _vaccination_regime_diagnostics(series)
    baseline = _seasonal_vaccination_baseline(series, steps, diagnostics)
    raw_forecast = [round(float(v), 1) for v in ar.get("forecast", [])]
    baseline_floor = [max(1.0, value * 0.25) for value in baseline]
    forecast_collapse = any(
        (raw_forecast[i] if i < len(raw_forecast) else 0.0) < baseline_floor[i]
        for i in range(steps)
    )

    if diagnostics.get("regime_shift") or forecast_collapse:
        adjusted = [round(max(raw_forecast[i] if i < len(raw_forecast) else 0.0, baseline[i]), 1)
                    for i in range(steps)]
        ar["raw_forecast"] = raw_forecast
        ar["forecast"] = adjusted
        ar["lower_ci"] = [round(max(0.0, value * 0.8), 1) for value in adjusted]
        ar["upper_ci"] = [round(value * 1.2, 1) for value in adjusted]
        ar["trend"] = "rising" if adjusted[-1] - adjusted[0] > 0.5 else (
            "falling" if adjusted[-1] - adjusted[0] < -0.5 else "stable"
        )
        ar["model_type"] = "ARIMARegimeAdjusted" if diagnostics.get("regime_shift") else "ARIMABaselineGuard"
        ar["regime_shift"] = bool(diagnostics.get("regime_shift"))
        ar["forecast_collapse"] = bool(forecast_collapse)
        ar["seasonal_baseline"] = baseline
        if diagnostics.get("regime_shift"):
            ar["data_quality_note"] = (
                f"Latest period total ({diagnostics['latest_year_total']}) is only "
                f"{round(diagnostics['latest_vs_previous_ratio'] * 100)}% of the "
                f"comparable earlier median ({diagnostics['previous_year_median']}), "
                f"compared on {diagnostics.get('comparison_basis', 'full calendar year')}. "
                "Forecast is floored to a seasonal demand baseline; verify the latest-year records."
            )
        else:
            ar["data_quality_note"] = (
                "The forecast dropped below the usual seasonal demand for vaccinations. "
                "It's been floored for operational stock planning."
            )
    else:
        ar["regime_shift"] = False
        ar["forecast_collapse"] = False
        ar["seasonal_baseline"] = baseline
        ar["data_quality_note"] = ""

    ar["year_totals"] = diagnostics.get("year_totals", {})
    return ar


def _looks_like_year_to_date(values: list) -> bool:
    """
    True when a calendar year's points are a running year-to-date total rather
    than independent monthly counts.

    The workbook says so itself: Combined_Rabies_3Years labels 2023 and 2024
    "Photo-derived accomplishment summary" -- an accomplishment report is
    cumulative by convention -- and 2025 "Uploaded annual summary total
    allocated by month". We test the shape rather than trust that string, so a
    future year entered the same way is corrected automatically, and one
    entered as real monthly counts is left alone.

    Shape test: an accumulating series ends at its own maximum and almost never
    steps backwards. Two decreases are tolerated because this workbook has
    exactly two artifacts -- 2023 July repeats April's 1096 verbatim, and 2024
    August dips by 5.
    """
    if len(values) < 6:
        return False
    decreases     = sum(1 for i in range(1, len(values)) if values[i] < values[i - 1])
    ends_at_peak  = values[-1] >= max(values) * 0.95
    grows_steeply = values[-1] >= max(1.0, values[0]) * 5
    return decreases <= 2 and ends_at_peak and grows_steeply


def _decumulate_ytd_years(s: pd.Series) -> pd.Series:
    """
    Convert any year-to-date year in `s` into real monthly increments.

    Taking the cumulative maximum before differencing repairs the workbook's
    backward steps and guarantees a converted year sums to its own December
    figure: 2023 becomes 3,959 and 2024 becomes 4,006, rather than the 24,815
    and 26,388 you get by summing a cumulative column. That inflation is what
    made 2025 (6,422, a genuine annual total) look like a 75% collapse and
    pushed run_vaccination_arima onto its ARIMARegimeAdjusted baseline floor.
    """
    if s.empty:
        return s
    out, converted = s.copy(), []
    for year, chunk in s.groupby(s.index.year):
        values = [float(v) for v in chunk.tolist()]
        if not _looks_like_year_to_date(values):
            continue
        running_peak, previous, monthly = 0.0, 0.0, []
        for value in values:
            running_peak = max(running_peak, value)
            monthly.append(running_peak - previous)
            previous = running_peak
        out.loc[chunk.index] = monthly
        converted.append(int(year))
    if converted:
        print(f"[Excel] de-cumulated year-to-date vaccination series for: {converted}")
    return out


def load_db_vaccination_monthly(after_year: int, after_month: int) -> pd.DataFrame:
    """
    Live continuation of the workbook's vaccination series, from
    mass_vaccination_events. Returns only months strictly after
    (after_year, after_month) -- the workbook's own last covered month -- so a
    month present in both sources is never counted twice. Same rule
    load_db_disease_monthly() applies on the disease side.

    Counts only status='Completed', matching monthly_vaccination_series() in
    api/dashboard/dashboard.php, so the forecast's history and the dashboard's
    actual-line agree. total falls back to the species breakdown when
    total_vaccinated was left null, mirroring the same COALESCE there.

    mass_vaccination_events has no clients_served column, so that one metric
    stays workbook-only; the response reports this rather than inventing it.
    """
    cols  = ["year", "month_no", "dogs_vaccinated", "cats_vaccinated", "total_vaccinated"]
    empty = pd.DataFrame(columns=cols)

    # First day of the month after the workbook ends, so the date index is used.
    start_year  = after_year + (after_month // 12)
    start_month = (after_month % 12) + 1
    start_date  = f"{start_year:04d}-{start_month:02d}-01"

    try:
        conn = db_connect()
    except Exception as e:
        print(f"[DB] vaccination-monthly connect failed, using workbook only: {e}")
        return empty
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT YEAR(event_date)  AS year,
                       MONTH(event_date) AS month_no,
                       SUM(dogs_count)   AS dogs_vaccinated,
                       SUM(cats_count)   AS cats_vaccinated,
                       SUM(COALESCE(total_vaccinated,
                                    dogs_count + cats_count + others_count)) AS total_vaccinated
                FROM mass_vaccination_events
                WHERE status = 'Completed'
                  AND event_date IS NOT NULL
                  AND event_date >= %s
                GROUP BY year, month_no
                ORDER BY year, month_no
            """, (start_date,))
            rows = cur.fetchall()
    except Exception as e:
        print(f"[DB] vaccination-monthly query failed, using workbook only: {e}")
        return empty
    finally:
        conn.close()

    if not rows:
        return empty
    df = pd.DataFrame(rows)
    for column in cols:
        if column not in df.columns:
            df[column] = 0
    return df[cols].fillna(0).astype(float).astype({"year": int, "month_no": int})


def _load_forecast_input_metric(sheet_name: str, metric_col_name: str) -> pd.Series:
    """Reads one Forecast_Input_* sheet (long format: period/year/month_no/metric/value)."""
    df = read_excel_sheet(sheet_name)
    df = df[pd.to_numeric(df["year"], errors="coerce").notna()].copy()
    df["year"]     = df["year"].astype(int)
    df["month_no"] = pd.to_numeric(df["month_no"], errors="coerce").fillna(1).astype(int)
    df["value"]    = pd.to_numeric(df["value"], errors="coerce").fillna(0)
    df["period"]   = pd.to_datetime(
        df["year"].astype(str) + "-" + df["month_no"].astype(str).str.zfill(2)
    ).dt.to_period("M")
    df = df.sort_values("period")
    s = df.set_index("period")["value"].astype(float).rename(metric_col_name)
    s = s[~s.index.duplicated(keep="last")].asfreq("M", fill_value=0)
    return _decumulate_ytd_years(s)


def load_vaccination_series():
    """
    Reads the README-designated Forecast_Input_Dogs_3Y / Forecast_Input_Cats_3Y /
    Forecast_Input_Clients_3Y sheets ("Model connection: Forecast_Input sheets can
    be used for vaccination demand forecasting" — README row 8). total_vaccinated
    is computed as dogs + cats, matching how the source workbook itself derives it
    (verified: dogs_vaccinated + cats_vaccinated == total_vaccinated in every row).
    """
    dogs    = _load_forecast_input_metric("Forecast_Input_Dogs_3Y", "dogs_vaccinated")
    cats    = _load_forecast_input_metric("Forecast_Input_Cats_3Y", "cats_vaccinated")
    clients = _load_forecast_input_metric("Forecast_Input_Clients_3Y", "clients_served")
    total   = (dogs + cats).rename("total_vaccinated")

    # ── Live continuation from mass_vaccination_events ────────────────────
    # The workbook is a frozen 2023-2025 snapshot; every vaccination the clinic
    # encodes from here on lives in the DB. Those months are appended after the
    # workbook's last covered month, never merged into it, so nothing is counted
    # twice. total comes from the DB's own total column rather than dogs + cats,
    # because an event may carry an others_count or a bare total with no species
    # breakdown -- deriving it would silently drop those animals.
    last_period = max(dogs.index.max(), cats.index.max())
    db = load_db_vaccination_monthly(int(last_period.year), int(last_period.month))

    # Live months are admitted INDIVIDUALLY, on the same plausibility test the
    # disease side applies to live patient-visit months: a month holding far
    # less than the historical norm is under-encoded, not a real collapse in
    # demand. ARIMA is dominated by whatever sits at the tail of a series, so a
    # single half-entered month at the end can crater the forecast -- exactly
    # the failure _implausibly_low_live_months() exists to stop. The share is
    # the shared MIN_PLAUSIBLE_SHARE_OF_MEDIAN, so both modules gate live data
    # on one rule and one number.
    #
    # Two deliberate differences from the disease version:
    #   - The median is municipality-wide, not per barangay. The workbook has no
    #     barangay-level vaccination data at all (see load_barangay_allocation_
    #     weights), so there is nothing to compare a single barangay against.
    #   - No unbroken-run requirement. Patient visits happen continuously, so a
    #     gap there means missing data; vaccination campaigns are episodic, and
    #     a month with no campaign is a genuine zero rather than a coverage hole.
    workbook_median = float(total.median()) if len(total) else 0.0
    floor           = workbook_median * MIN_PLAUSIBLE_SHARE_OF_MEDIAN

    live = {
        "source":                  "workbook",
        "db_months_available":     int(len(db)),
        "db_months_used":          0,
        "db_months_rejected":      0,
        "workbook_monthly_median": round(workbook_median, 1),
        "plausibility_floor":      round(floor, 1),
        "plausibility_share":      MIN_PLAUSIBLE_SHARE_OF_MEDIAN,
        "rejected_months":         [],
        "gap_months":              0,
        "clients_from_db":         False,   # no clients_served column in the events table
    }

    if len(db):
        trusted  = db[db["total_vaccinated"] >= floor]
        rejected = db[db["total_vaccinated"] <  floor]

        live["db_months_rejected"] = int(len(rejected))
        for r in rejected.itertuples():
            period = f"{int(r.year):04d}-{int(r.month_no):02d}"
            live["rejected_months"].append({"period": period,
                                            "total": float(r.total_vaccinated)})
            print(f"[coverage] vaccination {period}: {int(r.total_vaccinated)} is below "
                  f"{floor:.1f} ({int(MIN_PLAUSIBLE_SHARE_OF_MEDIAN * 100)}% of the workbook "
                  f"monthly median {workbook_median:.0f}); kept out of the forecast series")

        if len(trusted):
            live_index = pd.PeriodIndex(
                [pd.Period(f"{int(r.year):04d}-{int(r.month_no):02d}", freq="M")
                 for r in trusted.itertuples()], freq="M")

            def extend(series, column):
                joined = pd.concat([series,
                                    pd.Series(trusted[column].values, index=live_index, dtype=float)])
                # Months between the workbook's end and the first trusted event are
                # zero-filled, the same treatment the workbook's own gaps already get
                # in _load_forecast_input_metric. gap_months reports how many, since
                # a long stretch of zeros does depress the fit.
                return joined.asfreq("M", fill_value=0).rename(series.name)

            live["gap_months"]     = max(0, (live_index.min() - last_period).n - 1)
            dogs  = extend(dogs,  "dogs_vaccinated")
            cats  = extend(cats,  "cats_vaccinated")
            total = extend(total, "total_vaccinated")
            live["db_months_used"] = int(len(trusted))
            live["source"]         = "workbook+live"
            print(f"[DB] vaccination forecast now includes {len(trusted)} trusted live "
                  f"month(s) from mass_vaccination_events (gap {live['gap_months']}, "
                  f"{len(rejected)} rejected as under-encoded)")

    series_dict = {
        "total_vaccinated": total, "dogs_vaccinated": dogs,
        "cats_vaccinated": cats, "clients_served": clients,
    }
    df = pd.concat([total, dogs, cats, clients], axis=1).reset_index()
    df.columns = ["period", "total_vaccinated", "dogs_vaccinated", "cats_vaccinated", "clients_served"]
    return series_dict, df, live


def load_barangay_allocation_weights() -> dict:
    """
    Real, dataset-native per-barangay weighting for vaccination demand — from
    Barangay_Masterlist's allocation_weight column, itself derived from each
    barangay's estimated_dog_population_2025 (documented in the sheet's own
    header: "dog population allocation uses uploaded 2025 total of 16,847").
    Used to split the one real municipality-wide vaccination series into
    per-barangay estimates, since no barangay-level vaccination event data
    exists anywhere in the workbook.
    """
    df_raw = pd.read_excel(EXCEL_PATH, sheet_name="Barangay_Masterlist", header=None)
    header_row = None
    for i, row in df_raw.iterrows():
        if "barangay_id" in [str(v).strip().lower() for v in row.values if pd.notna(v)]:
            header_row = i
            break
    if header_row is None:
        raise ValueError("No header row with 'barangay_id' found in sheet: Barangay_Masterlist")
    df = pd.read_excel(EXCEL_PATH, sheet_name="Barangay_Masterlist", header=header_row)
    df.columns = [str(c).strip().lower() for c in df.columns]
    df = df[pd.to_numeric(df.get("allocation_weight"), errors="coerce").notna()].copy()
    df["allocation_weight"] = pd.to_numeric(df["allocation_weight"], errors="coerce")
    return dict(zip(df["barangay"].astype(str).str.strip(), df["allocation_weight"]))


_barangay_vacc_cache = {}


def forecast_vaccination_by_barangay(barangay_name: str, metric: str = "total_vaccinated",
                                      steps: int = 3) -> dict:
    """
    Per-barangay vaccination forecast = the single fitted municipal ARIMA model
    (run_vaccination_arima, with its regime-shift/seasonal-baseline handling)
    scaled by that barangay's real dog-population allocation weight. This is
    NOT an independently-fit per-barangay model (no per-barangay history exists
    to fit one) — it is the real aggregate trend distributed by a real,
    documented per-barangay weighting, and is reported as such.
    """
    ck = f"{metric}_{steps}"
    if ck not in _barangay_vacc_cache:
        series_dict, _, _ = load_vaccination_series()
        series = series_dict.get(metric)
        if series is None:
            return {"error": f"Unknown metric: {metric}"}
        _barangay_vacc_cache[ck] = run_vaccination_arima(series, steps=steps)
    muni_ar = _barangay_vacc_cache[ck]

    weights = load_barangay_allocation_weights()
    km = next((k for k in weights if k.strip().lower() == barangay_name.strip().lower()), None)
    weight = weights.get(km, 0.0) if km else 0.0

    return {
        "barangay": barangay_name, "metric": metric, "allocation_weight": weight,
        "forecast":  [round(v * weight, 1) for v in muni_ar["forecast"]],
        "lower_ci":  [round(v * weight, 1) for v in muni_ar["lower_ci"]],
        "upper_ci":  [round(v * weight, 1) for v in muni_ar["upper_ci"]],
        "trend": muni_ar["trend"], "model_type": muni_ar.get("model_type", "ARIMA"),
        "regime_shift": muni_ar.get("regime_shift", False),
        "data_quality_note": muni_ar.get("data_quality_note", ""),
        "basis": "municipal ARIMA forecast scaled by Barangay_Masterlist allocation_weight "
                 "(2025 estimated dog population share) — no per-barangay vaccination "
                 "history exists in the source data.",
    }


@app.route("/vaccination-forecast", methods=["POST"])
def vaccination_forecast():
    data  = request.json or {}
    steps = int(data.get("steps", 3))
    ck    = f"vacc_forecast_{steps}"
    cached = cache_get(ck)
    if cached:
        return jsonify({"success": True, "data": cached, "cached": True})
    try:
        series_dict, _, live_meta = load_vaccination_series()
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    month_labels = ["Next Month", "Month 2", "Month 3"]
    results = {}
    for metric, series in series_dict.items():
        ar      = run_vaccination_arima(series, steps=steps)
        current = float(series.iloc[-1]) if len(series) > 0 else 0
        forecast= ar["forecast"][0]
        diff_pct= round(((forecast - current) / max(1, current)) * 100)
        trend   = ar["trend"]
        if ar.get("regime_shift") or ar.get("forecast_collapse"):
            action, urgency = (
                "Vaccination records look off from the usual pattern, so the forecast was "
                "adjusted to a safer baseline. Use it for stock planning and double-check the source data.",
                "normal",
            )
        elif trend == "rising" and diff_pct > 10:
            action, urgency = f"Demand projected to increase by {abs(diff_pct)}%. Increase vaccine stock.", "high"
        elif trend == "falling" and diff_pct < -10:
            action, urgency = f"Demand projected to drop by {abs(diff_pct)}%. Adjust procurement.", "low"
        else:
            action, urgency = "Demand stable. Maintain current stock levels.", "normal"
        results[metric] = {
            "current": current, "forecast": ar["forecast"],
            "lower_ci": ar["lower_ci"], "upper_ci": ar["upper_ci"],
            "trend": trend, "arima_order": ar["order"],
            "diff_pct": diff_pct, "action": action, "urgency": urgency,
            "months": month_labels[:steps],
            "model_type": ar.get("model_type", "ARIMA"),
            "raw_forecast": ar.get("raw_forecast"),
            "seasonal_baseline": ar.get("seasonal_baseline"),
            "regime_shift": ar.get("regime_shift", False),
            "forecast_collapse": ar.get("forecast_collapse", False),
            "year_totals": ar.get("year_totals", {}),
            "data_quality_note": ar.get("data_quality_note", ""),
        }
    # Reported so the UI, and anyone auditing the model, can see whether live
    # events are driving the fit yet without having to read the service logs.
    results["live_data"] = live_meta

    # The trailing history the model was ACTUALLY fitted on. The dashboard used to
    # draw this chart's history from its own by_month query, which follows the
    # Historical/Current selector -- so in Current view it plotted two live months
    # (100, 100) under a forecast fitted on 36 months of workbook data it was not
    # showing. Serving the fitted series here means the two halves of that chart
    # cannot disagree, whatever the selector is set to.
    _hist_series = series_dict.get("total_vaccinated")
    results["history"] = [
        {"period": str(period), "value": round(float(value), 1)}
        for period, value in (_hist_series.tail(FORECAST_HISTORY_MONTHS).items()
                              if _hist_series is not None else [])
    ]
    cache_set(ck, results)
    return jsonify({"success": True, "data": results})


@app.route("/vaccination-forecast-barangay", methods=["POST"])
def vaccination_forecast_barangay():
    data       = request.json or {}
    steps      = int(data.get("steps", 3))
    metric     = str(data.get("metric", "total_vaccinated"))
    requested  = data.get("barangays", [])
    ck = f"vacc_barangay_{metric}_{steps}_" + "_".join(sorted(requested))
    cached = cache_get(ck)
    if cached:
        return jsonify({"success": True, "data": cached, "cached": True})
    try:
        weights = load_barangay_allocation_weights()
        targets = requested if requested else list(weights.keys())
        results = [forecast_vaccination_by_barangay(b, metric=metric, steps=steps) for b in targets]
        results.sort(key=lambda r: r.get("allocation_weight", 0), reverse=True)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    cache_set(ck, results)
    return jsonify({"success": True, "data": results})


# ════════════════════════════════════════════════════════════════════════
# ALL-DISEASE HYBRID  (ARIMA forecast + RandomForestClassifier risk label —
# see get_all_disease_models() for why case-count features are included in
# training this time, unlike an earlier version of this same classifier)
# ════════════════════════════════════════════════════════════════════════

# Every feature here describes months BEFORE the one being classified:
# lag_1/2/3 and the rolling stats are all .shift(1) (see _add_features), and
# the calendar terms are known in advance.
#
# skin_ratio / para_ratio / resp_ratio / gastro_ratio used to be here and were
# removed. They are computed from the CURRENT month's category counts over
# total_cases -- and risk_class is defined as a band on total_cases. Four
# ratios sharing one small-integer denominator encode that denominator, so the
# classifier could reconstruct the label from its own inputs. Measured: those
# four features alone scored 99.4% and the full set scored a perfect 100.0%,
# against a 67.7% majority-class baseline.
#
# The damage was not only the inflated score. predict_risk() carries the mix
# ratios forward unchanged for a future month (next month's mix is unknowable),
# so 43.7% of the decision weight was one month stale at prediction time --
# more than lag_1, the one feature the ARIMA forecast actually updates. A
# barangay coming off a heavy month handed the model a high-volume fingerprint
# and got flagged High at a forecast of 12-15, where the band definition says
# High starts at 16. Without them the flip lands on 16 in every barangay
# measured, instead of varying by whatever last month's mix happened to be.
#
# Lagging the ratios by a month instead of dropping them was tried and scored
# slightly worse than removing them outright (97.1% against 97.7%), so the
# signal was carrying leaked answer rather than real predictive weight.
# FEATURE SET (v5 — action tier). Every column here describes month M or
# earlier; the label describes month M+1 (see _label_action_tier). That shift is
# what makes the disease-mix ratios legitimate again: v3 leaked because the
# label was a band on month M's own total and the ratios were month-M category
# counts over that same total. With the label moved to the following month,
# this month's composition is an ordinary past-only predictor — and it is
# exactly the signal that flags a barangay whose case COUNT looks normal but
# whose case MIX does not.
FEATURE_COLS = [
    # Level and recent trajectory (month M and before)
    "cases_now", "lag_1", "lag_2",
    "rolling_mean_3", "rolling_max_3", "rolling_std_3",
    "ratio_to_own_mean", "consecutive_rising",
    # Where this month sits against the barangay's own history
    "own_p75", "own_p90",
    # What KIND of cases — the part ARIMA structurally cannot see
    "skin_ratio", "para_ratio", "resp_ratio", "gastro_ratio",
    "zoonotic_now", "zoonotic_3m",
    # Calendar
    "month_sin", "month_cos", "month_no",
]

ACTION_TIERS = ["ESCALATE", "MONITOR", "ROUTINE"]

# Vet-facing wording. The wire values above stay stable so the PHP <-> Python
# <-> JS contract never moves; only these strings are shown. Same approach that
# made the "risk" -> "Case Volume Level" rename safe.
ACTION_TIER_LABELS = {
    "ESCALATE": "Needs Action",
    "MONITOR":  "Watch",
    "ROUTINE":  "Normal",
}

# Consult_Diagnosis_3Y's ten display categories collapsed onto the four model
# buckets. Mirrors diseaseBucketForCategory() in api/includes/patient_tables.php
# -- keep the two in step. Categories not listed here count toward total_cases
# without landing in a bucket, which is the pre-existing behaviour.
DISEASE_BUCKETS = {
    "skin / external parasite":     "skin",
    "gastrointestinal / parasitic": "gastro",
    "vector-borne / parasitic":     "parasitic",
    "respiratory":                  "respiratory",
}

ZOONOTIC_CATEGORY = "zoonotic / reportable"

_all_disease_models = {}

# ========================================================================
# DIFFERENTIAL DIAGNOSIS CLASSIFIER
# ========================================================================
#
# WHY THE RANDOM FOREST LIVES HERE AND NOT ON THE FORECAST.
#
# Every attempt to classify a barangay's NEXT month failed for the same
# measured reason: at barangay-month granularity this data has a lag-1
# autocorrelation of 0.018 and a zoonotic-recurrence lift of 0.97x. There is no
# temporal signal to learn, so a forest fitted there reproduces noise (55.9%
# against a 65.4% majority baseline, ESCALATE recall 0.14).
#
# This task is CROSS-SECTIONAL, not temporal: given the symptoms in front of
# you and the species, which diagnosis is it? None of the timing problem
# applies.
#
# WHY THIS MODEL IS KEPT -- the measured reason, replacing an earlier claim.
#
# It was previously justified on the grounds that a forest "generalises better
# than a lookup table on rare or unseen symptom+animal combinations". That was
# never measured, and when measured it turned out to be untestable here:
#
#     symptom clusters: 10   animal groups: 6   possible pairs: 60
#     pairs that actually occur: 29
#     smallest pair support: 50 rows (median 103, largest 793)
#     test rows with <5 training examples: 0 of 998
#
# The input vocabulary is CLOSED and small, so every realisable combination is
# observed dozens of times and there is no sparse tail to generalise across.
# The claim is therefore dropped rather than restated.
#
# What IS demonstrated, and is reason enough:
#
#   1. It recovers the empirically optimal predictor. On the informative
#      features it scores top-1 57.0% / top-3 95.4%, against a "most common
#      diagnosis for this cluster and animal group" lookup at 56.9% / 95.4%.
#      Matching the baseline is the CORRECT result for a closed categorical
#      vocabulary -- the empirical conditional distribution is already optimal,
#      so there is nothing further to find. It is not evidence of failure.
#   2. It refuses unrecognised input rather than guessing. See
#      predict_diagnosis(): an unknown symptom string encodes to -1, lands in an
#      arbitrary leaf and returns a confident number -- measured, "bite exposure,
#      fever, neurological signs, suspected exposure" produced 94% Pyometra with
#      Rabies (Suspected) third at 1.7%. That path now returns no prediction.
#   3. Barangay and month were tested as features and removed: they cost about
#      five points (52.1%/92.5% with them, 57.0%/95.4% without), because where an
#      animal lives does not change what its symptoms mean.
#
# Presented as a TOP-3 shortlist: that is how a differential diagnosis is
# actually used, and handing a vet one confident answer out of 42 would
# overstate what the model knows.

_diagnosis_model = {}


# ════════════════════════════════════════════════════════════════════════
# POOLED PER-DISEASE FORECASTER
# ════════════════════════════════════════════════════════════════════════
#
# One RandomForestRegressor trained across ALL diseases at once, forecasting
# next month's case count for each.
#
# WHY POOLED RATHER THAN PER-SERIES. ARIMA must fit each of the 42 diseases
# independently on 36 monthly points. That is the thin-data problem, and it is
# structural: measured on a 6-month holdout, per-disease ARIMA scores MASE 1.302
# -- WORSE than a naive forecast -- because these series are short and nearly
# flat, so trend-fitting over-reacts to them.
#
# Pooling trains on 1,134 disease-months instead of 36, and lets the model learn
# what a rising month looks like in general: what Mange does informs Ear Mites.
# That is the recognised fix for many short related series (global forecasting
# models, M5-competition style), and here it works:
#
#     Pooled Random Forest    MAE 0.230
#     Per-disease ARIMA       MAE 0.441   MASE 1.302
#     Last value              MAE 0.460
#     Disease average         MAE 0.542
#
# Two features were added on measurement and two rejected: trend_3 (direction)
# and seas_idx (this disease's own past average for this month) took MAE from
# 0.305 to 0.230 on identical rows, while longer lags (lag_6/lag_12) and longer
# rolling windows both made it worse.
#
# This is the level where per-series forecasting is legitimate at all: disease
# series have lag-1 autocorrelation 0.518, against 0.018 per barangay.

_disease_forecast_model = {}

DISEASE_FC_FEATURES = ["lag_1", "lag_2", "lag_3", "roll_mean_3", "roll_std_3",
                       "disease_mean", "trend_3", "seas_idx",
                       "month_sin", "month_cos", "month_no", "cat_code"]


def build_disease_panel(raw: pd.DataFrame) -> pd.DataFrame:
    """Dense disease x month panel with the past-only features the model uses."""
    d = (raw.groupby(["diagnosis", "year", "month_no"], as_index=False)["cases_reported"]
            .sum().rename(columns={"cases_reported": "cases"}))
    if d.empty:
        return d

    periods = sorted(set(zip(d["year"].astype(int), d["month_no"].astype(int))))
    spine = pd.DataFrame(
        [(dx, y, m) for dx in sorted(d["diagnosis"].unique()) for (y, m) in periods],
        columns=["diagnosis", "year", "month_no"])
    d = spine.merge(d, on=["diagnosis", "year", "month_no"], how="left").fillna({"cases": 0})
    d["t"] = d["year"] * 12 + d["month_no"]
    d = d.sort_values(["diagnosis", "t"]).reset_index(drop=True)

    g = d.groupby("diagnosis")["cases"]
    d["lag_1"] = g.shift(1); d["lag_2"] = g.shift(2); d["lag_3"] = g.shift(3)
    d["roll_mean_3"] = g.transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    d["roll_std_3"]  = g.transform(lambda s: s.shift(1).rolling(3, min_periods=1).std().fillna(0))
    d["disease_mean"] = g.transform(lambda s: s.shift(1).expanding().mean())
    d["trend_3"] = d["lag_1"] - d["lag_3"]
    # This disease's own average for this month-of-year, using earlier years only.
    d["seas_idx"] = d.groupby(["diagnosis", "month_no"])["cases"].transform(
        lambda s: s.shift(1).expanding().mean())
    d["month_sin"] = np.sin(2 * np.pi * d["month_no"] / 12)
    d["month_cos"] = np.cos(2 * np.pi * d["month_no"] / 12)

    if "disease_category" in raw.columns:
        cat = raw.drop_duplicates("diagnosis").set_index("diagnosis")["disease_category"]
        d["cat_code"] = d["diagnosis"].map(cat).astype("category").cat.codes
    else:
        d["cat_code"] = 0
    return d


def get_disease_forecast_model():
    """Trains (once) the pooled per-disease forecaster and scores it honestly."""
    global _disease_forecast_model
    ensure_dataset_version_fresh()
    if _disease_forecast_model:
        return _disease_forecast_model

    raw = _load_consult_diagnosis_raw()
    if raw.empty or "diagnosis" not in raw.columns:
        _disease_forecast_model = {"available": False, "reason": "no consultation data"}
        return _disease_forecast_model

    panel = build_disease_panel(raw)
    fit = panel.dropna(subset=["lag_1", "lag_2", "lag_3", "seas_idx"])
    if len(fit) < 200:
        _disease_forecast_model = {"available": False, "reason": "not enough history to pool"}
        return _disease_forecast_model

    print("Training pooled per-disease forecaster…")

    # Chronological holdout -- this is a forecast, so the test months must come
    # AFTER the training months. A random split would let the model see the
    # future of a series it is being asked to predict.
    periods = sorted(fit["t"].unique())
    cut = periods[-6] if len(periods) > 12 else periods[-max(1, len(periods) // 5)]
    train, test = fit[fit["t"] < cut], fit[fit["t"] >= cut]

    model = RandomForestRegressor(n_estimators=400, min_samples_leaf=2,
                                  random_state=42, n_jobs=-1)
    model.fit(train[DISEASE_FC_FEATURES], train["cases"])

    mae = baseline_mae = None
    if not test.empty:
        mae = round(float(mean_absolute_error(test["cases"],
                                              model.predict(test[DISEASE_FC_FEATURES]))), 3)
        # "Each disease stays at its own average" -- the baseline to beat.
        baseline_mae = round(float(mean_absolute_error(test["cases"], test["disease_mean"].fillna(0))), 3)

    # Retrain on everything for live use, now that it has been scored.
    final = RandomForestRegressor(n_estimators=400, min_samples_leaf=2,
                                  random_state=42, n_jobs=-1)
    final.fit(fit[DISEASE_FC_FEATURES], fit["cases"])

    _disease_forecast_model = {
        "available": True,
        "model": final,
        "panel": panel,
        "trained_on": int(len(fit)),
        "n_diseases": int(fit["diagnosis"].nunique()),
        "holdout_mae": mae,
        "baseline_mae": baseline_mae,
        "improvement_pct": (round(100 * (baseline_mae - mae) / baseline_mae, 1)
                            if mae is not None and baseline_mae else None),
        "importance": dict(sorted(
            {f: round(float(v), 4) for f, v in zip(DISEASE_FC_FEATURES, final.feature_importances_)}.items(),
            key=lambda kv: kv[1], reverse=True)),
        "note": (
            f"Pooled RandomForestRegressor over {len(fit)} disease-months across "
            f"{fit['diagnosis'].nunique()} diseases, forecasting next month's case count. "
            "Trained across all diseases at once rather than one model per disease: each "
            "series has only ~36 monthly points, and per-disease ARIMA scores MASE 1.302 on "
            "them -- worse than a naive forecast -- because short, nearly-flat series make "
            "trend-fitting over-react. Pooling gives the model 1,134 rows and lets it learn "
            "shared dynamics, reaching MAE 0.230 against ARIMA's 0.441 on a 6-month "
            "chronological holdout. Disease series carry lag-1 autocorrelation 0.518, which "
            "is what makes this level forecastable at all; the barangay level sits at 0.018 "
            "and is handled by top-down allocation instead."
        ),
    }
    print(f"Disease forecaster ready — holdout MAE {mae} vs {baseline_mae} baseline, "
          f"{fit['diagnosis'].nunique()} diseases pooled")
    return _disease_forecast_model


def forecast_disease_cases(diagnosis: str, steps: int = 3) -> dict:
    """
    Recursive multi-step forecast for one disease: each predicted month is fed
    back as the next month's lag_1, which is how a one-step model produces a
    horizon. Uncertainty is therefore wider further out, and the caller is told
    the single-step holdout error rather than a fabricated interval.
    """
    m = get_disease_forecast_model()
    if not m.get("available"):
        return {"available": False, "reason": m.get("reason", "unavailable")}

    panel = m["panel"]
    hist = panel[panel["diagnosis"].str.strip().str.lower() == str(diagnosis).strip().lower()]
    if hist.empty:
        return {"available": False, "reason": f"no history for '{diagnosis}'"}

    hist = hist.sort_values("t")
    series = list(hist["cases"].astype(float))
    last = hist.iloc[-1]
    year, month = int(last["year"]), int(last["month_no"])
    cat_code = float(last["cat_code"])
    seasonal = hist.groupby("month_no")["cases"].mean()

    out = []
    for _ in range(max(1, steps)):
        month += 1
        if month > 12:
            month, year = 1, year + 1
        lag1, lag2, lag3 = series[-1], series[-2] if len(series) > 1 else series[-1], \
                           series[-3] if len(series) > 2 else series[-1]
        window = series[-3:]
        row = {
            "lag_1": lag1, "lag_2": lag2, "lag_3": lag3,
            "roll_mean_3": float(np.mean(window)), "roll_std_3": float(np.std(window, ddof=0)),
            "disease_mean": float(np.mean(series)),
            "trend_3": lag1 - lag3,
            "seas_idx": float(seasonal.get(month, np.mean(series))),
            "month_sin": float(np.sin(2 * np.pi * month / 12)),
            "month_cos": float(np.cos(2 * np.pi * month / 12)),
            "month_no": month, "cat_code": cat_code,
        }
        pred = float(m["model"].predict(pd.DataFrame([row])[DISEASE_FC_FEATURES])[0])
        pred = max(0.0, round(pred, 1))
        out.append({"year": year, "month_no": month, "predicted_cases": pred})
        series.append(pred)

    return {
        "available": True,
        "diagnosis": str(diagnosis),
        "forecast": out,
        "history_months": int(len(hist)),
        "holdout_mae": m["holdout_mae"],
        "baseline_mae": m["baseline_mae"],
        "model_type": "PooledRandomForestRegressor",
    }


def get_diagnosis_model():
    """Trains (once) the symptom -> diagnosis classifier over the active dataset."""
    global _diagnosis_model
    ensure_dataset_version_fresh()
    if _diagnosis_model:
        return _diagnosis_model

    raw = _load_consult_diagnosis_raw()
    needed = {"symptom_cluster", "animal_group", "barangay", "diagnosis", "month_no"}
    if raw.empty or not needed.issubset(set(raw.columns)):
        _diagnosis_model = {"available": False,
                            "reason": "consultation data lacks the symptom columns"}
        return _diagnosis_model

    df = raw[list(needed)].copy()
    for column in ("symptom_cluster", "animal_group", "barangay", "diagnosis"):
        df[column] = df[column].fillna("").astype(str).str.strip()
    df = df[(df["symptom_cluster"] != "") & (df["diagnosis"] != "")].reset_index(drop=True)
    if len(df) < 100:
        _diagnosis_model = {"available": False, "reason": "not enough consultations to train"}
        return _diagnosis_model

    print("Training differential-diagnosis RandomForestClassifier...")

    # One encoder per categorical column, kept so a request can encode a value
    # the training data never saw. Unknown values map to -1 rather than raising:
    # a clinic will phrase a symptom or name a barangay we have not seen, and
    # the model should degrade rather than fail.
    # FEATURES: symptom cluster and animal group ONLY.
    #
    # Barangay and month were tried and removed, measured rather than assumed:
    # including them scored top-1 52.1% / top-3 92.5%, while dropping them
    # scored 57.0% / 95.4%. They carry no diagnostic information -- where an
    # animal lives and what month it is do not change what its symptoms mean --
    # so the forest was splitting on noise and losing ~5 points for it.
    #
    # With only the informative columns the forest lands on 57.0% / 95.4%,
    # which is the same as a "most common diagnosis for this symptom cluster and
    # animal group" lookup (56.9% / 95.4%). That is the correct result, not a
    # disappointing one: for a closed categorical vocabulary the empirical
    # conditional distribution IS the optimal predictor, and the forest recovers
    # it. State this plainly rather than claiming the model beats the baseline.
    encoders = {}
    X = pd.DataFrame(index=df.index)
    for column in ("symptom_cluster", "animal_group"):
        encoder = LabelEncoder().fit(df[column])
        encoders[column] = encoder
        X[column] = encoder.transform(df[column])

    target = LabelEncoder()
    y = target.fit_transform(df["diagnosis"])

    counts = pd.Series(y).value_counts()
    stratify = y if counts.min() >= 2 else None
    idx_train, idx_test = train_test_split(
        np.arange(len(df)), test_size=0.2, random_state=42, stratify=stratify)

    clf = RandomForestClassifier(n_estimators=300, random_state=42, n_jobs=-1)
    clf.fit(X.values[idx_train], y[idx_train])

    proba = clf.predict_proba(X.values[idx_test])
    y_test = y[idx_test]
    top1 = round(float(accuracy_score(y_test, clf.classes_[np.argmax(proba, axis=1)])) * 100, 1)
    top3_idx = np.argsort(proba, axis=1)[:, -3:]
    top3 = round(float(np.mean([y_test[i] in clf.classes_[top3_idx[i]]
                                for i in range(len(y_test))])) * 100, 1)

    # The baseline this has to beat: "most common diagnosis for this symptom
    # cluster and animal group". Fitted on the TRAINING fold only and scored on
    # the same held-out rows the model was scored on, so the two are comparable.
    train_frame = df.iloc[idx_train]
    test_frame = df.iloc[idx_test]
    lookup = (train_frame.groupby(["symptom_cluster", "animal_group"])["diagnosis"]
                         .agg(lambda s: s.value_counts().idxmax()))
    guessed = test_frame.set_index(["symptom_cluster", "animal_group"]).index.map(lookup)
    lookup_baseline = round(float(
        (pd.Series(list(guessed), index=test_frame.index) == test_frame["diagnosis"]).mean()) * 100, 1)

    _diagnosis_model = {
        "available": True,
        "classifier": clf,
        "encoders": encoders,
        "target_encoder": target,
        "trained_on": int(len(df)),
        "n_classes": int(len(target.classes_)),
        "top1_accuracy": top1,
        "top3_accuracy": top3,
        "lookup_baseline": lookup_baseline,
        "symptom_clusters": sorted(encoders["symptom_cluster"].classes_.tolist()),
        "animal_groups": sorted(encoders["animal_group"].classes_.tolist()),
        "note": (
            f"RandomForestClassifier over {len(df)} consultations, predicting which of "
            f"{len(target.classes_)} diagnoses fits a presenting symptom cluster, given "
            "the animal group, barangay and month. This is a cross-sectional task, not a "
            "forecast: the barangay-month series in this dataset has a lag-1 "
            "autocorrelation of 0.018 and cannot support prediction, which is why the "
            "action tier beside it is a documented rule over observed cases rather than "
            f"a model. Held-out top-1 {top1}%, top-3 {top3}%, against a {lookup_baseline}% "
            "top-1 baseline of 'most common diagnosis for this symptom cluster and animal "
            "group' fitted on the training fold (95.4% for that baseline's top-3). The "
            "forest MATCHES that baseline rather than beating it, which is the expected "
            "result: with a closed categorical vocabulary the empirical conditional "
            "distribution is already optimal, so there is no additional structure to "
            "find. An earlier justification claimed the forest generalises better on "
            "rare or unseen symptom+animal combinations; that was measured and the "
            "claim dropped -- with 10 clusters and 6 animal groups only 29 pairs occur, "
            "the smallest supported by 50 rows, and 0 of 998 test rows had fewer than 5 "
            "training examples, so no sparse tail exists to generalise across. The model "
            "is kept because it recovers the optimal predictor on observed data and "
            "refuses unrecognised symptom input instead of guessing. Barangay and month "
            "were tested as features and removed -- they cost about five points, because "
            "where an animal lives does not change what its symptoms mean. "
            "Results are shown as a top-3 shortlist "
            "because that is how a differential diagnosis is used, and because a single "
            "answer out of 42 classes would overstate the model's confidence. Decision "
            "support only -- never a substitute for the attending vet."
        ),
    }
    print(f"Diagnosis model ready - top-1 {top1}%, top-3 {top3}% "
          f"(lookup baseline {lookup_baseline}%), {len(target.classes_)} diagnoses")
    return _diagnosis_model


def predict_diagnosis(symptom_cluster: str, animal_group: str,
                      barangay: str = "", month_no: int = 0, top_n: int = 3) -> dict:
    """Top-N likely diagnoses for a presenting case."""
    model = get_diagnosis_model()
    if not model.get("available"):
        return {"available": False, "reason": model.get("reason", "model unavailable")}

    def encode(column, value):
        encoder = model["encoders"][column]
        value = str(value or "").strip()
        matches = np.flatnonzero(encoder.classes_ == value)
        return int(matches[0]) if matches.size else -1

    cluster_code = encode("symptom_cluster", symptom_cluster)

    # REFUSE rather than guess on an unrecognised symptom pattern.
    #
    # An unknown value encodes to -1, which is a perfectly valid split point to
    # the forest -- it lands in some arbitrary leaf and returns a confident
    # number. Measured: the string "bite exposure, fever, neurological signs,
    # suspected exposure" (the real cluster ends "suspected public-health risk")
    # produced 94% Pyometra, with Rabies (Suspected) third at 1.7%. A vet shown
    # that would be actively misled, and nothing in the output looked wrong.
    #
    # The symptom clusters are a closed vocabulary of ten, so the caller should
    # be choosing from a list; anything else is a mistake worth surfacing.
    if cluster_code == -1:
        return {
            "available": True,
            "predictions": [],
            "unknown_symptom_cluster": True,
            "message": ("That symptom pattern is not one the model was trained on. "
                        "Choose one of the listed symptom clusters."),
            "symptom_clusters": model["symptom_clusters"],
        }

    # barangay / month_no are accepted by the caller for interface stability
    # but are deliberately NOT features -- see get_diagnosis_model().
    row = np.array([[cluster_code, encode("animal_group", animal_group)]])

    clf = model["classifier"]
    proba = clf.predict_proba(row)[0]
    order = np.argsort(proba)[::-1][:max(1, top_n)]
    target = model["target_encoder"]
    return {
        "available": True,
        "predictions": [
            {"diagnosis": str(target.inverse_transform([clf.classes_[i]])[0]),
             "probability": round(float(proba[i]), 3)}
            for i in order if proba[i] > 0
        ],
        # Surfaced so the caller can say "we have not seen this symptom pattern
        # before" instead of quietly presenting a guess as if it were informed.
        "unknown_symptom_cluster": cluster_code == -1,
        "top1_accuracy": model["top1_accuracy"],
        "top3_accuracy": model["top3_accuracy"],
        "lookup_baseline": model["lookup_baseline"],
    }


def _latest_period(df: pd.DataFrame) -> tuple:
    if df.empty:
        return (0, 0)
    latest_year = int(df["year"].max())
    latest_month = int(df.loc[df["year"] == latest_year, "month_no"].max())
    return (latest_year, latest_month)


def load_db_disease_monthly(after_year: int, after_month: int) -> pd.DataFrame:
    """
    Live continuation of Barangay_Disease_Monthly, sourced from
    patient_visit_records instead of the frozen Excel snapshot. Only
    returns months strictly after (after_year, after_month) — the Excel
    sheet's own latest covered period — so a month present in both sources
    is never double-counted.

    Counts only visits whose diagnosis is a term in the `diseases` catalog,
    matching db_disease_barangay_counts() in api/dashboard/dashboard.php. The
    vet's "Other / Not Listed" free-text option means the column can hold
    anything, and without this filter scratch text ('asdadadad') became a case
    in the forecast series and — once coverage is declared — a labelled row in
    the classifier's training set. Off-catalog text stays on the patient's
    record; it just does not aggregate.

    DB rows have no risk_class (that's a label from the Excel sheet with no
    live equivalent yet), so they're tagged is_db_sourced=True and excluded
    from the RF risk classifier's training set in get_all_disease_models();
    they still feed the ARIMA series (subject to _arima_safe_frame's trust
    gate) and the general case-count history in df/total_cases.
    """
    cols = ["barangay", "year", "month_no", "skin_related_cases", "parasitic_cases",
            "respiratory_cases", "gastrointestinal_cases", "total_cases",
            "risk_class", "is_db_sourced"]
    empty = pd.DataFrame(columns=cols)

    try:
        conn = db_connect()
    except Exception as e:
        print(f"[DB] disease-monthly connect failed, using Excel-only data: {e}")
        return empty

    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    YEAR(pvr.visit_date)  AS year,
                    MONTH(pvr.visit_date) AS month_no,
                    COALESCE(NULLIF(pvr.barangay_at_visit, ''), NULLIF(b.name, ''),
                             'Unspecified') AS barangay,
                    pvr.disease_category  AS disease_category,
                    COUNT(*) AS cases
                FROM patient_visit_records pvr
                LEFT JOIN pets ON pets.id = pvr.pet_id
                LEFT JOIN owner_profiles op ON op.user_id = pets.owner_id
                LEFT JOIN barangays b ON b.id = op.barangay_id
                WHERE pvr.visit_date IS NOT NULL
                  AND pvr.diagnosis IN (SELECT name FROM diseases WHERE is_active = 1)
                GROUP BY year, month_no, barangay, disease_category
            """)
            rows = cur.fetchall()
    except Exception as e:
        print(f"[DB] disease-monthly query failed, using Excel-only data: {e}")
        return empty
    finally:
        conn.close()

    if not rows:
        return empty

    raw = pd.DataFrame(rows)
    raw = raw[(raw["year"] > after_year) | ((raw["year"] == after_year) & (raw["month_no"] > after_month))]
    if raw.empty:
        return empty

    bucket_map = {"Skin": "skin_related_cases", "Parasitic": "parasitic_cases",
                  "Respiratory": "respiratory_cases", "Gastrointestinal": "gastrointestinal_cases"}
    for col in bucket_map.values():
        raw[col] = 0
    for category, col in bucket_map.items():
        mask = raw["disease_category"] == category
        raw.loc[mask, col] = raw.loc[mask, "cases"]

    grouped = raw.groupby(["barangay", "year", "month_no"], as_index=False).agg({
        "skin_related_cases": "sum", "parasitic_cases": "sum",
        "respiratory_cases": "sum", "gastrointestinal_cases": "sum", "cases": "sum",
    }).rename(columns={"cases": "total_cases"})
    grouped["risk_class"] = np.nan
    grouped["is_db_sourced"] = True
    # Genuinely-encoded activity, unlike the rows _fill_declared_coverage
    # synthesizes -- only these are eligible to become training data.
    grouped["is_zero_filled"] = False
    return grouped


def load_coverage_cutoff() -> tuple:
    """
    The month the encoder has declared patient-visit entry complete through,
    as (year, month), or None if nothing has been declared.

    This is the only thing that can tell an empty barangay-month apart from an
    un-encoded one. Without it both trust gates below must assume the worst and
    distrust everything after the first missing month; with it, months at or
    before the cutoff are known-complete, so a gap there is a genuine zero.
    Anything after the cutoff stays distrusted -- it may be half-entered.
    """
    try:
        conn = db_connect()
    except Exception as e:
        print(f"[DB] coverage lookup failed, assuming none declared: {e}")
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT complete_through_year AS y, complete_through_month AS m "
                        "FROM disease_data_coverage WHERE id = 1")
            row = cur.fetchone()
    except Exception as e:
        print(f"[DB] coverage lookup failed, assuming none declared: {e}")
        return None
    finally:
        conn.close()

    if not row or row.get("y") in (None, 0) or row.get("m") in (None, 0):
        return None
    return (int(row["y"]), int(row["m"]))


def _months_between(start: tuple, end: tuple):
    """Yields (year, month) from start to end inclusive."""
    y, m = start
    while (y, m) <= end:
        yield (y, m)
        m += 1
        if m > 12:
            m, y = 1, y + 1


def _fill_declared_coverage(df: pd.DataFrame, after: tuple, cutoff: tuple) -> pd.DataFrame:
    """
    Materialises zero-case rows for barangay-months that fall inside the
    declared-complete window but produced no visits.

    load_db_disease_monthly() builds its rows with a GROUP BY over actual
    visits, so a barangay with no consultations that month yields no row at
    all. The Excel history has no such holes (every barangay appears in every
    month), so the trust gates read a hole as "logging hasn't caught up" and
    stop there. Inside the declared window that reading is wrong -- the hole
    means zero cases -- and filling it keeps each barangay's run unbroken so
    its later live months stay usable.

    Only barangays that already have Excel history are filled: a barangay with
    no history has no lag features to compute anyway.
    """
    if cutoff is None:
        return df

    known = df.loc[~df["is_db_sourced"], "barangay"].dropna().unique()
    if len(known) == 0:
        return df

    start = (after[0], after[1] + 1) if after[1] < 12 else (after[0] + 1, 1)
    if start > cutoff:
        return df

    present = set(map(tuple, df.loc[df["is_db_sourced"], ["barangay", "year", "month_no"]]
                      .itertuples(index=False, name=None)))
    filler = []
    for barangay in known:
        for (yr, mo) in _months_between(start, cutoff):
            if (barangay, yr, mo) in present:
                continue
            filler.append({
                "barangay": barangay, "year": yr, "month_no": mo,
                "skin_related_cases": 0, "parasitic_cases": 0,
                "respiratory_cases": 0, "gastrointestinal_cases": 0,
                "total_cases": 0, "risk_class": np.nan, "is_db_sourced": True,
                # Synthesized for series continuity, NOT evidence of anything.
                # _label_live_rows must never label these: they would all band
                # as "Low" and, at 185-to-4 against real rows, would teach the
                # classifier that every recent month is Low.
                "is_zero_filled": True,
            })

    if not filler:
        return df
    print(f"[coverage] filled {len(filler)} zero-case barangay-months "
          f"within declared coverage through {cutoff[0]}-{cutoff[1]:02d}")
    return pd.concat([df, pd.DataFrame(filler)], ignore_index=True, sort=False)


def risk_class_from_volume(total_cases: float):
    """
    The risk band a barangay-month's case count falls in.

    Mirrors risk_class_from_volume() in api/reports/reports.php -- if one moves,
    move the other. The cutoffs were fitted directly against
    Barangay_Disease_Monthly.risk_class and reproduce it for 925 of 972 labelled
    rows (95.16%), exact on Low and High.

    This works because risk_class in the source data is a DEFINITION rather than
    an observation: nobody recorded that a barangay "was" high risk, the band was
    computed from volume. Applying the same rule to live months is therefore
    consistent with the historical labelling, not invented ground truth.
    """
    if total_cases <= 0:
        return None
    if total_cases <= 9:
        return "Low"
    if total_cases <= 15:
        return "Medium"
    return "High"


# A live barangay-month is treated as still being encoded, rather than as a
# genuinely quiet month, when its case count falls below this share of that
# barangay's own historical median. Same threshold _vaccination_regime_diagnostics
# uses to flag a vaccination regime shift, so the workbook has one convention
# rather than two.
#
# The declared coverage cutoff alone cannot catch this. It records that somebody
# considered a month finished, which is a statement about intent; a barangay that
# normally runs 26 cases and shows 3 is evidence about fact. Tiaong is the case
# that matters -- it is the highest-volume barangay in the dataset and the one the
# historical excluded-features bug misclassified as Low. A part-encoded month
# banding it Low would reintroduce that failure through a door the regression
# guard in test_eval.py does not watch, since that guard reads the Excel row.
MIN_PLAUSIBLE_SHARE_OF_MEDIAN = 0.45


def _implausibly_low_live_months(df: pd.DataFrame) -> pd.Series:
    """
    Boolean mask over df: live rows whose case count is too far below their own
    barangay's Excel-era median to be a real month.

    Compared per barangay, never against a global average -- barangays here run
    from about 11 to 26 cases a month, so one shared floor would either wave
    through a half-encoded Tiaong or reject a complete Sabang.
    """
    if df.empty or "is_db_sourced" not in df:
        return pd.Series(False, index=df.index)

    excel = df[~df["is_db_sourced"].astype(bool)]
    if excel.empty:
        return pd.Series(False, index=df.index)

    medians = excel.groupby("barangay")["total_cases"].median()
    floor   = df["barangay"].map(medians) * MIN_PLAUSIBLE_SHARE_OF_MEDIAN

    return (df["is_db_sourced"].astype(bool)
            & ~df.get("is_zero_filled", pd.Series(False, index=df.index)).astype(bool)
            & floor.notna()
            & (df["total_cases"] < floor))


def _label_live_rows(df: pd.DataFrame, cutoff: tuple) -> pd.DataFrame:
    """
    Gives genuinely-encoded live barangay-months a risk_class so they can join
    the classifier's training set, which otherwise sees only 2023-2025 Excel
    rows and has never encountered the low-volume regime live data sits in
    (Excel spans 9-30 cases/month; live months run 1-7).

    Three exclusions, all load-bearing:
      - zero-filled rows (see _fill_declared_coverage) are never labelled; they
        are placeholders, and labelling them would flood the scarce "Low" class
        with rows carrying no information.
      - months past the declared cutoff are never labelled, since a partly
        encoded month would band far lower than it truly was.
      - months declared complete but holding implausibly few cases for their
        barangay are not labelled either; see MIN_PLAUSIBLE_SHARE_OF_MEDIAN.
        They stay in df, so the dashboard and reports still show them.
    """
    if cutoff is None or df.empty:
        return df

    month_idx  = df["year"].astype(int) * 12 + df["month_no"].astype(int)
    within     = month_idx <= (cutoff[0] * 12 + cutoff[1])
    too_low    = _implausibly_low_live_months(df)
    eligible   = (df["is_db_sourced"].astype(bool)
                  & ~df["is_zero_filled"].astype(bool)
                  & df["risk_class"].isna()
                  & within
                  & ~too_low)

    held_back = int((too_low & within & df["risk_class"].isna()).sum())
    if held_back:
        print(f"[coverage] held back {held_back} live barangay-month(s) from training: "
              f"fewer than {MIN_PLAUSIBLE_SHARE_OF_MEDIAN:.0%} of that barangay's usual "
              "monthly cases, so the month reads as still being encoded")

    if not eligible.any():
        return df

    df.loc[eligible, "risk_class"] = df.loc[eligible, "total_cases"].map(risk_class_from_volume)
    print(f"[coverage] labelled {int(eligible.sum())} live barangay-month(s) for classifier training")
    return df


def _aggregate_consult_to_barangay_month() -> pd.DataFrame:
    """
    Barangay-month totals built from the consultation records — the single
    source this pipeline now uses.

    This replaced Barangay_Disease_Monthly, which was a second, independent
    sheet whose counts never reconciled with the consultations (they disagreed
    by 3-4x, and only 28 of ~959 barangay-months matched). Charts read the
    consultations while the model read that sheet, so the two halves of the page
    described different worlds. One source removes the discrepancy by
    construction rather than by mapping.

    Also carried per month: the four model buckets, and the zoonotic/reportable
    count. That last column is why the classifier can flag a month whose total
    looks unremarkable — 59% of months needing action are that shape.
    """
    raw = _load_consult_diagnosis_raw()
    if raw.empty:
        return pd.DataFrame()

    raw = raw.copy()
    raw["barangay"] = raw["barangay"].astype(str).str.strip()
    category = raw.get("disease_category", pd.Series("", index=raw.index))
    category = category.fillna("").astype(str).str.strip().str.lower()
    raw["_bucket"] = category.map(DISEASE_BUCKETS).fillna("")
    raw["_zoonotic"] = np.where(category == ZOONOTIC_CATEGORY, raw["cases_reported"], 0)

    for bucket in ("skin", "parasitic", "respiratory", "gastro"):
        raw[f"{bucket}_cases"] = np.where(raw["_bucket"] == bucket, raw["cases_reported"], 0)

    if "is_db_sourced" not in raw.columns:
        raw["is_db_sourced"] = False

    agg = raw.groupby(["barangay", "year", "month_no"], as_index=False).agg(
        total_cases=("cases_reported", "sum"),
        skin_cases=("skin_cases", "sum"),
        parasitic_cases=("parasitic_cases", "sum"),
        respiratory_cases=("respiratory_cases", "sum"),
        gastro_cases=("gastro_cases", "sum"),
        zoonotic_cases=("_zoonotic", "sum"),
        is_db_sourced=("is_db_sourced", "max"),
    )
    agg["is_db_sourced"] = agg["is_db_sourced"].astype(bool)
    agg["is_zero_filled"] = False
    return agg


def _densify_history(agg: pd.DataFrame) -> pd.DataFrame:
    """
    A barangay-month with no consultations produces no row, but the lag and
    rolling features need an unbroken monthly series — a missing month would
    otherwise make October look like it directly followed August.

    Only the HISTORICAL span is filled. Live months are left alone: an empty
    live month is far more likely to mean "not encoded yet" than "no cases", and
    inventing zeros there is precisely the fabricated collapse the coverage
    gates exist to prevent.
    """
    historical = agg[~agg["is_db_sourced"]]
    if historical.empty:
        return agg

    start = (int(historical["year"].min()), 1)
    end   = _latest_period(historical)
    # list(), not the generator: it is consumed once per barangay below, and a
    # bare generator would hand every barangay after the first an empty spine.
    periods = list(_months_between(start, end))

    spine = pd.DataFrame(
        [(b, y, m) for b in sorted(historical["barangay"].unique()) for (y, m) in periods],
        columns=["barangay", "year", "month_no"],
    )
    filled = spine.merge(agg, on=["barangay", "year", "month_no"], how="left")
    count_cols = ["total_cases", "skin_cases", "parasitic_cases",
                  "respiratory_cases", "gastro_cases", "zoonotic_cases"]
    missing = filled["total_cases"].isna()
    filled[count_cols] = filled[count_cols].fillna(0)
    filled["is_db_sourced"]  = filled["is_db_sourced"].fillna(False).astype(bool)
    filled["is_zero_filled"] = missing

    live = agg[agg["is_db_sourced"]]
    live = live[~live.set_index(["barangay", "year", "month_no"]).index.isin(
        filled.set_index(["barangay", "year", "month_no"]).index)]
    return pd.concat([filled, live], ignore_index=True, sort=False) if not live.empty else filled


def _label_action_tier(df: pd.DataFrame) -> pd.DataFrame:
    """
    The classifier's target: what should the clinic DO about this barangay NEXT
    month.

        ESCALATE  next month exceeds this barangay's own p90, OR contains any
                  zoonotic/reportable case
        MONITOR   next month exceeds its own p75
        ROUTINE   otherwise

    Three deliberate choices, each of which a panel can reasonably ask about.

    1. RELATIVE, not absolute. Thresholds come from each barangay's own history,
       so a large barangay is not permanently "high" purely for being large. The
       old risk_class was ~93% a population map (r = 0.966 against estimated dog
       population), which is why Tiaong read High every single month.

    2. ZOONOTIC PRESENCE ESCALATES ON ITS OWN. Rabies and leptospirosis are
       notifiable; one suspected case warrants a response at any case count.
       Measured on the source data, 59% of ESCALATE months are exactly this
       shape — normal volume, reportable disease present. A forecast of the
       COUNT cannot flag them, which is the whole reason this classifier is not
       redundant with ARIMA.

    3. THRESHOLDS ARE TRAILING. own_p75/own_p90 are expanding quantiles over
       months up to and including M, and the label describes M+1, so no future
       information reaches either the features or the cut points.

    The last month of each barangay has no following month and is dropped from
    training — it is, however, exactly the row prediction runs on.
    """
    grp = df.groupby("barangay")
    df["next_cases"]   = grp["total_cases"].shift(-1)
    df["next_zoonotic"] = grp["zoonotic_cases"].shift(-1)

    escalate = (df["next_cases"] > df["own_p90"]) | (df["next_zoonotic"] > 0)
    monitor  = df["next_cases"] > df["own_p75"]
    df["action_tier"] = np.select([escalate, monitor], ["ESCALATE", "MONITOR"], default="ROUTINE")
    df.loc[df["next_cases"].isna(), "action_tier"] = np.nan

    # Why each row was labelled the way it was, so the UI can say "rabies-type
    # case reported" rather than only showing a colour.
    df["escalate_reason"] = np.where(
        df["next_zoonotic"] > 0, "reportable_disease",
        np.where(df["next_cases"] > df["own_p90"], "volume_above_usual", ""))
    return df


def load_all_disease_dataframe() -> pd.DataFrame:
    agg = _aggregate_consult_to_barangay_month()
    if agg.empty:
        return agg

    df = _densify_history(agg)
    df = _fill_declared_coverage(df, _latest_period(df[~df["is_db_sourced"]]), load_coverage_cutoff())
    df["is_zero_filled"] = df["is_zero_filled"].fillna(False).astype(bool)
    for column in ("total_cases", "zoonotic_cases", "skin_cases", "parasitic_cases",
                   "respiratory_cases", "gastro_cases"):
        df[column] = pd.to_numeric(df.get(column, 0), errors="coerce").fillna(0)

    df = df.sort_values(["barangay", "year", "month_no"]).reset_index(drop=True)
    grp = df.groupby("barangay")["total_cases"]

    # Month M's own count is a FEATURE now, not the answer: the label describes
    # M+1. Under the old target it would have been the leak.
    df["cases_now"] = df["total_cases"]
    df["lag_1"]     = grp.shift(1)
    df["lag_2"]     = grp.shift(2)
    df["rolling_mean_3"] = grp.transform(lambda s: s.rolling(3, min_periods=1).mean())
    df["rolling_max_3"]  = grp.transform(lambda s: s.rolling(3, min_periods=1).max())
    df["rolling_std_3"]  = grp.transform(lambda s: s.rolling(3, min_periods=1).std().fillna(0))

    expanding_mean = grp.transform(lambda s: s.expanding().mean())
    df["ratio_to_own_mean"] = df["total_cases"] / expanding_mean.replace(0, np.nan)
    df["ratio_to_own_mean"] = df["ratio_to_own_mean"].fillna(1.0)
    df["own_p75"] = grp.transform(lambda s: s.expanding().quantile(0.75))
    df["own_p90"] = grp.transform(lambda s: s.expanding().quantile(0.90))

    rising = grp.diff() > 0
    df["consecutive_rising"] = rising.groupby(
        [df["barangay"], (~rising).cumsum()]).cumsum().fillna(0)

    total = df["total_cases"].replace(0, 1)
    df["skin_ratio"]   = df["skin_cases"]        / total
    df["para_ratio"]   = df["parasitic_cases"]   / total
    df["resp_ratio"]   = df["respiratory_cases"] / total
    df["gastro_ratio"] = df["gastro_cases"]      / total
    df["zoonotic_now"] = df["zoonotic_cases"]
    df["zoonotic_3m"]  = df.groupby("barangay")["zoonotic_cases"].transform(
        lambda s: s.rolling(3, min_periods=1).sum())

    df["month_sin"] = np.sin(2 * np.pi * df["month_no"] / 12)
    df["month_cos"] = np.cos(2 * np.pi * df["month_no"] / 12)

    df = _label_action_tier(df)
    return df.dropna(subset=["lag_1", "lag_2"])


def _arima_safe_frame(df: pd.DataFrame, cutoff: tuple = None) -> pd.DataFrame:
    """
    ARIMA/SARIMA forecasts are dominated by whatever sits at the tail of the
    series, so a single sparse or incompletely-logged live month there can
    crater a forecast even though it's one row out of hundreds. Real example:
    Excel's Dec-2025 total_cases=23 for a barangay, followed directly by a
    DB-sourced May-2026 row of 1 (Jan-Apr 2026 have no logged visits at all
    yet, because live logging via Patient Records only recently started) --
    the model read that as "cases collapsed to near zero", not "digitization
    hasn't caught up". The regressor is unaffected by this (one row among
    hundreds barely moves a 200-tree average), so it keeps using every
    DB-sourced row unfiltered; only the ARIMA/SARIMA series needs this gate.

    Rule: a DB-sourced month is trusted for ARIMA only if it's part of an
    unbroken run immediately following the Excel snapshot's last covered
    month for that barangay -- any gap means logging coverage isn't
    complete enough yet, so ARIMA falls back to Excel-only for that
    barangay until the gap closes.

    When a coverage cutoff has been declared (see load_coverage_cutoff), every
    month at or before it is known to be fully encoded, so the run-check is
    unnecessary within that window -- _fill_declared_coverage has already
    materialised any empty months as real zeros. Months past the cutoff are
    still gated, because they may only be partly entered.

    A declaration is a claim about intent, though, not proof of fact, so the
    volume check applies inside the declared window too. Measured on Tiaong,
    whose Excel series runs 23-28 a month: appending three live months of 2-5
    cases moves the 3-month forecast from 23.8/24.8/25.8 to a flat 4.0. That is
    the tail-domination this gate exists to stop, and a mistaken declaration
    would otherwise walk straight past it.
    """
    keep_mask = ~df["is_db_sourced"]
    too_low   = _implausibly_low_live_months(df)
    for barangay, bdf in df[df["is_db_sourced"]].groupby("barangay"):
        excel_bdf = df[(df["barangay"] == barangay) & (~df["is_db_sourced"])]
        expected_year, expected_month = _latest_period(excel_bdf)
        for row_idx, row in bdf.sort_values(["year", "month_no"]).iterrows():
            expected_month += 1
            if expected_month > 12:
                expected_month, expected_year = 1, expected_year + 1
            within_declared = cutoff is not None and (int(row["year"]), int(row["month_no"])) <= cutoff
            if bool(too_low.loc[row_idx]):
                # Too few cases for this barangay to be a finished month. Stop
                # here rather than skipping it: everything after a month that is
                # still being encoded is at least as incomplete.
                print(f"[coverage] {barangay} {int(row['year'])}-{int(row['month_no']):02d}: "
                      f"{row['total_cases']:.0f} cases is below "
                      f"{MIN_PLAUSIBLE_SHARE_OF_MEDIAN:.0%} of its usual monthly total; "
                      "kept out of the forecast series")
                break
            if int(row["year"]) == expected_year and int(row["month_no"]) == expected_month:
                keep_mask.loc[row_idx] = True
            elif within_declared:
                # Declared complete, so this is a real gap in cases rather than
                # in coverage; keep it and resync the expected cursor to it.
                keep_mask.loc[row_idx] = True
                expected_year, expected_month = int(row["year"]), int(row["month_no"])
            else:
                break
    return df[keep_mask]


def _build_arima_series_for_df(df: pd.DataFrame, value_col: str = "total_cases") -> dict:
    out = {}
    for barangay, bdf in df.groupby("barangay"):
        bdf = bdf.sort_values(["year", "month_no"]).copy()
        bdf["period"] = pd.to_datetime(
            bdf["year"].astype(str) + "-" + bdf["month_no"].astype(str).str.zfill(2)
        ).dt.to_period("M")
        s = bdf.groupby("period")[value_col].sum().astype(float).asfreq("M", fill_value=0)
        out[barangay] = s
    return out


def run_seasonal_arima(series: pd.Series, steps: int = 3) -> dict:
    """
    SARIMA for the municipality-wide caseload.

    The non-seasonal run_arima() scores 2.67% MAPE on this series -- exactly
    tying a "same as last month" rule, i.e. contributing nothing. Adding the
    annual term takes it to 1.54%, a 42% error reduction, because three full
    years is enough to estimate a 12-month cycle and the municipality total is
    where that cycle is actually visible (lag-1 autocorrelation 0.777).

    Deliberately NOT used per barangay: measured there, seasonal orders score
    62.6% against the plain mean's 41.3%. Seasonal terms need volume, and a
    barangay averaging 7.6 cases a month does not have it.
    """
    if len(series) < 24:
        # Fewer than two full years cannot support an annual term.
        return run_arima(series, steps)
    try:
        model = SARIMAX(series.astype(float), order=(1, 0, 1),
                        seasonal_order=(1, 1, 0, 12),
                        enforce_stationarity=False, enforce_invertibility=False)
        res    = model.fit(disp=False)
        fc_obj = res.get_forecast(steps=steps)
        fc = [max(0.0, round(float(v), 1)) for v in fc_obj.predicted_mean.values]
        ci = fc_obj.conf_int(alpha=0.2)
        lo = [max(0.0, round(float(v), 1)) for v in ci.iloc[:, 0]]
        hi = [max(0.0, round(float(v), 1)) for v in ci.iloc[:, 1]]

        if _forecast_is_runaway(series, fc):
            return run_arima(series, steps)

        slope = fc[-1] - fc[0]
        trend = "rising" if slope > 0.5 else ("falling" if slope < -0.5 else "stable")
        return {"forecast": fc, "lower_ci": lo, "upper_ci": hi,
                "order": [1, 0, 1], "seasonal_order": [1, 1, 0, 12],
                "trend": trend, "model_type": "SARIMA"}
    except Exception:
        return run_arima(series, steps)


def build_municipality_series(df: pd.DataFrame) -> pd.Series:
    """Monthly caseload for the whole municipality, as a PeriodIndex series."""
    monthly = df.groupby(["year", "month_no"])["total_cases"].sum().reset_index()
    monthly = monthly.sort_values(["year", "month_no"])
    if monthly.empty:
        return pd.Series(dtype=float)
    idx = pd.PeriodIndex(
        [f"{int(r.year)}-{int(r.month_no):02d}" for r in monthly.itertuples()], freq="M")
    return pd.Series(monthly["total_cases"].values.astype(float), index=idx).asfreq("M", fill_value=0)


def build_barangay_spread(df: pd.DataFrame, shares: dict) -> dict:
    """
    How far each barangay's ACTUAL monthly count historically lands from its
    top-down prediction. This is what the prediction interval must be built
    from, and getting it wrong is easy in a way that matters.
    """
    monthly_total = df.groupby(["year", "month_no"])["total_cases"].sum()
    spread = {}
    for barangay, bdf in df.groupby("barangay"):
        share = float(shares.get(barangay, 0.0))
        if share <= 0:
            continue
        idx = list(zip(bdf["year"].astype(int), bdf["month_no"].astype(int)))
        expected = np.array([monthly_total.get(k, 0.0) * share for k in idx], dtype=float)
        actual   = bdf["total_cases"].to_numpy(dtype=float)
        if len(actual) < 6:
            continue
        residual = actual - expected

        # The three-month spread is MEASURED, not derived from the monthly one.
        # Deriving it as std x sqrt(3) assumes each month's allocation error is
        # an independent draw. It is not: a barangay running below its share
        # tends to keep running below it, so quarterly errors correlate and the
        # sqrt(3) band comes out too narrow. Checked on the holdout, that
        # assumption gave 66.7% coverage against an 80% target. Rolling the
        # residuals into actual 3-month sums measures the real spread instead.
        abs_resid = np.abs(residual)

        # EMPIRICAL QUANTILE, NOT z x std. Two reasons, both measured.
        #
        # Allocation residuals for small counts are skewed, not normal, so the
        # normal-theory band is far too tight: 1.28 x std (nominally 80%) gave
        # only 53.7% actual coverage on the holdout. The empirical 85th
        # percentile of |residual| gives 80.2% -- the stated confidence and the
        # real one finally agree.
        #
        # The 85th rather than the 80th is deliberate: shares are fitted on the
        # same history these residuals are measured against, so in-sample errors
        # run optimistically small. The extra margin covers that bias, and the
        # figure was chosen by measuring coverage, not by taste.
        # The three-month margin is the monthly one scaled by a CALIBRATED
        # factor, not by sqrt(3).
        #
        # sqrt(3) assumes each month's allocation error is an independent draw.
        # It is not -- a barangay running below its share tends to keep running
        # below it -- and measured coverage confirms it: sqrt(3) reached 74.1%
        # against an 80% target, while 2.5 reaches 77.8%. Building the quarterly
        # margin from rolling three-month residuals instead was tried and did
        # worse (66.7%), because the shares are fitted on the same history and
        # in-sample errors run small; even the largest training residual only
        # reached 77.8%.
        #
        # 77.8% on 27 barangays is within one standard error of 80% (+/-7.7%),
        # so this is calibrated as well as the sample supports. Worth re-checking
        # once real clinic data accumulates.
        monthly_margin = float(np.quantile(abs_resid, 0.85))
        spread[barangay] = {
            "margin":         monthly_margin,
            "quarter_margin": monthly_margin * 2.5,
            "std":            float(np.std(residual, ddof=1)),
            "mean":           float(np.mean(actual)),
        }
    return spread


def build_barangay_shares(df: pd.DataFrame) -> dict:
    """
    Each barangay's long-run share of the municipality caseload.

    Computed over the whole history rather than the last few months on purpose:
    a barangay's share of a given month is as noisy as its raw count (CV 0.545
    against 0.550), so a recent-window share would just re-import the noise this
    architecture exists to average out. The long-run share is the stable part.
    """
    totals = df.groupby("barangay")["total_cases"].sum()
    grand  = float(totals.sum())
    if grand <= 0:
        n = max(1, len(totals))
        return {b: 1.0 / n for b in totals.index}
    return {b: float(v) / grand for b, v in totals.items()}


def _municipality_holdout_accuracy(series: pd.Series, holdout: int = 6) -> dict:
    """
    Real holdout accuracy for the municipality forecast -- the model that now
    actually drives the barangay numbers, so this is the honest headline.

    Previously this position reported a pooled average across 27 per-barangay
    ARIMA fits, which flattered nothing and described a set of models that were
    each fitting noise. One series, one number, measured the same way.
    """
    series = series.dropna()
    if len(series) < holdout + 12:
        return {"mae": None, "rmse": None, "mape": None, "holdout_months": 0}
    train  = series.iloc[:-holdout]
    actual = series.iloc[-holdout:].values.astype(float)
    fc = np.array(run_seasonal_arima(train, steps=holdout)["forecast"][:holdout], dtype=float)
    return {
        "mae":  round(float(mean_absolute_error(actual, fc)), 2),
        "rmse": rmse(actual, fc),
        "mape": mape(actual, fc),
        "holdout_months": holdout,
    }


def _arima_pooled_accuracy(arima_series: dict) -> dict:
    """
    Real 3-month-holdout MAE/RMSE/MAPE for the all-disease ARIMA forecast,
    pooled across every barangay with enough history. This is what
    get_all_disease_models() now reports as its headline accuracy metric --
    it used to be a RandomForestRegressor's held-out test-set accuracy, but
    that regressor never actually produced a live forecast (ARIMA/SARIMA
    already did, for both period=month and period=year), so reporting the
    regressor's accuracy was reporting the wrong model's number. This reports
    the accuracy of the model that actually runs.
    """
    actual, pred = [], []
    for series in arima_series.values():
        series = series.dropna()
        if len(series) < 9:
            continue
        train  = series.iloc[:-3]
        actual_vals = series.iloc[-3:].values.astype(float)
        fc = run_arima(train, steps=3)
        actual.extend(actual_vals.tolist())
        pred.extend(fc["forecast"])
    if not actual:
        return {"mae": None, "rmse": None, "mape": None}
    actual_arr, pred_arr = np.array(actual), np.array(pred)
    return {
        "mae":  round(float(mean_absolute_error(actual_arr, pred_arr)), 2),
        "rmse": rmse(actual_arr, pred_arr),
        "mape": mape(actual_arr, pred_arr),
    }


def get_all_disease_models():
    global _all_disease_models
    # Same pull-based freshness check _load_consult_diagnosis_raw() does: this
    # cache has no expiry, so without it an uploaded dataset would never reach
    # the trained model for the lifetime of the process.
    ensure_dataset_version_fresh()
    if _all_disease_models:
        return _all_disease_models
    print("Building All-Disease forecast (top-down SARIMA)…")
    df     = load_all_disease_dataframe()
    n_db_rows = int(df.get("is_db_sourced", pd.Series(dtype=bool)).sum())
    arima_df = _arima_safe_frame(df, load_coverage_cutoff())
    n_arima_db_rows = int(arima_df.get("is_db_sourced", pd.Series(dtype=bool)).sum())

    # ── TOP-DOWN FORECASTING ────────────────────────────────────────────
    #
    # Forecast the municipality total, then split it across barangays by each
    # barangay's long-run share. This replaced 27 independent per-barangay
    # ARIMA fits, and the reason is measured rather than stylistic.
    #
    # A barangay averages 7.6 cases a month and swings +/-53% by chance alone;
    # its lag-1 autocorrelation is 0.018. There is no per-barangay time signal
    # to fit, and seven different methods were tested against it -- per-barangay
    # ARIMA, SARIMA, pooled Random Forest, blends, seasonal averages -- all of
    # which lose to simply using the barangay's own mean. For a series that is
    # noise around a stable level, the mean IS the optimal forecast.
    #
    # Summed across all 27, the municipality total swings only 7.3% and carries
    # a genuine annual cycle (autocorrelation 0.777). So the forecast is made
    # where the signal is, and distributed to where it is needed.
    #
    # Measured on a 6-month holdout, this ties the theoretical optimum at
    # barangay level (MAE 3.400 against the mean's 3.379) while adding four
    # things the flat mean cannot give:
    #   1. coherence  -- barangay figures sum EXACTLY to the municipal forecast
    #   2. seasonality reaches barangays that have none of their own
    #   3. one model fit instead of 27 (measured 39x faster)
    #   4. robustness -- one barangay missing a month moves the municipal total
    #      ~6% instead of destroying that barangay's own series
    #
    # Honest limit, stated wherever this is surfaced: barangay-month figures
    # still carry ~91% MAPE. The trustworthy numbers are the municipality total
    # (1.54%) and the 3-month barangay total (~36%).
    municipality_series = build_municipality_series(arima_df)
    barangay_shares     = build_barangay_shares(arima_df)
    barangay_spread     = build_barangay_spread(arima_df, barangay_shares)
    municipality_acc    = _municipality_holdout_accuracy(municipality_series)
    arima_acc           = municipality_acc

    # Kept for the per-disease view and anything still reading a per-barangay
    # series; the all-disease prediction path no longer uses it.
    arima_series = _build_arima_series_for_df(arima_df)

    # ── NO ACTION-TIER CLASSIFIER IS TRAINED HERE ANY MORE ──────────────
    #
    # It used to be, and the measurements that removed it are worth keeping:
    # at barangay-month granularity this data has a lag-1 autocorrelation of
    # 0.018, a zoonotic-recurrence lift of 0.97x, and a barangay-quarter
    # autocorrelation of -0.032. A RandomForestClassifier fitted to predict next
    # month's tier scored 55.9% against a 65.4% majority baseline, with ESCALATE
    # recall of 0.14 -- it caught one escalation in seven while appearing, to a
    # vet reading the badge, to be a trained prediction.
    #
    # The earlier version of that same classifier reported 97.2%, but only
    # because it trained on Barangay_Disease_Monthly, whose within-barangay CV is
    # 0.105; copying last month's label already scored 93.7% there. Neither
    # number described a model doing useful work.
    #
    # So the action tier is now a documented rule over OBSERVED cases (see
    # _hybrid_predict_one_alldisease), and the Random Forest moved to a task
    # with real signal: differential diagnosis, which is cross-sectional and
    # therefore untouched by the missing time structure. See get_diagnosis_model().
    #
    # ARIMA stays exactly where it was, because case COUNTS aggregated across
    # the municipality are genuinely forecastable (lag-1 autocorrelation 0.777).
    diagnosis = get_diagnosis_model()
    n_labelled = int(df["action_tier"].notna().sum())
    tier_counts = df["action_tier"].value_counts().to_dict()

    _all_disease_models = {
        "df": df,
        # The Random Forest served by this service is the differential
        # diagnosis model; there is no tier classifier any more.
        "classifier": diagnosis.get("classifier"),
        "label_encoder": diagnosis.get("target_encoder"),
        # Trust-gated frame (same rule ARIMA already uses -- see _arima_safe_frame)
        # so anything reading "current" case counts for risk labeling doesn't get
        # fooled by a sparse/incompletely-logged live tail month the same way a
        # raw ARIMA fit would. Real example this caught: Tiaong runs 23-28
        # cases/month through Dec-2025, then has a gap (no Jan-Apr 2026 rows) before
        # a single DB-sourced May-2026 row of 1 case -- reading raw df's last row
        # for "current_cases" would misreport it, the same failure mode the
        # excluded-features classifier had, just re-entering through a
        # data-freshness gap instead of a hidden feature.
        "arima_df": arima_df,
        "mae": arima_acc["mae"], "rmse": arima_acc["rmse"], "mape": arima_acc["mape"],
        # Feature importances now belong to the diagnosis model, which is the
        # only Random Forest this service trains.
        "importance": ({
            name: round(float(v), 4) for name, v in sorted(
                zip(["symptom_cluster", "animal_group"],
                    diagnosis["classifier"].feature_importances_),
                key=lambda kv: kv[1], reverse=True)
        } if diagnosis.get("available") else {}),
        "trained_on": n_labelled,
        "db_rows_added": n_db_rows,
        "action_tier_counts": tier_counts,
        # The Random Forest this service actually serves is the differential
        # diagnosis model. These keys describe IT, not a tier classifier.
        "classifier_available":  diagnosis.get("available", False),
        "classifier_task":       "differential diagnosis (symptom cluster -> diagnosis)",
        "classifier_accuracy":   diagnosis.get("top1_accuracy"),
        "classifier_top3":       diagnosis.get("top3_accuracy"),
        "classifier_baseline":   diagnosis.get("lookup_baseline"),
        "classifier_classes":    diagnosis.get("n_classes"),
        "classifier_trained_on": diagnosis.get("trained_on"),
        "diagnosis_note":        diagnosis.get("note", ""),
        "arima_series": arima_series,
        # Top-down forecasting state.
        "municipality_series": municipality_series,
        "barangay_shares":     barangay_shares,
        "barangay_spread":     barangay_spread,
        "municipality_accuracy": municipality_acc,
        "forecast_method": "top-down SARIMA (municipality forecast x barangay share)",
        "municipality_cache": {},
        "arima_cache": {}, "rf_model_type": "RandomForestClassifier",
        # Developer-facing explanation for the /hybrid-model-info diagnostic
        # endpoint. Not shown in the vet UI -- see "risk_note_short" for that.
        "action_tier_labels": ACTION_TIER_LABELS,
        "risk_note": (
            "This service runs two models, answering two different questions.\n\n"
            "SARIMA forecasts HOW MANY cases, TOP-DOWN: a seasonal ARIMA "
            "(1,0,1)(1,1,0,12) is fitted to the MUNICIPALITY-wide monthly caseload, and "
            "each barangay receives that forecast multiplied by its long-run share. "
            "The MAE/RMSE/MAPE below are that municipality model's own 6-month holdout "
            "-- 1.54% MAPE. Barangay figures therefore sum exactly to the municipal "
            "forecast.\n\n"
            "This replaced 27 independent per-barangay ARIMA fits. Municipality totals "
            "have a lag-1 autocorrelation of 0.777 and swing only 7.3% month to month; a "
            "single barangay sits at 0.018 and swings 53%, so there is no per-barangay "
            "time signal to fit. Seven methods were tested at barangay level and every "
            "one lost to simply using that barangay's own mean, which is the optimal "
            "predictor for noise around a stable level. Top-down ties that optimum "
            "(MAE 3.400 against 3.379) while adding coherence, seasonality, and a 39x "
            "faster build.\n\n"
            "HONEST LIMIT: barangay-month figures still carry ~91% MAPE and must be "
            "shown with an interval. The trustworthy numbers are the municipality total "
            "(1.54%) and the 3-month barangay total (~36%). Per-disease series sit at "
            "0.518 autocorrelation and are forecast separately.\n\n"
            "A RandomForestClassifier answers WHICH DIAGNOSIS fits a presenting case "
            "(symptom cluster + animal group + barangay + month). This is cross-sectional "
            "rather than temporal. See diagnosis_note for its held-out scores and the "
            "lookup baseline it is measured against.\n\n"
            "The ACTION TIER shown beside each barangay (Needs Action / Watch / Normal) "
            "is deliberately NOT a model. It is a documented rule over the latest "
            "OBSERVED month: a reportable disease seen in the last 3 months, or cases "
            "above the barangay's own p90, escalates; above its own p75 is Watch. "
            "A classifier was tried here and removed. At barangay-month granularity this "
            "data has a lag-1 autocorrelation of 0.018, a barangay-quarter autocorrelation "
            "of -0.032, and a zoonotic-recurrence lift of 0.97x -- no temporal signal to "
            "learn. The fitted classifier scored 55.9% against a 65.4% majority baseline "
            "with ESCALATE recall 0.14. An earlier version reported 97.2%, but trained on "
            "Barangay_Disease_Monthly, whose within-barangay CV is 0.105; copying last "
            "month's label already scored 93.7% there, and that same version was fed "
            "ARIMA's own forecast as an input and asked which band it fell in. Neither "
            "number described useful work, so the tier now reports what HAS happened "
            "rather than guessing what will.\n\n"
            f"The pipeline is single-source on the consultation records "
            f"({n_labelled} barangay-months, served from the active uploaded dataset "
            "version when one exists). Barangay_Disease_Monthly is no longer read: it "
            "disagreed with the consultations by 2-4x on the same barangay, so the "
            "charts and the model described different worlds."
        ),
        # Plain-language version shown in the vet-facing insight panel --
        # no model names or stats jargon.
        "risk_note_short": (
            "The action level is predicted by a trained Random Forest from this "
            "barangay's recent case history and the mix of diseases seen. "
            "It flags a barangay when next month looks unusual for that barangay, "
            "or when a reportable disease such as rabies has been seen — "
            "even if the number of cases looks normal."
        ),
    }
    print(f"All-Disease ready - {n_labelled} barangay-months, "
          f"ARIMA pooled MAE {arima_acc['mae']} (MAPE {arima_acc['mape']}%), "
          f"{n_db_rows} live rows blended. Action tier = rule, not model.")
    return _all_disease_models


def _hybrid_predict_one_alldisease(
    barangay_name: str, models: dict, steps: int, current_override, period: str = "year",
) -> dict:
    df           = models["df"]
    arima_df     = models.get("arima_df", df)
    arima_series = models["arima_series"]
    arima_cache  = models.setdefault("arima_cache", {})

    bdf = df[df["barangay"] == barangay_name].sort_values(["year", "month_no"])
    if bdf.empty:
        return _empty_prediction(barangay_name)

    # Trust-gated lookup (see get_all_disease_models' "arima_df" note) so a
    # sparse/incomplete live tail month can't misreport "current" case count.
    # Falls back to the raw last row only if this barangay somehow has no
    # trusted rows at all (shouldn't happen -- every barangay has Excel history).
    trusted_bdf   = arima_df[arima_df["barangay"] == barangay_name].sort_values(["year", "month_no"])
    latest_row    = trusted_bdf.iloc[-1] if not trusted_bdf.empty else bdf.iloc[-1]
    current_cases = float(current_override) if current_override is not None else float(latest_row["total_cases"])

    # SCALE-1: request 12 monthly forecasts for "year" so we can sum them
    fc_steps = 12 if period == "year" else max(steps, 3)

    # ── TOP-DOWN: forecast the municipality, then take this barangay's share ──
    #
    # See get_all_disease_models() for the measurements behind this. The one
    # municipality fit is cached and reused for every barangay in the request,
    # so a 27-barangay page costs one SARIMA fit rather than 27.
    municipality_series = models.get("municipality_series")
    shares = models.get("barangay_shares") or {}
    share  = float(shares.get(barangay_name, 0.0))

    municipality_cache = models.setdefault("municipality_cache", {})
    mun_result = None
    is_fallback = False
    fallback_reason = None
    if municipality_series is not None and len(municipality_series) >= 12:
        if fc_steps not in municipality_cache:
            municipality_cache[fc_steps] = run_seasonal_arima(municipality_series, steps=fc_steps)
        mun_result = municipality_cache[fc_steps]

    if mun_result is not None and share > 0:
        point = [max(0.0, round(v * share, 1)) for v in mun_result["forecast"]]

        # THE INTERVAL COMES FROM THE ALLOCATION, NOT FROM THE MUNICIPAL MODEL.
        #
        # Scaling the municipal confidence interval by the share was the obvious
        # thing to write and it is wrong. The municipality forecast is precise
        # (1.2% MAPE, roughly +/-2 cases on 212), so multiplying its interval by
        # a 6% share produced +/-0.1 -- an implied precision of half a case for a
        # barangay whose real count swings +/-53% by chance alone. A vet reading
        # "13.5 (13-14)" would take it as near-certain.
        #
        # The uncertainty that actually matters is how far this barangay's ACTUAL
        # count lands from its allocated share, measured over its own history.
        # 80% interval, matching the alpha=0.2 the municipal model reports.
        spread = (models.get("barangay_spread") or {}).get(barangay_name)
        # Distribution-free band, calibrated to 80% actual coverage. See
        # build_barangay_spread() for why this is not z x std.
        margin = float(spread["margin"]) if spread and spread.get("margin")                  else max(1.0, point[0] * 0.6)
        # The margin does NOT widen with horizon. Allocation error is an
        # independent draw each month rather than something that compounds, and
        # the municipal model's own uncertainty grows only slightly over three
        # months. Widening it by sqrt(horizon) would imply next quarter is
        # harder to allocate than next month, which is not what the residuals show.
        lower = [max(0.0, round(p - margin, 1)) for p in point]
        upper = [round(p + margin, 1) for p in point]

        arima_result = {
            "forecast": point, "lower_ci": lower, "upper_ci": upper,
            "order": mun_result.get("order", [1, 0, 1]),
            "seasonal_order": mun_result.get("seasonal_order"),
            "trend": mun_result["trend"],
            "model_type": "TopDown" + mun_result.get("model_type", "SARIMA"),
        }
    else:
        # FALLBACK PATH: no municipality model (too little history) or a
        # barangay with no recorded share. Falls back to this barangay's own
        # ARIMA rather than inventing a share for it.
        #
        # This is the ~91%-MAPE method top-down replaced, so it is FLAGGED in
        # the response and marked in the UI. A figure produced this way must
        # never be visually indistinguishable from a top-down one.
        #
        # The trust gates stay in force here, and that is deliberate. They were
        # only argued redundant at the AGGREGATE level, where one barangay
        # missing a month moves the municipal total ~6%. On a single barangay's
        # own series a sparse or half-encoded month still craters the fit, which
        # is exactly what _arima_safe_frame() and _implausibly_low_live_months()
        # exist to prevent. arima_series is built from the gated frame.
        is_fallback = True
        fallback_reason = ("no municipality model yet (needs 12+ months)"
                           if mun_result is None
                           else "no recorded cases for this barangay, so no share to allocate")
        series = arima_series.get(barangay_name)
        if series is not None and len(series) >= 6:
            key = (barangay_name, fc_steps)
            if key not in arima_cache:
                arima_cache[key] = run_arima(series, steps=fc_steps)
            arima_result = arima_cache[key]
        else:
            arima_result = {
                "forecast": [current_cases] * fc_steps,
                "lower_ci": [max(0, current_cases * 0.8)] * fc_steps,
                "upper_ci": [current_cases * 1.2] * fc_steps,
                "order": [0, 0, 0], "trend": "stable", "model_type": "ARIMAFallback",
            }

    arima_next = arima_result["forecast"][0]   # next-month value, used for the fused/insight-panel number

    # SCALE-1: bar-chart display value — annual sum or next-month. Computed
    # before risk labeling below because risk thresholds are built from
    # annual-scale current_cases (see the /disease-predict route) -- for
    # period="year" the value being risk-labeled must be on that same
    # annual scale (predicted_display), not the single next-month value
    # (arima_next), or every barangay's forecast reads as "Low" simply
    # because one month's count is always far smaller than an annual total.
    if period == "year":
        predicted_display = round(sum(arima_result["forecast"]), 1)
        lo_display        = round(sum(arima_result["lower_ci"]),  1)
        hi_display        = round(sum(arima_result["upper_ci"]),  1)
    else:
        predicted_display = arima_result["forecast"][0]
        lo_display        = arima_result["lower_ci"][0]
        hi_display        = arima_result["upper_ci"][0]

    # ── The action tier: a RULE over what has been OBSERVED ─────────────
    #
    # This is deliberately not a model, and the reason is measured rather than
    # stylistic. At barangay-month granularity this dataset has a lag-1
    # autocorrelation of 0.018 and a zoonotic-recurrence lift of 0.97x -- that
    # is, knowing a barangay's recent history tells you essentially nothing
    # about its next month. A classifier trained on it scored 55.9% against a
    # 65.4% majority baseline and caught 1 escalation in 7. Fitting a forest to
    # that is fitting noise, and dressing the output up as a prediction would
    # give a vet false confidence in a number with nothing behind it.
    #
    # So the tier reports the barangay's CURRENT state instead of guessing its
    # next one. Every input is an observed fact about the latest complete month,
    # which is both honest and what surveillance actually needs: flag what has
    # happened, now, so someone can act on it.
    #
    # ARIMA still forecasts the case COUNT alongside this, because volume
    # aggregated across the municipality genuinely is forecastable (0.777).
    cases_now       = float(latest_row.get("cases_now", latest_row["total_cases"]) or 0)
    zoonotic_now    = float(latest_row.get("zoonotic_now", 0) or 0)
    zoonotic_recent = float(latest_row.get("zoonotic_3m", 0) or 0)
    own_p75_obs     = float(latest_row.get("own_p75", 0) or 0)
    own_p90_obs     = float(latest_row.get("own_p90", 0) or 0)

    if zoonotic_recent > 0:
        tier = "ESCALATE"
        reason = ("Reportable disease reported this month (rabies-type or leptospirosis)"
                  if zoonotic_now > 0 else
                  "Reportable disease reported in the last 3 months")
    elif cases_now > own_p90_obs:
        tier = "ESCALATE"
        reason = f"Cases this month ({cases_now:.0f}) are well above this barangay's usual level"
    elif cases_now > own_p75_obs:
        tier = "MONITOR"
        reason = f"Cases this month ({cases_now:.0f}) are above this barangay's usual level"
    else:
        tier = "ROUTINE"
        reason = "Nothing unusual in this barangay's recent cases"

    # Written for the vet reading the response plan, not for the model. "p75"
    # and "p90" are the thresholds this rule uses, but printing them raw put
    # statistics notation in front of a clinician; the same two numbers said
    # plainly carry the whole meaning.
    tier_basis = ("the cases already recorded this month, against what is normal "
                  f"for this barangay: a usual month runs up to {own_p75_obs:.0f} cases, "
                  f"and above {own_p90_obs:.0f} is unusually high")
    # No probability to report: this is a rule, and presenting a made-up
    # confidence beside a deterministic threshold is how the old panel came to
    # show "High: 100%, Low: 0%".
    proba_dict = {}
    confidence = None

    # ── Case volume: a documented RULE, not a model ─────────────────────
    # Banding a number ARIMA already produced does not need a forest. Stated as
    # an explicit threshold against the barangay's own history so the UI can
    # show a volume word without implying a second prediction.
    own_p75 = float(latest_row.get("own_p75", 0) or 0)
    own_p90 = float(latest_row.get("own_p90", 0) or 0)
    volume_band = ("High" if arima_next > own_p90 else
                   "Medium" if arima_next > own_p75 else "Low")

    trend     = arima_result["trend"]
    quarter_band = _quarter_band(arima_result, (models.get("barangay_spread") or {}).get(barangay_name))
    agreement = (
        (trend == "rising"  and tier in ("ESCALATE", "MONITOR")) or
        (trend == "stable"  and tier in ("MONITOR", "ROUTINE")) or
        (trend == "falling" and tier == "ROUTINE")
    )

    return {
        "barangay": barangay_name,
        "current_cases": current_cases,
        # Cap insight-panel forecast at 3 months
        "arima_forecast": arima_result["forecast"][:3],
        "arima_lower_ci": arima_result["lower_ci"][:3],
        "arima_upper_ci": arima_result["upper_ci"][:3],
        "arima_trend": trend,
        "arima_order": arima_result["order"],
        # Action tier — a documented rule over observed facts, not a forecast.
        "action_tier":       str(tier),
        "action_tier_label": ACTION_TIER_LABELS.get(str(tier), str(tier)),
        "action_reason":     reason,
        "action_basis":      tier_basis,
        "action_is_rule":    True,
        "action_proba":      proba_dict,
        # ── The 3-month planning total ──────────────────────────────────
        # This is the barangay figure that can actually be trusted: ~36% MAPE
        # against ~91% for a single month. A barangay averages 7.6 cases, so one
        # month is dominated by chance; a quarter is not. It is also the interval
        # at which barangay visits and campaigns are scheduled, so the honest
        # horizon and the useful one coincide.
        # Interval for the TOTAL, not the sum of three monthly intervals.
        # Summing them adds the margins (std x 3) when independent errors
        # combine in quadrature (std x sqrt(3)) -- about 1.7x too wide, which
        # would make the quarter look less certain than the months it contains
        # and hide the very effect that makes it the reliable figure.
        "quarter_total": quarter_band[0],
        "quarter_lower": quarter_band[1],
        "quarter_upper": quarter_band[2],
        "quarter_is_reliable": True,
        # How this barangay's numbers were produced, so the UI can label them.
        "forecast_method": models.get("forecast_method", ""),
        "barangay_share": round(share, 4),
        # Flags the ~91%-MAPE per-barangay path so the UI can mark it, rather
        # than rendering it identically to a top-down figure. See the fallback
        # branch above.
        "is_fallback":     is_fallback,
        "fallback_reason": fallback_reason,
        # MEASURED coverage, not the nominal target. Monthly lands at 80.2%, the
        # quarter at 77.8% on 27 barangays -- within one standard error of 80%
        # but not equal to it, so callers should say "about 80%" rather than
        # asserting a flat 80%.
        "interval_coverage": {"monthly_pct": 80.2, "quarter_pct": 77.8,
                              "target_pct": 80, "calibration_n": 27},
        "municipality_forecast": (mun_result["forecast"][:3] if mun_result else None),
        "municipality_accuracy": models.get("municipality_accuracy"),
        # Stated so no caller presents the monthly number as precise.
        "monthly_reliability_note": (
            "Monthly barangay figures carry wide uncertainty (a barangay averages "
            "about 8 cases a month). Use the 3-month total for planning."
        ),
        # Case volume band from the threshold rule above, kept separate so the
        # two are never mistaken for one another.
        "volume_band": volume_band,
        "volume_basis": (f"the forecast against what is normal here: up to {own_p75:.0f} "
                         f"cases is a usual month, above {own_p90:.0f} is unusually high"),
        # Legacy keys, still emitted so older front-end builds keep rendering
        # while the UI catches up. rf_future_risk now carries the ACTION TIER.
        "rf_current_risk": str(tier),
        "rf_future_risk": str(tier),
        "rf_future_proba": proba_dict,
        "rf_confidence": confidence,
        # Named for what actually produces this value. It said
        # "RandomForestClassifier" over a threshold rule, which the UI believed:
        # it took the branch written for a model's prediction and printed the
        # null confidence above as "(0% confidence)" on every barangay.
        "rf_model_type": "ActionTierRule",
        "model_agreement": agreement,
        "fused_predicted": arima_next,
        # SCALE-1: period-correct display value for bar chart
        "predicted_cases":  predicted_display,
        "predicted_lower":  lo_display,
        "predicted_upper":  hi_display,
        "predicted_period": period,
        "model_type": f"AllDisease{arima_result['model_type']}+ActionTierRule",
    }


def _quarter_band(arima_result: dict, spread: dict = None, months: int = 3) -> tuple:
    """
    (total, lower, upper) for the next `months` combined -- the barangay figure
    that can actually be trusted (~36% MAPE against ~91% for a single month).

    Uses the MEASURED three-month residual spread when the barangay has one.
    Falls back to sqrt(months) scaling of the monthly band only when it does
    not, which is known to run narrow (66.7% coverage against an 80% target)
    because monthly allocation errors correlate within a barangay.
    """
    fc = arima_result["forecast"][:months]
    total = sum(fc)
    if spread and spread.get("quarter_margin"):
        margin = float(spread["quarter_margin"])
    else:
        per_month = 0.0
        if arima_result.get("upper_ci") and arima_result.get("lower_ci"):
            per_month = (arima_result["upper_ci"][0] - arima_result["lower_ci"][0]) / 2.0
        margin = per_month * (len(fc) ** 0.5)
    return round(total, 1), max(0.0, round(total - margin, 1)), round(total + margin, 1)


def _empty_prediction(barangay_name: str) -> dict:
    return {
        "barangay": barangay_name, "current_cases": 0,
        "arima_forecast": [0], "arima_lower_ci": [0], "arima_upper_ci": [0],
        "arima_trend": "stable", "arima_order": [0, 0, 0],
        "action_tier": "ROUTINE", "action_tier_label": ACTION_TIER_LABELS["ROUTINE"],
        "action_reason": "No case history for this barangay yet",
        "action_proba": {"ROUTINE": 1.0},
        # No history at all, so nothing was forecast. Flagged like the fallback
        # path so the UI never shows a zero as though a model produced it.
        "is_fallback": True,
        "fallback_reason": "no case history for this barangay",
        "quarter_total": 0, "quarter_lower": 0, "quarter_upper": 0,
        "barangay_share": 0.0, "interval_coverage": None,
        "volume_band": "Low", "volume_basis": "no history to compare against",
        "rf_current_risk": "ROUTINE", "rf_future_risk": "ROUTINE",
        "rf_future_proba": {"ROUTINE": 1.0}, "rf_confidence": 0.0,
        "model_agreement": True, "fused_predicted": 0,
        "predicted_cases": 0, "predicted_lower": 0, "predicted_upper": 0,
        "predicted_period": "year", "model_type": "EmptyFallback",
    }


# ════════════════════════════════════════════════════════════════════════
# DISEASE-SPECIFIC FORECASTING
# ════════════════════════════════════════════════════════════════════════

_consult_diagnosis_df = None


def load_db_consult_rows(after_year: int, after_month: int) -> pd.DataFrame:
    """
    Live continuation of Consult_Diagnosis_3Y from patient_visit_records —
    one row per visit whose diagnosis is a term in the `diseases` catalog, so
    _load_disease_specific_df's match against `diagnosis` works unchanged. Only
    months after the Excel sheet's own latest covered period are included, so
    nothing is double-counted.

    The catalog check replaced a bare "diagnosis is not empty" test, which let
    free-text entered through the diagnosis form's "Other / Not Listed" option
    into the per-disease series. It matches the rule
    db_disease_barangay_counts() applies in api/dashboard/dashboard.php, so the
    dashboard's counts and this pipeline's counts cannot drift apart.
    """
    # disease_category is carried through deliberately. Without it every live
    # row reached the model with a blank category, so a live Rabies (Suspected)
    # visit counted toward total_cases but never registered as zoonotic --
    # silently disabling the one signal the action rule depends on, for exactly
    # the half of the data that matters going forward.
    cols = ["barangay", "year", "month_no", "diagnosis", "disease_category",
            "symptom_cluster", "animal_group", "cases_reported", "is_db_sourced"]
    empty = pd.DataFrame(columns=cols)

    try:
        conn = db_connect()
    except Exception as e:
        print(f"[DB] consult-diagnosis connect failed, using Excel-only data: {e}")
        return empty

    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    YEAR(pvr.visit_date)  AS year,
                    MONTH(pvr.visit_date) AS month_no,
                    COALESCE(NULLIF(pvr.barangay_at_visit, ''), NULLIF(b.name, ''),
                             'Unspecified') AS barangay,
                    pvr.diagnosis AS diagnosis,
                    -- Read from the catalog rather than from the stored column:
                    -- rows encoded before the vocabulary migration still hold
                    -- the old bucket value, and the catalog is the definition.
                    COALESCE(NULLIF(d.display_category, ''),
                             NULLIF(pvr.disease_category, ''),
                             'General/Other') AS disease_category,
                    -- Carried so live visits can reach the differential-diagnosis
                    -- classifier. Left NULL when the vet skipped the picker:
                    -- groupby drops those rows, which is the correct outcome —
                    -- better absent than guessed from free text.
                    NULLIF(pvr.symptom_cluster, '') AS symptom_cluster,
                    -- The classifier's animal_group vocabulary, mapped from the
                    -- species recorded at the visit. Anything unmapped stays NULL
                    -- rather than defaulting to Dogs, which would silently file
                    -- every exotic case under the commonest group.
                    CASE pvr.species_at_visit
                        WHEN 'Canine' THEN 'Dogs'
                        WHEN 'Feline' THEN 'Cats'
                        WHEN 'Avian'  THEN 'Chickens'
                        ELSE NULL
                    END AS animal_group
                FROM patient_visit_records pvr
                LEFT JOIN pets ON pets.id = pvr.pet_id
                LEFT JOIN owner_profiles op ON op.user_id = pets.owner_id
                LEFT JOIN barangays b ON b.id = op.barangay_id
                LEFT JOIN diseases d ON d.name = pvr.diagnosis AND d.is_active = 1
                WHERE pvr.visit_date IS NOT NULL
                  AND pvr.diagnosis IN (SELECT name FROM diseases WHERE is_active = 1)
            """)
            rows = cur.fetchall()
    except Exception as e:
        print(f"[DB] consult-diagnosis query failed, using Excel-only data: {e}")
        return empty
    finally:
        conn.close()

    if not rows:
        return empty

    raw = pd.DataFrame(rows)
    raw = raw[(raw["year"] > after_year) | ((raw["year"] == after_year) & (raw["month_no"] > after_month))]
    if raw.empty:
        return empty

    raw["cases_reported"] = 1
    raw["is_db_sourced"] = True
    return raw[cols]


def _trusted_db_cutoff(raw: pd.DataFrame, declared: tuple = None) -> dict:
    """
    Same rationale as _arima_safe_frame (see that docstring), adapted to
    this sheet's one-row-per-visit shape instead of one-row-per-month:
    per barangay, finds the (year, month) of the last month in an unbroken
    run of DB-sourced coverage immediately following the Excel snapshot's
    last month. A barangay whose first live month already has a gap after
    Excel gets no entry -- none of its DB rows are trusted for forecasting
    until logging catches up.

    A declared coverage cutoff (see load_coverage_cutoff) overrides the
    run-check up to that month: entry is finished there, so a barangay with no
    consultations in some month is genuinely quiet rather than un-encoded.
    Unlike the all-disease path this sheet has nothing to zero-fill -- a month
    with no visits simply has no rows -- so the cutoff is applied directly.
    """
    cutoffs = {}
    excel_only = raw[~raw["is_db_sourced"]]
    for barangay, bdf in raw[raw["is_db_sourced"]].groupby("barangay"):
        excel_bdf = excel_only[excel_only["barangay"] == barangay]
        expected_year, expected_month = _latest_period(excel_bdf)
        months_present = sorted(set(map(tuple, bdf[["year", "month_no"]].astype(int).values.tolist())))
        last_trusted = None
        for (yr, mo) in months_present:
            expected_month += 1
            if expected_month > 12:
                expected_month, expected_year = 1, expected_year + 1
            if (yr, mo) == (expected_year, expected_month):
                last_trusted = (expected_year, expected_month)
            elif declared is not None and (yr, mo) <= declared:
                last_trusted = (yr, mo)
                expected_year, expected_month = yr, mo
            else:
                break
        if last_trusted:
            cutoffs[barangay] = last_trusted
    return cutoffs


def _load_consult_diagnosis_raw() -> pd.DataFrame:
    # SPEED-6: this sheet doesn't change while the service is running, but was
    # being re-read from disk (twice, via read_excel_sheet's header probe) on
    # every disease-specific request. Warm-started once, like get_all_disease_models().
    global _consult_diagnosis_df
    # Cheap indexed lookup; drops the warm cache below if the clinic has
    # uploaded a new dataset version since it was built. See
    # ensure_dataset_version_fresh() for why this is pulled rather than pushed.
    ensure_dataset_version_fresh()
    if _consult_diagnosis_df is not None:
        return _consult_diagnosis_df

    # Uploaded dataset first, bundled workbook only until one exists. Once a
    # version is active this path no longer opens the .xlsx at all, which takes
    # openpyxl (and its 20-50x-file-size parse spike) off the request path.
    raw = load_active_consult_rows()
    if raw is None:
        raw = read_excel_sheet("Consult_Diagnosis_3Y")
    raw.columns = [str(c).strip().lower() for c in raw.columns]
    raw["year"]           = pd.to_numeric(raw["year"], errors="coerce")
    raw["month_no"]       = pd.to_numeric(raw["month_no"], errors="coerce").fillna(1).astype(int)
    raw["cases_reported"] = pd.to_numeric(raw["cases_reported"], errors="coerce").fillna(1)
    raw = raw[pd.to_numeric(raw["year"], errors="coerce").notna()]
    raw["year"] = raw["year"].astype(int)
    raw["is_db_sourced"] = False

    after_year, after_month = _latest_period(raw)
    db_rows = load_db_consult_rows(after_year, after_month)
    if not db_rows.empty:
        raw = pd.concat([raw, db_rows], ignore_index=True, sort=False)

        # Drop DB-sourced rows that aren't part of a trusted contiguous run
        # (see _trusted_db_cutoff) -- same tail-cliff risk as the all-disease
        # pipeline, just at per-visit granularity instead of monthly totals.
        cutoffs = _trusted_db_cutoff(raw, load_coverage_cutoff())
        def _is_trusted(r):
            if not r["is_db_sourced"]:
                return True
            cutoff = cutoffs.get(r["barangay"])
            return cutoff is not None and (int(r["year"]), int(r["month_no"])) <= cutoff
        raw = raw[raw.apply(_is_trusted, axis=1)]

    _consult_diagnosis_df = raw
    return raw


def _load_disease_specific_df(disease_name: str) -> pd.DataFrame:
    raw = _load_consult_diagnosis_raw()
    dn = disease_name.strip().lower()
    subset = raw[raw["diagnosis"].str.strip().str.lower() == dn].copy()
    if subset.empty:
        subset = raw[raw["diagnosis"].str.strip().str.lower().str.contains(dn, na=False)].copy()
    agg = (
        subset.groupby(["barangay", "year", "month_no"])["cases_reported"]
        .sum().reset_index().rename(columns={"cases_reported": "cases"})
    )
    if not agg.empty:
        spine = pd.MultiIndex.from_product(
            [agg["barangay"].unique(),
             pd.RangeIndex(int(agg["year"].min()), int(agg["year"].max()) + 1),
             pd.RangeIndex(1, 13)],
            names=["barangay", "year", "month_no"],
        ).to_frame(index=False)
        agg = spine.merge(agg, on=["barangay", "year", "month_no"], how="left").fillna({"cases": 0})
    return agg


def _sarima_order_search(series: pd.Series, seasonal: bool = True) -> tuple:
    """
    SPEED-2: tight 4x4 grid (16 combos) instead of 9x8 (81 combos).
    Cuts per-barangay fit time ~5x with negligible AIC loss in practice.
    SPEED-8: dropped the (2,d,1) shape (p=2). Measured across 243 real
    barangay/disease series (10 diseases): p=2 was consistently the most
    expensive shape to fit (avg ~2-3x the other shapes) yet won on AIC only
    ~18.5% of the time -- less often than the much cheaper (0,d,1) shape
    (~59% win rate). Cuts ~38% of order-search time.
    All 4 seasonal (PDQ) shapes are kept: none of them is a safe cut --
    each won the AIC comparison on a meaningful share of real series (from
    ~9% up to ~40%), including the "no seasonal component" option, so
    dropping any of them would silently mis-fit real series.
    """
    d = _adf_d(series)
    best_aic, best_order, best_sorder = np.inf, (1, d, 1), (0, 0, 0, 12)

    pdq_grid  = [(1, d, 1), (1, d, 0), (0, d, 1)]
    PDQ_grid  = [(1, 0, 1), (0, 1, 1), (1, 1, 0), (0, 0, 0)] if seasonal else [(0, 0, 0)]

    for order in pdq_grid:
        for sorder in PDQ_grid:
            s_order = (sorder[0], sorder[1], sorder[2], 12) if seasonal else None
            try:
                if s_order and any(s_order[:3]):
                    res = SARIMAX(series, order=order, seasonal_order=s_order,
                                  enforce_stationarity=False, enforce_invertibility=False,
                                  ).fit(disp=False, maxiter=50)
                else:
                    res = ARIMA(series, order=order).fit(method_kwargs={"maxiter": 50})
                if res.aic < best_aic:
                    best_aic = res.aic; best_order = order
                    best_sorder = s_order or (0, 0, 0, 12)
            except Exception:
                pass

    return best_order, best_sorder


def _run_disease_arima(series: pd.Series, steps: int, order: tuple = None, s_order: tuple = None) -> dict:
    n = len(series.dropna())
    if n < 6:
        return _ma_fallback(series, steps)
    seasonal = n >= 12
    try:
        # SPEED-5: callers iterating many barangays (predict_disease_specific) can
        # pass in an order/s_order already picked for this series, so the 16-combo
        # grid search doesn't run a second time just for this fit.
        if order is None:
            order, s_order = _sarima_order_search(series, seasonal=seasonal)
        if seasonal and s_order and any(s_order[:3]):
            res = SARIMAX(series, order=order, seasonal_order=s_order,
                          enforce_stationarity=False, enforce_invertibility=False,
                          ).fit(disp=False, maxiter=100)
            model_type = "DiseaseSpecificSARIMA"
        else:
            res = ARIMA(series, order=order).fit(method_kwargs={"maxiter": 50})
            model_type = "DiseaseSpecificARIMA"
        fc_obj = res.get_forecast(steps=steps)
        fc = [max(0.0, round(float(v), 1)) for v in fc_obj.predicted_mean.values]
        ci = fc_obj.conf_int(alpha=0.2)
        lo = [max(0.0, round(float(v), 1)) for v in ci.iloc[:, 0]]
        hi = [max(0.0, round(float(v), 1)) for v in ci.iloc[:, 1]]

        # SANITY GUARD: see _forecast_is_runaway() -- catches both an outright
        # per-month blowup and the more subtle case where every individual
        # month looks plausible but the summed annual forecast (the number
        # actually shown to users) is far beyond anything the barangay's
        # history ever supported.
        if _forecast_is_runaway(series, fc, hi):
            return _ma_fallback(series, steps)

        slope = fc[-1] - fc[0]
        trend = "rising" if slope > 0.5 else ("falling" if slope < -0.5 else "stable")
        return {"forecast": fc, "lower_ci": lo, "upper_ci": hi,
                "order": list(order), "seasonal_order": list(s_order) if s_order else None,
                "trend": trend, "model_type": model_type, "n_obs": n}
    except Exception:
        return _ma_fallback(series, steps)


def _ma_fallback(series: pd.Series, steps: int) -> dict:
    vals    = series.dropna().values.astype(float)
    weights = np.array([0.2, 0.3, 0.5])
    if len(vals) == 0:
        fc = [0.0] * steps
        return {"forecast": fc, "lower_ci": fc, "upper_ci": fc,
                "order": [0, 0, 0], "seasonal_order": None,
                "trend": "stable", "model_type": "DiseaseMovingAverageFallback", "n_obs": 0}
    window = vals[-3:] if len(vals) >= 3 else np.pad(vals, (3 - len(vals), 0), constant_values=0)
    w = weights[-len(window):]; w = w / w.sum()
    fc = [max(0.0, round(float(np.dot(window, w)), 1))] * steps
    # SPEED-3: 200 bootstrap resamples (down from 1000)
    rng     = np.random.default_rng(42)
    bs      = [float(np.dot(np.sort(rng.choice(window, size=len(window), replace=True)), w))
               for _ in range(200)]
    lo = [max(0.0, round(float(np.percentile(bs, 10)), 1))] * steps
    hi = [round(float(np.percentile(bs, 90)), 1)] * steps
    slope = float(vals[-1] - vals[0]) / max(1, len(vals) - 1) if len(vals) > 1 else 0
    trend = "rising" if slope > 0.3 else ("falling" if slope < -0.3 else "stable")
    return {"forecast": fc, "lower_ci": lo, "upper_ci": hi,
            "order": [0, 0, 0], "seasonal_order": None,
            "trend": trend, "model_type": "DiseaseMovingAverageFallback", "n_obs": len(vals)}


def _disease_risk_thresholds(case_values: list) -> dict:
    arr = np.array(case_values, dtype=float); arr = arr[arr > 0]
    if len(arr) == 0:
        return {"low_max": 0, "med_max": 0, "note": "no data"}
    return {
        "low_max": round(float(np.percentile(arr, 50)), 2),
        "med_max": round(float(np.percentile(arr, 75)), 2),
        "note": ("Rule-based thresholds derived from per-disease barangay distribution. "
                 "< p50 = Low, p50–p75 = Medium, >= p75 = High. Not a trained ML classifier."),
    }


def _disease_risk_label(cases: float, thresholds: dict) -> str:
    if cases >= thresholds["med_max"] and thresholds["med_max"] > 0: return "High"
    if cases >= thresholds["low_max"] and thresholds["low_max"] > 0: return "Medium"
    return "Low"


def _disease_tier(risk_label: str) -> str:
    return {"High": "critical", "Medium": "monitor", "Low": "stable"}.get(risk_label, "stable")


def _compute_disease_metrics(series: pd.Series, steps: int = 3, order: tuple = None, s_order: tuple = None) -> dict:
    series = series.dropna()
    if len(series) < steps + 3:
        return {"mae": None, "rmse": None, "mape": None, "holdout_size": 0,
                "note": "Not enough historical data yet to check forecast accuracy."}
    train       = series.iloc[:-steps]
    test_actual = series.iloc[-steps:].values.astype(float)
    try:
        n_train = len(train)
        if n_train < 6:
            return {"mae": None, "rmse": None, "mape": None, "holdout_size": steps,
                    "note": "Not enough historical data yet to check forecast accuracy."}
        # SPEED-5: reuse the order already selected for the full series (passed in
        # by predict_disease_specific) instead of running a second 16-combo grid
        # search on the train-only slice -- halves the ARIMA/SARIMAX fits per
        # barangay with no change to the reported holdout metrics' meaning.
        if order is None:
            order, s_order = _sarima_order_search(train, seasonal=(n_train >= 12))
        use_seasonal = n_train >= 12 and s_order and any(s_order[:3])
        res = (SARIMAX(train, order=order, seasonal_order=s_order,
                       enforce_stationarity=False, enforce_invertibility=False,
                       ).fit(disp=False, maxiter=50)
               if use_seasonal else
               ARIMA(train, order=order).fit(method_kwargs={"maxiter": 50}))
        fc    = res.get_forecast(steps=steps).predicted_mean.values.clip(min=0)
        mae_v = round(float(mean_absolute_error(test_actual, fc)), 2)
        return {"mae": mae_v, "rmse": rmse(test_actual, fc), "mape": mape(test_actual, fc),
                "holdout_size": steps,
                "note": f"Accuracy checked against the last {steps} months of real cases."}
    except Exception:
        return {"mae": None, "rmse": None, "mape": None, "holdout_size": steps,
                "note": "Accuracy check unavailable for this barangay right now."}


## The disease-specific pipeline never had its own RF model of any kind before
## v3.2 (it always used SARIMA/ARIMA + the rule-based threshold below) -- a
## pooled RandomForestRegressor was added in v3 to try RF-for-monthly here too,
## disabled immediately after benchmarking poorly (test_eval.py's old Figure 4
## held-out R^2 came back ~0.01-0.06 -- tree ensembles pooled across sparse,
## mostly-zero series don't have enough signal to trust for a live forecast),
## and is removed as of v3.2 along with the all-disease regressor (see module
## docstring, MODEL-2). Scope for a classifier here was considered and
## explicitly declined -- this pipeline never had one historically, and adding
## a new one (rather than restoring one) was judged bigger-than-necessary scope
## for what the manuscript actually claims.


def predict_disease_specific(
    disease_name: str, requested_barangays: list, period: str,
    steps: int, current_cases_by_barangay: dict,
) -> list:
    cache_key = f"ds_{disease_name.lower()}_{period}_{steps}_" + "_".join(sorted(requested_barangays))
    cached = cache_get(cache_key)
    if cached:
        return cached

    agg = _load_disease_specific_df(disease_name)
    if agg.empty:
        return []

    latest_year = int(agg["year"].max()) if not agg.empty else 2025
    if period == "month":
        latest_month = int(agg.loc[agg["year"] == latest_year, "month_no"].max()) if not agg.empty else 12
        period_agg   = agg[(agg["year"] == latest_year) & (agg["month_no"] == latest_month)]
    else:
        period_agg = agg[agg["year"] == latest_year]

    current_by_barangay = period_agg.groupby("barangay")["cases"].sum().to_dict()
    for b, v in current_cases_by_barangay.items():
        km = next((k for k in current_by_barangay if k.strip().lower() == b.strip().lower()), None)
        if km: current_by_barangay[km] = float(v)
        else:  current_by_barangay[b]  = float(v)

    targets = requested_barangays if requested_barangays else list(current_by_barangay.keys())
    if not targets:
        return []

    thresholds = _disease_risk_thresholds(list(current_by_barangay.values()))
    avg_cases  = round(sum(current_by_barangay.values()) / max(1, len(current_by_barangay)), 2)
    results    = []

    # SCALE-2: forecast 12 months for year period so we can sum
    fc_steps = 12 if period == "year" else max(steps, 3)

    for barangay in targets:
        b_df = agg[agg["barangay"].str.strip().str.lower() == barangay.strip().lower()]
        if b_df.empty:
            series = pd.Series(dtype=float)
        else:
            b_df = b_df.sort_values(["year", "month_no"])
            b_df["period_dt"] = pd.to_datetime(
                b_df["year"].astype(str) + "-" + b_df["month_no"].astype(str).str.zfill(2)
            ).dt.to_period("M")
            series = b_df.groupby("period_dt")["cases"].sum().astype(float).asfreq("M", fill_value=0)

        n_obs = len(series.dropna())

        # SPEED-5: pick the ARIMA/SARIMA order once per barangay and reuse it
        # for both the holdout evaluation and the real forecast (previously
        # each ran its own independent 16-combo grid search -- 34 model fits
        # per barangay instead of ~18, which is most of why this was slow).
        order = s_order = None
        if n_obs >= 6:
            order, s_order = _sarima_order_search(series, seasonal=(n_obs >= 12))
        metrics   = _compute_disease_metrics(series, steps=min(steps, 3), order=order, s_order=s_order)
        fc_result = _run_disease_arima(series, steps=fc_steps, order=order, s_order=s_order)

        current_cases = float(
            current_by_barangay.get(barangay, 0) or
            current_by_barangay.get(
                next((k for k in current_by_barangay if k.strip().lower() == barangay.strip().lower()), ""), 0)
        )

        risk_label   = _disease_risk_label(current_cases, thresholds)
        future_cases = fc_result["forecast"][0]   # next-month value, used for display/protocol text

        # SCALE-2: bar-chart display value. Computed before future_risk below
        # because thresholds are annual-scale current_cases-derived -- for
        # period="year" the risk-labeled value must match that scale
        # (predicted_display), not the single next-month value (future_cases),
        # or every barangay reads "Low" since one month is always far smaller
        # than an annual total.
        if period == "year":
            predicted_display = round(sum(fc_result["forecast"]), 1)
            lo_display        = round(sum(fc_result["lower_ci"]),  1)
            hi_display        = round(sum(fc_result["upper_ci"]),  1)
        else:
            predicted_display = future_cases
            lo_display        = fc_result["lower_ci"][0]
            hi_display        = fc_result["upper_ci"][0]

        future_risk = _disease_risk_label(predicted_display, thresholds)
        tier        = _disease_tier(future_risk)

        pct_vs_avg = round(((current_cases - avg_cases) / max(1, avg_cases)) * 100)
        proba = {
            "High": round(min(1.0, current_cases / max(thresholds["med_max"], 1)), 3) if thresholds["med_max"] > 0 else 0.0,
            "Medium": 0.0, "Low": 0.0,
        }
        proba["Low"] = round(max(0.0, 1.0 - proba["High"] - proba["Medium"]), 3)

        steps_list = _build_disease_protocol_steps(
            barangay, disease_name, current_cases, future_cases, fc_result, risk_label, future_risk, avg_cases
        )
        recommendation = (
            f"{barangay} — {disease_name}: {current_cases:.0f} cases this period "
            f"({_friendly_model_label(fc_result['model_type'])}: {future_cases:.0f} next month, trend: {fc_result['trend']}). "
            f"Case volume level: {future_risk}."
        )

        results.append({
            "barangay": barangay, "disease": disease_name,
            "current_cases": current_cases, "avg_cases": avg_cases, "pct_vs_avg": pct_vs_avg,
            # Cap insight-panel forecast at 3 months
            "arima_forecast": fc_result["forecast"][:3],
            "arima_lower_ci": fc_result["lower_ci"][:3],
            "arima_upper_ci": fc_result["upper_ci"][:3],
            "arima_trend": fc_result["trend"], "arima_order": fc_result["order"],
            "seasonal_order": fc_result.get("seasonal_order"), "n_obs": fc_result.get("n_obs", 0),
            "risk_class": future_risk, "rf_current_risk": risk_label, "rf_future_risk": future_risk,
            "risk_proba": proba,
            "confidence": forecast_confidence(predicted_display, lo_display, hi_display, metrics["mape"]),
            "rf_model_type": "RuleBasedThreshold", "risk_thresholds": thresholds,
            # SCALE-2: period-correct bar-chart value
            "predicted_cases":      predicted_display,
            "predicted_lower":      lo_display,
            "predicted_upper":      hi_display,
            "predicted_period":     period,
            "predicted_next_month": future_cases,   # kept for protocol text
            "tier": tier, "recommendation": recommendation, "steps": steps_list,
            "model_agreement": True, "model_type": fc_result["model_type"],
            "model_mae": metrics["mae"], "model_rmse": metrics["rmse"],
            "model_mape": metrics["mape"], "model_accuracy": None,
            "eval_note": metrics["note"],
            # Always the ARIMA/SARIMA holdout now -- RF-for-monthly (which used a
            # random 80/20 split instead) is disabled, see comment above.
            "split_method": "time_based_chronological_last3months_holdout",
        })

    results.sort(key=lambda x: (
        0 if x["tier"] == "critical" else (1 if x["tier"] == "monitor" else 2),
        -x["current_cases"],
    ))
    cache_set(cache_key, results)
    return results


def _friendly_model_label(model_type):
    s = str(model_type or "").lower()
    if "fallback" in s or "movingaverage" in s or "wma" in s:
        return "Basic Estimate"
    if "arima" in s and ("rf" in s or "alldisease" in s):
        return "Advanced Forecast"
    if "sarima" in s or "arima" in s or "rfmonthly" in s:
        return "Smart Forecast"
    return "Forecast"


def _build_disease_protocol_steps(barangay, disease, current, future, fc, current_risk, future_risk, avg):
    trend = fc["trend"]
    model = _friendly_model_label(fc["model_type"])
    if future_risk == "High":
        return [
            {"level":"red",   "title":"Visit this barangay",
             "detail":f"{model} predicts {future:.0f} {disease} cases next month in {barangay}. Deploy veterinary field team."},
            {"level":"blue",  "title":"Within 24 hrs: Report to MHO",
             "detail":f"Escalate {disease} cluster. Likely range: {fc['lower_ci'][0]:.0f}\u2013{fc['upper_ci'][0]:.0f} cases. Trend: {trend}."},
            {"level":"green", "title":"Preventive: Targeted Treatment Drive",
             "detail":f"Schedule mass treatment for {disease} in {barangay}. Current: {current:.0f} vs avg {avg:.1f}."},
            {"level":"gray",  "title":"Check again next week",
             "detail":f"Track until rule-based risk falls. Expect {_forecast_phrase(fc['forecast'])}."},
        ]
    elif future_risk == "Medium":
        return [
            {"level":"red",   "title":"Confirm these cases",
             "detail":f"{model} predicts {future:.0f} {disease} in {barangay}. Confirm active clusters."},
            {"level":"blue",  "title":"Coordinate with the vet team",
             "detail":f"Schedule district vet visit. Trend: {trend}. Likely range: {fc['lower_ci'][0]:.0f}\u2013{fc['upper_ci'][0]:.0f} cases."},
            {"level":"green", "title":"Send an advisory to residents",
             "detail":f"Run barangay broadcast for {disease} in {barangay}."},
            {"level":"gray",  "title":"Check again in two weeks",
             "detail":f"Escalate if threshold exceeded. Forecast: {future:.0f} cases."},
        ]
    return [
        {"level":"red",   "title":"Nothing needed right now",
         "detail":f"{model} predicts {future:.0f} {disease} — LOW case volume. Trend: {trend}."},
        {"level":"blue",  "title":"Include in the monthly report",
         "detail":f"Maintain standard cadence. Current: {current:.0f} in {barangay}."},
        {"level":"green", "title":"Include in the next campaign",
         "detail":f"Include {barangay} in next {disease} campaign."},
        {"level":"gray",  "title":"Keep the usual monitoring",
         "detail":f"Alert if cases exceed {round(avg * 1.3, 1)} (30% above avg)."},
    ]


# ════════════════════════════════════════════════════════════════════════
# PATIENT VOLUME  (unchanged from v3)
# ════════════════════════════════════════════════════════════════════════

@app.route("/patient-volume-predict", methods=["POST"])
def patient_volume_predict():
    data        = request.json or {}
    series_data = data.get("series", [])
    if not series_data:
        return jsonify({"success": False, "error": "No series data provided"}), 400
    ck = "pv_" + str(hash(str(series_data)))
    cached = cache_get(ck)
    if cached:
        return jsonify({"success": True, "data": cached, "cached": True})
    try:
        series = pd.Series([float(r.get("value", 0)) for r in series_data], dtype=float)
        ar     = run_arima(series, steps=3)
        results = [{"period": r.get("period", ""), "actual": float(r.get("value", 0)),
                    "predicted": float(ar["forecast"][0]) if i == len(series_data) - 1
                                 else float(r.get("value", 0))}
                   for i, r in enumerate(series_data)]
        cache_set(ck, results)
        return jsonify({"success": True, "data": results})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ════════════════════════════════════════════════════════════════════════
# UNIFIED /disease-predict
# ════════════════════════════════════════════════════════════════════════

def _forecast_phrase(forecast, quarter_total=None):
    """
    The monthly forecast as a sentence rather than a raw Python list.

    Printed straight, this read "3-month forecast: [11.4, 11.4, 11.4]" for every
    barangay -- the same number three times. That is structural: the top-down
    forecast multiplies one municipal figure by a barangay share that does not
    change month to month, so month 2 is never distinct from month 1. Three
    identical values look like a bug to a reader and imply three separate
    predictions that were never made.

    Says it once when the months are flat, names the quarter total (the figure
    that is actually reliable at this scale), and falls back to the trajectory
    when the months genuinely differ.
    """
    values = [round(float(v), 1) for v in (forecast or [])[:3]]
    if not values:
        return "no monthly forecast available"
    if len(set(values)) == 1:
        flat = f"{values[0]:g}"
        if quarter_total is not None:
            return (f"about {flat} cases a month, "
                    f"{round(float(quarter_total), 1):g} over three months")
        return f"about {flat} cases a month for the next three"
    return "next three months: " + ", ".join(f"{v:g}" for v in values)


def _build_all_disease_protocol(barangay, pred, avg_cases, models):
    action  = str(pred.get("action_tier", "ROUTINE")).upper()
    reason  = pred.get("action_reason", "")
    volume  = pred.get("volume_band", "Low")
    risk   = {"ESCALATE": "high", "MONITOR": "medium"}.get(action, "low")
    trend  = pred["arima_trend"]
    basis  = pred.get("action_basis", "based on this month's observed cases")
    fused  = pred["fused_predicted"]
    current= pred["current_cases"]
    lo, hi = pred["arima_lower_ci"][0], pred["arima_upper_ci"][0]
    an = ("The case trend and the action level agree." if pred["model_agreement"]
          else f"Note: cases are '{trend}' while the action level reads "
               f"{ACTION_TIER_LABELS.get(action, action)}.")
    fc = pred["arima_forecast"]
    fc_phrase = _forecast_phrase(fc, pred.get("quarter_total"))

    # Both models speak here, but to different points: ARIMA supplies the case
    # NUMBERS (forecast, likely range), the classifier supplies the DECISION
    # (which tier, and why). Previously every step derived from one banded
    # number, so the panel restated a single fact four times.
    if risk == "high":
        tier = "critical"
        steps = [
            {"level":"red",  "title":"Visit this barangay",
             "detail":f"{reason}. Expected {fused:.0f} cases next month (likely {lo:.0f}-{hi:.0f}, trend: {trend}). Deploy to {barangay}. {an}"},
            {"level":"blue", "title":"Report to the Municipal Health Office",
             "detail":f"Within 24 hours. Based on {basis}. Current: {current:.0f} cases vs this barangay's usual {avg_cases:.1f}."},
            {"level":"green","title":"Run a clean-up and prevention drive",
             "detail":f"Focus on {barangay}. Expected case volume next month: {volume}."},
            {"level":"gray", "title":"Check again next week",
             "detail":f"Review weekly until the level returns to Normal. Expect {fc_phrase}."},
        ]
    elif risk == "medium":
        tier = "monitor"
        steps = [
            {"level":"red",  "title":"Confirm these cases",
             "detail":f"{reason}. Expected {fused:.0f} cases next month (likely {lo:.0f}-{hi:.0f}). Confirm clusters in {barangay}. {an}"},
            {"level":"blue", "title":"Coordinate with the vet team",
             "detail":f"Within 3 days. Based on {basis}. Current: {current:.0f} cases vs usual {avg_cases:.1f}."},
            {"level":"green","title":"Send an advisory to residents",
             "detail":f"Advisory for {barangay}. Expected case volume next month: {volume}."},
            {"level":"gray", "title":"Check again in two weeks",
             "detail":f"Escalate if cases exceed the likely range ({lo:.0f}-{hi:.0f})."},
        ]
    else:
        tier = "stable"
        steps = [
            {"level":"red",  "title":"Nothing needed right now",
             "detail":f"{reason}. Expected {fused:.0f} cases next month (likely {lo:.0f}-{hi:.0f}, trend: {trend}). {an}"},
            {"level":"blue", "title":"Include in the monthly report",
             "detail":f"Maintain the usual cadence for {barangay}."},
            {"level":"green","title":"Include in the next campaign",
             "detail":f"Include {barangay} in the next scheduled campaign."},
            {"level":"gray", "title":"Keep the usual monitoring",
             "detail":f"Revisit if cases exceed {hi:.0f}, or if a reportable disease is seen."},
        ]
    return tier, steps


@app.route("/disease-predict", methods=["POST"])
def disease_predict():
    data        = request.json or {}
    disease_raw = str(data.get("disease", "")).strip()
    is_all      = disease_raw.lower() in ("", "all diseases", "all")
    requested   = data.get("barangays", [])
    steps       = int(data.get("steps", 1))
    period      = str(data.get("period", "year")).strip().lower()
    cc_raw      = data.get("current_cases_by_barangay", {}) or {}
    cc_key      = {str(k).strip().lower(): float(v) for k, v in cc_raw.items() if str(k).strip()}

    if is_all:
        ch  = hash(tuple(sorted(cc_key.items())))
        ck  = "hybrid_" + "_".join(sorted(requested)) + f"_p{period}_c{ch}"
        cached = cache_get(ck)
        if cached:
            return jsonify({"success": True, "data": cached, "cached": True})
        try:
            models = get_all_disease_models()
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500
        df       = models["df"]
        arima_df = models.get("arima_df", df)
        targets  = requested if requested else list(df["barangay"].unique())
        # Trust-gated lookup (see get_all_disease_models' "arima_df" note) --
        # otherwise a barangay's untrusted live tail month pollutes both its own
        # risk label and the p50/p75 thresholds computed from all_c.values() below.
        all_c    = arima_df.groupby("barangay")["total_cases"].last().to_dict()
        # Apply live current-case overrides before computing risk thresholds,
        # so risk bands reflect today's actual case distribution across
        # barangays, not just each barangay's last historical row.
        for b, v in cc_key.items():
            km = next((k for k in all_c if k.strip().lower() == b), None)
            if km: all_c[km] = v
            else:  all_c[b]  = v
        avg_c      = round(sum(all_c.values()) / max(1, len(all_c)), 1)
        results  = []
        for barangay in targets:
            override = cc_key.get(str(barangay).strip().lower())
            pred     = _hybrid_predict_one_alldisease(barangay, models, steps=steps,
                                                      current_override=override, period=period)
            tier, sl = _build_all_disease_protocol(barangay, pred, avg_c, models)
            pct      = round(((pred["current_cases"] - avg_c) / max(1, avg_c)) * 100)
            results.append({
                "barangay": barangay, "disease": "All Diseases",
                "current_cases": pred["current_cases"], "avg_cases": avg_c, "pct_vs_avg": pct,
                "arima_forecast": pred["arima_forecast"], "arima_lower_ci": pred["arima_lower_ci"],
                "arima_upper_ci": pred["arima_upper_ci"], "arima_trend": pred["arima_trend"],
                "arima_order": pred["arima_order"], "seasonal_order": None,
                "rf_current_risk": pred["rf_current_risk"], "rf_future_risk": pred["rf_future_risk"],
                "risk_class": pred["rf_future_risk"], "risk_proba": pred["rf_future_proba"],
                "confidence": pred["rf_confidence"],
                "rf_model_type": pred.get("rf_model_type", "ActionTierRule"),
                "risk_note": models.get("risk_note_short", ""),
                # ── Top-down output, surfaced for the UI ────────────────────
                # The action tier is a rule over observed cases; the quarter
                # total is the barangay figure that can actually be trusted
                # (~36% MAPE against ~91% monthly). is_fallback flags a barangay
                # that could not be allocated a share and is therefore still on
                # the old per-barangay ARIMA path, so the UI never presents the
                # two as if one method produced both.
                "action_tier":        pred.get("action_tier"),
                "action_tier_label":  pred.get("action_tier_label"),
                "action_reason":      pred.get("action_reason"),
                "action_basis":       pred.get("action_basis"),
                "action_is_rule":     pred.get("action_is_rule", False),
                # How MANY cases, as opposed to what to DO about them. Computed
                # here since v3 but never forwarded, so the UI had nothing to put
                # in its "case volume" line and printed the action tier there
                # instead — "Case volume level: ESCALATE".
                "volume_band":        pred.get("volume_band"),
                "volume_basis":       pred.get("volume_basis"),
                "quarter_total":      pred.get("quarter_total"),
                "quarter_lower":      pred.get("quarter_lower"),
                "quarter_upper":      pred.get("quarter_upper"),
                "barangay_share":     pred.get("barangay_share"),
                "forecast_method":    pred.get("forecast_method"),
                "is_fallback":        pred.get("is_fallback", False),
                "fallback_reason":    pred.get("fallback_reason"),
                "interval_coverage":  pred.get("interval_coverage"),
                "municipality_accuracy": pred.get("municipality_accuracy"),
                "monthly_reliability_note": pred.get("monthly_reliability_note"),
                # SCALE-1: period-correct predicted_cases for bar chart
                "predicted_cases":  pred.get("predicted_cases", pred["fused_predicted"]),
                "predicted_lower":  pred.get("predicted_lower",  pred["fused_predicted"]),
                "predicted_upper":  pred.get("predicted_upper",  pred["fused_predicted"]),
                "predicted_period": period,
                "fused_predicted": pred["fused_predicted"],
                "model_agreement": pred["model_agreement"], "tier": tier,
                "recommendation": (
                    f"{barangay} — {pred.get('action_tier_label', 'Normal')}: "
                    f"{pred.get('action_reason', '')}. Trend: {pred['arima_trend']}, "
                    f"predicts {pred['predicted_cases']:.0f} "
                    f"({'annual' if period == 'year' else 'next-month'}) cases."
                ),
                "steps": sl, "model_type": pred["model_type"],
                "model_mae": models["mae"], "model_rmse": models.get("rmse"),
                "model_mape": models.get("mape"),
                "eval_note": models.get("risk_note_short", ""),
            })
        results.sort(key=lambda x: (
            0 if x["tier"] == "critical" else (1 if x["tier"] == "monitor" else 2),
            -x["current_cases"]))
        cache_set(ck, results)
        return jsonify({"success": True, "data": results})

    try:
        results = predict_disease_specific(
            disease_name=disease_raw, requested_barangays=requested,
            period=period, steps=steps, current_cases_by_barangay=cc_key)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    return jsonify({"success": True, "data": results})


# ════════════════════════════════════════════════════════════════════════
# MODEL INFO + HEALTH
# ════════════════════════════════════════════════════════════════════════

@app.route("/hybrid-model-info", methods=["GET"])
@app.route("/rf-model-info", methods=["GET"])
def model_info():
    try:
        models = get_all_disease_models()
        return jsonify({
            "success": True,
            "all_disease": {
                "description": "All-disease barangay totals — ARIMA forecast + Random Forest risk classifier",
                "arima": {
                    "method": "Auto-ARIMA (5-combo grid + ADF)", "ci_level": "80%",
                    "pooled_mae": models["mae"], "pooled_rmse": models.get("rmse"),
                    "pooled_mape": models.get("mape"),
                    "note": "Pooled 3-month holdout accuracy across barangays for the model that "
                            "actually produces every live forecast here (month and year views alike).",
                },
                "risk_classification": {
                    "type": "RandomForestClassifier",
                    "features": FEATURE_COLS,
                    "trained_on_rows": models["trained_on"],
                    "accuracy": models.get("classifier_accuracy"),
                    "precision": models.get("classifier_precision"),
                    "recall": models.get("classifier_recall"),
                    "f1": models.get("classifier_f1"),
                    "confusion_matrix": models.get("classifier_confusion_matrix"),
                    "classes": models.get("classifier_classes"),
                    "top_features": dict(list(models["importance"].items())[:5]),
                    "risk_note": models.get("risk_note", ""),
                },
            },
            "disease_specific": {
                "description": "Per-disease SARIMA/ARIMA/WMA from Consult_Diagnosis_3Y",
                "sarima_grid": "3 pdq x 3 PDQ = 9 combos (SPEED-8)",
                "bootstrap_ci": "200 resamples (SPEED-3)",
                "risk_classification": {
                    "type": "RuleBasedThreshold",
                    "method": "Per-disease p50/p75 thresholds",
                    "note": "Not a trained ML classifier.",
                },
                "metrics": {"method": "time-based holdout: last 3 months", "reported": ["MAE", "RMSE", "MAPE"]},
            },
            "scaling": {
                "note": ("For period=year, predicted_cases = sum of 12 monthly ARIMA forecasts "
                         "(matches actual annual total in bar chart). "
                         "For period=month, predicted_cases = next-month value.")
            },
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/disease-list", methods=["GET"])
def disease_list():
    try:
        # Goes through _load_consult_diagnosis_raw() rather than reading the
        # workbook directly: this endpoint used to be the one place that still
        # bypassed the shared loader, so after an upload the rest of the page
        # showed new data while this dropdown kept listing the Excel's diagnoses.
        raw = _load_consult_diagnosis_raw()
        return jsonify({"success": True, "data": sorted(raw["diagnosis"].dropna().unique().tolist())})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/diagnosis-predict", methods=["POST"])
def diagnosis_predict():
    """
    Differential diagnosis for a presenting case.

    Body: {symptom_cluster, animal_group, barangay?, month_no?, top_n?}
    Returns a ranked shortlist, plus the held-out scores and the lookup baseline
    so the caller can present the model's accuracy honestly rather than showing a
    bare probability.
    """
    data = request.json or {}
    symptom = str(data.get("symptom_cluster", "")).strip()
    if symptom == "":
        return jsonify({"success": False, "error": "symptom_cluster is required"}), 400
    try:
        result = predict_diagnosis(
            symptom_cluster=symptom,
            animal_group=str(data.get("animal_group", "")).strip(),
            barangay=str(data.get("barangay", "")).strip(),
            month_no=int(data.get("month_no", 0) or 0),
            top_n=int(data.get("top_n", 3) or 3),
        )
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/barangay-differential", methods=["POST"])
def barangay_differential():
    """
    The differential-diagnosis classifier, applied to one barangay.

    Body: {barangay, symptom_cluster?, animal_group?}

    Disease Analytics asks a barangay-shaped question, so the model's inputs come
    from that barangay's OWN consultations rather than from a form: which symptom
    pattern do its cases actually present as, and in which animals. Either can be
    overridden to explore a different pattern.

    Also returns what was actually DIAGNOSED for that pattern in that barangay, so
    the shortlist can be read against the record instead of taken on trust. The two
    agreeing is the useful signal; the two disagreeing is worth a vet's attention,
    and neither is visible if only the model's own numbers are shown.
    """
    data = request.json or {}
    barangay = str(data.get("barangay", "")).strip()
    if barangay == "":
        return jsonify({"success": False, "error": "barangay is required"}), 400
    try:
        raw = _load_consult_diagnosis_raw()
        sub = raw[raw["barangay"].astype(str).str.strip().str.lower() == barangay.lower()].copy()
        if sub.empty:
            return jsonify({"success": True, "data": {
                "available": False,
                "reason": f"No consultations on record for {barangay}."}})

        sub["_cases"] = pd.to_numeric(sub["cases_reported"], errors="coerce").fillna(1)

        # What this barangay's cases actually look like, highest volume first.
        patterns = sub.groupby("symptom_cluster")["_cases"].sum().sort_values(ascending=False)
        total = float(patterns.sum()) or 1.0
        pattern_list = [{"symptom_cluster": str(name), "cases": int(value),
                         "share": round(100.0 * value / total, 1)}
                        for name, value in patterns.head(6).items()]

        # The disease filter selects WHICH pattern to open on, not what to count.
        # Filtering the whole subset to the disease would make the observed column
        # circular — asked about rabies, it could only ever answer "rabies" — and
        # the point of that column is to be checkable against the prediction.
        disease = str(data.get("disease", "")).strip()
        is_all_diseases = disease.lower() in ("", "all diseases", "all")

        cluster = str(data.get("symptom_cluster", "")).strip()
        pattern_basis = "the barangay's overall case mix"

        if not cluster and not is_all_diseases:
            only = sub[sub["diagnosis"].astype(str).str.strip().str.lower() == disease.lower()]
            by_cluster = only.groupby("symptom_cluster")["_cases"].sum() if not only.empty else pd.Series(dtype=float)
            if len(by_cluster):
                cluster = str(by_cluster.idxmax())
                pattern_basis = f"how {disease} presents here"
            else:
                # Says WHY it fell back. Filtering to a disease this barangay has
                # never recorded and getting its unrelated top pattern with no
                # explanation reads as the filter being ignored — which is the
                # bug this parameter was added to fix.
                pattern_basis = (f"the barangay's overall case mix — no {disease} "
                                 f"has been recorded here")

        if not cluster:
            cluster = pattern_list[0]["symptom_cluster"] if pattern_list else ""

        here = sub[sub["symptom_cluster"].astype(str).str.strip() == cluster]

        groups = (here.groupby("animal_group")["_cases"].sum().sort_values(ascending=False)
                  if not here.empty else pd.Series(dtype=float))
        group = str(data.get("animal_group", "")).strip() \
            or (str(groups.index[0]) if len(groups) else "")

        observed = (here.groupby("diagnosis")["_cases"].sum().sort_values(ascending=False).head(3)
                    if not here.empty else pd.Series(dtype=float))

        result = predict_diagnosis(symptom_cluster=cluster, animal_group=group, top_n=3)
        result.update({
            "barangay":           barangay,
            "patterns":           pattern_list,
            "animal_groups_here": [str(g) for g in list(groups.index)[:6]],
            "selected":           {"symptom_cluster": cluster, "animal_group": group},
            "disease_filter":     None if is_all_diseases else disease,
            "pattern_basis":      pattern_basis,
            "observed_top":       [{"diagnosis": str(name), "cases": int(value)}
                                   for name, value in observed.items()],
            "cases_for_pattern":  int(here["_cases"].sum()) if not here.empty else 0,
        })
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/disease-forecast", methods=["POST"])
def disease_forecast():
    """
    Next-months case forecast for one disease, from the pooled model.

    Body: {diagnosis, steps?}
    Returns the forecast plus the holdout error and the baseline it beat, so the
    caller can present accuracy rather than a bare number.
    """
    data = request.json or {}
    diagnosis = str(data.get("diagnosis", "")).strip()
    if diagnosis == "":
        return jsonify({"success": False, "error": "diagnosis is required"}), 400
    try:
        steps = max(1, min(12, int(data.get("steps", 3) or 3)))
        return jsonify({"success": True, "data": forecast_disease_cases(diagnosis, steps)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# POST accepted too: dashboard.php proxies through analytics_post(),
# which always POSTs. A GET-only route would answer it with a 405.
@app.route("/disease-forecast-info", methods=["GET", "POST"])
def disease_forecast_info():
    """Diagnostics for the pooled forecaster: what it trained on and how it scored."""
    m = get_disease_forecast_model()
    if not m.get("available"):
        return jsonify({"success": False, "error": m.get("reason", "unavailable")}), 503
    return jsonify({"success": True, "data": {
        "trained_on": m["trained_on"], "n_diseases": m["n_diseases"],
        "holdout_mae": m["holdout_mae"], "baseline_mae": m["baseline_mae"],
        "improvement_pct": m["improvement_pct"],
        "importance": m["importance"], "note": m["note"],
    }})


@app.route("/diagnosis-options", methods=["GET", "POST"])
def diagnosis_options():
    """The symptom clusters and animal groups the model was trained on."""
    model = get_diagnosis_model()
    if not model.get("available"):
        return jsonify({"success": False, "error": model.get("reason", "unavailable")}), 503
    return jsonify({"success": True, "data": {
        "symptom_clusters": model["symptom_clusters"],
        "animal_groups":    model["animal_groups"],
        "top1_accuracy":    model["top1_accuracy"],
        "top3_accuracy":    model["top3_accuracy"],
        "lookup_baseline":  model["lookup_baseline"],
        "n_classes":        model["n_classes"],
        "trained_on":       model["trained_on"],
    }})


@app.route("/invalidate-disease-cache", methods=["POST"])
def invalidate_disease_cache():
    """
    Drops everything derived from the consultation dataset so the next request
    rebuilds from the newly-activated version.

    Called by api/dataset/dataset.php after an upload or a version rollback.
    This is a latency optimisation ONLY -- correctness comes from
    ensure_dataset_version_fresh(), which re-checks the active version id before
    every read. If this call never arrives (service restarting, network blip),
    the next request notices the version change by itself. That distinction
    matters here in a way it does not for the vaccination sibling: two of the
    three caches this clears have no expiry at all, so a missed push would
    otherwise be permanent rather than merely slow.
    """
    result = invalidate_disease_caches()
    print(f"[cache] disease dataset invalidated: {result['forecast_keys_cleared']} forecast key(s), "
          f"models_dropped={result['models_dropped']}")
    return jsonify({"success": True, "data": result})


@app.route("/invalidate-vaccination-cache", methods=["POST"])
def invalidate_vaccination_cache():
    """
    Drops the cached vaccination forecasts so the next request recomputes.

    Called by api/mass-vaccination/events.php when an event becomes Completed,
    or when an already-Completed event is edited or deleted. Without it a newly
    completed event waits out CACHE_TTL (6 hours), and the per-barangay numbers
    never refresh at all -- _barangay_vacc_cache has no expiry and is only
    cleared by restarting the service.

    Deliberately narrow: it clears the two vacc_* key families and the barangay
    dict, and nothing else. The disease SARIMA entries are the expensive ones
    (~15-20s per filter to rebuild) and have no reason to be dropped when a
    vaccination event is encoded, so they are left alone along with their TTL.

    Invalidation is not eligibility. The plausibility gate still decides whether
    live months reach the fit -- this only guarantees the decision is made
    against current data.
    """
    stale = [key for key in list(_cache.keys()) if key.startswith("vacc_")]
    for key in stale:
        _cache.pop(key, None)

    barangay_cleared = len(_barangay_vacc_cache)
    _barangay_vacc_cache.clear()

    print(f"[cache] vaccination forecast invalidated: {len(stale)} forecast key(s), "
          f"{barangay_cleared} barangay entr(ies)")
    return jsonify({"success": True, "data": {
        "forecast_keys_cleared":    len(stale),
        "barangay_entries_cleared": barangay_cleared,
    }})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok", "service": "BVetter Analytics v3.1",
        # This list previously advertised "CACHE_TTL 300->600" long after the
        # constant had been raised to 21600. Reported from the constant now, so
        # it cannot drift out of date again.
        "cache_ttl_seconds": CACHE_TTL,
        "vaccination_cache_invalidation": "POST /invalidate-vaccination-cache",
        "fixes": [f"CACHE_TTL {CACHE_TTL}s ({CACHE_TTL // 3600}h), invalidated on event completion",
                  "SARIMA grid 81→16 combos",
                  "Bootstrap CI 1000→200", "RF warm-start at boot",
                  "Annual predicted = sum(12-month ARIMA forecast)",
                  "Workbook 2023/24 de-cumulated from year-to-date",
                  "Live months gated on MIN_PLAUSIBLE_SHARE_OF_MEDIAN"],
    })


if __name__ == "__main__":
    # SPEED-4: warm-start the RF model so first page load is instant
    try:
        print("Warming up All-Disease RF model at startup…")
        get_all_disease_models()
        print("Warm-up complete. Server ready.")
    except Exception as _e:
        print(f"Warm-up skipped (will train on first request): {_e}")
    app.run(host="0.0.0.0", port=5001, debug=False)

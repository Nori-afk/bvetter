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

from sklearn.ensemble import RandomForestClassifier
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
    global _all_disease_models, _consult_diagnosis_df

    stale = [k for k in list(_cache.keys()) if k.startswith("ds_") or k.startswith("hybrid_")]
    for key in stale:
        _cache.pop(key, None)

    had_models = bool(_all_disease_models)
    _all_disease_models = {}
    _consult_diagnosis_df = None

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
FEATURE_COLS = [
    "lag_1", "lag_2", "lag_3",
    "rolling_mean_3", "rolling_max_3", "rolling_std_3",
    "month_sin", "month_cos", "month_no", "year",
]

_all_disease_models = {}


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


def load_all_disease_dataframe() -> pd.DataFrame:
    df = read_excel_sheet("Barangay_Disease_Monthly")
    df = df[pd.to_numeric(df["year"], errors="coerce").notna()].copy()
    df["year"]        = df["year"].astype(int)
    df["month_no"]    = pd.to_numeric(df["month_no"], errors="coerce").fillna(1).astype(int)
    df["total_cases"] = pd.to_numeric(df["total_cases"], errors="coerce").fillna(0)
    df["is_db_sourced"] = False
    df["is_zero_filled"] = False

    after_year, after_month = _latest_period(df)
    db_df = load_db_disease_monthly(after_year, after_month)
    if not db_df.empty:
        df = pd.concat([df, db_df], ignore_index=True, sort=False)

    coverage_cutoff = load_coverage_cutoff()
    df = _fill_declared_coverage(df, (after_year, after_month), coverage_cutoff)
    df["is_zero_filled"] = df["is_zero_filled"].fillna(False).astype(bool)
    df = _label_live_rows(df, coverage_cutoff)

    df = df.sort_values(["barangay", "year", "month_no"]).reset_index(drop=True)
    grp = df.groupby("barangay")["total_cases"]
    df["lag_1"]          = grp.shift(1)
    df["lag_2"]          = grp.shift(2)
    df["lag_3"]          = grp.shift(3)
    df["rolling_mean_3"] = grp.transform(lambda x: x.shift(1).rolling(3).mean())
    df["rolling_max_3"]  = grp.transform(lambda x: x.shift(1).rolling(3).max())
    df["rolling_std_3"]  = grp.transform(lambda x: x.shift(1).rolling(3).std().fillna(0))
    df["month_sin"]      = np.sin(2 * np.pi * df["month_no"] / 12)
    df["month_cos"]      = np.cos(2 * np.pi * df["month_no"] / 12)
    total = df["total_cases"].replace(0, 1)
    df["skin_ratio"]   = pd.to_numeric(df.get("skin_related_cases",    0), errors="coerce").fillna(0) / total
    df["para_ratio"]   = pd.to_numeric(df.get("parasitic_cases",       0), errors="coerce").fillna(0) / total
    df["resp_ratio"]   = pd.to_numeric(df.get("respiratory_cases",     0), errors="coerce").fillna(0) / total
    df["gastro_ratio"] = pd.to_numeric(df.get("gastrointestinal_cases",0), errors="coerce").fillna(0) / total
    return df.dropna(subset=["lag_1", "lag_2", "lag_3", "rolling_mean_3"])


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
    print("Training All-Disease Hybrid (ARIMA + RandomForestClassifier)…")
    df     = load_all_disease_dataframe()
    n_db_rows = int(df.get("is_db_sourced", pd.Series(dtype=bool)).sum())
    arima_df = _arima_safe_frame(df, load_coverage_cutoff())
    n_arima_db_rows = int(arima_df.get("is_db_sourced", pd.Series(dtype=bool)).sum())
    arima_series = _build_arima_series_for_df(arima_df)
    arima_acc    = _arima_pooled_accuracy(arima_series)

    # Rows carrying a risk_class: every Excel row, plus any genuinely-encoded
    # live month inside the declared coverage window that _label_live_rows
    # banded (never a zero-filled placeholder -- see that function).
    df_cls = df[df["risk_class"].notna()].reset_index(drop=True)
    X_cls  = df_cls[FEATURE_COLS].values
    le     = LabelEncoder()
    y_cls  = le.fit_transform(df_cls["risk_class"].astype(str))

    # The held-out set is drawn from Excel rows ONLY. Their labels ship with the
    # source data; live labels are derived by applying risk_class_from_volume.
    # Scoring against derived labels would collapse the reported accuracy into
    # "can the forest reproduce a threshold function", so live rows are allowed
    # to train but never to be graded on.
    is_excel  = ~df_cls["is_db_sourced"].to_numpy(dtype=bool)
    excel_idx = np.flatnonzero(is_excel)
    live_idx  = np.flatnonzero(~is_excel)
    n_live_labeled = int(live_idx.size)

    # Stratified (not chronological) split: the "Low" class is only ~6 of
    # ~891 rows, all early in sort order -- a chronological split would make
    # it invisible during evaluation.
    train_excel, test_idx = train_test_split(
        excel_idx, test_size=0.2, random_state=42, stratify=y_cls[excel_idx])
    train_idx = np.concatenate([train_excel, live_idx]) if live_idx.size else train_excel

    # SMOTE on the training fold only (never the held-out test set), to
    # address that same scarcity. k_neighbors is capped below the smallest
    # class's count in the training fold so SMOTE doesn't hard-fail on it.
    train_class_counts = pd.Series(y_cls[train_idx]).value_counts()
    k_neighbors = max(1, min(5, int(train_class_counts.min()) - 1))
    X_train_bal, y_train_bal = SMOTE(
        random_state=42, k_neighbors=k_neighbors
    ).fit_resample(X_cls[train_idx], y_cls[train_idx])

    # Case-count features (lag_1/2/3, rolling_mean/max/std_3) are included
    # this time -- see the module docstring (MODEL-1) and the note below for
    # why an earlier version of this exact classifier deliberately excluded
    # them, and what that caused.
    rf_cls = RandomForestClassifier(n_estimators=200, max_depth=10,
        min_samples_split=4, min_samples_leaf=2, random_state=42, n_jobs=-1)
    rf_cls.fit(X_train_bal, y_train_bal)

    y_test_cls  = y_cls[test_idx]
    preds_test  = rf_cls.predict(X_cls[test_idx])
    all_labels  = np.arange(len(le.classes_))
    accuracy_val = round(float(accuracy_score(y_test_cls, preds_test)) * 100, 1)
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_test_cls, preds_test, labels=all_labels, zero_division=0)
    cm = confusion_matrix(y_test_cls, preds_test, labels=all_labels)
    importance = dict(sorted(
        {FEATURE_COLS[i]: round(float(v), 4) for i, v in enumerate(rf_cls.feature_importances_)}.items(),
        key=lambda x: x[1], reverse=True))

    # Feature history, because this has been wrong in both directions.
    #
    # v1 included the lag/rolling case-count features. v2 removed them, on the
    # theory that seeing case counts let the model trivially reconstruct
    # risk_class. That was the wrong cut: risk_class IS a band on volume, so
    # hiding volume removed the one legitimate signal that defines the label,
    # and Tiaong -- the highest-volume barangay in the dataset, always "High"
    # in the source -- came out "Low/stable". v3 restored them.
    #
    # v3 still scored a perfect 100.0%, which was the real tell. The leak was
    # never lag/rolling (those are .shift(1), strictly past). It was the four
    # disease-mix ratios: current-month category counts over total_cases, and
    # total_cases is what defines the label. Ablation confirmed it -- the four
    # ratios ALONE scored 99.4%, against a 67.7% majority baseline.
    #
    # v4 (this one) keeps the past-only case-count features and drops the four
    # ratios; see FEATURE_COLS for the measured effect on prediction
    # calibration. Held-out accuracy is now 97.2% rather than a perfect score.
    # The stratified split + SMOTE stay: that part of v2 was never the problem,
    # the "Low" class really does have only ~6 rows.
    #
    # Low remains unlearnable and is reported rather than hidden: with 6 Low
    # rows in 891, the held-out fold contains 1, and the model misses it
    # (precision and recall both 0.0). No resampling fixes 6 real examples.
    # Treat Low as undetected, not as detected-with-low-confidence.
    _all_disease_models = {
        "df": df, "classifier": rf_cls, "label_encoder": le,
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
        "importance": importance, "trained_on": len(df_cls),
        "db_rows_added": n_db_rows,
        "cls_train_idx": train_idx, "cls_test_idx": test_idx,
        "classifier_accuracy": accuracy_val,
        "classifier_precision": {cls: round(float(v), 3) for cls, v in zip(le.classes_, precision)},
        "classifier_recall": {cls: round(float(v), 3) for cls, v in zip(le.classes_, recall)},
        "classifier_f1": {cls: round(float(v), 3) for cls, v in zip(le.classes_, f1)},
        "classifier_confusion_matrix": cm.tolist(),
        "classifier_classes": list(le.classes_),
        "arima_series": arima_series,
        "arima_cache": {}, "rf_model_type": "RandomForestClassifier",
        # Developer-facing explanation for the /hybrid-model-info diagnostic
        # endpoint. Not shown in the vet UI -- see "risk_note_short" for that.
        "risk_note": (
            f"Risk classification is a RandomForestClassifier trained on "
            f"{len(df_cls)} risk_class-labeled rows from Barangay_Disease_Monthly, "
            "using past-only case-count features (lag_1/2/3 and rolling stats, all "
            "shifted one month) plus calendar terms. An earlier version excluded the "
            "case-count features entirely and misclassified Tiaong (the highest-volume "
            "barangay in the dataset) as Low risk, because volume was the one signal "
            "hidden from it; a later version added current-month disease-mix ratios "
            "and scored a perfect 100%, which was target leakage -- those ratios are "
            "category counts over total_cases, and total_cases defines the label. "
            "Train/test split is stratified by risk_class (not chronological), and "
            "SMOTE oversampling is applied to the training fold only, because the Low "
            f"class has only ~6 of {len(df_cls)} rows. Held-out accuracy: {accuracy_val}%. "
            "The Low class is not detected at all (precision and recall both 0.0 on a "
            "single held-out row) and should be read as undetected rather than as a "
            "low-confidence detection. "
            f"Live rows from patient_visit_records ({n_db_rows} beyond the Excel "
            f"snapshot's latest month, {n_arima_db_rows} of those trusted into the "
            "ARIMA/SARIMA series -- see _arima_safe_frame) carry no risk_class in the "
            f"source data; {n_live_labeled} of them fall inside the encoder-declared "
            "coverage window and are banded by risk_class_from_volume() so they can "
            "train the classifier, which otherwise never sees the low-volume regime "
            "live data occupies (Excel spans 9-30 cases/month, live months 1-7). "
            "Zero-filled placeholder months are excluded from that labelling, and the "
            "held-out test set is drawn from Excel rows only, so the accuracy above is "
            "measured against labels that ship with the source data rather than ones "
            "this service derived. Reported MAE/RMSE/MAPE below are ARIMA's own pooled 3-month "
            "holdout accuracy across barangays -- the RandomForestRegressor that used "
            "to report this number never produced a live forecast (ARIMA/SARIMA "
            "already did, for both month and year views) and has been removed."
        ),
        # Plain-language version shown in the vet-facing insight panel --
        # no model names or stats jargon.
        "risk_note_short": (
            "Case volume level is predicted by a trained Random Forest model from "
            "each barangay's recent case history and the time of year. "
            "It measures how many cases to expect, not how severe they are."
        ),
    }
    print(f"All-Disease model ready — Classifier accuracy {accuracy_val}%, "
          f"ARIMA pooled MAE {arima_acc['mae']} "
          f"({n_db_rows} live DB rows blended into ARIMA training)")
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

    # Risk label comes from the trained RandomForestClassifier (see
    # get_all_disease_models() for training details/history) instead of a
    # threshold rule.
    rf_cls = models["classifier"]
    le     = models["label_encoder"]

    # Current risk: classifier on this barangay's latest trusted feature row.
    # If a live current_override was supplied, it replaces lag_1 so the
    # predicted risk reflects the same number shown in "current_cases"
    # instead of contradicting it with a stale feature row.
    cur_feat = latest_row[FEATURE_COLS].values.astype(float).copy()
    if current_override is not None:
        cur_feat[FEATURE_COLS.index("lag_1")] = current_cases
    current_risk_label = le.inverse_transform(rf_cls.predict(cur_feat.reshape(1, -1)))[0]

    # Future risk: shift lag_1/2/3, recompute rolling stats using the ARIMA
    # next-month forecast as the new lag_1, and advance the calendar features
    # one month -- the same feature-construction technique this classifier
    # used historically for a not-yet-observed month.
    #
    # Every feature is now either shifted or calendar-derived, so the whole
    # row describes a month that has already happened or is known in advance.
    # This used to also carry four current-month disease-mix ratios forward
    # unchanged, because next month's mix is unknowable -- which left 43.7% of
    # the decision weight one month stale, more than lag_1 itself, and pulled
    # the High threshold down to a forecast of 12-15 when the band definition
    # starts High at 16. Those features are gone; see FEATURE_COLS.
    fut_feat = cur_feat.copy()
    l1, l2, l3 = (FEATURE_COLS.index(c) for c in ("lag_1", "lag_2", "lag_3"))
    rm, rx, rs = (FEATURE_COLS.index(c) for c in ("rolling_mean_3", "rolling_max_3", "rolling_std_3"))
    ms, mc, mn, yr = (FEATURE_COLS.index(c) for c in ("month_sin", "month_cos", "month_no", "year"))
    old1, old2 = fut_feat[l1], fut_feat[l2]
    fut_feat[l3], fut_feat[l2], fut_feat[l1] = old2, old1, arima_next
    window = [arima_next, old1, old2]
    fut_feat[rm], fut_feat[rx], fut_feat[rs] = np.mean(window), np.max(window), float(np.std(window, ddof=0))
    cur_month_no  = int(latest_row["month_no"])
    next_month_no = (cur_month_no % 12) + 1
    fut_feat[mn] = next_month_no
    fut_feat[ms] = np.sin(2 * np.pi * next_month_no / 12)
    fut_feat[mc] = np.cos(2 * np.pi * next_month_no / 12)
    fut_feat[yr] = int(latest_row["year"]) + (1 if cur_month_no == 12 else 0)

    fut_proba  = rf_cls.predict_proba(fut_feat.reshape(1, -1))[0]
    fut_label  = le.inverse_transform([int(np.argmax(fut_proba))])[0]
    proba_dict = {cls: round(float(p), 3) for cls, p in zip(le.classes_, fut_proba)}
    confidence = round(float(np.max(fut_proba)) * 100, 1)

    trend      = arima_result["trend"]
    risk_lower = str(fut_label).lower()
    agreement  = (
        (trend == "rising"  and risk_lower in ["high", "medium"]) or
        (trend == "stable"  and risk_lower == "medium") or
        (trend == "falling" and risk_lower in ["low",  "medium"])
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
        "rf_current_risk": str(current_risk_label),
        "rf_future_risk": str(fut_label),
        "rf_future_proba": proba_dict,
        "rf_confidence": confidence,
        "rf_model_type": "RandomForestClassifier",
        "model_agreement": agreement,
        "fused_predicted": arima_next,
        # SCALE-1: period-correct display value for bar chart
        "predicted_cases":  predicted_display,
        "predicted_lower":  lo_display,
        "predicted_upper":  hi_display,
        "predicted_period": period,
        "model_type": f"AllDisease{arima_result['model_type']}+RandomForestClassifier",
    }


def _empty_prediction(barangay_name: str) -> dict:
    return {
        "barangay": barangay_name, "current_cases": 0,
        "arima_forecast": [0], "arima_lower_ci": [0], "arima_upper_ci": [0],
        "arima_trend": "stable", "arima_order": [0, 0, 0],
        "rf_current_risk": "Low", "rf_future_risk": "Low",
        "rf_future_proba": {"Low": 1.0}, "rf_confidence": 0.0,
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
    cols = ["barangay", "year", "month_no", "diagnosis", "cases_reported", "is_db_sourced"]
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
                    pvr.diagnosis AS diagnosis
                FROM patient_visit_records pvr
                LEFT JOIN pets ON pets.id = pvr.pet_id
                LEFT JOIN owner_profiles op ON op.user_id = pets.owner_id
                LEFT JOIN barangays b ON b.id = op.barangay_id
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
            {"level":"red",   "title":"Immediate: Field Deployment",
             "detail":f"{model} predicts {future:.0f} {disease} cases next month in {barangay}. Deploy veterinary field team."},
            {"level":"blue",  "title":"Within 24 hrs: Report to MHO",
             "detail":f"Escalate {disease} cluster. Likely range: {fc['lower_ci'][0]:.0f}\u2013{fc['upper_ci'][0]:.0f} cases. Trend: {trend}."},
            {"level":"green", "title":"Preventive: Targeted Treatment Drive",
             "detail":f"Schedule mass treatment for {disease} in {barangay}. Current: {current:.0f} vs avg {avg:.1f}."},
            {"level":"gray",  "title":"Monitoring: Weekly Review",
             "detail":f"Track until rule-based risk falls. 3-month forecast: {fc['forecast'][:3]}."},
        ]
    elif future_risk == "Medium":
        return [
            {"level":"red",   "title":"Priority: Cluster Validation",
             "detail":f"{model} predicts {future:.0f} {disease} in {barangay}. Confirm active clusters."},
            {"level":"blue",  "title":"Within 72 hrs: Vet Coordination",
             "detail":f"Schedule district vet visit. Trend: {trend}. Likely range: {fc['lower_ci'][0]:.0f}\u2013{fc['upper_ci'][0]:.0f} cases."},
            {"level":"green", "title":"Preventive: Community Briefing",
             "detail":f"Run barangay broadcast for {disease} in {barangay}."},
            {"level":"gray",  "title":"Monitoring: Bi-Weekly Review",
             "detail":f"Escalate if threshold exceeded. Forecast: {future:.0f} cases."},
        ]
    return [
        {"level":"red",   "title":"No Immediate Action Required",
         "detail":f"{model} predicts {future:.0f} {disease} — LOW case volume. Trend: {trend}."},
        {"level":"blue",  "title":"Routine: Monthly Reporting",
         "detail":f"Maintain standard cadence. Current: {current:.0f} in {barangay}."},
        {"level":"green", "title":"Preventive: Quarterly Campaign",
         "detail":f"Include {barangay} in next {disease} campaign."},
        {"level":"gray",  "title":"Monitoring: Standard Surveillance",
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

def _build_all_disease_protocol(barangay, pred, avg_cases, models):
    risk   = pred["rf_future_risk"].lower()
    trend  = pred["arima_trend"]
    conf   = pred["rf_confidence"]
    fused  = pred["fused_predicted"]
    current= pred["current_cases"]
    proba_str = ", ".join([f"{k}: {round(v*100)}%" for k, v in pred["rf_future_proba"].items()])
    an = ("The forecast trend and case volume level agree." if pred["model_agreement"]
          else f"Note: the case trend is '{trend}' while case volume is classified as {pred['rf_future_risk']}.")
    fc = pred["arima_forecast"]
    if risk == "high":
        tier = "critical"
        steps = [
            {"level":"red",  "title":"Immediate: Field Deployment",
             "detail":f"The forecast predicts {fused:.0f} next month ({conf}% confidence, trend: {trend}). Deploy to {barangay}. {an}"},
            {"level":"blue", "title":"Within 24 hrs: Regulatory Reporting",
             "detail":f"Escalate to MHO. Case volume outlook — {proba_str}. Likely range: {pred['arima_lower_ci'][0]:.0f}\u2013{pred['arima_upper_ci'][0]:.0f} cases."},
            {"level":"green","title":"Preventive: Targeted Sanitation",
             "detail":f"Focus on {barangay}. Current: {current:.0f} vs avg {avg_cases:.1f}."},
            {"level":"gray", "title":"Monitoring: Weekly Review", "detail":f"Track until case volume reclassifies. Forecast: {fc}."},
        ]
    elif risk in ["medium","moderate"]:
        tier = "monitor"
        steps = [
            {"level":"red",  "title":"Priority: Cluster Validation",
             "detail":f"The forecast predicts {fused:.0f} next month. Confirm clusters in {barangay}. {an}"},
            {"level":"blue", "title":"Within 72 hrs: Vet Coordination",
             "detail":f"Case volume outlook: {proba_str}. Likely range: {pred['arima_lower_ci'][0]:.0f}\u2013{pred['arima_upper_ci'][0]:.0f} cases."},
            {"level":"green","title":"Preventive: Community Briefing", "detail":f"Broadcast for {barangay}. {conf}% confidence."},
            {"level":"gray", "title":"Monitoring: Bi-Weekly Review", "detail":f"Escalate if case volume reclassifies. Predicted: {fused:.0f}."},
        ]
    else:
        tier = "stable"
        steps = [
            {"level":"red",  "title":"No Immediate Action Required",
             "detail":f"LOW case volume ({conf}% confidence, trend: {trend}). {an}"},
            {"level":"blue", "title":"Routine: Monthly Reporting", "detail":f"Maintain cadence. Predicted: {fused:.0f}."},
            {"level":"green","title":"Preventive: Quarterly Campaign", "detail":f"Include {barangay} in next campaign."},
            {"level":"gray", "title":"Monitoring: Standard Surveillance",
             "detail":f"Escalate if > {round(avg_cases * 1.3, 1)} cases."},
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
                "confidence": pred["rf_confidence"], "rf_model_type": "RandomForestClassifier",
                "risk_note": models.get("risk_note_short", ""),
                # SCALE-1: period-correct predicted_cases for bar chart
                "predicted_cases":  pred.get("predicted_cases", pred["fused_predicted"]),
                "predicted_lower":  pred.get("predicted_lower",  pred["fused_predicted"]),
                "predicted_upper":  pred.get("predicted_upper",  pred["fused_predicted"]),
                "predicted_period": period,
                "fused_predicted": pred["fused_predicted"],
                "model_agreement": pred["model_agreement"], "tier": tier,
                "recommendation": (
                    f"{barangay} — Case volume: {pred['rf_future_risk']} "
                    f"({pred['rf_confidence']}% confidence), trend: {pred['arima_trend']}, "
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

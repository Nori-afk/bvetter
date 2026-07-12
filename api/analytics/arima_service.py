"""
VBetter Analytics Backend — v3.1 (Speed + Scaling fixes applied to v3)
=======================================================================
Changes from v3:
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

from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split

warnings.filterwarnings("ignore")
app = Flask(__name__)

EXCEL_PATH = os.path.join(os.path.dirname(__file__), "../../database/BaliwagVet_2023-2025.xlsx")

# Same DB this app's PHP layer connects to (api/config/connection.php) — kept
# overridable via env vars for deployments where the DB isn't local XAMPP.
DB_CONFIG = {
    "host":     os.environ.get("VBETTER_DB_HOST", "localhost"),
    "user":     os.environ.get("VBETTER_DB_USER", "root"),
    "password": os.environ.get("VBETTER_DB_PASS", "root"),
    "database": os.environ.get("VBETTER_DB_NAME", "bvetter"),
    "charset":  "utf8mb4",
}


def db_connect():
    return pymysql.connect(cursorclass=pymysql.cursors.DictCursor, **DB_CONFIG)

_cache    = {}
# SPEED-7: raised 600s -> 6h. The source Excel file only changes on a service
# restart anyway (it's read fresh from disk on first cache-miss, never hot-
# reloaded), so there's no correctness reason to re-run an expensive ~15-20s
# disease-specific SARIMA search every 10 minutes. This makes every disease
# filter pay its cost once per server run instead of once per 10-minute window,
# matching how _all_disease_models/arima_cache already never expire.
CACHE_TTL = 21600


def cache_get(key):
    entry = _cache.get(key)
    return entry["data"] if entry and entry["expires"] > time.time() else None


def cache_set(key, data):
    _cache[key] = {"data": data, "expires": time.time() + CACHE_TTL}


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
    previous_totals = [float(totals[str(year)]) for year in years[:-1]]
    previous_median = float(np.median(previous_totals)) if previous_totals else 0.0
    latest_total = float(totals[str(latest_year)])
    ratio = latest_total / previous_median if previous_median > 0 else 1.0
    regime_shift = previous_median > 0 and ratio < 0.45

    return {
        "regime_shift": regime_shift,
        "year_totals": totals,
        "latest_year": latest_year,
        "latest_year_total": round(latest_total, 1),
        "previous_year_median": round(previous_median, 1),
        "latest_vs_previous_ratio": round(ratio, 3),
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
                f"Latest year total ({diagnostics['latest_year_total']}) is only "
                f"{round(diagnostics['latest_vs_previous_ratio'] * 100)}% of the "
                f"previous-year median ({diagnostics['previous_year_median']}). "
                "Forecast is floored to a seasonal demand baseline; verify the latest-year records."
            )
        else:
            ar["data_quality_note"] = (
                "Raw ARIMA forecast collapsed below the seasonal vaccination baseline. "
                "Forecast is floored for operational stock planning."
            )
    else:
        ar["regime_shift"] = False
        ar["forecast_collapse"] = False
        ar["seasonal_baseline"] = baseline
        ar["data_quality_note"] = ""

    ar["year_totals"] = diagnostics.get("year_totals", {})
    return ar


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
    return s[~s.index.duplicated(keep="last")].asfreq("M", fill_value=0)


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

    series_dict = {
        "total_vaccinated": total, "dogs_vaccinated": dogs,
        "cats_vaccinated": cats, "clients_served": clients,
    }
    df = pd.concat([total, dogs, cats, clients], axis=1).reset_index()
    df.columns = ["period", "total_vaccinated", "dogs_vaccinated", "cats_vaccinated", "clients_served"]
    return series_dict, df


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
        series_dict, _ = load_vaccination_series()
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
        series_dict, _ = load_vaccination_series()
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
                "Vaccination records or raw ARIMA output need baseline adjustment. "
                "Use the adjusted seasonal forecast for stock planning and verify the source data.",
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
# ALL-DISEASE HYBRID  (ARIMA forecast + RandomForestRegressor accuracy check
# + rule-based risk thresholds — see get_all_disease_models() for why risk
# is threshold-based rather than a trained classifier)
# ════════════════════════════════════════════════════════════════════════

FEATURE_COLS = [
    "lag_1", "lag_2", "lag_3",
    "rolling_mean_3", "rolling_max_3", "rolling_std_3",
    "month_sin", "month_cos", "month_no", "year",
    "skin_ratio", "para_ratio", "resp_ratio", "gastro_ratio",
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

    DB rows have no risk_class (that's a label from the Excel sheet with no
    live equivalent yet), so they're tagged is_db_sourced=True and excluded
    from the RF risk classifier's training set in get_all_disease_models();
    they still feed the ARIMA series and the case-count regressor.
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
                    COALESCE(NULLIF(b.name, ''), NULLIF(op.complete_address, ''), 'Unspecified') AS barangay,
                    pvr.disease_category  AS disease_category,
                    COUNT(*) AS cases
                FROM patient_visit_records pvr
                INNER JOIN pets ON pets.id = pvr.pet_id
                LEFT JOIN owner_profiles op ON op.user_id = pets.owner_id
                LEFT JOIN barangays b ON b.id = op.barangay_id
                WHERE pvr.visit_date IS NOT NULL
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
    return grouped


def load_all_disease_dataframe() -> pd.DataFrame:
    df = read_excel_sheet("Barangay_Disease_Monthly")
    df = df[pd.to_numeric(df["year"], errors="coerce").notna()].copy()
    df["year"]        = df["year"].astype(int)
    df["month_no"]    = pd.to_numeric(df["month_no"], errors="coerce").fillna(1).astype(int)
    df["total_cases"] = pd.to_numeric(df["total_cases"], errors="coerce").fillna(0)
    df["is_db_sourced"] = False

    after_year, after_month = _latest_period(df)
    db_df = load_db_disease_monthly(after_year, after_month)
    if not db_df.empty:
        df = pd.concat([df, db_df], ignore_index=True, sort=False)

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


def _arima_safe_frame(df: pd.DataFrame) -> pd.DataFrame:
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
    """
    keep_mask = ~df["is_db_sourced"]
    for barangay, bdf in df[df["is_db_sourced"]].groupby("barangay"):
        excel_bdf = df[(df["barangay"] == barangay) & (~df["is_db_sourced"])]
        expected_year, expected_month = _latest_period(excel_bdf)
        for row_idx, row in bdf.sort_values(["year", "month_no"]).iterrows():
            expected_month += 1
            if expected_month > 12:
                expected_month, expected_year = 1, expected_year + 1
            if int(row["year"]) == expected_year and int(row["month_no"]) == expected_month:
                keep_mask.loc[row_idx] = True
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


def get_all_disease_models():
    global _all_disease_models
    if _all_disease_models:
        return _all_disease_models
    print("Training All-Disease Hybrid (ARIMA + RuleBasedThreshold)…")
    df     = load_all_disease_dataframe()
    X      = df[FEATURE_COLS].values
    y_reg  = df["total_cases"].values
    n_db_rows = int(df.get("is_db_sourced", pd.Series(dtype=bool)).sum())
    arima_df = _arima_safe_frame(df)
    n_arima_db_rows = int(arima_df.get("is_db_sourced", pd.Series(dtype=bool)).sum())

    # Regressor trains on the FULL history (Excel + live DB continuation) —
    # forecasting case counts from past case counts doesn't
    # need a risk_class label, so DB rows are safe to include here. This is
    # only used for the reported MAE/RMSE/MAPE accuracy metrics, not for
    # producing forecasts (ARIMA does that) or risk labels (see below).
    idx = np.arange(len(df))
    train_idx, test_idx = train_test_split(idx, test_size=0.2, random_state=42)

    rf_reg = RandomForestRegressor(n_estimators=200, max_depth=10,
        min_samples_split=4, min_samples_leaf=2, random_state=42, n_jobs=-1)
    rf_reg.fit(X[train_idx], y_reg[train_idx])
    preds_test = rf_reg.predict(X[test_idx])
    mae_val  = round(float(mean_absolute_error(y_reg[test_idx], preds_test)), 2)
    rmse_val = rmse(y_reg[test_idx], preds_test)
    mape_val = mape(y_reg[test_idx], preds_test)
    importance = dict(sorted(
        {FEATURE_COLS[i]: round(float(v), 4) for i, v in enumerate(rf_reg.feature_importances_)}.items(),
        key=lambda x: x[1], reverse=True))

    # Risk classification used to be a RandomForestClassifier deliberately
    # trained WITHOUT case-count features (lag_1/2/3, rolling stats), out of
    # concern that those features let it trivially reconstruct risk_class
    # and "inflate" accuracy to 100%. In practice, risk_class in the source
    # data barely overlaps by case count (Low ~9, Medium 10-17, High 16-30)
    # -- it IS essentially a threshold on volume, so hiding volume from the
    # classifier didn't reduce overfitting, it removed the one signal that
    # defines the label. Real-world result: a barangay with the highest
    # case count in the whole dataset (Tiaong, consistently 21-30/month,
    # always "High" in the source data) got classified "Low/stable" because
    # the model could only see season + disease-mix, not volume. Replaced
    # with the same transparent, verifiable threshold rule already used for
    # the per-disease pipeline (_disease_risk_thresholds/_disease_risk_label)
    # instead of an ML classifier that was trained not to know the answer.
    _all_disease_models = {
        "df": df, "regressor": rf_reg,
        "mae": mae_val, "rmse": rmse_val, "mape": mape_val,
        "importance": importance, "trained_on": len(df),
        "db_rows_added": n_db_rows,
        "train_idx": train_idx, "test_idx": test_idx,
        "arima_series": _build_arima_series_for_df(arima_df),
        "arima_cache": {}, "rf_model_type": "RuleBasedThreshold",
        "risk_note": (
            "Risk classification uses simple, verifiable thresholds on case count "
            "(< p50 = Low, p50-p75 = Medium, >= p75 = High, computed fresh from the "
            "current cases across all barangays each request) instead of a trained "
            "ML classifier. Source data shows risk_class barely overlaps by volume "
            "(Low ~9 cases, Medium 10-17, High 16-30), so a threshold rule matches "
            "the ground truth directly and can't misclassify a high-volume barangay "
            "as low risk the way a classifier trained without volume features could. "
            f"The regressor (used only for the MAE/RMSE/MAPE accuracy metrics below, "
            f"not for forecasts or risk) trains on {n_db_rows} live row(s) from "
            "patient_visit_records beyond the Excel snapshot's latest month. Of those, "
            f"only {n_arima_db_rows} feed the ARIMA/SARIMA series -- ARIMA only trusts "
            "a live month once it forms an unbroken run right after the Excel "
            "snapshot's last month, since a single sparse or gap-broken month at the "
            "tail of the series would otherwise crater the forecast (a real example: "
            "one under-logged month misread as 'cases collapsed to near zero')."
        ),
    }
    print(f"All-Disease model ready — MAE {mae_val}, RMSE {rmse_val} "
          f"({n_db_rows} live DB rows blended into regressor/ARIMA training)")
    return _all_disease_models


def _hybrid_predict_one_alldisease(
    barangay_name: str, models: dict, steps: int, current_override, period: str = "year",
    thresholds: dict = None,
) -> dict:
    df           = models["df"]
    arima_series = models["arima_series"]
    arima_cache  = models.setdefault("arima_cache", {})

    bdf = df[df["barangay"] == barangay_name].sort_values(["year", "month_no"])
    if bdf.empty:
        return _empty_prediction(barangay_name)

    latest_row    = bdf.iloc[-1]
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

    # Risk label is a simple, verifiable threshold on case count -- same
    # approach as the per-disease pipeline (_disease_risk_thresholds /
    # _disease_risk_label) -- rather than an ML classifier. See the note in
    # get_all_disease_models() for why: a classifier trained without
    # case-count features can't tell a high-volume barangay from a low-volume
    # one, which is exactly backwards for a "how risky is this" question.
    thresholds = thresholds or {"low_max": 0, "med_max": 0}
    current_risk_label = _disease_risk_label(current_cases, thresholds)
    fut_label           = _disease_risk_label(predicted_display, thresholds)
    proba_dict = {
        "High": round(min(1.0, predicted_display / max(thresholds["med_max"], 1)), 3) if thresholds["med_max"] > 0 else 0.0,
        "Medium": 0.0, "Low": 0.0,
    }
    proba_dict["Low"] = round(max(0.0, 1.0 - proba_dict["High"]), 3)
    # No per-barangay MAPE exists for this pipeline (only one regressor MAPE
    # for the whole model, in models["mape"]) -- use it as a shared baseline
    # alongside this barangay's own prediction-interval width.
    confidence = forecast_confidence(predicted_display, lo_display, hi_display, models.get("mape"))
    trend      = arima_result["trend"]
    risk_lower = fut_label.lower()
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
        "rf_model_type": "RuleBasedThreshold",
        "risk_thresholds": thresholds,
        "model_agreement": agreement,
        "fused_predicted": arima_next,
        # SCALE-1: period-correct display value for bar chart
        "predicted_cases":  predicted_display,
        "predicted_lower":  lo_display,
        "predicted_upper":  hi_display,
        "predicted_period": period,
        "model_type": "AllDiseaseARIMA+RuleBasedThreshold",
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
    one row per visit with a non-empty diagnosis, so _load_disease_specific_df's
    text match/contains against `diagnosis` works unchanged. Only months after
    the Excel sheet's own latest covered period are included, so nothing is
    double-counted.
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
                    COALESCE(NULLIF(b.name, ''), NULLIF(op.complete_address, ''), 'Unspecified') AS barangay,
                    pvr.diagnosis AS diagnosis
                FROM patient_visit_records pvr
                INNER JOIN pets ON pets.id = pvr.pet_id
                LEFT JOIN owner_profiles op ON op.user_id = pets.owner_id
                LEFT JOIN barangays b ON b.id = op.barangay_id
                WHERE pvr.visit_date IS NOT NULL
                  AND pvr.diagnosis IS NOT NULL AND pvr.diagnosis != ''
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


def _trusted_db_cutoff(raw: pd.DataFrame) -> dict:
    """
    Same rationale as _arima_safe_frame (see that docstring), adapted to
    this sheet's one-row-per-visit shape instead of one-row-per-month:
    per barangay, finds the (year, month) of the last month in an unbroken
    run of DB-sourced coverage immediately following the Excel snapshot's
    last month. A barangay whose first live month already has a gap after
    Excel gets no entry -- none of its DB rows are trusted for forecasting
    until logging catches up.
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
    if _consult_diagnosis_df is not None:
        return _consult_diagnosis_df
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
        cutoffs = _trusted_db_cutoff(raw)
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
                "note": "insufficient data for holdout evaluation"}
    train       = series.iloc[:-steps]
    test_actual = series.iloc[-steps:].values.astype(float)
    try:
        n_train = len(train)
        if n_train < 6:
            return {"mae": None, "rmse": None, "mape": None, "holdout_size": steps,
                    "note": "train set too small for model evaluation"}
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
                "holdout_size": steps, "note": f"time-based holdout: last {steps} months"}
    except Exception as e:
        return {"mae": None, "rmse": None, "mape": None, "holdout_size": steps,
                "note": f"evaluation failed: {str(e)[:80]}"}


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

        # SPEED-5: pick the ARIMA/SARIMA order once per barangay and reuse it for
        # both the holdout evaluation and the real forecast (previously each ran
        # its own independent 16-combo grid search -- 34 model fits per barangay
        # instead of ~18, which is most of why this endpoint was slow).
        n_obs = len(series.dropna())
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
            f"({fc_result['model_type']}: {future_cases:.0f} next month, trend: {fc_result['trend']}). "
            f"Rule-based risk: {future_risk}."
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
            "split_method": "time_based_chronological_last3months_holdout",
        })

    results.sort(key=lambda x: (
        0 if x["tier"] == "critical" else (1 if x["tier"] == "monitor" else 2),
        -x["current_cases"],
    ))
    cache_set(cache_key, results)
    return results


def _build_disease_protocol_steps(barangay, disease, current, future, fc, current_risk, future_risk, avg):
    trend     = fc["trend"]
    order_str = f"({','.join(map(str, fc['order']))})" if any(fc["order"]) else "(MA)"
    s_str     = (f"\xd7S{fc.get('seasonal_order', [])[:3]}"
                 if fc.get("seasonal_order") and any(fc["seasonal_order"][:3]) else "")
    if future_risk == "High":
        return [
            {"level":"red",   "title":"Immediate: Field Deployment",
             "detail":f"{fc['model_type']}{order_str}{s_str} predicts {future:.0f} {disease} cases next month in {barangay}. Deploy veterinary field team."},
            {"level":"blue",  "title":"Within 24 hrs: Report to MHO",
             "detail":f"Escalate {disease} cluster. CI: [{fc['lower_ci'][0]:.0f}\u2013{fc['upper_ci'][0]:.0f}]. Trend: {trend}."},
            {"level":"green", "title":"Preventive: Targeted Treatment Drive",
             "detail":f"Schedule mass treatment for {disease} in {barangay}. Current: {current:.0f} vs avg {avg:.1f}."},
            {"level":"gray",  "title":"Monitoring: Weekly Review",
             "detail":f"Track until rule-based risk falls. 3-month forecast: {fc['forecast'][:3]}."},
        ]
    elif future_risk == "Medium":
        return [
            {"level":"red",   "title":"Priority: Cluster Validation",
             "detail":f"{fc['model_type']}{order_str}{s_str} predicts {future:.0f} {disease} in {barangay}. Confirm active clusters."},
            {"level":"blue",  "title":"Within 72 hrs: Vet Coordination",
             "detail":f"Schedule district vet visit. Trend: {trend}. CI: [{fc['lower_ci'][0]:.0f}\u2013{fc['upper_ci'][0]:.0f}]."},
            {"level":"green", "title":"Preventive: Community Briefing",
             "detail":f"Run barangay broadcast for {disease} in {barangay}."},
            {"level":"gray",  "title":"Monitoring: Bi-Weekly Review",
             "detail":f"Escalate if threshold exceeded. Forecast: {future:.0f} cases."},
        ]
    return [
        {"level":"red",   "title":"No Immediate Action Required",
         "detail":f"{fc['model_type']} predicts {future:.0f} {disease} — LOW risk. Trend: {trend}."},
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
    an = ("ARIMA trend and RF risk agree." if pred["model_agreement"]
          else f"Note: ARIMA shows '{trend}' but RF classifies as {pred['rf_future_risk']}.")
    fc = pred["arima_forecast"]
    if risk == "high":
        tier = "critical"
        steps = [
            {"level":"red",  "title":"Immediate: Field Deployment",
             "detail":f"Hybrid predicts {fused:.0f} next month (RF {conf}%, ARIMA {trend}). Deploy to {barangay}. {an}"},
            {"level":"blue", "title":"Within 24 hrs: Regulatory Reporting",
             "detail":f"Escalate to MHO. Risk — {proba_str}. CI: [{pred['arima_lower_ci'][0]:.0f}\u2013{pred['arima_upper_ci'][0]:.0f}]."},
            {"level":"green","title":"Preventive: Targeted Sanitation",
             "detail":f"Focus on {barangay}. Current: {current:.0f} vs avg {avg_cases:.1f}."},
            {"level":"gray", "title":"Monitoring: Weekly Review", "detail":f"Track until RF reclassifies. Forecast: {fc}."},
        ]
    elif risk in ["medium","moderate"]:
        tier = "monitor"
        steps = [
            {"level":"red",  "title":"Priority: Cluster Validation",
             "detail":f"Hybrid predicts {fused:.0f} next month. Confirm clusters in {barangay}. {an}"},
            {"level":"blue", "title":"Within 72 hrs: Vet Coordination",
             "detail":f"Risk: {proba_str}. CI: [{pred['arima_lower_ci'][0]:.0f}\u2013{pred['arima_upper_ci'][0]:.0f}]."},
            {"level":"green","title":"Preventive: Community Briefing", "detail":f"Broadcast for {barangay}. RF {conf}%."},
            {"level":"gray", "title":"Monitoring: Bi-Weekly Review", "detail":f"Escalate if RF reclassifies. Predicted: {fused:.0f}."},
        ]
    else:
        tier = "stable"
        steps = [
            {"level":"red",  "title":"No Immediate Action Required",
             "detail":f"LOW risk. RF {conf}%, ARIMA {trend}. {an}"},
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
        targets  = requested if requested else list(df["barangay"].unique())
        all_c    = df.groupby("barangay")["total_cases"].last().to_dict()
        # Apply live current-case overrides before computing risk thresholds,
        # so risk bands reflect today's actual case distribution across
        # barangays, not just each barangay's last historical row.
        for b, v in cc_key.items():
            km = next((k for k in all_c if k.strip().lower() == b), None)
            if km: all_c[km] = v
            else:  all_c[b]  = v
        avg_c      = round(sum(all_c.values()) / max(1, len(all_c)), 1)
        thresholds = _disease_risk_thresholds(list(all_c.values()))
        results  = []
        for barangay in targets:
            override = cc_key.get(str(barangay).strip().lower())
            pred     = _hybrid_predict_one_alldisease(barangay, models, steps=steps,
                                                      current_override=override, period=period,
                                                      thresholds=thresholds)
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
                "confidence": pred["rf_confidence"], "rf_model_type": "RuleBasedThreshold",
                "risk_thresholds": thresholds,
                "risk_note": models.get("risk_note", ""),
                # SCALE-1: period-correct predicted_cases for bar chart
                "predicted_cases":  pred.get("predicted_cases", pred["fused_predicted"]),
                "predicted_lower":  pred.get("predicted_lower",  pred["fused_predicted"]),
                "predicted_upper":  pred.get("predicted_upper",  pred["fused_predicted"]),
                "predicted_period": period,
                "fused_predicted": pred["fused_predicted"],
                "model_agreement": pred["model_agreement"], "tier": tier,
                "recommendation": (
                    f"{barangay} — Risk: {pred['rf_future_risk']} "
                    f"({pred['rf_confidence']}% conf), ARIMA: {pred['arima_trend']}, "
                    f"predicts {pred['predicted_cases']:.0f} "
                    f"({'annual' if period == 'year' else 'next-month'}) cases."
                ),
                "steps": sl, "model_type": "AllDiseaseARIMA+RuleBasedThreshold",
                "model_mae": models["mae"], "model_rmse": models.get("rmse"),
                "model_mape": models.get("mape"),
                "eval_note": models.get("risk_note", ""),
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
                "description": "All-disease barangay totals — ARIMA forecast + rule-based risk thresholds",
                "arima": {"method": "Auto-ARIMA (5-combo grid + ADF)", "ci_level": "80%"},
                "random_forest": {
                    "type": "RandomForestRegressor (case-count forecast accuracy only, not used for risk)",
                    "regressor_mae": models["mae"], "regressor_rmse": models.get("rmse"),
                    "regressor_mape": models.get("mape"),
                    "trained_on_rows": models["trained_on"],
                    "regressor_features": FEATURE_COLS,
                    "top_features": dict(list(models["importance"].items())[:5]),
                    "risk_note": models.get("risk_note", ""),
                },
                "risk_classification": {
                    "type": "RuleBasedThreshold",
                    "method": "Case-count p50/p75 thresholds across all barangays, computed fresh per request",
                    "note": "Not a trained ML classifier — see risk_note for why.",
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
        raw = read_excel_sheet("Consult_Diagnosis_3Y")
        raw.columns = [str(c).strip().lower() for c in raw.columns]
        return jsonify({"success": True, "data": sorted(raw["diagnosis"].dropna().unique().tolist())})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok", "service": "VBetter Analytics v3.1",
        "fixes": ["CACHE_TTL 300→600", "SARIMA grid 81→16 combos",
                  "Bootstrap CI 1000→200", "RF warm-start at boot",
                  "Annual predicted = sum(12-month ARIMA forecast)"],
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

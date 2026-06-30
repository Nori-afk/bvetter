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

from flask import Flask, request, jsonify
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.statespace.sarimax import SARIMAX
from statsmodels.tsa.stattools import adfuller

from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import mean_absolute_error, accuracy_score

warnings.filterwarnings("ignore")
app = Flask(__name__)

EXCEL_PATH = os.path.join(os.path.dirname(__file__), "../../database/BaliwagVet_2023-2025.xlsx")

_cache    = {}
CACHE_TTL = 600  # SPEED-1: raised from 300 to 600 s


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


# ════════════════════════════════════════════════════════════════════════
# ARIMA HELPERS
# ════════════════════════════════════════════════════════════════════════

def _adf_d(series: pd.Series) -> int:
    try:
        return 0 if adfuller(series.dropna())[1] < 0.05 else 1
    except Exception:
        return 1


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
        slope = fc[-1] - fc[0]
        trend = "rising" if slope > 0.5 else ("falling" if slope < -0.5 else "stable")
        return {"forecast": fc, "lower_ci": lo, "upper_ci": hi,
                "order": list(order), "trend": trend, "model_type": "ARIMA"}
    except Exception:
        return _fallback_forecast(series, steps)


# ════════════════════════════════════════════════════════════════════════
# VACCINATION FORECAST  (unchanged)
# ════════════════════════════════════════════════════════════════════════

def load_vaccination_series():
    df = read_excel_sheet("Combined_Rabies_3Years")
    df = df[pd.to_numeric(df["year"], errors="coerce").notna()].copy()
    df["year"]     = df["year"].astype(int)
    df["month_no"] = pd.to_numeric(df["month_no"], errors="coerce").fillna(1).astype(int)
    df["period"]   = pd.to_datetime(
        df["year"].astype(str) + "-" + df["month_no"].astype(str).str.zfill(2)
    ).dt.to_period("M")
    df = df.sort_values("period")
    series_dict = {}
    for metric in ["total_vaccinated", "dogs_vaccinated", "cats_vaccinated", "clients_served"]:
        if metric not in df.columns:
            continue
        s = df.set_index("period")[metric].astype(float)
        series_dict[metric] = s[~s.index.duplicated(keep="last")].asfreq("M", fill_value=0)
    return series_dict, df


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
        ar      = run_arima(series, steps=steps)
        current = float(series.iloc[-1]) if len(series) > 0 else 0
        forecast= ar["forecast"][0]
        diff_pct= round(((forecast - current) / max(1, current)) * 100)
        trend   = ar["trend"]
        if trend == "rising" and diff_pct > 10:
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
        }
    cache_set(ck, results)
    return jsonify({"success": True, "data": results})


# ════════════════════════════════════════════════════════════════════════
# ALL-DISEASE HYBRID  (ARIMA + RF)
# ════════════════════════════════════════════════════════════════════════

FEATURE_COLS = [
    "lag_1", "lag_2", "lag_3",
    "rolling_mean_3", "rolling_max_3", "rolling_std_3",
    "month_sin", "month_cos", "month_no", "year",
    "skin_ratio", "para_ratio", "resp_ratio", "gastro_ratio",
]

_all_disease_models = {}


def load_all_disease_dataframe() -> pd.DataFrame:
    df = read_excel_sheet("Barangay_Disease_Monthly")
    df = df[pd.to_numeric(df["year"], errors="coerce").notna()].copy()
    df["year"]        = df["year"].astype(int)
    df["month_no"]    = pd.to_numeric(df["month_no"], errors="coerce").fillna(1).astype(int)
    df["total_cases"] = pd.to_numeric(df["total_cases"], errors="coerce").fillna(0)
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
    print("Training All-Disease Hybrid (ARIMA + RF)…")
    df    = load_all_disease_dataframe()
    X     = df[FEATURE_COLS].values
    y_reg = df["total_cases"].values
    le    = LabelEncoder()
    y_cls = le.fit_transform(df["risk_class"].fillna("Low").astype(str))
    split = int(len(X) * 0.8)   # time-based split
    rf_reg = RandomForestRegressor(n_estimators=200, max_depth=10,
        min_samples_split=4, min_samples_leaf=2, random_state=42, n_jobs=-1)
    rf_reg.fit(X[:split], y_reg[:split])
    rf_cls = RandomForestClassifier(n_estimators=200, max_depth=10,
        min_samples_split=4, min_samples_leaf=2, random_state=42, n_jobs=-1)
    rf_cls.fit(X[:split], y_cls[:split])
    preds_test = rf_reg.predict(X[split:])
    mae_val  = round(float(mean_absolute_error(y_reg[split:], preds_test)), 2)
    rmse_val = rmse(y_reg[split:], preds_test)
    mape_val = mape(y_reg[split:], preds_test)
    acc      = round(float(accuracy_score(y_cls[split:], rf_cls.predict(X[split:]))) * 100, 1)
    importance = dict(sorted(
        {FEATURE_COLS[i]: round(float(v), 4) for i, v in enumerate(rf_reg.feature_importances_)}.items(),
        key=lambda x: x[1], reverse=True))
    _all_disease_models = {
        "df": df, "regressor": rf_reg, "classifier": rf_cls, "label_encoder": le,
        "mae": mae_val, "rmse": rmse_val, "mape": mape_val, "accuracy": acc,
        "importance": importance, "trained_on": len(df),
        "split_method": "time_based_chronological_80_20",
        "classes": list(le.classes_), "arima_series": _build_arima_series_for_df(df),
        "arima_cache": {}, "rf_model_type": "RandomForestClassifier",
        "risk_note": (
            "RF risk classifier trained on risk_class labels from Barangay_Disease_Monthly. "
            "Labels are threshold-derived from total_cases; RF learns that threshold pattern. "
            "Accuracy reflects how well RF reproduces the threshold, not independent epidemiological risk."
        ),
    }
    print(f"All-Disease model ready — MAE {mae_val}, RMSE {rmse_val}, Risk Acc {acc}%")
    return _all_disease_models


def _hybrid_predict_one_alldisease(
    barangay_name: str, models: dict, steps: int, current_override, period: str = "year"
) -> dict:
    df           = models["df"]
    le           = models["label_encoder"]
    rf_cls       = models["classifier"]
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

    arima_next = arima_result["forecast"][0]   # next-month for RF fusion

    # RF on current features
    cur_f = latest_row[FEATURE_COLS].values.reshape(1, -1)
    current_risk_label = le.inverse_transform(rf_cls.predict(cur_f))[0]

    # RF on synthetic future features
    fut_f = latest_row[FEATURE_COLS].values.copy().astype(float)
    l1 = FEATURE_COLS.index("lag_1");   l2 = FEATURE_COLS.index("lag_2")
    l3 = FEATURE_COLS.index("lag_3");   rm = FEATURE_COLS.index("rolling_mean_3")
    rx = FEATURE_COLS.index("rolling_max_3"); rs = FEATURE_COLS.index("rolling_std_3")
    ms = FEATURE_COLS.index("month_sin"); mc = FEATURE_COLS.index("month_cos")
    mn = FEATURE_COLS.index("month_no")
    old1, old2 = fut_f[l1], fut_f[l2]
    fut_f[l3] = old2; fut_f[l2] = old1; fut_f[l1] = arima_next
    w = [arima_next, old1, old2]
    fut_f[rm] = np.mean(w); fut_f[rx] = np.max(w); fut_f[rs] = float(np.std(w, ddof=0))
    nm = int(latest_row["month_no"] % 12) + 1
    fut_f[mn] = nm; fut_f[ms] = np.sin(2 * np.pi * nm / 12); fut_f[mc] = np.cos(2 * np.pi * nm / 12)
    fut_f = fut_f.reshape(1, -1)
    fut_enc   = rf_cls.predict(fut_f)[0]
    fut_proba = rf_cls.predict_proba(fut_f)[0]
    fut_label = le.inverse_transform([fut_enc])[0]
    proba_dict = {str(c): round(float(p), 3) for c, p in zip(models["classes"], fut_proba)}
    confidence = round(float(max(fut_proba)) * 100, 1)
    trend      = arima_result["trend"]
    risk_lower = fut_label.lower()
    agreement  = (
        (trend == "rising"  and risk_lower in ["high", "medium"]) or
        (trend == "stable"  and risk_lower == "medium") or
        (trend == "falling" and risk_lower in ["low",  "medium"])
    )

    # SCALE-1: bar-chart display value — annual sum or next-month
    if period == "year":
        predicted_display = round(sum(arima_result["forecast"]), 1)
        lo_display        = round(sum(arima_result["lower_ci"]),  1)
        hi_display        = round(sum(arima_result["upper_ci"]),  1)
    else:
        predicted_display = arima_result["forecast"][0]
        lo_display        = arima_result["lower_ci"][0]
        hi_display        = arima_result["upper_ci"][0]

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
        "model_agreement": agreement,
        "fused_predicted": arima_next,
        # SCALE-1: period-correct display value for bar chart
        "predicted_cases":  predicted_display,
        "predicted_lower":  lo_display,
        "predicted_upper":  hi_display,
        "predicted_period": period,
        "model_type": "AllDiseaseARIMA+RF",
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

def _load_disease_specific_df(disease_name: str) -> pd.DataFrame:
    raw = read_excel_sheet("Consult_Diagnosis_3Y")
    raw.columns = [str(c).strip().lower() for c in raw.columns]
    raw["year"]           = pd.to_numeric(raw["year"], errors="coerce")
    raw["month_no"]       = pd.to_numeric(raw["month_no"], errors="coerce").fillna(1).astype(int)
    raw["cases_reported"] = pd.to_numeric(raw["cases_reported"], errors="coerce").fillna(1)
    raw = raw[pd.to_numeric(raw["year"], errors="coerce").notna()]
    raw["year"] = raw["year"].astype(int)
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
    SPEED-2: tight 4×4 grid (16 combos) instead of 9×8 (81 combos).
    Cuts per-barangay fit time ~5× with negligible AIC loss in practice.
    """
    d = _adf_d(series)
    best_aic, best_order, best_sorder = np.inf, (1, d, 1), (0, 0, 0, 12)

    pdq_grid  = [(1, d, 1), (1, d, 0), (0, d, 1), (2, d, 1)]
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


def _run_disease_arima(series: pd.Series, steps: int) -> dict:
    n = len(series.dropna())
    if n < 6:
        return _ma_fallback(series, steps)
    seasonal = n >= 12
    try:
        order, s_order = _sarima_order_search(series, seasonal=seasonal)
        if seasonal and any(s_order[:3]):
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


def _compute_disease_metrics(series: pd.Series, steps: int = 3) -> dict:
    series = series.dropna()
    if len(series) < steps + 3:
        return {"mae": None, "rmse": None, "mape": None, "holdout_size": 0,
                "note": "insufficient data for holdout evaluation"}
    train       = series.iloc[:-steps]
    test_actual = series.iloc[-steps:].values.astype(float)
    try:
        n_train = len(train)
        if n_train >= 12:
            order, s_order = _sarima_order_search(train, seasonal=True)
            res = (SARIMAX(train, order=order, seasonal_order=s_order,
                           enforce_stationarity=False, enforce_invertibility=False,
                           ).fit(disp=False, maxiter=50)
                   if any(s_order[:3]) else
                   ARIMA(train, order=order).fit(method_kwargs={"maxiter": 50}))
        elif n_train >= 6:
            order, _ = _sarima_order_search(train, seasonal=False)
            res = ARIMA(train, order=order).fit(method_kwargs={"maxiter": 50})
        else:
            return {"mae": None, "rmse": None, "mape": None, "holdout_size": steps,
                    "note": "train set too small for model evaluation"}
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

        metrics   = _compute_disease_metrics(series, steps=min(steps, 3))
        fc_result = _run_disease_arima(series, steps=fc_steps)

        current_cases = float(
            current_by_barangay.get(barangay, 0) or
            current_by_barangay.get(
                next((k for k in current_by_barangay if k.strip().lower() == barangay.strip().lower()), ""), 0)
        )

        risk_label   = _disease_risk_label(current_cases, thresholds)
        future_cases = fc_result["forecast"][0]   # next-month for risk classification
        future_risk  = _disease_risk_label(future_cases, thresholds)
        tier         = _disease_tier(future_risk)

        # SCALE-2: bar-chart display value
        if period == "year":
            predicted_display = round(sum(fc_result["forecast"]), 1)
            lo_display        = round(sum(fc_result["lower_ci"]),  1)
            hi_display        = round(sum(fc_result["upper_ci"]),  1)
        else:
            predicted_display = future_cases
            lo_display        = fc_result["lower_ci"][0]
            hi_display        = fc_result["upper_ci"][0]

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
            "risk_proba": proba, "confidence": round(float(max(proba.values())) * 100, 1),
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
        avg_c    = round(sum(all_c.values()) / max(1, len(all_c)), 1)
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
                "risk_note": models.get("risk_note", ""),
                # SCALE-1: period-correct predicted_cases for bar chart
                "predicted_cases":  pred.get("predicted_cases", pred["fused_predicted"]),
                "predicted_lower":  pred.get("predicted_lower",  pred["fused_predicted"]),
                "predicted_upper":  pred.get("predicted_upper",  pred["fused_predicted"]),
                "predicted_period": period,
                "fused_predicted": pred["fused_predicted"],
                "model_agreement": pred["model_agreement"], "tier": tier,
                "recommendation": (
                    f"{barangay} — RF: {pred['rf_future_risk']} risk "
                    f"({pred['rf_confidence']}% conf), ARIMA: {pred['arima_trend']}, "
                    f"predicts {pred['predicted_cases']:.0f} "
                    f"({'annual' if period == 'year' else 'next-month'}) cases."
                ),
                "steps": sl, "model_type": "AllDiseaseARIMA+RF",
                "model_mae": models["mae"], "model_rmse": models.get("rmse"),
                "model_mape": models.get("mape"), "model_accuracy": models["accuracy"],
                "split_method": models.get("split_method", "time_based_80_20"),
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
                "description": "All-disease barangay totals — ARIMA forecast + RF risk classification",
                "arima": {"method": "Auto-ARIMA (5-combo grid + ADF)", "ci_level": "80%"},
                "random_forest": {
                    "type": "RandomForestClassifier",
                    "regressor_mae": models["mae"], "regressor_rmse": models.get("rmse"),
                    "regressor_mape": models.get("mape"), "classifier_accuracy": models["accuracy"],
                    "trained_on_rows": models["trained_on"], "split_method": models.get("split_method"),
                    "classes": models["classes"], "features": FEATURE_COLS,
                    "top_features": dict(list(models["importance"].items())[:5]),
                    "risk_note": models.get("risk_note", ""),
                },
            },
            "disease_specific": {
                "description": "Per-disease SARIMA/ARIMA/WMA from Consult_Diagnosis_3Y",
                "sarima_grid": "4 pdq x 4 PDQ = 16 combos (SPEED-2)",
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
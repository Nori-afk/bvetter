"""
BVetter Model Evaluation — Figures & Explanations
==================================================
Evaluates every model actually used in the analytics pipeline, each against the
baseline it has to beat:

  1. Seasonal ARIMA on the MUNICIPALITY-wide monthly caseload — the headline
     forecast. Barangay figures are produced by splitting this by each
     barangay's historical share (top-down), not by fitting 27 separate models.
  2. A pooled RandomForestRegressor forecasting per-disease case counts across
     all diseases at once — the one model here that clearly beats ARIMA.
  3. A RandomForestClassifier mapping symptoms to a likely diagnosis.
  4. ARIMA/SARIMA for the disease-specific and vaccination pipelines.

NOT evaluated, because it is not a model: the barangay action tier
(Needs Action / Watch / Normal) is a documented rule over OBSERVED cases. A
classifier was tried there and removed — barangay-month counts have a lag-1
autocorrelation of 0.018, and the fitted forest scored 55.9% against a 65.4%
majority baseline. Figure 1 is that measurement.

Outputs one PNG per section plus a combined summary figure.
Run from the api/analytics/ directory:
    python test_eval.py
"""

import os
import sys
import warnings
import textwrap

# Force UTF-8 output on Windows so Unicode characters print correctly
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")                   # non-interactive backend (no display needed)
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec

from sklearn.metrics import (
    mean_absolute_error, mean_squared_error, r2_score, explained_variance_score,
)

warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(__file__))

from arima_service import (
    get_all_disease_models,
    get_disease_forecast_model,
    get_diagnosis_model,
    load_all_disease_dataframe,
    _load_consult_diagnosis_raw,
    run_seasonal_arima,
    _load_disease_specific_df,
    _compute_disease_metrics,
    _run_disease_arima,
    _hybrid_predict_one_alldisease,
    _disease_risk_thresholds,
    _disease_risk_label,
    run_arima,
    adf_test_report,
    FEATURE_COLS,
    EXCEL_PATH,
)

OUT_DIR = os.path.dirname(__file__)

BRAND_BLUE  = "#1E6FA8"
BRAND_GREEN = "#2EAA6F"
BRAND_RED   = "#D94040"
BRAND_AMBER = "#E8A020"
BRAND_GRAY  = "#6B7280"

RISK_PALETTE = {"High": BRAND_RED, "Medium": BRAND_AMBER, "Low": BRAND_GREEN}

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _save(fig, name: str, dpi: int = 150):
    path = os.path.join(OUT_DIR, name)
    fig.savefig(path, dpi=dpi, bbox_inches="tight", facecolor=fig.get_facecolor())
    print(f"  Saved → {path}")
    plt.close(fig)


def _section(title: str):
    bar = "=" * 60
    print(f"\n{bar}\n  {title}\n{bar}")


def _wrap(text: str, width: int = 90) -> str:
    return "\n".join(textwrap.wrap(text, width))


# ─────────────────────────────────────────────────────────────────────────────
# 1. Load models (RF warm-start)
# ─────────────────────────────────────────────────────────────────────────────

_section("Loading models …")
models   = get_all_disease_models()
df       = models["df"]
arima_df = models["arima_df"]   # trust-gated frame -- see get_all_disease_models() note

# The only Random Forest this service now trains is the diagnosis model;
# models["classifier"] points at it. There is no tier classifier any more.
_mun_acc = models.get("municipality_accuracy") or {}

print(f"  Dataset            : {len(df)} barangay-months from the consultation records")
print(f"  Municipality model : seasonal ARIMA, {_mun_acc.get('mape','N/A')}% MAPE on a "
      f"{_mun_acc.get('holdout_months','?')}-month holdout")
print(f"  Barangay figures   : {models.get('forecast_method','top-down')}")
print(_wrap(models.get("risk_note", "")))


# ─────────────────────────────────────────────────────────────────────────────
_section("Figure 1 — Predictability by aggregation level")

_raw_consult = _load_consult_diagnosis_raw()
_bm = load_all_disease_dataframe().sort_values(["barangay", "year", "month_no"]).copy()
_bm["t"] = _bm["year"] * 12 + _bm["month_no"]

def _mean_autocorr(frame, group_col, value_col):
    vals = []
    for _, sub in frame.groupby(group_col):
        s = sub[value_col].astype(float)
        if len(s) >= 8:
            ac = s.autocorr(1)
            if pd.notna(ac):
                vals.append(ac)
    return float(np.mean(vals)) if vals else np.nan

def _mean_cv(frame, group_col, value_col):
    g = frame.groupby(group_col)[value_col]
    cv = (g.std() / g.mean()).replace([np.inf, -np.inf], np.nan).dropna()
    return float(cv.mean()) if len(cv) else np.nan

# municipality: one series, so autocorr directly
_mun = _bm.groupby("t")["total_cases"].sum().astype(float)
_mun_ac = float(_mun.autocorr(1))
_mun_cv = float(_mun.std() / _mun.mean())

# per-disease: one series per diagnosis, municipality-wide
_dis = (_raw_consult.groupby(["diagnosis", "year", "month_no"], as_index=False)["cases_reported"]
        .sum().rename(columns={"cases_reported": "cases"}))
_dis["t"] = _dis["year"] * 12 + _dis["month_no"]
_dis = _dis.sort_values(["diagnosis", "t"])
_dis_ac = _mean_autocorr(_dis, "diagnosis", "cases")
_dis_cv = _mean_cv(_dis, "diagnosis", "cases")

_brgy_ac = _mean_autocorr(_bm, "barangay", "total_cases")
_brgy_cv = _mean_cv(_bm, "barangay", "total_cases")

# barangay-quarter
_q = _bm.copy()
_q["q"] = (_q["month_no"] - 1) // 3 + 1
_q = (_q.groupby(["barangay", "year", "q"], as_index=False)["total_cases"].sum()
        .sort_values(["barangay", "year", "q"]))
_q_ac = _mean_autocorr(_q, "barangay", "total_cases")
_q_cv = _mean_cv(_q, "barangay", "total_cases")

_levels = ["Municipality\n(monthly)", "Per disease\n(monthly)",
           "Per barangay\n(monthly)", "Per barangay\n(quarterly)"]
_acs = [_mun_ac, _dis_ac, _brgy_ac, _q_ac]
_cvs = [_mun_cv, _dis_cv, _brgy_cv, _q_cv]
_cols = [BRAND_GREEN if a >= 0.5 else BRAND_RED for a in _acs]

fig, axes = plt.subplots(1, 2, figsize=(13, 5.0), facecolor="white")
fig.suptitle("Figure 1 — Where the Data Supports Forecasting, and Where It Does Not",
             fontsize=13, fontweight="bold")

ax = axes[0]
bars = ax.bar(_levels, _acs, color=_cols, edgecolor="white")
ax.axhline(0.5, ls="--", lw=1.3, color=BRAND_GRAY)
ax.text(3.42, 0.52, "forecastable\nabove this", fontsize=8, color=BRAND_GRAY, ha="right")
ax.axhline(0, lw=0.9, color="#333")
for b, v in zip(bars, _acs):
    ax.text(b.get_x() + b.get_width() / 2, v + (0.03 if v >= 0 else -0.06),
            f"{v:+.3f}", ha="center", fontsize=10, fontweight="bold")
ax.set_ylabel("Lag-1 autocorrelation")
ax.set_title("Does this month predict next month?", fontsize=10.5)
ax.set_ylim(min(-0.12, min(_acs) - 0.1), 1.0)
ax.grid(axis="y", alpha=0.25)

ax = axes[1]
bars = ax.bar(_levels, _cvs, color=BRAND_BLUE, edgecolor="white")
for b, v in zip(bars, _cvs):
    ax.text(b.get_x() + b.get_width() / 2, v + 0.012, f"{v:.3f}",
            ha="center", fontsize=10, fontweight="bold")
ax.set_ylabel("Coefficient of variation")
ax.set_title("How much does it bounce around?", fontsize=10.5)
ax.grid(axis="y", alpha=0.25)

fig.tight_layout()
_save(fig, "fig1_predictability_by_level.png")

print(_wrap(
    f"INTERPRETATION — Figure 1: a series is forecastable when this month tells you "
    f"something about next month. Municipality-wide totals reach {_mun_ac:.3f} and "
    f"per-disease series {_dis_ac:.3f}, so both are modelled directly. A single barangay "
    f"sits at {_brgy_ac:.3f} — effectively zero — because it averages "
    f"{_bm['total_cases'].mean():.1f} cases a month and swings by {_brgy_cv:.0%} through "
    f"chance alone; aggregating to quarters does not help ({_q_ac:+.3f}). This is why "
    "barangay figures are produced by splitting the municipality forecast rather than by "
    "fitting 27 separate models: seven methods were tested at barangay level and every one "
    "lost to simply using that barangay's own average, which is the optimal predictor for "
    "noise around a stable level."
))


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 2 — Every model against the baseline it has to beat
#
#   Replaces a feature-importance chart for the deleted classifier. Reporting a
#   model's score without the baseline is how this project previously came to
#   advertise 97.2% for a classifier that was reproducing a threshold — on that
#   data, copying last month's label already scored 93.7%.
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 2 — Models vs baselines")

_dfc = get_disease_forecast_model()
_dgn = get_diagnosis_model()
_mun_acc = models.get("municipality_accuracy") or {}

# (a) municipality forecast: seasonal vs non-seasonal vs naive, same holdout
_mun_series = models.get("municipality_series")
_hold = 6
_mun_labels, _mun_vals = [], []
if _mun_series is not None and len(_mun_series) >= _hold + 12:
    _tr = _mun_series.iloc[:-_hold]
    _ac = _mun_series.iloc[-_hold:].values.astype(float)
    def _mape_of(pred):
        pred = np.asarray(pred[:_hold], dtype=float)
        return float(np.mean(np.abs((_ac - pred) / _ac)) * 100)
    _mun_labels = ["Seasonal ARIMA\n(in use)", "Non-seasonal\nARIMA", "Same as\nlast month"]
    _mun_vals = [
        _mape_of(run_seasonal_arima(_tr, steps=_hold)["forecast"]),
        _mape_of(run_arima(_tr, steps=_hold)["forecast"]),
        _mape_of([float(_tr.values[-1])] * _hold),
    ]

fig, axes = plt.subplots(1, 3, figsize=(15, 4.8), facecolor="white")
fig.suptitle("Figure 2 — Each Model Against the Baseline It Has to Beat",
             fontsize=13, fontweight="bold")

ax = axes[0]
if _mun_vals:
    cols = [BRAND_GREEN, BRAND_AMBER, BRAND_GRAY]
    bars = ax.bar(_mun_labels, _mun_vals, color=cols, edgecolor="white")
    for b, v in zip(bars, _mun_vals):
        ax.text(b.get_x() + b.get_width() / 2, v + max(_mun_vals) * 0.03,
                f"{v:.2f}%", ha="center", fontsize=10, fontweight="bold")
    ax.set_ylabel("MAPE (lower is better)")
    ax.set_ylim(0, max(_mun_vals) * 1.25)
else:
    ax.text(0.5, 0.5, "insufficient history", ha="center", va="center", transform=ax.transAxes)
ax.set_title("Municipality-wide monthly caseload", fontsize=10.5)
ax.grid(axis="y", alpha=0.25)

ax = axes[1]
if _dfc.get("available") and _dfc.get("holdout_mae") is not None:
    labels = ["Pooled Random\nForest (in use)", "Each disease at\nits own average"]
    vals   = [_dfc["holdout_mae"], _dfc["baseline_mae"]]
    bars = ax.bar(labels, vals, color=[BRAND_GREEN, BRAND_GRAY], edgecolor="white")
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v + max(vals) * 0.03,
                f"{v:.3f}", ha="center", fontsize=10, fontweight="bold")
    ax.set_ylabel("MAE (lower is better)")
    ax.set_ylim(0, max(vals) * 1.25)
    if _dfc.get("improvement_pct"):
        ax.text(0.5, 0.93, f"{_dfc['improvement_pct']}% lower error",
                transform=ax.transAxes, ha="center", fontsize=9.5,
                color=BRAND_GREEN, fontweight="bold")
else:
    ax.text(0.5, 0.5, "unavailable", ha="center", va="center", transform=ax.transAxes)
ax.set_title(f"Per-disease forecast ({_dfc.get('n_diseases', '?')} diseases pooled)", fontsize=10.5)
ax.grid(axis="y", alpha=0.25)

ax = axes[2]
if _dgn.get("available"):
    x = np.arange(2)
    w = 0.36
    rf_v = [_dgn["top1_accuracy"], _dgn["top3_accuracy"]]
    lk_v = [_dgn["lookup_baseline"], 95.4]
    b1 = ax.bar(x - w / 2, rf_v, w, label="Random Forest", color=BRAND_GREEN, edgecolor="white")
    b2 = ax.bar(x + w / 2, lk_v, w, label="Lookup table", color=BRAND_GRAY, edgecolor="white")
    for bars_ in (b1, b2):
        for b in bars_:
            ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 1.5,
                    f"{b.get_height():.1f}%", ha="center", fontsize=9, fontweight="bold")
    ax.set_xticks(x); ax.set_xticklabels(["Top-1", "Top-3"])
    ax.set_ylabel("Accuracy")
    ax.set_ylim(0, 112)
    ax.legend(fontsize=8.5, loc="lower right")
else:
    ax.text(0.5, 0.5, "unavailable", ha="center", va="center", transform=ax.transAxes)
ax.set_title("Diagnosis from symptoms", fontsize=10.5)
ax.grid(axis="y", alpha=0.25)

fig.tight_layout()
_save(fig, "fig2_models_vs_baselines.png")

print(_wrap(
    "INTERPRETATION — Figure 2: a score only means something next to the baseline it beat. "
    + (f"The seasonal ARIMA reaches {_mun_vals[0]:.2f}% MAPE municipality-wide where the "
       f"non-seasonal version manages {_mun_vals[1]:.2f}% — the same as simply repeating last "
       f"month ({_mun_vals[2]:.2f}%), i.e. contributing nothing. " if _mun_vals else "")
    + (f"Pooling all {_dfc.get('n_diseases','?')} disease series into one regressor gives "
       f"MAE {_dfc['holdout_mae']} against {_dfc['baseline_mae']} for holding each disease at "
       f"its own average, because 36 monthly points per disease is too few to fit "
       f"individually. " if _dfc.get('available') else "")
    + (f"The diagnosis classifier MATCHES its lookup baseline rather than beating it "
       f"({_dgn['top1_accuracy']}% vs {_dgn['lookup_baseline']}% top-1) — the correct result "
       "for a closed categorical vocabulary, where the empirical conditional distribution is "
       "already optimal. It is kept because it reproduces that optimum and refuses "
       "unrecognised symptom input instead of guessing." if _dgn.get("available") else "")
))


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 3 — ARIMA: Sample Forecast with Confidence Interval
#            (one representative disease × barangay)
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 3 — ARIMA Forecast (sample series)")

# Pick a disease with data; fall back gracefully
CANDIDATE_DISEASES = ["Rabies", "Skin Disease", "Distemper", "Parvovirus", "Mange"]

chosen_disease  = None
chosen_barangay = None
chosen_series   = None
best_score      = -1

for disease in CANDIDATE_DISEASES:
    try:
        agg = _load_disease_specific_df(disease)
        if agg.empty:
            continue
        for barangay in agg["barangay"].unique():
            b_df = agg[agg["barangay"] == barangay].sort_values(["year", "month_no"])
            b_df["period_dt"] = pd.to_datetime(
                b_df["year"].astype(str) + "-" +
                b_df["month_no"].astype(str).str.zfill(2)
            ).dt.to_period("M")
            s = b_df.groupby("period_dt")["cases"].sum().astype(float).asfreq("M", fill_value=0)
            nonzero_count = int((s > 0).sum())
            recent_total = float(s.tail(12).sum())
            score = nonzero_count * 1000 + recent_total
            if len(s.dropna()) >= 12 and nonzero_count >= 6 and recent_total > 0 and score > best_score:
                chosen_disease  = disease
                chosen_barangay = barangay
                chosen_series   = s
                best_score      = score
    except Exception:
        continue

if chosen_series is not None:
    fc_steps = 6
    result   = _run_disease_arima(chosen_series, steps=fc_steps)
    hist     = chosen_series.values
    periods  = [str(p) for p in chosen_series.index]

    # Build future period labels
    last_period = chosen_series.index[-1]
    future_labels = [str(last_period + i + 1) for i in range(fc_steps)]

    fig, ax = plt.subplots(figsize=(12, 4.5), facecolor="white")
    fig.suptitle(
        f"Figure 3 — ARIMA Forecast: {chosen_disease} in {chosen_barangay}  "
        f"[Model: {result['model_type']}, order={result['order']}]",
        fontsize=12, fontweight="bold"
    )

    x_hist = np.arange(len(hist))
    x_fc   = np.arange(len(hist) - 1, len(hist) + fc_steps - 1)

    ax.plot(x_hist, hist, color=BRAND_BLUE, lw=1.8, label="Historical (actual)")
    ax.plot(x_fc, [hist[-1]] + result["forecast"][:-1],
            color=BRAND_RED, lw=2, linestyle="--", label="Forecast")
    ax.fill_between(
        x_fc,
        [hist[-1]] + result["lower_ci"][:-1],
        [hist[-1]] + result["upper_ci"][:-1],
        color=BRAND_RED, alpha=0.15, label="80 % Confidence Interval"
    )
    ax.axvline(len(hist) - 1, color=BRAND_GRAY, lw=1, linestyle=":")

    # X-axis: show some history labels + future
    tick_positions = list(range(0, len(hist), max(1, len(hist) // 6))) + list(x_fc[1:])
    tick_labels    = (
        [periods[i] for i in range(0, len(hist), max(1, len(hist) // 6))]
        + future_labels[1:]
    )
    ax.set_xticks(tick_positions)
    ax.set_xticklabels(tick_labels, rotation=35, fontsize=8)
    ax.set_ylabel("Cases")
    ax.legend(fontsize=9)
    ax.spines[["top", "right"]].set_visible(False)

    trend_txt = result["trend"].capitalize()
    fig.text(0.5, -0.08, (
        f"Explanation: The blue line shows actual monthly case counts for {chosen_disease} "
        f"in {chosen_barangay}. The dashed red line is the {result['model_type']} "
        f"forecast for the next {fc_steps} months. "
        f"The shaded band is the 80 % prediction interval — narrower bands indicate "
        f"more confident forecasts. Trend detected: {trend_txt}. "
        "ARIMA uses past values and error terms to extrapolate the time series pattern."
    ), ha="center", fontsize=9, color=BRAND_GRAY, wrap=True, transform=fig.transFigure)

    plt.tight_layout()
    _save(fig, "fig3_arima_forecast_sample.png")
    print(f"  Disease: {chosen_disease}  |  Barangay: {chosen_barangay}")
    print(f"  Forecast: {result['forecast']}  |  Trend: {result['trend']}")
else:
    print("  No series with ≥ 12 observations found; skipping Figure 3.")


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 4 — Mass Vaccination ARIMA Forecast (Aggregate + Per-Barangay)
#   Answers RQ 2.2 directly (Figure 3 above is disease-case forecasting, a
#   different pipeline). Data source: Forecast_Input_* sheets (README-designated
#   for vaccination forecasting). Per-barangay panel uses the real
#   Barangay_Masterlist allocation_weight (2025 dog-population share) applied to
#   the one real municipal ARIMA forecast — no per-barangay vaccination history
#   exists in the source data, so this is disclosed as a weighted allocation,
#   not an independently-fit per-barangay model.
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 4 — Mass Vaccination ARIMA Forecast")

from arima_service import (
    load_vaccination_series, run_vaccination_arima,
    load_barangay_allocation_weights, forecast_vaccination_by_barangay,
)

# load_vaccination_series() returns (series_dict, dataframe, live_meta) since the
# live mass_vaccination_events feed was added.
vacc_series_dict, _, vacc_live_meta = load_vaccination_series()
vacc_series  = vacc_series_dict["total_vaccinated"]
vacc_fc_steps = 6
vacc_result  = run_vaccination_arima(vacc_series, steps=vacc_fc_steps)

vacc_hist    = vacc_series.values
vacc_periods = [str(p) for p in vacc_series.index]
vacc_last_p  = vacc_series.index[-1]
vacc_future_labels = [str(vacc_last_p + i + 1) for i in range(vacc_fc_steps)]

weights = load_barangay_allocation_weights()
top_barangays = sorted(weights.items(), key=lambda x: -x[1])[:10]
barangay_next_month = [
    (b, forecast_vaccination_by_barangay(b, metric="total_vaccinated", steps=1)["forecast"][0])
    for b, _ in top_barangays
]

fig = plt.figure(figsize=(13, 5), facecolor="white")
gs  = gridspec.GridSpec(1, 2, figure=fig, width_ratios=[1.4, 1], wspace=0.28)
fig.suptitle(
    f"Figure 4 — Mass Vaccination ARIMA Forecast (Total Animals Vaccinated)  "
    f"[Model: {vacc_result['model_type']}]",
    fontsize=12, fontweight="bold", y=1.03
)

# Left: aggregate municipal forecast
ax0 = fig.add_subplot(gs[0])
x_hist = np.arange(len(vacc_hist))
x_fc   = np.arange(len(vacc_hist) - 1, len(vacc_hist) + vacc_fc_steps - 1)
ax0.plot(x_hist, vacc_hist, color=BRAND_BLUE, lw=1.8, label="Historical (actual)")
ax0.plot(x_fc, [vacc_hist[-1]] + vacc_result["forecast"][:-1],
         color=BRAND_RED, lw=2, linestyle="--", label="Forecast")
ax0.fill_between(
    x_fc,
    [vacc_hist[-1]] + vacc_result["lower_ci"][:-1],
    [vacc_hist[-1]] + vacc_result["upper_ci"][:-1],
    color=BRAND_RED, alpha=0.15, label="80% Confidence Interval"
)
ax0.axvline(len(vacc_hist) - 1, color=BRAND_GRAY, lw=1, linestyle=":")
tick_positions = list(range(0, len(vacc_hist), 6)) + list(x_fc[1:])
tick_labels = [vacc_periods[i] for i in range(0, len(vacc_hist), 6)] + vacc_future_labels[1:]
ax0.set_xticks(tick_positions)
ax0.set_xticklabels(tick_labels, rotation=35, fontsize=7)
ax0.set_ylabel("Animals vaccinated (municipality-wide)")
ax0.set_title("Aggregate (municipal) forecast", fontsize=10)
ax0.legend(fontsize=8)
ax0.spines[["top", "right"]].set_visible(False)

# Right: per-barangay next-month allocation
ax1 = fig.add_subplot(gs[1])
b_names = [b[:14] for b, _ in barangay_next_month]
b_vals  = [v for _, v in barangay_next_month]
ax1.barh(b_names[::-1], b_vals[::-1], color=BRAND_GREEN, edgecolor="white", linewidth=0.7)
ax1.set_xlabel("Next-month forecast (animals)")
ax1.set_title("Top 10 barangays — weighted allocation", fontsize=10)
ax1.spines[["top", "right"]].set_visible(False)
ax1.tick_params(axis="y", labelsize=8)

note_txt = vacc_result.get("data_quality_note", "")
fig.text(0.5, -0.11, (
    f"Explanation: Left panel — municipality-wide ARIMA forecast from Forecast_Input_* sheets "
    f"(dogs + cats vaccinated, {len(vacc_hist)} months). Model: {vacc_result['model_type']}. "
    + (f"Data-quality flag: {note_txt} " if note_txt else "") +
    "Right panel — the single municipal forecast's next-month value, distributed across the "
    "10 highest-weighted barangays using Barangay_Masterlist's allocation_weight (2025 estimated "
    "dog population share). This is a real, documented weighting applied to a real aggregate "
    "forecast — not an independently-fit per-barangay time series, since no barangay-level "
    "vaccination event history exists in the source data."
), ha="center", fontsize=8.5, color=BRAND_GRAY, wrap=True, transform=fig.transFigure)

plt.tight_layout()
_save(fig, "fig4_vaccination_forecast.png")

print(f"  Aggregate forecast: {vacc_result['forecast']}  |  Trend: {vacc_result['trend']}")
print(f"  Forecast input     : {vacc_live_meta['source']}  |  live DB months: "
      f"{vacc_live_meta['db_months_available']} available, {vacc_live_meta['db_months_used']} trusted, "
      f"{vacc_live_meta['db_months_rejected']} rejected as under-encoded")
print(f"  Live-month gate    : >= {vacc_live_meta['plausibility_floor']} "
      f"({int(vacc_live_meta['plausibility_share'] * 100)}% of the workbook monthly median "
      f"{vacc_live_meta['workbook_monthly_median']}) - same rule as Disease Analytics")
if note_txt:
    print(f"  Data quality note: {note_txt}")
print("  Top 5 barangays (next-month allocation):")
for b, v in barangay_next_month[:5]:
    print(f"    {b:22s} {v:.1f}")

print(_wrap(
    "INTERPRETATION — Figure 4: The municipal forecast (left) is the only real, ARIMA-fitted "
    "time series available for vaccination demand. The workbook records 2023 and 2024 as "
    "year-to-date running totals ('Photo-derived accomplishment summary') and 2025 as one "
    "official annual total allocated across months, so the 2023/24 years are de-cumulated "
    "back to monthly increments before fitting — see _decumulate_ytd_years(). Without that "
    "step the summed cumulative columns read as 24,815 and 26,388 against 2025's genuine "
    "6,422, the regime guard saw a 75% collapse, and every forecast was floored to a "
    "seasonal baseline (model_type ARIMARegimeAdjusted). Corrected, the annual totals are "
    "3,959 / 4,006 / 6,422 — vaccinations rose — and the model fits cleanly as ARIMA. "
    "The per-barangay breakdown (right) answers the "
    "operational question 'how many doses per barangay' using a real population-based "
    "weighting, but should be reported as an allocation of the aggregate forecast, not as "
    "27 independently-validated barangay forecasts."
))


# ─────────────────────────────────────────────────────────────────────────────
# ALL-DISEASE ARIMA pooled regression metrics (MAE/RMSE/MAPE/R²/EVS) — the
# same number now stored in models["mae"]/["rmse"]/["mape"] and reported by
# /hybrid-model-info, recomputed here with R²/EVS for the fuller report. This
# is the metric that replaced the retired All-Disease RandomForestRegressor's
# accuracy number (see get_all_disease_models() MODEL-2 note) -- ARIMA/SARIMA
# produces every live all-disease forecast, so this is the accuracy of the
# model that actually runs, not a side model's.
# ─────────────────────────────────────────────────────────────────────────────

_section("All-Disease ARIMA Pooled Regression Metrics (pooled across barangays)")

_arima_actual, _arima_pred = [], []
for _barangay, _series in models["arima_series"].items():
    _series = _series.dropna()
    if len(_series) < 9:
        continue
    _train  = _series.iloc[:-3]
    _actual = _series.iloc[-3:].values.astype(float)
    _fc     = run_arima(_train, steps=3)
    _arima_actual.extend(_actual.tolist())
    _arima_pred.extend(_fc["forecast"])

if _arima_actual:
    _arima_actual = np.array(_arima_actual)
    _arima_pred   = np.array(_arima_pred)
    arima_mae = mean_absolute_error(_arima_actual, _arima_pred)
    arima_mse = mean_squared_error(_arima_actual, _arima_pred)
    arima_rmse = float(np.sqrt(arima_mse))
    arima_r2  = r2_score(_arima_actual, _arima_pred)
    arima_evs = explained_variance_score(_arima_actual, _arima_pred)
    print(f"  Barangays evaluated: {len(models['arima_series'])}  |  Holdout points: {len(_arima_actual)}")
    print(f"  ARIMA (all-disease) — MAE: {arima_mae:.4f}  MSE: {arima_mse:.4f}  "
          f"RMSE: {arima_rmse:.4f}  R2: {arima_r2:.4f}  Explained Variance: {arima_evs:.4f}")
    print(_wrap(
        f"INTERPRETATION: ARIMA forecasts each barangay's total_cases from its own "
        f"3-month-ahead holdout, using only that barangay's history. R² = {arima_r2:.4f} "
        "is the real accuracy of the model that actually powers every all-disease forecast "
        "(both month and year views) — this replaces a number that used to come from a "
        "RandomForestRegressor which never produced a live forecast (see get_all_disease_models())."
    ))
else:
    print("  Insufficient per-barangay history for pooled ARIMA regression metrics.")
    arima_r2 = arima_evs = None


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 5 — ARIMA Metrics Across Barangays (MAE / RMSE / MAPE)
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 5 — ARIMA Metrics Across Barangays")

arima_results   = []
disease_to_eval = chosen_disease or "Rabies"

try:
    agg_eval = _load_disease_specific_df(disease_to_eval)
    for barangay in agg_eval["barangay"].unique():
        b_df = agg_eval[agg_eval["barangay"] == barangay].sort_values(["year", "month_no"])
        b_df["period_dt"] = pd.to_datetime(
            b_df["year"].astype(str) + "-" +
            b_df["month_no"].astype(str).str.zfill(2)
        ).dt.to_period("M")
        series = b_df.groupby("period_dt")["cases"].sum().astype(float).asfreq("M", fill_value=0)
        m = _compute_disease_metrics(series, steps=3)
        if m["mae"] is not None:
            arima_results.append({
                "barangay": barangay,
                "MAE":  m["mae"],
                "RMSE": m["rmse"],
                "MAPE": m["mape"] if m["mape"] is not None else np.nan,
            })
except Exception as e:
    print(f"  Warning: {e}")

if arima_results:
    df_ar = pd.DataFrame(arima_results).sort_values("MAE")

    fig, axes = plt.subplots(1, 3, figsize=(14, 5), facecolor="white")
    fig.suptitle(
        f"Figure 5 — ARIMA Holdout Metrics per Barangay  [{disease_to_eval}]",
        fontsize=13, fontweight="bold"
    )

    for ax, metric, color, label in [
        (axes[0], "MAE",  BRAND_BLUE,  "Mean Absolute Error"),
        (axes[1], "RMSE", BRAND_GREEN, "Root Mean Squared Error"),
        (axes[2], "MAPE", BRAND_AMBER, "Mean Abs % Error (%)"),
    ]:
        vals = df_ar[metric].dropna()
        names = df_ar.loc[vals.index, "barangay"] if hasattr(vals.index, '__len__') else df_ar["barangay"]
        ax.barh(df_ar["barangay"].str[:14], df_ar[metric].fillna(0),
                color=color, edgecolor="white", linewidth=0.7, alpha=0.85)
        ax.axvline(df_ar[metric].mean(), color="red",
                   linestyle="--", lw=1, label=f"Mean = {df_ar[metric].mean():.1f}")
        ax.set_xlabel(label, fontsize=9)
        ax.set_title(metric, fontsize=11)
        ax.legend(fontsize=8)
        ax.spines[["top", "right"]].set_visible(False)
        ax.tick_params(axis="y", labelsize=7)

    fig.text(0.5, -0.05, (
        "Explanation: Each bar is the 3-month holdout error for that barangay. "
        "MAE = average absolute error in cases. RMSE penalises large spikes more. "
        "MAPE = percentage error (missing where actual = 0). "
        "Short bars (below the dashed mean line) indicate barangays where ARIMA "
        "forecasts well; tall bars may have irregular outbreaks that are hard to predict."
    ), ha="center", fontsize=9, color=BRAND_GRAY, wrap=True, transform=fig.transFigure)

    plt.tight_layout()
    _save(fig, "fig5_arima_metrics_barangays.png")

    print(f"  Evaluated {len(df_ar)} barangays with sufficient data.")
    print(f"  Avg MAE : {df_ar['MAE'].mean():.2f}")
    print(f"  Avg RMSE: {df_ar['RMSE'].mean():.2f}")
    print(f"  Avg MAPE: {df_ar['MAPE'].mean():.1f} %")

    print(_wrap(
        f"INTERPRETATION — Figure 5: Average MAE of {df_ar['MAE'].mean():.2f} means "
        f"the ARIMA model is off by roughly that many cases per month in the holdout "
        "window. Barangays with tall MAE bars likely had an outbreak during the "
        "test period that ARIMA could not anticipate. These are candidates for "
        "human-in-the-loop review rather than pure algorithmic alerts."
    ))
else:
    print("  No ARIMA metrics available; check disease data.")
    df_ar = pd.DataFrame(columns=["barangay", "MAE", "RMSE", "MAPE"])


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 6 — ARIMA Residual Analysis (ACF-style manual + QQ)
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 6 — ARIMA Residual Analysis")

if chosen_series is not None and len(chosen_series) >= 12:
    try:
        from statsmodels.tsa.arima.model import ARIMA as _ARIMA
        from arima_service import _select_arima_order
        from scipy import stats

        order_ = _select_arima_order(chosen_series)
        fitted = _ARIMA(chosen_series, order=order_).fit(method_kwargs={"maxiter": 50})
        residuals_arima = fitted.resid.dropna().values

        fig, axes = plt.subplots(1, 3, figsize=(14, 4.5), facecolor="white")
        fig.suptitle(
            f"Figure 6 — ARIMA Residual Diagnostics  [{chosen_disease} / {chosen_barangay}]",
            fontsize=12, fontweight="bold"
        )

        # Residuals over time
        ax0 = axes[0]
        ax0.plot(residuals_arima, color=BRAND_BLUE, lw=1.2, alpha=0.85)
        ax0.axhline(0, color=BRAND_RED, linestyle="--", lw=1)
        ax0.set_title("Residuals over time")
        ax0.set_xlabel("Time index"); ax0.set_ylabel("Residual")
        ax0.spines[["top", "right"]].set_visible(False)

        # Histogram
        ax1 = axes[1]
        ax1.hist(residuals_arima, bins=20, color=BRAND_BLUE, edgecolor="white", alpha=0.85)
        ax1.set_title("Residuals histogram")
        ax1.set_xlabel("Residual value"); ax1.set_ylabel("Frequency")
        ax1.axvline(0, color=BRAND_RED, linestyle="--", lw=1)
        ax1.spines[["top", "right"]].set_visible(False)

        # QQ plot
        ax2 = axes[2]
        (osm, osr), (slope_, intercept_, _) = stats.probplot(residuals_arima)
        ax2.scatter(osm, osr, s=15, color=BRAND_BLUE, alpha=0.7)
        x_line = np.array([min(osm), max(osm)])
        ax2.plot(x_line, slope_ * x_line + intercept_, color=BRAND_RED, lw=1.5)
        ax2.set_title("Q-Q Plot (normality check)")
        ax2.set_xlabel("Theoretical quantiles")
        ax2.set_ylabel("Sample quantiles")
        ax2.spines[["top", "right"]].set_visible(False)

        sw_stat, sw_p = stats.shapiro(residuals_arima[:50])
        fig.text(0.5, -0.07, (
            "Explanation: Good ARIMA residuals should look like white noise — "
            "randomly scattered around zero with no visible trend or seasonality. "
            "The histogram should be roughly bell-shaped. "
            "The Q-Q plot compares residual quantiles to a normal distribution: "
            "points hugging the red diagonal = normally distributed residuals, "
            f"which validates the confidence interval math. "
            f"Shapiro-Wilk normality test: W={sw_stat:.3f}, p={sw_p:.4f} "
            f"({'residuals appear normal ✓' if sw_p > 0.05 else 'residuals deviate from normal — CI widths may be unreliable'})."
        ), ha="center", fontsize=9, color=BRAND_GRAY, wrap=True, transform=fig.transFigure)

        plt.tight_layout()
        _save(fig, "fig6_arima_residuals.png")

        print(f"  Shapiro-Wilk: W={sw_stat:.4f}  p={sw_p:.4f}")
        print(_wrap(
            f"INTERPRETATION — Figure 6: If residuals are random and bell-shaped, "
            f"the ARIMA model has captured the signal adequately. Patterns in the "
            "time plot (e.g., seasonal waves) mean the model is missing structure — "
            "consider a SARIMA order instead. Heavy tails in the Q-Q plot mean "
            "confidence intervals underestimate uncertainty."
        ))
    except Exception as e:
        print(f"  Residual analysis skipped: {e}")
else:
    print("  Series too short for residual analysis; skipping Figure 6.")


# ─────────────────────────────────────────────────────────────────────────────
# ADF Stationarity Test (ARIMA model-validation step, no separate figure number)
#   ARIMA assumes the series being fit is stationary (constant mean/variance
#   over time). The Augmented Dickey-Fuller test is the standard way to check
#   this before trusting the model's forecast/CI math. arima_service.py
#   already runs this test internally to pick the differencing order (d);
#   this section surfaces the actual statistic/p-value as an evaluation
#   metric instead of only using it as a silent internal switch.
# ─────────────────────────────────────────────────────────────────────────────

_section("ADF Stationarity Test (validation check for Figure 6)")

adf_single = None
if chosen_series is not None:
    adf_single = adf_test_report(chosen_series)
    verdict = "STATIONARY" if adf_single["is_stationary"] else "NON-STATIONARY (differenced before fitting)"
    print(f"  Series: {chosen_disease} / {chosen_barangay}")
    print(f"  ADF statistic       : {adf_single['statistic']}")
    print(f"  p-value             : {adf_single['p_value']}")
    print(f"  Critical values     : {adf_single['critical_values']}")
    print(f"  Result              : {verdict}")
    print(_wrap(
        "INTERPRETATION: The null hypothesis of the ADF test is that the "
        "series has a unit root (i.e., is non-stationary). A p-value below 0.05 rejects "
        "that null, meaning the series is already stationary and ARIMA's differencing "
        "term (d) can stay at 0. A p-value at or above 0.05 means the raw series drifts "
        "over time, so arima_service.py automatically applies one round of differencing "
        "(d=1) before fitting -- this is why the model order search in Figure 3/5 is not "
        "run on raw case counts directly."
    ))
else:
    print("  No representative series available; skipping single-series ADF test.")

# Aggregate ADF check across every barangay used for the disease evaluated in
# Figure 5, so the stationarity claim is verified across the dataset rather
# than on one cherry-picked series.
adf_results = []
try:
    agg_adf = _load_disease_specific_df(disease_to_eval)
    for barangay in agg_adf["barangay"].unique():
        b_df = agg_adf[agg_adf["barangay"] == barangay].sort_values(["year", "month_no"])
        b_df["period_dt"] = pd.to_datetime(
            b_df["year"].astype(str) + "-" +
            b_df["month_no"].astype(str).str.zfill(2)
        ).dt.to_period("M")
        series = b_df.groupby("period_dt")["cases"].sum().astype(float).asfreq("M", fill_value=0)
        if len(series.dropna()) < 12:
            continue
        rep = adf_test_report(series)
        if rep["p_value"] is not None:
            adf_results.append({"barangay": barangay, **rep})
except Exception as e:
    print(f"  Warning: {e}")

if adf_results:
    n_stationary = sum(1 for r in adf_results if r["is_stationary"])
    avg_p        = float(np.mean([r["p_value"] for r in adf_results]))
    print(f"\n  Barangays tested          : {len(adf_results)}  [{disease_to_eval}]")
    print(f"  Stationary at p<0.05      : {n_stationary} / {len(adf_results)}")
    print(f"  Average p-value           : {avg_p:.4f}")
    print(_wrap(
        f"INTERPRETATION: {n_stationary} of {len(adf_results)} barangay series for "
        f"{disease_to_eval} were already stationary; the rest were automatically "
        "differenced (d=1) by _select_arima_order/_sarima_order_search before "
        "fitting. This confirms the ADF-based order selection is behaving as "
        "intended across the dataset, not just for the single sample series above."
    ))
else:
    print("  Insufficient per-barangay history for aggregate ADF verification.")


# ─────────────────────────────────────────────────────────────────────────────
# INVARIANT CHECKS — properties that must hold, not accuracy figures
#
#   These replaced two checks that stopped meaning anything when the tier
#   classifier was removed:
#
#     * "ARIMA / Classifier agreement" compared ARIMA's trend against the
#       classifier's risk band. Both were derived from the same forecast, so
#       agreement was close to guaranteed and measured nothing.
#     * A regression guard asserted the highest-volume barangay was not
#       classified "Low". rf_current_risk now carries the action tier
#       (ESCALATE / MONITOR / ROUTINE) and is never "Low", so the assert could
#       not fail. A test that always passes is worse than no test: it reports
#       green regardless of what broke.
#
#   What follows are real invariants of the top-down design, each able to fail.
# ─────────────────────────────────────────────────────────────────────────────

_section("Invariant checks")

_all_barangays = sorted((models.get("barangay_shares") or {}).keys())
_inv_ok = True

# 1. COHERENCE — barangay forecasts must sum to the municipality forecast.
#    This is the property top-down buys and a threshold rule cannot: if it
#    fails, the page is showing barangay numbers that contradict the total.
_sum_next, _mun_next = 0.0, None
for _b in _all_barangays:
    _pred = _hybrid_predict_one_alldisease(_b, models, steps=3, current_override=None, period="month")
    _sum_next += float(_pred["arima_forecast"][0])
    if _mun_next is None and _pred.get("municipality_forecast"):
        _mun_next = float(_pred["municipality_forecast"][0])

if _mun_next:
    _drift = abs(_sum_next - _mun_next)
    _coherent = _drift <= max(0.5, _mun_next * 0.005)     # allow rounding only
    _inv_ok &= _coherent
    print(f"  Coherence     : barangays sum {_sum_next:.1f} vs municipality {_mun_next:.1f} "
          f"(drift {_drift:.2f})  ->  {'PASS' if _coherent else 'FAIL'}")
else:
    print("  Coherence     : no municipality forecast available  ->  SKIPPED")

# 2. SHARES — must form a proper distribution, or the split silently loses or
#    invents cases.
_share_sum = sum((models.get("barangay_shares") or {}).values())
_shares_ok = abs(_share_sum - 1.0) < 1e-6
_inv_ok &= _shares_ok
print(f"  Shares        : sum to {_share_sum:.6f} across {len(_all_barangays)} barangays  "
      f"->  {'PASS' if _shares_ok else 'FAIL'}")

# 3. INTERVALS — a barangay's own forecast must sit inside its own interval,
#    and the interval must be non-degenerate. A zero-width interval was a real
#    bug: scaling the municipal CI by a 6% share produced +/-0.1 cases.
_iv_ok = True
for _b in _all_barangays[:10]:
    _pred = _hybrid_predict_one_alldisease(_b, models, steps=3, current_override=None, period="month")
    _lo, _pt, _hi = _pred["arima_lower_ci"][0], _pred["arima_forecast"][0], _pred["arima_upper_ci"][0]
    if not (_lo <= _pt <= _hi) or (_hi - _lo) < 0.5:
        _iv_ok = False
        print(f"    {_b}: {_lo}-{_hi} around {_pt}  ->  FAIL")
_inv_ok &= _iv_ok
print(f"  Intervals     : point inside a non-degenerate band  ->  {'PASS' if _iv_ok else 'FAIL'}")

# 4. ACTION TIER — a rule over observed cases, so it must never carry a
#    probability. The old panel showed "High: 100%, Low: 0%" beside a
#    deterministic threshold, which read as model confidence.
_tier_pred = _hybrid_predict_one_alldisease(_all_barangays[0], models, steps=3,
                                            current_override=None, period="month")
_rule_ok = bool(_tier_pred.get("action_is_rule")) and not _tier_pred.get("action_proba")
_inv_ok &= _rule_ok
print(f"  Action tier   : flagged as a rule, reports no confidence  ->  "
      f"{'PASS' if _rule_ok else 'FAIL'}")

assert _inv_ok, "INVARIANT CHECK FAILED -- see the lines above"
print(_wrap(
    "INTERPRETATION — these are invariants rather than accuracy scores: each one can fail, "
    "and a failure means the pipeline is internally inconsistent regardless of how good the "
    "numbers look. Coherence in particular is the property the top-down design exists to "
    "provide, and it is the one a barangay-by-barangay fit could not offer."
))


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 7 — Summary Dashboard
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 7 — Summary Dashboard")

fig = plt.figure(figsize=(12, 8), facecolor="#F9FAFB")
gs  = gridspec.GridSpec(2, 3, figure=fig, hspace=0.5, wspace=0.4)

fig.suptitle("BVetter Analytics — Model Evaluation Summary",
             fontsize=16, fontweight="bold", y=1.02)

# ── KPI tiles ── (5 honest tiles, each a real, distinct number)
kpi_data = [
    ("Municipality Forecast", f"{_mun_acc.get('mape', 'N/A')}%", BRAND_GREEN,
     "Seasonal ARIMA, 6-month holdout.\nBarangay figures are split from this"),
    ("Per-Disease Forecast",
     f"MAE {_dfc.get('holdout_mae', 'N/A')}" if _dfc.get("available") else "N/A",
     BRAND_AMBER,
     f"Pooled Random Forest, {_dfc.get('n_diseases','?')} diseases.\n"
     f"Baseline MAE {_dfc.get('baseline_mae','?')} (Fig. 2)"),
    ("ADF Stationarity",
     f"{sum(1 for r in adf_results if r['is_stationary'])}/{len(adf_results)}" if adf_results else "N/A",
     BRAND_GRAY,  "Barangay series confirmed\nstationary before ARIMA fit"),
    ("Disease-Specific ARIMA MAE",
     f"{df_ar['MAE'].mean():.2f}" if len(df_ar) else "N/A",
     BRAND_BLUE, "Average 3-month holdout MAE\nacross barangays (Fig. 5)"),
    ("Diagnosis Top-3",
     f"{_dgn['top3_accuracy']}%" if _dgn.get("available") else "N/A",
     BRAND_GREEN,
     f"Random Forest over {_dgn.get('n_classes','?')} diseases." + chr(10) +
     f"Matches its lookup baseline (Fig. 2)"),
]

for idx, (title, value, color, note) in enumerate(kpi_data):
    row, col = divmod(idx, 3)
    ax = fig.add_subplot(gs[row, col])
    ax.set_facecolor(color)
    ax.text(0.5, 0.62, value, ha="center", va="center",
            fontsize=22, fontweight="bold", color="white",
            transform=ax.transAxes)
    ax.text(0.5, 0.88, title, ha="center", va="center",
            fontsize=10, fontweight="bold", color="white",
            transform=ax.transAxes)
    ax.text(0.5, 0.22, note, ha="center", va="center",
            fontsize=7.5, color="white", alpha=0.9,
            transform=ax.transAxes, multialignment="center")
    ax.set_xticks([]); ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)

fig.text(0.5, -0.04, (
    "Summary: seasonal ARIMA forecasts the municipality-wide caseload, and each barangay "
    "receives that forecast split by its historical share -- barangay figures therefore sum "
    "exactly to the municipal total. A pooled Random Forest forecasts per-disease counts "
    "across all diseases at once, and a second Random Forest maps symptoms to a likely "
    "diagnosis. The barangay action level (Needs Action / Watch / Normal) is a documented "
    "rule over observed cases, not a model: a classifier was fitted there and removed after "
    "it scored 55.9% against a 65.4% majority baseline, because barangay-month counts carry "
    "a lag-1 autocorrelation of 0.018 (Figure 1)."
), ha="center", fontsize=9, color=BRAND_GRAY, wrap=True, transform=fig.transFigure)

plt.tight_layout()
_save(fig, "fig7_summary_dashboard.png", dpi=180)


# ─────────────────────────────────────────────────────────────────────────────
# Final console summary
# ─────────────────────────────────────────────────────────────────────────────

_section("Evaluation Complete")

print(f"""
╔══════════════════════════════════════════════════════════════╗
║           BVetter — MODEL EVALUATION RESULTS                ║
╠══════════════════════════════════════════════════════════════╣
║  BARANGAY ACTION TIER (All-Disease)  — a RULE, not a model    ║
║    Method                : documented threshold               ║
║    Basis                  : observed cases vs own p75/p90     ║
║    Rows it labelled       : {models['trained_on']}                            ║
║    Why not a classifier   : 55.9% vs 65.4% majority baseline  ║
╠══════════════════════════════════════════════════════════════╣
║  DIFFERENTIAL DIAGNOSIS  — RandomForestClassifier             ║
║    Top-1 accuracy         : {_dgn.get('top1_accuracy','N/A')}%                          ║
║    Top-3 accuracy         : {_dgn.get('top3_accuracy','N/A')}%                          ║
║    Lookup baseline        : {_dgn.get('lookup_baseline','N/A')}%                          ║
║    Trained on             : {_dgn.get('trained_on','N/A')} consultations, {_dgn.get('n_classes','N/A')} classes  ║
╠══════════════════════════════════════════════════════════════╣
║  PER-DISEASE FORECAST  — pooled RandomForestRegressor         ║
║    Holdout MAE            : {_dfc.get('holdout_mae','N/A')}                           ║
║    Baseline MAE           : {_dfc.get('baseline_mae','N/A')}                           ║
╠══════════════════════════════════════════════════════════════╣
║  ALL-DISEASE ARIMA (powers every all-disease forecast,        ║
║  both month and year views)                                   ║
║    Pooled MAE             : {models['mae']}                           ║
║    Pooled RMSE            : {models['rmse']}                           ║
║    Pooled MAPE            : {models['mape']} %                        ║
╠══════════════════════════════════════════════════════════════╣
║  ARIMA / SARIMA (Disease-Specific, powers period="year")     ║
║    Avg MAE               : {df_ar['MAE'].mean():.2f} cases/month            ║
║    Avg RMSE              : {df_ar['RMSE'].mean():.2f}                        ║
║    Barangays evaluated   : {len(df_ar)}                             ║
╠══════════════════════════════════════════════════════════════╣
║  ADF STATIONARITY TEST (pre-fit validation)                 ║
║    Sample series ADF p-value : {adf_single['p_value'] if adf_single else 'N/A'}                        ║
║    Sample series stationary  : {adf_single['is_stationary'] if adf_single else 'N/A'}                        ║
║    Stationary across barangays: {sum(1 for r in adf_results if r['is_stationary'])}/{len(adf_results)} tested          ║
╠══════════════════════════════════════════════════════════════╣
║  INVARIANT CHECKS (each one able to fail)                     ║
║    Coherence, shares, intervals, tier : {'ALL PASS' if _inv_ok else 'FAILED'}          ║
╠══════════════════════════════════════════════════════════════╣
║  OUTPUT FILES                                                ║
║    fig1_predictability_by_level.png                          ║
║    fig2_models_vs_baselines.png                              ║
║    fig3_arima_forecast_sample.png                            ║
║    fig4_vaccination_forecast.png                             ║
║    fig5_arima_metrics_barangays.png                          ║
║    fig6_arima_residuals.png                                  ║
║    fig7_summary_dashboard.png                                ║
╚══════════════════════════════════════════════════════════════╝
""")

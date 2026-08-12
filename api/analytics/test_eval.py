"""
BVetter Model Evaluation — Figures & Explanations
==================================================
Evaluates both models used in the analytics pipeline:
  1. Random Forest Regressor (case-count forecast accuracy check only —
     NOT used for risk classification; see risk_note in arima_service.py)
  2. ARIMA / SARIMA (Disease-Specific Forecasting) + the rule-based risk
     threshold that replaced the earlier RandomForestClassifier

Risk classification used to be evaluated here as a trained classifier
(confusion matrix, ROC/AUC, precision/recall/F1). That approach was
replaced in arima_service.py with a transparent p50/p75 threshold rule
after the classifier — trained without case-count features — misclassified
Tiaong (the highest-volume barangay in the dataset) as Low risk. This
script now evaluates the rule that replaced it instead of a model that no
longer exists in the live pipeline.

Outputs one PNG file per section plus a combined summary figure.
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
    load_all_disease_dataframe,
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
X        = df[FEATURE_COLS].values
y_reg    = df["total_cases"].values

# Reuse the exact split the models were trained on (models["train_idx"]/["test_idx"])
# rather than recomputing one here — otherwise this script could score rows the
# model was trained on, silently invalidating the reported MAE/RMSE/MAPE.
train_idx = models["train_idx"]
test_idx  = models["test_idx"]
split     = len(train_idx)
X_train, X_test = X[train_idx], X[test_idx]
y_reg_train, y_reg_test = y_reg[train_idx], y_reg[test_idx]

rf_reg     = models["regressor"]
y_reg_pred = rf_reg.predict(X_test)

print(f"  Dataset            : {len(df)} rows  |  train {split}  /  test {len(X_test)}")
print(f"  Risk classification: {models.get('rf_model_type', 'RuleBasedThreshold')} "
      "(p50/p75 case-count rule) — not a trained classifier, see risk_note below.")
print(_wrap(models.get("risk_note", "")))


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 1 — Risk Classification: Threshold Rule (current, all-disease)
#   Replaces the old class-distribution/confusion-matrix/per-class-metrics/ROC
#   figures, which evaluated a RandomForestClassifier that no longer exists in
#   the live pipeline (see module docstring). This shows what actually decides
#   risk today: a transparent threshold on trust-gated current case counts.
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 1 — Risk Classification: Threshold Rule (current, all-disease)")

current_by_barangay = arima_df.groupby("barangay")["total_cases"].last().sort_values(ascending=False)
thresholds_now       = _disease_risk_thresholds(list(current_by_barangay.values))
labels_by_barangay   = {b: _disease_risk_label(v, thresholds_now) for b, v in current_by_barangay.items()}

fig, ax = plt.subplots(figsize=(11, 6), facecolor="white")
fig.suptitle("Figure 1 — Current Risk Classification (Rule-Based Threshold, All-Disease)",
             fontsize=13, fontweight="bold")

bar_colors = [RISK_PALETTE[labels_by_barangay[b]] for b in current_by_barangay.index]
ax.bar(current_by_barangay.index, current_by_barangay.values, color=bar_colors,
       edgecolor="white", linewidth=0.8)
ax.set_xticks(range(len(current_by_barangay.index)))
ax.set_xticklabels(current_by_barangay.index, rotation=75, fontsize=7)
ax.axhline(thresholds_now["low_max"], color=BRAND_GRAY, linestyle="--", linewidth=1,
           label=f"p50 = {thresholds_now['low_max']:.1f} (Low / Medium cutoff)")
ax.axhline(thresholds_now["med_max"], color="black", linestyle="--", linewidth=1,
           label=f"p75 = {thresholds_now['med_max']:.1f} (Medium / High cutoff)")
ax.set_ylabel("Current cases (most recent trusted month)")
ax.legend(fontsize=8)
ax.spines[["top", "right"]].set_visible(False)

fig.text(0.5, -0.14, (
    "Explanation: risk is not a trained ML classifier — it's a transparent rule "
    "(< p50 = Low, p50-p75 = Medium, >= p75 = High), computed fresh from each barangay's "
    "current case count. This replaced an earlier RandomForestClassifier that, trained "
    "without case-count features, misclassified Tiaong — the barangay with the highest "
    "case volume in the dataset — as Low risk. Case counts here come from the trust-gated "
    "series (the same rule ARIMA forecasting already uses for its own tail data), so a "
    "single sparse or gap-broken live month can't misreport a barangay's real level."
), ha="center", fontsize=8.5, color=BRAND_GRAY, wrap=True, transform=fig.transFigure)

plt.tight_layout()
_save(fig, "fig1_risk_threshold_rule.png")

n_high = sum(1 for l in labels_by_barangay.values() if l == "High")
n_med  = sum(1 for l in labels_by_barangay.values() if l == "Medium")
n_low  = sum(1 for l in labels_by_barangay.values() if l == "Low")
top_barangay = current_by_barangay.index[0]
print(f"  Thresholds   : Low < {thresholds_now['low_max']:.1f}  |  "
      f"Medium {thresholds_now['low_max']:.1f}-{thresholds_now['med_max']:.1f}  |  "
      f"High >= {thresholds_now['med_max']:.1f}")
print(f"  Distribution : {n_high} High, {n_med} Medium, {n_low} Low  (n={len(labels_by_barangay)})")
print(f"  Highest current case count: {top_barangay} "
      f"({current_by_barangay.iloc[0]:.0f} cases) → {labels_by_barangay[top_barangay]}")

print(_wrap(
    "INTERPRETATION — Figure 1: bars are current per-barangay case counts, colored by the "
    "rule's own output. A barangay sitting above the black p75 line is High by construction "
    "— there's no separate 'accuracy' to report for a rule that IS the definition of the "
    "label, which is exactly why this replaced a classifier score."
))


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 2 — Feature Importance
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 2 — Feature Importance")

importance = models["importance"]
feat_names = list(importance.keys())
feat_vals  = list(importance.values())

fig, ax = plt.subplots(figsize=(10, 5.5), facecolor="white")
fig.suptitle("Figure 2 — Random Forest — Feature Importance (Mean Decrease in Impurity)",
             fontsize=13, fontweight="bold")

colors_ = [BRAND_BLUE if v >= 0.05 else BRAND_GRAY for v in feat_vals]
bars = ax.barh(feat_names[::-1], feat_vals[::-1], color=colors_[::-1],
               edgecolor="white", linewidth=0.8)
for bar, v in zip(bars, feat_vals[::-1]):
    ax.text(v + 0.002, bar.get_y() + bar.get_height() / 2,
            f"{v:.3f}", va="center", fontsize=8)

ax.axvline(0.05, color=BRAND_RED, linestyle="--", linewidth=0.8, alpha=0.7)
ax.set_xlabel("Importance score (sum = 1.0)")
ax.text(0.051, -0.7, "5 % threshold", color=BRAND_RED, fontsize=8)
ax.spines[["top", "right"]].set_visible(False)

fig.text(0.5, -0.05, (
    "Explanation: Feature importance (Mean Decrease in Impurity) measures how much "
    "each input variable reduces uncertainty at split points across all trees. "
    "Higher = more useful. Lag features (last known case counts) typically dominate "
    "because disease incidence is autocorrelated. Seasonal features (month_sin/cos) "
    "capture cyclic patterns such as dry-season respiratory peaks."
), ha="center", fontsize=9, color=BRAND_GRAY, wrap=True, transform=fig.transFigure)

plt.tight_layout()
_save(fig, "fig2_feature_importance.png")

print("  Top-5 features:")
for fname, fval in list(importance.items())[:5]:
    print(f"    {fname:25s}  {fval:.4f}")

print(_wrap(
    "INTERPRETATION — Figure 2: Features above the 5% line (dashed red) meaningfully "
    "contribute to predictions. If lag_1 alone accounts for > 50% of importance, "
    "the RF is essentially learning 'tomorrow ≈ today', which is useful but indicates "
    "limited pattern learning. Diverse feature importance across lag, rolling, and "
    "seasonal columns is a healthier sign."
))


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 3 — RF Regressor: Actual vs Predicted
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 3 — RF Regressor: Actual vs Predicted")

fig, axes = plt.subplots(1, 2, figsize=(12, 4.5), facecolor="white")
fig.suptitle("Figure 3 — RF Case Regressor — Actual vs Predicted (Test Set)",
             fontsize=13, fontweight="bold", y=1.02)

# Scatter
ax = axes[0]
max_val = max(y_reg_test.max(), y_reg_pred.max()) * 1.05
ax.scatter(y_reg_test, y_reg_pred, alpha=0.4, s=20,
           color=BRAND_BLUE, edgecolors="none")
ax.plot([0, max_val], [0, max_val], "r--", lw=1.2, label="Perfect fit (y = x)")
ax.set_xlabel("Actual cases"); ax.set_ylabel("Predicted cases")
ax.set_title("Scatter: Predicted vs Actual")
ax.legend(fontsize=9)
ax.spines[["top", "right"]].set_visible(False)

# Residuals histogram
ax2 = axes[1]
residuals = y_reg_pred - y_reg_test
ax2.hist(residuals, bins=30, color=BRAND_BLUE, edgecolor="white", alpha=0.85)
ax2.axvline(0, color=BRAND_RED, linestyle="--", lw=1.2)
ax2.axvline(residuals.mean(), color=BRAND_AMBER, linestyle="-", lw=1.2,
            label=f"Mean residual = {residuals.mean():.2f}")
ax2.set_xlabel("Residual (Predicted − Actual)")
ax2.set_ylabel("Frequency")
ax2.set_title("Residuals Distribution")
ax2.legend(fontsize=9)
ax2.spines[["top", "right"]].set_visible(False)

mae_val  = mean_absolute_error(y_reg_test, y_reg_pred)
rmse_val = float(np.sqrt(np.mean(residuals ** 2)))
mse_val  = float(np.mean(residuals ** 2))
r2_val   = r2_score(y_reg_test, y_reg_pred)
evs_val  = explained_variance_score(y_reg_test, y_reg_pred)
fig.text(0.5, -0.06, (
    f"Explanation: MAE = {mae_val:.2f} cases — on average the model is off by this "
    f"many cases per month per barangay. RMSE = {rmse_val:.2f} (penalises large "
    f"errors more). R² = {r2_val:.4f} ({r2_val*100:.2f}% of variance explained). "
    "A residuals histogram centred near zero with roughly symmetric "
    "tails indicates unbiased predictions. A heavy right tail means the model "
    "under-predicts during outbreak spikes."
), ha="center", fontsize=9, color=BRAND_GRAY, wrap=True, transform=fig.transFigure)

plt.tight_layout()
_save(fig, "fig3_rf_regressor_actual_vs_predicted.png")

print(f"  Regressor — MAE: {mae_val:.4f}  MSE: {mse_val:.4f}  RMSE: {rmse_val:.4f}  "
      f"MAPE: {models['mape']}%  R2: {r2_val:.4f}  Explained Variance: {evs_val:.4f}")
print(_wrap(
    f"INTERPRETATION — Figure 3: Points close to the red diagonal (y=x) indicate "
    f"accurate predictions. Systematic deviation above or below the line is bias. "
    f"An MAE of ~{mae_val:.1f} cases means the model is useful for trend detection "
    "but not precise enough for exact case counts — which is expected and acceptable "
    "for a 3-year training dataset."
))


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 4 — ARIMA: Sample Forecast with Confidence Interval
#            (one representative disease × barangay)
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 4 — ARIMA Forecast (sample series)")

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
        f"Figure 4 — ARIMA Forecast: {chosen_disease} in {chosen_barangay}  "
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
    _save(fig, "fig4_arima_forecast_sample.png")
    print(f"  Disease: {chosen_disease}  |  Barangay: {chosen_barangay}")
    print(f"  Forecast: {result['forecast']}  |  Trend: {result['trend']}")
else:
    print("  No series with ≥ 12 observations found; skipping Figure 4.")


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 5 — Mass Vaccination ARIMA Forecast (Aggregate + Per-Barangay)
#   Answers RQ 2.2 directly (Figure 4 above is disease-case forecasting, a
#   different pipeline). Data source: Forecast_Input_* sheets (README-designated
#   for vaccination forecasting). Per-barangay panel uses the real
#   Barangay_Masterlist allocation_weight (2025 dog-population share) applied to
#   the one real municipal ARIMA forecast — no per-barangay vaccination history
#   exists in the source data, so this is disclosed as a weighted allocation,
#   not an independently-fit per-barangay model.
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 5 — Mass Vaccination ARIMA Forecast")

from arima_service import (
    load_vaccination_series, run_vaccination_arima,
    load_barangay_allocation_weights, forecast_vaccination_by_barangay,
)

vacc_series_dict, _ = load_vaccination_series()
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
    f"Figure 5 — Mass Vaccination ARIMA Forecast (Total Animals Vaccinated)  "
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
_save(fig, "fig5_vaccination_forecast.png")

print(f"  Aggregate forecast: {vacc_result['forecast']}  |  Trend: {vacc_result['trend']}")
if note_txt:
    print(f"  Data quality note: {note_txt}")
print("  Top 5 barangays (next-month allocation):")
for b, v in barangay_next_month[:5]:
    print(f"    {b:22s} {v:.1f}")

print(_wrap(
    "INTERPRETATION — Figure 5: The municipal forecast (left) is the only real, ARIMA-fitted "
    "time series available for vaccination demand — it already accounts for the 2023-2025 "
    "data-basis difference (see data-quality flag above; 2025 uses one official annual total "
    "allocated across months rather than granular monthly logs, per the workbook's own README) "
    "by flooring to a seasonal baseline. The per-barangay breakdown (right) answers the "
    "operational question 'how many doses per barangay' using a real population-based "
    "weighting, but should be reported as an allocation of the aggregate forecast, not as "
    "27 independently-validated barangay forecasts."
))


# ─────────────────────────────────────────────────────────────────────────────
# ARIMA pooled regression metrics (R² / MSE / RMSE / Explained Variance) —
# same total_cases target and holdout scheme as the RF Regressor (Figure 3),
# so the two models are reported on comparable metrics. No new figure; this
# reuses the per-barangay all-disease series already built for training.
# ─────────────────────────────────────────────────────────────────────────────

_section("ARIMA Pooled Regression Metrics (All-Disease, pooled across barangays)")

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
        f"3-month-ahead holdout, using only that barangay's history (no cross-feature "
        f"or disease-composition inputs). R² = {arima_r2:.4f} vs the RF Regressor's "
        f"{r2_val:.4f} (Figure 3) reflects that gap — RF has access to seasonal and "
        "disease-mix features in addition to case history, while ARIMA is a pure "
        "univariate time-series model."
    ))
else:
    print("  Insufficient per-barangay history for pooled ARIMA regression metrics.")


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 6 — ARIMA Metrics Across Barangays (MAE / RMSE / MAPE)
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 6 — ARIMA Metrics Across Barangays")

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
        f"Figure 6 — ARIMA Holdout Metrics per Barangay  [{disease_to_eval}]",
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
    _save(fig, "fig6_arima_metrics_barangays.png")

    print(f"  Evaluated {len(df_ar)} barangays with sufficient data.")
    print(f"  Avg MAE : {df_ar['MAE'].mean():.2f}")
    print(f"  Avg RMSE: {df_ar['RMSE'].mean():.2f}")
    print(f"  Avg MAPE: {df_ar['MAPE'].mean():.1f} %")

    print(_wrap(
        f"INTERPRETATION — Figure 6: Average MAE of {df_ar['MAE'].mean():.2f} means "
        f"the ARIMA model is off by roughly that many cases per month in the holdout "
        "window. Barangays with tall MAE bars likely had an outbreak during the "
        "test period that ARIMA could not anticipate. These are candidates for "
        "human-in-the-loop review rather than pure algorithmic alerts."
    ))
else:
    print("  No ARIMA metrics available; check disease data.")


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 7 — ARIMA Residual Analysis (ACF-style manual + QQ)
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 7 — ARIMA Residual Analysis")

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
            f"Figure 7 — ARIMA Residual Diagnostics  [{chosen_disease} / {chosen_barangay}]",
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
        _save(fig, "fig7_arima_residuals.png")

        print(f"  Shapiro-Wilk: W={sw_stat:.4f}  p={sw_p:.4f}")
        print(_wrap(
            f"INTERPRETATION — Figure 7: If residuals are random and bell-shaped, "
            f"the ARIMA model has captured the signal adequately. Patterns in the "
            "time plot (e.g., seasonal waves) mean the model is missing structure — "
            "consider a SARIMA order instead. Heavy tails in the Q-Q plot mean "
            "confidence intervals underestimate uncertainty."
        ))
    except Exception as e:
        print(f"  Residual analysis skipped: {e}")
else:
    print("  Series too short for residual analysis; skipping Figure 7.")


# ─────────────────────────────────────────────────────────────────────────────
# ADF Stationarity Test (ARIMA model-validation step, no separate figure number)
#   ARIMA assumes the series being fit is stationary (constant mean/variance
#   over time). The Augmented Dickey-Fuller test is the standard way to check
#   this before trusting the model's forecast/CI math. arima_service.py
#   already runs this test internally to pick the differencing order (d);
#   this section surfaces the actual statistic/p-value as an evaluation
#   metric instead of only using it as a silent internal switch.
# ─────────────────────────────────────────────────────────────────────────────

_section("ADF Stationarity Test (validation check for Figure 7)")

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
        "(d=1) before fitting -- this is why the model order search in Figure 4/6 is not "
        "run on raw case counts directly."
    ))
else:
    print("  No representative series available; skipping single-series ADF test.")

# Aggregate ADF check across every barangay used for the disease evaluated in
# Figure 6, so the stationarity claim is verified across the dataset rather
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
# ARIMA / Threshold Agreement Rate — cross-check between two independent
# signals (ARIMA trend direction and the rule-based risk level) for the
# all-disease pipeline. This is the honest replacement for the retired
# classifier's precision/recall/F1: it's a real, computed number, not a
# vanity accuracy score against a rule that IS the label's own definition.
# ─────────────────────────────────────────────────────────────────────────────

_section("ARIMA / Threshold Agreement Rate")

agreements = []
for barangay in current_by_barangay.index:
    pred = _hybrid_predict_one_alldisease(
        barangay, models, steps=3, current_override=None,
        period="year", thresholds=thresholds_now,
    )
    agreements.append(bool(pred["model_agreement"]))

agreement_rate = (sum(agreements) / len(agreements)) if agreements else None
if agreement_rate is not None:
    print(f"  Barangays checked: {len(agreements)}  |  Agreement rate: {agreement_rate:.1%}")
else:
    print("  No barangays available to check.")

print(_wrap(
    "INTERPRETATION: 'Agreement' checks whether the ARIMA trend direction "
    "(rising/stable/falling) and the rule-based risk level (High/Medium/Low) point the "
    "same way for a barangay -- two independently-computed signals (a time-series trend "
    "vs. a case-count percentile) agreeing is a real cross-check, unlike a classifier's "
    "self-reported accuracy against the label it was trained to predict."
))


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 8 — Summary Dashboard
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 8 — Summary Dashboard")

fig = plt.figure(figsize=(10, 8), facecolor="#F9FAFB")
gs  = gridspec.GridSpec(2, 2, figure=fig, hspace=0.5, wspace=0.4)

fig.suptitle("BVetter Analytics — Model Evaluation Summary",
             fontsize=16, fontweight="bold", y=1.02)

# ── KPI tiles ── (4 honest tiles; no padding with numbers that don't mean
# much on their own — see module docstring for why the old 6-tile layout,
# 3 of which reported a retired classifier's accuracy/recall/F1, was dropped)
kpi_data = [
    ("RF Regressor MAE",   f"{models['mae']}", BRAND_AMBER, "Avg absolute error in monthly\ncase count predictions"),
    ("ADF Stationarity",
     f"{sum(1 for r in adf_results if r['is_stationary'])}/{len(adf_results)}" if adf_results else "N/A",
     BRAND_GRAY,  "Barangay series confirmed\nstationary before ARIMA fit"),
    ("ARIMA Avg MAE",
     f"{df_ar['MAE'].mean():.2f}" if arima_results else "N/A",
     BRAND_BLUE, "Average 3-month holdout MAE\nacross barangays (disease-specific)"),
    ("ARIMA/Threshold Agreement",
     f"{agreement_rate:.0%}" if agreement_rate is not None else "N/A",
     BRAND_GREEN, "Trend direction vs. risk level\nagree (all-disease pipeline)"),
]

for idx, (title, value, color, note) in enumerate(kpi_data):
    row, col = divmod(idx, 2)
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
    "Summary: the RF regressor and ARIMA case forecaster work together in the BVetter "
    "pipeline. Risk classification is a transparent p50/p75 threshold on trust-gated "
    "current case counts (Figure 1), not a trained classifier — so there's no accuracy/"
    "recall/F1 to report for it; the Agreement Rate tile is the honest cross-check instead. "
    "ARIMA extrapolates the time series trend for up to 12 months ahead, after an "
    "Augmented Dickey-Fuller (ADF) test confirms whether each series is stationary and "
    "needs differencing first."
), ha="center", fontsize=9, color=BRAND_GRAY, wrap=True, transform=fig.transFigure)

plt.tight_layout()
_save(fig, "fig8_summary_dashboard.png", dpi=180)


# ─────────────────────────────────────────────────────────────────────────────
# Final console summary
# ─────────────────────────────────────────────────────────────────────────────

_section("Evaluation Complete")

print(f"""
╔══════════════════════════════════════════════════════════════╗
║           BVetter — MODEL EVALUATION RESULTS                ║
╠══════════════════════════════════════════════════════════════╣
║  RISK CLASSIFICATION                                         ║
║    Method                : RuleBasedThreshold (p50/p75)      ║
║    Not a trained classifier — see Figure 1 / risk_note       ║
╠══════════════════════════════════════════════════════════════╣
║  RANDOM FOREST CASE REGRESSOR (accuracy check only,          ║
║  not used for forecasts or risk — ARIMA/rule do that)        ║
║    MAE                   : {models['mae']}                           ║
║    RMSE                  : {models['rmse']}                           ║
║    MAPE                  : {models['mape']} %                        ║
╠══════════════════════════════════════════════════════════════╣
║  ARIMA / SARIMA (Disease-Specific, 3-month holdout)          ║
║    Avg MAE               : {df_ar['MAE'].mean():.2f} cases/month            ║
║    Avg RMSE              : {df_ar['RMSE'].mean():.2f}                        ║
║    Barangays evaluated   : {len(df_ar)}                             ║
╠══════════════════════════════════════════════════════════════╣
║  ADF STATIONARITY TEST (pre-fit validation)                 ║
║    Sample series ADF p-value : {adf_single['p_value'] if adf_single else 'N/A'}                        ║
║    Sample series stationary  : {adf_single['is_stationary'] if adf_single else 'N/A'}                        ║
║    Stationary across barangays: {sum(1 for r in adf_results if r['is_stationary'])}/{len(adf_results)} tested          ║
╠══════════════════════════════════════════════════════════════╣
║  ARIMA / THRESHOLD AGREEMENT RATE                            ║
║    Rate                  : {f'{agreement_rate:.1%}' if agreement_rate is not None else 'N/A'}                        ║
╠══════════════════════════════════════════════════════════════╣
║  OUTPUT FILES                                                ║
║    fig1_risk_threshold_rule.png                              ║
║    fig2_feature_importance.png                               ║
║    fig3_rf_regressor_actual_vs_predicted.png                 ║
║    fig4_arima_forecast_sample.png                            ║
║    fig5_vaccination_forecast.png                              ║
║    fig6_arima_metrics_barangays.png                          ║
║    fig7_arima_residuals.png                                  ║
║    fig8_summary_dashboard.png                                ║
╚══════════════════════════════════════════════════════════════╝
""")

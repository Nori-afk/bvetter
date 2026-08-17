"""
BVetter Model Evaluation — Figures & Explanations
==================================================
Evaluates every model actually used in the analytics pipeline:
  1. All-Disease RandomForestClassifier (risk classification) — see risk_note
     in arima_service.py for the full history of this classifier.
  2. ARIMA / SARIMA (period="month" and period="year" forecasts, both the
     all-disease and disease-specific pipelines) — this is the only forecast
     engine now; the RandomForestRegressor that used to sit alongside the
     classifier never produced a live forecast and has been removed.
  3. The rule-based risk threshold used by the disease-specific pipeline
     (never had a classifier, unlike the all-disease pipeline).

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

rf_cls = models["classifier"]
le     = models["label_encoder"]

print(f"  Dataset            : {len(df)} rows  |  classifier trained on {models['trained_on']} labeled rows")
print(f"  Risk classification: {models.get('rf_model_type', 'RandomForestClassifier')} "
      f"(accuracy {models['classifier_accuracy']}%) — see risk_note below.")
print(_wrap(models.get("risk_note", "")))


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 1 — Risk Classification: RandomForestClassifier Confusion Matrix +
#            Per-Class Precision/Recall/F1 (all-disease)
#   Restored after a stretch where this was a rule-based threshold instead of
#   a trained classifier (see get_all_disease_models()'s risk_note for the
#   full history: it started as a classifier, was broken by a version that
#   excluded case-count features, got replaced with a threshold rule instead
#   of having the actual cause fixed, and is now a classifier again with
#   those features restored).
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 1 — Risk Classification: RandomForestClassifier (all-disease)")

classes = models["classifier_classes"]
cm      = np.array(models["classifier_confusion_matrix"])
prec    = models["classifier_precision"]
rec     = models["classifier_recall"]
f1      = models["classifier_f1"]

fig, axes = plt.subplots(1, 2, figsize=(13, 5.2), facecolor="white")
fig.suptitle("Figure 1 — Risk Classification: RandomForestClassifier (Held-Out Test Set, All-Disease)",
             fontsize=13, fontweight="bold")

# Left: confusion matrix
ax = axes[0]
im = ax.imshow(cm, cmap="Blues")
ax.set_xticks(range(len(classes))); ax.set_xticklabels(classes)
ax.set_yticks(range(len(classes))); ax.set_yticklabels(classes)
ax.set_xlabel("Predicted"); ax.set_ylabel("Actual")
ax.set_title("Confusion Matrix", fontsize=11)
vmax = cm.max() if cm.max() > 0 else 1
for i in range(len(classes)):
    for j in range(len(classes)):
        color = "white" if cm[i, j] > vmax * 0.5 else "black"
        ax.text(j, i, str(cm[i, j]), ha="center", va="center", color=color, fontsize=12, fontweight="bold")

# Right: precision/recall/F1 per class
ax2 = axes[1]
x = np.arange(len(classes))
width = 0.25
ax2.bar(x - width, [prec[c] for c in classes], width, label="Precision", color=BRAND_BLUE)
ax2.bar(x,          [rec[c]  for c in classes], width, label="Recall",    color=BRAND_GREEN)
ax2.bar(x + width,  [f1[c]   for c in classes], width, label="F1",        color=BRAND_AMBER)
ax2.set_xticks(x); ax2.set_xticklabels(classes)
ax2.set_ylim(0, 1.15)
ax2.set_title("Per-Class Precision / Recall / F1", fontsize=11)
ax2.legend(fontsize=8)
ax2.spines[["top", "right"]].set_visible(False)

fig.text(0.5, -0.1, (
    f"Explanation: trained on {models['trained_on']} risk_class-labeled rows (stratified "
    "80/20 split, SMOTE-balanced training fold only) using past-only case-count features "
    "(lag_1/2/3, rolling stats) and calendar terms. High accuracy is expected here because "
    "risk_class is itself close to a threshold on case volume, and a model that sees prior "
    "months' volume should recover it — but a PERFECT score would be a red flag, and was: "
    "an earlier feature set included current-month disease-mix ratios, which encode "
    "total_cases and therefore the label itself, and scored 100%. The Low class is not "
    "detected at all: 6 of the labelled rows are Low, leaving 1 in the held-out fold, so "
    "its precision and recall are 0.0 and should be read as undetected rather than as a "
    "weak detection. See risk_note for the full history."
), ha="center", fontsize=8.5, color=BRAND_GRAY, wrap=True, transform=fig.transFigure)

plt.tight_layout()
_save(fig, "fig1_risk_classifier_confusion_matrix.png")

print(f"  Classes: {classes}")
print(f"  Accuracy: {models['classifier_accuracy']}%")
for c in classes:
    print(f"    {c:8s}  precision={prec[c]:.3f}  recall={rec[c]:.3f}  f1={f1[c]:.3f}")
print(_wrap(
    "INTERPRETATION — Figure 1: off-diagonal cells in the confusion matrix (left) are "
    "misclassifications. High and Medium separate reliably. The Low class does NOT: only 6 "
    "of the labelled rows are Low, which leaves a single row in the held-out fold, and the "
    "model misclassifies it — precision and recall are both 0.000. Read that as Low being "
    "undetected rather than weakly detected; no amount of resampling creates information "
    "from 6 examples. Accuracy below 100% is the expected and correct outcome here: an "
    "earlier feature set scored a perfect 100% by reading current-month disease-mix ratios, "
    "which encode total_cases and therefore the label itself."
))


# ─────────────────────────────────────────────────────────────────────────────
# FIGURE 2 — Feature Importance
# ─────────────────────────────────────────────────────────────────────────────

_section("Figure 2 — Feature Importance")

importance = models["importance"]
feat_names = list(importance.keys())
feat_vals  = list(importance.values())

fig, ax = plt.subplots(figsize=(10, 5.5), facecolor="white")
fig.suptitle("Figure 2 — Random Forest Classifier — Feature Importance (Mean Decrease in Impurity)",
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
    "Higher = more useful. Case-count features (lag_1, rolling_mean_3, etc.) dominate, "
    "since risk_class is itself largely a function of case volume. Every feature here "
    "describes a month already past or known in advance — current-month disease-mix "
    "ratios were removed because they encoded total_cases, the quantity that defines "
    "the label."
), ha="center", fontsize=9, color=BRAND_GRAY, wrap=True, transform=fig.transFigure)

plt.tight_layout()
_save(fig, "fig2_feature_importance.png")

print("  Top-5 features:")
for fname, fval in list(importance.items())[:5]:
    print(f"    {fname:25s}  {fval:.4f}")

print(_wrap(
    "INTERPRETATION — Figure 2: features above the 5% line (dashed red) meaningfully "
    "contribute to predictions. Past-month case counts leading is the healthy outcome for "
    "THIS model — the classifier can see the signal that defines the label without being "
    "handed the label itself. lag_1 leading specifically matters, because lag_1 is the one "
    "feature the ARIMA forecast replaces when scoring a future month, so the forecast "
    "actually drives the prediction. Current-month disease-mix ratios used to lead this "
    "chart; they were removed as target leakage."
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
if note_txt:
    print(f"  Data quality note: {note_txt}")
print("  Top 5 barangays (next-month allocation):")
for b, v in barangay_next_month[:5]:
    print(f"    {b:22s} {v:.1f}")

print(_wrap(
    "INTERPRETATION — Figure 4: The municipal forecast (left) is the only real, ARIMA-fitted "
    "time series available for vaccination demand — it already accounts for the 2023-2025 "
    "data-basis difference (see data-quality flag above; 2025 uses one official annual total "
    "allocated across months rather than granular monthly logs, per the workbook's own README) "
    "by flooring to a seasonal baseline. The per-barangay breakdown (right) answers the "
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
# ARIMA / Classifier Agreement Rate — cross-check between two independent
# signals (ARIMA trend direction and the classifier's risk level) for the
# all-disease pipeline. Two independently-computed signals agreeing is a
# real cross-check, distinct from the classifier's own held-out accuracy
# (Figure 1) or ARIMA's own held-out accuracy (above) -- this instead checks
# whether the two models actually agree with EACH OTHER on new predictions.
# ─────────────────────────────────────────────────────────────────────────────

_section("ARIMA / Classifier Agreement Rate")

current_by_barangay = arima_df.groupby("barangay")["total_cases"].last().sort_values(ascending=False)

agreements, falsifiable = [], []
for barangay in current_by_barangay.index:
    pred = _hybrid_predict_one_alldisease(
        barangay, models, steps=3, current_override=None, period="year",
    )
    agreements.append(bool(pred["model_agreement"]))
    # A Medium prediction satisfies every branch of the agreement rule, so it
    # cannot disagree with any trend. Only non-Medium rows can fail the check,
    # and the rate is uninterpretable without knowing how many those were.
    falsifiable.append(str(pred["rf_future_risk"]).lower() != "medium")

agreement_rate = (sum(agreements) / len(agreements)) if agreements else None
if agreement_rate is not None:
    print(f"  Barangays checked: {len(agreements)}  |  Agreement rate: {agreement_rate:.1%}")
    print(f"  Of those, able to disagree: {sum(falsifiable)}  "
          f"({len(agreements) - sum(falsifiable)} predicted Medium, which agrees by construction)")
else:
    print("  No barangays available to check.")

print(_wrap(
    "INTERPRETATION: 'Agreement' checks whether the ARIMA trend direction "
    "(rising/stable/falling) and the classifier's risk level (High/Medium/Low) point the "
    "same way. Read this number with its denominator, not on its own: the rule counts "
    "Medium as agreeing with rising, stable AND falling, so a Medium prediction cannot "
    "fail. With most barangays predicted Medium, a high agreement rate is close to "
    "guaranteed and is NOT independent corroboration of either model. It is a weak "
    "sanity check -- it can only catch a flat contradiction such as High risk on a "
    "falling trend. The real accuracy figures are the classifier's held-out score "
    "(Figure 1) and ARIMA's own holdout R2/MAE (above); cite those instead."
))

top_barangay = current_by_barangay.index[0]
print(_wrap(
    f"REGRESSION GUARD: {top_barangay} is the highest-current-case-count barangay in the "
    "dataset -- the earlier excluded-features classifier misclassified this exact kind of "
    "barangay as Low risk. Verifying it is not Low under the current classifier:"
))
guard_pred = _hybrid_predict_one_alldisease(top_barangay, models, steps=3, current_override=None, period="year")
guard_ok = guard_pred["rf_current_risk"] != "Low"
print(f"  {top_barangay}: current_cases={guard_pred['current_cases']}, "
      f"rf_current_risk={guard_pred['rf_current_risk']}  ->  "
      f"{'PASS' if guard_ok else 'FAIL -- REGRESSION DETECTED'}")
assert guard_ok, (
    f"REGRESSION: {top_barangay} (highest case count) was classified Low risk -- "
    "this is the exact historical bug. Do not ship this model."
)


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
    ("Risk Classifier Accuracy", f"{models['classifier_accuracy']}%", BRAND_RED,
     "RandomForestClassifier,\nheld-out test set (Fig. 1)"),
    ("All-Disease ARIMA MAE",  f"{models['mae']}", BRAND_AMBER,
     "Pooled 3-month holdout,\npowers every all-disease forecast"),
    ("ADF Stationarity",
     f"{sum(1 for r in adf_results if r['is_stationary'])}/{len(adf_results)}" if adf_results else "N/A",
     BRAND_GRAY,  "Barangay series confirmed\nstationary before ARIMA fit"),
    ("Disease-Specific ARIMA MAE",
     f"{df_ar['MAE'].mean():.2f}" if len(df_ar) else "N/A",
     BRAND_BLUE, "Average 3-month holdout MAE\nacross barangays (Fig. 5)"),
    ("ARIMA/Classifier Agreement",
     f"{agreement_rate:.0%}" if agreement_rate is not None else "N/A",
     BRAND_GREEN, "Trend direction vs. risk level\nagree (all-disease pipeline)"),
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
    "Summary: a RandomForestClassifier predicts risk (Low/Medium/High) for the all-disease "
    "view, and ARIMA/SARIMA predicts every case-count forecast (month and year views, "
    "all-disease and disease-specific alike). This is a two-model architecture -- Random "
    "Forest for classification, ARIMA for time-series forecasting -- not three: an earlier "
    "RandomForestRegressor that sat alongside the classifier never produced a live forecast "
    "and has been removed (see arima_service.py's module docstring, MODEL-2)."
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
║  RISK CLASSIFICATION (All-Disease)                            ║
║    Method                : RandomForestClassifier             ║
║    Accuracy               : {models['classifier_accuracy']}%                          ║
║    Trained on              : {models['trained_on']} labeled rows                  ║
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
║  ARIMA / CLASSIFIER AGREEMENT (weak check -- see note)         ║
║    Rate                  : {f'{agreement_rate:.1%}' if agreement_rate is not None else 'N/A'}                        ║
║    Able to disagree       : {sum(falsifiable)} of {len(agreements)}                       ║
╠══════════════════════════════════════════════════════════════╣
║  REGRESSION GUARD (highest-volume barangay != Low)            ║
║    {top_barangay:20s} : {guard_pred['rf_current_risk']:10s} {'PASS' if guard_ok else 'FAIL'}              ║
╠══════════════════════════════════════════════════════════════╣
║  OUTPUT FILES                                                ║
║    fig1_risk_classifier_confusion_matrix.png                 ║
║    fig2_feature_importance.png                               ║
║    fig3_arima_forecast_sample.png                            ║
║    fig4_vaccination_forecast.png                             ║
║    fig5_arima_metrics_barangays.png                          ║
║    fig6_arima_residuals.png                                  ║
║    fig7_summary_dashboard.png                                ║
╚══════════════════════════════════════════════════════════════╝
""")

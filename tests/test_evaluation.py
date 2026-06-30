from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    mean_absolute_error
)
import numpy as np
import sys
sys.path.insert(0, '.')
from arima_service import (
    get_all_disease_models,
    load_all_disease_dataframe,
    _compute_disease_metrics,
    FEATURE_COLS,
    EXCEL_PATH
)

models = get_all_disease_models()
df     = models["df"]
le     = models["label_encoder"]
X      = df[FEATURE_COLS].values
y      = le.transform(df["risk_class"].fillna("Low").astype(str))
split  = int(len(X) * 0.8)

X_test = X[split:]
y_test = y[split:]


rf_cls  = models["classifier"]
y_pred  = rf_cls.predict(X_test)
classes = models["classes"]

print("=== RF RISK CLASSIFIER METRICS ===")
print("Classes:", classes)
print("Unique y_test:", np.unique(y_test))
print("Unique y_pred:", np.unique(y_pred))
# print(classification_report(y_test, y_pred, target_names=classes))
print("Confusion matrix:")
print(confusion_matrix(y_test, y_pred, labels=range(len(classes))))

acc  = accuracy_score(y_test, y_pred)
prec = precision_score(y_test, y_pred, average='weighted')
rec  = recall_score(y_test, y_pred, average='weighted')
f1   = f1_score(y_test, y_pred, average='weighted')

print(f"Accuracy : {acc:.4f}")
print(f"Precision: {prec:.4f}")
print(f"Recall   : {rec:.4f}")
print(f"F1-score : {f1:.4f}")

# Critical — per-class recall for 'High' risk
high_idx = list(classes).index("High")
high_recall = recall_score(y_test, y_pred, average=None)[high_idx]
print(f"High-risk recall: {high_recall:.4f}  <-- most important")

from arima_service import _load_disease_specific_df, _compute_disease_metrics
import pandas as pd

disease = "Rabies"   # replace with any disease in your data
agg     = _load_disease_specific_df(disease)

print(f"=== ARIMA METRICS: {disease} ===")
all_results = []
for barangay in agg["barangay"].unique():
    b_df = agg[agg["barangay"] == barangay].sort_values(["year","month_no"])
    b_df["period_dt"] = pd.to_datetime(
        b_df["year"].astype(str)+"-"+b_df["month_no"].astype(str).str.zfill(2)
    ).dt.to_period("M")
    series = b_df.groupby("period_dt")["cases"].sum().astype(float).asfreq("M", fill_value=0)
    m = _compute_disease_metrics(series, steps=3)
    if m["mae"] is not None:
        all_results.append(m)
        print(f"  {barangay:20s} MAE={m['mae']:6.2f}  RMSE={m['rmse']:6.2f}  MAPE={m['mape']}%")

# Average across all barangays
maes  = [r["mae"]  for r in all_results]
rmses = [r["rmse"] for r in all_results]
print(f"\nAverage MAE : {sum(maes)/len(maes):.2f}")
print(f"Average RMSE: {sum(rmses)/len(rmses):.2f}")

print("=== ALL-DISEASE RF REGRESSOR METRICS ===")
print(f"MAE  : {models['mae']}")
print(f"RMSE : {models['rmse']}")
print(f"MAPE : {models['mape']}%")
print(f"Split: {models['split_method']}")

split = int(len(df) * 0.8)
train_end_date = df.iloc[split-1][["year","month_no"]].values
test_start_date = df.iloc[split][["year","month_no"]].values
print(f"Last train row: year={train_end_date[0]}, month={train_end_date[1]}")
print(f"First test row: year={test_start_date[0]}, month={test_start_date[1]}")
# First test row must come AFTER last train row chronologically

from collections import Counter
dist = Counter(df["risk_class"].fillna("Low"))
total = sum(dist.values())
for cls, cnt in sorted(dist.items()):
    print(f"  {cls:8s}: {cnt:4d} rows ({cnt/total*100:.1f}%)")
# If one class dominates, report macro-average F1, not weighted

print(f"Total rows : {len(df)}")
print(f"Train rows : {split}")
print(f"Test rows  : {len(df) - split}")
# Aim for at least 20 test rows per class
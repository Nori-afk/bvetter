# Vaccination workbook reader update — 14 October 2026

## Source and month rules

The user confirmed that the revised 2023–2025 values replace the previous values, alongside the newly entered 2026 rows. The workbook was read without editing it.

Both the mass-vaccination history chart and ARIMA now read `Combined_Rabies_3Years` in `database/BaliwagVet_2023-2025.xlsx`. The existing filename and sheet name stay unchanged when years are appended. The separate `Forecast_Input_Dogs_3Y` and `Forecast_Input_Cats_3Y` sheets are no longer used by the vaccination model. Monthly values are read as entered, without inferring and converting cumulative totals.

The reader validates calendar months, duplicate month keys, whole nonnegative counts, and agreement between total and species counts when both species are supplied. A missing total can be calculated only when both dog and cat counts are recorded. Empty monthly rows remain missing, while explicit zero is preserved.

ARIMA uses only past calendar months. On 14 October 2026, January–September 2026 is eligible. October's 1,199 doses appear in the historical chart as an in-progress month and are excluded from fitting and evaluation. November and December are blank and are not shown as zero vaccinations. The historical year selector defaults to the newest year with recorded values.

Confirmed complete live months replace overlapping workbook totals; they are never added to them. Unconfirmed event records cannot overwrite workbook totals in the model. Reopening a live month makes it ineligible as a live source; a recorded workbook total remains available as the fallback for that month.

## Actual reader results

| Period | Observed months used by ARIMA | Doses |
| --- | ---: | ---: |
| 2023 | 12 | 13,352 |
| 2024 | 12 | 14,093 |
| 2025 | 12 | 14,227 |
| January–September 2026 | 9 | 10,601 |
| Total | 45 | 52,273 |

The historical chart has 46 populated workbook months, including in-progress October. The model has 45 eligible observations through September. The old hardcoded 2025 annual check of 31,769 was removed; the response now reports year totals calculated from the eligible workbook rows, without claiming these are independently verified source totals.

## Recalculation

The selected model is plain ARIMA(2,0,1).

| Displayed month | Point estimate | Whole-dose display |
| --- | ---: | ---: |
| November 2026 | 1,129.5 | 1,130 |
| December 2026 | 1,045.7 | 1,046 |
| January 2027 | 1,087.4 | 1,087 |

The next-month allocation covers 27 barangays and sums to 1,130 doses. Population weights were used because eligible live reporting coverage was unavailable.

| Rolling evaluation horizon | Scored forecasts | MAE (doses) | WAPE | 80% interval coverage |
| --- | ---: | ---: | ---: | ---: |
| 1 month | 12 | 115.54 | 9.82% | 83.3% |
| 2 months | 11 | 237.20 | 19.35% | 54.5% |
| 3 months | 11 | 178.02 | 15.16% | 81.8% |

The displayed estimates are two to four months after the latest observation because the current month is held out. The rolling evaluation covers only one to three months; no supported 80% interval is displayed. These metrics describe the revised workbook and should not be compared directly with the previous dataset's scores as proof of model improvement.

The machine-readable snapshot is `output/mass-vaccination/evaluation-2026-10-14.json`. It includes a workbook SHA-256 hash, the evaluation, forecasts, and barangay allocations. Prior manuscript tables and the earlier review's model figures describe the previous dataset and need updating.

## Verification and limits

- Read the revised workbook and reconciled its combined totals with both existing forecast-input sheets; they agree for all populated months.
- Executed the PHP workbook reader and the Python series loader on the actual workbook. The PHP reader returns 46 populated months; Python holds out October and returns 45 observed training months.
- Executed the actual ARIMA fitting, rolling evaluation, and allocation on the revised workbook.
- PHP lint, JavaScript syntax, and whitespace checks passed. No new automated test cases or browser regression run were performed for this update. The existing series-loading fixture was adapted to the shared workbook source.
- Local MySQL authentication required PyMySQL's RSA dependency; `pymysql[rsa]` is now declared in analytics requirements and its missing dependency was installed locally.
- The local database lacks `mass_vaccination_month_completeness`. The live monthly query therefore returned unavailable, and no live months were included. The normal events API creates that table during setup; this update did not mutate the live database. Live overlap handling was inspected in code, not exercised against local completed months in this run.
- These are local changes. The deployed server and browser were not checked.

## Deployment

Deploy the revised workbook together with `api/analytics/arima_service.py`, `api/analytics/requirements.txt`, `api/includes/dataset.php`, `api/dashboard/dashboard.php`, `vet/js/mass-vaccination.js`, and `vet/html/mass-vaccination.html`. Include the prior review's pending changes as appropriate. Install the updated analytics requirements in the service environment and restart the analytics service. Confirm that the evaluation endpoint reports 45 observations through September 2026, unless eligible live records or additional completed workbook months have subsequently changed the inputs.

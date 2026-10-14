# Mass-vaccination manuscript replacements

Evaluation date: 14 October 2026. Source manuscript: `FINAL-DEFENSE-CHAP-4-5 (1).pdf`. Page numbers below refer to that PDF. These are replacement passages for the editable manuscript; the original PDF has not been modified.

The results use the revised workbook supplied by the researchers. They describe performance against its entered monthly values. This evaluation does not independently verify those values against clinic source records. If some values are synthetic, disclose that in the dataset description and retain this limitation when interpreting the results.

## 1. Page 16–17 — Section 2.2

**Replace the paragraphs beginning “The vaccination forecast uses the municipal record…” and “The model selected by the lowest AIC…” through the Tiaong example on page 17 with:**

The mass-vaccination module estimates the combined monthly number of anti-rabies doses for dogs and cats. For this evaluation, the revised workbook provided 45 eligible monthly observations from January 2023 to September 2026, totaling 52,273 doses. The annual totals were 13,352 in 2023, 14,093 in 2024, 14,227 in 2025, and 10,601 for January–September 2026. The module reads the monthly values as entered in the Combined_Rabies_3Years sheet. October 2026 was still in progress on the evaluation date and was excluded from model fitting and testing; blank future months were not treated as zero vaccinations.

The module uses plain ARIMA to forecast the municipal total. Differencing is assessed using the Augmented Dickey–Fuller test, and the model order is selected from the implemented candidates using the lowest Akaike Information Criterion. Model selection and fitting use only the training observations during evaluation. ARIMA(2,0,1) was selected for the six-month holdout evaluation and for the current forecast fitted using all 45 eligible months. The current estimates were 1,129.5 doses for November 2026, 1,045.7 for December 2026, and 1,087.4 for January 2027, displayed as 1,130, 1,046, and 1,087 whole doses. Because October was incomplete, these displayed estimates were two to four months after the latest observed month. No validated 80% prediction range was displayed.

The municipal estimate is distributed across the 27 barangays using allocation weights. When the latest 12 completed months provide adequate reporting coverage for every barangay, the system can use their shares of completed vaccinations. Otherwise, it uses estimated dog-population shares from the barangay masterlist. The evaluation snapshot used the population-based allocation. For example, Tiaong accounted for approximately 5.61% of the estimated dog population and received 63 of the 1,130 doses estimated for November 2026. Whole-dose rounding preserves the municipal total. These are allocated planning estimates; they are not independently fitted barangay forecasts or observed barangay vaccination counts. Dog-population weights are a proxy for the combined dog-and-cat demand.

## 2. Page 17 — Figure 26 and its interpretation

**Replace the old Figure 26 image with `figure-26-vaccination-evaluation.png` from this folder. Use this caption:**

Figure 26. Municipal Anti-Rabies Vaccination Records, Six-Month Holdout Predictions, and Current Estimates

**Replace the paragraph beginning “To test the model, it was refitted…” with:**

The model was evaluated using a chronological split. The first 39 monthly observations, from January 2023 to March 2026, formed the training set. The final six complete months, April–September 2026, formed the test set and were excluded from both model selection and fitting. All six test predictions were generated from the March 2026 forecast origin without updating the model using test outcomes. Figure 26 compares these predictions with the recorded totals and with a baseline that repeats the same month of the previous year. ARIMA achieved an MAE of 170.63 doses, an RMSE of 211.68 doses, and a MAPE of 13.16%. The largest absolute error occurred in April, when the model predicted 1,379.46 doses against 1,808 recorded doses. The separate current estimates use all eligible observations through September 2026 and are not part of this holdout score.

### Supporting test results

| Test month | Recorded doses | ARIMA prediction | Same month last year |
| --- | ---: | ---: | ---: |
| April 2026 | 1,808 | 1,379.46 | 1,281 |
| May 2026 | 1,228 | 1,253.57 | 1,318 |
| June 2026 | 946 | 1,090.25 | 1,107 |
| July 2026 | 886 | 1,028.65 | 1,104 |
| August 2026 | 1,186 | 1,086.00 | 1,108 |
| September 2026 | 1,364 | 1,181.26 | 1,276 |

Note: forecasts are rounded to two decimals in this table. Metrics were calculated from the unrounded predictions saved in `holdout_predictions.csv`.

## 3. Page 18 — Table 15

**Replace the old Table 15 with the following table.** Its former columns mixed population-allocated figures with recorded counts, a constant six-month projection, and an unsupported uncertainty range. Use the dated next-month allocation shown by the current system.

Table 15. Allocation of Estimated Municipal Anti-Rabies Doses by Barangay, November 2026

| Barangay | Estimated dog-population share | Estimated doses |
| --- | ---: | ---: |
| Tiaong | 5.61% | 63 |
| San Jose | 5.10% | 58 |
| Poblacion | 4.59% | 52 |
| Sulivan | 4.59% | 52 |
| Tangos | 4.59% | 52 |
| Bagong Nayon | 4.08% | 46 |
| Pagala | 4.08% | 46 |
| Pinagbarilan | 3.88% | 44 |
| Virgen Delas Flores | 3.88% | 44 |
| Tibag | 3.67% | 42 |
| Makinabang | 3.67% | 41 |
| Tarcan | 3.67% | 41 |
| San Roque | 3.57% | 40 |
| Subic | 3.57% | 40 |
| Paitan | 3.47% | 39 |
| Sto. Cristo | 3.47% | 39 |
| Hinukay | 3.37% | 38 |
| Sto. Niño | 3.37% | 38 |
| Concepcion | 3.26% | 37 |
| Tilapayong | 3.26% | 37 |
| Barangca | 3.16% | 36 |
| Piel | 3.16% | 36 |
| Calantipay | 3.06% | 35 |
| Catulinan | 3.06% | 35 |
| Sta. Barbara | 3.06% | 35 |
| Sabang | 2.96% | 33 |
| Matangtubig | 2.74% | 31 |
| **Municipality** | **100%** | **1,130** |

Note: shares are displayed to two decimals and may not add to exactly 100% after rounding. The system uses unrounded weights and distributes remaining whole doses deterministically so the allocated doses sum to the rounded municipal estimate. Equal population shares can therefore differ by one dose. The table does not measure forecast accuracy at barangay level.

**Replace the paragraph beginning “As shown in Table 15, the monthly forecast…” with:**

Table 15 distributes the municipal November 2026 estimate of 1,130 doses across the barangays using estimated dog-population shares. Tiaong receives the largest allocation at 63 doses, followed by San Jose at 58 doses. These amounts provide a starting point for planning and should be reviewed alongside scheduled activities and updated vaccination records. The municipal holdout evaluation does not establish the accuracy of each barangay allocation, because comparable historical barangay-level actuals were not available in the evaluation dataset.

## 4. Page 19 — Q4 evaluation method

**After the paragraph beginning “Each model was evaluated on data that it was not trained on,” add this vaccination-specific paragraph:**

For mass vaccination, the revised dataset was divided chronologically into 39 training months and six test months. The training period was January 2023–March 2026, and the test period was April–September 2026. This was a six-month holdout rather than a random 80/20 split. The test values were not used to select the ARIMA order or fit its parameters. The comparison baseline used the recorded value from the same calendar month in 2025. Both methods were evaluated on the same six test months using MAE, RMSE, and MAPE. All six actual values were greater than zero, so all six were included in MAPE.

**If the methodology section elsewhere specifies an 80/20 split for vaccination, replace that statement with:**

The mass-vaccination series was split chronologically by withholding the final six complete months for testing. The preceding observations were used for model selection and training. In the evaluated dataset, this produced 39 training months and six test months, approximately 86.7% and 13.3% of the 45 eligible observations.

**Metric definitions, if needed in Chapter III or Q4:**

MAE is the mean absolute difference between recorded and predicted doses. RMSE is the square root of the mean squared difference and gives more weight to larger errors. MAPE is the mean absolute difference divided by the recorded count, expressed as a percentage. Lower values indicate smaller errors. Months with zero recorded doses remain eligible for MAE and RMSE but cannot be included in MAPE because division by zero is undefined; any such exclusions are reported. MAPE is a percentage error and must not be presented as a classification accuracy score.

## 5. Page 21 — Table 17 vaccination row

**Replace only the row “ARIMA — animals vaccinated, municipality” with:**

| Model and level | Test data | MAE | RMSE | MAPE | Baseline (MAE / MAPE) |
| --- | --- | ---: | ---: | ---: | --- |
| Plain ARIMA(2,0,1) — anti-rabies doses, municipality | 6 months, April–September 2026 | 170.63 | 211.68 | 13.16% | Same month last year: 193.67 / 15.19% |

If space permits a dedicated vaccination comparison, use:

| Model | MAE (doses) | RMSE (doses) | MAPE |
| --- | ---: | ---: | ---: |
| Plain ARIMA(2,0,1) | 170.63 | 211.68 | 13.16% |
| Same month last year | 193.67 | 249.37 | 15.19% |

The other disease and diagnosis rows have not been re-evaluated in this task. Their existing results must not be described as updated by this vaccination evaluation.

## 6. Page 22 — Interpretation of vaccination performance

**Replace the sentence beginning “The vaccination ARIMA had a MAPE of 24.3%…” with:**

The municipal vaccination ARIMA achieved an MAE of 170.63 doses, an RMSE of 211.68 doses, and a MAPE of 13.16% on the six withheld months. It produced lower errors than the same-month-last-year baseline, which obtained an MAE of 193.67 doses, an RMSE of 249.37 doses, and a MAPE of 15.19%. These results support its use as a planning estimate on the evaluated dataset. However, the six-month test is small, and its results do not establish future performance or the accuracy of individual barangay allocations. The evaluation measures agreement with the revised workbook figures rather than independently verified clinic outcomes.

**Replace “Across the models, RMSE is only 1.1 to 1.4 times the MAE, so the errors are steady rather than caused by a few large misses” with:**

RMSE exceeds MAE because larger errors receive more weight. For vaccination, the largest absolute error occurred in April 2026, when the estimate was approximately 429 doses below the recorded total; aggregate metrics should therefore be read alongside the monthly comparison in Figure 26.

## 7. Pages 28–29 — Figure 31 mass-vaccination page description

**Replace the two paragraphs beginning “Figure 31 addresses…” and “With these figures…” with:**

Figure 31 shows how the mass-vaccination page supports anti-rabies vaccination planning. It displays the combined estimated doses for the next three calendar months, the historical vaccination records, and each barangay's share of the next-month estimate. It also shows recorded barangay totals for the previous complete month when all required reports have been entered and the month has been confirmed. The page presents these values in whole doses and identifies them as estimates. Separate forecasts for dogs, cats, and pet owners are not displayed.

As of 14 October 2026, the municipal estimates were 1,130 doses for November 2026, 1,046 for December 2026, and 1,087 for January 2027. Using the available population-based allocation, Tiaong's November share was 63 doses. These estimates help staff plan supplies and activities alongside the actual campaign schedule. Creating an event alone does not add an observed vaccination count to the model. Completed reports become eligible after the past month is confirmed complete; a confirmed live monthly total replaces an overlapping workbook total to avoid counting it twice. Estimates can change as new eligible records are added.

Replace the Figure 31 screenshot with a new capture from the working deployed page so its visible dates, totals and labels agree with this description. The newly generated Figure 26 is an evaluation figure, not a replacement screenshot of the interface.

## 8. Page 62 — Chapter V, Summary of Findings, item 2

**Replace the opening sentence “The forecasting models captured the seasonal pattern of animal illness and vaccination demand and performed better than simple baseline methods” with:**

The disease and vaccination models were assessed using their respective held-out datasets and baseline methods. For vaccination, plain ARIMA(2,0,1) achieved an MAE of 170.63 doses, an RMSE of 211.68 doses, and a MAPE of 13.16% over April–September 2026, compared with 193.67 doses, 249.37 doses, and 15.19% for the same-month-last-year baseline.

Keep the subsequent disease-specific findings tied to their own evaluation. Plain ARIMA in the vaccination module has no seasonal ARIMA terms; this evaluation does not demonstrate that it has captured a stable annual seasonal pattern.

## 9. Page 64 — Chapter V, conclusion 2

**Replace conclusion 2 with:**

Time-series and machine-learning methods can support the interpretation of veterinary records, subject to the quality and coverage of their inputs. The municipal vaccination model performed better than the same-month-last-year baseline on the six-month holdout used in this study, supporting its use as a planning estimate. This result does not establish the accuracy of barangay allocations or guarantee performance on future clinic records. Disease forecasts and diagnosis rankings should be interpreted using their separate evaluation results, and clinical decisions remain the responsibility of the veterinarian.

## Technical appendix — keep separate from the main manuscript result

The operational evaluator also computes rolling-origin results. These use multiple earlier training cutoffs and different target observations; do not substitute them for the single six-month test in Table 17.

| Rolling horizon | Scored predictions | MAE (doses) | RMSE (doses) | MAPE |
| --- | ---: | ---: | ---: | ---: |
| 1 month ahead | 12 | 115.54 | 143.99 | 9.75% |
| 2 months ahead | 11 | 237.20 | 289.68 | 18.81% |
| 3 months ahead | 11 | 178.02 | 258.72 | 17.02% |

No zero-actual months were excluded from these MAPE calculations. The empirical coverage of the candidate 80% intervals was 83.3%, 54.5% and 81.8%, respectively. The system therefore does not display a validated 80% range. The current page forecasts are two to four months after September because October is incomplete; the rolling table does not cover the four-month horizon.

Do not describe the change from the old manuscript's 24.3% MAPE to 13.16% as an improvement caused solely by the model. The workbook and the test dates changed, so those scores are not a controlled comparison.

## Reproduction and evidence

Files in this folder:

- `results.json`: source hash, package versions, exact input series, fixed and rolling scores, current forecasts, and barangay allocations.
- `holdout_predictions.csv`: six unrounded test predictions and the baseline values.
- `figure-26-vaccination-evaluation.png`: replacement evaluation figure at 300 dpi.

Re-run from the repository root:

```powershell
py -3 api/analytics/evaluate_vaccination.py --output-dir output/mass-vaccination/latest
```

On the Ubuntu deployment:

```bash
.venv/bin/python api/analytics/evaluate_vaccination.py --no-figure --output-dir output/mass-vaccination/latest
```

The figure requires matplotlib. `--no-figure` writes the JSON and CSV without that optional dependency. Re-running later can change the test dates and results as eligible data changes; use the dated snapshot for the manuscript submitted with these results.

After deploying the updated service code and restarting the analytics service, view the fixed split in `data.evaluation.fixed_holdout`:

```bash
curl -sS --max-time 90 http://127.0.0.1:5001/vaccination-model-evaluation | python3 -m json.tool
```

Local evaluation used the workbook only: no completed live database months were added. The local database lacked the month-completion table, while the supplied server response also reported zero live months used. The current local forecast matches the supplied server forecast. The workbook and database were not modified by this evaluation.

Verification: 24 vaccination regression tests passed, and the MAE, RMSE and MAPE for both methods were independently recalculated from the exported CSV using standard arithmetic. All three calculations matched the saved results to two decimal places.

# Mass vaccination review — 14 October 2026

The model figures and workbook-reader limitations below describe the earlier dataset. They are superseded by [the subsequent workbook reader update](mass-vaccination-workbook-update-2026-10-14.md), which includes the user-confirmed revised history and eligible 2026 months. The backend audit findings remain applicable.

## Scope and status

Reviewed event creation/reporting, month confirmation, the anti-rabies forecast input path, barangay allocation, and related page behavior. The fixes below are local changes; deployment has not been checked. The workbook and live database records were not changed by this review.

## Fixes

- Validate whole, nonnegative reported totals and event IDs. Accept an explicitly reported zero; require a recorded species breakdown to match its total.
- Use the authenticated staff member as the record creator; reject future completed reports, invalid barangays, and duplicate date/barangay/vaccine events.
- Save event changes and reopen their month in one transaction. Month confirmation and event writes lock the same month to prevent conflicting updates.
- Include only anti-rabies doses in model totals, observed barangay shares, and the forecast's previous-month comparison. Pending or invalid reports prevent a month from entering the model.
- Detect workbook and live-record changes on forecast requests, including when a cache notification fails or reaches a different worker.
- Replace fabricated event comparison numbers with other completed reports for the same barangay and vaccine. Missing comparisons appear as unavailable.
- Remove automatically invented species counts. A failed save retains the previously saved page values; a failed forecast refresh clears old estimates.
- Derive barangay population shares from population counts, excluding the workbook's total row. Allocate whole doses while preserving the municipal total.
- Validate forecast request horizons and input values. Withhold uncertainty bounds when the requested horizon extends beyond the evaluated range.
- Remove the vaccination forecast's unnecessary dependency on the clients worksheet and declare the service's existing `imbalanced-learn` dependency.
- Retain the earlier chart layout and plain-language label improvements.

## Verification

- Python vaccination checks: 17 passed.
- Existing Python forecast-core checks: 22 passed, with 8 statsmodels warnings.
- PHP validation checks: 5 tests and 27 assertions passed.
- Eight API/MySQL integration scenarios passed in a temporary isolated database: authorization; event validation; anti-rabies filtering; month reopening/cache recovery; transaction rollback; create/delete/zero reports; confirmed-zero versus missing months; real event comparisons. The temporary database was removed afterward.
- Browser form checks passed using the real page scripts and Chart.js with mocked API responses: vaccine defaults, required species counts, failed-save handling, explicit zero, and clearing a failed forecast refresh. This was not a test of the deployed website.

## Model evaluation on the current workbook

The read-only evaluation used 36 monthly observations, January 2023 through December 2025. The 2025 combined total is 31,769 doses and matches the configured annual check. The code still identifies 2023–2024 figures as provisional.

| Forecast horizon | Scored forecasts | MAE (doses) | WAPE | 80% interval coverage |
| --- | ---: | ---: | ---: | ---: |
| 1 month | 12 | 222.17 | 8.60% | 75.0% |
| 2 months | 11 | 419.79 | 15.84% | 63.6% |
| 3 months | 11 | 438.18 | 16.57% | 72.7% |

Evaluation uses rolling historical holdouts. These figures measure errors on the workbook's held-out months; they do not verify the source records or validate the current forecast at an 11–13 month horizon.

The current fitted order is ARIMA(2,1,1). Rounded estimates are 2,788 doses for November 2026, 2,336 for December 2026, and 2,318 for January 2027. The first estimate is allocated across 27 barangays and sums to 2,788. No supported 80% range is shown because of the gap since December 2025.

## Remaining limitations and 2026 data

- The local live database did not yet have `mass_vaccination_month_completeness`, so the model evaluation used no live months. The events API creates this table during its normal setup; this behavior was exercised in the isolated integration database. Production schema and records still need a deployment check.
- Workbook model input currently comes from `Forecast_Input_Dogs_3Y` and `Forecast_Input_Cats_3Y` and is filtered to years through 2025. The descriptive historical graph reads `Combined_Rabies_3Years`.
- Appending 2026 rows to the historical worksheet alone therefore does not make them model input. Supporting this requires a reader/import change that keeps chart and model totals consistent, excludes unfinished months, and defines precedence when workbook and event records cover the same month. That import change is not part of this review.
- Municipal monthly totals cannot supply actual barangay totals. Barangay estimates continue to use population shares until the existing completed-report coverage rule is met.
- Source verification and a review of the deployed analytics service's network access are outside the completed local checks.

## Deployment

Deploy the changed PHP, JavaScript, CSS, HTML, Python files and new validation helper together. Install the analytics requirements in the service's Python environment, then restart the existing analytics service. Confirm the events API loads and inspect the evaluation endpoint's training dates and live-month status after deployment.

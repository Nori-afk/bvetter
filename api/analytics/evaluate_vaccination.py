"""Reproduce the vaccination manuscript evaluation without changing clinic data.

Run from the repository root:
    python api/analytics/evaluate_vaccination.py --output-dir output/mass-vaccination/latest

The service loader supplies the same eligible monthly totals used in production.
The manuscript result is a single six-month holdout, separate from the rolling
evaluation. Figures require matplotlib; the service itself does not import it.
"""
import argparse
import csv
import hashlib
import json
import math
import platform
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels

import arima_service as service


def write_figure(series, holdout, forecast, destination):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.dates as mdates
    import matplotlib.pyplot as plt
    from matplotlib.ticker import StrMethodFormatter

    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10})
    fig, axes = plt.subplots(2, 1, figsize=(11, 8), layout='constrained',
                             gridspec_kw={'height_ratios': [1.2, 1]})
    actual = series.loc[:series.last_valid_index()]
    test_rows = holdout['predictions']
    test_dates = pd.PeriodIndex([row['period'] for row in test_rows], freq='M').to_timestamp()
    origin_label = pd.Period(holdout['training_period_end'], freq='M').strftime('%B %Y')
    estimates = [row['forecast'] for row in test_rows]
    baseline = [row['baseline'] for row in test_rows]
    future_dates = pd.to_datetime(forecast['forecast_periods'], format='%b %Y')
    axes[0].plot(actual.index.to_timestamp(), actual.values, color='#1465a8', linewidth=1.8,
                 label='Recorded monthly doses')
    axes[0].axvspan(test_dates[0], test_dates[-1] + pd.offsets.MonthEnd(0), color='#fff1cf',
                    alpha=.8, label='Six-month test period')
    axes[0].plot(test_dates, estimates, '--o', color='#c65b13', markersize=4,
                 label=f'Forecast made at {origin_label}')
    axes[0].plot(future_dates, forecast['forecast'], '--o', color='#15804a', markersize=4,
                 label='Current estimate (all eligible history)')
    axes[0].set_title('A. Recorded doses, withheld-month predictions and current estimates', loc='left', pad=12)
    axes[0].xaxis.set_major_locator(mdates.MonthLocator(interval=4))
    axes[0].xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
    axes[0].legend(loc='upper left', fontsize=8, ncol=2)

    axes[1].plot(test_dates, [row['actual'] for row in test_rows], '-o', color='#1465a8',
                 linewidth=2, label='Recorded doses')
    axes[1].plot(test_dates, estimates, '--o', color='#c65b13', label='ARIMA prediction')
    if all(value is not None for value in baseline):
        axes[1].plot(test_dates, baseline, ':s', color='#777777', label='Same month last year')
    axes[1].set_title(f'B. Test comparison: model trained through {origin_label}', loc='left', pad=12)
    axes[1].set_xticks(test_dates)
    axes[1].xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
    axes[1].legend(loc='upper right', fontsize=8)
    for axis in axes:
        axis.set_ylabel('Anti-rabies doses')
        axis.set_ylim(bottom=0)
        axis.yaxis.set_major_formatter(StrMethodFormatter('{x:,.0f}'))
        axis.grid(axis='y', color='#e3e9ef', linewidth=.7)
        axis.spines[['top', 'right']].set_visible(False)
        axis.tick_params(axis='x', rotation=25)
    fig.suptitle('Municipal vaccination history and forecast evaluation', fontsize=15, fontweight='bold')
    fig.savefig(destination, dpi=300, facecolor='white')
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path,
                        default=Path('output/mass-vaccination/latest'))
    parser.add_argument('--no-figure', action='store_true', help='Save numeric results without matplotlib.')
    args = parser.parse_args()
    series_dict, _, metadata = service.load_vaccination_series()
    series = series_dict['total_vaccinated']
    evaluation = service._get_vaccination_evaluation(series)
    holdout = evaluation['fixed_holdout']
    if holdout['status'] != 'complete':
        raise RuntimeError(f"Six-month evaluation unavailable: {holdout.get('reason')}")
    forecast = service.run_vaccination_arima(series, steps=3, evaluation=evaluation)
    population_weights = service.load_barangay_allocation_weights()
    weights, method, coverage = service._completed_vaccination_shares(population_weights)
    allocations = service._integer_allocation(forecast['forecast'][0], weights)
    report = {
        'generated_at': pd.Timestamp.now(tz='Asia/Manila').isoformat(),
        'workbook_file': Path(service.EXCEL_PATH).name,
        'workbook_sha256': hashlib.sha256(Path(service.EXCEL_PATH).read_bytes()).hexdigest(),
        'versions': {'python': platform.python_version(), 'numpy': np.__version__,
                     'pandas': pd.__version__, 'statsmodels': statsmodels.__version__},
        'live_data': metadata,
        'input_series': [{'period': str(period), 'value': None if pd.isna(value) else float(value)}
                         for period, value in series.items()],
        'evaluation': evaluation,
        'current_forecast': forecast,
        'allocation': {'method': method, 'coverage': coverage,
                       'forecast_period': forecast['forecast_periods'][0],
                       'municipal_total': math.floor(forecast['forecast'][0] + .5),
                       'barangays': [{'barangay': name, 'share': weights[name], 'doses': value}
                                     for name, value in sorted(allocations.items(), key=lambda item: (-item[1], item[0]))]},
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / 'results.json').write_text(json.dumps(report, indent=2, ensure_ascii=False,
                                                           allow_nan=False) + '\n', encoding='utf-8')
    with (args.output_dir / 'holdout_predictions.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(holdout['predictions'][0]))
        writer.writeheader()
        writer.writerows(holdout['predictions'])
    if not args.no_figure:
        write_figure(series, holdout, forecast, args.output_dir / 'figure-26-vaccination-evaluation.png')
    print(json.dumps({'output_directory': str(args.output_dir.resolve()),
                      'holdout': holdout['metrics'], 'baseline': holdout['baseline']['metrics'],
                      'rolling_horizons': evaluation['horizons']}, indent=2))


if __name__ == '__main__':
    main()

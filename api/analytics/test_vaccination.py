"""Vaccination regressions. These tests use in-memory fixtures, never the clinic DB."""
import os
import sys
from unittest.mock import Mock

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(__file__))
import arima_service as service


@pytest.fixture(autouse=True)
def isolated_caches(monkeypatch):
    monkeypatch.setattr(service, '_cache', {})
    monkeypatch.setattr(service, '_barangay_vacc_cache', {})
    monkeypatch.setattr(service, '_vaccination_evaluation_cache', None)
    monkeypatch.setattr(service, '_vaccination_live_signature', None)


@pytest.mark.parametrize('value', [None, [], True, 'bad', 0, -1, 1.5, 13])
def test_api_rejects_invalid_forecast_horizons(value):
    client = service.app.test_client()
    for route in ['/vaccination-forecast', '/vaccination-forecast-barangay']:
        response = client.post(route, json={'steps': value})
        assert response.status_code == 400
        assert response.json['success'] is False


def test_api_rejects_non_object_json_and_invalid_barangay_lists():
    client = service.app.test_client()
    assert client.post('/vaccination-forecast', json=[1]).status_code == 400
    assert client.post('/vaccination-forecast-barangay', json={'barangays': 'Tiaong'}).status_code == 400


def test_current_month_gap_uses_correct_backtest_horizons(monkeypatch):
    series = pd.Series([100.] * 24 + [np.nan], index=pd.period_range('2024-01', periods=25, freq='M'))
    monkeypatch.setattr(service, '_fit_vaccination_arima', lambda series, steps: {
        'forecast': [100.] * steps, 'lower_ci': [80.] * steps, 'upper_ci': [120.] * steps,
        'order': [0, 0, 0], 'trend': 'stable', 'model_type': 'ARIMA',
    })
    evaluation = {'interval_gap_eligible': True, 'horizons': {
        str(h): {'n': 12, 'coverage': 80} for h in [1, 2, 3]}}
    assert service.run_vaccination_arima(series, 2, evaluation)['interval_status'] == 'validated_80'
    three = service.run_vaccination_arima(series, 3, evaluation)
    assert three['interval_status'] == 'estimate'
    assert three['lower_ci'] == [None] * 3


def test_cache_refresh_notices_data_changes_without_notification(monkeypatch):
    monkeypatch.setattr(service, '_vaccination_workbook_revision', lambda: 'same-file')
    revision = Mock(return_value='before')
    monkeypatch.setattr(service, '_vaccination_live_revision', revision)
    service.ensure_vaccination_data_fresh()
    service.cache_set('vacc_test', {'forecast': [10]})
    service.cache_set('ds_other', {'forecast': [1]})
    service._barangay_vacc_cache['old'] = [10]
    service.ensure_vaccination_data_fresh()
    assert service.cache_get('vacc_test') is not None
    revision.return_value = 'after'
    service.ensure_vaccination_data_fresh()
    assert service.cache_get('vacc_test') is None
    assert service._barangay_vacc_cache == {}
    assert service.cache_get('ds_other') is not None


def test_integer_allocation_preserves_total_including_zero_and_ties():
    weights = {'A': 1, 'B': 1, 'C': 1}
    for total in [0, 1, 2, 399.6, 2788]:
        allocated = service._integer_allocation(total, weights)
        assert sum(allocated.values()) == int(np.floor(total + 0.5))
        assert all(isinstance(value, int) and value >= 0 for value in allocated.values())


def test_population_weights_ignore_summary_row_and_stale_weight_column(monkeypatch):
    raw = pd.DataFrame([['barangay_id', 'barangay', 'estimated_dog_population_2025', 'allocation_weight']])
    data = pd.DataFrame({'barangay_id': [1, 2, None], 'barangay': ['A', 'B', 'TOTAL'],
                         'estimated_dog_population_2025': [100, 300, 400], 'allocation_weight': [0.9, 0.1, 1]})
    monkeypatch.setattr(pd, 'read_excel', lambda *a, **k: raw if k['header'] is None else data.copy())
    assert service.load_barangay_allocation_weights() == {'A': .25, 'B': .75}


def test_series_keeps_confirmed_zero_missing_month_and_combined_totals(monkeypatch):
    historical = pd.DataFrame({'dogs_vaccinated': [100.], 'cats_vaccinated': [100.],
                               'total_vaccinated': [200.]},
                              index=pd.PeriodIndex(['2025-12'], freq='M'))
    monkeypatch.setattr(service, '_load_workbook_vaccination_monthly', lambda: historical)
    monkeypatch.setattr(service, 'load_db_vaccination_monthly', lambda: pd.DataFrame([
        {'year': 2026, 'month_no': 1, 'total_vaccinated': 0}]))
    series, _, meta = service.load_vaccination_series()
    totals = series['total_vaccinated']
    assert totals.loc['2025-12'] == 200
    assert totals.loc['2026-01'] == 0
    assert pd.isna(totals.iloc[-1])
    assert meta['db_months_used'] == 1


def test_workbook_reader_rejects_invalid_month_and_negative_counts(monkeypatch):
    for month, value in [(None, 20), (13, 20), (2, -1)]:
        monkeypatch.setattr(service, 'read_excel_sheet', lambda _: pd.DataFrame({'year': [2025], 'month_no': [month], 'value': [value]}))
        with pytest.raises(ValueError):
            service._load_forecast_input_metric('test-sheet', 'total')


def test_forecast_response_keeps_calendar_gap_after_last_observation(monkeypatch):
    periods = pd.period_range('2025-01', '2026-10', freq='M')
    totals = pd.Series([100.] * 12 + [np.nan] * 10, index=periods)
    monkeypatch.setattr(service, 'ensure_vaccination_data_fresh', lambda: 'fixture')
    monkeypatch.setattr(service, 'load_vaccination_series', lambda: ({'total_vaccinated': totals}, None, {}))
    monkeypatch.setattr(service, '_get_vaccination_evaluation', lambda _: {})
    monkeypatch.setattr(service, 'run_vaccination_arima', lambda *a, **k: {
        'forecast': [110.] * 3, 'lower_ci': [None] * 3, 'upper_ci': [None] * 3,
        'interval_status': 'estimate', 'trend': 'stable', 'order': [0, 0, 0],
        'model_type': 'ARIMA', 'forecast_periods': ['Nov 2026', 'Dec 2026', 'Jan 2027'],
    })
    response = service.app.test_client().post('/vaccination-forecast', json={'steps': 3})
    assert response.status_code == 200
    data = response.json['data']
    assert data['total_vaccinated']['current_period'] == '2025-12'
    assert data['history'][0]['period'] == '2025-07'
    assert len(data['history']) == 16
    assert all(row['value'] is None for row in data['history'][6:])


def test_rolling_holdout_uses_only_past_values_and_ignores_missing_targets(monkeypatch):
    class LastValueArima:
        def __init__(self, train, **kwargs):
            self.train = train
        def fit(self, **kwargs):
            return self
        def get_forecast(self, steps):
            value = float(self.train.dropna().iloc[-1])
            return type('Prediction', (), {
                'predicted_mean': pd.Series([value] * steps),
                'conf_int': lambda self, alpha: pd.DataFrame([[value - 3, value + 3]] * steps),
            })()
    monkeypatch.setattr(service, 'ARIMA', LastValueArima)
    monkeypatch.setattr(service, '_select_vaccination_arima_order', lambda _: (0, 0, 0))
    values = pd.Series(np.arange(1., 25.), index=pd.period_range('2024-01', periods=24, freq='M'))
    report = service.evaluate_vaccination_arima(values)
    assert report['horizons']['1']['mae'] == 1
    assert report['horizons']['2']['mae'] == 2
    assert report['horizons']['1']['rmse'] == 1
    assert report['horizons']['2']['rmse'] == 2
    assert report['horizons']['1']['mape'] > 0
    assert report['horizons']['1']['mape_zero_actuals_excluded'] == 0
    values.iloc[-1] = np.nan
    missing = service.evaluate_vaccination_arima(values)
    assert missing['observed_months'] == 23
    assert missing['horizons']['1']['n'] == report['horizons']['1']['n'] - 1


def test_vaccination_error_metrics_count_zero_actuals_without_dividing_by_zero():
    assert service._vaccination_error_metrics([100, 200, 0], [110, 180, 10]) == {
        'n': 3, 'mae': 13.33, 'rmse': 14.14, 'mape': 10.,
        'mape_n': 2, 'mape_zero_actuals_excluded': 1, 'wape': 13.33,
    }
    zero = service._vaccination_error_metrics([0, 0], [0, 1])
    assert zero['mae'] == .5
    assert zero['rmse'] == .71
    assert zero['mape'] is None
    assert zero['wape'] is None
    assert zero['mape_zero_actuals_excluded'] == 2
    empty = service._vaccination_error_metrics([], [])
    assert empty['n'] == 0
    assert empty['rmse'] is None


@pytest.mark.parametrize('actual,forecast', [([1], [1, 2]), ([[1]], [[1]]),
                                             ([np.nan], [1]), ([1], [np.inf])])
def test_vaccination_error_metrics_reject_invalid_values(actual, forecast):
    with pytest.raises(ValueError):
        service._vaccination_error_metrics(actual, forecast)


def test_fixed_holdout_never_uses_test_values_to_select_or_fit_model(monkeypatch):
    selection_inputs, fitting_inputs = [], []

    def select(train):
        selection_inputs.append(train.copy())
        return (0, 0, 0)

    class FixedArima:
        def __init__(self, train, **kwargs):
            fitting_inputs.append(train.copy())
            self.train = train

        def fit(self, **kwargs):
            return self

        def get_forecast(self, steps):
            return type('Prediction', (), {
                'predicted_mean': pd.Series([float(self.train.iloc[-1])] * steps),
            })()

    monkeypatch.setattr(service, '_select_vaccination_arima_order', select)
    monkeypatch.setattr(service, 'ARIMA', FixedArima)
    values = pd.Series(np.arange(1., 47.), index=pd.period_range('2023-01', periods=46, freq='M'))
    values.iloc[-1] = np.nan  # October is incomplete, so September is the test end.
    report = service.evaluate_vaccination_holdout(values)
    assert report['status'] == 'complete'
    assert report['training_period_end'] == '2026-03'
    assert report['training_observed_months'] == 39
    assert report['test_period_start'] == '2026-04'
    assert report['test_period_end'] == '2026-09'
    assert [row['forecast'] for row in report['predictions']] == [39.] * 6
    assert [row['baseline'] for row in report['predictions']] == list(np.arange(28., 34.))
    assert report['metrics']['mae'] == 3.5
    assert report['metrics']['rmse'] == 3.89
    values.loc['2026-04':'2026-09'] = 10000.
    changed = service.evaluate_vaccination_holdout(values)
    pd.testing.assert_series_equal(selection_inputs[0], selection_inputs[1])
    pd.testing.assert_series_equal(fitting_inputs[0], fitting_inputs[1])
    assert changed['predictions'][0]['forecast'] == report['predictions'][0]['forecast']
    assert changed['metrics']['mae'] != report['metrics']['mae']


def test_fixed_holdout_does_not_compress_missing_test_months(monkeypatch):
    values = pd.Series(np.arange(1., 46.), index=pd.period_range('2023-01', periods=45, freq='M'))
    values.loc['2026-05'] = np.nan
    select = Mock()
    monkeypatch.setattr(service, '_select_vaccination_arima_order', select)
    report = service.evaluate_vaccination_holdout(values)
    assert report['status'] == 'insufficient_data'
    assert report['test_period_start'] == '2026-04'
    select.assert_not_called()

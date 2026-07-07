// ============================================================
// disease-analytics.js  v3.1 — Speed + Scaling fixes
// ============================================================
// Changes from v3 (everything else identical):
//   JS-FIX-1: predictedCases reads predicted_cases from Python as-is
//             (already period-correct: annual sum for year, next-month for month)
//             + passes lower/upper/period for CI tooltip support
//   JS-FIX-2: Chart title changed from "Projected Annual (×12)" to
//             "Projected Annual (12-Month Sum)" — accurate labeling
//   JS-FIX-3: Bar rows show 80% CI tooltip on hover (predicted chart)
// ============================================================

'use strict';

/* ── Default state ──────────────────────────────────────────── */
let diseaseAnalyticsData = {
    filters: ['All Diseases'],
    selectedDisease: 'All Diseases',
    period: 'year',
    periodLabel: 'Full Year 2025',
    isAllDiseases: true,
    kpis: [
        { label: 'Total Patients This Year', value: '0',   trend: 'Loading…' },
        { label: 'Most Common Disease',      value: 'N/A', trend: '' },
        { label: 'Most Active Barangay',     value: 'N/A', trend: '' },
        { label: 'Auto Alerts',              value: '00',  trend: '' },
    ],
    predictionSummary: { total: 0, label: 'Barangays monitored' },
    sources: [],
    actualCases: [],
    predictedCases: [],
    insights: [],
    map: { center: [14.9577, 120.9055], zoom: 14, metrics: [], hotspots: [], forecast: [] },
};

const state = {
    selectedInsightId: null,
    mapActionMode: false,
    loadRequestId: 0,
    map: null,
    heatLayer: null,
    hotspotMarkers: [],
};

/* ── Utilities ──────────────────────────────────────────────── */
function normalizeBarangayName(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function insightIdForBarangay(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function isAllDiseasesSelected(disease) {
    const d = String(disease || '').trim().toLowerCase();
    return d === '' || d === 'all diseases' || d === 'all';
}

// Converts internal model identifiers (ARIMA, SARIMA, WMA, RF, etc.) into
// plain-language labels so non-technical users aren't shown statistics jargon.
function friendlyModelLabel(modelType) {
    const s = String(modelType || '').toLowerCase();
    if (s.includes('movingaverage') || s.includes('wma')) return 'Basic Estimate';
    if (s.includes('arima') && (s.includes('rf') || s.includes('alldisease'))) return 'Advanced Forecast';
    if (s.includes('sarima') || s.includes('arima')) return 'Smart Forecast';
    return 'Forecast';
}

function animateBars(container) {
    const fills = container.querySelectorAll('.bar-fill[data-w]');
    requestAnimationFrame(function () {
        setTimeout(function () {
            fills.forEach(function (fill, i) {
                setTimeout(function () { fill.style.width = fill.dataset.w; }, i * 28);
            });
        }, 30);
    });
}

function countUp(el, duration) {
    duration = duration || 720;
    var original = el.textContent.trim();
    var match    = original.match(/^(\d+(?:\.\d+)?)(.*)/);
    if (!match) return;
    var num       = parseFloat(match[1]);
    var suffix    = match[2] || '';
    var hasDecimal= match[1].includes('.');
    if (isNaN(num) || num === 0) return;
    var start = performance.now();
    function tick(now) {
        var p      = Math.min((now - start) / duration, 1);
        var eased  = 1 - Math.pow(1 - p, 3);
        var cur    = num * eased;
        el.textContent = (hasDecimal ? cur.toFixed(1) : Math.round(cur)) + suffix;
        if (p < 1) requestAnimationFrame(tick);
        else el.textContent = original;
    }
    requestAnimationFrame(tick);
}

function getRiskLevel(insight) {
    var cls = (insight.rf_risk_class || '').toLowerCase();
    if (cls.includes('high') || cls === 'critical') return 'high';
    if (cls.includes('medium') || cls.includes('med') || cls === 'monitor') return 'medium';
    return 'low';
}

/* ── API calls ──────────────────────────────────────────────── */
async function diseaseAnalyticsRequest(disease, period) {
    const params = new URLSearchParams({
        scope:   'disease_analytics',
        disease: disease || 'All Diseases',
        period:  period  || 'year',
    });
    try {
        const res    = await fetch(`/final-VBETTER/bvetter/api/dashboard/dashboard.php?${params}`, { cache: 'no-store' });
        const result = await res.json();
        return { ok: result.success, data: result.data || {}, error: result.success ? null : result.message };
    } catch (e) {
        return { ok: false, data: {}, error: e.message };
    }
}

async function diseaseRiskRequest(barangays, currentCasesByBarangay, disease, period) {
    try {
        const res = await fetch(
            '/final-VBETTER/bvetter/api/dashboard/dashboard.php?scope=disease_risk_prediction',
            {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                cache:   'no-store',
                body: JSON.stringify({
                    barangays:                 barangays || [],
                    current_cases_by_barangay: currentCasesByBarangay || {},
                    disease:                   disease  || '',
                    period:                    period   || 'year',
                    steps:                     3,
                }),
            }
        );
        const result = await res.json();
        return { ok: result.success, data: result.data || [], error: result.success ? null : result.error };
    } catch (e) {
        return { ok: false, data: [], error: e.message };
    }
}

/* ── Main loader ────────────────────────────────────────────── */
async function loadDiseaseAnalytics(disease, period) {
    const requestId = ++state.loadRequestId;
    disease = disease || 'All Diseases';
    period  = period  || 'year';
    const allDiseases = isAllDiseasesSelected(disease);

    const analyticsRes = window.VetAPI?.getDiseaseAnalytics
        ? await window.VetAPI.getDiseaseAnalytics(disease, period)
        : await diseaseAnalyticsRequest(disease, period);

    if (requestId !== state.loadRequestId) return false;
    if (!analyticsRes.ok || !analyticsRes.data || !Object.keys(analyticsRes.data).length) return false;

    diseaseAnalyticsData                 = analyticsRes.data;
    diseaseAnalyticsData.selectedDisease = disease;
    diseaseAnalyticsData.period          = period;
    diseaseAnalyticsData.isAllDiseases   = allDiseases;

    const seenBarangays = {};
    const barangayNames = [];
    (diseaseAnalyticsData.map?.hotspots || []).forEach(h => {
        const key = normalizeBarangayName(h.barangay);
        if (!seenBarangays[key]) { seenBarangays[key] = true; barangayNames.push(h.barangay); }
    });

    const currentCasesByBarangay = {};
    (diseaseAnalyticsData.actualCases || []).forEach(r => {
        currentCasesByBarangay[r.barangay] = Number(r.value) || 0;
    });

    const rfRes = window.VetAPI?.getDiseaseRiskPrediction
        ? await window.VetAPI.getDiseaseRiskPrediction(barangayNames, currentCasesByBarangay, disease, period)
        : await diseaseRiskRequest(barangayNames, currentCasesByBarangay, disease, period);

    if (requestId !== state.loadRequestId) return false;

    if (rfRes.ok && Array.isArray(rfRes.data) && rfRes.data.length) {
        _mergeRFResults(rfRes.data, disease, period, allDiseases);
    }

    state.selectedInsightId = diseaseAnalyticsData.insights?.[0]?.id || null;
    return true;
}

function _mergeRFResults(rfData, disease, period, allDiseases) {
    const actualByBarangay    = {};
    const predictedByBarangay = {};
    const sourceByBarangay    = {};

    (diseaseAnalyticsData.actualCases || []).forEach(r => {
        actualByBarangay[normalizeBarangayName(r.barangay)] = Number(r.value) || 0;
    });
    (diseaseAnalyticsData.predictedCases || []).forEach(r => {
        predictedByBarangay[normalizeBarangayName(r.barangay)] = Number(r.value) || 0;
        sourceByBarangay[normalizeBarangayName(r.barangay)]    = r.source || 'fallback';
    });

    const maxCases = Math.max(...Object.values(actualByBarangay), 1);

    diseaseAnalyticsData.insights = rfData.map(rf => {
        const key            = normalizeBarangayName(rf.barangay);
        const actualCases    = actualByBarangay[key]    ?? rf.current_cases ?? 0;
        const predictedCases = predictedByBarangay[key] ?? (rf.predicted_cases ?? 0);
        const source         = sourceByBarangay[key]    ?? rf.model_type     ?? 'fallback';

        const loadPct = Math.min(100, Math.round((actualCases           / maxCases) * 100));
        const avgPct  = Math.min(100, Math.round(((rf.avg_cases || 0)   / maxCases) * 100));
        const predPct = Math.min(100, Math.round((predictedCases        / maxCases) * 100));

        const arimaForecast = rf.arima_forecast || [];
        const arimaLowerCi  = rf.arima_lower_ci  || [];
        const arimaUpperCi  = rf.arima_upper_ci  || [];

        const modelType   = rf.model_type || (allDiseases ? 'AllDiseaseARIMA+RF' : 'DiseaseMovingAverageFallback');
        const isRuleBased = rf.rf_model_type === 'RuleBasedThreshold';

        let protocolDesc;
        if (isRuleBased) {
            const thr = rf.risk_thresholds || {};
            protocolDesc = (
                `Our ${friendlyModelLabel(modelType)} predicts ${arimaForecast[0] ?? '?'} cases next month. ` +
                `Risk level: ${rf.risk_class || 'N/A'} ` +
                `(Low: under ${thr.low_max ?? '?'} · Medium: up to ${thr.med_max ?? '?'}). ` +
                `${rf.eval_note || ''}`
            );
        } else {
            protocolDesc = (
                `Our Advanced Forecast predicts ${arimaForecast[0] ?? '?'} cases next month. ` +
                `Risk level: ${rf.risk_class || 'N/A'} (${rf.confidence || 0}% confidence). ` +
                `Typically accurate within ±${rf.model_mae ?? 'N/A'} cases.`
            );
        }

        return {
            id:              insightIdForBarangay(rf.barangay),
            barangay:        rf.barangay,
            disease:         rf.disease || disease,
            cases:           actualCases,
            avg:             rf.avg_cases || 0,
            recommendation:  rf.recommendation,
            rf_risk_class:   rf.risk_class,
            rf_confidence:   rf.confidence,
            rf_risk_proba:   rf.risk_proba || rf.rf_future_proba,
            rf_model_type:   rf.rf_model_type || 'RandomForestClassifier',
            risk_thresholds: rf.risk_thresholds || null,
            model_type:      modelType,
            model_mae:       rf.model_mae,
            model_rmse:      rf.model_rmse,
            model_mape:      rf.model_mape,
            model_accuracy:  rf.model_accuracy,
            n_obs:           rf.n_obs || 0,
            pred_source:     source,
            eval_note:       rf.eval_note || rf.split_method || '',
            comparisons: [
                { label: 'This Barangay',    value: loadPct, color: '#002A58' },
                { label: 'Barangay Average', value: avgPct,  color: '#5B8DB8' },
                { label: 'Peak Barangay',    value: 100,     color: '#CBD5E1' },
            ],
            predicted: [
                { label: 'Predicted Load', value: predPct, color: '#002A58' },
                { label: 'Current Load',   value: loadPct, color: '#94A3B8' },
            ],
            forecast:       arimaForecast,
            lower_ci:       arimaLowerCi,
            upper_ci:       arimaUpperCi,
            arima_order:    rf.arima_order    || [],
            seasonal_order: rf.seasonal_order || null,
            trend:          rf.arima_trend    || 'stable',
            protocol: {
                classification: rf.tier === 'critical' ? 'Grade 4 — High Risk'
                               : rf.tier === 'monitor'  ? 'Grade 3 — Medium Risk'
                               :                          'Grade 2 — Low Risk',
                title:       (isRuleBased ? 'Response Plan: ' : 'Advanced Response Plan: ') + rf.barangay,
                description: protocolDesc,
                steps:       rf.steps || [],
            },
        };
    });

    // JS-FIX-1: Python returns predicted_cases already period-scaled.
    //   year  → sum of 12 monthly ARIMA forecasts  (matches actual annual total)
    //   month → next-month ARIMA value
    // No client-side ×12 needed. Pass CI bounds through for tooltip.
    diseaseAnalyticsData.predictedCases = rfData.map(rf => ({
        barangay: rf.barangay,
        value:    Number(rf.predicted_cases ?? rf.fused_predicted ?? 0),
        source:   rf.model_type || 'fallback',
        lower:    Number(rf.predicted_lower ?? 0),
        upper:    Number(rf.predicted_upper ?? 0),
        period:   rf.predicted_period || 'year',
    }));

    const rfByBarangay = {};
    rfData.forEach(r => { rfByBarangay[normalizeBarangayName(r.barangay)] = r; });

    if (diseaseAnalyticsData.map?.hotspots) {
        diseaseAnalyticsData.map.hotspots = diseaseAnalyticsData.map.hotspots.map(h => {
            const rf = rfByBarangay[normalizeBarangayName(h.barangay)];
            if (rf) {
                h.risk        = rf.tier;
                h.predicted   = rf.predicted_cases ?? rf.fused_predicted ?? h.predicted;
                h.pred_source = rf.model_type || 'fallback';
                h.disease     = rf.disease || disease;
            }
            return h;
        });
    }

    const critical   = rfData.filter(r => r.tier === 'critical').length;
    const monitor    = rfData.filter(r => r.tier === 'monitor').length;
    const firstRf    = rfData[0] || {};
    const isRuleBased= firstRf.rf_model_type === 'RuleBasedThreshold';

    diseaseAnalyticsData.kpis[2] = {
        label: 'High Risk Barangays',
        value: String(critical),
        trend: `${critical} critical · ${monitor} monitoring`,
    };

    if (isRuleBased) {
        diseaseAnalyticsData.kpis[3] = {
            label: 'Forecast Accuracy',
            value: firstRf.model_mae != null ? `Within ±${firstRf.model_mae} cases` : 'N/A',
            trend: [friendlyModelLabel(firstRf.model_type), firstRf.eval_note || ''].filter(Boolean).join(' · ') || 'Automatic risk check',
        };
    } else {
        diseaseAnalyticsData.kpis[3] = {
            label: 'Forecast Accuracy',
            value: firstRf.model_accuracy != null ? `${firstRf.model_accuracy}%` : 'N/A',
            trend: firstRf.model_mae != null ? `Usually within ±${firstRf.model_mae} cases` : '',
        };
    }
}

/* ── Event binding ──────────────────────────────────────────── */
function bindEvents() {
    document.getElementById('openMapBtn').addEventListener('click',       () => switchPanel('mapPanel'));
    document.getElementById('backFromMapBtn').addEventListener('click',   () => switchPanel('overviewPanel'));
    document.getElementById('backToOverviewBtn').addEventListener('click',() => switchPanel('overviewPanel'));
    document.getElementById('toggleActionBtn').addEventListener('click',  toggleMapActionMode);

    const filterEl = document.getElementById('diseaseFilter');
    diseaseAnalyticsData.filters.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item; opt.textContent = item;
        if (item === diseaseAnalyticsData.selectedDisease) opt.selected = true;
        filterEl.appendChild(opt);
    });

    function reloadWithCurrentFilters() {
        const disease = document.getElementById('diseaseFilter').value  || 'All Diseases';
        const period  = document.getElementById('periodFilter')?.value  || 'year';
        ['actualChart', 'predictedChart'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<div class="chart-loading">Updating…</div>';
        });
        loadDiseaseAnalytics(disease, period).then(applied => {
            if (!applied) return;
            state.mapActionMode = false;
            if (state.map) refreshMapLayers();
            renderOverview();
            renderInsightPanel();
            renderMapPanel();
        });
    }

    filterEl.addEventListener('change', reloadWithCurrentFilters);
    document.getElementById('periodFilter')?.addEventListener('change', reloadWithCurrentFilters);
    document.getElementById('refreshSourcesBtn')?.addEventListener('click', () => {
        document.getElementById('refreshSourcesBtn').textContent = 'Refreshed ' + new Date().toLocaleTimeString();
    });
}

/* ── Panel switching ────────────────────────────────────────── */
function switchPanel(panelId) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('panel-active'));
    document.getElementById(panelId).classList.add('panel-active');
    if (panelId === 'mapPanel') {
        if (!state.map) initMap();
        else setTimeout(() => state.map.invalidateSize(), 20);
    }
}

/* ── Overview render ────────────────────────────────────────── */
function renderOverview() {
    document.getElementById('kpiCards').innerHTML = diseaseAnalyticsData.kpis
        .map((kpi, i) => `
            <article class="kpi-card" style="animation-delay:${i * 60}ms">
                <h5>${kpi.label}</h5>
                <strong>${kpi.value}</strong>
                <small>${kpi.trend}</small>
            </article>
        `).join('');
    document.querySelectorAll('#kpiCards .kpi-card strong').forEach(el => countUp(el));

    document.getElementById('sourceList').innerHTML = diseaseAnalyticsData.sources
        .map(s => {
            const isUsed = (s.status || '').toLowerCase().includes('used') &&
                           !(s.status || '').toLowerCase().includes('not used');
            return `<li>
                <div class="source-info"><strong>${s.name}</strong><span>${s.status}</span></div>
                <span class="source-status ${isUsed ? 'active' : 'inactive'}"></span>
            </li>`;
        }).join('');

    const pred = diseaseAnalyticsData.predictionSummary;
    document.getElementById('predictionBanner').innerHTML = `
        <div class="prediction">
            <span>Predicted</span>
            <img src="/final-VBETTER/bvetter/vet/images/shares.svg" alt="">
        </div>
        <strong>${pred.total}</strong>
        <span>${pred.label}</span>
    `;

    const isMonthly   = diseaseAnalyticsData.period === 'month';
    const periodLabel = diseaseAnalyticsData.periodLabel || (isMonthly ? 'Latest Month' : 'Full Year 2025');
    const allDiseases = diseaseAnalyticsData.isAllDiseases;
    const diseaseName = diseaseAnalyticsData.selectedDisease || 'All Diseases';

    const actualCard = document.querySelector('#actualChart')?.closest('.chart-card');
    if (actualCard) {
        actualCard.querySelector('h3').textContent =
            `Actual ${allDiseases ? 'Disease' : diseaseName} Cases — ${periodLabel}`;
    }
    const predCard = document.querySelector('#predictedChart')?.closest('.chart-card');
    if (predCard) {
        if (allDiseases) {
            // JS-FIX-2: "12-Month Sum" is accurate; "×12" was misleading
            predCard.querySelector('h3').textContent = isMonthly
                ? 'Advanced Forecast — Next Month'
                : 'Advanced Forecast — Projected Annual (12-Month Sum)';
        } else {
            const firstInsight = diseaseAnalyticsData.insights?.[0];
            const modelLabel   = friendlyModelLabel(firstInsight?.model_type);
            predCard.querySelector('h3').textContent = isMonthly
                ? `${modelLabel} — Next Month`
                : `${modelLabel} — Projected Annual (12-Month Sum)`;
        }
    }

    renderBarChart('actualChart',    diseaseAnalyticsData.actualCases,    'actual');
    renderBarChart('predictedChart', diseaseAnalyticsData.predictedCases, 'predicted');

    const insightRoot = document.getElementById('insightCards');
    insightRoot.innerHTML = diseaseAnalyticsData.insights
        .map((insight, idx) => `
            <article class="insight-card risk-${getRiskLevel(insight)}" style="animation-delay:${idx * 55}ms">
                <div class="insight-card-top">
                    <span class="chip">${insight.barangay}</span>
                    ${insight.rf_risk_class ? `<span class="risk-indicator">${insight.rf_risk_class}</span>` : ''}
                </div>
                <p>${insight.recommendation || 'No recommendation yet.'}</p>
                <button class="action-link" data-insight-id="${insight.id}">View Action <span class="arrow">→</span></button>
            </article>
        `).join('');

    insightRoot.querySelectorAll('.action-link').forEach(btn => {
        btn.addEventListener('click', () => {
            state.selectedInsightId = btn.dataset.insightId;
            renderInsightPanel();
            switchPanel('insightPanel');
        });
    });
}

/* ── Bar chart ──────────────────────────────────────────────── */
function renderBarChart(targetId, rows, chartType) {
    const root = document.getElementById(targetId);
    if (!root || !rows?.length) { if (root) root.innerHTML = '<p class="no-data">No data available.</p>'; return; }

    const allDiseases  = diseaseAnalyticsData.isAllDiseases;
    const maxValue     = Math.max(...rows.map(r => r.value), 1);
    root.classList.toggle('predicted', chartType === 'predicted');

    const firstInsight = diseaseAnalyticsData.insights?.[0];
    const modelType    = firstInsight?.model_type || '';
    const isWMA        = modelType.includes('MovingAverage');

    const hasFallback = rows.some(r =>
        (r.source || '').toLowerCase().includes('fallback') ||
        (r.source || '').toLowerCase().includes('movingaverage')
    );

    let warning = '';
    if (chartType === 'predicted' && hasFallback) {
        warning = allDiseases
            ? `<div class="fallback-warning">Prediction service unavailable — showing a simple +12% estimate instead of the advanced forecast.</div>`
            : isWMA
                ? `<div class="fallback-warning">Not enough historical data — showing a basic short-term average with an estimated likely range.</div>`
                : `<div class="fallback-warning">Showing a ${friendlyModelLabel(modelType).toLowerCase()} estimate.</div>`;
    }

    root.innerHTML = warning + rows.map((item, index) => {
        const width = Math.max((item.value / maxValue) * 100, 3);
        let badge = '';
        if (chartType === 'predicted') {
            const src = (item.source || '').toLowerCase();
            if (src.includes('sarima') || src.includes('arima')) {
                badge = (src.includes('alldisease') || src.includes('rf'))
                    ? `<span class="source-badge model">Advanced Forecast</span>`
                    : `<span class="source-badge model">Smart Forecast</span>`;
            }
            else if (src.includes('moving') || src.includes('wma')) badge = `<span class="source-badge wma">Basic Estimate</span>`;
            else                                                 badge = `<span class="source-badge fallback">Estimate</span>`;
        }
        // JS-FIX-3: likely-range tooltip on predicted bars
        const ciAttr = (chartType === 'predicted' && item.upper > 0)
            ? ` title="Likely Range: ${item.lower ?? '?'} – ${item.upper ?? '?'}"` : '';
        return `
            <div class="bar-row" style="animation-delay:${index * 22}ms"${ciAttr}>
                <span>${item.barangay}</span>
                <div class="bar-track">
                    <span class="bar-fill" data-w="${width}%" style="width:0;"></span>
                </div>
                <span>${item.value}${badge}</span>
            </div>
        `;
    }).join('');
    animateBars(root);
}

/* ── Insight panel ──────────────────────────────────────────── */
function renderInsightPanel() {
    const insight = diseaseAnalyticsData.insights.find(r => r.id === state.selectedInsightId)
                 || diseaseAnalyticsData.insights[0];

    if (!insight) {
        document.getElementById('insightBarangayName').textContent = 'No barangay selected';
        document.getElementById('selectedCaseCount').textContent   = '0';
        document.getElementById('selectedAverage').textContent     = '0';
        ['comparisonBars', 'predictionBars', 'protocolPanel'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = id === 'protocolPanel' ? '<p>No insight available.</p>' : '';
        });
        return;
    }

    const nameEl = document.getElementById('insightBarangayName');
    nameEl.innerHTML = `<span class="location-eyebrow">Selected Barangay</span>${insight.barangay}`;
    document.getElementById('selectedCaseCount').textContent   = insight.cases;
    document.getElementById('selectedAverage').textContent     = insight.avg;

    renderMiniBars('comparisonBars', insight.comparisons);
    renderMiniBars('predictionBars', insight.predicted);

    // ── 3-Month Forecast ─────────────────────────────────────────
    let forecastHtml = '';
    if (insight.forecast?.length) {
        const months    = ['Next Month', 'Month 2', 'Month 3'];
        const modelLabel = friendlyModelLabel(insight.model_type);
        const metaParts = insight.model_mae != null ? `Usually accurate within ±${insight.model_mae} cases` : '';

        const trend     = (insight.trend || 'stable').toLowerCase();
        const trendIcon = trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : '→';

        forecastHtml = `
            <div class="ip-forecast">
                <div class="ip-forecast-header">
                    <span class="ip-forecast-title">${modelLabel} — 3-Month Forecast</span>
                    ${metaParts ? `<span class="ip-forecast-meta">${metaParts}</span>` : ''}
                </div>
                <div class="ip-forecast-grid">
                    ${insight.forecast.map((val, i) => `
                        <div class="ip-fc-card">
                            <span class="ip-fc-label">${months[i] || 'Month ' + (i + 1)}</span>
                            <span class="ip-fc-val">${val}</span>
                            <span class="ip-fc-range">${insight.lower_ci?.[i] ?? '–'} – ${insight.upper_ci?.[i] ?? '–'}</span>
                            <span class="ip-fc-ci">Likely Range</span>
                        </div>
                    `).join('')}
                </div>
                <div class="ip-trend ip-trend-${trend}">${trendIcon} Trend: ${trend.toUpperCase()}</div>
            </div>
        `;
    }

    // ── Model badge ───────────────────────────────────────────────
    const isRuleBased = insight.rf_model_type === 'RuleBasedThreshold';
    let modelBadgeHtml = '';
    if (isRuleBased && insight.risk_thresholds) {
        const t = insight.risk_thresholds;
        modelBadgeHtml = `
            <div class="ip-model-row">
                <span class="ip-model-badge">Basic Rule Check</span>
                <span class="ip-model-text">Low: under ${t.low_max} · Medium: ${t.low_max}–${t.med_max} · High: ${t.med_max} or more</span>
            </div>
        `;
    } else if (!isRuleBased) {
        modelBadgeHtml = `
            <div class="ip-model-row">
                <span class="ip-model-badge">Advanced Forecast</span>
                <span class="ip-model-text">${insight.rf_risk_class || 'N/A'} Risk · ${insight.rf_confidence ?? 'N/A'}% confidence</span>
            </div>
        `;
    }

    // ── Risk tier chip ────────────────────────────────────────────
    const protocol  = insight.protocol;
    const classText = (protocol.classification || '').toLowerCase();
    const tierClass = classText.includes('high') ? 'high' : classText.includes('medium') ? 'medium' : 'low';

    document.getElementById('protocolPanel').innerHTML = `
        <div class="ip-risk-header">
            <span class="ip-risk-chip ip-risk-${tierClass}">${protocol.classification}</span>
        </div>
        ${modelBadgeHtml}
        ${forecastHtml}
        <div class="ip-protocol-block">
            <p class="ip-protocol-title">${protocol.title}</p>
            <p class="ip-protocol-desc">${protocol.description}</p>
        </div>
        <div class="ip-steps">
            ${(protocol.steps || []).map((step, i) => `
                <div class="ip-step">
                    <span class="ip-step-num">${String(i + 1).padStart(2, '0')}</span>
                    <div>
                        <strong>${step.title}</strong>
                        <p>${step.detail}</p>
                    </div>
                </div>
            `).join('')}
        </div>
        <div class="ip-actions">
            <button class="ip-btn-primary" id="createEventBtn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:-2px;flex-shrink:0"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="8" y2="14"/><line x1="12" y1="14" x2="12" y2="14"/><line x1="8" y1="18" x2="8" y2="18"/></svg>Create Event
            </button>
            <button class="ip-btn-secondary" id="backOverviewBtn2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px;flex-shrink:0"><polyline points="15 18 9 12 15 6"/></svg>Back to Overview
            </button>
        </div>
    `;

    document.getElementById('createEventBtn').addEventListener('click', () => {
        alert(`Event created: ${insight.barangay} — ${insight.disease}`);
    });
    document.getElementById('backOverviewBtn2').addEventListener('click', () => switchPanel('overviewPanel'));
}

function renderMiniBars(targetId, rows) {
    const el = document.getElementById(targetId);
    if (!el || !rows?.length) return;
    el.innerHTML = rows.map(item => `
        <div class="bar-row">
            <span>${item.label}</span>
            <div class="bar-track">
                <span class="bar-fill" style="width:${item.value}%; background:${item.color};"></span>
            </div>
        </div>
    `).join('');
}

/* ── Map panel ──────────────────────────────────────────────── */
function renderMapPanel() {
    document.getElementById('mapMetricCards').innerHTML =
        (diseaseAnalyticsData.map?.metrics || []).map(item => `
            <article class="kpi-card">
                <h5>${item.label}</h5>
                <strong>${item.value}</strong>
                <small>${item.trend}</small>
            </article>
        `).join('');
    renderHotspotList();
}

function renderHotspotList() {
    const list = document.getElementById('hotspotList');
    list.innerHTML = (diseaseAnalyticsData.map?.hotspots || []).map(hotspot => {
        const src = (hotspot.pred_source || '').toLowerCase();
        let badge = '';
        if (src.includes('sarima') || src.includes('arima')) {
            badge = (src.includes('rf') || src.includes('alldisease'))
                ? `<span class="source-badge model">Advanced Forecast</span>`
                : `<span class="source-badge model">Smart Forecast</span>`;
        }
        else if (src.includes('moving') || src.includes('wma')) badge = `<span class="source-badge wma">Basic Estimate</span>`;
        else                                               badge = `<span class="source-badge fallback">Estimate</span>`;
        return `
            <article class="hotspot-item" data-hotspot-id="${hotspot.id}">
                <h4>
                    ${hotspot.barangay}
                    <span class="risk-chip risk-${hotspot.risk}">${hotspot.risk.toUpperCase()}</span>
                </h4>
                <p>${hotspot.disease}</p>
                <small>Cases: ${hotspot.cases} | Predicted: ${hotspot.predicted} ${badge}</small>
            </article>
        `;
    }).join('');

    list.querySelectorAll('.hotspot-item').forEach(item => {
        item.addEventListener('click', () => {
            const hotspot = diseaseAnalyticsData.map.hotspots.find(r => r.id === item.dataset.hotspotId);
            if (state.map && hotspot) {
                state.map.flyTo([hotspot.lat, hotspot.lng], 15, { duration: 0.65 });
                showHotspotAction(hotspot);
            }
        });
    });
}

function refreshMapLayers() {
    if (!state.map || !diseaseAnalyticsData.map) return;
    state.hotspotMarkers.forEach(m => m.remove());
    state.hotspotMarkers = [];
    if (state.heatLayer) state.heatLayer.remove();

    const hotspots   = diseaseAnalyticsData.map.hotspots || [];
    const heatPoints = hotspots.map(s => [s.lat, s.lng, s.intensity]);

    state.heatLayer = L.heatLayer(heatPoints, {
        radius: 45, blur: 30, minOpacity: 0.5,
        gradient: { 0.3: '#6ec7ff', 0.55: '#fff27a', 0.75: '#ff9248', 1.0: '#e53030' },
    }).addTo(state.map);

    hotspots.forEach(spot => {
        const color  = getRiskColor(spot.risk);
        const marker = L.circleMarker([spot.lat, spot.lng], {
            radius: 6, color, fillColor: color, fillOpacity: 0.9, weight: 1,
        }).addTo(state.map).bindTooltip(`${spot.barangay} | ${spot.disease}`);
        marker.on('click', () => { showHotspotAction(spot); toggleMapActionMode(true); });
        state.hotspotMarkers.push(marker);
    });

    fitMapToHotspots();
}

function fitMapToHotspots() {
    if (!state.map || !diseaseAnalyticsData.map?.hotspots?.length) return;
    const bounds = L.latLngBounds(diseaseAnalyticsData.map.hotspots.map(s => [s.lat, s.lng]));
    state.map.fitBounds(bounds, { padding: [36, 36], maxZoom: diseaseAnalyticsData.map.zoom || 14 });
}

function initMap() {
    const { center, zoom } = diseaseAnalyticsData.map;
    state.map = L.map('baliwagMap', { zoomControl: false }).setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
    }).addTo(state.map);
    refreshMapLayers();
}

function getRiskColor(risk) {
    return risk === 'critical' ? '#c31d1d' : risk === 'monitor' ? '#a4851f' : '#1e8a47';
}

function toggleMapActionMode(forceOn) {
    state.mapActionMode = typeof forceOn === 'boolean' ? forceOn : !state.mapActionMode;
    document.getElementById('toggleActionBtn').textContent =
        state.mapActionMode ? 'Close Action Tab' : 'Action Tab';
    if (!state.mapActionMode) { renderHotspotList(); return; }
    const defaultHotspot = diseaseAnalyticsData.map.hotspots?.[0];
    if (defaultHotspot) showHotspotAction(defaultHotspot);
}

function showHotspotAction(hotspot) {
    if (!hotspot) return;
    const side    = document.getElementById('hotspotList');
    const insight = (diseaseAnalyticsData.insights || []).find(
        r => normalizeBarangayName(r.barangay) === normalizeBarangayName(hotspot.barangay)
    );

    let steps = [], protocolTitle = 'Barangay Response Protocol: ' + hotspot.barangay;
    let protocolDesc = '', classification = 'Risk: ' + hotspot.risk.toUpperCase(), modelBadge = '';

    if (insight?.protocol) {
        steps          = insight.protocol.steps    || [];
        protocolTitle  = insight.protocol.title    || protocolTitle;
        protocolDesc   = insight.protocol.description || '';
        classification = insight.protocol.classification || classification;
        const isRuleBased = insight.rf_model_type === 'RuleBasedThreshold';
        if (isRuleBased) {
            const t = insight.risk_thresholds || {};
            modelBadge = `
                <div class="rule-based-note">
                    ⚠ Rule-Based Risk (${insight.model_type || 'DiseaseSpecific'}) —
                    ${insight.rf_risk_class || 'N/A'} risk
                    ${insight.pred_source?.includes('fallback')
                        ? '<span class="source-badge fallback">Estimate</span>'
                        : `<span class="source-badge model">${friendlyModelLabel(insight.model_type)}</span>`}
                    <br><small>Low: under ${t.low_max ?? '?'} · Medium: up to ${t.med_max ?? '?'}</small>
                </div>`;
        } else {
            modelBadge = `
                <div class="rf-badge">
                    Advanced Forecast — ${insight.rf_risk_class || 'N/A'} Risk ·
                    ${insight.rf_confidence ?? 'N/A'}% confidence
                </div>`;
        }
    } else {
        steps = [
            { level: 'red',   title: 'Immediate: Field Validation',
              detail: `Confirm active cases in ${hotspot.barangay}. Cases: ${hotspot.cases}.` },
            { level: 'blue',  title: 'Within 24 hrs: Coordination',
              detail: `Contact district vet team. Predicted: ${hotspot.predicted} cases.` },
            { level: 'green', title: 'Preventive: Education Drive',
              detail: `Distribute prevention materials to ${hotspot.barangay}.` },
            { level: 'gray',  title: 'Monitoring: Weekly Review',
              detail: 'Track cases weekly until risk normalizes.' },
        ];
        modelBadge = `
            <div class="rf-badge" style="background:#fff7ed;border-color:#fed7aa;color:#c2410c;">
                ⚠ Analytics service offline — using fallback estimate for ${hotspot.barangay}
            </div>`;
    }

    side.innerHTML = `
        <section class="action-pane">
            <div class="protocol-alert">
                <div class="protocol-title">Protocol: ${hotspot.barangay}</div>
                <small>${classification}</small>
            </div>
            ${modelBadge}
            <div class="protocol-id">
                <strong>${protocolTitle}</strong>
                <p>${protocolDesc}</p>
            </div>
            ${steps.map((step, i) => `
                <div class="action-step">
                    <span class="step-dot ${step.level}">${String(i + 1).padStart(2, '0')}</span>
                    <div><strong>${step.title}</strong><p>${step.detail}</p></div>
                </div>
            `).join('')}
            <div class="protocol-actions">
                <button class="btn btn-primary"   id="createMapEventBtn">Create Event</button>
                <button class="btn btn-secondary" id="backToMapOverviewBtn">Back to Overview</button>
            </div>
        </section>
    `;
    document.getElementById('createMapEventBtn').addEventListener('click', () => {
        alert(`Event created: ${hotspot.barangay} — ${hotspot.disease}`);
    });
    document.getElementById('backToMapOverviewBtn').addEventListener('click', () => {
        state.mapActionMode = false;
        document.getElementById('toggleActionBtn').textContent = 'Action Tab';
        renderHotspotList();
    });
}

/* ── VetAPI extension ───────────────────────────────────────── */
if (window.VetAPI) {
    const _orig = window.VetAPI.getDiseaseRiskPrediction;
    window.VetAPI.getDiseaseRiskPrediction = async function (barangays, currentCases, disease, period) {
        if (typeof disease === 'undefined') {
            return _orig ? _orig(barangays, currentCases) : diseaseRiskRequest(barangays, currentCases, '', 'year');
        }
        return diseaseRiskRequest(barangays, currentCases, disease, period);
    };
}

/* ── Skeleton loading (shown until the first fetch resolves) ─── */
function renderSkeletons() {
    const kpiCards = document.getElementById('kpiCards');
    if (kpiCards) {
        kpiCards.innerHTML = Array.from({ length: 4 }, () => `
            <div class="skeleton-kpi-card">
                <div class="skeleton-block"></div>
                <div class="skeleton-block"></div>
                <div class="skeleton-block"></div>
            </div>
        `).join('');
    }

    const banner = document.getElementById('predictionBanner');
    if (banner) banner.innerHTML = '<div class="skeleton-block skeleton-banner"></div>';

    const sourceList = document.getElementById('sourceList');
    if (sourceList) {
        sourceList.innerHTML = Array.from({ length: 3 }, () => `
            <li><div class="skeleton-block skeleton-source-row" style="width:100%"></div></li>
        `).join('');
    }

    ['actualChart', 'predictedChart'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = Array.from({ length: 5 }, () => `
            <div class="skeleton-bar-row">
                <div class="skeleton-block"></div>
                <div class="skeleton-block"></div>
                <div class="skeleton-block"></div>
            </div>
        `).join('');
    });

    const insightCards = document.getElementById('insightCards');
    if (insightCards) {
        insightCards.innerHTML = Array.from({ length: 3 }, () => `
            <div class="skeleton-insight-card">
                <div class="skeleton-block"></div>
                <div class="skeleton-block"></div>
                <div class="skeleton-block"></div>
                <div class="skeleton-block"></div>
            </div>
        `).join('');
    }
}

/* ── Init ───────────────────────────────────────────────────── */
async function initDiseaseAnalytics() {
    renderSkeletons();
    await loadDiseaseAnalytics();
    bindEvents();
    renderOverview();
    renderInsightPanel();
    renderMapPanel();
}

document.addEventListener('DOMContentLoaded', initDiseaseAnalytics);
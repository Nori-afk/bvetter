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
// Analytics labels are server-computed but include barangay and disease
// names that originate in editable data, so they are escaped like any
// other user-sourced value before reaching innerHTML.
const esc = (v) => window.vbEscapeHtml(v);

let diseaseAnalyticsData = {
    filters: ['All Diseases'],
    selectedDisease: 'All Diseases',
    period: 'year',
    periodLabel: 'Full Year',
    isAllDiseases: true,
    baselineLabel: '',
    kpis: [
        { label: 'Total Cases',         value: '0',   trend: 'Loading…' },
        { label: 'Most Common Disease', value: 'N/A', trend: '' },
        { label: 'Most Active Barangay',value: 'N/A', trend: '' },
        { label: 'Auto Alerts',         value: '00',  trend: '' },
    ],
    // Stays null until the API answers, so the strip is hidden rather than
    // flashing a zero the clinic has not actually recorded.
    liveLayer: null,
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
    // Checked first, regardless of whether the name also contains "arima":
    // any *Fallback model_type means the real model's forecast was rejected
    // (thin data, or the runaway-forecast sanity guard) and a simpler,
    // more conservative estimate was used instead -- e.g. "ARIMAFallback"
    // would otherwise match the "arima" check below and get labeled "Smart
    // Forecast", which is exactly backwards from what it should signal.
    if (s.includes('fallback') || s.includes('movingaverage') || s.includes('wma')) return 'Basic Estimate';
    // 'alldisease' alone (not just 'arima' && 'alldisease') so the RF-based
    // monthly forecast for the all-disease pipeline ("AllDiseaseRFMonthlyRegressor...")
    // still reads as the same "combined pipeline" tier as its ARIMA counterpart.
    if (s.includes('alldisease')) return 'Advanced Forecast';
    if (s.includes('arima') && s.includes('rf')) return 'Advanced Forecast';
    // Disease-specific RF monthly forecast ("DiseaseRFMonthlyRegressor") sits at
    // the same tier as plain SARIMA/ARIMA -- a real per-series model, not a fallback.
    if (s.includes('sarima') || s.includes('arima') || s.includes('rfmonthly')) return 'Smart Forecast';
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
async function diseaseAnalyticsRequest(disease, period, dataView, currentMonth) {
    const params = new URLSearchParams({
        scope:         'disease_analytics',
        disease:       disease  || 'All Diseases',
        period:        period   || 'year',
        data_view:     dataView || 'historical',
        current_month: currentMonth || '',
    });
    try {
        const res    = await fetch(`/api/dashboard/dashboard.php?${params}`, { cache: 'no-store' });
        const result = await res.json();
        return { ok: result.success, data: result.data || {}, error: result.success ? null : result.message };
    } catch (e) {
        return { ok: false, data: {}, error: e.message };
    }
}

/* diseaseRiskRequest() used to live here as a local copy of VetAPI's
   getDiseaseRiskPrediction, because the shared one dropped `disease` and
   `period`. The shared one forwards them now, so the copy and the monkey-patch
   that installed it over window.VetAPI are both gone. */

// "Create Event" doesn't have its own storage -- it routes into whichever
// existing module actually owns that kind of event, so it shows up where
// vets already look for it instead of a third, disconnected list:
//   - Vaccination Drive -> Mass Vaccination's events (api/mass-vaccination/events.php)
//   - Community Announcement -> the Announcements feature (api/announcements/announcements.php)
// forecastCases replaces the risk label that used to go into the public
// advisory. "Risk level: Grade 2 — Low Risk" reads to a pet owner as an
// official severity grade, but it is a band on case VOLUME and the "Grade N"
// scale is invented (there are three tiers and they start at 2). A case count
// is unambiguous, needs no legend, and is the model's actual output.
const createEventContext = { barangay: '', disease: '', forecastCases: null };

function openCreateEventModal(barangay, disease, forecastCases) {
    createEventContext.barangay      = barangay || '';
    createEventContext.disease       = disease || '';
    createEventContext.forecastCases = Number.isFinite(Number(forecastCases)) ? Math.round(Number(forecastCases)) : null;

    const ctxEl = document.getElementById('createEventContext');
    if (ctxEl) ctxEl.textContent = `${createEventContext.barangay} — ${createEventContext.disease}`;

    document.getElementsByName('eventType').forEach(r => { r.checked = r.value === 'vaccination'; });
    toggleVaccineField();
    const dateInput = document.getElementById('eventAnnouncementDate');
    if (dateInput) {
        // An event can't be scheduled in the past, and a year out is well
        // beyond any real planning window — this only catches typos.
        const today = new Date();
        const horizon = new Date();
        horizon.setFullYear(horizon.getFullYear() + 1);
        dateInput.value = today.toISOString().slice(0, 10);
        dateInput.min = today.toISOString().slice(0, 10);
        dateInput.max = horizon.toISOString().slice(0, 10);
    }
    document.getElementById('createEventModal')?.classList.remove('hidden');
}

function closeCreateEventModal() {
    document.getElementById('createEventModal')?.classList.add('hidden');
}

function toggleVaccineField() {
    const selected      = document.querySelector('input[name="eventType"]:checked')?.value;
    const vaccineField  = document.getElementById('vaccineField');
    const dateField     = document.getElementById('announcementDateField');
    if (vaccineField) vaccineField.style.display = selected === 'vaccination'  ? '' : 'none';
    if (dateField)    dateField.style.display    = selected === 'announcement' ? '' : 'none';
}

async function submitCreateEvent() {
    const btn   = document.getElementById('confirmCreateEventBtn');
    const type  = document.querySelector('input[name="eventType"]:checked')?.value || 'vaccination';
    const { barangay, disease, forecastCases } = createEventContext;
    const today = new Date().toISOString().slice(0, 10);

    if (btn) { btn.disabled = true; btn.dataset.originalText = btn.textContent; btn.textContent = 'Creating…'; }
    try {
        let result, successMsg;
        if (type === 'vaccination') {
            const vaccine = document.getElementById('eventVaccine')?.value || 'Others';
            const res = await fetch('/api/mass-vaccination/events.php', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
                body: JSON.stringify({ action: 'create', date: today, barangay, vaccine }),
            });
            result = await res.json();
            successMsg = `Vaccination drive scheduled in Mass Vaccination: ${barangay} — ${vaccine}`;
        } else {
            const title = `Disease Response: ${disease} in ${barangay}`;
            const description = `Community advisory for ${disease} cases in ${barangay}.` +
                (forecastCases !== null
                    ? ` Forecast: about ${forecastCases} case${forecastCases === 1 ? '' : 's'} next month.`
                    : '') +
                ' Please observe preventive measures and report symptoms in pets to your barangay vet team.';
            const eventDate = document.getElementById('eventAnnouncementDate')?.value || today;
            const res = await fetch('/api/announcements/announcements.php', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
                body: JSON.stringify({
                    action: 'create', title, description,
                    category: 'Community Advisory', event_date: eventDate, location: barangay, status: 'published',
                }),
            });
            result = await res.json();
            successMsg = `Announcement published: ${title}`;
        }

        if (result.success) {
            await vbAlert(successMsg);
            closeCreateEventModal();
        } else {
            await vbAlert(`Could not create event: ${result.message || 'Unknown error.'}`);
        }
    } catch (e) {
        await vbAlert(`Could not create event: ${e.message}`);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.originalText; }
    }
}

/* ── Main loader ────────────────────────────────────────────── */
async function loadDiseaseAnalytics(disease, period, dataView, currentMonth) {
    const requestId = ++state.loadRequestId;
    disease  = disease  || 'All Diseases';
    period   = period   || 'year';
    dataView = dataView || 'historical';
    const isCurrent   = dataView === 'current';
    const allDiseases = isAllDiseasesSelected(disease);

    const analyticsRes = window.VetAPI?.getDiseaseAnalytics
        ? await window.VetAPI.getDiseaseAnalytics(disease, period, dataView, currentMonth)
        : await diseaseAnalyticsRequest(disease, period, dataView, currentMonth);

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

    // The Predicted/Forecast chart always trains on the full historical
    // series and does not change as you browse Current mode's month picker
    // -- a live month with a handful of records isn't enough to refit a
    // model on, so the request that drives it stays fixed to "next month"
    // and skips the current-cases override rather than reflecting whichever
    // month happens to be selected.
    let rfPeriod = period;
    let currentCasesByBarangay = {};
    if (isCurrent) {
        rfPeriod = 'month';
    } else {
        (diseaseAnalyticsData.actualCases || []).forEach(r => {
            currentCasesByBarangay[r.barangay] = Number(r.value) || 0;
        });
    }

    // Fetched in parallel with the barangay predictions: it is a different
    // model answering a different question, and waiting for it in series would
    // add its latency to a page that already takes seconds on a cold cache.
    const [rfRes, diseaseFc] = await Promise.all([
        window.VetAPI?.getDiseaseRiskPrediction
            ? window.VetAPI.getDiseaseRiskPrediction(barangayNames, currentCasesByBarangay, disease, rfPeriod)
            : diseaseRiskRequest(barangayNames, currentCasesByBarangay, disease, rfPeriod),
        diseaseForecastRequest(disease)
    ]);
    diseaseAnalyticsData.diseaseForecast = diseaseFc;

    if (requestId !== state.loadRequestId) return false;

    if (rfRes.ok && Array.isArray(rfRes.data) && rfRes.data.length) {
        _mergeRFResults(rfRes.data, disease, rfPeriod, allDiseases);
    }

    state.selectedInsightId = diseaseAnalyticsData.insights?.[0]?.id || null;
    return true;
}

/* ── Top-down forecast panel ─────────────────────────────────────
   Renders what the backend actually produced, labelled by how it was
   produced. Three rules this markup exists to keep:

   1. The action level is a RULE over observed cases, never a forecast, so it
      carries no confidence figure. The old panel printed "High case volume ·
      99.6% confidence" beside "predicts 20.8 cases" -- the same fact twice,
      with an invented certainty attached.
   2. Interval coverage is stated as MEASURED (about 80%), not as a flat 80%
      target: monthly lands at 80.2% and the quarter at 77.8% on 27 barangays.
   3. A barangay on the fallback path is marked. It is produced by the ~91%
      MAPE per-barangay method rather than top-down, and must never look
      identical to a top-down figure. */
function intervalLabel(insight) {
    const c = insight.interval_coverage;
    if (!c) return 'estimated range';
    return `about ${c.target_pct}% of months fall in this range`;
}

function topDownPanelHtml(insight) {
    if (!insight) return '';
    // The insight object renames these: rf.arima_forecast is stored as
    // .forecast, and .predicted is an array of chart bars rather than a number.
    // Reading the raw API names here produced "Next month NaN cases".
    const fc = insight.forecast || [];
    const lo = insight.lower_ci || [];
    const hi = insight.upper_ci || [];
    const hasQuarter = insight.quarter_total != null;

    const fallbackNote = insight.is_fallback
        ? `<div class="td-fallback">Limited data &mdash; estimated differently.
             ${insight.fallback_reason ? vbEscapeHtml(insight.fallback_reason) : ''}
             <small>This barangay is not part of the municipality-wide forecast, so its
             figures are less reliable than the others shown.</small>
           </div>`
        : '';

    const sharePct = insight.barangay_share != null
        ? `${(Number(insight.barangay_share) * 100).toFixed(1)}%`
        : '—';

    return `
        <div class="td-panel${insight.is_fallback ? ' is-fallback' : ''}">
            ${fallbackNote}
            <div class="td-grid">
                <div class="td-cell">
                    <span class="td-label">Next month</span>
                    <span class="td-value">${fc[0] ?? '—'}<small> cases</small></span>
                    ${lo[0] != null ? `<span class="td-range">${lo[0]}–${hi[0]} &middot; ${intervalLabel(insight)}</span>` : ''}
                    <span class="td-caveat">Single months vary widely at this size</span>
                </div>
                <div class="td-cell td-primary">
                    <span class="td-label">Next 3 months <em>&mdash; use this for planning</em></span>
                    <span class="td-value">${hasQuarter ? insight.quarter_total : '—'}<small> cases</small></span>
                    ${hasQuarter ? `<span class="td-range">${insight.quarter_lower}–${insight.quarter_upper} &middot; ${intervalLabel(insight)}</span>` : ''}
                    <span class="td-caveat">Typically within about a third of the actual total</span>
                </div>
                <div class="td-cell">
                    <span class="td-label">Share of municipality</span>
                    <span class="td-value">${sharePct}</span>
                    <span class="td-caveat">${insight.is_fallback
                        ? 'Not allocated from the municipal total'
                        : 'Municipal forecast is split by this share'}</span>
                </div>
            </div>
        </div>`;
}

/* The action level, stated as the rule it is. */
function actionTierHtml(insight) {
    if (!insight?.action_tier_label) return '';
    const tone = insight.action_tier === 'ESCALATE' ? 'act'
               : insight.action_tier === 'MONITOR' ? 'watch' : 'normal';
    return `
        <div class="td-action td-action-${tone}">
            <span class="td-action-label">${vbEscapeHtml(insight.action_tier_label)}</span>
            <span class="td-action-reason">${vbEscapeHtml(insight.action_reason || '')}</span>
            <span class="td-action-basis">Based on cases already recorded &mdash; not a forecast</span>
        </div>`;
}

/* ── Per-disease forecast (pooled Random Forest) ─────────────────
   Separate model from the barangay forecast and a separate question: this one
   is per DISEASE, municipality-wide. It is also the model that genuinely beats
   ARIMA -- pooling all 42 disease series into one regressor scores MAE 0.230
   against per-disease ARIMA's 0.441, because 36 monthly points per disease is
   too few to fit each series on its own.

   Only meaningful for a specific disease, so it is skipped for "All Diseases".
   Never blocks the page: a failure leaves the strip hidden. */
async function diseaseForecastRequest(disease) {
    if (!disease || disease.toLowerCase() === 'all diseases') return null;
    try {
        const res = await fetch('/api/dashboard/dashboard.php?scope=disease_forecast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({ diagnosis: disease, steps: 3 })
        });
        const json = await res.json();
        return json.success ? (json.data || null) : null;
    } catch (error) {
        console.warn('Per-disease forecast unavailable:', error);
        return null;
    }
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function diseaseForecastHtml(fc) {
    if (!fc || !fc.available || !(fc.forecast || []).length) return '';
    const months = fc.forecast.map(f => `
        <div class="df-month">
            <span class="df-month-label">${MONTH_LABELS[(f.month_no || 1) - 1]} ${f.year}</span>
            <span class="df-month-value">${f.predicted_cases}</span>
        </div>`).join('');
    // Reports the holdout error next to the number rather than a bare
    // prediction, and names the baseline it beat.
    const acc = (fc.holdout_mae != null && fc.baseline_mae != null)
        ? `usually within ${fc.holdout_mae} cases &middot; the simpler "same as usual" estimate misses by ${fc.baseline_mae}`
        : '';
    return `
        <div class="df-strip">
            <div class="df-strip-head">
                <span class="df-strip-title">${vbEscapeHtml(fc.diagnosis || '')} &mdash; expected cases, municipality-wide</span>
                <span class="df-strip-acc">${acc}</span>
            </div>
            <div class="df-months">${months}</div>
        </div>`;
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
                `Case volume level: ${rf.risk_class || 'N/A'} ` +
                `(Low: under ${thr.low_max ?? '?'} · Medium: up to ${thr.med_max ?? '?'}). ` +
                `${rf.eval_note || ''}`
            );
        } else {
            protocolDesc = (
                `Our Advanced Forecast predicts ${arimaForecast[0] ?? '?'} cases next month. ` +
                `Case volume level: ${rf.risk_class || 'N/A'} (${rf.confidence || 0}% confidence). ` +
                (rf.municipality_accuracy?.mape != null
                    ? `The municipality-wide forecast this is split from is usually within `
                      + `${rf.municipality_accuracy.mape}% of the actual total; a single barangay varies more.`
                    : '')
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
            // Top-down output. action_* is a RULE over observed cases, not a
            // forecast; quarter_* is the barangay figure that can actually be
            // trusted (~36% MAPE against ~91% for a single month); is_fallback
            // marks a barangay still on the old per-barangay ARIMA path.
            action_tier:       rf.action_tier,
            action_tier_label: rf.action_tier_label,
            action_reason:     rf.action_reason,
            action_is_rule:    rf.action_is_rule,
            quarter_total:     rf.quarter_total,
            quarter_lower:     rf.quarter_lower,
            quarter_upper:     rf.quarter_upper,
            barangay_share:    rf.barangay_share,
            forecast_method:   rf.forecast_method,
            is_fallback:       rf.is_fallback,
            fallback_reason:   rf.fallback_reason,
            interval_coverage: rf.interval_coverage,
            municipality_accuracy: rf.municipality_accuracy,
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
                // The action the tier calls for, not an invented severity grade.
                // "Grade 4/3/2" implied a calibrated four-level public-health
                // scale; there are only three tiers and they never reach 1.
                classification: rf.tier === 'critical' ? 'Immediate Response'
                               : rf.tier === 'monitor'  ? 'Monitor'
                               :                          'Routine',
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

    diseaseAnalyticsData.kpis[2] = {
        label: 'High Case Volume Barangays',
        value: String(critical),
        trend: `${critical} critical · ${monitor} monitoring`,
    };

    // Average error margin across every barangay shown, not just whichever
    // one happens to sort first -- accuracy varies a lot barangay to
    // barangay (e.g. one barangay ±3.9 cases vs another ±2.8 for the same
    // disease), so showing a single borrowed barangay's number as "Forecast
    // Accuracy" for the whole page was misleading.
    // model_mae is the MUNICIPALITY-wide holdout error, and every barangay in
    // the response carries the same value -- it is one figure for one model,
    // not 27 separate measurements. Averaging it and captioning the result
    // "checked across 27 barangays" implied a per-barangay accuracy of ±2.6
    // cases when the real per-barangay error is ±3.4. Labelled for what it
    // measures instead.
    const munMape = firstRf.municipality_accuracy?.mape ?? null;
    const munMae  = firstRf.model_mae ?? null;

    diseaseAnalyticsData.kpis[3] = {
        label: 'Forecast Accuracy',
        value: munMape != null ? `Within ${munMape}%` : (munMae != null ? `Within ${munMae} cases` : 'N/A'),
        trend: munMape != null
            ? 'of the municipality-wide total · single barangays vary much more'
            : 'Automatic case volume check',
    };
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

    // Current mode's month picker: January of this calendar year through the
    // current month, defaulting to the current month ("assuming August" when
    // today is August). Populated once; the months that exist don't change
    // within a page load.
    function populateMonthPicker() {
        const sel = document.getElementById('currentMonthFilter');
        if (!sel || sel.options.length) return;
        const now      = new Date();
        const year     = now.getFullYear();
        const thisIdx  = now.getMonth();
        for (let m = 0; m <= thisIdx; m++) {
            const opt = document.createElement('option');
            opt.value = `${year}-${String(m + 1).padStart(2, '0')}`;
            opt.textContent = new Date(year, m, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
            sel.appendChild(opt);
        }
        sel.value = `${year}-${String(thisIdx + 1).padStart(2, '0')}`;
    }
    populateMonthPicker();

    function applyDataViewVisibility() {
        const isCurrent = (document.getElementById('dataViewFilter')?.value || 'historical') === 'current';
        const periodEl  = document.getElementById('periodFilter');
        const monthEl   = document.getElementById('currentMonthFilter');
        if (periodEl) periodEl.hidden = isCurrent;
        if (monthEl)  monthEl.hidden  = !isCurrent;
    }
    applyDataViewVisibility();

    function reloadWithCurrentFilters() {
        const disease      = document.getElementById('diseaseFilter').value      || 'All Diseases';
        const period       = document.getElementById('periodFilter')?.value      || 'year';
        const dataView     = document.getElementById('dataViewFilter')?.value    || 'historical';
        const currentMonth = document.getElementById('currentMonthFilter')?.value || '';
        ['actualChart', 'predictedChart'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<div class="chart-loading">Updating…</div>';
        });
        loadDiseaseAnalytics(disease, period, dataView, currentMonth).then(applied => {
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
    document.getElementById('currentMonthFilter')?.addEventListener('change', reloadWithCurrentFilters);
    document.getElementById('dataViewFilter')?.addEventListener('change', () => {
        applyDataViewVisibility();
        reloadWithCurrentFilters();
    });
    document.getElementById('refreshSourcesBtn')?.addEventListener('click', () => {
        document.getElementById('refreshSourcesBtn').textContent = 'Refreshed ' + new Date().toLocaleTimeString();
    });

    document.getElementById('manageDatasetBtn')?.addEventListener('click', () => window.DatasetModal?.open());
    // Uploading a workbook or switching back to an older version replaces the
    // data every chart on this page is reading, so the modal re-runs the same
    // reload the filter dropdowns use. Without it, a successful upload leaves
    // superseded figures on screen behind the modal.
    window.DatasetModal?.init({ onChange: reloadWithCurrentFilters });

    document.getElementsByName('eventType').forEach(r => r.addEventListener('change', toggleVaccineField));
    document.getElementById('cancelCreateEventBtn')?.addEventListener('click', closeCreateEventModal);
    document.getElementById('confirmCreateEventBtn')?.addEventListener('click', submitCreateEvent);
    document.getElementById('createEventModal')?.addEventListener('click', (ev) => {
        if (ev.target.id === 'createEventModal') closeCreateEventModal();
    });
    document.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        const modal = document.getElementById('createEventModal');
        if (modal && !modal.classList.contains('hidden')) closeCreateEventModal();
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

/* ── Live layer ──────────────────────────────────────────────────
   The clinic's own 2026+ records, reported separately from the frozen
   2023-2025 baseline the cards above and the charts below are built on.
   Hidden entirely if the API predates this field. */
function renderLiveLayer() {
    const root = document.getElementById('liveLayer');
    if (!root) return;

    const live = diseaseAnalyticsData.liveLayer;
    if (!live) { root.hidden = true; return; }

    // Built as text nodes, not interpolated HTML. `summary` carries the
    // selected disease name, which is whatever the client sent -- the server
    // only trims and lowercases it (bv_clean/disease_name_filter), so markup
    // reaches this point intact and innerHTML here would run it.
    const span = (cls, text) => {
        const el = document.createElement('span');
        el.className = cls;
        el.textContent = text;
        return el;
    };

    root.replaceChildren(
        span('live-label',   live.label   || ''),
        span('live-summary', live.summary || ''),
        span('live-meta',    [live.latest, live.note].filter(Boolean).join(' · '))
    );
    root.hidden = false;
}

/* ── Overview render ────────────────────────────────────────── */
function renderOverview() {
    const baselineLabel = document.getElementById('baselineLabel');
    if (baselineLabel) baselineLabel.textContent = diseaseAnalyticsData.baselineLabel || '';

    renderLiveLayer();

    document.getElementById('kpiCards').innerHTML = diseaseAnalyticsData.kpis
        .map((kpi, i) => `
            <article class="kpi-card" style="animation-delay:${i * 60}ms">
                <h5>${esc(kpi.label)}</h5>
                <strong>${esc(kpi.value)}</strong>
                <small>${esc(kpi.trend)}</small>
            </article>
        `).join('');
    document.querySelectorAll('#kpiCards .kpi-card strong').forEach(el => countUp(el));

    // Per-disease forecast sits directly under the KPI row: it is the same
    // scope those cards describe (this disease, municipality-wide), just
    // forward-looking. Hidden entirely for "All Diseases", where the pooled
    // model has nothing single to forecast.
    const kpiHost = document.getElementById('kpiCards');
    let dfHost = document.getElementById('diseaseForecastStrip');
    if (!dfHost && kpiHost?.parentNode) {
        dfHost = document.createElement('div');
        dfHost.id = 'diseaseForecastStrip';
        kpiHost.parentNode.insertBefore(dfHost, kpiHost.nextSibling);
    }
    if (dfHost) dfHost.innerHTML = diseaseForecastHtml(diseaseAnalyticsData.diseaseForecast);

    document.getElementById('sourceList').innerHTML = diseaseAnalyticsData.sources
        .map(s => {
            const isUsed = (s.status || '').toLowerCase().includes('used') &&
                           !(s.status || '').toLowerCase().includes('not used');
            return `<li>
                <div class="source-info"><strong>${esc(s.name)}</strong><span>${esc(s.status)}</span></div>
                <span class="source-status ${isUsed ? 'active' : 'inactive'}"></span>
            </li>`;
        }).join('');

    const pred = diseaseAnalyticsData.predictionSummary;
    document.getElementById('predictionBanner').innerHTML = `
        <div class="prediction">
            <span>Predicted</span>
            <img src="../../vet/images/shares.svg" alt="">
        </div>
        <strong>${pred.total}</strong>
        <span>${pred.label}</span>
    `;

    const isCurrentView = diseaseAnalyticsData.dataView === 'current';
    const isMonthly   = isCurrentView || diseaseAnalyticsData.period === 'month';
    const periodLabel = diseaseAnalyticsData.periodLabel || (isMonthly ? 'Latest Month' : 'Full Year');
    const allDiseases = diseaseAnalyticsData.isAllDiseases;
    const diseaseName = diseaseAnalyticsData.selectedDisease || 'All Diseases';

    // Honest small-N state: Current mode can be a handful of live visits, and
    // a normal-looking chart off 1 case reads as a full, comparable picture
    // when it isn't one. Named rather than hidden.
    const coverageNote = document.getElementById('liveCoverageNote');
    if (coverageNote) {
        const cov = diseaseAnalyticsData.liveCoverage;
        const SPARSE_THRESHOLD = 5;
        if (isCurrentView && cov && cov.with_diagnosis < SPARSE_THRESHOLD) {
            coverageNote.hidden = false;
            coverageNote.textContent = cov.total_visits === 0
                ? `No clinic visits recorded yet for ${periodLabel}.`
                : `${cov.total_visits} clinic visit${cov.total_visits === 1 ? '' : 's'} recorded in ${periodLabel} · `
                  + `${cov.with_diagnosis} with a listed diagnosis. Case counts are just starting to build up — `
                  + `treat this chart as early, not a full picture yet.`;
        } else {
            coverageNote.hidden = true;
        }
    }

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
function renderBarChart(targetId, sourceRows, chartType) {
    const root = document.getElementById(targetId);
    if (!root || !sourceRows?.length) { if (root) root.innerHTML = '<p class="no-data">No data available.</p>'; return; }

    // HIGHEST FIRST. There was no ordering anywhere before this -- not in
    // dashboard.php, which appends barangays in whatever order the aggregation
    // produced, and not here. That order is not stable either: the Excel path,
    // the live-DB path and each disease filter group their rows differently, so
    // the same barangay moved around the chart as the filters changed and the
    // top of the chart meant nothing.
    //
    // Sorted on a COPY: diseaseAnalyticsData.actualCases and .predictedCases are
    // read elsewhere to look barangays up, and reordering the shared arrays
    // underneath those readers would be a nasty way to save an allocation.
    //
    // Each chart sorts by its OWN values, so "Predicted" genuinely ranks by
    // predicted cases. The trade-off is that a barangay sits at different
    // heights in the two charts, so they read as two rankings rather than as a
    // row-by-row comparison.
    const rows = [...sourceRows].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));

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
            // 'rfmonthly' alongside sarima/arima so the RF-based monthly forecast
            // (both all-disease and per-disease) still gets a model badge instead
            // of falling through to the generic "Estimate" badge below.
            if (src.includes('sarima') || src.includes('arima') || src.includes('rfmonthly')) {
                badge = src.includes('alldisease')
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
        // Municipality-wide figure, named as such -- see the KPI note above.
        const metaParts = insight.municipality_accuracy?.mape != null
            ? `Municipality forecast usually within ${insight.municipality_accuracy.mape}%`
            : '';

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
    // insight.model_type is only ever set once a real prediction (from
    // Python or the PHP fallback) has merged in — see _mergeRFResults().
    // If it's missing, the panel is still showing the PHP placeholder,
    // which means the analytics service never answered.
    const isOffline   = !insight.model_type;
    const isRuleBased = insight.rf_model_type === 'RuleBasedThreshold';
    let offlineWarningHtml = '';
    let modelBadgeHtml = '';
    if (isOffline) {
        offlineWarningHtml = `<div class="fallback-warning">⚠ Analytics service offline — showing basic info only for ${insight.barangay} until the forecast service reconnects.</div>`;
    } else if (isRuleBased && insight.risk_thresholds) {
        const t = insight.risk_thresholds;
        modelBadgeHtml = `
            <div class="ip-model-row">
                <span class="ip-model-badge">Basic Rule Check</span>
                <span class="ip-model-text">Low: under ${t.low_max} · Medium: ${t.low_max}–${t.med_max} · High: ${t.med_max} or more</span>
            </div>
        `;
    } else {
        // No confidence figure: the action level is a rule over observed
        // cases, and the forecast's uncertainty is shown as a range instead.
        modelBadgeHtml = `
            <div class="ip-model-row">
                <span class="ip-model-badge">${insight.is_fallback ? 'Limited Data' : 'Municipality Forecast'}</span>
                <span class="ip-model-text">${insight.is_fallback
                    ? 'Estimated from this barangay alone'
                    : `Split from the municipality-wide forecast${insight.municipality_accuracy?.mape != null
                        ? ` (usually within ${insight.municipality_accuracy.mape}% municipality-wide)` : ''}`}</span>
            </div>
        ` + actionTierHtml(insight) + topDownPanelHtml(insight);
    }

    // ── Risk tier chip ────────────────────────────────────────────
    const protocol  = insight.protocol;
    const classText = (protocol.classification || '').toLowerCase();
    const tierClass = classText.includes('high') ? 'high' : classText.includes('medium') ? 'medium' : 'low';

    document.getElementById('protocolPanel').innerHTML = `
        <div class="ip-risk-header">
            <span class="ip-risk-chip ip-risk-${tierClass}">${protocol.classification}</span>
        </div>
        ${offlineWarningHtml}
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
        openCreateEventModal(insight.barangay, insight.disease, Array.isArray(insight.forecast) ? insight.forecast[0] : null);
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

/* Needs Action first, then Watch, then Normal -- and within each, the busiest
   barangay first.
   The list used to render in whatever order the API returned, so a vet opening
   the page scanned 27 rows to find the two that mattered. Ordering is the
   cheapest thing this page can do to turn a data dump into a worklist. */
const TIER_ORDER = { critical: 0, monitor: 1, stable: 2 };

function sortedHotspots() {
    return [...(diseaseAnalyticsData.map?.hotspots || [])].sort((a, b) => {
        const ta = TIER_ORDER[a.risk] ?? 3, tb = TIER_ORDER[b.risk] ?? 3;
        if (ta !== tb) return ta - tb;
        return (Number(b.cases) || 0) - (Number(a.cases) || 0);
    });
}

function renderHotspotList() {
    const list = document.getElementById('hotspotList');
    list.innerHTML = sortedHotspots().map(hotspot => {
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
                    <span class="risk-chip risk-${hotspot.risk}">${tierWord(hotspot.risk)}</span>
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

/* ── Heat surface + barangay markers ─────────────────────────────
   A continuous colour field interpolated from the 27 barangay values, with a
   marker on each barangay on top.

   The surface is inverse-distance weighting (IDW), drawn to a canvas and laid
   over the map as an image overlay. That is what produces a filled field
   rather than the isolated glowing blobs a kernel-density heat layer gives on
   sparse points -- every pixel gets a value from all 27 barangays, weighted by
   1/distance^2, so the colour is continuous everywhere instead of fading to
   nothing between markers.

   HONEST LABEL, and the legend says so: the colour BETWEEN barangays is
   interpolated, not measured. Only the 27 marker positions carry real counts.
   Interpolation is standard for surface estimation, but it should never be
   read as "this street had this many cases". */

const SYMBOL_MIN_RADIUS = 6;
const SYMBOL_MAX_RADIUS = 20;

/* Sampling grid for the surface. 160x160 over the municipality is far finer
   than 27 source points can justify, so the limit on detail is the data, not
   the raster -- this size just keeps the gradient smooth when scaled up. */
const HEAT_GRID = 160;

/* How far the surface reaches beyond a barangay before fading out, in degrees
   of lat/lng. ~0.010 deg is roughly 1.1 km, about the spacing between
   neighbouring barangays here, so the field stays continuous across the built-up
   area and fades over open ground rather than at a rectangle edge. */
const FADE_INNER = 0.009;
const FADE_OUTER = 0.026;

/* Cool-to-hot ramp matching the reference: deep green through yellow and
   orange to red, with a white peak. Stops are on 0..1 of the value range. */
const HEAT_STOPS = [
    [0.00, [ 16,  78,  92]],   // deep teal — quietest
    [0.18, [ 34, 128,  62]],
    [0.38, [ 96, 176,  50]],   // green
    [0.55, [201, 219,  62]],   // yellow-green
    [0.68, [255, 221,  64]],   // yellow
    [0.80, [255, 150,  40]],   // orange
    [0.91, [226,  46,  40]],   // red
    [1.00, [255, 245, 245]],   // white peak
];

function heatColor(t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < HEAT_STOPS.length; i++) {
        const [p1, c1] = HEAT_STOPS[i - 1];
        const [p2, c2] = HEAT_STOPS[i];
        if (t <= p2) {
            const k = (t - p1) / (p2 - p1 || 1);
            return [
                Math.round(c1[0] + (c2[0] - c1[0]) * k),
                Math.round(c1[1] + (c2[1] - c1[1]) * k),
                Math.round(c1[2] + (c2[2] - c1[2]) * k),
            ];
        }
    }
    return HEAT_STOPS[HEAT_STOPS.length - 1][1];
}

function symbolRadius(value, maxValue) {
    const v = Math.max(0, Number(value) || 0);
    if (v <= 0 || maxValue <= 0) return SYMBOL_MIN_RADIUS;
    // Area proportional to the value, not radius: doubling a radius quadruples
    // the visible circle, so scaling radius directly overstates big barangays.
    return SYMBOL_MIN_RADIUS + (SYMBOL_MAX_RADIUS - SYMBOL_MIN_RADIUS)
         * Math.sqrt(Math.min(1, v / maxValue));
}

/* Builds the interpolated surface as a data URL sized to `bounds`. */
function buildHeatCanvas(points, bounds) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = HEAT_GRID;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(HEAT_GRID, HEAT_GRID);

    const south = bounds.getSouth(), north = bounds.getNorth();
    const west  = bounds.getWest(),  east  = bounds.getEast();
    const values = points.map(p => p.value);
    const lo = Math.min(...values), hi = Math.max(...values);
    const span = (hi - lo) || 1;

    for (let y = 0; y < HEAT_GRID; y++) {
        // Row 0 is the top of the image, which is the NORTH edge.
        const lat = north - (y / (HEAT_GRID - 1)) * (north - south);
        for (let x = 0; x < HEAT_GRID; x++) {
            const lng = west + (x / (HEAT_GRID - 1)) * (east - west);

            let num = 0, den = 0, exact = null, nearest = Infinity;
            for (const pt of points) {
                const dLat = lat - pt.lat, dLng = lng - pt.lng;
                const d2 = dLat * dLat + dLng * dLng;
                if (d2 < nearest) nearest = d2;
                if (d2 < 1e-10) { exact = pt.value; break; }
                const w = 1 / d2;                              // 1/d^2
                num += w * pt.value;
                den += w;
            }
            const v = exact !== null ? exact : (den ? num / den : lo);

            // ALPHA FALLS OFF WITH DISTANCE FROM THE NEAREST BARANGAY.
            //
            // A flat alpha painted the whole bounding box, so the overlay ended
            // in two hard vertical lines down the map -- the rectangle edge,
            // not anything in the data. Fading by distance removes that edge
            // and is the more honest rendering besides: colour stops where
            // there is no nearby barangay to support it, instead of implying a
            // measured value out in empty farmland.
            const d = Math.sqrt(exact !== null ? 0 : nearest);
            const fade = 1 - Math.min(1, Math.max(0, (d - FADE_INNER) / (FADE_OUTER - FADE_INNER)));

            const [r, g, b] = heatColor((v - lo) / span);
            const i = (y * HEAT_GRID + x) * 4;
            img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
            img.data[i + 3] = Math.round(255 * fade * fade);   // squared = softer tail
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
}

function refreshMapLayers() {
    if (!state.map || !diseaseAnalyticsData.map) return;
    state.hotspotMarkers.forEach(m => m.remove());
    state.hotspotMarkers = [];
    if (state.heatLayer) { state.heatLayer.remove(); state.heatLayer = null; }

    const hotspots = (diseaseAnalyticsData.map.hotspots || [])
        .filter(h => Number.isFinite(h.lat) && Number.isFinite(h.lng));
    if (!hotspots.length) { renderMapLegend(null); return; }

    const values = hotspots.map(h => Number(h.cases) || 0);
    const maxValue = Math.max(...values, 1);
    const minValue = Math.min(...values);

    // Padded so the surface reaches past the outermost barangays instead of
    // stopping at them with a visible straight edge.
    const lats = hotspots.map(h => h.lat), lngs = hotspots.map(h => h.lng);
    const padLat = ((Math.max(...lats) - Math.min(...lats)) * 0.18 || 0.01) + FADE_OUTER;
    const padLng = ((Math.max(...lngs) - Math.min(...lngs)) * 0.18 || 0.01) + FADE_OUTER;
    const bounds = L.latLngBounds(
        [Math.min(...lats) - padLat, Math.min(...lngs) - padLng],
        [Math.max(...lats) + padLat, Math.max(...lngs) + padLng]);

    const url = buildHeatCanvas(
        hotspots.map(h => ({ lat: h.lat, lng: h.lng, value: Number(h.cases) || 0 })), bounds);
    state.heatLayer = L.imageOverlay(url, bounds, {
        opacity: 0.82, interactive: false, className: 'da-heat-surface',
    }).addTo(state.map);

    // Least urgent first, so a Needs Action marker is never buried under a
    // Normal one where barangays overlap in the town centre.
    [...hotspots]
        .sort((a, b) => (TIER_ORDER[b.risk] ?? 3) - (TIER_ORDER[a.risk] ?? 3))
        .forEach(spot => {
        const actual    = Number(spot.cases) || 0;
        const predicted = Number(spot.predicted) || 0;
        const needsAction = spot.risk === 'critical';

        // Solid tier colour, as the original design had it: red for Needs
        // Action, amber for Watch, green for Normal.
        //
        // This does put two colour systems on one map -- the surface uses red
        // for "many cases", a marker uses red for "needs action". A neutral
        // scheme was tried and rejected on the look. The white outline and drop
        // shadow below are what keep the markers legible against the field, so
        // the two never visually merge even though they share hues.
        const marker = L.circleMarker([spot.lat, spot.lng], {
            radius: symbolRadius(actual, maxValue),
            color: '#ffffff',
            fillColor: getRiskColor(spot.risk),
            fillOpacity: 0.95,
            weight: needsAction ? 2.5 : 1.8,
            className: needsAction ? 'da-marker da-marker-urgent' : 'da-marker',
        }).addTo(state.map);

        const direction = predicted > actual ? 'expected to rise'
                        : predicted < actual ? 'expected to ease' : 'expected to hold';
        marker.bindTooltip(
            `<strong>${vbEscapeHtml(spot.barangay)}</strong><br>` +
            `<span style="opacity:.8">${tierWord(spot.risk)}</span><br>` +
            `${actual} recorded &middot; ${predicted.toFixed(0)} forecast<br>` +
            `<span style="opacity:.75">${direction}</span>`,
            { direction: 'top', offset: [0, -4] });
        marker.on('click', () => { showHotspotAction(spot); toggleMapActionMode(true); });
        state.hotspotMarkers.push(marker);
    });

    renderMapLegend({ min: minValue, max: maxValue });
    fitMapToHotspots();
}

/* Vertical colour bar, like the reference. Reads bottom-to-top so the hottest
   value sits at the top, which is the convention people expect from a scale. */
function renderMapLegend(range) {
    const host = document.getElementById('mapLegend');
    if (!host) return;
    if (!range) { host.innerHTML = ''; return; }

    const ramp = HEAT_STOPS
        .map(([p, c]) => `rgb(${c[0]},${c[1]},${c[2]}) ${(p * 100).toFixed(0)}%`)
        .join(', ');
    const mid = Math.round((range.min + range.max) / 2);

    host.innerHTML = `
        <div class="heat-scale">
            <div class="heat-scale-bar" style="background:linear-gradient(to top, ${ramp})"></div>
            <div class="heat-scale-ticks">
                <span>${Math.round(range.max)}</span>
                <span>${mid}</span>
                <span>${Math.round(range.min)}</span>
            </div>
        </div>
        <div class="heat-scale-caption">
            <strong>Cases</strong>
            <span>Circle = barangay, sized by cases</span>
            <span>Colour = Needs Action / Watch / Normal</span>
            <span class="heat-scale-note">Shading between barangays is estimated</span>
        </div>`;
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

/* One vocabulary across the whole page. The tiers arrive from the API as
   critical/monitor/stable -- internal wire values that were being printed
   straight to the vet as "CRITICAL" and "STABLE", which is neither the wording
   the rest of the panel uses nor something a reader can act on. */
function tierWord(risk) {
    return risk === 'critical' ? 'Needs Action'
         : risk === 'monitor'  ? 'Watch'
                               : 'Normal';
}

function getRiskColor(risk) {
    return risk === 'critical' ? '#c31d1d' : risk === 'monitor' ? '#a4851f' : '#1e8a47';
}

function toggleMapActionMode(forceOn) {
    state.mapActionMode = typeof forceOn === 'boolean' ? forceOn : !state.mapActionMode;
    document.getElementById('toggleActionBtn').textContent =
        state.mapActionMode ? 'Close Action Tab' : 'Action Tab';
    if (!state.mapActionMode) { renderHotspotList(); return; }
    // The most urgent barangay, not whichever the API happened to return
    // first -- opening the action tab should land on what needs attention.
    const defaultHotspot = sortedHotspots()[0];
    if (defaultHotspot) showHotspotAction(defaultHotspot);
}

function showHotspotAction(hotspot) {
    if (!hotspot) return;
    const side    = document.getElementById('hotspotList');
    const insight = (diseaseAnalyticsData.insights || []).find(
        r => normalizeBarangayName(r.barangay) === normalizeBarangayName(hotspot.barangay)
    );

    let steps = [], protocolTitle = 'Barangay Response Protocol: ' + hotspot.barangay;
    let protocolDesc = '', classification = tierWord(hotspot.risk), modelBadge = '';

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
                    ⚠ Rule-Based Case Volume —
                    ${insight.rf_risk_class || 'N/A'} case volume
                    ${insight.pred_source?.includes('fallback')
                        ? '<span class="source-badge fallback">Estimate</span>'
                        : `<span class="source-badge model">${friendlyModelLabel(insight.model_type)}</span>`}
                    <br><small>Low: under ${t.low_max ?? '?'} · Medium: up to ${t.med_max ?? '?'}</small>
                </div>`;
        } else {
            modelBadge = `
                <div class="rf-badge${insight.is_fallback ? ' is-fallback' : ''}">
                    ${insight.is_fallback
                        ? 'Limited data — estimated from this barangay alone'
                        : 'Municipality Forecast — split by this barangay’s share'}
                </div>` + actionTierHtml(insight) + topDownPanelHtml(insight);
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
              detail: 'Track cases weekly until case volume normalizes.' },
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
        openCreateEventModal(hotspot.barangay, hotspot.disease, insight?.forecast?.[0] ?? hotspot.predicted ?? null);
    });
    document.getElementById('backToMapOverviewBtn').addEventListener('click', () => {
        state.mapActionMode = false;
        document.getElementById('toggleActionBtn').textContent = 'Action Tab';
        renderHotspotList();
    });
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
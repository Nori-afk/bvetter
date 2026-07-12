document.addEventListener('DOMContentLoaded', async () => {
    if (window.Chart && Chart.defaults) {
        Chart.defaults.animation = false;
        if (Chart.defaults.transitions?.active?.animation) {
            Chart.defaults.transitions.active.animation.duration = 0;
        }
        // Premium chart styling
        Chart.defaults.font.family = "'Inter', 'Manrope', 'Segoe UI', sans-serif";
        Chart.defaults.font.size = 12;
        Chart.defaults.color = '#64748B';
        if (Chart.defaults.scale) {
            Chart.defaults.scale.grid = { ...Chart.defaults.scale.grid, color: '#F1F5F9', drawBorder: false };
            Chart.defaults.scale.ticks = { ...Chart.defaults.scale.ticks, color: '#94A3B8', padding: 8 };
        }
        if (Chart.defaults.plugins?.tooltip) {
            Chart.defaults.plugins.tooltip.backgroundColor = '#0F172A';
            Chart.defaults.plugins.tooltip.titleColor = '#F8FAFC';
            Chart.defaults.plugins.tooltip.bodyColor = '#94A3B8';
            Chart.defaults.plugins.tooltip.padding = 12;
            Chart.defaults.plugins.tooltip.cornerRadius = 8;
            Chart.defaults.plugins.tooltip.boxPadding = 4;
        }
        if (Chart.defaults.plugins?.legend?.labels) {
            Chart.defaults.plugins.legend.labels.usePointStyle = true;
            Chart.defaults.plugins.legend.labels.pointStyleWidth = 10;
            Chart.defaults.plugins.legend.labels.padding = 18;
            Chart.defaults.plugins.legend.labels.font = { size: 11, weight: '600' };
            Chart.defaults.plugins.legend.labels.color = '#475569';
        }
    }

    function appBasePath() {
        const script = document.currentScript || Array.from(document.scripts)
            .find((item) => item.src && item.src.includes('/vet/js/mass-vaccination.js'));
        const path = script?.src ? new URL(script.src).pathname : window.location.pathname;
        const jsMarker = '/vet/js/mass-vaccination.js';
        if (path.includes(jsMarker)) return path.slice(0, path.indexOf(jsMarker));
        const pageMarker = '/vet/html/';
        if (path.includes(pageMarker)) return path.slice(0, path.indexOf(pageMarker));
        return '/bvetter';
    }

    const MASS_VACC_API = `${appBasePath()}/api/mass-vaccination/events.php`;
    const DASHBOARD_API = `${appBasePath()}/api/dashboard/dashboard.php`;
    const charts = {};

    // ── State ─────────────────────────────────────────────────────────────
    const state = {
        events:             [],   // from DB (mass_vaccination_events table)  ← LIVE SOURCE
        arimaData:          null, // from Python ARIMA service
        dashboardData:      null, // from PHP vet_dashboard (Excel summary)
        vaccinationDataset: null, // from PHP mass_vaccination_dataset (Excel monthly)
    };

    // ── Data source legend ────────────────────────────────────────────────
    // Chart 1 (Vaccinated per Barangay) → Excel Barangay_Disease_Monthly  MERGED with DB events
    // Chart 2 (Predicted Animals)       → ARIMA Python service  annotated with DB actuals
    // Chart 3 (Vaccine Types)           → DB events  (primary) MERGED with Excel vaccineDemand
    // Chart 4 (Vaccines Needed)         → ARIMA + Excel, total adjusted by DB actuals
    // Table   (Recent Events)           → Database mass_vaccination_events
    // KPIs    (Metrics)                 → DB events + Excel fallback

    // ── Helpers ───────────────────────────────────────────────────────────
    const sanitize = (value) => String(value).replace(/[&<>"']/g,
        (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c] || c)
    );
    const formatNumber = (value) => {
        if (value === '' || value === null || value === undefined) return '-';
        return Number(value).toLocaleString();
    };
    const setPanel = (panelName) => {
        const showDash = panelName === 'dashboard';
        document.getElementById('mass-vacc-dashboard').classList.toggle('active-panel', showDash);
        document.getElementById('mass-vacc-detail').classList.toggle('active-panel', !showDash);
    };
    const statusClass = (s) => s.toLowerCase().includes('completed') ? 'completed' : 'pending';
    const destroyChart = (key) => { if (charts[key]) { charts[key].destroy(); charts[key] = null; } };

    // ── Skeleton loading (shown until the first fetch resolves) ───────────
    const skeletonBar = (w, h, extra) => `<span class="skeleton-block" style="width:${w};height:${h};${extra || ''}"></span>`;

    function renderSkeletons() {
        document.querySelectorAll('.metric-card').forEach((card) => {
            const valueEl = card.querySelector('.metric-value');
            const noteEl  = card.querySelector('.metric-note');
            if (valueEl) valueEl.innerHTML = skeletonBar('64px', '28px', 'border-radius:8px;');
            if (noteEl)  noteEl.innerHTML  = skeletonBar('75%', '10px');
        });

        ['vaccinatedPerBarangayChart', 'predictedAnimalsChart', 'vaccineTypesChart', 'vaccinesNeededChart'].forEach((id) => {
            const canvas = document.getElementById(id);
            if (!canvas || canvas.dataset.skeletonApplied) return;
            canvas.dataset.skeletonApplied = 'true';
            canvas.style.display = 'none';
            const rows = [1, 2, 3, 4, 5].map(() => `
                <div class="chart-skeleton-row">
                    ${skeletonBar('70px', '9px')}
                    ${skeletonBar('', '14px', 'flex:1;')}
                </div>
            `).join('');
            const skeleton = document.createElement('div');
            skeleton.className = 'chart-skeleton';
            skeleton.innerHTML = rows;
            canvas.insertAdjacentElement('beforebegin', skeleton);
        });

        const placeholder = document.getElementById('arima-card-placeholder');
        if (!placeholder) return;
        const fcCard = () => `
            <div class="mv-fc-card">
                ${skeletonBar('60%', '9px', 'margin-bottom:10px;')}
                ${skeletonBar('40%', '22px', 'margin-bottom:8px;border-radius:8px;')}
                ${skeletonBar('70%', '9px')}
            </div>`;
        const bkCard = () => `
            <div class="mv-breakdown-card">
                ${skeletonBar('50%', '9px', 'margin-bottom:9px;')}
                ${skeletonBar('35%', '18px', 'margin-bottom:8px;border-radius:6px;')}
                ${skeletonBar('45%', '9px')}
            </div>`;

        placeholder.innerHTML = `
            <section class="card mv-arima-card">
                <div class="mv-arima-header">
                    <div style="flex:1">
                        ${skeletonBar('90px', '18px', 'border-radius:6px;margin-bottom:10px;')}
                        ${skeletonBar('220px', '16px', 'margin-bottom:8px;')}
                        ${skeletonBar('65%', '11px')}
                    </div>
                    ${skeletonBar('130px', '26px', 'border-radius:999px;')}
                </div>
                <div class="mv-forecast-section">
                    <p class="mv-section-label">${skeletonBar('150px', '10px')}</p>
                    <div class="mv-fc-grid">${[1, 2, 3].map(fcCard).join('')}</div>
                </div>
                <div class="mv-breakdown-section">
                    <p class="mv-section-label">${skeletonBar('220px', '10px')}</p>
                    <div class="mv-breakdown-grid">${[1, 2, 3].map(bkCard).join('')}</div>
                </div>
            </section>
        `;
    }

    // ── Filter helpers ────────────────────────────────────────────────────
    function getFilteredEvents(range) {
        var events  = state.events || [];
        var now     = new Date();
        var nowYear = now.getFullYear();
        var nowMonth= now.getMonth(); // 0-based
        return events.filter(function(e) {
            if (!e.date) return true;
            var d = new Date(e.date + 'T00:00:00');
            if (isNaN(d.getTime())) return true;
            if (range === 'This Month')    return d.getFullYear() === nowYear && d.getMonth() === nowMonth;
            if (range === 'Last 3 Months') {
                var cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 3);
                return d >= cutoff;
            }
            if (range === 'This Year') return d.getFullYear() === nowYear;
            return true;
        });
    }

    function getFilteredDatasetRows(range) {
        var rows    = (state.vaccinationDataset?.by_month) || [];
        var now     = new Date();
        var nowYear = now.getFullYear();
        var nowMonth= now.getMonth() + 1; // 1-based
        if (!rows.length) return [];
        if (range === 'This Month')    return rows.filter(r => r.year === nowYear && r.month_no === nowMonth);
        if (range === 'Last 3 Months') {
            var cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 3);
            return rows.filter(r => {
                var d = new Date(r.year + '-' + String(r.month_no).padStart(2,'0') + '-01');
                return d >= cutoff;
            });
        }
        if (range === 'This Year') return rows.filter(r => r.year === nowYear);
        return rows;
    }

    // ── Build a live DB totals map per barangay from filtered events ─────
    // Returns { [barangay]: { dogs, cats, others, total } }
    // IMPORTANT: dogs/cats/others are ONLY set when the vet explicitly entered
    // a species breakdown. If no breakdown was entered, they stay 0 and only
    // total is set. We never fabricate species splits from a grand total.
    function getDbBarangayTotals(range) {
        var totals = {};
        getFilteredEvents(range).forEach(function(e) {
            if (!e.barangay) return;

            var dogs   = Number(e.breakdown?.dogs)   || 0;
            var cats   = Number(e.breakdown?.cats)   || 0;
            var others = Number(e.breakdown?.others) || 0;
            var hasBreakdown = dogs > 0 || cats > 0 || others > 0;

            // Total: use breakdown sum when available, otherwise totalVaccinated field
            var tv = hasBreakdown
                ? dogs + cats + others
                : Number(e.totalVaccinated) || 0;

            if (tv === 0) return; // nothing to count yet — pending report

            if (!totals[e.barangay]) totals[e.barangay] = { dogs: 0, cats: 0, others: 0, total: 0 };
            var entry = totals[e.barangay];

            if (hasBreakdown) {
                entry.dogs   += dogs;
                entry.cats   += cats;
                entry.others += others;
            }
            // When no breakdown: total is still counted, species stay 0
            entry.total += tv;
        });
        return totals;
    }

    // ── NEW: Grand total vaccinated across all filtered DB events ─────────
    function getDbGrandTotal(range) {
        return getFilteredEvents(range).reduce(function(sum, e) {
            var tv = Number(e.totalVaccinated) || 0;
            if (tv === 0 && e.breakdown) {
                tv = (Number(e.breakdown.dogs) || 0)
                   + (Number(e.breakdown.cats) || 0)
                   + (Number(e.breakdown.others) || 0);
            }
            return sum + tv;
        }, 0);
    }

    // ── Loaders ───────────────────────────────────────────────────────────

    // SOURCE: Database — mass_vaccination_events table
    const loadEvents = async () => {
        try {
            const res = await fetch(MASS_VACC_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'list' })
            });
            const result = await res.json();
            if (Array.isArray(result.data)) state.events = result.data;
        } catch (err) {
            console.warn('DB events unavailable:', err);
        }
    };

    // SOURCE: Python ARIMA — vaccination forecast
    // The browser cannot call Python directly (CORS: Flask sends no CORS headers).
    // Correct call chain: JS -> PHP dashboard proxy -> curl -> Python :5001/vaccination-forecast
    // VetAPI wrapper is tried first if loaded; PHP proxy is the guaranteed fallback.
    const ARIMA_PROXY_API = `${appBasePath()}/api/dashboard/dashboard.php?scope=vaccination_forecast`;

    const loadArimaForecast = async () => {
        // Attempt 1: VetAPI wrapper (if the shared JS file loaded it)
        try {
            if (window.VetAPI?.getVaccinationForecast) {
                const res = await window.VetAPI.getVaccinationForecast(3);
                if (res?.ok && res.data) {
                    state.arimaData = res.data;
                    return;
                }
            }
        } catch (err) {
            console.warn('VetAPI ARIMA call failed, trying PHP proxy:', err);
        }

        // Attempt 2: PHP proxy -> curl -> Python (bypasses CORS entirely)
        // PHP dashboard.php handles scope=vaccination_forecast by POSTing to Python and returning the result
        try {
            const res    = await fetch(ARIMA_PROXY_API);
            const result = await res.json();
            if (result.success && result.data) {
                state.arimaData = result.data;
                return;
            }
            console.warn('PHP ARIMA proxy returned no data:', result);
        } catch (err) {
            console.warn('ARIMA PHP proxy unavailable — charts will use Excel fallback:', err);
        }
        // state.arimaData stays null; charts degrade gracefully to Excel fallback
    };

    // SOURCE: Excel — vet_dashboard (vaccinated totals, diseaseCasesByBarangay)
    const loadDashboardData = async () => {
        try {
            const res    = await fetch(`${DASHBOARD_API}?scope=vet`);
            const result = await res.json();
            if (result.success && result.data) state.dashboardData = result.data;
        } catch (err) {
            console.warn('Dashboard data unavailable:', err);
        }
    };

    // SOURCE: Excel — Combined_Rabies_3Years (monthly vaccination series)
    const loadVaccinationDataset = async () => {
        try {
            const fetchFn = window.VetAPI?.getMassVaccinationDataset
                ? () => window.VetAPI.getMassVaccinationDataset()
                : () => fetch(`${DASHBOARD_API}?scope=mass_vaccination_dataset`)
                    .then(r => r.json()).then(r => ({ ok: r.success, data: r.data }));
            const res = await fetchFn();
            if (res.ok && res.data) state.vaccinationDataset = res.data;
        } catch (err) {
            console.warn('Vaccination dataset unavailable:', err);
        }
    };

    // ── Barangay dropdown ─────────────────────────────────────────────────────
    // Always seeds the full 27-barangay Baliwag list first so all barangays are
    // always selectable, then adds any extras found in Excel or DB on top.
    const populateBarangayDropdown = () => {
        var select = document.getElementById('event-barangay');
        if (!select) return;

        // Start with the complete Baliwag barangay list — always present
        var barangays = new Set([
            'Bagong Nayon','Barangca','Calantipay','Catulinan','Concepcion',
            'Hinukay','Makinabang','Matangtubig','Pagala','Paitan','Piel',
            'Pinagbarilan','Poblacion','Sabang','San Jose','San Roque',
            'Sta. Barbara','Sto. Cristo','Sto. Nino','Subic','Sulivan',
            'Tangos','Tarcan','Tiaong','Tibag','Tilapayong','Virgen Delas Flores'
        ]);

        // Add any extra barangays found in the Excel dataset (e.g. new ones added later)
        if (state.vaccinationDataset?.by_barangay?.length) {
            state.vaccinationDataset.by_barangay.forEach(r => { if (r.barangay) barangays.add(r.barangay); });
        }
        // Add any extra barangays from existing DB events
        state.events.forEach(e => { if (e.barangay) barangays.add(e.barangay); });

        select.innerHTML = '<option value="">Select Barangay…</option>'
            + Array.from(barangays).sort().map(b =>
                `<option value="${b}">${b}</option>`
            ).join('');
    };

    // ── KPI metrics ───────────────────────────────────────────────────────
    const updateMetrics = () => {
        const pendingEl   = document.querySelector('[data-metric="pendingReports"]');
        const totalEl     = document.querySelector('[data-metric="eventsTotal"]');
        const petsEl      = document.querySelector('[data-metric="petsVaccinated"]');
        const barangayEl  = document.querySelector('[data-metric="activeBarangay"]');

        // DB: pending + total events
        const pending = state.events.filter(e => e.status === 'Pending Report').length;
        if (pendingEl) pendingEl.textContent = pending;
        if (totalEl)   totalEl.textContent   = state.events.length || '-';

        // DB first (all-time), then Excel fallback for total vaccinated
        const dbTotal = state.events.reduce((s, e) => {
            var tv = Number(e.totalVaccinated) || 0;
            if (tv === 0 && e.breakdown) {
                tv = (Number(e.breakdown.dogs) || 0)
                   + (Number(e.breakdown.cats) || 0)
                   + (Number(e.breakdown.others) || 0);
            }
            return s + tv;
        }, 0);

        if (petsEl) {
            if (dbTotal > 0) {
                petsEl.textContent = dbTotal.toLocaleString();
            } else {
                const excelTotal = state.vaccinationDataset?.summary?.total_vaccinated
                    || state.dashboardData?.vaccinated?.total || 0;
                petsEl.textContent = excelTotal > 0 ? excelTotal.toLocaleString() : '-';
            }
        }

        // DB: most active barangay by vaccinated count
        const barangayTotals = {};
        state.events.forEach(e => {
            if (!e.barangay) return;
            var tv = Number(e.totalVaccinated) || 0;
            if (tv === 0 && e.breakdown) {
                tv = (Number(e.breakdown.dogs) || 0)
                   + (Number(e.breakdown.cats) || 0)
                   + (Number(e.breakdown.others) || 0);
            }
            if (tv > 0) barangayTotals[e.barangay] = (barangayTotals[e.barangay] || 0) + tv;
        });
        const topBarangay = Object.keys(barangayTotals)
            .sort((a, b) => barangayTotals[b] - barangayTotals[a])[0];
        if (barangayEl) barangayEl.textContent = topBarangay || '-';

        // ARIMA: update pets vaccinated note
        if (state.arimaData?.total_vaccinated?.forecast && petsEl) {
            const noteEl = petsEl.nextElementSibling;
            const tv     = state.arimaData.total_vaccinated;
            if (noteEl) {
                noteEl.textContent = `ARIMA forecast: ${tv.forecast[0]} next month (${tv.trend || 'stable'})`;
                noteEl.className   = 'metric-note ' + (tv.trend === 'rising' ? 'success' : '');
            }
        }
    };

    // ── Table (DB source) ─────────────────────────────────────────────────
    const renderTable = () => {
        const tableBody = document.getElementById('event-table-body');
        tableBody.innerHTML = state.events.map(e => `
            <tr data-event-id="${sanitize(e.id)}">
                <td data-label="Date">${sanitize(e.dateLabel)}</td>
                <td data-label="Barangay">${sanitize(e.barangay)}</td>
                <td data-label="Vaccine">${sanitize(e.vaccine)}</td>
                <td data-label="Total Vaccinated">${formatNumber(e.totalVaccinated)}</td>
                <td data-label="Status"><span class="status-pill ${statusClass(e.status)}">${sanitize(e.status)}</span></td>
            </tr>
        `).join('');
    };

    // ── ARIMA summary card ────────────────────────────────────────────────
    const renderArimaCard = () => {
        var existing = document.getElementById('arima-vacc-card');
        if (existing) existing.remove();
        if (!state.arimaData?.total_vaccinated?.forecast) return;

        var tv   = state.arimaData.total_vaccinated || {};
        var cs   = state.arimaData.clients_served   || {};
        var dogs = state.arimaData.dogs_vaccinated  || {};
        var cats = state.arimaData.cats_vaccinated  || {};

        const trend    = (tv.trend || 'stable').toLowerCase();
        const trendCls = trend === 'rising' ? 'mv-trend-rising' : trend === 'falling' ? 'mv-trend-falling' : 'mv-trend-stable';

        const months = tv.months || ['Next Month', 'Month 2', 'Month 3'];

        var card = document.createElement('section');
        card.id        = 'arima-vacc-card';
        card.className = 'card mv-arima-card';
        card.innerHTML = `
            <div class="mv-arima-header">
                <div>
                    <span class="mv-arima-badge">ARIMA(${(tv.arima_order||[]).join(',')})</span>
                    <h3 class="mv-arima-title">Vaccine Demand Forecast</h3>
                    <p class="mv-arima-desc">${sanitize(tv.action || 'Demand forecast based on historical vaccination data.')}</p>
                </div>
                <div class="mv-trend-pill ${trendCls}">Overall Trend: ${trend.toUpperCase()}</div>
            </div>
            <div class="mv-forecast-section">
                <p class="mv-section-label">3-Month Total Forecast</p>
                <div class="mv-fc-grid">
                    ${months.map((m, i) => `
                        <div class="mv-fc-card">
                            <span class="mv-fc-label">${sanitize(m)}</span>
                            <span class="mv-fc-val">${tv.forecast?.[i] || 0}</span>
                            <span class="mv-fc-range">${tv.lower_ci?.[i]||0} – ${tv.upper_ci?.[i]||0}</span>
                            <span class="mv-fc-ci">80% CI</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="mv-breakdown-section">
                <p class="mv-section-label">Species &amp; Client Breakdown (Next Month)</p>
                <div class="mv-breakdown-grid">
                    <div class="mv-breakdown-card">
                        <span class="mv-bk-label">Dogs</span>
                        <span class="mv-bk-val">${dogs.forecast?.[0]||0}</span>
                        <span class="mv-bk-trend mv-trend-${(dogs.trend||'stable').toLowerCase()}">${dogs.trend||'stable'}</span>
                    </div>
                    <div class="mv-breakdown-card">
                        <span class="mv-bk-label">Cats</span>
                        <span class="mv-bk-val">${cats.forecast?.[0]||0}</span>
                        <span class="mv-bk-trend mv-trend-${(cats.trend||'stable').toLowerCase()}">${cats.trend||'stable'}</span>
                    </div>
                    <div class="mv-breakdown-card">
                        <span class="mv-bk-label">Clients</span>
                        <span class="mv-bk-val">${cs.forecast?.[0]||0}</span>
                        <span class="mv-bk-trend mv-trend-${(cs.trend||'stable').toLowerCase()}">${cs.trend||'stable'}</span>
                    </div>
                </div>
            </div>
        `;

        var placeholder = document.getElementById('arima-card-placeholder');
        if (placeholder) {
            placeholder.innerHTML = '';
            placeholder.appendChild(card);
        } else {
            var chartGrid = document.querySelector('#mass-vacc-dashboard .chart-grid');
            if (chartGrid) chartGrid.parentNode.insertBefore(card, chartGrid);
        }
    };

    // ── Charts ────────────────────────────────────────────────────────────
    const buildCharts = (range) => {
        range = range || document.getElementById('range-filter')?.value || 'This Year';

        document.querySelectorAll('.chart-skeleton').forEach((el) => el.remove());
        ['vaccinatedPerBarangayChart', 'predictedAnimalsChart', 'vaccineTypesChart', 'vaccinesNeededChart'].forEach((id) => {
            const canvas = document.getElementById(id);
            if (canvas) canvas.style.display = '';
        });

        // ── Live DB barangay totals for this range (used across multiple charts)
        var dbBarangayTotals = getDbBarangayTotals(range);
        var dbGrandTotal     = getDbGrandTotal(range);
        var hasDbData        = Object.keys(dbBarangayTotals).length > 0;

        // ── Chart 1: Vaccinated per Barangay
        // PRIMARY:  Excel Barangay_Disease_Monthly (historical baseline)
        // MERGED:   DB events for the selected range added on top per barangay
        // FALLBACK: DB events only → diseaseCasesByBarangay proxy
        destroyChart('vaccinatedPerBarangay');
        {
            var labels = [], dogsD = [], catsD = [], otherD = [];
            var dbDogsD = [], dbCatsD = [], dbOtherD = [];
            var hasExcel = false;

            if (state.vaccinationDataset?.by_barangay?.length) {
                hasExcel = true;
                // Scale Excel barangay totals by the filtered period ratio
                var allMonths  = state.vaccinationDataset.by_month || [];
                var filtMonths = getFilteredDatasetRows(range);
                var totalAll   = allMonths.reduce((s, r) => s + r.total_vaccinated, 0) || 1;
                var totalFilt  = filtMonths.reduce((s, r) => s + r.total_vaccinated, 0);
                var ratio      = totalAll > 0 ? totalFilt / totalAll : 1;

                state.vaccinationDataset.by_barangay.forEach(r => {
                    labels.push(r.barangay);
                    dogsD.push(Math.round(r.dogs_vaccinated   * ratio));
                    catsD.push(Math.round(r.cats_vaccinated   * ratio));
                    otherD.push(Math.round(r.others_vaccinated * ratio));

                    // Add any live DB totals for this barangay on top
                    var db = dbBarangayTotals[r.barangay] || { dogs: 0, cats: 0, others: 0 };
                    dbDogsD.push(db.dogs);
                    dbCatsD.push(db.cats);
                    dbOtherD.push(db.others);
                });

                // Also add barangays that exist ONLY in DB (new events not in Excel yet)
                Object.keys(dbBarangayTotals).forEach(barangay => {
                    if (!labels.includes(barangay)) {
                        labels.push(barangay);
                        dogsD.push(0); catsD.push(0); otherD.push(0);
                        var db = dbBarangayTotals[barangay];
                        dbDogsD.push(db.dogs);
                        dbCatsD.push(db.cats);
                        dbOtherD.push(db.others);
                    }
                });

            } else if (hasDbData) {
                // No Excel — DB only
                Object.keys(dbBarangayTotals).forEach(barangay => {
                    labels.push(barangay);
                    var db = dbBarangayTotals[barangay];
                    dogsD.push(0); catsD.push(0); otherD.push(0);
                    dbDogsD.push(db.dogs);
                    dbCatsD.push(db.cats);
                    dbOtherD.push(db.others);
                });

            } else if (state.dashboardData?.diseaseCasesByBarangay) {
                // Disease proxy fallback — no DB events at all
                state.dashboardData.diseaseCasesByBarangay.forEach(r => {
                    labels.push(r.barangay);
                    dogsD.push(r.actual);
                    catsD.push(Math.round(r.actual * 0.4));
                    otherD.push(Math.round(r.actual * 0.15));
                    dbDogsD.push(0); dbCatsD.push(0); dbOtherD.push(0);
                });
            }

            // Merge Excel historical + live DB per species into clean legend entries.
            // DB events with no species breakdown go into a separate "Unspecified" bar
            // rather than being fabricated into dogs/cats/others.
            var mergedDogs    = labels.map((_, i) => (dogsD[i]  || 0) + (dbDogsD[i]  || 0));
            var mergedCats    = labels.map((_, i) => (catsD[i]  || 0) + (dbCatsD[i]  || 0));
            var mergedOther   = labels.map((_, i) => (otherD[i] || 0) + (dbOtherD[i] || 0));

            // Unspecified = DB total minus the breakdown portion (events with no species data)
            var dbTotalsArr   = labels.map((_, i) => {
                var b = dbBarangayTotals[labels[i]] || {};
                var breakdownSum = (dbDogsD[i] || 0) + (dbCatsD[i] || 0) + (dbOtherD[i] || 0);
                return Math.max(0, (b.total || 0) - breakdownSum);
            });
            var hasUnspecified = dbTotalsArr.some(v => v > 0);
            var hasLiveData    = dbDogsD.some(v => v > 0) || dbCatsD.some(v => v > 0)
                              || dbOtherD.some(v => v > 0) || hasUnspecified;

            var datasets = [
                { label: 'Dogs',   data: mergedDogs,  backgroundColor: '#002A58', borderRadius: 5 },
                { label: 'Cats',   data: mergedCats,  backgroundColor: '#3B82F6', borderRadius: 5 },
                { label: 'Others', data: mergedOther, backgroundColor: '#7C3AED', borderRadius: 5 },
            ];
            // Only add Unspecified dataset when there are events without species breakdown
            if (hasUnspecified) {
                datasets.push({
                    label: 'Unspecified (no breakdown entered)',
                    data: dbTotalsArr,
                    backgroundColor: '#94A3B8', borderRadius: 5
                });
            }

            var chart1Title = hasLiveData
                ? `Vaccinated per Barangay — ${range} (includes ${dbGrandTotal.toLocaleString()} live records)`
                : `Vaccinated per Barangay — ${range}`;

            charts['vaccinatedPerBarangay'] = new Chart(
                document.getElementById('vaccinatedPerBarangayChart'), {
                type: 'bar',
                data: { labels, datasets },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, ticks: { color: '#456084' }, grid: { color: '#edf2f9' } },
                        x: { ticks: { color: '#456084', maxRotation: 45, minRotation: 45, font: { size: 10 } }, grid: { display: false } }
                    },
                    plugins: {
                        legend: { position: 'bottom' },
                        title: { display: true, text: chart1Title, font: { size: 11 }, color: '#456084' }
                    }
                }
            });
        }

        // ── Chart 2: Predicted Animals
        // SOURCE: Python ARIMA service
        // ANNOTATION: Show actual DB total for selected range alongside forecast
        // FALLBACK: Excel diseaseCasesByBarangay predicted values
        destroyChart('predictedAnimals');
        {
            var tv   = state.arimaData?.total_vaccinated || {};
            var dogs = state.arimaData?.dogs_vaccinated  || {};
            var cats = state.arimaData?.cats_vaccinated  || {};

            if (tv.forecast?.length) {
                // Chart 2: ARIMA forecast — Total predicted animals per month.
                // Dogs/Cats detail is already shown in the ARIMA summary card above,
                // so this chart stays clean with just Total + DB Actual reference.
                var arimaMonths = tv.months || ['Next Month', 'Month 2', 'Month 3'];

                var c2datasets = [
                    {
                        label: 'Predicted Total (ARIMA)',
                        data: tv.forecast || [],
                        backgroundColor: '#002A58',
                        borderRadius: 5
                    }
                ];

                // DB Actual: shown only for "Next Month" slot as a comparison point
                if (dbGrandTotal > 0) {
                    c2datasets.push({
                        label: `Actual Vaccinated (${range})`,
                        data: arimaMonths.map((_, i) => i === 0 ? dbGrandTotal : null),
                        backgroundColor: '#059669',
                        borderRadius: 5
                    });
                }

                var arimaOrderStr = (tv.arima_order || []).join(',');
                var ciStr = `CI: ${tv.lower_ci?.[0] || 0}–${tv.upper_ci?.[0] || 0}`;
                var c2Title = dbGrandTotal > 0
                    ? `ARIMA(${arimaOrderStr}) Forecast — ${ciStr} | Actual this period: ${dbGrandTotal.toLocaleString()}`
                    : `ARIMA(${arimaOrderStr}) Forecast — ${ciStr}`;

                charts['predictedAnimals'] = new Chart(
                    document.getElementById('predictedAnimalsChart'), {
                    type: 'bar',
                    data: { labels: arimaMonths, datasets: c2datasets },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: {
                            y: { beginAtZero: true, ticks: { color: '#456084' }, grid: { color: '#edf2f9' } },
                            x: { ticks: { color: '#456084' }, grid: { display: false } }
                        },
                        plugins: {
                            legend: { position: 'bottom' },
                            title: { display: true, text: c2Title, font: { size: 11 }, color: '#456084' }
                        }
                    }
                });
            } else {
                // ARIMA unavailable — show Excel monthly history + projection + DB actual
                // Each gets its own dedicated label slot so bars never overlap incorrectly

                // Pull last 6 months from Excel; try total_vaccinated first, then dogs+cats sum
                var rawMonthly = (state.vaccinationDataset?.by_month || []).slice(-6);
                var monthlyRows = rawMonthly.filter(r =>
                    (Number(r.total_vaccinated) || 0) > 0 ||
                    (Number(r.dogs_vaccinated)  || 0) > 0 ||
                    (Number(r.cats_vaccinated)  || 0) > 0
                );

                var c2Labels   = [];
                var excelData  = [];  // navy — historical totals
                var projData   = [];  // light blue — +12% next-month estimate
                var dbData     = [];  // green — live DB actual for selected range

                if (monthlyRows.length > 0) {
                    monthlyRows.forEach(r => {
                        var lbl   = (r.month || '').slice(0, 3) + ' ' + String(r.year).slice(-2);
                        var total = Number(r.total_vaccinated) || 0;
                        // Fallback: derive total from dogs + cats if total_vaccinated is 0
                        if (total === 0) total = (Number(r.dogs_vaccinated) || 0) + (Number(r.cats_vaccinated) || 0);
                        c2Labels.push(lbl);
                        excelData.push(total);
                        projData.push(null);
                        dbData.push(null);
                    });

                    // Add a dedicated "Next Month (est.)" slot for the projection
                    var lastExcel = excelData[excelData.length - 1] || 0;
                    c2Labels.push('Next Month (est.)');
                    excelData.push(null);
                    projData.push(Math.round(lastExcel * 1.12));
                    dbData.push(null);

                    // Add a dedicated "Live DB" slot so it never overwrites Excel bars
                    if (dbGrandTotal > 0) {
                        c2Labels.push(`Live DB (${range})`);
                        excelData.push(null);
                        projData.push(null);
                        dbData.push(dbGrandTotal);
                    }
                } else {
                    // Excel monthly data genuinely empty — just show DB if available
                    if (dbGrandTotal > 0) {
                        c2Labels = [`Live DB (${range})`];
                        excelData = [null];
                        projData  = [null];
                        dbData    = [dbGrandTotal];
                    } else {
                        c2Labels  = ['No data available'];
                        excelData = [0];
                        projData  = [null];
                        dbData    = [null];
                    }
                }

                var c2FallbackDatasets = [
                    { label: 'Monthly Total (Excel)', data: excelData, backgroundColor: '#002A58', borderRadius: 5 },
                    { label: 'Projected Next Month (+12%)', data: projData, backgroundColor: '#60A5FA', borderRadius: 5 },
                ];
                if (dbGrandTotal > 0) {
                    c2FallbackDatasets.push({
                        label: `Actual Vaccinated (Live DB)`,
                        data: dbData,
                        backgroundColor: '#059669'
                    });
                }

                charts['predictedAnimals'] = new Chart(
                    document.getElementById('predictedAnimalsChart'), {
                    type: 'bar',
                    data: { labels: c2Labels, datasets: c2FallbackDatasets },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: {
                            y: { beginAtZero: true, ticks: { color: '#456084' }, grid: { color: '#edf2f9' } },
                            x: { ticks: { color: '#456084' }, grid: { display: false } }
                        },
                        plugins: {
                            legend: { position: 'bottom' },
                            title: {
                                display: true,
                                text: monthlyRows.length > 0
                                    ? 'Monthly Trend (Excel) — ARIMA service unavailable'
                                    : 'Live DB Data — ARIMA and Excel history unavailable',
                                font: { size: 11 }, color: '#e07b39'
                            }
                        }
                    }
                });
            }
        }

        // ── Chart 3: Vaccine Types Distribution
        // PRIMARY:  DB events grouped by vaccine type (live source)
        // MERGED:   Excel vaccineDemand totals added as baseline when DB has no entries for a vaccine
        // SHOWS BOTH if both sources have data, with clear labeling
        destroyChart('vaccineTypes');
        {
            // Aggregate DB events by vaccine type
            var dbVaccineTotals = {};
            getFilteredEvents(range).forEach(e => {
                var vaccineName = e.vaccine || 'Unspecified';
                var tv = Number(e.totalVaccinated) || 0;
                if (tv === 0 && e.breakdown) {
                    tv = (Number(e.breakdown.dogs) || 0)
                       + (Number(e.breakdown.cats) || 0)
                       + (Number(e.breakdown.others) || 0);
                }
                dbVaccineTotals[vaccineName] = (dbVaccineTotals[vaccineName] || 0) + tv;
            });
            var dbVaccineLabels = Object.keys(dbVaccineTotals);
            var dbVaccineValues = dbVaccineLabels.map(l => dbVaccineTotals[l]);

            // Excel vaccine demand as baseline reference
            var excelVaccineMap = {};
            if (state.dashboardData?.vaccineDemand?.length) {
                state.dashboardData.vaccineDemand.forEach(row => {
                    excelVaccineMap[row.label] = Number(row.units) || 0;
                });
            }

            if (dbVaccineLabels.length > 0) {
                // DB data exists — show DB totals as primary bars
                // If Excel also has matching labels, show them as a secondary dataset
                var hasExcelVaccine = Object.keys(excelVaccineMap).length > 0;
                var c3Datasets = [
                    {
                        label: 'Doses Injected (Live DB)',
                        data: dbVaccineValues,
                        backgroundColor: '#002A58',
                        borderRadius: 6
                    }
                ];

                if (hasExcelVaccine) {
                    // Only add Excel bars for labels that exist in both sources
                    var excelValues = dbVaccineLabels.map(l => excelVaccineMap[l] || 0);
                    var hasOverlap = excelValues.some(v => v > 0);
                    if (hasOverlap) {
                        c3Datasets.push({
                            label: 'Historical Demand (Excel)',
                            data: excelValues,
                            backgroundColor: '#60A5FA',
                            borderRadius: 6
                        });
                    }
                }

                charts['vaccineTypes'] = new Chart(
                    document.getElementById('vaccineTypesChart'), {
                    type: 'bar',
                    data: {
                        labels: dbVaccineLabels,
                        datasets: c3Datasets
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: {
                            y: { beginAtZero: true, ticks: { color: '#456084' }, grid: { color: '#edf2f9' } },
                            x: { ticks: { color: '#456084' }, grid: { display: false } }
                        },
                        plugins: {
                            legend: { position: 'bottom' },
                            title: { display: true, text: `Vaccine Types Injected — ${range}`, font: { size: 11 }, color: '#456084' }
                        }
                    }
                });

            } else if (Object.keys(excelVaccineMap).length) {
                // No DB events — show Excel vaccineDemand only
                var excelLabels = Object.keys(excelVaccineMap);
                charts['vaccineTypes'] = new Chart(
                    document.getElementById('vaccineTypesChart'), {
                    type: 'bar',
                    data: {
                        labels: excelLabels,
                        datasets: [{
                            label: 'Historical Demand (Excel)',
                            data: excelLabels.map(l => excelVaccineMap[l]),
                            backgroundColor: '#0f2a6d',
                            borderRadius: 6
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: {
                            y: { beginAtZero: true, ticks: { color: '#456084' }, grid: { color: '#edf2f9' } },
                            x: { ticks: { color: '#456084' }, grid: { display: false } }
                        },
                        plugins: {
                            legend: { position: 'bottom' },
                            title: { display: true, text: `Vaccine Demand (Excel Baseline) — ${range}`, font: { size: 11 }, color: '#456084' }
                        }
                    }
                });

            } else {
                // Completely empty — placeholder doughnut
                charts['vaccineTypes'] = new Chart(
                    document.getElementById('vaccineTypesChart'), {
                    type: 'doughnut',
                    data: {
                        labels: ['No reported vaccines'],
                        datasets: [{ data: [1], backgroundColor: ['#dbe4f0'], borderWidth: 0 }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, cutout: '45%', plugins: { legend: { position: 'right' } } }
                });
            }
        }

        // ── Chart 4: Vaccines Needed per Barangay
        // SOURCE: ARIMA forecast distributed across Excel barangays
        // ADJUSTMENT: When DB events have actual data, boost the ARIMA total by
        //             the ratio of (DB actuals / previous ARIMA forecast) so the
        //             predicted need scales with real-world uptake.
        // FALLBACK: Excel predicted values, scaled by DB activity ratio
        destroyChart('vaccinesNeeded');
        {
            var tvN   = state.arimaData?.total_vaccinated || {};
            var multi = range === 'Last 3 Months' ? 3 : range === 'This Year' ? 12 : 1;

            // ── Build the full barangay list from ALL available sources ────────────
            // Priority: vaccinationDataset.by_barangay (Excel, most complete) →
            //           diseaseCasesByBarangay (dashboard Excel) →
            //           DB event barangays
            var barangayBaseMap = {}; // { barangay: { actual, predicted } }

            if (state.vaccinationDataset?.by_barangay?.length) {
                state.vaccinationDataset.by_barangay.forEach(r => {
                    var b = r.barangay;
                    if (!b) return;
                    if (!barangayBaseMap[b]) barangayBaseMap[b] = { actual: 0, predicted: 0 };
                    barangayBaseMap[b].actual    += Number(r.total_vaccinated) || 0;
                    barangayBaseMap[b].predicted += Number(r.total_vaccinated) || 0; // replaced below by RF if available
                });
            }

            if (state.dashboardData?.diseaseCasesByBarangay?.length) {
                state.dashboardData.diseaseCasesByBarangay.forEach(r => {
                    var b = r.barangay;
                    if (!b) return;
                    if (!barangayBaseMap[b]) barangayBaseMap[b] = { actual: 0, predicted: 0 };
                    // RF-predicted value from PHP backend — use this if available
                    if (r.predicted > 0) barangayBaseMap[b].predicted = Number(r.predicted);
                    if (barangayBaseMap[b].actual === 0 && r.actual > 0) {
                        barangayBaseMap[b].actual = Number(r.actual);
                    }
                });
            }

            // Also add barangays that only exist in DB events (newly added)
            Object.keys(dbBarangayTotals).forEach(b => {
                if (!barangayBaseMap[b]) barangayBaseMap[b] = { actual: 0, predicted: 0 };
            });

            var allBarangays = Object.keys(barangayBaseMap);
            if (!allBarangays.length) {
                // Last resort fallback: standard Baliwag barangay list
                ['Bagong Nayon','Barangca','Calantipay','Catulinan','Concepcion',
                 'Hinukay','Makinabang','Matangtubig','Pagala','Paitan','Piel',
                 'Pinagbarilan','Poblacion','Sabang','San Jose','San Roque',
                 'Sta. Barbara','Sto. Cristo','Sto. Nino','Subic','Sulivan',
                 'Tangos','Tarcan','Tiaong','Tibag','Tilapayong','Virgen Delas Flores'
                ].forEach(b => { barangayBaseMap[b] = { actual: 0, predicted: 0 }; });
                allBarangays = Object.keys(barangayBaseMap);
            }

            // Total actual across all barangays (for proportional ARIMA distribution)
            var totalActual = allBarangays.reduce((s, b) => s + (barangayBaseMap[b].actual || 0), 0) || 1;

            // ── ARIMA path — distribute forecast across ALL barangays ────────────
            if (tvN.forecast?.length) {
                var arimaBase = (tvN.forecast[0] || 0) * multi;

                // DB-adjust the ARIMA total when live data exists (60% ARIMA / 40% DB-informed blend)
                var adjustedTotal = arimaBase;
                if (dbGrandTotal > 0 && tvN.forecast[0] > 0) {
                    var dbMonthEst = range === 'This Year' ? dbGrandTotal / 12
                                   : range === 'Last 3 Months' ? dbGrandTotal / 3
                                   : dbGrandTotal;
                    var actRatio   = dbMonthEst / tvN.forecast[0];
                    adjustedTotal  = Math.min(arimaBase * 2,
                        Math.round(arimaBase * 0.6 + arimaBase * actRatio * 0.4) * multi);
                }

                var c4Title = dbGrandTotal > 0
                    ? `ARIMA Vaccine Demand (${range}): ~${Math.round(adjustedTotal).toLocaleString()} needed (DB-adjusted)`
                    : `ARIMA Vaccine Demand (${range}): ~${Math.round(arimaBase).toLocaleString()} vaccines`;

                charts['vaccinesNeeded'] = new Chart(
                    document.getElementById('vaccinesNeededChart'), {
                    type: 'bar',
                    data: {
                        labels: allBarangays,
                        datasets: [
                            {
                                label: 'Vaccines Needed (ARIMA)',
                                // Distribute total proportionally by each barangay's historical share
                                data: allBarangays.map(b =>
                                    Math.round(((barangayBaseMap[b].actual || 0) / totalActual) * adjustedTotal)
                                ),
                                backgroundColor: '#002A58',
                                stack: 'need'
                            },
                            ...(hasDbData ? [{
                                label: 'Already Vaccinated (Live DB)',
                                data: allBarangays.map(b => (dbBarangayTotals[b] || {}).total || 0),
                                backgroundColor: '#059669',
                                stack: 'done'
                            }] : [])
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: {
                            y: { beginAtZero: true, ticks: { color: '#456084' }, grid: { color: '#edf2f9' } },
                            x: { ticks: { color: '#456084', maxRotation: 45, minRotation: 45, font: { size: 10 } }, grid: { display: false } }
                        },
                        plugins: {
                            legend: { position: 'bottom' },
                            title: { display: true, text: c4Title, font: { size: 11 }, color: '#456084' }
                        }
                    }
                });

            } else {
                // Fallback — RF-predicted values from PHP dashboard (all barangays, no slice)
                var c4FallbackDatasets = [
                    {
                        label: 'Vaccines Needed (RF Predicted)',
                        data: allBarangays.map(b => Math.round((barangayBaseMap[b].predicted || 0) * multi)),
                        backgroundColor: '#002A58'
                    }
                ];
                if (hasDbData) {
                    c4FallbackDatasets.push({
                        label: 'Already Vaccinated (Live DB)',
                        data: allBarangays.map(b => (dbBarangayTotals[b] || {}).total || 0),
                        backgroundColor: '#059669'
                    });
                }

                charts['vaccinesNeeded'] = new Chart(
                    document.getElementById('vaccinesNeededChart'), {
                    type: 'bar',
                    data: {
                        labels: allBarangays,
                        datasets: c4FallbackDatasets
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: {
                            y: { beginAtZero: true, ticks: { color: '#456084' }, grid: { color: '#edf2f9' } },
                            x: { ticks: { color: '#456084', maxRotation: 45, minRotation: 45, font: { size: 10 } }, grid: { display: false } }
                        },
                        plugins: {
                            legend: { position: 'bottom' },
                            title: {
                                display: true,
                                text: `Vaccine Demand — ${range} (RF Predicted, ARIMA unavailable)`,
                                font: { size: 11 }, color: '#e07b39'
                            }
                        }
                    }
                });
            }
        }
    };

    // ── Detail panel ──────────────────────────────────────────────────────
    const setProgress = (el, val, max) => {
        el.style.width = `${Math.max(0, Math.min(100, (val / (max||100)) * 100))}%`;
    };

    const hydrateDetail = (eventId) => {
        const e = state.events.find(item => item.id === eventId);
        if (!e) return;

        document.getElementById('detail-title').textContent  = `${e.barangay} - ${e.vaccine}`;
        document.getElementById('detail-date').textContent   = e.dateLabel;
        document.getElementById('detail-status').textContent = e.status;
        document.getElementById('detail-status').className   = `pill ${statusClass(e.status)}`;
        document.getElementById('info-date').textContent     = e.dateLabel;
        document.getElementById('info-barangay').textContent = e.barangay;
        document.getElementById('info-vaccine').textContent  = e.vaccine;
        document.getElementById('info-status').textContent   = e.status;

        document.getElementById('total-vaccinated').value = e.totalVaccinated === '' ? '' : e.totalVaccinated;
        document.getElementById('dogs-count').value   = e.breakdown.dogs;
        document.getElementById('cats-count').value   = e.breakdown.cats;
        document.getElementById('others-count').value = e.breakdown.others;

        const wb = e.breakdown.dogs + e.breakdown.cats + e.breakdown.others > 0;
        document.getElementById('include-breakdown').checked = wb;
        document.getElementById('species-breakdown').classList.toggle('hidden', !wb);
        document.getElementById('species-breakdown').setAttribute('aria-hidden', String(!wb));

        document.getElementById('event-progress-value').textContent   = e.comparison.event;
        document.getElementById('average-progress-value').textContent = e.comparison.average;
        document.getElementById('highest-progress-value').textContent = e.comparison.highest;
        setProgress(document.getElementById('event-progress'),   e.comparison.event,   e.comparison.highest);
        setProgress(document.getElementById('average-progress'), e.comparison.average, e.comparison.highest);
        setProgress(document.getElementById('highest-progress'), e.comparison.highest, e.comparison.highest);

        const delta = Math.round(((e.comparison.event - e.comparison.average) / e.comparison.average) * 100);
        const noteEl = document.getElementById('comparison-note');
        noteEl.textContent =
            `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}% ${delta >= 0 ? 'above' : 'below'} barangay average - ${delta >= 0 ? 'good turnout' : 'needs follow up'}!`;
        noteEl.className = delta >= 0 ? 'success-note' : 'warning-note';

        document.getElementById('post-event-form').dataset.activeEventId = e.id;
        setPanel('detail');
    };

    // ── Event listeners ───────────────────────────────────────────────────
    document.getElementById('event-table-body').addEventListener('click', (ev) => {
        const row = ev.target.closest('tr[data-event-id]');
        if (row) hydrateDetail(row.dataset.eventId);
    });

    document.getElementById('back-to-dashboard').addEventListener('click', () => setPanel('dashboard'));

    document.getElementById('include-breakdown').addEventListener('change', () => {
        const show = document.getElementById('include-breakdown').checked;
        document.getElementById('species-breakdown').classList.toggle('hidden', !show);
        document.getElementById('species-breakdown').setAttribute('aria-hidden', String(!show));
    });

    document.getElementById('post-event-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const activeId = document.getElementById('post-event-form').dataset.activeEventId;
        const e = state.events.find(item => item.id === activeId);
        if (!e) return;

        e.totalVaccinated = Number(document.getElementById('total-vaccinated').value || 0);
        e.breakdown = document.getElementById('include-breakdown').checked
            ? {
                dogs:   Number(document.getElementById('dogs-count').value||0),
                cats:   Number(document.getElementById('cats-count').value||0),
                others: Number(document.getElementById('others-count').value||0)
              }
            : { dogs: 0, cats: 0, others: 0 };

        try {
            const res = await fetch(MASS_VACC_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'submit_report',
                    id: activeId,
                    totalVaccinated: e.totalVaccinated,
                    breakdown: e.breakdown
                })
            });
            const result = await res.json();
            if (result.success) Object.assign(e, result.data);
        } catch (err) {
            alert('Failed to save report.'); return;
        }

        // Re-render everything with fresh state — charts now pick up the new totals
        renderTable();
        updateMetrics();
        buildCharts();
        hydrateDetail(e.id);
        alert('Vaccination report saved.');
    });

    const dateInput        = document.getElementById('event-date');
    const dateError         = document.getElementById('date-error');
    const barangaySelect    = document.getElementById('event-barangay');
    const barangayTrigger   = document.getElementById('barangay-trigger');
    const barangayError     = document.getElementById('barangay-error');
    const vaccineSelect     = document.getElementById('event-vaccine');
    const otherVaccineField = document.getElementById('other-vaccine-field');
    const otherVaccineInput = document.getElementById('event-vaccine-other');
    const otherVaccineError = document.getElementById('vaccine-other-error');

    function todayIso() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function setFieldError(input, errorEl, message) {
        input.classList.toggle('invalid', Boolean(message));
        if (errorEl) {
            errorEl.textContent = message || '';
            errorEl.classList.toggle('visible', Boolean(message));
        }
    }

    // ── Custom dropdown: mirrors a native <select> visually so the
    // options panel always opens downward with controlled padding,
    // instead of relying on the browser's native (sometimes upward) list. ──
    function enhanceSelect(select, wrapId, triggerId, panelId) {
        const wrap    = document.getElementById(wrapId);
        const trigger = document.getElementById(triggerId);
        const panel   = document.getElementById(panelId);
        const valueEl = trigger?.querySelector('.custom-select-value');
        if (!select || !wrap || !trigger || !panel || !valueEl) return null;

        function syncLabel() {
            const opt = select.options[select.selectedIndex];
            valueEl.textContent = opt ? opt.textContent : '';
            valueEl.classList.toggle('placeholder', !select.value);
        }

        function buildPanel() {
            panel.innerHTML = '';
            Array.from(select.options).forEach((opt) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'custom-select-option' + (opt.value === select.value ? ' selected' : '');
                item.setAttribute('role', 'option');
                item.textContent = opt.textContent;
                item.addEventListener('click', () => {
                    select.value = opt.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    syncLabel();
                    closePanel();
                });
                panel.appendChild(item);
            });
        }

        function openPanel() {
            buildPanel();
            panel.hidden = false;
            wrap.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');
        }

        function closePanel() {
            panel.hidden = true;
            wrap.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
        }

        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            if (panel.hidden) openPanel(); else closePanel();
        });

        document.addEventListener('click', (event) => {
            if (!wrap.contains(event.target)) closePanel();
        });

        select.addEventListener('change', syncLabel);
        syncLabel();

        return { syncLabel, closePanel };
    }

    const barangaySelectUI = enhanceSelect(barangaySelect, 'barangay-select-wrap', 'barangay-trigger', 'barangay-panel');
    const vaccineSelectUI  = enhanceSelect(vaccineSelect, 'vaccine-select-wrap', 'vaccine-trigger', 'vaccine-panel');

    function toggleOtherVaccineField() {
        const isOthers = vaccineSelect.value === 'Others';
        otherVaccineField.hidden = !isOthers;
        otherVaccineInput.required = isOthers;
        if (!isOthers) setFieldError(otherVaccineInput, otherVaccineError, '');
    }

    vaccineSelect.addEventListener('change', toggleOtherVaccineField);

    const openModal  = () => {
        dateInput.min = todayIso();
        toggleOtherVaccineField();
        document.getElementById('create-event-modal').classList.remove('hidden');
    };
    const closeModal = () => {
        document.getElementById('create-event-modal').classList.add('hidden');
        document.getElementById('create-event-form').reset();
        setFieldError(dateInput, dateError, '');
        setFieldError(barangayTrigger, barangayError, '');
        setFieldError(otherVaccineInput, otherVaccineError, '');
        barangaySelectUI?.syncLabel();
        vaccineSelectUI?.syncLabel();
        toggleOtherVaccineField();
    };

    document.getElementById('open-create-event').addEventListener('click', openModal);
    document.getElementById('close-create-event').addEventListener('click', closeModal);
    document.getElementById('cancel-create-event').addEventListener('click', closeModal);
    document.getElementById('create-event-modal').addEventListener('click', e => {
        if (e.target === document.getElementById('create-event-modal')) closeModal();
    });

    const summaryModal = document.getElementById('event-created-modal');
    const closeSummaryModal = () => summaryModal.classList.add('hidden');
    document.getElementById('close-event-created').addEventListener('click', closeSummaryModal);
    document.getElementById('summary-done-btn').addEventListener('click', closeSummaryModal);
    summaryModal.addEventListener('click', e => {
        if (e.target === summaryModal) closeSummaryModal();
    });

    function showEventSummary(event) {
        document.getElementById('summary-id').textContent       = event.id || '—';
        document.getElementById('summary-date').textContent     = event.dateLabel || event.date || '—';
        document.getElementById('summary-barangay').textContent = event.barangay || '—';
        document.getElementById('summary-vaccine').textContent  = event.vaccine || '—';
        const summaryStatusEl = document.getElementById('summary-status');
        summaryStatusEl.textContent = event.status || 'Scheduled';
        summaryStatusEl.className   = `summary-value summary-status ${statusClass(event.status || 'Scheduled')}`;
        summaryModal.classList.remove('hidden');
    }

    document.getElementById('create-event-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();

        setFieldError(dateInput, dateError, '');
        setFieldError(barangayTrigger, barangayError, '');
        setFieldError(otherVaccineInput, otherVaccineError, '');

        let hasError = false;

        if (!dateInput.value) {
            setFieldError(dateInput, dateError, 'Please select a date.');
            hasError = true;
        } else if (dateInput.value < todayIso()) {
            setFieldError(dateInput, dateError, 'Date cannot be in the past.');
            hasError = true;
        }

        if (!barangaySelect.value) {
            setFieldError(barangayTrigger, barangayError, 'Please select a barangay.');
            hasError = true;
        }

        const isOthers = vaccineSelect.value === 'Others';
        if (isOthers && !otherVaccineInput.value.trim()) {
            setFieldError(otherVaccineInput, otherVaccineError, 'Please specify the vaccine name.');
            hasError = true;
        }

        if (hasError) return;

        const fd = new FormData(document.getElementById('create-event-form'));
        const vaccineValue = isOthers ? otherVaccineInput.value.trim() : fd.get('vaccine');

        const isDuplicate = state.events.some(e =>
            e.date === dateInput.value &&
            (e.barangay || '').trim().toLowerCase() === barangaySelect.value.trim().toLowerCase() &&
            (e.vaccine || '').trim().toLowerCase() === vaccineValue.trim().toLowerCase()
        );
        if (isDuplicate) {
            setFieldError(dateInput, dateError, 'An event for this barangay and vaccine is already scheduled on this date.');
            return;
        }

        try {
            const res = await fetch(MASS_VACC_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create',
                    date: fd.get('date'),
                    barangay: fd.get('barangay'),
                    vaccine: vaccineValue
                })
            });
            const result = await res.json();
            if (result.success) state.events.unshift(result.data);
            else { alert(result.message || 'Failed to create event.'); return; }

            renderTable();
            updateMetrics();
            buildCharts();
            closeModal();
            showEventSummary(result.data);
        } catch (err) { alert('Failed to create event.'); return; }
    });

    document.getElementById('range-filter')?.addEventListener('change', e => buildCharts(e.target.value));

    // ── Init ──────────────────────────────────────────────────────────────
    renderSkeletons();
    await Promise.all([loadEvents(), loadArimaForecast(), loadDashboardData(), loadVaccinationDataset()]);

    renderTable();
    updateMetrics();
    setPanel('dashboard');
    closeModal();
    renderArimaCard();
    buildCharts();
    populateBarangayDropdown();
});
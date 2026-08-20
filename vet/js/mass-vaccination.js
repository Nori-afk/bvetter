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
        return '';
    }

    const MASS_VACC_API = `${appBasePath()}/api/mass-vaccination/events.php`;
    const DASHBOARD_API = `${appBasePath()}/api/dashboard/dashboard.php`;
    const charts = {};

    // ── State ─────────────────────────────────────────────────────────────
    const state = {
        events:             [],   // from DB (mass_vaccination_events table)  ← LIVE SOURCE
        arimaData:          null, // from Python ARIMA service
        dashboardData:      null, // from PHP vet_dashboard (Excel summary)
        vaccinationDataset: null, // from PHP mass_vaccination_dataset, scoped to state.dataView
        eventTablePage:     1,
        // 'historical' = frozen pre-2025 baseline (Excel + the 2023-2024 rows
        // already sitting in mass_vaccination_events -- training data either
        // way). 'current' = live mass_vaccination_events rows dated 2025+.
        // See MASS_VACC_CURRENT_CUTOFF in dashboard.php for the exact split.
        dataView:           'historical',
    };
    const MASS_VACC_CUTOFF = new Date('2025-01-01T00:00:00');

    // Desktop can comfortably show more rows per page than a phone screen.
    const pageSizeForViewport = () => (window.innerWidth <= 768 ? 5 : 10);

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

        ['vaccinatedPerBarangayChart', 'predictedAnimalsChart', 'vaccinesNeededList'].forEach((id) => {
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
            // Belt-and-suspenders on top of the server-side split (see
            // MASS_VACC_CURRENT_CUTOFF in dashboard.php): whichever view is
            // active, an event from the other era never enters a range total.
            if (state.dataView === 'current'    && d <  MASS_VACC_CUTOFF) return false;
            if (state.dataView === 'historical' && d >= MASS_VACC_CUTOFF) return false;
            if (range === 'This Month')    return d.getFullYear() === nowYear && d.getMonth() === nowMonth;
            if (range === 'Last 3 Months') {
                var cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 3);
                return d >= cutoff;
            }
            if (range === 'This Year') return d.getFullYear() === nowYear;
            return true;
        });
    }

    // All DB events belonging to the active Historical/Current view, with no
    // range slicing -- used by the KPI cards, which aren't scoped by
    // range-filter at all.
    function eventsInView() {
        return (state.events || []).filter(function(e) {
            if (!e.date) return true;
            var d = new Date(e.date + 'T00:00:00');
            if (isNaN(d.getTime())) return true;
            return state.dataView === 'current' ? d >= MASS_VACC_CUTOFF : d < MASS_VACC_CUTOFF;
        });
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

    // SOURCE: Historical baseline (Excel + pre-2025 DB rows) or live DB rows
    // dated 2025+, scoped server-side by state.dataView.
    const loadVaccinationDataset = async () => {
        try {
            const fetchFn = window.VetAPI?.getMassVaccinationDataset
                ? () => window.VetAPI.getMassVaccinationDataset(state.dataView)
                : () => fetch(`${DASHBOARD_API}?scope=mass_vaccination_dataset&data_view=${encodeURIComponent(state.dataView)}`)
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
                `<option value="${window.vbEscapeHtml(b)}">${window.vbEscapeHtml(b)}</option>`
            ).join('');
    };

    // ── KPI metrics ───────────────────────────────────────────────────────
    const updateMetrics = () => {
        const pendingEl   = document.querySelector('[data-metric="pendingReports"]');
        const totalEl     = document.querySelector('[data-metric="eventsTotal"]');
        const petsEl      = document.querySelector('[data-metric="petsVaccinated"]');
        const barangayEl  = document.querySelector('[data-metric="activeBarangay"]');

        // DB events scoped to the active Historical/Current view -- these
        // cards read the same split as the charts, not an all-time mix.
        const viewEvents = eventsInView();

        // DB: pending + total events
        const pending   = viewEvents.filter(e => e.status === 'Pending Report').length;
        const completed = viewEvents.length - pending;
        if (pendingEl) pendingEl.textContent = pending;
        if (totalEl)   totalEl.textContent   = viewEvents.length || '-';

        // These captions were left as permanent loading-skeleton placeholders
        // before — renderSkeletons() blanks them out, but nothing ever put
        // real text back in for these three cards.
        const totalNoteEl = totalEl?.nextElementSibling;
        if (totalNoteEl) totalNoteEl.textContent = viewEvents.length
            ? `${completed} completed, ${pending} pending`
            : 'No events recorded yet';

        const pendingNoteEl = pendingEl?.nextElementSibling;
        if (pendingNoteEl) pendingNoteEl.textContent = pending > 0 ? 'Events awaiting data' : 'All caught up';

        // DB first (scoped to view), then Excel/vaccinationDataset fallback for total vaccinated
        const dbTotal = viewEvents.reduce((s, e) => {
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
            // Default caption — overridden below by the ARIMA forecast note when that's available.
            const petsNoteEl = petsEl.nextElementSibling;
            if (petsNoteEl) petsNoteEl.textContent = 'Across all barangays';
        }

        // DB: most active barangay by vaccinated count
        const barangayTotals = {};
        viewEvents.forEach(e => {
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

        const barangayNoteEl = barangayEl?.nextElementSibling;
        if (barangayNoteEl) barangayNoteEl.textContent = topBarangay
            ? `${barangayTotals[topBarangay].toLocaleString()} pets vaccinated`
            : 'No completed reports yet';

        // ARIMA: update pets vaccinated note
        if (state.arimaData?.total_vaccinated?.forecast && petsEl) {
            const noteEl = petsEl.nextElementSibling;
            const tv     = state.arimaData.total_vaccinated;
            if (noteEl) {
                noteEl.textContent = `Predicted next month: ${tv.forecast[0]} (${tv.trend || 'stable'})`;
                noteEl.className   = 'metric-note ' + (tv.trend === 'rising' ? 'success' : '');
            }
        }
    };

    // ── Table (DB source) ─────────────────────────────────────────────────
    const renderTable = () => {
        const tableBody = document.getElementById('event-table-body');
        const footer    = document.getElementById('event-table-footer');

        const pageSize   = pageSizeForViewport();
        const totalPages = Math.max(1, Math.ceil(state.events.length / pageSize));
        state.eventTablePage = Math.min(Math.max(1, state.eventTablePage), totalPages);
        const start     = (state.eventTablePage - 1) * pageSize;
        const pageRows  = state.events.slice(start, start + pageSize);

        tableBody.innerHTML = pageRows.map(e => `
            <tr data-event-id="${sanitize(e.id)}">
                <td data-label="Date">${sanitize(e.dateLabel)}</td>
                <td data-label="Barangay">${sanitize(e.barangay)}</td>
                <td data-label="Vaccine">${sanitize(e.vaccine)}</td>
                <td data-label="Total Vaccinated">${formatNumber(e.totalVaccinated)}</td>
                <td data-label="Status"><span class="status-pill ${statusClass(e.status)}">${sanitize(e.status)}</span></td>
            </tr>
        `).join('');

        if (!footer) return;
        if (totalPages <= 1) { footer.innerHTML = ''; return; }
        footer.innerHTML = `
            <div class="report-footer">
                <p>Displaying ${pageRows.length} of ${state.events.length} Records</p>
                <div class="pagination">
                    <button type="button" class="page-btn" data-event-page="prev" aria-label="Previous page" ${state.eventTablePage <= 1 ? 'disabled' : ''}>&lsaquo;</button>
                    <button type="button" class="page-btn active" disabled>${state.eventTablePage}</button>
                    <button type="button" class="page-btn" data-event-page="next" aria-label="Next page" ${state.eventTablePage >= totalPages ? 'disabled' : ''}>&rsaquo;</button>
                </div>
            </div>
        `;
        footer.querySelectorAll('[data-event-page]').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.eventTablePage += btn.dataset.eventPage === 'prev' ? -1 : 1;
                renderTable();
            });
        });
    };

    // ── ARIMA summary card ────────────────────────────────────────────────
    const renderArimaCard = () => {
        var existing = document.getElementById('arima-vacc-card');
        if (existing) existing.remove();

        // No forecast to show. This used to `return` here, which left the
        // loading skeleton that renderSkeletons() wrote into the placeholder
        // sitting there permanently - so an unreachable analytics service was
        // indistinguishable from a page that never finished loading. Clear it
        // and say plainly that the forecast is missing.
        if (!state.arimaData?.total_vaccinated?.forecast) {
            var emptyHost = document.getElementById('arima-card-placeholder');
            if (emptyHost) emptyHost.innerHTML = `
                <section class="card mv-arima-card" id="arima-vacc-card">
                    <div class="mv-arima-header">
                        <div>
                            <span class="mv-arima-badge" style="background:#F1F5F9;color:#64748B;">Forecast Unavailable</span>
                            <h3 class="mv-arima-title">Vaccine Demand Forecast</h3>
                            <p class="mv-arima-desc">The analytics service did not return a forecast, so no demand
                            projection is shown. Vaccination records and the charts below are unaffected. Reload the
                            page to retry - if it keeps happening, the analytics service needs to be checked.</p>
                        </div>
                    </div>
                </section>`;
            return;
        }

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
                    <span class="mv-arima-badge">Smart Forecast</span>
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
                            <span class="mv-fc-ci">Likely Range</span>
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
    // Chart colors — pulled from this page's own --mv-* design tokens rather
    // than a new palette, so charts stay visually aligned with the rest of
    // the site. Only "others" has no existing system-hue counterpart (navy
    // reads too dark/desaturated as a data mark, and warning/danger already
    // carry status meaning elsewhere on this page) — it's a violet close to
    // this chart's original color, checked alongside blue+green for
    // CVD-safe adjacent distinction (see /dataviz skill).
    const VIZ = {
        dogs:   '#2f9df0', // --mv-blue
        cats:   '#108f2a', // --mv-green
        others: '#4a3aa7', // violet accent (only intentionally new hue)
        muted:  '#6f8098', // --mv-muted
        warn:   '#d4bc53'  // --mv-warning
    };

    // Horizontal bar charts (many barangay rows) size their own scroll
    // container to fit every row at a readable height, instead of squashing
    // labels into a fixed box — .chart-scroll (CSS) caps it and scrolls
    // vertically once it's taller than the card, so the page itself doesn't
    // grow no matter how many barangays there are.
    const sizeHorizontalChart = (canvasId, rowCount, rowHeight) => {
        const canvas = document.getElementById(canvasId);
        const inner  = canvas?.closest('.chart-scroll-inner');
        if (inner) inner.style.height = Math.max(220, rowCount * (rowHeight || 30)) + 'px';
    };

    // Renders a sorted meter-bar ranking (reuses the .line/.fill component from
    // the event-detail comparison card) instead of a canvas chart — a visually
    // distinct way to show "many categories, highest to lowest" so it doesn't
    // just look like a second copy of the barangay bar chart above it.
    const renderRankList = (listId, titleId, titleText, titleColor, labels, primaryArr, secondaryArr, showSecondary) => {
        const titleEl = document.getElementById(titleId);
        if (titleEl) { titleEl.textContent = titleText; titleEl.style.color = titleColor; }

        const maxVal = Math.max(1, ...primaryArr);
        const rows = labels
            .map((name, i) => ({ name, value: primaryArr[i] || 0, done: secondaryArr?.[i] || 0 }))
            .filter((row) => row.value > 0 || row.done > 0) // skip barangays with nothing to show
            .sort((a, b) => b.value - a.value)
            .map((row) => {
                const pct = Math.max(2, Math.round((row.value / maxVal) * 100));
                const sub = showSecondary && row.done > 0 ? `<small>${row.done.toLocaleString()} done</small>` : '';
                return `
                    <div class="rank-row">
                        <span class="rank-name" title="${sanitize(row.name)}">${sanitize(row.name)}</span>
                        <div class="line"><div class="fill fill-blue" style="width:${pct}%"></div></div>
                        <strong class="rank-value">${row.value.toLocaleString()}${sub}</strong>
                    </div>`;
            }).join('');

        const listEl = document.getElementById(listId);
        if (listEl) listEl.innerHTML = rows;
    };

    // Draws a dashed "Now" divider where history ends and the forecast begins,
    // so the trend line's two halves read as distinct at a glance instead of
    // relying on solid-vs-dashed alone.
    const nowDividerPlugin = {
        id: 'nowDivider',
        afterDraw(chart) {
            var index = chart.options.plugins?.nowDivider?.index;
            if (index == null) return;
            var xScale = chart.scales.x;
            var area   = chart.chartArea;
            var x = xScale.getPixelForValue(index);
            if (!isFinite(x)) return;
            var ctx = chart.ctx;
            ctx.save();
            ctx.strokeStyle = '#CBD5E1';
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x, area.top);
            ctx.lineTo(x, area.bottom);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#94A3B8';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Now', x, area.top - 4);
            ctx.restore();
        }
    };

    const buildCharts = (range) => {
        range = range || document.getElementById('range-filter')?.value || 'This Year';
        // Historical mode has no range sub-filter (a closed 2023-2024 period
        // isn't "This Month" of anything) -- it always reads the full
        // Historical-scoped dataset from the server instead of range-slicing
        // state.events client-side.
        var isHistoricalView = state.dataView === 'historical';
        // range only drives client-side event filtering in Current mode (see
        // isHistoricalView guards below) -- in Historical mode it's purely a
        // display label, so it's overridden here rather than left showing
        // whatever the (now hidden) range-filter select last had selected.
        if (isHistoricalView) range = 'Historical Baseline (2023–2024)';

        document.querySelectorAll('.chart-skeleton').forEach((el) => el.remove());
        ['vaccinatedPerBarangayChart', 'predictedAnimalsChart', 'vaccinesNeededList'].forEach((id) => {
            const canvas = document.getElementById(id);
            if (canvas) canvas.style.display = '';
        });

        // ── Live DB barangay totals for this range (used across multiple charts)
        var dbBarangayTotals = isHistoricalView ? {} : getDbBarangayTotals(range);
        var dbGrandTotal     = isHistoricalView ? 0  : getDbGrandTotal(range);
        var hasDbData        = Object.keys(dbBarangayTotals).length > 0;

        // ── Chart 1: Vaccinated per Barangay
        // by_barangay and dbBarangayTotals both read from mass_vaccination_events
        // (the former all-time, the latter scoped to `range`) — they are the same
        // source at different time windows, so they must never be added together.
        // PRIMARY:  dbBarangayTotals, scoped to the selected range
        // FALLBACK: by_barangay all-time totals, when the range has no events yet
        // LAST RESORT: diseaseCasesByBarangay proxy, when there is no DB data at all
        destroyChart('vaccinatedPerBarangay');
        {
            var labels = [], dogsD = [], catsD = [], otherD = [];

            if (hasDbData) {
                Object.keys(dbBarangayTotals).forEach(barangay => {
                    labels.push(barangay);
                    var db = dbBarangayTotals[barangay];
                    dogsD.push(db.dogs); catsD.push(db.cats); otherD.push(db.others);
                });

            } else if (state.vaccinationDataset?.by_barangay?.length) {
                state.vaccinationDataset.by_barangay.forEach(r => {
                    labels.push(r.barangay);
                    dogsD.push(r.dogs_vaccinated);
                    catsD.push(r.cats_vaccinated);
                    otherD.push(r.others_vaccinated);
                });

            } else if (state.dashboardData?.diseaseCasesByBarangay) {
                // Disease proxy fallback — no DB events at all
                state.dashboardData.diseaseCasesByBarangay.forEach(r => {
                    labels.push(r.barangay);
                    dogsD.push(r.actual);
                    catsD.push(Math.round(r.actual * 0.4));
                    otherD.push(Math.round(r.actual * 0.15));
                });
            }

            // Per-species series, straight from whichever source branch ran above.
            // DB events with no species breakdown go into a separate "No breakdown
            // entered" bar rather than being fabricated into dogs/cats/others.
            var mergedDogs    = labels.map((_, i) => dogsD[i]  || 0);
            var mergedCats    = labels.map((_, i) => catsD[i]  || 0);
            var mergedOther   = labels.map((_, i) => otherD[i] || 0);

            // Unspecified = DB total minus the breakdown portion (events with no species data)
            var dbTotalsArr   = labels.map((_, i) => {
                var b = dbBarangayTotals[labels[i]] || {};
                var breakdownSum = (mergedDogs[i] || 0) + (mergedCats[i] || 0) + (mergedOther[i] || 0);
                return Math.max(0, (b.total || 0) - breakdownSum);
            });
            var hasUnspecified = dbTotalsArr.some(v => v > 0);
            // Tracks whether live DB events fed this chart at all - NOT whether any of
            // them lacked a species breakdown. This previously read three arrays that
            // were always 0, so it collapsed into hasUnspecified and the title's live-
            // record note vanished whenever every event was fully encoded.
            var hasLiveData    = hasDbData && dbGrandTotal > 0;

            // Drop barangays with nothing to show (zero in every category —
            // e.g. a placeholder row in the Excel fallback dataset), then sort
            // the rest by grand total, high → low, so the horizontal chart
            // below reads as a ranking instead of showing empty labeled rows.
            var order = labels.map((_, i) => i)
                .filter(i => (mergedDogs[i] + mergedCats[i] + mergedOther[i] + dbTotalsArr[i]) > 0)
                .sort((a, b) =>
                    (mergedDogs[b] + mergedCats[b] + mergedOther[b] + dbTotalsArr[b])
                  - (mergedDogs[a] + mergedCats[a] + mergedOther[a] + dbTotalsArr[a])
                );
            labels      = order.map(i => labels[i]);
            mergedDogs  = order.map(i => mergedDogs[i]);
            mergedCats  = order.map(i => mergedCats[i]);
            mergedOther = order.map(i => mergedOther[i]);
            dbTotalsArr = order.map(i => dbTotalsArr[i]);

            var datasets = [
                { label: 'Dogs',   data: mergedDogs,  backgroundColor: VIZ.dogs,   borderRadius: 4 },
                { label: 'Cats',   data: mergedCats,  backgroundColor: VIZ.cats,   borderRadius: 4 },
                { label: 'Others', data: mergedOther, backgroundColor: VIZ.others, borderRadius: 4 },
            ];
            // Only add Unspecified dataset when there are events without species breakdown
            if (hasUnspecified) {
                datasets.push({
                    label: 'No breakdown entered',
                    data: dbTotalsArr,
                    backgroundColor: VIZ.muted, borderRadius: 4
                });
            }

            var chart1Title = hasLiveData
                ? `Vaccinated per Barangay — ${range} (includes ${dbGrandTotal.toLocaleString()} live records) — highest to lowest`
                : `Vaccinated per Barangay — ${range} — highest to lowest`;

            sizeHorizontalChart('vaccinatedPerBarangayChart', labels.length, 30);
            charts['vaccinatedPerBarangay'] = new Chart(
                document.getElementById('vaccinatedPerBarangayChart'), {
                type: 'bar',
                data: { labels, datasets },
                options: {
                    indexAxis: 'y',
                    responsive: true, maintainAspectRatio: false,
                    scales: {
                        x: { beginAtZero: true, stacked: true, ticks: { color: '#456084' }, grid: { color: '#edf2f9' } },
                        y: { stacked: true, ticks: { color: '#456084', font: { size: 11 } }, grid: { display: false } }
                    },
                    plugins: {
                        legend: { position: 'bottom' },
                        title: { display: true, text: chart1Title, font: { size: 11 }, color: '#456084' }
                    }
                }
            });
        }

        // ── Chart 2: Predicted Number of Animals to be Vaccinated
        // This is a trend-over-time story, so it's one continuous line —
        // solid history, dashed forecast continuation, shaded confidence
        // band — instead of disconnected bar slots per data source/month.
        // SOURCE: Excel monthly history (Combined_Rabies_3Years) + Python ARIMA
        // FALLBACK (ARIMA unreachable): a simple +12%-on-last-month projection
        destroyChart('predictedAnimals');
        {
            var tv = state.arimaData?.total_vaccinated || {};

            var rawMonthly = (state.vaccinationDataset?.by_month || []).slice(-6);
            var monthlyRows = rawMonthly.filter(r =>
                (Number(r.total_vaccinated) || 0) > 0 ||
                (Number(r.dogs_vaccinated)  || 0) > 0 ||
                (Number(r.cats_vaccinated)  || 0) > 0
            );

            var historyLabels = monthlyRows.map(r => (r.month || '').slice(0, 3) + ' ' + String(r.year).slice(-2));
            var historyValues = monthlyRows.map(r => {
                var total = Number(r.total_vaccinated) || 0;
                return total || (Number(r.dogs_vaccinated) || 0) + (Number(r.cats_vaccinated) || 0);
            });

            var forecastLabels, forecastValues, lowerCi, upperCi, usingArima;
            if (tv.forecast?.length) {
                forecastLabels = tv.months || ['Next Month', 'Month 2', 'Month 3'];
                forecastValues = tv.forecast;
                lowerCi = tv.lower_ci || [];
                upperCi = tv.upper_ci || [];
                usingArima = true;
            } else if (historyValues.length) {
                var lastActual = historyValues[historyValues.length - 1] || 0;
                forecastLabels = ['Next Month (est.)'];
                forecastValues = [Math.round(lastActual * 1.12)];
                lowerCi = [lastActual];
                upperCi = [Math.round(lastActual * 1.24)];
                usingArima = false;
            } else {
                forecastLabels = []; forecastValues = []; lowerCi = []; upperCi = [];
                usingArima = false;
            }

            if (!historyLabels.length && !forecastLabels.length) {
                historyLabels = ['No data available'];
                historyValues = [0];
            }

            var c2Labels = historyLabels.concat(forecastLabels);
            var n = c2Labels.length;
            var actualSeries   = new Array(n).fill(null);
            var forecastSeries = new Array(n).fill(null);
            var bandLowerArr   = new Array(n).fill(null);
            var bandUpperArr   = new Array(n).fill(null);

            historyValues.forEach((v, i) => { actualSeries[i] = v; });

            if (forecastLabels.length) {
                // Bridge the dashed forecast line to start exactly where the solid
                // history line ends, so it reads as one continuous trend rather
                // than a disconnected floating segment.
                var bridgeIdx = historyValues.length - 1;
                if (bridgeIdx >= 0) {
                    forecastSeries[bridgeIdx] = historyValues[bridgeIdx];
                    bandLowerArr[bridgeIdx]   = historyValues[bridgeIdx];
                    bandUpperArr[bridgeIdx]   = historyValues[bridgeIdx];
                }
                forecastValues.forEach((v, i) => { forecastSeries[historyValues.length + i] = v; });
                lowerCi.forEach((v, i) => { bandLowerArr[historyValues.length + i] = v; });
                upperCi.forEach((v, i) => { bandUpperArr[historyValues.length + i] = v; });
            }

            var c2Datasets = [
                {
                    label: 'Vaccinated (actual)',
                    data: actualSeries,
                    borderColor: VIZ.dogs,
                    backgroundColor: (ctx) => {
                        var area = ctx.chart.chartArea;
                        if (!area) return 'rgba(47,157,240,0.18)';
                        var gradient = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
                        gradient.addColorStop(0, 'rgba(47,157,240,0.28)');
                        gradient.addColorStop(1, 'rgba(47,157,240,0)');
                        return gradient;
                    },
                    fill: 'origin',
                    borderWidth: 2, pointRadius: 3, pointBackgroundColor: VIZ.dogs,
                    tension: 0, spanGaps: false
                }
            ];

            if (forecastLabels.length) {
                c2Datasets.push({
                    label: 'Forecast',
                    data: forecastSeries,
                    borderColor: VIZ.dogs, backgroundColor: VIZ.dogs,
                    borderWidth: 2, borderDash: [6, 4], pointRadius: 3, pointBackgroundColor: VIZ.dogs,
                    tension: 0, spanGaps: false
                }, {
                    label: 'Likely range',
                    data: bandUpperArr,
                    borderColor: 'transparent', backgroundColor: 'rgba(47,157,240,0.14)',
                    pointRadius: 0, fill: '+1', tension: 0, spanGaps: false
                }, {
                    label: '_lower',
                    data: bandLowerArr,
                    borderColor: 'transparent', backgroundColor: 'transparent',
                    pointRadius: 0, fill: false, tension: 0, spanGaps: false
                });
            }

            var c2Title = usingArima
                ? `Vaccine Demand Trend — next ${forecastLabels.length} month${forecastLabels.length === 1 ? '' : 's'} forecast`
                : (forecastLabels.length
                    ? 'Monthly Trend — Forecast Service Unavailable (simple projection shown)'
                    : 'No historical or forecast data available');

            var dividerIndex = (historyValues.length > 0 && forecastLabels.length > 0)
                ? historyValues.length - 0.5 : null;

            charts['predictedAnimals'] = new Chart(
                document.getElementById('predictedAnimalsChart'), {
                type: 'line',
                data: { labels: c2Labels, datasets: c2Datasets },
                plugins: [nowDividerPlugin],
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, ticks: { color: '#456084' }, grid: { color: '#edf2f9' } },
                        x: { ticks: { color: '#456084' }, grid: { display: false } }
                    },
                    plugins: {
                        legend: { position: 'bottom', labels: { filter: (item) => item.text !== '_lower' } },
                        nowDivider: { index: dividerIndex },
                        title: { display: true, text: c2Title, font: { size: 11 }, color: usingArima ? '#456084' : VIZ.warn }
                    }
                }
            });
        }

        // ── Vaccines Needed per Barangay (ranked list, not a canvas chart —
        //    see renderRankList above)
        // SOURCE: single municipal ARIMA forecast (real per-barangay history is too
        //         sparse to fit independent models), distributed across barangays
        //         by their real historical vaccination share.
        // ADJUSTMENT: When DB events have actual data, boost the ARIMA total by
        //             the ratio of (DB actuals / previous ARIMA forecast) so the
        //             predicted need scales with real-world uptake.
        // FALLBACK: disease-case-derived predicted values, scaled by DB activity ratio
        {
            var tvN   = state.arimaData?.total_vaccinated || {};
            var multi = range === 'Last 3 Months' ? 3 : range === 'This Year' ? 12 : 1;

            // ── Build the full barangay list from ALL available sources ────────────
            // Priority: vaccinationDataset.by_barangay (real all-time DB totals) →
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

                var neededByBarangay = allBarangays.map(b =>
                    Math.round(((barangayBaseMap[b].actual || 0) / totalActual) * adjustedTotal)
                );
                var doneByBarangay = allBarangays.map(b => (dbBarangayTotals[b] || {}).total || 0);

                var c4Title = dbGrandTotal > 0
                    ? `Predicted Vaccine Demand (${range}): ~${Math.round(adjustedTotal).toLocaleString()} needed — highest to lowest`
                    : `Predicted Vaccine Demand (${range}): ~${Math.round(arimaBase).toLocaleString()} vaccines — highest to lowest`;

                renderRankList('vaccinesNeededList', 'vaccinesNeededTitle', c4Title, '#456084',
                    allBarangays, neededByBarangay, doneByBarangay, hasDbData);

            } else {
                // Fallback — RF-predicted values from PHP dashboard (all barangays, no slice)
                var predictedByBarangay = allBarangays.map(b => Math.round((barangayBaseMap[b].predicted || 0) * multi));
                var doneByBarangayFb    = allBarangays.map(b => (dbBarangayTotals[b] || {}).total || 0);

                renderRankList('vaccinesNeededList', 'vaccinesNeededTitle',
                    `Vaccine Demand — ${range} (Estimated — Forecast Unavailable) — highest to lowest`, VIZ.warn,
                    allBarangays, predictedByBarangay, doneByBarangayFb, hasDbData);
            }
        }
    };

    // ── Detail panel ──────────────────────────────────────────────────────
    const setProgress = (el, val, max) => {
        el.style.width = `${Math.max(0, Math.min(100, (val / (max||100)) * 100))}%`;
    };

    // ── Post-event report: Total ↔ species breakdown sync ──────────────────
    // While "Include Breakdown" is on, the species fields are the single
    // source of truth and Total is derived (read-only) from their sum —
    // this makes it impossible for the two numbers to disagree, and
    // impossible to save species counts without them counting toward Total.
    const totalInput  = document.getElementById('total-vaccinated');
    const totalError  = document.getElementById('total-vaccinated-error');
    const dogsInput   = document.getElementById('dogs-count');
    const catsInput   = document.getElementById('cats-count');
    const othersInput = document.getElementById('others-count');

    function distributeEvenly(total) {
        const base = Math.floor(total / 3);
        const remainder = total - base * 3;
        return [base + (remainder > 0 ? 1 : 0), base + (remainder > 1 ? 1 : 0), base];
    }

    function recomputeTotalFromBreakdown() {
        totalInput.value = (Number(dogsInput.value) || 0) + (Number(catsInput.value) || 0) + (Number(othersInput.value) || 0);
    }

    function setBreakdownMode(active) {
        totalInput.readOnly = active;
        if (active) recomputeTotalFromBreakdown();
    }

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
        setBreakdownMode(wb);
        setFieldError(totalInput, totalError, '');

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

    document.getElementById('delete-event-btn')?.addEventListener('click', async () => {
        const activeId = document.getElementById('post-event-form').dataset.activeEventId;
        const e = state.events.find(item => item.id === activeId);
        if (!e) return;
        if (!(await vbConfirm(`Delete the ${e.barangay} – ${e.vaccine} event on ${e.dateLabel}? This cannot be undone.`, 'Delete'))) return;

        try {
            const res = await fetch(MASS_VACC_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete', id: e.rawId })
            });
            const result = await res.json();
            if (!result.success) { await vbAlert(result.message || 'Failed to delete event.'); return; }
        } catch (err) {
            await vbAlert('Failed to delete event.'); return;
        }

        state.events = state.events.filter(item => item.id !== activeId);
        renderTable();
        updateMetrics();
        buildCharts();
        setPanel('dashboard');
    });

    document.getElementById('include-breakdown').addEventListener('change', () => {
        const show = document.getElementById('include-breakdown').checked;
        document.getElementById('species-breakdown').classList.toggle('hidden', !show);
        document.getElementById('species-breakdown').setAttribute('aria-hidden', String(!show));

        if (show) {
            // Seed the species fields from whatever's already in Total — but only
            // if they're still empty, so re-checking never clobbers values the
            // vet already entered (e.g. after unchecking and checking again).
            const speciesSum   = (Number(dogsInput.value) || 0) + (Number(catsInput.value) || 0) + (Number(othersInput.value) || 0);
            const existingTotal = Number(totalInput.value) || 0;
            if (speciesSum === 0 && existingTotal > 0) {
                const [d, c, o] = distributeEvenly(existingTotal);
                dogsInput.value = d; catsInput.value = c; othersInput.value = o;
            }
        }
        setBreakdownMode(show);
    });

    // Live-recompute Total whenever a species field changes, while breakdown mode is active.
    [dogsInput, catsInput, othersInput].forEach((input) => {
        input.addEventListener('input', () => {
            if (document.getElementById('include-breakdown').checked) recomputeTotalFromBreakdown();
        });
    });

    document.getElementById('post-event-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const activeId = document.getElementById('post-event-form').dataset.activeEventId;
        const e = state.events.find(item => item.id === activeId);
        if (!e) return;

        const includeBreakdown = document.getElementById('include-breakdown').checked;
        if (includeBreakdown) recomputeTotalFromBreakdown();

        const total = Number(totalInput.value || 0);
        if (total <= 0) {
            setFieldError(totalInput, totalError, includeBreakdown
                ? 'Dogs + Cats + Others must add up to more than 0.'
                : 'Total Pets Vaccinated must be greater than 0.');
            return;
        }
        setFieldError(totalInput, totalError, '');

        e.totalVaccinated = total;
        e.breakdown = includeBreakdown
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
            await vbAlert('Failed to save report.'); return;
        }

        // Re-render everything with fresh state — charts now pick up the new totals
        renderTable();
        updateMetrics();
        buildCharts();
        hydrateDetail(e.id);
        await vbAlert('Vaccination report saved.');
    });

    const dateInput        = document.getElementById('event-date');
    const dateError         = document.getElementById('date-error');
    const barangaySelect    = document.getElementById('event-barangay');
    const barangayTrigger   = document.getElementById('barangay-trigger');
    const barangayError     = document.getElementById('barangay-error');
    const vaccineSelect     = document.getElementById('event-vaccine');
    const addVaccineTypeBtn = document.getElementById('add-vaccine-type-btn');

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

    // Vaccine Type options come from the shared VaccineTypes registry
    // (defaults to Anti-Rabies only; grows as staff add new types).
    function rebuildVaccineOptions(selectValue) {
        const types = window.VaccineTypes?.getAll ? window.VaccineTypes.getAll() : ['Anti-Rabies'];
        const previous = selectValue ?? vaccineSelect.value;
        vaccineSelect.innerHTML = types.map((t) => `<option>${t}</option>`).join('');
        vaccineSelect.value = types.includes(previous) ? previous : types[0];
        vaccineSelectUI?.syncLabel();
    }

    rebuildVaccineOptions();

    // ── Add Vaccination Type modal ─────────────────────────────────
    const addVaccineTypeModal = document.getElementById('add-vaccine-type-modal');
    const addVaccineTypeForm  = document.getElementById('add-vaccine-type-form');
    const newVaccineTypeInput = document.getElementById('new-vaccine-type-input');
    const newVaccineTypeError = document.getElementById('new-vaccine-type-error');

    const openAddVaccineTypeModal = () => {
        addVaccineTypeForm.reset();
        setFieldError(newVaccineTypeInput, newVaccineTypeError, '');
        addVaccineTypeModal.classList.remove('hidden');
        newVaccineTypeInput.focus();
    };
    const closeAddVaccineTypeModal = () => {
        addVaccineTypeModal.classList.add('hidden');
    };

    addVaccineTypeBtn?.addEventListener('click', openAddVaccineTypeModal);
    document.getElementById('close-add-vaccine-type').addEventListener('click', closeAddVaccineTypeModal);
    document.getElementById('cancel-add-vaccine-type').addEventListener('click', closeAddVaccineTypeModal);
    addVaccineTypeModal.addEventListener('click', (e) => {
        if (e.target === addVaccineTypeModal) closeAddVaccineTypeModal();
    });

    addVaccineTypeForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const result = window.VaccineTypes?.add
            ? window.VaccineTypes.add(newVaccineTypeInput.value)
            : { ok: false, error: 'Vaccine type registry unavailable.' };
        if (!result.ok) {
            setFieldError(newVaccineTypeInput, newVaccineTypeError, result.error || 'Could not add that vaccination type.');
            return;
        }
        rebuildVaccineOptions(result.value);
        closeAddVaccineTypeModal();
    });

    const openModal  = () => {
        dateInput.min = todayIso();
        // No event is planned more than a year out — past this is a typo.
        const horizon = new Date();
        horizon.setFullYear(horizon.getFullYear() + 1);
        dateInput.max = horizon.toISOString().slice(0, 10);
        rebuildVaccineOptions();
        document.getElementById('create-event-modal').classList.remove('hidden');
    };
    const closeModal = () => {
        document.getElementById('create-event-modal').classList.add('hidden');
        document.getElementById('create-event-form').reset();
        setFieldError(dateInput, dateError, '');
        setFieldError(barangayTrigger, barangayError, '');
        barangaySelectUI?.syncLabel();
        rebuildVaccineOptions();
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

        if (hasError) return;

        const fd = new FormData(document.getElementById('create-event-form'));
        const vaccineValue = fd.get('vaccine');

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
            else { await vbAlert(result.message || 'Failed to create event.'); return; }

            renderTable();
            updateMetrics();
            buildCharts();
            closeModal();
            showEventSummary(result.data);
        } catch (err) { await vbAlert('Failed to create event.'); return; }
    });

    document.getElementById('range-filter')?.addEventListener('change', e => buildCharts(e.target.value));

    document.getElementById('data-view-filter')?.addEventListener('change', async (e) => {
        state.dataView = e.target.value === 'current' ? 'current' : 'historical';
        applyDataViewVisibility();
        renderSkeletons();
        await loadVaccinationDataset();
        updateMetrics();
        // renderSkeletons() just overwrote the placeholder - and the ARIMA card
        // lives inside it - so the card has to be rebuilt or the view toggle
        // leaves a skeleton where the KPIs were. The forecast itself is
        // municipality-wide and not scoped to the data view, so no refetch.
        renderArimaCard();
        buildCharts();
    });

    function applyDataViewVisibility() {
        const rangeEl = document.getElementById('range-filter');
        // Historical is a closed period -- This Month/Last 3 Months/This Year
        // don't apply to it, so the range sub-filter only shows in Current.
        if (rangeEl) rangeEl.hidden = state.dataView === 'historical';
    }

    // ── Init ──────────────────────────────────────────────────────────────
    renderSkeletons();
    applyDataViewVisibility();
    await Promise.all([loadEvents(), loadArimaForecast(), loadDashboardData(), loadVaccinationDataset()]);

    renderTable();
    updateMetrics();
    setPanel('dashboard');
    closeModal();
    renderArimaCard();
    buildCharts();
    populateBarangayDropdown();
});

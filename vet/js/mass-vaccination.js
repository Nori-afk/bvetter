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
        monthStatuses:      [],   // explicit confirmation that past months are fully entered
        arimaData:          null, // from Python ARIMA service
        barangayForecast:   null, // municipal ARIMA split by observed shares or dog-population weights
        dashboardData:      null, // from PHP vet_dashboard (Excel summary)
        vaccinationDataset: null, // from PHP mass_vaccination_dataset, scoped to state.dataView
        // Workbook baseline retained to populate the historical year selector;
        // the forecast chart now uses only the fitted series returned by ARIMA.
        forecastBaseline:   null,
        eventTablePage:     1,
        eventTableSortKey:  'date',
        eventTableSortDirection: 'desc',
        pendingOnly:        false,
        // 'historical' = frozen pre-2025 baseline (Excel + the 2023-2024 rows
        // already sitting in mass_vaccination_events -- training data either
        // way). 'current' = live mass_vaccination_events rows dated 2025+.
        // See MASS_VACC_CURRENT_CUTOFF in dashboard.php for the exact split.
        dataView:           'historical',
        // Which workbook year the Historical monthly chart shows. Default to
        // the most recent workbook year so the first view matches the latest
        // figures the manuscript discusses.
        historicalYear:     '2025',
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
    const formatVaccinationMonth = (period) => {
        const parts = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
        if (!parts || Number(parts[2]) < 1 || Number(parts[2]) > 12) return '';
        return new Date(Number(parts[1]), Number(parts[2]) - 1, 1)
            .toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
    };
    const forecastPlanningNote = (forecast) => {
        const latestMonth = formatVaccinationMonth(forecast.current_period);
        const basis = latestMonth
            ? `Based on vaccination records through ${latestMonth}.`
            : 'Based on the available vaccination records.';
        return forecast.forecast_status === 'long_gap_estimate'
            ? `${basis} Recent monthly records are missing, so use these figures as a rough planning guide. Add and confirm recent monthly records to update the estimates.`
            : `${basis} These figures are estimates for planning; actual doses may differ.`;
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
        getFilteredEvents(range).filter(e => e.status === 'Completed').forEach(function(e) {
            if (!e.barangay) return;

            var dogs   = Number(e.breakdown?.dogs)   || 0;
            var cats   = Number(e.breakdown?.cats)   || 0;
            var others = Number(e.breakdown?.others) || 0;
            var hasBreakdown = dogs > 0 || cats > 0 || others > 0;

            // The recorded combined total is authoritative; use a species sum
            // only for older rows where no combined total was saved.
            var tv = Number(e.totalVaccinated) || 0;
            if (tv === 0 && hasBreakdown) tv = dogs + cats + others;

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
        return getFilteredEvents(range).filter(e => e.status === 'Completed').reduce(function(sum, e) {
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
            state.monthStatuses = Array.isArray(result.monthStatuses) ? result.monthStatuses : [];
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
        // state.arimaData stays null; no other algorithm is presented as ARIMA.
    };

    // SOURCE: Python ARIMA — municipal vaccination forecast allocated to each
    // barangay by Barangay_Masterlist allocation_weight. This is the chart that
    // answers the manuscript's Q2.2; it is not a disease-case proxy and it is
    // not 27 independently-fitted ARIMA models.
    const loadBarangayForecast = async () => {
        try {
            if (window.VetAPI?.getVaccinationBarangayForecast) {
                const res = await window.VetAPI.getVaccinationBarangayForecast(1);
                if (res?.ok && Array.isArray(res.data)) {
                    state.barangayForecast = res.data;
                    return;
                }
            }
        } catch (err) {
            console.warn('VetAPI barangay vaccination forecast failed, trying PHP proxy:', err);
        }

        try {
            const res = await fetch(`${DASHBOARD_API}?scope=vaccination_forecast_barangay`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ steps: 1, metric: 'total_vaccinated' })
            });
            const result = await res.json();
            if (result.success && Array.isArray(result.data)) {
                state.barangayForecast = result.data;
                return;
            }
            console.warn('Barangay vaccination forecast proxy returned no data:', result);
        } catch (err) {
            console.warn('Barangay vaccination forecast unavailable:', err);
        }
        state.barangayForecast = null;
    };

    const refreshVaccinationForecasts = async () => {
        await Promise.all([loadArimaForecast(), loadBarangayForecast()]);
        renderArimaCard();
        buildCharts();
    };

    const refreshEventViews = async () => {
        await loadEvents();
        renderTable();
        updateMetrics();
        populateBarangayDropdown();
        renderMonthCompletenessControl();
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
            if (res.ok && res.data) {
                state.vaccinationDataset = res.data;
                // The default view is historical, so this normally captures the
                // baseline with no extra request.
                if (state.dataView === 'historical' && !state.forecastBaseline) {
                    state.forecastBaseline = res.data;
                }
            }
        } catch (err) {
            console.warn('Vaccination dataset unavailable:', err);
        }
    };

    // Guarantees Chart 2 has a view-independent history fallback even if the page
    // never loads the historical view (e.g. if the default changes later). No-ops
    // when loadVaccinationDataset() already captured it, which is the normal path.
    const loadForecastBaseline = async () => {
        if (state.forecastBaseline) return;
        try {
            const fetchFn = window.VetAPI?.getMassVaccinationDataset
                ? () => window.VetAPI.getMassVaccinationDataset('historical')
                : () => fetch(`${DASHBOARD_API}?scope=mass_vaccination_dataset&data_view=historical`)
                    .then(r => r.json()).then(r => ({ ok: r.success, data: r.data }));
            const res = await fetchFn();
            if (res.ok && res.data) state.forecastBaseline = res.data;
        } catch (err) {
            console.warn('Forecast baseline unavailable:', err);
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

        const allEvents = state.events || [];
        const thisYear = new Date().getFullYear();
        const eventsThisYear = allEvents.filter(function(e) {
            var d = e.date ? new Date(e.date + 'T00:00:00') : null;
            return d && !isNaN(d.getTime()) && d.getFullYear() === thisYear;
        });

        // Work queue and completed-dose KPIs always use the live database,
        // independent of the chart's Historical/Current selector.
        const pending   = allEvents.filter(e => e.status === 'Pending Report').length;
        const pendingThisYear   = eventsThisYear.filter(e => e.status === 'Pending Report').length;
        const completedThisYear = eventsThisYear.length - pendingThisYear;
        if (pendingEl) pendingEl.textContent = pending;
        if (totalEl)   totalEl.textContent   = eventsThisYear.length || '-';

        // These captions were left as permanent loading-skeleton placeholders
        // before — renderSkeletons() blanks them out, but nothing ever put
        // real text back in for these three cards.
        const totalNoteEl = totalEl?.nextElementSibling;
        if (totalNoteEl) totalNoteEl.textContent = eventsThisYear.length
            ? `${completedThisYear} completed, ${pendingThisYear} pending`
            : 'No events recorded yet';

        const pendingNoteEl = pendingEl?.nextElementSibling;
        if (pendingNoteEl) pendingNoteEl.textContent = pending > 0 ? 'Events awaiting data' : 'All caught up';

        const completedEvents = allEvents.filter(e => e.status === 'Completed');
        const dbTotal = completedEvents.reduce((s, e) => {
            var tv = Number(e.totalVaccinated) || 0;
            if (tv === 0 && e.breakdown) {
                tv = (Number(e.breakdown.dogs) || 0)
                   + (Number(e.breakdown.cats) || 0)
                   + (Number(e.breakdown.others) || 0);
            }
            return s + tv;
        }, 0);

        if (petsEl) {
            petsEl.textContent = dbTotal > 0 ? dbTotal.toLocaleString() : '-';
            const petsNoteEl = petsEl.nextElementSibling;
            if (petsNoteEl) petsNoteEl.textContent = 'All years · completed live reports';
        }

        // Most active means completed doses, all years in the live DB.
        const barangayTotals = {};
        completedEvents.forEach(e => {
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
            .sort((a, b) => barangayTotals[b] - barangayTotals[a] || a.localeCompare(b))[0];
        if (barangayEl) barangayEl.textContent = topBarangay || '-';

        const barangayNoteEl = barangayEl?.nextElementSibling;
        if (barangayNoteEl) barangayNoteEl.textContent = topBarangay
            ? `${barangayTotals[topBarangay].toLocaleString()} pets vaccinated`
            : 'No completed reports yet';

    };

    // ── Table (DB source) ─────────────────────────────────────────────────
    const renderTable = () => {
        const tableBody = document.getElementById('event-table-body');
        const footer    = document.getElementById('event-table-footer');

        const filteredRows = state.pendingOnly
            ? state.events.filter(e => e.status === 'Pending Report')
            : state.events;
        const sortKey = state.eventTableSortKey || 'date';
        const sortDirection = state.eventTableSortDirection === 'asc' ? 1 : -1;
        const rows = filteredRows.slice().sort((a, b) => {
            let comparison = 0;
            if (sortKey === 'totalVaccinated') {
                const aBlank = a.totalVaccinated === '' || a.totalVaccinated == null;
                const bBlank = b.totalVaccinated === '' || b.totalVaccinated == null;
                if (aBlank !== bBlank) return aBlank ? 1 : -1;
                comparison = (Number(a.totalVaccinated) || 0) - (Number(b.totalVaccinated) || 0);
            } else {
                comparison = String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''), undefined, {
                    numeric: sortKey === 'date',
                    sensitivity: 'base'
                });
            }
            if (comparison !== 0) return comparison * sortDirection;
            return String(b.date || '').localeCompare(String(a.date || ''));
        });
        const heading = document.getElementById('event-table-heading');
        const showAll = document.getElementById('show-all-events');
        const filterRow = document.querySelector('.table-filter-row');
        if (heading) heading.textContent = state.pendingOnly ? 'Pending Vaccination Reports' : 'Recent Vaccination Events';
        if (showAll) showAll.hidden = !state.pendingOnly;
        if (filterRow) filterRow.hidden = !state.pendingOnly;

        document.querySelectorAll('#event-table-card thead button[data-event-sort]').forEach((button) => {
            const active = button.dataset.eventSort === sortKey;
            const direction = active ? state.eventTableSortDirection : null;
            const header = button.closest('th');
            if (header) header.setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
            const indicator = button.querySelector('.event-sort-indicator');
            if (indicator) indicator.textContent = active ? (direction === 'asc' ? '↑' : '↓') : '↕';
            button.setAttribute('aria-label', `${button.textContent.trim().replace(/[↑↓↕]/g, '').trim()}, ${active ? `sorted ${direction === 'asc' ? 'ascending' : 'descending'}` : 'not sorted'}; activate to sort`);
        });

        const pageSize   = pageSizeForViewport();
        const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
        state.eventTablePage = Math.min(Math.max(1, state.eventTablePage), totalPages);
        const start     = (state.eventTablePage - 1) * pageSize;
        const pageRows  = rows.slice(start, start + pageSize);

        tableBody.innerHTML = pageRows.length ? pageRows.map(e => `
            <tr data-event-id="${sanitize(e.id)}">
                <td data-label="Date">${sanitize(e.dateLabel)}</td>
                <td data-label="Barangay">${sanitize(e.barangay)}</td>
                <td data-label="Vaccine">${sanitize(e.vaccine)}</td>
                <td data-label="Total Vaccinated">${formatNumber(e.totalVaccinated)}</td>
                <td data-label="Status"><span class="status-pill ${statusClass(e.status)}">${sanitize(e.status)}</span></td>
            </tr>
        `).join('') : `<tr><td colspan="5" class="table-empty">${state.pendingOnly ? 'No pending reports.' : 'No vaccination events have been recorded.'}</td></tr>`;

        if (!footer) return;
        if (totalPages <= 1 && !rows.length) { footer.innerHTML = ''; return; }
        if (totalPages <= 1) {
            footer.innerHTML = `<div class="report-footer"><p>Displaying ${pageRows.length} of ${rows.length} Records</p></div>`;
            return;
        }
        footer.innerHTML = `
            <div class="report-footer">
                <p>Displaying ${pageRows.length} of ${rows.length} Records</p>
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
        if (!Array.isArray(state.arimaData?.total_vaccinated?.forecast)
            || state.arimaData.total_vaccinated.forecast.length === 0) {
            var emptyHost = document.getElementById('arima-card-placeholder');
            var unavailableData = state.arimaData?.total_vaccinated || {};
            var unavailableNote = state.arimaData?.total_vaccinated
                ? 'An estimate could not be created from the available records. Check the monthly vaccination records and try again.'
                : 'The forecast could not be loaded. Refresh the page to try again.';
            var staleHistory = unavailableData.forecast_status === 'stale_history';
            var latestPeriodLabel = formatVaccinationMonth(unavailableData.current_period);
            var staleNote = staleHistory
                ? `${latestPeriodLabel ? `Records are available through ${latestPeriodLabel}. ` : ''}Add and confirm recent monthly records to get an updated estimate.`
                : unavailableNote;
            if (emptyHost) emptyHost.innerHTML = `
                <section class="card mv-arima-card" id="arima-vacc-card">
                    <div class="mv-arima-header">
                        <div>
                            <span class="mv-arima-badge" style="background:#F1F5F9;color:#64748B;">Forecast Unavailable</span>
                            <h3 class="mv-arima-title">Vaccine Demand Forecast</h3>
                            <p class="mv-arima-desc">${sanitize(staleNote)}</p>
                        </div>
                    </div>
                </section>`;
            return;
        }

        var tv   = state.arimaData.total_vaccinated || {};

        const trend    = (tv.trend || 'stable').toLowerCase();
        const trendCls = trend === 'rising' ? 'mv-trend-rising' : trend === 'falling' ? 'mv-trend-falling' : 'mv-trend-stable';
        const modelLabel = Array.isArray(tv.arima_order) ? `ARIMA(${tv.arima_order.join(',')})` : 'Plain ARIMA';
        const estimateLabel = tv.forecast_status === 'long_gap_estimate'
            ? 'Estimate from older records' : 'Estimated doses';

        const months = tv.forecast_periods || tv.months || ['Next Month', 'Month 2', 'Month 3'];
        const hasValidatedInterval = tv.interval_status === 'validated_80'
            && Array.isArray(tv.lower_ci) && Array.isArray(tv.upper_ci);

        var card = document.createElement('section');
        card.id        = 'arima-vacc-card';
        card.className = 'card mv-arima-card';
        card.innerHTML = `
            <div class="mv-arima-header">
                <div>
                    <span class="mv-arima-badge">${sanitize(modelLabel)} · Combined Doses</span>
                    <h3 class="mv-arima-title">Vaccine Demand Forecast</h3>
                    <p class="mv-arima-desc">${sanitize(tv.action || 'Demand forecast based on historical vaccination data.')}</p>

                </div>
                <div class="mv-trend-pill ${trendCls}">Overall Trend: ${trend.toUpperCase()}</div>
            </div>
            <div class="mv-forecast-section">
                    <p class="mv-section-label">Monthly dose forecast</p>
                <div class="mv-fc-grid">
                    ${months.map((m, i) => `
                        <div class="mv-fc-card">
                            <span class="mv-fc-label">${sanitize(m)}</span>
                            <span class="mv-fc-val">${Math.round(Number(tv.forecast?.[i]) || 0).toLocaleString()}</span>
                            ${hasValidatedInterval ? `<span class="mv-fc-range">${Math.round(Number(tv.lower_ci[i]) || 0).toLocaleString()} – ${Math.round(Number(tv.upper_ci[i]) || 0).toLocaleString()}</span>
                            <span class="mv-fc-ci">Estimated range (80%)</span>` : `<span class="mv-fc-ci">${sanitize(estimateLabel)}</span>`}
                        </div>
                    `).join('')}
                </div>
                <p class="mv-range-note">${sanitize(forecastPlanningNote(tv))}</p>
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
    // Shows an explicit "nothing to plot" panel in place of a chart. Used when a
    // chart genuinely has no data, so it never falls back to a fabricated series
    // just to keep the canvas populated. Pass an empty message to clear it.
    const setChartEmptyState = (canvasId, message) => {
        const canvas = document.getElementById(canvasId);
        const inner  = canvas?.closest('.chart-scroll-inner') || canvas?.parentElement;
        if (!canvas || !inner) return;
        let panel = inner.querySelector('.chart-empty');
        if (!message) {
            if (panel) panel.remove();
            canvas.style.display = '';
            return;
        }
        canvas.style.display = 'none';
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'chart-empty';
            panel.style.cssText = 'display:flex;align-items:center;justify-content:center;'
                + 'height:100%;min-height:200px;padding:24px;text-align:center;'
                + 'font-size:12px;line-height:1.6;color:#64748B;';
            inner.appendChild(panel);
        }
        panel.textContent = message;
    };

    const sizeHorizontalChart = (canvasId, rowCount, rowHeight) => {
        const canvas = document.getElementById(canvasId);
        const inner  = canvas?.closest('.chart-scroll-inner');
        if (inner) inner.style.height = Math.max(220, rowCount * (rowHeight || 30)) + 'px';
    };

    // Renders a sorted meter-bar ranking (reuses the .line/.fill component from
    // the event-detail comparison card) instead of a canvas chart — a visually
    // distinct way to show "many categories, highest to lowest" so it doesn't
    // just look like a second copy of the barangay bar chart above it.
    const renderRankList = (listId, titleId, titleText, titleColor, entries, actualLabel, actualAvailable, emptyMessage) => {
        const titleEl = document.getElementById(titleId);
        if (titleEl) { titleEl.textContent = titleText; titleEl.style.color = titleColor; }

        const maxVal = Math.max(1, ...entries.map((entry) => Number(entry.forecast) || 0));
        const rows = entries
            .filter((row) => (Number(row.forecast) > 0) || (actualAvailable && row.actual > 0))
            .sort((a, b) => (Number(b.forecast) || 0) - (Number(a.forecast) || 0) || a.name.localeCompare(b.name))
            .map((row) => {
                const hasForecast = row.forecast !== null && row.forecast !== undefined
                    && Number.isFinite(Number(row.forecast));
                const forecast = hasForecast ? Math.max(0, Number(row.forecast)) : 0;
                const pct = Math.max(2, Math.round((forecast / maxVal) * 100));
                const actual = actualAvailable
                    ? `<small>${sanitize(actualLabel)} recorded: ${Math.round(row.actual || 0).toLocaleString()}</small>`
                    : '<small>Last month not confirmed yet</small>';
                return `
                    <div class="rank-row">
                        <span class="rank-name" title="${sanitize(row.name)}">${sanitize(row.name)}</span>
                        <div class="line"><div class="fill fill-blue" style="width:${pct}%"></div></div>
                        <strong class="rank-value">${hasForecast ? `Estimate: ${Math.round(forecast).toLocaleString()}` : 'Estimate unavailable'}${actual}</strong>
                    </div>`;
            }).join('');

        const listEl = document.getElementById(listId);
        if (listEl) listEl.innerHTML = rows || `<p class="rank-empty">${sanitize(emptyMessage || 'No barangay forecast is available yet.')}</p>`;
    };

    const normalizeBarangayName = (name) => String(name || '').normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();

    const lastClosedMonth = () => {
        const date = new Date();
        date.setDate(1);
        date.setMonth(date.getMonth() - 1);
        return { year: date.getFullYear(), month: date.getMonth() + 1 };
    };

    const monthStatus = (year, month) => (state.monthStatuses || []).find((item) =>
        Number(item.year) === Number(year) && Number(item.month) === Number(month)
    );

    const renderMonthCompletenessControl = () => {
        const input = document.getElementById('month-completeness-month');
        const button = document.getElementById('month-completeness-toggle');
        const statusEl = document.getElementById('month-completeness-status');
        if (!input || !button || !statusEl) return;
        const current = new Date();
        const currentKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
        const previous = lastClosedMonth();
        const previousKey = `${previous.year}-${String(previous.month).padStart(2, '0')}`;
        input.min = '2026-01';
        input.max = previousKey;
        if (previousKey < input.min) {
            input.value = '';
            statusEl.textContent = 'You can confirm a month after it has ended.';
            button.textContent = 'Confirm month';
            button.disabled = true;
            return;
        }
        if (!input.value || input.value > previousKey || input.value < input.min) input.value = previousKey;

        const [year, month] = input.value.split('-').map(Number);
        const validPastMonth = Number.isFinite(year) && Number.isFinite(month)
            && input.value >= input.min && input.value < currentKey;
        const saved = validPastMonth ? monthStatus(year, month) : null;
        const markedComplete = Boolean(saved?.complete);
        statusEl.textContent = !validPastMonth
            ? 'Choose a past month from January 2026 onward.'
            : markedComplete
                ? `Records confirmed${saved.completedAt ? ` on ${new Date(saved.completedAt.replace(' ', 'T')).toLocaleDateString()}` : ''}. Adding or editing an event reopens this month.`
                : 'Not confirmed. The forecast skips this month until its records are complete.';
        button.textContent = markedComplete ? 'Reopen month' : 'Confirm month';
        button.dataset.complete = markedComplete ? 'false' : 'true';
        button.disabled = !validPastMonth;
    };

    const previousMonthActuals = () => {
        const { year, month } = lastClosedMonth();
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        if (!monthStatus(year, month)?.complete) {
            return { available: false, label: '', totals: {} };
        }
        const totals = {};
        const labels = {};
        (state.events || []).forEach((event) => {
            if (event.status !== 'Completed' || !String(event.date || '').startsWith(prefix) || !event.barangay) return;
            let count = Number(event.totalVaccinated) || 0;
            if (count === 0 && event.breakdown) {
                count = (Number(event.breakdown.dogs) || 0)
                    + (Number(event.breakdown.cats) || 0)
                    + (Number(event.breakdown.others) || 0);
            }
            const key = normalizeBarangayName(event.barangay);
            totals[key] = (totals[key] || 0) + count;
            if (!labels[key]) labels[key] = event.barangay;
        });
        const label = new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
        return { available: true, label, totals, names: labels };
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
        // NO THIRD SOURCE: this used to fall back to the diseaseCasesByBarangay
        // proxy, deriving dogs from disease case counts and inventing cats as
        // actual * 0.4 and others as actual * 0.15. That is fabricated data on a
        // surveillance chart, and once the seeded 2023-24 events were deleted it
        // would have silently filled the Historical view with it. An empty chart
        // that says why is the correct output when there is nothing to plot.
        destroyChart('vaccinatedPerBarangay');
        {
            var labels = [], dogsD = [], catsD = [], otherD = [];

            // Historical Baseline plots the workbook's own MONTHLY series, not
            // barangays. The workbook records municipality-wide monthly figures
            // and carries no per-barangay vaccination breakdown at all, so the
            // honest thing to show for that period is the real monthly data
            // rather than an empty card or a per-barangay estimate presented as
            // if it were measured. Chronological, never sorted by size.
            var isMonthlySeries = isHistoricalView;

            // The card is titled "per Barangay" in the markup; the historical view
            // plots months, so the heading has to follow what is actually drawn.
            var vaccHeading = document.getElementById('vaccChartHeading');
            if (vaccHeading) {
                vaccHeading.textContent = isMonthlySeries
                    ? 'Workbook values as entered'
                    : 'Pets Vaccinated per Barangay';
            }

            if (isMonthlySeries) {
                var yearPick = state.historicalYear;
                (state.vaccinationDataset?.by_month_as_recorded || []).filter(r =>
                    yearPick === 'all' || String(r.year) === String(yearPick)
                ).forEach(r => {
                    var monthName = String(r.month || '').slice(0, 3);
                    var yearShort = String(r.year || '').slice(-2);
                    labels.push(`${monthName} ${yearShort}`);
                    dogsD.push(Number(r.dogs_vaccinated) || 0);
                    catsD.push(Number(r.cats_vaccinated) || 0);
                    otherD.push(0);
                });

            } else if (hasDbData) {
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
            // A monthly series must stay in calendar order -- ranking it by size
            // would scramble the timeline into a meaningless bar list. Zero months
            // are kept too, because "no campaign that month" is real information.
            var order = isMonthlySeries
                ? labels.map((_, i) => i)
                : labels.map((_, i) => i)
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
            // Drop any series that is entirely zero, so the workbook's monthly view
            // does not carry an "Others" legend entry it has no column for. Guarded:
            // if that would empty the chart, keep the original set.
            var nonEmpty = datasets.filter(ds => ds.data.some(v => (Number(v) || 0) > 0));
            if (nonEmpty.length) datasets = nonEmpty;

            // Only add Unspecified dataset when there are events without species breakdown
            if (hasUnspecified) {
                datasets.push({
                    label: 'No breakdown entered',
                    data: dbTotalsArr,
                    backgroundColor: VIZ.muted, borderRadius: 4
                });
            }

            var chart1Title = isMonthlySeries
                ? (state.historicalYear === '2025'
                    ? '2025 doses by month — whole municipality'
                    : state.historicalYear === 'all'
                        ? '2023–24 values may be running totals; 2025 values are monthly doses'
                        : `${state.historicalYear} workbook values as entered — some may be running totals`)
                : hasLiveData
                    ? `Vaccinated per Barangay — ${range} (includes ${dbGrandTotal.toLocaleString()} live records) — highest to lowest`
                    : `Vaccinated per Barangay — ${range} — highest to lowest`;

            // if/else rather than an early return: this is a bare block inside
            // buildCharts(), so returning here would skip Charts 2 and 3 as well.
            if (!labels.length) {
                sizeHorizontalChart('vaccinatedPerBarangayChart', 0, 30);
                setChartEmptyState('vaccinatedPerBarangayChart', isMonthlySeries
                    ? 'No monthly vaccination figures were found in the Baliwag workbook.'
                    : `No vaccination events have been encoded for ${range} yet. `
                      + 'Barangay bars appear here once an event is recorded and marked completed.');
            } else {
                setChartEmptyState('vaccinatedPerBarangayChart', '');
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
        }

        // ── Chart 2: Predicted Number of Animals to be Vaccinated
        // This is a trend-over-time story, so it's one continuous line —
        // solid history, dashed forecast continuation, shaded confidence
        // band — instead of disconnected bar slots per data source/month.
        // SOURCE: exact monthly series fitted by Python + plain ARIMA forecast.
        // Missing months remain gaps; an unavailable ARIMA is not replaced with
        // a different prediction model.
        destroyChart('predictedAnimals');
        {
            var tv = state.arimaData?.total_vaccinated || {};

            // This chart deliberately IGNORES the Historical/Current selector.
            // Its history used to come from by_month, which follows that selector,
            // while the forecast came from the analytics service, which does not --
            // so Current view drew two live months (100, 100) beneath a forecast
            // fitted on 36 months of workbook data it wasn't showing. The service
            // now returns the exact series it fitted, so the two halves of this
            // chart cannot disagree. Chart 1 and the KPI cards still follow the
            // selector; this one answers "what did the model see, and what does it
            // predict next", which is the same question in either view.
            var MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            var fittedHistory = state.arimaData?.history || [];

            var historyLabels = [], historyValues = [];
            if (fittedHistory.length) {
                historyLabels = fittedHistory.map(h => {
                    var parts = String(h.period || '').split('-');
                    var monthIdx = (parseInt(parts[1], 10) || 1) - 1;
                    return `${MONTH_ABBR[monthIdx] || '?'} ${String(parts[0] || '').slice(-2)}`;
                });
                historyValues = fittedHistory.map(h => h.value === null || h.value === undefined || h.value === ''
                    ? null : (Number.isFinite(Number(h.value)) ? Number(h.value) : null));
            }

            var forecastLabels, forecastValues, lowerCi, upperCi, usingArima;
            if (tv.forecast?.length) {
                forecastLabels = tv.forecast_periods || tv.months || ['Next Month', 'Month 2', 'Month 3'];
                forecastValues = tv.forecast;
                lowerCi = tv.interval_status === 'validated_80' ? (tv.lower_ci || []) : [];
                upperCi = tv.interval_status === 'validated_80' ? (tv.upper_ci || []) : [];
                usingArima = true;
            } else {
                forecastLabels = []; forecastValues = []; lowerCi = []; upperCi = [];
                usingArima = false;
            }

            if (!historyLabels.length && !forecastLabels.length) {
                historyLabels = ['No data available'];
                historyValues = [null];
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
                }
                forecastValues.forEach((v, i) => { forecastSeries[historyValues.length + i] = v; });
                lowerCi.forEach((v, i) => { bandLowerArr[historyValues.length + i] = v; });
                upperCi.forEach((v, i) => { bandUpperArr[historyValues.length + i] = v; });
            }

            var c2Datasets = [
                {
                    label: 'Observed monthly total',
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
                });
                if (tv.interval_status === 'validated_80' && lowerCi.length && upperCi.length) c2Datasets.push({
                    label: '80% range',
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

            var longRangeEstimate = tv.forecast_status === 'long_gap_estimate';
            var c2Title = usingArima
                ? `Combined vaccine doses — plain ARIMA${longRangeEstimate ? ' provisional long-range estimate' : ' forecast'}${tv.interval_status === 'validated_80' ? ' with backtest-supported 80% range' : ''}`
                : 'ARIMA forecast unavailable — no substitute model shown';

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

        // The municipal ARIMA forecast is allocated once by the API. It uses
        // complete live vaccination shares only after the agreed coverage rule
        // passes; otherwise the API falls back to estimated dog-population weights.
        // The actual comparison is the previous calendar month and appears only
        // after staff have signed that month off as fully entered.
        {
            const forecastRows = Array.isArray(state.barangayForecast) ? state.barangayForecast : [];
            const actuals = previousMonthActuals();
            const vaccinationForecast = state.arimaData?.total_vaccinated || {};
            const forecastWithheld = vaccinationForecast.forecast_status === 'stale_history';
            const longRangeEstimate = vaccinationForecast.forecast_status === 'long_gap_estimate';
            const method = forecastRows[0]?.allocation_method === 'completed_vaccination_shares'
                ? 'each barangay’s share of past doses'
                : 'estimated dog counts in each barangay';
            const municipalTotal = Number(forecastRows[0]?.municipal_forecast?.[0]);
            const period = state.arimaData?.total_vaccinated?.forecast_periods?.[0] || 'next month';
            const titleText = forecastRows.length
                ? `${period} estimate: ${Number.isFinite(municipalTotal) ? municipalTotal.toLocaleString() : '—'} doses total${longRangeEstimate ? ', based on older data' : ''}. Each barangay’s amount uses ${method}.`
                : forecastWithheld
                    ? `No estimate available. Latest month with data: ${vaccinationForecast.current_period || 'unavailable'}.`
                    : 'A barangay estimate is not available yet.';
            let entries = forecastRows.map((row) => {
                const name = row.barangay || '';
                return {
                    name,
                    forecast: Math.max(0, Number(row.forecast?.[0]) || 0),
                    actual: actuals.totals[normalizeBarangayName(name)] || 0,
                };
            });
            if (!forecastRows.length && actuals.available) {
                entries = Object.keys(actuals.totals).map((key) => ({
                    name: actuals.names[key], forecast: null, actual: actuals.totals[key],
                }));
            }
            const actualNote = actuals.available
                ? `Smaller figures show doses recorded in ${actuals.label}.`
                : 'Last month’s recorded doses appear after all reports are entered and the month is confirmed.';
            const chartNote = forecastRows.length
                ? `Blue bars show each barangay’s estimate. ${actualNote}`
                : actualNote;
            const noteEl = document.getElementById('vaccinesNeededTitle');
            if (noteEl) noteEl.title = `${titleText} ${chartNote} ${forecastWithheld ? (vaccinationForecast.data_quality_note || '') : ''}`;
            renderRankList('vaccinesNeededList', 'vaccinesNeededTitle',
                `${titleText} ${chartNote}`,
                forecastRows.length ? '#456084' : VIZ.warn,
                entries, actuals.label, actuals.available,
                forecastWithheld
                    ? `No barangay estimate shown. Latest month with data: ${vaccinationForecast.current_period || 'unavailable'}.`
                    : 'No barangay estimate is available yet.');
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
    document.querySelector('#event-table-card thead')?.addEventListener('click', (ev) => {
        const button = ev.target.closest('button[data-event-sort]');
        if (!button) return;
        const key = button.dataset.eventSort;
        if (state.eventTableSortKey === key) {
            state.eventTableSortDirection = state.eventTableSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            state.eventTableSortKey = key;
            state.eventTableSortDirection = (key === 'date' || key === 'totalVaccinated') ? 'desc' : 'asc';
        }
        state.eventTablePage = 1;
        renderTable();
    });

    document.getElementById('pending-reports-kpi')?.addEventListener('click', () => {
        state.pendingOnly = true;
        state.eventTablePage = 1;
        renderTable();
        const table = document.getElementById('event-table-card');
        const heading = document.getElementById('event-table-heading');
        table?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        heading?.focus({ preventScroll: true });
    });

    document.getElementById('show-all-events')?.addEventListener('click', () => {
        state.pendingOnly = false;
        state.eventTablePage = 1;
        renderTable();
    });

    document.getElementById('month-completeness-month')?.addEventListener('change', renderMonthCompletenessControl);
    document.getElementById('month-completeness-toggle')?.addEventListener('click', async (event) => {
        const input = document.getElementById('month-completeness-month');
        const [year, month] = String(input?.value || '').split('-').map(Number);
        if (!year || !month) return;
        const button = event.currentTarget;
        button.disabled = true;
        try {
            const res = await fetch(MASS_VACC_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'set_month_completeness', year, month,
                    complete: button.dataset.complete === 'true'
                })
            });
            const result = await res.json();
            if (!result.success) {
                await vbAlert(result.message || 'Could not update this month’s completion status.');
                return;
            }
            if (Array.isArray(result.monthStatuses)) state.monthStatuses = result.monthStatuses;
            renderMonthCompletenessControl();
            await refreshEventViews();
            await refreshVaccinationForecasts();
        } catch (err) {
            await vbAlert('Could not update this month’s completion status.');
        } finally {
            button.disabled = false;
            renderMonthCompletenessControl();
        }
    });

    document.getElementById('back-to-dashboard').addEventListener('click', () => setPanel('dashboard'));

    document.getElementById('delete-event-btn')?.addEventListener('click', async () => {
        const activeId = document.getElementById('post-event-form').dataset.activeEventId;
        const e = state.events.find(item => item.id === activeId);
        if (!e) return;
        if (!(await vbConfirm(`Delete the ${e.barangay} – ${e.vaccine} event on ${e.dateLabel}? This cannot be undone.`, 'Yes, delete'))) return;

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

        await refreshEventViews();
        await refreshVaccinationForecasts();
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
            if (!result.success) { await vbAlert(result.message || 'Failed to save report.'); return; }
            Object.assign(e, result.data);
        } catch (err) {
            await vbAlert('Failed to save report.'); return;
        }

        // Re-render everything with fresh state — charts now pick up the new totals
        await refreshEventViews();
        await refreshVaccinationForecasts();
        hydrateDetail(activeId);
        await vbAlert('Vaccination report saved.');
    });

    const dateInput        = document.getElementById('event-date');
    const dateError         = document.getElementById('date-error');
    const barangaySelect    = document.getElementById('event-barangay');
    const barangayTrigger   = document.getElementById('barangay-trigger');
    const barangayError     = document.getElementById('barangay-error');
    const vaccineSelect     = document.getElementById('event-vaccine');
    const addVaccineTypeBtn = document.getElementById('add-vaccine-type-btn');

    // Upper bound for the picker: no drive is planned more than a year out,
    // so past this the date is a typo. Assembled from local-time parts rather
    // than toISOString(), which converts to UTC first -- in Manila (UTC+8)
    // that rolled the limit back a day for anyone using the form between
    // midnight and 8am, and made the cap disagree with the
    // MASS_VACC_HORIZON_YEARS check in api/mass-vaccination/events.php.
    function horizonIso() {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // Earliest date an encoder may enter by hand. Mirrors
    // MASS_VACC_MANUAL_ENTRY_FROM in api/mass-vaccination/events.php -- change
    // one and you must change the other, or the form and the server disagree
    // about what is enterable.
    //
    // Note this is BEFORE today: past dates are meant to be allowed here.
    // Encoders record drives that have already run (the Jan-Aug 2026 backlog),
    // so the picker has to reach back into the year, not start at today.
    const MANUAL_ENTRY_FROM = '2026-01-01';

    function manualEntryFromLabel() {
        const [y, m, d] = MANUAL_ENTRY_FROM.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    }

    // The ONE date rule for this form, applied as the field is filled in and
    // again on submit. It deliberately mirrors the guard in
    // api/mass-vaccination/events.php -- the server is what actually enforces
    // this, since anything can POST to that endpoint; this copy exists so the
    // encoder finds out at the moment of typing instead of after a round trip.
    // Keeping it in one function is what stops the two checks here drifting
    // apart from each other.
    function dateFieldError(value) {
        if (!value) return 'Please select a date.';
        if (value < MANUAL_ENTRY_FROM) {
            return `Events before ${manualEntryFromLabel()} come from the uploaded workbook and cannot be entered here.`;
        }
        if (value > horizonIso()) return 'Events can only be scheduled up to a year ahead.';
        return '';
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

    /* Check the date the moment it is entered, not only on submit.
       The form carries novalidate, so the browser never enforces the min/max
       set above on its own: Chrome greys out out-of-range days in the calendar
       popup, but a date typed straight into the field segments -- 01/01/2020
       -- lands in the box and sits there looking accepted until Create is
       pressed. Validating on input/change surfaces the problem while the
       encoder is still looking at the field. The submit check still runs;
       this does not replace it. */
    ['input', 'change'].forEach((evt) => {
        dateInput.addEventListener(evt, () => {
            // Empty is not an error WHILE typing -- only on submit. Nagging
            // "Please select a date." at someone clearing the field is noise.
            setFieldError(dateInput, dateError, dateInput.value ? dateFieldError(dateInput.value) : '');
        });
    });

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
        dateInput.min = MANUAL_ENTRY_FROM;
        dateInput.max = horizonIso();
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

        const dateProblem = dateFieldError(dateInput.value);
        if (dateProblem) {
            setFieldError(dateInput, dateError, dateProblem);
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
            if (!result.success) { await vbAlert(result.message || 'Failed to create event.'); return; }

            await refreshEventViews();
            await refreshVaccinationForecasts();
            closeModal();
            showEventSummary(result.data);
        } catch (err) { await vbAlert('Failed to create event.'); return; }
    });

    document.getElementById('range-filter')?.addEventListener('change', e => buildCharts(e.target.value));

    document.getElementById('historical-year-filter')?.addEventListener('change', (e) => {
        state.historicalYear = e.target.value;
        buildCharts();
    });

    document.getElementById('data-view-filter')?.addEventListener('change', async (e) => {
        state.dataView = e.target.value === 'current' ? 'current' : 'historical';
        applyDataViewVisibility();
        renderSkeletons();
        await loadVaccinationDataset();
        populateHistoricalYears();
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

        // ...and the workbook year filter is the mirror image: only meaningful
        // for the closed historical period, so it swaps in where range swaps out.
        const yearEl = document.getElementById('historical-year-filter');
        if (yearEl) yearEl.hidden = state.dataView !== 'historical';
    }

    // Fills the workbook year dropdown from whatever years the dataset actually
    // holds, rather than hardcoding 2023-2025 -- if the workbook is extended the
    // filter follows it. Keeps the current selection when it still exists.
    function populateHistoricalYears() {
        const select = document.getElementById('historical-year-filter');
        if (!select) return;
        // From the BASELINE, not the selector-scoped dataset. This is the workbook
        // year filter, and the workbook is the same in either view; reading the
        // scoped copy meant a Historical -> Current -> Historical round trip
        // could repopulate it with live years and silently drop the default.
        const source = state.forecastBaseline || state.vaccinationDataset;
        const years = Array.from(new Set(
            (source?.by_month || [])
                .map(r => String(r.year || '').trim())
                .filter(Boolean)
        )).sort().reverse();
        if (!years.length) return;

        if (!years.includes(state.historicalYear)) {
            // Preferred default is gone from the data; fall back to the newest.
            state.historicalYear = years[0];
        }
        select.innerHTML = years.map(y =>
            `<option value="${y}"${y === state.historicalYear ? ' selected' : ''}>${y}</option>`
        ).join('') + `<option value="all"${state.historicalYear === 'all' ? ' selected' : ''}>All years</option>`;
    }

    // ── Init ──────────────────────────────────────────────────────────────
    renderSkeletons();
    applyDataViewVisibility();
    await loadEvents();
    await Promise.all([
        loadArimaForecast(),
        loadBarangayForecast(),
        loadDashboardData(),
        loadVaccinationDataset()
    ]);

    renderTable();
    updateMetrics();
    renderMonthCompletenessControl();
    setPanel('dashboard');
    closeModal();
    await loadForecastBaseline();
    renderArimaCard();
    populateHistoricalYears();
    buildCharts();
    populateBarangayDropdown();
});

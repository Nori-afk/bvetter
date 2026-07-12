document.addEventListener('DOMContentLoaded', () => {
    const state = {
        filters: {
            date_type: 'all',
            category: 'all_patient'
        },
        draftFilters: {
            date_type: 'all',
            category: 'all_patient'
        },
        sort: 'desc',
        sortField: 'date',
        page: 1,
        pageSize: 6,
        columns: [],
        filterOpen: false,
        sortOpen: false,
        exportOpen: false,
        exportFormat: 'pdf'
    };

    const ui = {
        table:              document.querySelector('.report-table'),
        tableBody:          document.getElementById('report-table-body'),
        summary:            document.getElementById('report-summary'),
        pagination:         document.getElementById('pagination'),
        filterButton:       document.getElementById('filter-button'),
        filterPopover:      document.getElementById('filter-popover'),
        filterDone:         document.getElementById('filter-done'),
        dateType:           document.getElementById('date-type'),
        reportCategory:     document.getElementById('report-category'),
        sortButton:         document.getElementById('sort-button'),
        sortPopover:        document.getElementById('sort-popover'),
        sortField:          document.getElementById('sort-field'),
        sortDir:            document.getElementById('sort-dir'),
        sortDone:           document.getElementById('sort-done'),
        exportButton:       document.getElementById('export-button'),
        exportModalOverlay: document.getElementById('export-modal-overlay'),
        exportClose:        document.getElementById('export-close'),
        exportCancel:       document.getElementById('export-cancel'),
        exportDownload:     document.getElementById('export-download')
    };

    // ── KPI config ──────────────────────────────────────────────────────
    var KPI_CONFIG = {
        all_patient: {
            left:   'Total Patients This Month',
            center: 'Most Common Disease',
            right:  'Most Active Barangay'
        },
        consultation_summary: {
            left:   'Total Consultations This Month',
            center: 'Most Common Diagnosis',
            right:  'Most Active Barangay'
        },
        disease_incidence: {
            left:   'Total Cases This Month',
            center: 'Dominant Disease Group',
            right:  'Highest Risk Barangay'
        },
        mass_vaccination: {
            left:   'Total Vaccinated This Month',
            center: 'Dogs vs Cats Ratio',
            right:  'Clients Served This Month'
        },
        lost_found: {
            left:   'Total Reports This Month',
            center: 'Most Reported Species',
            right:  'Resolution Rate'
        }
    };

    function changeKPI(category) {
        var config = KPI_CONFIG[category] || KPI_CONFIG['all_patient'];
        var leftTitle   = document.getElementById('title-left');
        var centerTitle = document.getElementById('title-center');
        var rightTitle  = document.getElementById('title-right');
        if (leftTitle)   leftTitle.textContent   = config.left;
        if (centerTitle) centerTitle.textContent = config.center;
        if (rightTitle)  rightTitle.textContent  = config.right;
    }

    function setSubset(elementId, kpi) {
        kpi = kpi || {};
        var el = document.getElementById(elementId);
        if (!el) return;
        var text  = kpi.subset ? String(kpi.subset) : '';
        var trend = kpi.trend  ? String(kpi.trend)  : 'neutral';
        var arrow = trend === 'up' ? '▲ ' : (trend === 'down' ? '▼ ' : '');
        el.textContent = arrow + text;
        el.classList.remove('subset-up', 'subset-down', 'subset-neutral');
        el.classList.add('subset-' + trend);
    }

    // ── SINGLE renderMetrics — no duplicate below ───────────────────────
    function renderMetrics(metrics) {
        metrics = metrics || {};
        console.log('Metrics:', metrics); // Debug log to check the structure of metrics
        var leftData   = metrics.left   || {};
        var centerData = metrics.center || {};
        var rightData  = metrics.right  || {};

        var leftVal   = document.getElementById('metric-total');
        var centerVal = document.getElementById('metric-disease');
        var rightVal  = document.getElementById('metric-barangay');

        if (leftVal)   leftVal.textContent   = leftData.value   !== undefined ? String(leftData.value)   : '0';
        if (centerVal) centerVal.textContent = centerData.value !== undefined ? String(centerData.value) : 'N/A';
        if (rightVal)  rightVal.textContent  = rightData.value  !== undefined ? String(rightData.value)  : 'N/A';

        setSubset('subset-left',   leftData);
        setSubset('subset-center', centerData);
        setSubset('subset-right',  rightData);
    }

    // ── Category dropdown ───────────────────────────────────────────────
    function setCategoryOptions() {
        ui.reportCategory.innerHTML = [
            ['all_patient',          'All Patient'],
            ['consultation_summary', 'Consultation and Patient Summary'],
            ['disease_incidence',    'Disease Incidence Report'],
            ['mass_vaccination',     'Mass Vaccination Report'],
            ['lost_found',           'Lost And Found Report']
        ].map(function(pair) {
            return '<option value="' + pair[0] + '">' + pair[1] + '</option>';
        }).join('');
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDate(value) {
        if (!value) return '';
        var date = new Date(value + 'T00:00:00');
        if (isNaN(date.getTime())) return value;
        return new Intl.DateTimeFormat('en-US', {
            month: '2-digit', day: '2-digit', year: 'numeric'
        }).format(date);
    }

    function displayValue(column, row) {
        var value = row[column.key];
        return column.key === 'date' ? formatDate(value) : value;
    }

    function requestParams(extra) {
        extra = extra || {};
        return Object.assign({}, state.filters, {
            sort:       state.sort,
            sort_field: state.sortField,
            page:       state.page,
            page_size:  state.pageSize
        }, extra);
    }

    function renderHeaders(columns) {
        var headRow = ui.table.querySelector('thead tr');
        headRow.innerHTML = columns.map(function(col) {
            return '<th>' + escapeHtml(col.label) + '</th>';
        }).join('');
    }

    function renderRows(columns, rows) {
        if (!rows.length) {
            ui.tableBody.innerHTML = '<tr><td colspan="' + (columns.length || 1) + '">No report rows match the selected filters.</td></tr>';
            return;
        }
        ui.tableBody.innerHTML = rows.map(function(row) {
            return '<tr>' + columns.map(function(col, index) {
                var value = displayValue(col, row);
                var cls = index === 0 ? ' class="patient-id"' : '';
                return '<td><span' + cls + '>' + escapeHtml(value) + '</span></td>';
            }).join('') + '</tr>';
        }).join('');
    }

    function renderPagination(pagination) {
        pagination = pagination || {};
        var totalPages = Math.max(1, pagination.totalPages || 1);
        var page = Math.min(state.page, totalPages);
        var items = [];
        items.push('<button type="button" class="page-btn" data-page="1" ' + (page <= 1 ? 'disabled' : '') + ' aria-label="First page">&laquo;</button>');
        items.push('<button type="button" class="page-btn" data-page="' + Math.max(1, page - 1) + '" ' + (page <= 1 ? 'disabled' : '') + ' aria-label="Previous page">&lsaquo;</button>');
        var start = Math.max(1, page - 1);
        var end   = Math.min(totalPages, start + 2);
        for (var p = start; p <= end; p++) {
            items.push('<button type="button" class="page-btn ' + (p === page ? 'active' : '') + '" data-page="' + p + '">' + p + '</button>');
        }
        if (end < totalPages) items.push('<span class="page-ellipsis">...</span>');
        items.push('<button type="button" class="page-btn" data-page="' + Math.min(totalPages, page + 1) + '" ' + (page >= totalPages ? 'disabled' : '') + ' aria-label="Next page">&rsaquo;</button>');
        items.push('<button type="button" class="page-btn" data-page="' + totalPages + '" ' + (page >= totalPages ? 'disabled' : '') + ' aria-label="Last page">&raquo;</button>');
        ui.pagination.innerHTML = items.join('');
    }

    async function loadReports() {
        ui.tableBody.innerHTML = '<tr><td colspan="8">Loading reports...</td></tr>';
        const response = await window.VetAPI.getReports(requestParams());

        if (!response.ok) {
            ui.tableBody.innerHTML = '<tr><td colspan="8">Unable to load reports right now.</td></tr>';
            return;
        }

        const data     = response.data || {};
        console.log('Report Data:', data); // Debug log to check the structure of the response
        const metrics  = data.metrics  || {};
        const rows     = data.rows     || [];
        const columns  = data.columns  || [];
        const category = data.category || state.filters.category || 'all_patient';

        state.columns = columns;

        changeKPI(category);
        renderHeaders(columns);
        renderRows(columns, rows);
        renderMetrics(metrics);
        renderPagination(data.pagination);

        const total = (data.pagination && data.pagination.total) ? data.pagination.total : 0;
        ui.summary.textContent = 'Displaying ' + rows.length + ' of ' + total + ' Records';
    }

    function openFilterPopover() {
        state.filterOpen = true;
        state.draftFilters = Object.assign({}, state.filters);
        ui.dateType.value = state.draftFilters.date_type;
        ui.reportCategory.value = state.draftFilters.category;
        ui.filterPopover.hidden = false;
        ui.filterButton.setAttribute('aria-expanded', 'true');
    }

    function closeFilterPopover(commit) {
        if (commit) {
            state.filters = Object.assign({}, state.draftFilters);
            state.page = 1;
            loadReports();
        }
        state.filterOpen = false;
        ui.filterPopover.hidden = true;
        ui.filterButton.setAttribute('aria-expanded', 'false');
    }

    function openExportModal() {
        state.exportOpen = true;
        ui.exportModalOverlay.hidden = false;
        document.body.style.overflow = 'hidden';
        syncExportSelection();
    }

    function closeExportModal() {
        state.exportOpen = false;
        ui.exportModalOverlay.hidden = true;
        document.body.style.overflow = '';
    }

    function syncExportSelection() {
        document.querySelectorAll('.export-option').forEach(function(option) {
            var isSelected = option.dataset.format === state.exportFormat;
            option.classList.toggle('active', isSelected);
            option.setAttribute('aria-pressed', String(isSelected));
        });
    }

    function handleExport() {
    var session = JSON.parse(sessionStorage.getItem('vbetter_session') || 'null');
    var userName = (session && session.fullName) ? session.fullName : 'Baliuag City Veterinary Office';
    var params = requestParams({ page: 1, page_size: 10000, generated_by: userName });
    var url = window.VetAPI.getReportExportUrl(params, state.exportFormat);
    window.location.href = url;
    closeExportModal();
}

    // ── Init ────────────────────────────────────────────────────────────
    setCategoryOptions();

    ui.filterButton.addEventListener('click', function(event) {
        event.stopPropagation();
        state.filterOpen ? closeFilterPopover(false) : openFilterPopover();
    });
    ui.filterDone.addEventListener('click', function() { closeFilterPopover(true); });
    ui.dateType.addEventListener('change', function() {
        state.draftFilters.date_type = ui.dateType.value;
    });
    ui.reportCategory.addEventListener('change', function() {
        state.draftFilters.category = ui.reportCategory.value;
    });
    ui.sortButton.addEventListener('click', function(e) {
        e.stopPropagation();
        state.sortOpen = !state.sortOpen;
        ui.sortPopover.hidden = !state.sortOpen;
        ui.sortButton.setAttribute('aria-expanded', String(state.sortOpen));
        if (state.sortOpen) {
            ui.sortField.value = state.sortField;
            ui.sortDir.value = state.sort;
        }
    });
    ui.sortField.addEventListener('change', function() {
        var isDate = ui.sortField.value === 'date';
        ui.sortDir.innerHTML = isDate
            ? '<option value="desc">Newest First</option><option value="asc">Oldest First</option>'
            : '<option value="asc">A → Z</option><option value="desc">Z → A</option>';
    });
    ui.sortDone.addEventListener('click', function() {
        state.sortField = ui.sortField.value;
        state.sort = ui.sortDir.value;
        state.sortOpen = false;
        ui.sortPopover.hidden = true;
        ui.sortButton.setAttribute('aria-expanded', 'false');
        state.page = 1;
        loadReports();
    });
    document.addEventListener('click', function(e) {
        if (state.sortOpen && !ui.sortButton.contains(e.target) && !ui.sortPopover.contains(e.target)) {
            state.sortOpen = false;
            ui.sortPopover.hidden = true;
            ui.sortButton.setAttribute('aria-expanded', 'false');
        }
    });
    ui.exportButton.addEventListener('click', openExportModal);
    ui.exportClose.addEventListener('click', closeExportModal);
    ui.exportCancel.addEventListener('click', closeExportModal);
    ui.exportDownload.addEventListener('click', handleExport);
    ui.exportModalOverlay.addEventListener('click', function(event) {
        if (event.target === ui.exportModalOverlay) closeExportModal();
    });
    document.querySelectorAll('.export-option').forEach(function(option) {
        option.addEventListener('click', function() {
            state.exportFormat = option.dataset.format;
            syncExportSelection();
        });
    });
    ui.pagination.addEventListener('click', function(event) {
        var button = event.target.closest('.page-btn');
        if (!button || button.disabled) return;
        state.page = Number(button.dataset.page) || 1;
        loadReports();
    });
    document.addEventListener('click', function(event) {
        if (!state.filterOpen) return;
        var inside = event.target.closest('#filter-popover') || event.target.closest('#filter-button');
        if (!inside) closeFilterPopover(false);
    });
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            if (state.exportOpen) closeExportModal();
            if (state.filterOpen) closeFilterPopover(false);
        }
    });

    loadReports();
});
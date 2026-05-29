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
		sort: 'asc',
		page: 1,
		pageSize: 6,
		columns: [],
		filterOpen: false,
		exportOpen: false,
		exportFormat: 'pdf'
	};

	const ui = {
		table: document.querySelector('.report-table'),
		tableBody: document.getElementById('report-table-body'),
		summary: document.getElementById('report-summary'),
		pagination: document.getElementById('pagination'),
		totalMetric: document.getElementById('metric-total'),
		diseaseMetric: document.getElementById('metric-disease'),
		barangayMetric: document.getElementById('metric-barangay'),
		filterButton: document.getElementById('filter-button'),
		filterPopover: document.getElementById('filter-popover'),
		filterDone: document.getElementById('filter-done'),
		dateType: document.getElementById('date-type'),
		reportCategory: document.getElementById('report-category'),
		sortButton: document.getElementById('sort-button'),
		exportButton: document.getElementById('export-button'),
		exportModalOverlay: document.getElementById('export-modal-overlay'),
		exportClose: document.getElementById('export-close'),
		exportCancel: document.getElementById('export-cancel'),
		exportDownload: document.getElementById('export-download')
	};

	function setCategoryOptions() {
		ui.reportCategory.innerHTML = [
			['all_patient', 'All Patient'],
			['consultation_summary', 'Consultation and Patient Summary'],
			['disease_incidence', 'Disease Incidence Report'],
			['mass_vaccination', 'Mass Vaccination Report'],
			['lost_found', 'Lost And Found Report']
		].map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
	}

	function escapeHtml(value) {
		return String(value ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function formatDate(value) {
		if (!value) return '';
		const date = new Date(`${value}T00:00:00`);
		if (Number.isNaN(date.getTime())) return value;
		return new Intl.DateTimeFormat('en-US', {
			month: '2-digit',
			day: '2-digit',
			year: 'numeric'
		}).format(date);
	}

	function displayValue(column, row) {
		const value = row[column.key];
		return column.key === 'date' ? formatDate(value) : value;
	}

	function requestParams(extra = {}) {
		return {
			...state.filters,
			sort: state.sort,
			page: state.page,
			page_size: state.pageSize,
			...extra
		};
	}

	function renderHeaders(columns) {
		const headRow = ui.table.querySelector('thead tr');
		headRow.innerHTML = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('');
	}

	function renderRows(columns, rows) {
		if (!rows.length) {
			ui.tableBody.innerHTML = `<tr><td colspan="${columns.length || 1}">No report rows match the selected filters.</td></tr>`;
			return;
		}

		ui.tableBody.innerHTML = rows.map((row) => `
			<tr>
				${columns.map((column, index) => {
					const value = displayValue(column, row);
					const className = index === 0 ? ' class="patient-id"' : '';
					return `<td><span${className}>${escapeHtml(value)}</span></td>`;
				}).join('')}
			</tr>
		`).join('');
	}

	function renderMetrics(metrics = {}) {
		if (ui.totalMetric) ui.totalMetric.textContent = String(metrics.totalPatientsThisMonth ?? 0);
		if (ui.diseaseMetric) ui.diseaseMetric.textContent = metrics.mostCommonDisease || 'N/A';
		if (ui.barangayMetric) ui.barangayMetric.textContent = metrics.mostActiveBarangay || 'N/A';
	}

	function renderPagination(pagination = {}) {
		const totalPages = Math.max(1, pagination.totalPages || 1);
		const page = Math.min(state.page, totalPages);
		const items = [];
		items.push(`<button type="button" class="page-btn" data-page="${Math.max(1, page - 1)}" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">&lsaquo;</button>`);

		const start = Math.max(1, page - 1);
		const end = Math.min(totalPages, start + 2);
		for (let nextPage = start; nextPage <= end; nextPage += 1) {
			items.push(`<button type="button" class="page-btn ${nextPage === page ? 'active' : ''}" data-page="${nextPage}">${nextPage}</button>`);
		}
		if (end < totalPages) items.push('<span class="page-ellipsis">...</span>');
		items.push(`<button type="button" class="page-btn" data-page="${Math.min(totalPages, page + 1)}" ${page >= totalPages ? 'disabled' : ''} aria-label="Next page">&rsaquo;</button>`);
		ui.pagination.innerHTML = items.join('');
	}

	async function loadReports() {
		ui.tableBody.innerHTML = '<tr><td colspan="8">Loading reports...</td></tr>';
		const response = await window.VetAPI.getReports(requestParams());

		if (!response.ok) {
			ui.tableBody.innerHTML = '<tr><td colspan="8">Unable to load reports right now.</td></tr>';
			return;
		}

		const data = response.data;
		state.columns = data.columns || [];
		renderHeaders(state.columns);
		renderRows(state.columns, data.rows || []);
		renderMetrics(data.metrics);
		renderPagination(data.pagination);

		const total = data.pagination?.total ?? 0;
		const shown = (data.rows || []).length;
		ui.summary.textContent = `Displaying ${shown} of ${total} Records`;
	}

	function openFilterPopover() {
		state.filterOpen = true;
		state.draftFilters = { ...state.filters };
		ui.dateType.value = state.draftFilters.date_type;
		ui.reportCategory.value = state.draftFilters.category;
		ui.filterPopover.hidden = false;
		ui.filterButton.setAttribute('aria-expanded', 'true');
	}

	function closeFilterPopover(commit = false) {
		if (commit) {
			state.filters = { ...state.draftFilters };
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
		document.querySelectorAll('.export-option').forEach((option) => {
			const isSelected = option.dataset.format === state.exportFormat;
			option.classList.toggle('active', isSelected);
			option.setAttribute('aria-pressed', String(isSelected));
		});
	}

	function handleExport() {
		const url = window.VetAPI.getReportExportUrl(requestParams({ page: 1, page_size: 10000 }), state.exportFormat);
		window.location.href = url;
		closeExportModal();
	}

	setCategoryOptions();

	ui.filterButton.addEventListener('click', (event) => {
		event.stopPropagation();
		state.filterOpen ? closeFilterPopover(false) : openFilterPopover();
	});
	ui.filterDone.addEventListener('click', () => closeFilterPopover(true));
	ui.dateType.addEventListener('change', () => {
		state.draftFilters.date_type = ui.dateType.value;
	});
	ui.reportCategory.addEventListener('change', () => {
		state.draftFilters.category = ui.reportCategory.value;
	});
	ui.sortButton.addEventListener('click', () => {
		state.sort = state.sort === 'asc' ? 'desc' : 'asc';
		state.page = 1;
		loadReports();
	});
	ui.exportButton.addEventListener('click', openExportModal);
	ui.exportClose.addEventListener('click', closeExportModal);
	ui.exportCancel.addEventListener('click', closeExportModal);
	ui.exportDownload.addEventListener('click', handleExport);
	ui.exportModalOverlay.addEventListener('click', (event) => {
		if (event.target === ui.exportModalOverlay) closeExportModal();
	});
	document.querySelectorAll('.export-option').forEach((option) => {
		option.addEventListener('click', () => {
			state.exportFormat = option.dataset.format;
			syncExportSelection();
		});
	});
	ui.pagination.addEventListener('click', (event) => {
		const button = event.target.closest('.page-btn');
		if (!button || button.disabled) return;
		state.page = Number(button.dataset.page) || 1;
		loadReports();
	});
	document.addEventListener('click', (event) => {
		if (!state.filterOpen) return;
		const clickedInsideFilter = event.target.closest('#filter-popover') || event.target.closest('#filter-button');
		if (!clickedInsideFilter) closeFilterPopover(false);
	});
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			if (state.exportOpen) closeExportModal();
			if (state.filterOpen) closeFilterPopover(false);
		}
	});

	loadReports();
});

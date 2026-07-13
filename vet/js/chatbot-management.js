document.addEventListener('DOMContentLoaded', async () => {
	function appBasePath() {
		const script = document.currentScript || Array.from(document.scripts).find((item) => item.src && item.src.includes('/vet/js/chatbot-management.js'));
		const path = script?.src ? new URL(script.src).pathname : window.location.pathname;
		const jsMarker = '/vet/js/chatbot-management.js';
		if (path.includes(jsMarker)) return path.slice(0, path.indexOf(jsMarker));
		const pageMarker = '/vet/html/';
		if (path.includes(pageMarker)) return path.slice(0, path.indexOf(pageMarker));
		return '/final-VBETTER/bvetter';
	}

	const CHATBOT_API = `${appBasePath()}/api/chatbot/chatbot.php`;

	function pageSizeForViewport() {
		return window.innerWidth <= 768 ? 5 : 10;
	}
	let inquiryRules = [
		{
			id: 1,
			name: 'Clinic Schedule',
			icon: 'clock',
			response: 'Mon-Fri 7:00 AM - 5:00 PM\nSaturday 8:00 AM - 5:00 PM\nSunday 10:00 AM - 5:00 PM',
			count: 25,
			lastUpdated: '2026-02-14',
			actionType: 'no-action',
			actionLabel: 'No action',
			redirectPage: '',
			buttonLabel: ''
		},
		{
			id: 2,
			name: 'Vaccination Requirements',
			icon: 'syringe',
			response: 'What type of animal is your pet?\nHow old is your pet?\nIs your pet vaccinated before?',
			count: 5,
			lastUpdated: '2026-02-15',
			actionType: 'redirect',
			actionLabel: 'Schedule Now',
			redirectPage: 'Book Appointment',
			buttonLabel: 'Schedule Now'
		},
		{
			id: 3,
			name: 'Book An Appointment',
			icon: 'clipboard',
			response: 'Redirected to "Book Appointment"',
			count: 10,
			lastUpdated: '2026-02-15',
			actionType: 'redirect',
			actionLabel: 'Book Appointment',
			redirectPage: 'Book Appointment',
			buttonLabel: 'Book Appointment'
		},
		{
			id: 4,
			name: 'Lost And Found',
			icon: 'link',
			response: '...',
			count: 10,
			lastUpdated: '2026-02-16',
			actionType: 'no-action',
			actionLabel: 'No action',
			redirectPage: '',
			buttonLabel: ''
		}
	];

	let consultationRules = [
		{
			id: 1,
			petType: 'Dog',
			symptoms: ['Vomiting', 'Lethargy'],
			duration: '>3d',
			condition: 'Acute Gastritis',
			severity: 'Critical',
			recommendation: 'Immediate clinic visit, withhold food for 12h',
			lastUpdate: '2023-10-12'
		},
		{
			id: 2,
			petType: 'Dog',
			symptoms: ['Mild Itching', 'Redness'],
			duration: '<24h',
			condition: 'Seasonal Allergy',
			severity: 'Active',
			recommendation: 'Monitor for 24h, clean paws after walks',
			lastUpdate: '2025-10-12'
		},
		{
			id: 3,
			petType: 'Cat',
			symptoms: ['Mild Itching', 'Redness'],
			duration: '<24h',
			condition: 'Seasonal Allergy',
			severity: 'Active',
			recommendation: 'Monitor for 24h, clean paws after walks',
			lastUpdate: '2025-10-12'
		}
	];

	let labels = [
		'Poblacion',
		'San Jose',
		'Tangos',
		'Matang Tubig',
		'Makirang',
		'Virgen Delos Flores',
		'Tipayong',
		'Tibag',
		'Tiong',
		'Santo Nino',
		'Santo Cristo',
		'Santa Barbara'
	];

	let consultationSeries = [5, 3, 10, 2, 3, 4, 4, 7, 2, 1, 0, 2];
	let inquirySeries = [4, 2, 8, 3, 4, 5, 4, 6, 2, 1, 0, 1];

	let inquiryDistribution = {
		labels: ['Clinic Schedule', 'Vaccination Requirements', 'Book Appointment', 'Lost and Found Procedure'],
		values: [0, 0, 0, 0]
	};

	let symptomsByPetType = {
		all: {
			labels: ['Fever', 'Itching', 'Arthritis', 'Obesity', 'Vomiting', 'Diarrhea', 'Coughing', 'Loss of Appetite', 'Wounds'],
			values: [31, 85, 37, 54, 16, 16, 56, 54, 83]
		},
		dog: {
			labels: ['Fever', 'Itching', 'Arthritis', 'Obesity', 'Vomiting', 'Diarrhea', 'Coughing', 'Loss of Appetite', 'Wounds'],
			values: [28, 72, 41, 48, 20, 18, 60, 57, 76]
		},
		cat: {
			labels: ['Fever', 'Itching', 'Arthritis', 'Obesity', 'Vomiting', 'Diarrhea', 'Coughing', 'Loss of Appetite', 'Wounds'],
			values: [34, 78, 29, 39, 24, 22, 46, 48, 66]
		},
		other: {
			labels: ['Fever', 'Itching', 'Arthritis', 'Obesity', 'Vomiting', 'Diarrhea', 'Coughing', 'Loss of Appetite', 'Wounds'],
			values: [0, 0, 0, 0, 0, 0, 0, 0, 0]
		}
	};

	let locationLegendRows = [
		{ name: 'Sabang', color: '#ff3b30' },
		{ name: 'Tiong', color: '#ff5b2e' },
		{ name: 'Tarcan', color: '#d1f400' },
		{ name: 'Poblacion', color: '#14b8a6' },
		{ name: 'San Rafael', color: '#00d34f' },
		{ name: 'Tibag', color: '#3ee489' },
		{ name: 'San Jose', color: '#2e92ff' },
		{ name: 'Matang Tubig', color: '#ff3b30' },
		{ name: 'Santo Nino', color: '#ff5b2e' },
		{ name: 'Santo Cristo', color: '#d1f400' }
	];

	let dashboardStats = {
		kpis: {
			totalConsultations: 0,
			totalInquiries: 0,
			mostCommonSymptom: 'No data yet',
			consultationSuccessRate: 0,
			inquirySuccessRate: 0
		}
	};

	const iconLibrary = {
		clock: { badge: 'CLK', label: 'Clock' },
		syringe: { badge: 'SYR', label: 'Syringe' },
		clipboard: { badge: 'CLP', label: 'Clipboard' },
		link: { badge: 'LNK', label: 'Link' },
		chat: { badge: 'CHT', label: 'Chat' },
		pin: { badge: 'PIN', label: 'Pin' }
	};

	const state = {
		activeTab: 'home',
		inquiryEditingId: null,
		inquiryDeletingId: null,
		inquiryViewingId: null,
		inquiryPage: 1,
		inquirySort: 'default',
		consultationMode: 'list',
		consultationEditingId: null,
		consultationDeletingId: null,
		consultationViewingId: null,
		consultationPage: 1,
		consultationSort: 'default',
		selectedAnimal: '',
		selectedAgeGroup: 'Any',
		selectedDuration: '1-3 Days',
		selectedSymptoms: [],
		chartsReady: false,
		consultationChart: null,
		inquiryTypeChart: null,
		locationPieChart: null,
		symptomsChart: null
	};

	const ui = {
		tabButtons: Array.from(document.querySelectorAll('.tab-btn')),
		panels: Array.from(document.querySelectorAll('.tab-panel')),
		inquiryTotal: document.getElementById('inquiry-total-count'),
		inquirySearch: document.getElementById('inquiry-search'),
		inquirySort: document.getElementById('inquiry-sort'),
		inquiryTableBody: document.getElementById('inquiry-table-body'),
		inquirySummary: document.getElementById('inquiry-summary'),
		inquiryPagination: document.getElementById('inquiry-pagination'),
		openInquiryModal: document.getElementById('open-inquiry-modal'),
		consultationViews: Array.from(document.querySelectorAll('[data-consultation-view]')),
		consultationSearch: document.getElementById('consultation-search'),
		consultationSort: document.getElementById('consultation-sort'),
		consultationTableBody: document.getElementById('consultation-table-body'),
		consultationSummary: document.getElementById('consultation-summary'),
		consultationPagination: document.getElementById('consultation-pagination'),
		openConsultationBuilder: document.getElementById('open-consultation-builder'),
		consultationBackBtn: document.getElementById('consultation-back-btn'),
		consultationBuilderForm: document.getElementById('consultation-builder-form'),
		consultationBuilderCancel: document.getElementById('consultation-builder-cancel'),
		consultationBuilderSubmit: document.getElementById('consultation-builder-submit'),
		consultationBuilderTitle: document.getElementById('consultation-builder-title'),
		consultationAnimalGrid: document.getElementById('consultation-animal-grid'),
		consultationAgeGroupGrid: document.getElementById('consultation-agegroup-grid'),
		consultationSymptomGrid: document.getElementById('consultation-symptom-grid'),
		consultationDurationGroup: document.getElementById('consultation-duration-group'),
		consultationCondition: document.getElementById('consultation-condition'),
		consultationSeverity: document.getElementById('consultation-severity'),
		consultationRecommendation: document.getElementById('consultation-recommendation'),
		consultationTotalCount: document.getElementById('consultation-total-count'),
		consultationAverageResponse: document.getElementById('consultation-average-response'),
		consultationSuccessRate: document.getElementById('consultation-success-rate'),
		modalOverlay: document.getElementById('modal-overlay'),
		modalShell: document.getElementById('modal-shell'),
		modalClose: document.getElementById('modal-close'),
		modalContent: document.getElementById('modal-content'),
		sourceFilter: document.getElementById('sourceFilter'),
		petTypeFilter: document.getElementById('petTypeFilter'),
		locationLegend: document.getElementById('locationLegend'),
		valueOnlineConsult: document.getElementById('value-online-consult'),
		valueOnlineInquiry: document.getElementById('value-online-inquiry'),
		valueMostCommonSymptom: document.getElementById('value-most-common-symptom')
	};

	async function chatbotRequest(action, payload = {}) {
		const response = await fetch(CHATBOT_API, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ...payload })
		});
		const result = await response.json();
		if (!response.ok || !result.success) {
			throw new Error(result.message || 'Chatbot request failed.');
		}
		return result.data ?? result;
	}

	async function loadChatbotRules() {
		try {
			const [inquiries, consultations, stats] = await Promise.all([
				chatbotRequest('list_inquiries'),
				chatbotRequest('list_consultations'),
				chatbotRequest('dashboard_stats')
			]);
			if (Array.isArray(inquiries)) inquiryRules = inquiries;
			if (Array.isArray(consultations)) consultationRules = consultations;
			if (stats) applyDashboardStats(stats);
		} catch (error) {
			console.warn('Using local chatbot rules because backend failed:', error);
		}
	}

	function applyDashboardStats(stats) {
		dashboardStats = stats;

		if (Array.isArray(stats.trend?.labels)) labels = stats.trend.labels;
		if (Array.isArray(stats.trend?.consultation)) consultationSeries = stats.trend.consultation;
		if (Array.isArray(stats.trend?.inquiry)) inquirySeries = stats.trend.inquiry;

		if (stats.inquiryDistribution?.labels && stats.inquiryDistribution?.values) {
			inquiryDistribution = stats.inquiryDistribution;
		}

		if (stats.symptomsByPetType) {
			symptomsByPetType = {
				all: normalizeChartSet(stats.symptomsByPetType.all),
				dog: normalizeChartSet(stats.symptomsByPetType.dog),
				cat: normalizeChartSet(stats.symptomsByPetType.cat),
				other: normalizeChartSet(stats.symptomsByPetType.other)
			};
		}

		if (Array.isArray(stats.locations)) {
			const palette = ['#ff3b30', '#ff8a00', '#d1f400', '#14b8a6', '#2e92ff', '#a855f7', '#22c55e', '#f43f5e'];
			locationLegendRows = stats.locations.map((row, index) => ({
				name: row.name,
				count: Number(row.count || 0),
				color: palette[index % palette.length]
			}));
		}
	}

	function normalizeChartSet(set) {
		if (!set || !Array.isArray(set.labels) || !Array.isArray(set.values) || !set.labels.length) {
			return { labels: ['No data yet'], values: [0] };
		}
		return set;
	}

	async function refreshDashboardStats() {
		try {
			const stats = await chatbotRequest('dashboard_stats');
			if (stats) applyDashboardStats(stats);
			renderInquiryStats();
			renderConsultationStats();
			renderLocationLegend();
			refreshCharts();
		} catch (error) {
			console.warn('Failed to refresh chatbot dashboard stats:', error);
		}
	}

	function refreshCharts() {
		if (state.consultationChart) {
			state.consultationChart.data.labels = labels;
			state.consultationChart.data.datasets[0].data = consultationSeries;
			state.consultationChart.data.datasets[1].data = inquirySeries;
			state.consultationChart.update();
		}
		if (state.inquiryTypeChart) {
			state.inquiryTypeChart.data.labels = inquiryDistribution.labels;
			state.inquiryTypeChart.data.datasets[0].data = inquiryDistribution.values;
			state.inquiryTypeChart.update();
		}
		if (state.locationPieChart) {
			state.locationPieChart.data.labels = getLocationChartLabels();
			state.locationPieChart.data.datasets[0].data = getLocationChartValues();
			state.locationPieChart.data.datasets[0].backgroundColor = getLocationChartColors();
			state.locationPieChart.update();
		}
		updateSymptomFilter(ui.petTypeFilter?.value || 'all');
	}

	function getLocationChartLabels() {
		return locationLegendRows.length ? locationLegendRows.map((row) => row.name) : ['No data yet'];
	}

	function getLocationChartValues() {
		return locationLegendRows.length ? locationLegendRows.map((row) => Number(row.count || 0)) : [1];
	}

	function getLocationChartColors() {
		return locationLegendRows.length ? locationLegendRows.map((row) => row.color) : ['#9ca3af'];
	}

	if (ui.modalOverlay) {
		ui.modalOverlay.hidden = true;
	}

	function escapeHtml(value) {
		return String(value ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function toDisplayDate(value) {
		const date = value instanceof Date ? value : new Date(value);
		if (Number.isNaN(date.getTime())) {
			return String(value ?? '');
		}
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(date);
	}

	function todayLabel(date = new Date()) {
		return toDisplayDate(date);
	}

	function parseDateValue(value) {
		const date = new Date(`${value}T00:00:00`);
		return Number.isNaN(date.getTime()) ? new Date(0) : date;
	}

	function getIconMeta(iconKey) {
		return iconLibrary[iconKey] || { badge: 'INQ', label: 'Inquiry' };
	}

	function getInquiryTotalCount() {
		return Number(dashboardStats.kpis?.totalInquiries ?? inquiryRules.reduce((sum, rule) => sum + Number(rule.count || 0), 0));
	}

	function formatConsultationDate(value) {
		return toDisplayDate(`${value}T00:00:00`);
	}

	function getConsultationTotalCount() {
		return Number(dashboardStats.kpis?.totalConsultations ?? 0);
	}

	function getConsultationFilteredRows() {
		const query = (ui.consultationSearch?.value || '').trim().toLowerCase();
		let rows = consultationRules.filter((rule) => {
			if (!query) return true;
			const searchable = [rule.petType, rule.symptoms.join(' '), rule.condition, rule.severity, rule.recommendation]
				.join(' ')
				.toLowerCase();
			return searchable.includes(query);
		});

		switch (ui.consultationSort?.value) {
			case 'recent':
				rows = rows.slice().sort((left, right) => parseDateValue(right.lastUpdate) - parseDateValue(left.lastUpdate));
				break;
			case 'severity':
				rows = rows.slice().sort((left, right) => consultationSeverityRank(left.severity) - consultationSeverityRank(right.severity));
				break;
			case 'petType':
				rows = rows.slice().sort((left, right) => left.petType.localeCompare(right.petType));
				break;
			default:
				break;
		}

		return rows;
	}

	function consultationSeverityRank(value) {
		if (value === 'Critical') return 0;
		if (value === 'Active') return 1;
		return 2;
	}

	function severityClass(value) {
		if (value === 'Critical') return 'critical';
		if (value === 'Active') return 'active';
		return 'moderate';
	}

	function severityDot(value) {
		if (value === 'Critical') return '•';
		if (value === 'Active') return '•';
		return '•';
	}

	function getFilteredInquiryRows() {
		const query = (ui.inquirySearch?.value || '').trim().toLowerCase();
		let rows = inquiryRules.filter((rule) => {
			if (!query) return true;
			const searchable = [rule.name, rule.response, rule.actionLabel, rule.redirectPage, rule.buttonLabel]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();
			return searchable.includes(query);
		});

		switch (ui.inquirySort?.value) {
			case 'most-used':
				rows = rows.slice().sort((left, right) => Number(right.count) - Number(left.count) || parseDateValue(right.lastUpdated) - parseDateValue(left.lastUpdated));
				break;
			case 'recent':
				rows = rows.slice().sort((left, right) => parseDateValue(right.lastUpdated) - parseDateValue(left.lastUpdated));
				break;
			case 'name':
				rows = rows.slice().sort((left, right) => left.name.localeCompare(right.name));
				break;
			default:
				break;
		}

		return rows;
	}

	function renderTablePagination(container, page, totalPages) {
		if (!container) return;
		if (totalPages <= 1) {
			container.innerHTML = '';
			return;
		}
		container.innerHTML = `
			<button type="button" class="page-btn" data-page-action="prev" aria-label="Previous page" ${page <= 1 ? 'disabled' : ''}>&lsaquo;</button>
			<button type="button" class="page-btn active" disabled>${page}</button>
			<button type="button" class="page-btn" data-page-action="next" aria-label="Next page" ${page >= totalPages ? 'disabled' : ''}>&rsaquo;</button>
		`;
	}

	function renderInquiryStats() {
		const total = getInquiryTotalCount();
		if (ui.inquiryTotal) ui.inquiryTotal.textContent = String(total);
		if (ui.valueOnlineInquiry) ui.valueOnlineInquiry.textContent = String(total);
		if (ui.valueOnlineConsult) ui.valueOnlineConsult.textContent = String(getConsultationTotalCount());
		if (ui.valueMostCommonSymptom) ui.valueMostCommonSymptom.textContent = dashboardStats.kpis?.mostCommonSymptom || 'No data yet';
		const inquiryRate = Number(dashboardStats.kpis?.inquirySuccessRate ?? 0);
		const inquiryRateEl = document.getElementById('inquiry-success-rate');
		if (inquiryRateEl) inquiryRateEl.textContent = `${inquiryRate}%`;
	}

	function renderConsultationStats() {
		if (ui.consultationTotalCount) ui.consultationTotalCount.textContent = String(getConsultationTotalCount());
		if (ui.consultationAverageResponse) ui.consultationAverageResponse.textContent = '< 2s';
		if (ui.consultationSuccessRate) ui.consultationSuccessRate.textContent = `${Number(dashboardStats.kpis?.consultationSuccessRate ?? 0)}%`;
	}

	function renderConsultationTable() {
		if (!ui.consultationTableBody) return;

		const filteredRows = getConsultationFilteredRows();
		const pageSize = pageSizeForViewport();
		const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
		state.consultationPage = Math.min(state.consultationPage, totalPages);

		const startIndex = (state.consultationPage - 1) * pageSize;
		const pageRows = filteredRows.slice(startIndex, startIndex + pageSize);

		ui.consultationTableBody.innerHTML = pageRows.length
			? pageRows.map((row) => `
				<tr>
					<td>
						<div class="consultation-pet-cell">
							<span class="consultation-icon ${row.petType.toLowerCase()}">${row.petType.charAt(0)}</span>
							<span>${escapeHtml(row.petType)}</span>
						</div>
					</td>
					<td>${escapeHtml(row.symptoms.join('\n')).replace(/\n/g, '<br>')}</td>
					<td><span class="duration-pill ${row.duration === '<24h' ? 'short' : row.duration === '1-3 Days' ? 'typical' : 'persistent'}">${escapeHtml(row.duration)}</span></td>
					<td>${escapeHtml(row.condition)}</td>
					<td><span class="severity-pill ${severityClass(row.severity)}"><span class="severity-dot">${severityDot(row.severity)}</span> ${escapeHtml(row.severity)}</span></td>
					<td class="consultation-recommendation">${escapeHtml(row.recommendation)}</td>
					<td>${escapeHtml(formatConsultationDate(row.lastUpdate))}</td>
					<td>
						<div class="action-group consultation-actions">
							<button type="button" class="action-btn edit" data-action="edit-rule" data-id="${row.id}" aria-label="Edit rule">
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit
							</button>
							<button type="button" class="action-btn delete" data-action="delete-rule" data-id="${row.id}" aria-label="Delete rule">
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Delete
							</button>
						</div>
					</td>
				</tr>
			`).join('')
			: '<tr><td colspan="8">No consultation rules match your search.</td></tr>';

		if (ui.consultationSummary) {
			ui.consultationSummary.textContent = `Displaying ${pageRows.length} of ${filteredRows.length} Results`;
		}
		renderTablePagination(ui.consultationPagination, state.consultationPage, totalPages);
	}

	function setConsultationView(viewName) {
		state.consultationMode = viewName;
		ui.consultationViews.forEach((view) => {
			view.classList.toggle('active', view.dataset.consultationView === viewName);
		});
		if (viewName === 'list') {
			renderConsultationTable();
		}
	}

	function syncConsultationSelection() {
		ui.consultationAnimalGrid?.querySelectorAll('[data-animal]').forEach((button) => {
			button.classList.toggle('active', button.dataset.animal === state.selectedAnimal);
			button.setAttribute('aria-pressed', String(button.dataset.animal === state.selectedAnimal));
		});
		ui.consultationAgeGroupGrid?.querySelectorAll('[data-agegroup]').forEach((button) => {
			button.classList.toggle('active', button.dataset.agegroup === state.selectedAgeGroup);
			button.setAttribute('aria-pressed', String(button.dataset.agegroup === state.selectedAgeGroup));
		});
		ui.consultationSymptomGrid?.querySelectorAll('[data-symptom]').forEach((button) => {
			button.classList.toggle('active', state.selectedSymptoms.includes(button.dataset.symptom));
		});
		ui.consultationDurationGroup?.querySelectorAll('[data-duration]').forEach((button) => {
			button.classList.toggle('active', button.dataset.duration === state.selectedDuration);
		});
	}

	function resetConsultationBuilder() {
		state.consultationEditingId = null;
		state.selectedAnimal = '';
		state.selectedAgeGroup = 'Any';
		state.selectedDuration = '1-3 Days';
		state.selectedSymptoms = [];
		ui.consultationBuilderForm?.reset();
		if (ui.consultationCondition) ui.consultationCondition.value = '';
		if (ui.consultationSeverity) ui.consultationSeverity.value = '';
		if (ui.consultationRecommendation) ui.consultationRecommendation.value = '';
		syncConsultationSelection();
	}

	function openConsultationBuilder(id = null) {
		if (id === null) {
			resetConsultationBuilder();
			if (ui.consultationBuilderTitle) ui.consultationBuilderTitle.textContent = 'Add New Consultation Rule';
			if (ui.consultationBuilderSubmit) ui.consultationBuilderSubmit.textContent = 'Save Rule';
		} else {
			const row = consultationRules.find((item) => item.id === id);
			if (!row) return;
			state.consultationEditingId = id;
			state.selectedAnimal = row.petType;
			state.selectedAgeGroup = row.ageGroup || 'Any';
			state.selectedDuration = row.duration;
			state.selectedSymptoms = [...row.symptoms];
			if (ui.consultationCondition) ui.consultationCondition.value = row.condition;
			if (ui.consultationSeverity) ui.consultationSeverity.value = row.severity;
			if (ui.consultationRecommendation) ui.consultationRecommendation.value = row.recommendation;
			if (ui.consultationBuilderTitle) ui.consultationBuilderTitle.textContent = 'Edit Consultation Rule';
			if (ui.consultationBuilderSubmit) ui.consultationBuilderSubmit.textContent = 'Save Changes';
			syncConsultationSelection();
		}
		setConsultationView('builder');
	}

	function consultationFormValues() {
		return {
			petType: state.selectedAnimal || '',
			ageGroup: state.selectedAgeGroup || 'Any',
			symptoms: [...state.selectedSymptoms],
			duration: state.selectedDuration || '',
			condition: String(ui.consultationCondition?.value || '').trim(),
			severity: String(ui.consultationSeverity?.value || '').trim(),
			recommendation: String(ui.consultationRecommendation?.value || '').trim()
		};
	}

	async function saveConsultationRule(event) {
		event.preventDefault();
		const values = consultationFormValues();
		if (!values.petType || !values.symptoms.length || !values.duration || !values.condition || !values.severity || !values.recommendation) {
			alert('Please complete all required fields.');
			return;
		}

		try {
			const saved = await chatbotRequest('save_consultation', {
				id: state.consultationEditingId || undefined,
				...values
			});

			if (state.consultationEditingId) {
				const index = consultationRules.findIndex((item) => item.id === state.consultationEditingId);
				if (index >= 0) consultationRules[index] = saved;
				openConsultationModal('saved-edit', saved.id);
			} else {
				consultationRules.unshift(saved);
				openConsultationModal('saved-create', saved.id);
			}
		} catch (error) {
			alert(error.message || 'Failed to save consultation rule.');
			return;
		}

		state.consultationPage = 1;
		renderConsultationStats();
		renderConsultationTable();
		void refreshDashboardStats();
		setConsultationView('list');
	}

	function consultationItemById(id) {
		return consultationRules.find((item) => item.id === id);
	}

	function renderConsultationModal(mode, id = null) {
		const row = consultationItemById(id) || {
			petType: state.selectedAnimal || 'Dog',
			ageGroup: state.selectedAgeGroup || 'Any',
			symptoms: [...state.selectedSymptoms],
			duration: state.selectedDuration || '1-3 Days',
			condition: String(ui.consultationCondition?.value || ''),
			severity: String(ui.consultationSeverity?.value || ''),
			recommendation: String(ui.consultationRecommendation?.value || ''),
			lastUpdate: new Date().toISOString().slice(0, 10)
		};

		const rows = [
			['Pet Type', row.petType],
			['Age Group', row.ageGroup || 'Any'],
			['Symptoms', row.symptoms.join(', ')],
			['Symptoms Duration', row.duration],
			['Possible Condition', row.condition],
			['Severity', row.severity],
			['Recommendation', row.recommendation]
		];

		if (mode === 'delete-rule') {
			return `
				<h2 class="modal-title" id="modal-title">Delete Consultation Rule?</h2>
				<p class="modal-subtitle">This action is permanent and cannot be undone. All consultation data and associated records will be archived.</p>
				<div class="danger-card consultation-danger-card">
					${rows.map(([label, value]) => `<div class="detail-row"><strong>${label}</strong><span>${escapeHtml(value)}</span></div>`).join('')}
				</div>
				<label class="field" for="consultation-delete-confirm">
					<span>Type DELETE to confirm</span>
					<input class="confirm-input" id="consultation-delete-confirm" type="text" placeholder="DELETE" autocomplete="off">
				</label>
				<div class="modal-footer">
					<button type="button" class="btn btn-soft" data-modal-action="close-modal">No, Keep</button>
					<button type="button" class="btn btn-danger" data-modal-action="confirm-delete-rule" data-id="${row.id}">Confirm Delete</button>
				</div>
			`;
		}

		if (mode === 'edit-rule') {
			return `
				<h2 class="modal-title" id="modal-title">Edit Consultation Rule</h2>
				<p class="modal-subtitle">Update the rule details and keep the triage behavior consistent.</p>
				<form id="consultation-edit-form">
					<div class="form-grid consultation-modal-grid">
						<label class="field span-2"><span>Symptoms*</span><input id="consultation-edit-symptoms" type="text" value="${escapeHtml(row.symptoms.join(', '))}" placeholder="Vomiting, Lethargy"></label>
						<label class="field"><span>Possible Condition*</span><input id="consultation-edit-condition" type="text" value="${escapeHtml(row.condition)}"></label>
						<label class="field"><span>Severity</span><select id="consultation-edit-severity"><option value="Critical" ${row.severity === 'Critical' ? 'selected' : ''}>Critical</option><option value="Active" ${row.severity === 'Active' ? 'selected' : ''}>Active</option><option value="Moderate" ${row.severity === 'Moderate' ? 'selected' : ''}>Moderate</option></select></label>
						<label class="field span-2"><span>Recommendation*</span><textarea id="consultation-edit-recommendation">${escapeHtml(row.recommendation)}</textarea></label>
					</div>
					<div class="modal-footer">
						<button type="button" class="btn btn-soft" data-modal-action="close-modal">Cancel</button>
						<button type="submit" class="btn btn-primary">Save Changes</button>
					</div>
				</form>
			`;
		}

		if (mode === 'saved-create' || mode === 'saved-edit') {
			return `
				<h2 class="modal-title" id="modal-title">${mode === 'saved-create' ? 'Rule Created' : 'Rule Updated'}</h2>
				<p class="modal-subtitle">${mode === 'saved-create' ? 'The rule was added locally and will be sent to the backend later.' : 'The changes were saved locally and will be sent to the backend later.'}</p>
				<div class="danger-card consultation-danger-card">
					${rows.map(([label, value]) => `<div class="detail-row"><strong>${label}</strong><span>${escapeHtml(value)}</span></div>`).join('')}
				</div>
				<div class="modal-footer">
					<button type="button" class="btn btn-primary" data-modal-action="close-modal">Close</button>
				</div>
			`;
		}

		return `
			<h2 class="modal-title" id="modal-title">Create New Symptoms</h2>
			<p class="modal-subtitle">Add a custom symptom chip that can be used in future consultation rules.</p>
			<form id="symptom-create-form">
				<div class="form-grid">
					<label class="field span-2"><span>Symptoms Name*</span><input id="new-symptom-name" type="text" placeholder="e.g. Excessive Drooling"></label>
					<label class="field"><span>Category*</span><input id="new-symptom-category" type="text" placeholder="General"></label>
					<label class="field"><span>Urgent Symptom</span><select id="new-symptom-urgent"><option value="no">No</option><option value="yes">Yes</option></select></label>
				</div>
				<div class="modal-footer">
					<button type="button" class="btn btn-soft" data-modal-action="close-modal">Cancel</button>
					<button type="submit" class="btn btn-primary">Add Symptoms</button>
				</div>
			</form>
		`;
	}

	function openConsultationModal(mode, id = null) {
		if (!ui.modalOverlay || !ui.modalContent || !ui.modalShell) return;
		ui.modalShell.classList.remove('modal-sm', 'modal-md');
		if (mode === 'delete-rule') {
			ui.modalShell.classList.add('modal-sm');
		} else {
			ui.modalShell.classList.add('modal-md');
		}
		ui.modalContent.innerHTML = renderConsultationModal(mode, id);
		ui.modalOverlay.hidden = false;
		document.body.style.overflow = 'hidden';
	}

	async function deleteConsultationRule(id) {
		try {
			await chatbotRequest('delete_consultation', { id });
			const index = consultationRules.findIndex((item) => item.id === id);
			if (index >= 0) consultationRules.splice(index, 1);
		} catch (error) {
			alert(error.message || 'Failed to delete consultation rule.');
			return;
		}
		state.consultationPage = 1;
		renderConsultationStats();
		renderConsultationTable();
		void refreshDashboardStats();
		setConsultationView('list');
		closeModal();
	}

	function handleConsultationAction(action, id) {
		if (action === 'edit-rule') {
			state.consultationEditingId = Number(id);
			openConsultationModal('edit-rule', Number(id));
			return;
		}

		if (action === 'delete-rule') {
			state.consultationDeletingId = Number(id);
			openConsultationModal('delete-rule', Number(id));
			return;
		}

		if (action === 'confirm-delete-rule') {
			const input = document.getElementById('consultation-delete-confirm');
			if (!input || input.value.trim().toUpperCase() !== 'DELETE') return;
			void deleteConsultationRule(Number(id || state.consultationDeletingId || 0));
		}
	}

	function handleConsultationSelection(type, value) {
		if (type === 'animal') {
			state.selectedAnimal = value;
		}
		if (type === 'ageGroup') {
			state.selectedAgeGroup = value;
		}
		if (type === 'duration') {
			state.selectedDuration = value;
		}
		if (type === 'symptom') {
			if (state.selectedSymptoms.includes(value)) {
				state.selectedSymptoms = state.selectedSymptoms.filter((item) => item !== value);
			} else {
				state.selectedSymptoms = [...state.selectedSymptoms, value];
			}
		}
		syncConsultationSelection();
	}

	function renderInquiryTable() {
		if (!ui.inquiryTableBody) return;

		const filteredRows = getFilteredInquiryRows();
		const pageSize = pageSizeForViewport();
		const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
		state.inquiryPage = Math.min(state.inquiryPage, totalPages);

		const startIndex = (state.inquiryPage - 1) * pageSize;
		const pageRows = filteredRows.slice(startIndex, startIndex + pageSize);

		ui.inquiryTableBody.innerHTML = pageRows.length
			? pageRows.map((rule) => {
				const iconMeta = getIconMeta(rule.icon);
				const responseHtml = escapeHtml(rule.response).replace(/\n/g, '<br>');
				return `
					<tr>
						<td>
							<div class="rule-cell">
								<span class="rule-icon">${escapeHtml(iconMeta.badge)}</span>
								<div>
									<span class="rule-title">${escapeHtml(rule.name)}</span>
									<span class="rule-subtitle">${escapeHtml(rule.actionLabel || 'No action')}</span>
								</div>
							</div>
						</td>
						<td><div class="response-copy">${responseHtml}</div></td>
						<td>${escapeHtml(toDisplayDate(`${rule.lastUpdated}T00:00:00`))}</td>
						<td>${Number(rule.count || 0).toLocaleString()}</td>
						<td>
							<div class="action-group">
								<button type="button" class="action-btn view" data-action="view-inquiry" data-id="${rule.id}">View</button>
								<button type="button" class="action-btn edit" data-action="edit-inquiry" data-id="${rule.id}">Edit</button>
								<button type="button" class="action-btn delete" data-action="delete-inquiry" data-id="${rule.id}">Delete</button>
							</div>
						</td>
					</tr>
				`;
			}).join('')
			: `
				<tr>
					<td colspan="5">No inquiry rules match your search.</td>
				</tr>
			`;

		if (ui.inquirySummary) {
			ui.inquirySummary.textContent = `Displaying ${pageRows.length} of ${filteredRows.length} Categories`;
		}
		renderTablePagination(ui.inquiryPagination, state.inquiryPage, totalPages);
	}

	function renderLocationLegend() {
		if (!ui.locationLegend) return;
		ui.locationLegend.innerHTML = locationLegendRows.length ? locationLegendRows.map((row) => `
			<li>
				<span class="legend-dot" style="background:${row.color}"></span>
				<span>${escapeHtml(row.name)}${row.count != null ? ` (${Number(row.count)})` : ''}</span>
			</li>
		`).join('') : '<li><span class="legend-dot" style="background:#9ca3af"></span><span>No location data yet</span></li>';
	}

	function updateSourceFilter(source) {
		if (!state.consultationChart) return;
		const showConsultation = source === 'all' || source === 'consultation';
		const showInquiry = source === 'all' || source === 'inquiry';
		state.consultationChart.data.datasets[0].hidden = !showConsultation;
		state.consultationChart.data.datasets[1].hidden = !showInquiry;
		state.consultationChart.update();
	}

	function updateSymptomFilter(petType) {
		if (!state.symptomsChart) return;
		const dataSet = symptomsByPetType[petType] || symptomsByPetType.all;
		state.symptomsChart.data.labels = dataSet.labels;
		state.symptomsChart.data.datasets[0].data = dataSet.values;
		state.symptomsChart.options.scales.x.max = Math.max(5, ...dataSet.values);
		state.symptomsChart.update();
	}

	function ensureCharts() {
		if (state.chartsReady || !window.Chart) return;

		const consultationChartCtx = document.getElementById('consultationInquiryChart');
		const inquiryTypeChartCtx = document.getElementById('inquiryTypeChart');
		const locationPieChartCtx = document.getElementById('locationPieChart');
		const symptomsChartCtx = document.getElementById('symptomsChart');
		if (!consultationChartCtx || !inquiryTypeChartCtx || !locationPieChartCtx || !symptomsChartCtx) return;

		const gridColor = 'rgba(154, 196, 244, 0.14)';
		const tickColor = 'rgba(201, 223, 250, 0.8)';
		const consultationGradient = consultationChartCtx.getContext('2d').createLinearGradient(0, 0, 0, 230);
		consultationGradient.addColorStop(0, 'rgba(94, 191, 255, 0.45)');
		consultationGradient.addColorStop(1, 'rgba(94, 191, 255, 0.02)');
		const inquiryGradient = consultationChartCtx.getContext('2d').createLinearGradient(0, 0, 0, 230);
		inquiryGradient.addColorStop(0, 'rgba(58, 237, 113, 0.45)');
		inquiryGradient.addColorStop(1, 'rgba(58, 237, 113, 0.02)');

		state.consultationChart = new Chart(consultationChartCtx, {
			type: 'line',
			data: {
				labels,
				datasets: [
					{
						label: 'Consultation',
						data: consultationSeries,
						borderColor: '#8ad3ff',
						pointBackgroundColor: '#8ad3ff',
						pointRadius: 2,
						tension: 0.35,
						fill: true,
						backgroundColor: consultationGradient
					},
					{
						label: 'Inquiry',
						data: inquirySeries,
						borderColor: '#31e17a',
						pointBackgroundColor: '#31e17a',
						pointRadius: 2,
						tension: 0.35,
						fill: true,
						backgroundColor: inquiryGradient
					}
				]
			},
			options: {
				maintainAspectRatio: false,
				plugins: {
					legend: {
						display: true,
						position: 'bottom',
						labels: {
							color: tickColor,
							boxWidth: 14,
							boxHeight: 6,
							padding: 16
						}
					}
				},
				scales: {
					x: {
						ticks: {
							color: tickColor,
							maxRotation: 0,
							autoSkip: true,
							font: { size: 9 }
						},
						grid: { color: gridColor }
					},
					y: {
						beginAtZero: true,
						ticks: {
							color: tickColor,
							precision: 0,
							stepSize: 2,
							font: { size: 9 }
						},
						grid: { color: gridColor }
					}
				}
			}
		});

		state.inquiryTypeChart = new Chart(inquiryTypeChartCtx, {
			type: 'bar',
			data: {
				labels: inquiryDistribution.labels,
				datasets: [
					{ label: 'Uses', data: inquiryDistribution.values, backgroundColor: '#19b344', borderRadius: 6 }
				]
			},
			options: {
				maintainAspectRatio: false,
				plugins: {
					legend: {
						display: true,
						position: 'bottom',
						labels: {
							color: tickColor,
							boxWidth: 12,
							boxHeight: 12,
							padding: 16
						}
					}
				},
				scales: {
					x: {
						ticks: {
							color: tickColor,
							font: { size: 9 },
							maxRotation: 35,
							minRotation: 0
						},
						grid: { color: gridColor }
					},
					y: {
						beginAtZero: true,
						ticks: {
							color: tickColor,
							precision: 0,
							font: { size: 9 }
						},
						grid: { color: gridColor }
					}
				}
			}
		});

		state.symptomsChart = new Chart(symptomsChartCtx, {
			type: 'bar',
			data: {
				labels: symptomsByPetType.all.labels,
				datasets: [
					{
						label: 'Cases',
						data: symptomsByPetType.all.values,
						borderRadius: 6,
						backgroundColor: '#22c55e',
						borderColor: '#67e8a0',
						borderWidth: 1,
						barPercentage: 0.62
					}
				]
			},
			options: {
				indexAxis: 'y',
				maintainAspectRatio: false,
				plugins: {
					legend: { display: false }
				},
				scales: {
					x: {
						beginAtZero: true,
						max: 100,
						ticks: {
							color: tickColor,
							font: { size: 9 }
						},
						grid: { color: gridColor }
					},
					y: {
						ticks: {
							color: tickColor,
							font: { size: 9 }
						},
						grid: { color: 'rgba(154, 196, 244, 0.06)' }
					}
				}
			}
		});

		state.locationPieChart = new Chart(locationPieChartCtx, {
			type: 'doughnut',
			data: {
				labels: getLocationChartLabels(),
				datasets: [
					{
						data: getLocationChartValues(),
						backgroundColor: getLocationChartColors(),
						borderColor: '#0f1f3a',
						borderWidth: 2,
						hoverOffset: 8
					}
				]
			},
			options: {
				maintainAspectRatio: false,
				cutout: '58%',
				plugins: {
					legend: { display: false },
					tooltip: {
						callbacks: {
							label(context) {
								const value = Number(context.parsed || 0);
								const total = context.dataset.data.reduce((sum, item) => sum + Number(item || 0), 0);
								const pct = total ? Math.round((value / total) * 100) : 0;
								return `${context.label}: ${value} chats (${pct}%)`;
							}
						}
					}
				}
			}
		});

		state.chartsReady = true;
		updateSourceFilter(ui.sourceFilter?.value || 'all');
		updateSymptomFilter(ui.petTypeFilter?.value || 'all');
	}

	function renderInquiryModal(mode, id = null) {
		const rule = inquiryRules.find((item) => item.id === id) || {
			name: '',
			icon: 'clock',
			response: '',
			count: 0,
			lastUpdated: todayLabel(),
			actionType: 'no-action',
			actionLabel: 'No action',
			redirectPage: '',
			buttonLabel: ''
		};

		if (mode === 'view') {
			const iconMeta = getIconMeta(rule.icon);
			return `
				<h2 class="modal-title" id="modal-title">Inquiry Rule Details</h2>
				<p class="modal-subtitle">Review the rule, its response text, and the attached action.</p>
				<div class="detail-grid">
					<div class="detail-panel">
						<h3>Rule Information</h3>
						<div class="detail-list">
							<div class="detail-row"><strong>Name</strong><span>${escapeHtml(rule.name)}</span></div>
							<div class="detail-row"><strong>Icon</strong><span>${escapeHtml(iconMeta.label)}</span></div>
							<div class="detail-row"><strong>Action</strong><span>${escapeHtml(rule.actionLabel || 'No action')}</span></div>
							<div class="detail-row"><strong>Redirect Page</strong><span>${escapeHtml(rule.redirectPage || 'None')}</span></div>
							<div class="detail-row"><strong>Button Label</strong><span>${escapeHtml(rule.buttonLabel || 'None')}</span></div>
							<div class="detail-row"><strong>Last Updated</strong><span>${escapeHtml(toDisplayDate(`${rule.lastUpdated}T00:00:00`))}</span></div>
							<div class="detail-row"><strong>Inquiry Count</strong><span>${Number(rule.count || 0).toLocaleString()}</span></div>
						</div>
					</div>
					<div class="detail-panel">
						<h3>Automated Response</h3>
						<p class="hint-line">${escapeHtml(rule.response).replace(/\n/g, '<br>')}</p>
					</div>
				</div>
				<div class="modal-footer">
					<button type="button" class="btn btn-soft" data-modal-action="edit-inquiry" data-id="${rule.id}">Edit</button>
					<button type="button" class="btn btn-danger" data-modal-action="delete-inquiry" data-id="${rule.id}">Delete</button>
					<button type="button" class="btn btn-primary" data-modal-action="close-modal">Close</button>
				</div>
			`;
		}

		if (mode === 'delete') {
			const iconMeta = getIconMeta(rule.icon);
			return `
				<h2 class="modal-title" id="modal-title">Delete Inquiry Type?</h2>
				<p class="modal-subtitle">This action is permanent and cannot be undone. Type DELETE to confirm.</p>
				<div class="danger-card">
					<div class="rule-cell">
						<span class="rule-icon">${escapeHtml(iconMeta.badge)}</span>
						<div>
							<span class="rule-title">${escapeHtml(rule.name)}</span>
							<span class="rule-subtitle">${escapeHtml(rule.actionLabel || 'No action')}</span>
						</div>
					</div>
					<div class="detail-list">
						<div class="detail-row"><strong>Last Updated</strong><span>${escapeHtml(toDisplayDate(`${rule.lastUpdated}T00:00:00`))}</span></div>
						<div class="detail-row"><strong>Inquiry Count</strong><span>${Number(rule.count || 0).toLocaleString()}</span></div>
						<div class="detail-row"><strong>Response</strong><span>${escapeHtml(rule.response.split('\n')[0] || '...')}</span></div>
					</div>
				</div>
				<label class="field" for="delete-confirm-input">
					<span>Type DELETE to confirm</span>
					<input class="confirm-input" id="delete-confirm-input" type="text" placeholder="DELETE" autocomplete="off">
				</label>
				<div class="modal-footer">
					<button type="button" class="btn btn-soft" data-modal-action="close-modal">No, Keep</button>
					<button type="button" class="btn btn-danger" data-modal-action="confirm-delete-inquiry" data-id="${rule.id}">Confirm Delete</button>
				</div>
			`;
		}

		const isEdit = mode === 'edit';
		const title = isEdit ? 'Edit Inquiry Type' : 'Add New Inquiry Type';
		const buttonText = isEdit ? 'Save Changes' : 'Add Inquiry';
		return `
			<h2 class="modal-title" id="modal-title">${title}</h2>
			<p class="modal-subtitle">${isEdit ? 'Update the current rule and keep the chatbot response consistent.' : 'Create a new inquiry rule for the chatbot.'}</p>
			<form id="inquiry-form">
				<div class="form-grid">
					<label class="field span-2" for="inquiry-name">
						<span>Inquiry Type *</span>
						<input id="inquiry-name" name="name" type="text" value="${escapeHtml(rule.name)}" placeholder="e.g. Pet Certificate Requirements" required>
					</label>
					<label class="field" for="inquiry-icon">
						<span>Icon *</span>
						<select id="inquiry-icon" name="icon" required>
							<option value="clock" ${rule.icon === 'clock' ? 'selected' : ''}>Clock</option>
							<option value="syringe" ${rule.icon === 'syringe' ? 'selected' : ''}>Syringe</option>
							<option value="clipboard" ${rule.icon === 'clipboard' ? 'selected' : ''}>Clipboard</option>
							<option value="link" ${rule.icon === 'link' ? 'selected' : ''}>Link</option>
							<option value="chat" ${rule.icon === 'chat' ? 'selected' : ''}>Chat</option>
							<option value="pin" ${rule.icon === 'pin' ? 'selected' : ''}>Map Pin</option>
						</select>
					</label>
					<label class="field" for="inquiry-action">
						<span>Primary Action</span>
						<select id="inquiry-action" name="actionType">
							<option value="no-action" ${rule.actionType === 'no-action' ? 'selected' : ''}>No action</option>
							<option value="redirect" ${rule.actionType === 'redirect' ? 'selected' : ''}>Redirect to page</option>
							<option value="booking" ${rule.actionType === 'booking' ? 'selected' : ''}>Open booking flow</option>
							<option value="support" ${rule.actionType === 'support' ? 'selected' : ''}>Open support link</option>
						</select>
					</label>
					<label class="field span-2" for="inquiry-response">
						<span>Automated Response *</span>
						<textarea id="inquiry-response" name="response" placeholder="Enter the message the chatbot should send when this inquiry type is selected..." required>${escapeHtml(rule.response)}</textarea>
					</label>
					<label class="field" for="inquiry-redirect-page">
						<span>Redirect Page</span>
						<select id="inquiry-redirect-page" name="redirectPage">
							<option value="" ${!rule.redirectPage ? 'selected' : ''}>No redirect</option>
							<option value="Book Appointment" ${rule.redirectPage === 'Book Appointment' ? 'selected' : ''}>Book Appointment</option>
							<option value="Appointment Management" ${rule.redirectPage === 'Appointment Management' ? 'selected' : ''}>Appointment Management</option>
							<option value="Lost And Found" ${rule.redirectPage === 'Lost And Found' ? 'selected' : ''}>Lost And Found</option>
						</select>
					</label>
					<label class="field" for="inquiry-button-label">
						<span>Button Label</span>
						<input id="inquiry-button-label" name="buttonLabel" type="text" value="${escapeHtml(rule.buttonLabel)}" placeholder="e.g. Schedule Now">
					</label>
				</div>
				<div class="modal-footer">
					<button type="button" class="btn btn-soft" data-modal-action="close-modal">Cancel</button>
					<button type="submit" class="btn btn-primary">${buttonText}</button>
				</div>
			</form>
		`;
	}

	function openInquiryModal(mode = 'add', id = null) {
		state.inquiryEditingId = mode === 'edit' ? id : null;
		state.inquiryViewingId = mode === 'view' ? id : null;
		state.inquiryDeletingId = mode === 'delete' ? id : null;

		if (!ui.modalShell || !ui.modalContent || !ui.modalOverlay) return;
		ui.modalShell.classList.remove('modal-sm', 'modal-md');
		if (mode === 'delete') {
			ui.modalShell.classList.add('modal-sm');
		} else {
			ui.modalShell.classList.add('modal-md');
		}
		ui.modalContent.innerHTML = renderInquiryModal(mode, id);
		ui.modalOverlay.hidden = false;
		document.body.style.overflow = 'hidden';
	}

	function closeModal() {
		if (!ui.modalOverlay || !ui.modalContent) return;
		ui.modalOverlay.hidden = true;
		ui.modalContent.innerHTML = '';
		document.body.style.overflow = '';
		state.inquiryEditingId = null;
		state.inquiryViewingId = null;
		state.inquiryDeletingId = null;
		state.consultationEditingId = null;
		state.consultationViewingId = null;
		state.consultationDeletingId = null;
	}

	function readInquiryForm(form) {
		const formData = new FormData(form);
		const name = String(formData.get('name') || '').trim();
		const icon = String(formData.get('icon') || 'clock');
		const response = String(formData.get('response') || '').trim();
		const actionType = String(formData.get('actionType') || 'no-action');
		const redirectPage = String(formData.get('redirectPage') || '').trim();
		const buttonLabel = String(formData.get('buttonLabel') || '').trim();

		return {
			name,
			icon,
			response,
			actionType,
			redirectPage,
			buttonLabel,
			actionLabel: buttonLabel || (actionType === 'no-action' ? 'No action' : actionType === 'booking' ? 'Open booking flow' : actionType === 'support' ? 'Open support link' : 'Redirect')
		};
	}

	async function handleInquirySubmit(event, formElement = null) {
		event.preventDefault();
		const form = formElement || event.target.closest('#inquiry-form');
		if (!form) return;
		const data = readInquiryForm(form);
		if (!data.name || !data.response) return;

		try {
			const saved = await chatbotRequest('save_inquiry', {
				id: state.inquiryEditingId || undefined,
				...data
			});

			if (state.inquiryEditingId) {
				const index = inquiryRules.findIndex((item) => item.id === state.inquiryEditingId);
				if (index >= 0) inquiryRules[index] = saved;
			} else {
				inquiryRules.unshift(saved);
			}
		} catch (error) {
			alert(error.message || 'Failed to save inquiry rule.');
			return;
		}

		state.inquiryPage = 1;
		renderInquiryStats();
		renderInquiryTable();
		void refreshDashboardStats();
		closeModal();
	}

	async function confirmDeleteInquiry() {
		const targetId = state.inquiryDeletingId;
		if (!targetId) return;
		const input = document.getElementById('delete-confirm-input');
		if (!input || input.value.trim().toUpperCase() !== 'DELETE') return;

		try {
			await chatbotRequest('delete_inquiry', { id: targetId });
			const index = inquiryRules.findIndex((item) => item.id === targetId);
			if (index >= 0) inquiryRules.splice(index, 1);
		} catch (error) {
			alert(error.message || 'Failed to delete inquiry rule.');
			return;
		}
		state.inquiryPage = 1;
		renderInquiryStats();
		renderInquiryTable();
		void refreshDashboardStats();
		closeModal();
	}

	function handleModalAction(action, id) {
		if (action === 'close-modal') {
			closeModal();
			return;
		}

		if (action === 'edit-inquiry') {
			openInquiryModal('edit', Number(id || state.inquiryViewingId || state.inquiryEditingId || state.inquiryDeletingId || 0));
			return;
		}

		if (action === 'delete-inquiry') {
			openInquiryModal('delete', Number(id || state.inquiryViewingId || state.inquiryEditingId || state.inquiryDeletingId || 0));
			return;
		}

		if (action === 'confirm-delete-inquiry') {
			void confirmDeleteInquiry();
		}
	}

	function setActiveTab(tabName) {
		console.log('Switching to tab:', tabName);
		state.activeTab = tabName;
		ui.tabButtons.forEach((button) => {
			const isActive = button.dataset.tabTarget === tabName;
			button.classList.toggle('active', isActive);
			button.setAttribute('aria-selected', String(isActive));
		});
		ui.panels.forEach((panel) => {
			panel.classList.toggle('active', panel.dataset.panel === tabName);
		});

		if (tabName === 'home') {
			ensureCharts();
		} else if (tabName === 'consultation') {
			setConsultationView('list');
		}
	}

	function bindEvents() {
		ui.tabButtons.forEach((button) => {
			button.addEventListener('click', () => setActiveTab(button.dataset.tabTarget));
		});

		ui.inquirySearch?.addEventListener('input', () => {
			state.inquiryPage = 1;
			renderInquiryTable();
		});

		ui.inquirySort?.addEventListener('change', () => {
			state.inquiryPage = 1;
			renderInquiryTable();
		});

		ui.inquiryPagination?.addEventListener('click', (event) => {
			const button = event.target.closest('[data-page-action]');
			if (!button) return;
			if (button.dataset.pageAction === 'prev') {
				state.inquiryPage = Math.max(1, state.inquiryPage - 1);
			} else {
				state.inquiryPage += 1;
			}
			renderInquiryTable();
		});

		ui.openInquiryModal?.addEventListener('click', () => openInquiryModal('add'));
		ui.openConsultationBuilder?.addEventListener('click', () => openConsultationBuilder());
		ui.consultationBackBtn?.addEventListener('click', () => setConsultationView('list'));
		ui.consultationBuilderCancel?.addEventListener('click', () => setConsultationView('list'));
		ui.consultationBuilderForm?.addEventListener('submit', saveConsultationRule);
		ui.consultationPagination?.addEventListener('click', (event) => {
			const button = event.target.closest('[data-page-action]');
			if (!button) return;
			if (button.dataset.pageAction === 'prev') {
				state.consultationPage = Math.max(1, state.consultationPage - 1);
			} else {
				state.consultationPage += 1;
			}
			renderConsultationTable();
		});
		ui.consultationSearch?.addEventListener('input', () => {
			state.consultationPage = 1;
			renderConsultationTable();
		});
		ui.consultationSort?.addEventListener('change', () => {
			state.consultationPage = 1;
			renderConsultationTable();
		});
		ui.consultationTableBody?.addEventListener('click', (event) => {
			const button = event.target.closest('[data-action]');
			if (!button) return;
			handleConsultationAction(button.dataset.action, button.dataset.id);
		});
		ui.consultationAnimalGrid?.addEventListener('click', (event) => {
			const button = event.target.closest('[data-animal]');
			if (!button) return;
			handleConsultationSelection('animal', button.dataset.animal);
		});
		ui.consultationAgeGroupGrid?.addEventListener('click', (event) => {
			const button = event.target.closest('[data-agegroup]');
			if (!button) return;
			handleConsultationSelection('ageGroup', button.dataset.agegroup);
		});
		ui.consultationSymptomGrid?.addEventListener('click', (event) => {
			const button = event.target.closest('[data-symptom]');
			if (!button) return;
			handleConsultationSelection('symptom', button.dataset.symptom);
		});
		ui.consultationDurationGroup?.addEventListener('click', (event) => {
			const button = event.target.closest('[data-duration]');
			if (!button) return;
			handleConsultationSelection('duration', button.dataset.duration);
		});
		ui.openSymptomModal = document.getElementById('open-symptom-modal');
		ui.openSymptomModal?.addEventListener('click', () => openConsultationModal('create-symptom'));

		ui.inquiryTableBody?.addEventListener('click', (event) => {
			const button = event.target.closest('[data-action]');
			if (!button) return;
			const id = Number(button.dataset.id || 0);
			const action = button.dataset.action;

			if (action === 'view-inquiry') {
				openInquiryModal('view', id);
				return;
			}

			if (action === 'edit-inquiry') {
				openInquiryModal('edit', id);
				return;
			}

			if (action === 'delete-inquiry') {
				openInquiryModal('delete', id);
			}
		});

		ui.modalOverlay?.addEventListener('click', (event) => {
			if (event.target === ui.modalOverlay) {
				closeModal();
			}
		});

		ui.modalClose?.addEventListener('click', closeModal);

		ui.modalContent?.addEventListener('click', (event) => {
			const button = event.target.closest('[data-modal-action]');
			if (!button) return;
			const modalAction = button.dataset.modalAction;
			if (modalAction === 'confirm-delete-rule' || modalAction === 'edit-rule' || modalAction === 'delete-rule') {
				handleConsultationAction(modalAction, button.dataset.id);
				return;
			}
			handleModalAction(modalAction, button.dataset.id);
		});

		ui.modalContent?.addEventListener('submit', async (event) => {
			const form = event.target.closest('#inquiry-form');
			if (form) {
				await handleInquirySubmit(event, form);
				return;
			}

			const editForm = event.target.closest('#consultation-edit-form');
			if (editForm) {
				event.preventDefault();
				const row = consultationItemById(Number(state.consultationEditingId || 0));
				if (!row) return;
				const payload = {
					id: row.id,
					petType: row.petType,
					duration: row.duration,
					symptoms: String(document.getElementById('consultation-edit-symptoms')?.value || '').split(',').map((item) => item.trim()).filter(Boolean),
					condition: String(document.getElementById('consultation-edit-condition')?.value || '').trim(),
					severity: String(document.getElementById('consultation-edit-severity')?.value || '').trim(),
					recommendation: String(document.getElementById('consultation-edit-recommendation')?.value || '').trim()
				};
				try {
					const saved = await chatbotRequest('save_consultation', payload);
					const index = consultationRules.findIndex((item) => item.id === row.id);
					if (index >= 0) consultationRules[index] = saved;
				} catch (error) {
					alert(error.message || 'Failed to update consultation rule.');
					return;
				}
				state.consultationPage = 1;
				renderConsultationStats();
				renderConsultationTable();
				void refreshDashboardStats();
				closeModal();
				return;
			}

			const symptomForm = event.target.closest('#symptom-create-form');
			if (symptomForm) {
				event.preventDefault();
				const symptom = String(document.getElementById('new-symptom-name')?.value || '').trim();
				if (!symptom) return;
				if (!state.selectedSymptoms.includes(symptom)) {
					state.selectedSymptoms = [...state.selectedSymptoms, symptom];
					syncConsultationSelection();
				}
				closeModal();
			}
		});

		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && ui.modalOverlay && !ui.modalOverlay.hidden) {
				closeModal();
			}
		});

		ui.sourceFilter?.addEventListener('change', (event) => updateSourceFilter(event.target.value));
		ui.petTypeFilter?.addEventListener('change', (event) => updateSymptomFilter(event.target.value));
	}

	await loadChatbotRules();
	renderLocationLegend();
	renderInquiryStats();
	renderInquiryTable();
	renderConsultationStats();
	renderConsultationTable();
	bindEvents();
	setActiveTab('home');
});

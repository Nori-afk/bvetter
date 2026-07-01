const STORAGE_KEY = 'vbetter.patient-records';

function appBasePath() {
	const script = document.currentScript || Array.from(document.scripts).find((item) => item.src && item.src.includes('/vet/js/patient-records.js'));
	const path = script?.src ? new URL(script.src).pathname : window.location.pathname;
	const jsMarker = '/vet/js/patient-records.js';
	if (path.includes(jsMarker)) return path.slice(0, path.indexOf(jsMarker));
	const pageMarker = '/vet/html/';
	if (path.includes(pageMarker)) return path.slice(0, path.indexOf(pageMarker));
	return '/bvetter';
}

const PATIENT_API = `${appBasePath()}/api/patient-records/patient_records.php`;

const ICONS = {
	eye: `
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path>
			<circle cx="12" cy="12" r="3"></circle>
		</svg>
	`,
	pencil: `
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M12 20h9"></path>
			<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
		</svg>
	`,
	trash: `
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M3 6h18"></path>
			<path d="M8 6V4h8v2"></path>
			<path d="M19 6l-1 14H6L5 6"></path>
			<path d="M10 11v6"></path>
			<path d="M14 11v6"></path>
		</svg>
	`,
	plus: `
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M12 5v14"></path>
			<path d="M5 12h14"></path>
		</svg>
	`,
	check: `
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M20 6 9 17l-5-5"></path>
		</svg>
	`
};

const defaultRecords = [
	{
		id: 1,
		petName: 'Copper',
		species: 'Canine',
		breed: 'Golden Retriever',
		age: '2 years old',
		sex: 'Female',
		weight: '32.5 kg',
		colorMarkings: 'Golden / Honey coat, white patch on chest',
		ownerName: 'Sarah Mitchell',
		phone: '+1 (555) 123-4567',
		email: 's.mitchell@design-studio.com',
		address: '123 Harbor St., Brgy. Poblacion, Balanga City',
		location: 'Brgy. Pagala',
		status: 'Active Patient',
		statusType: 'success',
		recordCount: 14,
		lastVisit: 'Oct 24, 2023',
		healthStatus: 'Good Standing',
		alert: '1 Pending',
		visitTitle: 'Annual Checkup, Post-Surgery Follow-up',
		visitDate: '2023-10-24',
		followUpDate: '2023-11-12',
		symptoms: 'Normal appetite, routine coat shedding, no pain response.',
		diagnosis: 'Stable recovery. Continue observation and exercise restriction.',
		treatment: 'General examination, wound check, routine immunization.',
		medications: ['Amoxicillin 250mg', 'Meloxicam 7.5mg'],
		category: 'Routine Checkup',
		attendingVet: 'Dr. Kizea Bien Igaya',
		vaccinationStatus: 'Up to date',
		vaccineBrand: 'DHPPi-L 5-in-1',
		history: [
			{ date: '2023-10-24', title: 'Annual Checkup', note: 'Stable vitals and clean incision site.' },
			{ date: '2023-08-18', title: 'Post-surgery follow-up', note: 'Healing progressed as expected.' }
		]
	},
	{
		id: 2,
		petName: 'Buddy',
		species: 'Canine',
		breed: 'Golden Retriever',
		age: '3 years old',
		sex: 'Male',
		weight: '28.8 kg',
		colorMarkings: 'Cream coat, darker ears',
		ownerName: 'Robert Santos',
		phone: '+1 (555) 654-2109',
		email: 'robert.santos@email.com',
		address: '0361 Brgy. Pagsanjan, Bataan',
		location: 'Brgy. Tibag',
		status: 'Active Patient',
		statusType: 'success',
		recordCount: 9,
		lastVisit: 'Oct 15, 2023',
		healthStatus: 'Improving',
		alert: 'Vaccination due',
		visitTitle: 'Dermatitis Review',
		visitDate: '2023-10-15',
		followUpDate: '2023-11-05',
		symptoms: 'Mild skin irritation and scratching around the abdomen.',
		diagnosis: 'Allergic dermatitis under control.',
		treatment: 'Topical medication, diet review, and recheck in 3 weeks.',
		medications: ['Cefalexin 250mg', 'Cetirizine 10mg'],
		category: 'Dermatology',
		attendingVet: 'Dr. Aris Rodriguez',
		vaccinationStatus: 'Pending booster',
		vaccineBrand: 'Canigen DHPPi',
		history: [
			{ date: '2023-10-15', title: 'Dermatitis Review', note: 'Topical care prescribed.' },
			{ date: '2023-09-04', title: 'Skin scraping', note: 'Observed response to allergy management.' }
		]
	},
	{
		id: 3,
		petName: 'Luna',
		species: 'Feline',
		breed: 'Persian Cat',
		age: '4 years old',
		sex: 'Female',
		weight: '4.6 kg',
		colorMarkings: 'White coat, gray tail tip',
		ownerName: 'Elena De Cruz',
		phone: '+63 917 555 0452',
		email: 'elena.decruz@email.com',
		address: 'Brgy. San Jose, Pilar, Bataan',
		location: 'Brgy. Tangos',
		status: 'Monitoring',
		statusType: 'warning',
		recordCount: 7,
		lastVisit: 'Oct 10, 2023',
		healthStatus: 'Needs Review',
		alert: 'Follow-up due',
		visitTitle: 'Respiratory Observation',
		visitDate: '2023-10-10',
		followUpDate: '2023-10-24',
		symptoms: 'Sneezing and mild watery discharge.',
		diagnosis: 'Upper respiratory irritation, monitor for progression.',
		treatment: 'Nebulization and supportive care.',
		medications: ['Doxycycline 50mg'],
		category: 'Respiratory',
		attendingVet: 'Dr. Kizea Bien Igaya',
		vaccinationStatus: 'Up to date',
		vaccineBrand: 'FVRCP',
		history: [
			{ date: '2023-10-10', title: 'Respiratory Observation', note: 'Supportive therapy started.' }
		]
	}
];

const state = {
	records: [],
	metrics: {
		totalPatients: 0,
		visitsThisMonth: 0,
		infectiousCases: 0,
		followUpsDue: 0
	},
	mode: 'list',
	selectedId: null,
	detailTab: 'patient-info',
	query: '',
	filterType: 'all',
	filterStatus: 'all',
	page: 1,
	pageSize: 8,
	modal: null,
	pendingDeleteId: null
};

let searchRenderTimer = null;

const app = document.getElementById('records-app');
const modalOverlay = document.getElementById('records-modal-overlay');
const modalContent = document.getElementById('records-modal-content');
const modalClose = document.getElementById('records-modal-close');

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

async function patientRequest(action, payload = {}) {
	const response = await fetch(PATIENT_API, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action, ...payload })
	});
	const result = await response.json();
	if (!response.ok || !result.success) {
		throw new Error(result.message || 'Patient records request failed.');
	}
	return result;
}

async function loadRecords() {
	try {
		const result = await patientRequest('list');
		state.records = Array.isArray(result.data) ? result.data : [];
		state.metrics = result.metrics || state.metrics;
	} catch (error) {
		console.warn('Using local patient records fallback because backend failed:', error);
		state.records = clone(defaultRecords);
		state.metrics = {
			totalPatients: state.records.length,
			visitsThisMonth: state.records.reduce((sum, record) => sum + Number(record.recordCount || 0), 0),
			infectiousCases: 0,
			followUpsDue: state.records.filter((record) => record.alert && record.alert !== '0').length
		};
	}
}

async function reloadRecords() {
	await loadRecords();
	render();
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
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function routeFromUrl() {
	const params = new URLSearchParams(window.location.search);
	state.mode = params.get('mode') || 'list';
	state.selectedId = params.get('id') ? Number(params.get('id')) : null;
	state.detailTab = params.get('tab') || 'patient-info';
	state.query = params.get('q') || '';
	state.filterType = params.get('type') || 'all';
	state.filterStatus = params.get('status') || 'all';
}

function navigate(mode, options = {}, replace = false) {
	const params = new URLSearchParams();
	if (mode && mode !== 'list') params.set('mode', mode);
	if (options.id) params.set('id', String(options.id));
	if (options.tab && options.tab !== 'patient-info') params.set('tab', options.tab);
	if (options.q) params.set('q', options.q);
	if (options.type && options.type !== 'all') params.set('type', options.type);
	if (options.status && options.status !== 'all') params.set('status', options.status);
	const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
	if (replace) history.replaceState({}, '', nextUrl); else history.pushState({}, '', nextUrl);
	routeFromUrl();
	render();
}

function getRecordById(id) {
	return state.records.find((record) => record.id === id) || null;
}

function getVisitHistory(record) {
	if (Array.isArray(record.visitHistory) && record.visitHistory.length) return record.visitHistory;
	return (record.history || []).map((entry, index) => ({
		id: `${record.id}-visit-${index}`,
		title: entry.title || 'Visit note',
		date: entry.date,
		followUp: record.followUpDate || 'TBD',
		attendingVet: record.attendingVet,
		category: record.category,
		symptoms: entry.note || record.symptoms,
		diagnosis: record.diagnosis,
		treatment: record.treatment,
		medications: record.medications,
		vaccinationStatus: record.vaccinationStatus
	}));
}

function getVaccinationHistory(record) {
	if (Array.isArray(record.vaccinationHistory) && record.vaccinationHistory.length) return record.vaccinationHistory;
	return [
		{
			id: `${record.id}-vacc-1`,
			name: record.vaccineBrand || 'Vaccination record',
			description: record.vaccinationStatus || 'Up to date',
			date: record.followUpDate || record.visitDate,
			provider: record.attendingVet,
			nextDue: record.followUpDate || 'TBD',
			status: record.vaccinationStatus || 'Current'
		}
	];
}

function getStatusClass(statusType) {
	if (statusType === 'warning') return 'warning';
	if (statusType === 'danger') return 'danger';
	if (statusType === 'success') return 'success';
	return 'neutral';
}

function filteredRecords() {
	const query = state.query.trim().toLowerCase();
	return state.records.filter((record) => {
		const species = String(record.species || '').toLowerCase();
		const haystack = [record.petName, record.ownerName, record.breed, record.species, record.category, record.attendingVet, record.status].join(' ').toLowerCase();
		const matchesQuery = !query || haystack.includes(query);
		const matchesType = state.filterType === 'all'
			|| (state.filterType === 'active' && record.statusType === 'success')
			|| (state.filterType !== 'active' && species === state.filterType);
		const matchesStatus = state.filterStatus === 'all' || record.statusType === state.filterStatus;
		return matchesQuery && matchesType && matchesStatus;
	});
}

function statusTag(record) {
	return `<span class="status-badge ${getStatusClass(record.statusType)}"><span class="status-dot"></span>${escapeHtml(record.status)}</span>`;
}

function detailTabButton(label, tabKey, activeTab) {
	const isActive = tabKey === activeTab;
	return `<button type="button" class="detail-tab ${isActive ? 'active' : ''}" data-detail-tab="${tabKey}">${escapeHtml(label)}</button>`;
}

function renderPatientInfoTab(record) {
	const medications = Array.isArray(record.medications) ? record.medications : [];
	const isEmergency = String(record.category || '').toLowerCase().includes('emergency');

	return `
		<div class="detail-panel-grid">

			<!-- KPI tiles -->
			<div class="kpi-row">
				<div class="kpi-tile kpi-tile-navy">
					<div class="kpi-tile-head">
						<span class="kpi-tile-label">Total Visits</span>
						<div class="kpi-tile-icon">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
						</div>
					</div>
					<p class="kpi-tile-value">${escapeHtml(record.recordCount)}</p>
					<p class="kpi-tile-sub">Clinic visits on record</p>
				</div>

				<div class="kpi-tile kpi-tile-blue">
					<div class="kpi-tile-head">
						<span class="kpi-tile-label">Last Visit</span>
						<div class="kpi-tile-icon">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
						</div>
					</div>
					<p class="kpi-tile-value kpi-tile-value-md">${escapeHtml(record.lastVisit)}</p>
					<p class="kpi-tile-sub">Most recent appointment</p>
				</div>

				<div class="kpi-tile kpi-tile-green">
					<div class="kpi-tile-head">
						<span class="kpi-tile-label">Health Status</span>
						<div class="kpi-tile-icon">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
						</div>
					</div>
					<p class="kpi-tile-value kpi-tile-value-status kpi-status-ok">
						<span class="status-dot"></span>${escapeHtml(record.healthStatus)}
					</p>
					<p class="kpi-tile-sub">Current health standing</p>
				</div>

				<div class="kpi-tile kpi-tile-amber">
					<div class="kpi-tile-head">
						<span class="kpi-tile-label">Active Alerts</span>
						<div class="kpi-tile-icon">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
						</div>
					</div>
					<p class="kpi-tile-value ${Number(record.alert) > 0 ? 'kpi-status-alert' : ''}">${escapeHtml(record.alert)}</p>
					<p class="kpi-tile-sub">Flagged items</p>
				</div>
			</div>

			<!-- Physical + Ownership -->
			<div class="detail-two-column">
				<article class="detail-info-card pi-card">
					<div class="pi-card-head">
						<div class="pi-card-icon">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
						</div>
						<h4>Physical Characteristics</h4>
					</div>
					<div class="pi-fields">
						<div class="pi-row">
							<div class="pi-field">
								<span class="pi-label">DATE OF BIRTH</span>
								<span class="pi-value">${escapeHtml(record.dateOfBirth || record.visitDate || '—')}</span>
							</div>
							<div class="pi-field">
								<span class="pi-label">AGE</span>
								<span class="pi-value">${escapeHtml(record.age)}</span>
							</div>
						</div>
						<div class="pi-row">
							<div class="pi-field pi-field-full">
								<span class="pi-label">COLOR / MARKINGS</span>
								<span class="pi-value">${escapeHtml(record.colorMarkings)}</span>
							</div>
						</div>
						<div class="pi-row">
							<div class="pi-field">
								<span class="pi-label">WEIGHT</span>
								<span class="pi-value">${escapeHtml(record.weight)}</span>
							</div>
							<div class="pi-field">
								<span class="pi-label">SEX</span>
								<span class="pi-value">${escapeHtml(record.sex || '—')}</span>
							</div>
						</div>
					</div>
				</article>

				<article class="detail-info-card pi-card">
					<div class="pi-card-head">
						<div class="pi-card-icon">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
						</div>
						<h4>Ownership Information</h4>
					</div>
					<div class="pi-owner-strip">
						<div class="owner-avatar">${escapeHtml(record.ownerName.slice(0, 1).toUpperCase())}</div>
						<div>
							<strong>${escapeHtml(record.ownerName)}</strong>
							<p>Primary Owner &middot; Member since 2019</p>
						</div>
					</div>
					<div class="pi-fields pi-fields-stack">
						<div class="pi-field pi-field-full">
							<span class="pi-label">PHONE NUMBER</span>
							<span class="pi-value">${escapeHtml(record.phone)}</span>
						</div>
						<div class="pi-field pi-field-full">
							<span class="pi-label">EMAIL ADDRESS</span>
							<span class="pi-value">${escapeHtml(record.email)}</span>
						</div>
						<div class="pi-field pi-field-full">
							<span class="pi-label">RESIDENTIAL ADDRESS</span>
							<span class="pi-value">${escapeHtml(record.address)}</span>
						</div>
					</div>
				</article>
			</div>

			<!-- Latest Clinical Visit -->
			<article class="detail-info-card lv-card">
				<div class="lv-card-head">
					<div class="lv-head-left">
						<div class="lv-head-icon">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
						</div>
						<div>
							<h4>Latest Clinical Visit</h4>
							<p class="lv-head-sub">
								${formatDate(record.visitDate) || 'No visit date recorded'}
								${record.attendingVet ? ` &middot; <span class="lv-attending">Dr. ${escapeHtml(record.attendingVet)}</span>` : ''}
							</p>
						</div>
					</div>
					${isEmergency
						? '<span class="emergency-pill">Emergency</span>'
						: `<span class="lv-category-tag">${escapeHtml(record.category || 'General')}</span>`
					}
				</div>

				<div class="lv-columns">
					<div class="lv-col">
						<p class="lv-col-label">VISIT DETAILS</p>
						<div class="lv-data-list">
							<div class="lv-data-row">
								<span class="lv-data-key">Visit Date</span>
								<span class="lv-data-val">${formatDate(record.visitDate) || '—'}</span>
							</div>
							<div class="lv-data-row">
								<span class="lv-data-key">Last Visit</span>
								<span class="lv-data-val">${escapeHtml(record.lastVisit) || '—'}</span>
							</div>
							<div class="lv-data-row">
								<span class="lv-data-key">Case Category</span>
								<span class="lv-data-val">${escapeHtml(record.category) || '—'}</span>
							</div>
							<div class="lv-data-row">
								<span class="lv-data-key">Diagnosis</span>
								<span class="lv-data-val">${escapeHtml(record.diagnosis) || '—'}</span>
							</div>
						</div>
					</div>

					<div class="lv-col lv-col-border">
						<p class="lv-col-label">CLINICAL OBSERVATIONS</p>
						<p class="lv-sub-label">Symptoms</p>
						<p class="lv-text">${escapeHtml(record.symptoms) || '—'}</p>
						<p class="lv-sub-label">Treatment Plan</p>
						<p class="lv-text">${escapeHtml(record.treatment) || '—'}</p>
					</div>

					<div class="lv-col lv-col-border">
						<p class="lv-col-label">PRESCRIPTIONS</p>
						<div class="lv-med-list">
							${medications.length
								? medications.map((m) => `
									<div class="lv-med-item">
										<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>
										<span class="lv-med-name">${escapeHtml(m)}</span>
										<span class="lv-med-badge">ACTIVE</span>
									</div>`).join('')
								: '<p class="lv-empty-note">No medications listed.</p>'
							}
						</div>
						${record.followUpDate
							? `<div class="lv-followup-row">
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
									Follow-up: ${formatDate(record.followUpDate)}
								</div>`
							: ''
						}
					</div>
				</div>
			</article>

		</div>
	`;
}

function renderVisitHistoryTab(record) {
	const visitHistory = getVisitHistory(record);
	return `
		<div class="history-section">
			${visitHistory.map((visit) => `
				<article class="history-entry history-entry-visit">
					<div class="history-entry-top">
						<div>
							<h3>${escapeHtml(visit.title)}</h3>
							<div class="history-meta">
								<span>${escapeHtml(visit.attendingVet || record.attendingVet)}</span>
								<span>${formatDate(visit.date)}</span>
								<span>Follow-up: ${escapeHtml(visit.followUp || 'TBD')}</span>
							</div>
						</div>
						<div class="history-statuses">
							<span class="tag success">General Checkup</span>
							<span class="tag neutral">Latest</span>
						</div>
					</div>
					<div class="history-columns">
						<div class="history-column">
							<p class="history-label">Clinical Observation</p>
							<p class="detail-paragraph">${escapeHtml(visit.symptoms || record.symptoms)}</p>
							<p class="history-label">Clinical Diagnosis</p>
							<p class="detail-paragraph">${escapeHtml(visit.diagnosis || record.diagnosis)}</p>
							<p class="history-label">Treatment Plan</p>
							<p class="detail-paragraph">${escapeHtml(visit.treatment || record.treatment)}</p>
						</div>
						<div class="history-column history-column-side">
							<div class="vaccine-box muted-box">
								<p class="history-label">Vaccination Update</p>
								<p class="detail-paragraph">${escapeHtml(visit.vaccinationStatus || record.vaccinationStatus || 'No vaccinations administered this visit.')}</p>
							</div>
							<div class="medication-list stacked">
								${(Array.isArray(visit.medications) ? visit.medications : []).map((medication) => `<span class="med-pill">${escapeHtml(medication)}</span>`).join('') || '<span class="muted">Not applicable</span>'}
							</div>
						</div>
					</div>
				</article>
			`).join('')}
		</div>
	`;
}

function renderVaccinationHistoryTab(record) {
	const vaccinationHistory = getVaccinationHistory(record);
	const syringeIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/><path d="m14 4 6 6"/></svg>`;
	const statusSlugMap = { 'current': 'success', 'completed': 'success', 'overdue': 'danger', 'pending': 'warning', 'up to date': 'success' };
	function vaccStatusClass(status) {
		return statusSlugMap[(status || '').toLowerCase()] || 'neutral';
	}
	return `
		<div class="vacc-shell">
			<div class="vacc-section-header">
				<div class="vacc-section-icon">
					${syringeIcon}
				</div>
				<div>
					<h3 class="vacc-section-title">Vaccination History</h3>
					<p class="vacc-section-sub">Immunization records for ${escapeHtml(record.petName)} · ${escapeHtml(record.species)}</p>
				</div>
				<span class="vacc-count-badge">${vaccinationHistory.length} record${vaccinationHistory.length !== 1 ? 's' : ''}</span>
			</div>

			<div class="vacc-list">
				${vaccinationHistory.length ? vaccinationHistory.map((vaccination) => `
					<article class="vacc-card">
						<div class="vacc-card-icon">
							${syringeIcon}
						</div>
						<div class="vacc-card-main">
							<span class="vacc-name">${escapeHtml(vaccination.name)}</span>
							<span class="vacc-desc">${escapeHtml(vaccination.description || 'Vaccination record')}</span>
						</div>
						<div class="vacc-meta-row">
							<div class="vacc-meta-item">
								<span class="vacc-meta-label">Administered</span>
								<span class="vacc-meta-value">${formatDate(vaccination.date) || '—'}</span>
							</div>
							<div class="vacc-meta-divider"></div>
							<div class="vacc-meta-item">
								<span class="vacc-meta-label">Provider</span>
								<span class="vacc-meta-value">${escapeHtml(vaccination.provider || record.attendingVet || '—')}</span>
							</div>
							<div class="vacc-meta-divider"></div>
							<div class="vacc-meta-item">
								<span class="vacc-meta-label">Next Due</span>
								<span class="vacc-meta-value vacc-next-due">${escapeHtml(vaccination.nextDue || 'TBD')}</span>
							</div>
						</div>
						<div class="vacc-status-wrap">
							<span class="vacc-status-badge vacc-status-${vaccStatusClass(vaccination.status)}">
								<span class="vacc-status-dot"></span>
								${escapeHtml(vaccination.status || 'Completed')}
							</span>
						</div>
					</article>
				`).join('') : `
					<div class="vacc-empty">
						<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/><path d="m14 4 6 6"/></svg>
						<p>No vaccination records found for this patient.</p>
					</div>
				`}
			</div>
		</div>
	`;
}

function actionButton(label, action, className, id, variant = 'icon') {
	const icon = className === 'view' ? ICONS.eye : className === 'delete' ? ICONS.trash : ICONS.plus;
	if (variant === 'primary') {
		return `<button type="button" class="table-action table-action-primary" data-action="${action}" data-id="${id}">${icon}${escapeHtml(label)}</button>`;
	}
	return `<button type="button" class="table-action table-action-icon ${className}" data-action="${action}" data-id="${id}" aria-label="${escapeHtml(label)}">${icon}</button>`;
}

function renderList() {
	const records = filteredRecords();
	const total = state.records.length;
	const active = state.records.filter((record) => record.statusType === 'success').length;
	const monitoring = state.records.filter((record) => record.statusType === 'warning').length;
	const alerts = state.records.filter((record) => record.alert && record.alert !== '0').length;

	return `
		<section class="records-shell">
			<header class="records-hero">
				<div class="records-hero-top">
					<div>
						<div class="records-kicker"></div>
						<h1>Patient Records</h1>
						<p>Manage patient profiles, clinical notes, follow-ups, and record actions from one place.</p>
					</div>
					<div class="hero-actions">
						<button type="button" class="btn btn-accent" data-nav="add"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add New Patient</button>
					</div>
				</div>
			</header>
            	<div class="metrics-grid">
					<article class="metric-card">
                        <div class="metric-label">Total Patients <span class="metric-badge">Live</span></div>
                        <div class="metric-value">${Number(state.metrics.totalPatients || total).toLocaleString()}</div>
                        </article>
					<article class="metric-card"><div class="metric-label">Visits This Month <span class="metric-badge orange">Live</span></div><div class="metric-value">${Number(state.metrics.visitsThisMonth || 0).toLocaleString()}</div></article>
					<article class="metric-card"><div class="metric-label">Infectious Cases<span class="metric-badge red">Live</span></div><div class="metric-value">${Number(state.metrics.infectiousCases || 0).toLocaleString()}</div></article>
					<article class="metric-card"><div class="metric-label">Follow-ups Due <span class="metric-badge green">Due Now</span></div><div class="metric-value">${Number(state.metrics.followUpsDue || alerts).toLocaleString()}</div></article>
				</div>

			<section class="records-card">
				<div class="table-toolbar">
					<div class="search-box">
						<svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>
						<input class="search-input" id="search-input" type="search" placeholder="Search patients, breeds, owners..." value="${escapeHtml(state.query)}">
					</div>
				</div>
				<div class="filter-strip" aria-label="Patient filters">
					<span class="filter-label">FILTER:</span>
					<button type="button" class="filter-pill ${state.filterType === 'all' ? 'active' : ''}" data-filter-type="all">All Pets</button>
					<button type="button" class="filter-pill ${state.filterType === 'canine' ? 'active' : ''}" data-filter-type="canine">Canine</button>
					<button type="button" class="filter-pill ${state.filterType === 'feline' ? 'active' : ''}" data-filter-type="feline">Feline</button>
					<button type="button" class="filter-pill ${state.filterType === 'avian' ? 'active' : ''}" data-filter-type="avian">Avian</button>
					<button type="button" class="filter-pill ${state.filterType === 'exotic' ? 'active' : ''}" data-filter-type="exotic">Exotic</button>
					<button type="button" class="filter-pill ${state.filterType === 'active' ? 'active' : ''}" data-filter-type="active">Active Only</button>
				</div>

				<div class="table-wrap">
					<table class="records-table">
						<thead>
							<tr>
								<th>Patient</th>
								<th>Owner</th>
								<th>Last Visit</th>
								<th>Location</th>
								<th>Status</th>
								<th>Type</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							${records.length ? records.map((record) => `
								<tr>
									<td>
										<div class="patient-mini">
											<div class="patient-avatar">${escapeHtml((record.petName || '?')[0].toUpperCase())}</div>
											<div class="patient-mini-info">
												<strong>${escapeHtml(record.petName)}</strong>
											</div>
										</div>
									</td>
									<td>
										<div class="owner-cell">
											<span class="owner-name">${escapeHtml(record.ownerName)}</span>
											<span class="owner-contact">${escapeHtml(record.phone)}</span>
										</div>
									</td>
									<td>
										<div class="visit-cell">
											<svg class="visit-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
											<span>${escapeHtml(record.lastVisit)}</span>
										</div>
									</td>
									<td><span class="location-text">${escapeHtml(record.location || record.address)}</span></td>
									<td>${statusTag(record)}</td>
									<td><span class="pet-pill pet-pill-${escapeHtml((record.species || 'other').toLowerCase())}">${escapeHtml(record.species)}</span></td>
									<td>
										<div class="row-actions">
											${actionButton('Add Record', 'add-record', 'add-record', record.id, 'primary')}
											${actionButton('View', 'view', 'view', record.id)}
											${actionButton('Delete', 'delete', 'delete', record.id)}
										</div>
									</td>
								</tr>
							`).join('') : `
								<tr>
									<td colspan="7"><div class="empty-state">No patient records match the current filters.</div></td>
								</tr>
							`}
						</tbody>
					</table>
				</div>

				<div class="page-footer">
					<p>Showing <strong>${records.length}</strong> of <strong>${total}</strong> patients</p>
					<p>${records.length ? 'Click <strong>View</strong> to inspect a patient profile, or <strong>Add Record</strong> to log a visit.' : 'Try clearing the search or changing the filter.'}</p>
				</div>
			</section>
		</section>
	`;
}

function buildBlankRecord(prefill = {}) {
	return {
		id: Date.now(),
		petName: prefill.petName || '',
		species: prefill.species || 'Canine',
		breed: prefill.breed || '',
		age: prefill.age || '',
		sex: prefill.sex || 'Female',
		weight: prefill.weight || '',
		colorMarkings: prefill.colorMarkings || '',
		ownerName: prefill.ownerName || '',
		phone: prefill.phone || '',
		email: prefill.email || '',
		address: prefill.address || '',
		status: prefill.status || 'Active Patient',
		statusType: prefill.statusType || 'success',
		recordCount: prefill.recordCount || 1,
		lastVisit: prefill.lastVisit || formatDate(new Date()),
		healthStatus: prefill.healthStatus || 'New Admission',
		alert: prefill.alert || '0',
		visitTitle: prefill.visitTitle || '',
		visitDate: prefill.visitDate || new Date().toISOString().slice(0, 10),
		followUpDate: prefill.followUpDate || '',
		symptoms: prefill.symptoms || '',
		diagnosis: prefill.diagnosis || '',
		treatment: prefill.treatment || '',
		medications: prefill.medications || [],
		category: prefill.category || 'Routine Checkup',
		attendingVet: prefill.attendingVet || 'Dr. Kizea Bien Igaya',
		vaccinationStatus: prefill.vaccinationStatus || 'Pending',
		vaccineBrand: prefill.vaccineBrand || '',
		history: prefill.history || []
	};
}

function buildNewVisitRecord(record) {
	if (!record) return null;
	return {
		...record,
		visitTitle: '',
		visitDate: new Date().toISOString().slice(0, 10),
		followUpDate: '',
		symptoms: '',
		diagnosis: '',
		treatment: '',
		medications: [],
		category: 'Routine Checkup',
		vaccinationStatus: '',
		vaccineBrand: '',
		alert: '0'
	};
}

function renderAdd(record) {
	const data = record || buildBlankRecord();
	const hasContext = Boolean(record);
	const pageTitle = hasContext ? 'Add New Record' : 'Add New Patient';
	const submitLabel = hasContext ? 'Add Record' : 'Add Patient';
	return `
		<section class="records-shell">
			<div class="add-page-header">
				<button type="button" class="back-link" data-nav="list">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
					Back to Patient Records
				</button>
				<div class="add-page-title-row">
					<div class="add-page-icon">
						${hasContext
							? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`
							: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`
						}
					</div>
					<div>
						<h2 class="add-page-title">${pageTitle}</h2>
						<p class="add-page-sub">${hasContext ? `Create a new clinical visit entry for <strong>${escapeHtml(data.petName)}</strong>.` : 'Register a new patient and capture the first clinical note.'}</p>
					</div>
				</div>
			</div>

			<form id="record-form" class="form-layout">
				<!-- Pet Information -->
				<article class="form-card">
					<div class="form-card-head">
						<div class="form-card-icon fci-green">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="15" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></svg>
						</div>
						<div>
							<h3 class="form-card-title">Pet Information</h3>
							<p class="form-card-sub">Physical and identification details</p>
						</div>
					</div>
					<div class="form-grid">
						<div class="field span-2">
							<label class="field-label" for="pet-name">PET NAME</label>
							<input class="form-input" id="pet-name" name="petName" required placeholder="e.g. Buddy" value="${escapeHtml(data.petName)}">
						</div>
						<div class="field">
							<label class="field-label" for="species">SPECIES</label>
							<select class="form-input" id="species" name="species">
								<option ${data.species === 'Canine' ? 'selected' : ''}>Canine</option>
								<option ${data.species === 'Feline' ? 'selected' : ''}>Feline</option>
								<option ${data.species === 'Avian' ? 'selected' : ''}>Avian</option>
								<option ${data.species === 'Exotic' ? 'selected' : ''}>Exotic</option>
							</select>
						</div>
						<div class="field">
							<label class="field-label" for="breed">BREED</label>
							<input class="form-input" id="breed" name="breed" placeholder="e.g. Golden Retriever" value="${escapeHtml(data.breed)}">
						</div>
						<div class="field">
							<label class="field-label" for="age">AGE</label>
							<input class="form-input" id="age" name="age" placeholder="e.g. 2 years old" value="${escapeHtml(data.age)}">
						</div>
						<div class="field">
							<label class="field-label" for="sex">SEX</label>
							<select class="form-input" id="sex" name="sex">
								<option ${data.sex === 'Male' ? 'selected' : ''}>Male</option>
								<option ${data.sex === 'Female' ? 'selected' : ''}>Female</option>
							</select>
						</div>
						<div class="field">
							<label class="field-label" for="weight">WEIGHT</label>
							<input class="form-input" id="weight" name="weight" placeholder="e.g. 12.5 kg" value="${escapeHtml(data.weight)}">
						</div>
						<div class="field">
							<label class="field-label" for="color-markings">COLOR / MARKINGS</label>
							<input class="form-input" id="color-markings" name="colorMarkings" placeholder="e.g. Golden coat, white chest" value="${escapeHtml(data.colorMarkings)}">
						</div>
					</div>
				</article>

				<!-- Owner Information -->
				<article class="form-card">
					<div class="form-card-head">
						<div class="form-card-icon fci-blue">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
						</div>
						<div>
							<h3 class="form-card-title">Owner Information</h3>
							<p class="form-card-sub">Contact and address details</p>
						</div>
					</div>
					<div class="form-grid">
						<div class="field span-2">
							<label class="field-label" for="owner-name">OWNER NAME</label>
							<input class="form-input" id="owner-name" name="ownerName" required placeholder="Full name" value="${escapeHtml(data.ownerName)}">
						</div>
						<div class="field">
							<label class="field-label" for="phone">PHONE NUMBER</label>
							<input class="form-input" id="phone" name="phone" placeholder="09xxxxxxxxx" value="${escapeHtml(data.phone)}">
						</div>
						<div class="field">
							<label class="field-label" for="email">EMAIL ADDRESS</label>
							<input class="form-input" id="email" name="email" type="email" placeholder="owner@email.com" value="${escapeHtml(data.email)}">
						</div>
						<div class="field span-2">
							<label class="field-label" for="address">COMPLETE ADDRESS</label>
							<input class="form-input" id="address" name="address" placeholder="Barangay, Municipality, Province" value="${escapeHtml(data.address)}">
						</div>
					</div>
				</article>

				<!-- Visit Details — full width -->
				<article class="form-card span-2">
					<div class="form-card-head">
						<div class="form-card-icon fci-navy">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
						</div>
						<div>
							<h3 class="form-card-title">Visit Details</h3>
							<p class="form-card-sub">Clinical notes for this visit</p>
						</div>
					</div>
					<div class="form-grid form-grid-3">
						<div class="field span-3">
							<label class="field-label" for="visit-title">VISIT TITLE</label>
							<input class="form-input" id="visit-title" name="visitTitle" placeholder="e.g. Annual Checkup, Vaccination Drive" value="${escapeHtml(data.visitTitle)}">
						</div>
						<div class="field">
							<label class="field-label" for="visit-date">VISIT DATE</label>
							<input class="form-input" id="visit-date" name="visitDate" type="date" value="${escapeHtml(data.visitDate)}">
						</div>
						<div class="field">
							<label class="field-label" for="follow-up-date">FOLLOW-UP DATE</label>
							<input class="form-input" id="follow-up-date" name="followUpDate" type="date" value="${escapeHtml(data.followUpDate)}">
						</div>
						<div class="field">
							<label class="field-label" for="attending-vet">ATTENDING VETERINARIAN</label>
							<input class="form-input" id="attending-vet" name="attendingVet" placeholder="Dr. Full Name" value="${escapeHtml(data.attendingVet)}">
						</div>
						<div class="field span-3">
							<label class="field-label" for="symptoms">SYMPTOMS / CHIEF COMPLAINT</label>
							<textarea class="form-textarea" id="symptoms" name="symptoms" placeholder="Describe observed clinical signs and symptoms...">${escapeHtml(data.symptoms)}</textarea>
						</div>
						<div class="field span-3">
							<label class="field-label" for="diagnosis">DIAGNOSIS</label>
							<textarea class="form-textarea" id="diagnosis" name="diagnosis" placeholder="Final or differential diagnosis...">${escapeHtml(data.diagnosis)}</textarea>
						</div>
						<div class="field span-3">
							<label class="field-label" for="treatment">TREATMENT PROVIDED</label>
							<textarea class="form-textarea" id="treatment" name="treatment" placeholder="Procedures performed, medications administered...">${escapeHtml(data.treatment)}</textarea>
						</div>
						<div class="field span-2">
							<label class="field-label" for="medications">PRESCRIBED MEDICATIONS</label>
							<input class="form-input" id="medications" name="medications" placeholder="Comma-separated: Amoxicillin, Meloxicam" value="${escapeHtml(Array.isArray(data.medications) ? data.medications.join(', ') : data.medications)}">
						</div>
						<div class="field">
							<label class="field-label" for="category">CASE CATEGORY</label>
							<select class="form-input" id="category" name="category">
								${['Routine Checkup', 'Vaccination', 'Dermatology', 'Emergency', 'Surgery Follow-up'].map((item) => `<option ${data.category === item ? 'selected' : ''}>${item}</option>`).join('')}
							</select>
						</div>
						<div class="field">
							<label class="field-label" for="vaccination-status">VACCINATION STATUS</label>
							<input class="form-input" id="vaccination-status" name="vaccinationStatus" placeholder="e.g. Up to date" value="${escapeHtml(data.vaccinationStatus)}">
						</div>
						<div class="field">
							<label class="field-label" for="vaccine-brand">VACCINE BRAND</label>
							<input class="form-input" id="vaccine-brand" name="vaccineBrand" placeholder="e.g. Nobivac" value="${escapeHtml(data.vaccineBrand)}">
						</div>
						<div class="field">
							<label class="field-label" for="status">RECORD STATUS</label>
							<select class="form-input" id="status" name="status">
								<option value="Active Patient" ${data.status === 'Active Patient' ? 'selected' : ''}>Active Patient</option>
								<option value="Monitoring" ${data.status === 'Monitoring' ? 'selected' : ''}>Monitoring</option>
								<option value="Critical" ${data.status === 'Critical' ? 'selected' : ''}>Critical</option>
							</select>
						</div>
					</div>
					<div class="form-footer">
						<button type="button" class="btn btn-soft" data-nav="list">Cancel</button>
						<button type="submit" class="btn btn-primary">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
							${submitLabel}
						</button>
					</div>
				</article>
			</form>
		</section>
	`;
}

function renderDetail(record) {
	if (!record) {
		return `
			<section class="records-shell">
				<div class="empty-state">The selected patient record could not be found.</div>
				<div class="page-footer"><button type="button" class="btn btn-soft" data-nav="list">Return to records</button></div>
			</section>
		`;
	}

	const activeTab = state.detailTab || 'patient-info';
	const detailContent = activeTab === 'visit-history'
		? renderVisitHistoryTab(record)
		: activeTab === 'vaccination-history'
			? renderVaccinationHistoryTab(record)
			: renderPatientInfoTab(record);

	return `
		<section class="records-shell">
			<div class="profile-topbar">
				<button type="button" class="back-link" data-nav="list"><img src="/bvetter/vet/images/back.svg" alt="Back"> Back to Patient Records</button>
			</div>

			<section class="detail-shell">
				<header class="detail-hero detail-hero-profile">
					<div class="detail-head">
						<div class="detail-title">
							<div class="detail-avatar">${escapeHtml(record.petName.slice(0, 1))}</div>
							<div>
								<div class="pet-name-row">
									<h2>${escapeHtml(record.petName)}</h2>
									<button type="button" class="pet-edit-trigger" data-action="edit" data-id="${record.id}" aria-label="Edit patient profile">${ICONS.pencil}</button>
								</div>
								<div class="detail-badges">
									<span class="tag neutral">${escapeHtml(record.breed)}</span>
									<span class="tag info">${escapeHtml(record.species)}</span>
									<span class="tag ${getStatusClass(record.statusType)}">${escapeHtml(record.status)}</span>
								</div>
							</div>
						</div>
						<div class="detail-actions">
							<button type="button" class="btn btn-primary" data-nav="add" data-id="${record.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add New Record</button>
						</div>
					</div>

					<nav class="detail-tabs" aria-label="Patient detail tabs">
						${detailTabButton('Patient Info', 'patient-info', activeTab)}
						${detailTabButton('Visit History', 'visit-history', activeTab)}
						${detailTabButton('Vaccination History', 'vaccination-history', activeTab)}
					</nav>
				</header>

				<div class="detail-tab-panel">
					${detailContent}
				</div>
			</section>
		</section>
	`;
}

function renderSuccessModal(record) {
	return `
		<div class="success-banner">
			<div class="success-mark">${ICONS.check}</div>
			<h2 id="records-modal-title">Record Added Successfully</h2>
			<p class="muted">${escapeHtml(record.petName)} has been added to the patient records list.</p>
			<div class="modal-footer">
				<button type="button" class="btn btn-soft" data-modal-action="go-list">Back to Records</button>
				<button type="button" class="btn btn-primary" data-modal-action="go-view" data-id="${record.id}">View Patient</button>
			</div>
		</div>
	`;
}

function renderEditModal(record) {
	if (!record) return '<div class="empty-state">Record not found.</div>';
	return `
		<form id="edit-record-form" class="em-form">
			<div class="em-header">
				<div class="em-header-icon">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
				</div>
				<div>
					<h2 id="records-modal-title" class="em-title">Edit Patient Information</h2>
					<p class="em-subtitle">Update the patient profile and save the changes.</p>
				</div>
			</div>
			<div class="em-divider"></div>

			<div class="em-body">
				<!-- Pet Information -->
				<div class="em-section">
					<p class="em-section-label">Pet Information</p>
					<div class="em-grid">
						<div class="em-field em-span-2">
							<label class="em-label" for="edit-pet-name">PET NAME</label>
							<input class="em-input" id="edit-pet-name" name="petName" required placeholder="e.g. Copper" value="${escapeHtml(record.petName)}">
						</div>
						<div class="em-field">
							<label class="em-label" for="edit-species">SPECIES</label>
							<select class="em-input" id="edit-species" name="species">
								${['Canine', 'Feline', 'Avian', 'Exotic'].map((item) => `<option ${record.species === item ? 'selected' : ''}>${item}</option>`).join('')}
							</select>
						</div>
						<div class="em-field">
							<label class="em-label" for="edit-breed">BREED</label>
							<input class="em-input" id="edit-breed" name="breed" placeholder="e.g. Golden Retriever" value="${escapeHtml(record.breed)}">
						</div>
						<div class="em-field">
							<label class="em-label" for="edit-dob">DATE OF BIRTH</label>
							<input class="em-input" id="edit-dob" name="dateOfBirth" type="date" value="${escapeHtml(record.dateOfBirth || '')}">
						</div>
						<div class="em-field">
							<label class="em-label" for="edit-age">AGE</label>
							<input class="em-input" id="edit-age" name="age" placeholder="e.g. 2 years old" value="${escapeHtml(record.age)}">
						</div>
						<div class="em-field">
							<label class="em-label" for="edit-sex">SEX</label>
							<select class="em-input" id="edit-sex" name="sex">
								<option ${record.sex === 'Male' ? 'selected' : ''}>Male</option>
								<option ${record.sex === 'Female' ? 'selected' : ''}>Female</option>
							</select>
						</div>
						<div class="em-field">
							<label class="em-label" for="edit-weight">WEIGHT</label>
							<input class="em-input" id="edit-weight" name="weight" placeholder="e.g. 12 kg" value="${escapeHtml(record.weight || '')}">
						</div>
					</div>
				</div>

				<!-- Owner Information -->
				<div class="em-section">
					<p class="em-section-label">Owner Information</p>
					<div class="em-grid">
						<div class="em-field em-span-2">
							<label class="em-label" for="edit-owner-name">OWNER NAME</label>
							<input class="em-input" id="edit-owner-name" name="ownerName" placeholder="Full name" value="${escapeHtml(record.ownerName)}">
						</div>
						<div class="em-field">
							<label class="em-label" for="edit-phone">PHONE NUMBER</label>
							<input class="em-input" id="edit-phone" name="phone" placeholder="e.g. 09xxxxxxxxx" value="${escapeHtml(record.phone)}">
						</div>
						<div class="em-field">
							<label class="em-label" for="edit-email">EMAIL ADDRESS <span class="em-optional">optional</span></label>
							<input class="em-input" id="edit-email" name="email" type="email" placeholder="owner@email.com" value="${escapeHtml(record.email || '')}">
						</div>
					</div>
				</div>

				<!-- Record Status -->
				<div class="em-section">
					<p class="em-section-label">Record Status</p>
					<div class="em-grid">
						<div class="em-field em-span-2">
							<label class="em-label" for="edit-status">CURRENT STATUS</label>
							<select class="em-input" id="edit-status" name="status">
								<option value="Active Patient" ${record.status === 'Active Patient' ? 'selected' : ''}>Active Patient</option>
								<option value="Monitoring" ${record.status === 'Monitoring' ? 'selected' : ''}>Monitoring</option>
								<option value="Critical" ${record.status === 'Critical' ? 'selected' : ''}>Critical</option>
							</select>
						</div>
					</div>
				</div>
			</div>

			<div class="em-footer">
				<button type="button" class="em-delete-btn" data-modal-action="open-delete" data-id="${record.id}">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
					Delete Record
				</button>
				<div class="em-footer-right">
					<button type="button" class="btn btn-soft" data-modal-action="close-modal">Cancel</button>
					<button type="submit" class="btn btn-primary">
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
						Save Changes
					</button>
				</div>
			</div>
		</form>
	`;
}

function renderDeleteModal(record) {
	if (!record) return '<div class="empty-state">Record not found.</div>';
	return `
		<div class="delete-modal-wrap">
			<div class="delete-modal-icon">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
			</div>
			<h2 id="records-modal-title" class="delete-modal-title">Delete Patient Record?</h2>
			<p class="delete-modal-sub">This action is permanent and cannot be undone.</p>
			<div class="delete-warning">
				<div class="delete-warning-inner">
					<div class="delete-pet-avatar">${escapeHtml(record.petName.slice(0,1))}</div>
					<div>
						<strong>${escapeHtml(record.petName)}</strong>
						<p>Owner: ${escapeHtml(record.ownerName)}</p>
					</div>
				</div>
			</div>
			<div class="field delete-confirm-field">
				<label for="delete-confirm" class="delete-confirm-label">Type <strong>DELETE</strong> to confirm</label>
				<input class="form-input delete-confirm-input" id="delete-confirm" type="text" placeholder="DELETE" autocomplete="off">
			</div>
			<div class="modal-footer">
				<button type="button" class="btn btn-soft" data-modal-action="close-modal">Cancel</button>
				<button type="button" class="btn btn-danger delete-submit-btn" data-modal-action="confirm-delete" data-id="${record.id}">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
					Delete Record
				</button>
			</div>
		</div>
	`;
}

function openModal(contentHtml) {
	modalContent.innerHTML = contentHtml;
	modalOverlay.hidden = false;
	document.body.style.overflow = 'hidden';
}

function closeModal() {
	modalOverlay.hidden = true;
	modalContent.innerHTML = '';
	document.body.style.overflow = '';
	state.modal = null;
	state.pendingDeleteId = null;
}

async function updateRecord(id, changes) {
	await patientRequest('update', { id, ...changes });
	await loadRecords();
	return getRecordById(id);
}

async function deleteRecord(id) {
	await patientRequest('delete', { id });
	await loadRecords();
}

function getFormData(form) {
	const formData = new FormData(form);
	const medications = String(formData.get('medications') || '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);

	return {
		petName: String(formData.get('petName') || '').trim(),
		species: String(formData.get('species') || '').trim(),
		breed: String(formData.get('breed') || '').trim(),
		age: String(formData.get('age') || '').trim(),
		sex: String(formData.get('sex') || '').trim(),
		weight: String(formData.get('weight') || '').trim(),
		colorMarkings: String(formData.get('colorMarkings') || '').trim(),
		ownerName: String(formData.get('ownerName') || '').trim(),
		phone: String(formData.get('phone') || '').trim(),
		email: String(formData.get('email') || '').trim(),
		address: String(formData.get('address') || '').trim(),
		visitTitle: String(formData.get('visitTitle') || '').trim(),
		visitDate: String(formData.get('visitDate') || '').trim(),
		followUpDate: String(formData.get('followUpDate') || '').trim(),
		symptoms: String(formData.get('symptoms') || '').trim(),
		diagnosis: String(formData.get('diagnosis') || '').trim(),
		treatment: String(formData.get('treatment') || '').trim(),
		medications,
		category: String(formData.get('category') || '').trim(),
		attendingVet: String(formData.get('attendingVet') || '').trim(),
		vaccinationStatus: String(formData.get('vaccinationStatus') || '').trim(),
		vaccineBrand: String(formData.get('vaccineBrand') || '').trim(),
		status: String(formData.get('status') || '').trim()
	};
}

async function handleAddSubmit(event) {
	event.preventDefault();
	const data = getFormData(event.currentTarget);
	const patientId = state.selectedId || 0;

	try {
		const result = await patientRequest('save', patientId ? { id: patientId, ...data } : data);
		await loadRecords();
		const record = getRecordById(Number(result.id || patientId));
		openModal(renderSuccessModal(record || { ...buildBlankRecord(), ...data, id: result.id || patientId }));
	} catch (error) {
		alert(error.message || 'Failed to save patient record.');
	}
}

function render() {
	const selected = getRecordById(state.selectedId);
	if (!app) return;

	if (state.mode === 'add') {
		app.innerHTML = renderAdd(selected ? buildNewVisitRecord(clone(selected)) : null);
	} else if (state.mode === 'view' || state.mode === 'edit') {
		app.innerHTML = renderDetail(selected);
	} else {
		app.innerHTML = renderList();
	}

	bindModeSpecificHandlers();
}

function bindModeSpecificHandlers() {
	const searchInput = document.getElementById('search-input');
	const filterButtons = document.querySelectorAll('[data-filter-type]');
	const form = document.getElementById('record-form');

	if (searchInput) {
		searchInput.addEventListener('input', (event) => {
			state.query = event.target.value;
			clearTimeout(searchRenderTimer);
			searchRenderTimer = setTimeout(() => {
				navigate('list', { q: state.query, type: state.filterType, status: state.filterStatus }, true);
			}, 180);
		});
	}

	filterButtons.forEach((button) => {
		button.addEventListener('click', () => {
			const newType = button.dataset.filterType === state.filterType ? 'all' : button.dataset.filterType;
			navigate('list', { q: state.query, type: newType, status: state.filterStatus }, true);
		});
	});

	if (form) {
		form.addEventListener('submit', handleAddSubmit);
	}
}

function openEditModal(id) {
	const record = getRecordById(id);
	if (!record) return;
	state.modal = 'edit';
	state.selectedId = id;
	openModal(renderEditModal(record));
	const editForm = document.getElementById('edit-record-form');
	if (editForm) {
		editForm.addEventListener('submit', async (event) => {
			event.preventDefault();
			let updated = null;
			try {
				updated = await updateRecord(id, getFormData(editForm));
			} catch (error) {
				alert(error.message || 'Failed to update patient record.');
				return;
			}
			if (!updated) return;
			closeModal();
			navigate('view', { id: updated.id }, true);
			openModal(`
				<div class="success-banner">
					<div class="success-mark">${ICONS.check}</div>
					<h2 id="records-modal-title">Record Updated</h2>
					<p class="muted">Changes to ${escapeHtml(updated.petName)} were saved successfully.</p>
					<div class="modal-footer">
						<button type="button" class="btn btn-soft" data-modal-action="close-modal">Close</button>
						<button type="button" class="btn btn-primary" data-modal-action="go-view" data-id="${updated.id}">Back to Profile</button>
					</div>
				</div>
			`);
		});
	}
}

function openDeleteModal(id) {
	const record = getRecordById(id);
	if (!record) return;
	state.modal = 'delete';
	state.pendingDeleteId = id;
	state.selectedId = id;
	openModal(renderDeleteModal(record));
}

function handleModalAction(action, target) {
	const id = Number(target?.dataset?.id || state.selectedId || state.pendingDeleteId || 0);

	if (action === 'close-modal') {
		closeModal();
		return;
	}

	if (action === 'go-list') {
		closeModal();
		navigate('list', {}, true);
		return;
	}

	if (action === 'go-view') {
		closeModal();
		navigate('view', { id }, true);
		return;
	}

	if (action === 'open-delete') {
		closeModal();
		openDeleteModal(id);
		return;
	}

	if (action === 'confirm-delete') {
		const input = document.getElementById('delete-confirm');
		if (!input || input.value.trim().toUpperCase() !== 'DELETE') return;
		deleteRecord(id)
			.then(() => {
				closeModal();
				navigate('list', {}, true);
				openModal(`
					<div class="success-banner">
						<div class="success-mark">${ICONS.check}</div>
						<h2 id="records-modal-title">Record Deleted</h2>
						<p class="muted">The record was removed after DELETE confirmation.</p>
						<div class="modal-footer">
							<button type="button" class="btn btn-primary" data-modal-action="go-list">Return to Records</button>
						</div>
					</div>
				`);
			})
			.catch((error) => alert(error.message || 'Failed to delete patient record.'));
	}
}

function bindGlobalEvents() {
	app.addEventListener('click', (event) => {
		const tabButton = event.target.closest('[data-detail-tab]');
		if (tabButton) {
			navigate('view', { id: state.selectedId, tab: tabButton.dataset.detailTab }, false);
			return;
		}

		const navButton = event.target.closest('[data-nav]');
		if (navButton) {
			const destination = navButton.dataset.nav;
			const id = Number(navButton.dataset.id || state.selectedId || 0);
			if (destination === 'list') navigate('list', {}, false);
			if (destination === 'add') navigate('add', id ? { id } : {}, false);
			return;
		}

		const actionButtonEl = event.target.closest('[data-action]');
		if (!actionButtonEl) return;

		const action = actionButtonEl.dataset.action;
		const id = Number(actionButtonEl.dataset.id);

		if (action === 'view') navigate('view', { id }, false);
		if (action === 'add-record') navigate('add', { id }, false);
		if (action === 'edit') openEditModal(id);
		if (action === 'delete') openDeleteModal(id);
	});

	modalOverlay.addEventListener('click', (event) => {
		if (event.target === modalOverlay) closeModal();
	});

	modalClose.addEventListener('click', closeModal);

	modalContent.addEventListener('click', (event) => {
		const modalAction = event.target.closest('[data-modal-action]');
		if (!modalAction) return;
		handleModalAction(modalAction.dataset.modalAction, modalAction);
	});

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && !modalOverlay.hidden) closeModal();
	});

	window.addEventListener('popstate', () => {
		routeFromUrl();
		render();
	});
}

async function bootstrap() {
	routeFromUrl();
	app.innerHTML = '<section class="records-shell"><div class="empty-state">Loading patient records...</div></section>';
	await loadRecords();
	render();
	bindGlobalEvents();
}

bootstrap().catch((error) => {
	console.error(error);
	app.innerHTML = '<section class="records-shell"><div class="empty-state">Failed to load patient records.</div></section>';
});
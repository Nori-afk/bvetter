const STORAGE_KEY = 'vbetter.patient-records';

function appBasePath() {
	const script = document.currentScript || Array.from(document.scripts).find((item) => item.src && item.src.includes('/vet/js/patient-records.js'));
	const path = script?.src ? new URL(script.src).pathname : window.location.pathname;
	const jsMarker = '/vet/js/patient-records.js';
	if (path.includes(jsMarker)) return path.slice(0, path.indexOf(jsMarker));
	const pageMarker = '/vet/html/';
	if (path.includes(pageMarker)) return path.slice(0, path.indexOf(pageMarker));
	return '/Final-Backend';
}

const PATIENT_API = `${appBasePath()}/backend/patient-records/patient_records.php`;

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
	return `<span class="status-chip ${getStatusClass(record.statusType)}"><span class="status-dot"></span>${escapeHtml(record.status)}</span>`;
}

function detailTabButton(label, tabKey, activeTab) {
	const isActive = tabKey === activeTab;
	return `<button type="button" class="detail-tab ${isActive ? 'active' : ''}" data-detail-tab="${tabKey}">${escapeHtml(label)}</button>`;
}

function renderPatientInfoTab(record) {
	return `
		<div class="detail-panel-grid">
			<article class="detail-summary-card">
				<div class="summary-heading-row">
					<div class="KPI-normal">
						<p class="summary-label">TOTAL VISITS</p>
						<h3>${escapeHtml(record.recordCount)}</h3>
					</div>
					<div class="KPI-normal">
						<p class="summary-label">LAST VISIT</p>
						<h3>${escapeHtml(record.lastVisit)}</h3>
					</div>
					<div class="KPI-green">
						<p class="summary-label">HEALTH STATUS</p>
						<div class="summary-inline status-ok"><span class="status-dot"></span>${escapeHtml(record.healthStatus)}</div>
					</div>
					<div class="KPI-red">
						<p class="summary-label">ALERTS</p>
						<div class="summary-inline status-alert">${escapeHtml(record.alert)}</div>
					</div>
				</div>
			</article>

			<div class="detail-two-column">
				<article class="info-card detail-info-card">
					<div class="detail-header">
						<img src="/Final-Backend/vet/images/info.svg" alt="Physical information">
						<h3>Physical Characteristics</h3>
					</div>
					<div class="informs">
					<div class="top">
						<div class="info-row"><strong>Date of Birth</strong>
							<span>${escapeHtml(record.dateOfBirth || record.visitDate)}
							</span></div>
						<div class="info-row"><strong>Age</strong>
							<span>${escapeHtml(record.age)}
							</span></div>
						</div>
						<div class="bottom">
						<div class="info-row"><strong>Color / Markings</strong>
							<span>${escapeHtml(record.colorMarkings)}
							</span></div>
						<div class="info-row"><strong>Weight</strong>
							<span>${escapeHtml(record.weight)}
							</span></div>
						</div>
						</div>
				</article>

				<article class="info-card detail-info-card">
					<h3>Ownership Information</h3>
					<div class="owner-header-mini">
						<div class="owner-avatar">${escapeHtml(record.ownerName.slice(0, 1).toUpperCase())}</div>
						<div>
							<strong>${escapeHtml(record.ownerName)}</strong>
							<p class="muted">Primary Owner • Member since 2019</p>
						</div>
					</div>
					<div class="info-list">
						<div class="info-row"><strong>Phone Number</strong><span>${escapeHtml(record.phone)}</span></div>
						<div class="info-row"><strong>Email Address</strong><span>${escapeHtml(record.email)}</span></div>
						<div class="info-row full-row"><strong>Residential Address</strong><span>${escapeHtml(record.address)}</span></div>
					</div>
				</article>
			</div>

			<article class="info-card attending-card detail-info-card full-width-card">
				<div class="attending-banner">
					<p class="summary-label accent">ATTENDING VET</p>
					<h3>${escapeHtml(record.attendingVet)}</h3>
				</div>
				<div class="visit-details-grid">
					<div>
						<p class="summary-label">VISIT DETAILS</p>
						<div class="info-list">
							<div class="info-row"><strong>Visit Date</strong><span>${formatDate(record.visitDate)}</span></div>
							<div class="info-row"><strong>Last Visit Date</strong><span>${escapeHtml(record.lastVisit)}</span></div>
							<div class="info-row"><strong>Case Category</strong><span>${escapeHtml(record.category)}</span></div>
							<div class="info-row"><strong>Diagnosis</strong><span>${escapeHtml(record.diagnosis)}</span></div>
						</div>
					</div>
					<div>
						<p class="summary-label">SYMPTOMS</p>
						<p class="detail-paragraph">${escapeHtml(record.symptoms)}</p>
						<p class="summary-label">TREATMENT</p>
						<p class="detail-paragraph">${escapeHtml(record.treatment)}</p>
						<span class="emergency-pill">Emergency</span>
					</div>
					<div>
						<p class="summary-label">PRESCRIBED MEDICATIONS</p>
						<div class="medication-list stacked medication-list-panel">
							${(Array.isArray(record.medications) ? record.medications : []).map((medication) => `<span class="med-pill med-pill-row"><span>${escapeHtml(medication)}</span><span class="med-status">ACTIVE</span></span>`).join('') || '<span class="muted">No medications listed.</span>'}
						</div>
						<p class="followup-note">Follow up date: ${formatDate(record.followUpDate)}</p>
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
	return `
		<div class="vaccination-section">
			<div class="vaccination-header">
				<h3>Vaccination History</h3>
				<p>Clinical immunization record for ${escapeHtml(record.species.toLowerCase())} patients.</p>
			</div>
			${vaccinationHistory.map((vaccination) => `
				<article class="vaccination-card">
					<div class="vaccination-icon">+</div>
					<div class="vaccination-main">
						<h4>${escapeHtml(vaccination.name)}</h4>
						<p class="muted">${escapeHtml(vaccination.description || 'Vaccination record')}</p>
					</div>
					<div class="vaccination-meta">
						<div>
							<p class="history-label">Administered</p>
							<strong>${formatDate(vaccination.date)}</strong>
						</div>
						<div>
							<p class="history-label">Provider</p>
							<strong>${escapeHtml(vaccination.provider || record.attendingVet)}</strong>
						</div>
						<div>
							<p class="history-label">Next Due</p>
							<strong>${escapeHtml(vaccination.nextDue || 'TBD')}</strong>
						</div>
					</div>
					<div class="vaccination-status">
						<span class="tag success">${escapeHtml(vaccination.status || 'Completed')}</span>
					</div>
				</article>
			`).join('')}
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
						<button type="button" class="btn btn-accent" data-nav="add"><img src="/Final-Backend/vet/images/add.svg" alt="icon"> Add New Patient</button>
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
				<div class="section-head">
					<div class="search-row">
						<div class="search-box">
							<svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>
							<input class="search-input" id="search-input" type="search" placeholder="Search by patient name, breed, or owner..." value="${escapeHtml(state.query)}">
						</div>
					</div>
					<div class="filter-strip" aria-label="Patient filters">
						<span class="filter-label">FILTERS:</span>
						<button type="button" class="filter-pill ${state.filterType === 'all' ? 'active' : ''}" data-filter-type="all">All Pets</button>
						<button type="button" class="filter-pill ${state.filterType === 'canine' ? 'active' : ''}" data-filter-type="canine">Canine</button>
						<button type="button" class="filter-pill ${state.filterType === 'feline' ? 'active' : ''}" data-filter-type="feline">Feline</button>
						<button type="button" class="filter-pill ${state.filterType === 'avian' ? 'active' : ''}" data-filter-type="avian">Avian</button>
						<button type="button" class="filter-pill ${state.filterType === 'exotic' ? 'active' : ''}" data-filter-type="exotic">Exotic</button>
						<button type="button" class="filter-pill ${state.filterType === 'active' ? 'active' : ''}" data-filter-type="active">Active</button>
					</div>
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
								<th>Pet Type</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							${records.length ? records.map((record) => `
								<tr>
									<td>
										<div class="patient-mini">
											<div>
												<strong>${escapeHtml(record.petName)}</strong>
												<span>${escapeHtml(record.breed)} · ${escapeHtml(record.species)}</span>
											</div>
										</div>
									</td>
									<td>
										<strong>${escapeHtml(record.ownerName)}</strong><br>
										<span>${escapeHtml(record.phone)}</span>
									</td>
									<td>
										<strong>${escapeHtml(record.lastVisit)}</strong>
									</td>
									<td><span class="location-text">${escapeHtml(record.location || record.address)}</span></td>
									<td>${statusTag(record)}</td>
									<td><span class="pet-pill">${escapeHtml(record.species)}</span></td>
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
									<td colspan="7"><div class="empty-state">No patient records match the current search.</div></td>
								</tr>
							`}
						</tbody>
					</table>
				</div>

				<div class="page-footer">
						<p>Showing ${records.length} of ${total} patients</p>
						<p>${records.length ? 'Click view to inspect the patient, or add record to start a new clinical entry.' : 'Clear filters to see the full directory.'}</p>
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
			<div class="section-head">
				<div>
					<button type="button" class="btn btn-soft" data-nav="list"><img src="/Final-Backend/vet/images/back.svg" alt="Back">Back to records</button>
					<h2>${pageTitle}</h2>
					<p>${hasContext ? `Create a new clinical entry for ${escapeHtml(data.petName)}.` : 'Register a new patient record and capture the first clinical note.'}</p>
				</div>
				<div class="hero-actions"></div>
			</div>

			<form id="record-form" class="form-layout">
				<article class="form-card">
					<div class="detailed-header">
					<img src="/Final-Backend/vet/images/paw-green.svg" alt="Pet-icon">
					
					<h3>Pet Information</h3>
					</div>
					<div class="form-grid">
						<div class="field span-2">
							<label for="pet-name">Pet name</label>
							<input class="form-input" id="pet-name" name="petName" required value="${escapeHtml(data.petName)}">
						</div>
						<div class="field">
							<label for="species">Species</label>
							<select class="form-input" id="species" name="species">
								<option ${data.species === 'Canine' ? 'selected' : ''}>Canine</option>
								<option ${data.species === 'Feline' ? 'selected' : ''}>Feline</option>
								<option ${data.species === 'Avian' ? 'selected' : ''}>Avian</option>
								<option ${data.species === 'Exotic' ? 'selected' : ''}>Exotic</option>
							</select>
						</div>
						<div class="field">
							<label for="breed">Breed</label>
							<input class="form-input" id="breed" name="breed" value="${escapeHtml(data.breed)}">
						</div>
						<div class="field">
							<label for="age">Age</label>
							<input class="form-input" id="age" name="age" value="${escapeHtml(data.age)}">
						</div>
						<div class="field">
							<label for="sex">Sex</label>
							<select class="form-input" id="sex" name="sex">
								<option ${data.sex === 'Male' ? 'selected' : ''}>Male</option>
								<option ${data.sex === 'Female' ? 'selected' : ''}>Female</option>
							</select>
						</div>
						<div class="field span-2">
							<label for="weight">Weight</label>
							<input class="form-input" id="weight" name="weight" value="${escapeHtml(data.weight)}">
						</div>
						<div class="field span-2">
							<label for="color-markings">Color / Markings</label>
							<input class="form-input" id="color-markings" name="colorMarkings" value="${escapeHtml(data.colorMarkings)}">
						</div>
					</div>
				</article>

				<article class="form-card">
				<div class="detailed-header">
					<img src="/Final-Backend/vet/images/owner.svg" alt="Owner-icon">
					<h3>Owner Information</h3>
					</div>
					<div class="form-grid">
						<div class="field span-2">
							<label for="owner-name">Owner name</label>
							<input class="form-input" id="owner-name" name="ownerName" required value="${escapeHtml(data.ownerName)}">
						</div>
						<div class="field">
							<label for="phone">Phone number</label>
							<input class="form-input" id="phone" name="phone" value="${escapeHtml(data.phone)}">
						</div>
						<div class="field">
							<label for="email">Email address</label>
							<input class="form-input" id="email" name="email" type="email" value="${escapeHtml(data.email)}">
						</div>
						<div class="field span-2">
							<label for="address">Complete address</label>
							<input class="form-input" id="address" name="address" value="${escapeHtml(data.address)}">
						</div>
					</div>
				</article>

				<article class="form-card span-2">
				<div class="detailed-header">
					<img src="/Final-Backend/vet/images/medicine.svg" alt="Visit-icon">
					<h3>Visit Details</h3>
					</div>
					<div class="form-grid">
						<div class="field span-2">
							<label for="visit-title">Visit title</label>
							<input class="form-input" id="visit-title" name="visitTitle" placeholder="e.g. Annual Checkup" value="${escapeHtml(data.visitTitle)}">
						</div>
						<div class="field">
							<label for="visit-date">Visit date</label>
							<input class="form-input" id="visit-date" name="visitDate" type="date" value="${escapeHtml(data.visitDate)}">
						</div>
						<div class="field">
							<label for="follow-up-date">Follow-up date</label>
							<input class="form-input" id="follow-up-date" name="followUpDate" type="date" value="${escapeHtml(data.followUpDate)}">
						</div>
						<div class="field span-2">
							<label for="symptoms">Symptoms / chief complaint</label>
							<textarea class="form-textarea" id="symptoms" name="symptoms" placeholder="Describe clinical signs">${escapeHtml(data.symptoms)}</textarea>
						</div>
						<div class="field span-2">
							<label for="diagnosis">Diagnosis</label>
							<textarea class="form-textarea" id="diagnosis" name="diagnosis" placeholder="Final or differential diagnosis">${escapeHtml(data.diagnosis)}</textarea>
						</div>
						<div class="field span-2">
							<label for="treatment">Treatment provided</label>
							<textarea class="form-textarea" id="treatment" name="treatment" placeholder="Procedures performed">${escapeHtml(data.treatment)}</textarea>
						</div>
						<div class="field span-2">
							<label for="medications">Prescribed medications</label>
							<input class="form-input" id="medications" name="medications" placeholder="Comma-separated medication names" value="${escapeHtml(Array.isArray(data.medications) ? data.medications.join(', ') : data.medications)}">
						</div>
						<div class="field">
							<label for="category">Case category</label>
							<select class="form-input" id="category" name="category">
								${['Routine Checkup', 'Vaccination', 'Dermatology', 'Emergency', 'Surgery Follow-up'].map((item) => `<option ${data.category === item ? 'selected' : ''}>${item}</option>`).join('')}
							</select>
						</div>
						<div class="field">
							<label for="attending-vet">Attending veterinarian</label>
							<input class="form-input" id="attending-vet" name="attendingVet" value="${escapeHtml(data.attendingVet)}">
						</div>
						<div class="field">
							<label for="vaccination-status">Vaccination status</label>
							<input class="form-input" id="vaccination-status" name="vaccinationStatus" value="${escapeHtml(data.vaccinationStatus)}">
						</div>
						<div class="field">
							<label for="vaccine-brand">Vaccine brand</label>
							<input class="form-input" id="vaccine-brand" name="vaccineBrand" value="${escapeHtml(data.vaccineBrand)}">
						</div>
						<div class="field">
							<label for="status">Record status</label>
							<select class="form-input" id="status" name="status">
								<option value="Active Patient" ${data.status === 'Active Patient' ? 'selected' : ''}>Active Patient</option>
								<option value="Monitoring" ${data.status === 'Monitoring' ? 'selected' : ''}>Monitoring</option>
								<option value="Critical" ${data.status === 'Critical' ? 'selected' : ''}>Critical</option>
							</select>
						</div>
					</div>
					<div class="form-footer">
						<button type="button" class="btn btn-soft" data-nav="list">Cancel</button>
						<button type="submit" class="btn btn-primary">${submitLabel} <img src="/Final-Backend/vet/images/plus.svg" alt="add"></button>
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
				<button type="button" class="back-link" data-nav="list"><img src="/Final-Backend/vet/images/back.svg" alt="Back"> Back to Patient Records</button>
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
							<button type="button" class="btn btn-primary" data-nav="add" data-id="${record.id}"><img src="/Final-Backend/vet/images/addView.svg" alt="Add New Record"> Add New Record</button>
							<button type="button" class="more-btn" aria-label="More actions">&#8230;</button>
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
		<form id="edit-record-form">
			<h2 id="records-modal-title">Edit Patient Information</h2>
			<p class="muted">Update the patient profile and save the changes to the record.</p>

			<div class="form-grid" style="margin-top: 14px;">
				<div class="field span-2">
					<label for="edit-pet-name">Pet name</label>
					<input class="form-input" id="edit-pet-name" name="petName" required value="${escapeHtml(record.petName)}">
				</div>
				<div class="field">
					<label for="edit-species">Species</label>
					<select class="form-input" id="edit-species" name="species">
						${['Canine', 'Feline', 'Avian', 'Exotic'].map((item) => `<option ${record.species === item ? 'selected' : ''}>${item}</option>`).join('')}
					</select>
				</div>
				<div class="field">
					<label for="edit-breed">Breed</label>
					<input class="form-input" id="edit-breed" name="breed" value="${escapeHtml(record.breed)}">
				</div>
				<div class="field">
					<label for="edit-age">Age</label>
					<input class="form-input" id="edit-age" name="age" value="${escapeHtml(record.age)}">
				</div>
				<div class="field">
					<label for="edit-sex">Sex</label>
					<select class="form-input" id="edit-sex" name="sex">
						<option ${record.sex === 'Male' ? 'selected' : ''}>Male</option>
						<option ${record.sex === 'Female' ? 'selected' : ''}>Female</option>
					</select>
				</div>
				<div class="field span-2">
					<label for="edit-owner-name">Owner name</label>
					<input class="form-input" id="edit-owner-name" name="ownerName" value="${escapeHtml(record.ownerName)}">
				</div>
				<div class="field span-2">
					<label for="edit-phone">Phone number</label>
					<input class="form-input" id="edit-phone" name="phone" value="${escapeHtml(record.phone)}">
				</div>
				<div class="field span-2">
					<label for="edit-status">Record status</label>
					<select class="form-input" id="edit-status" name="status">
						<option value="Active Patient" ${record.status === 'Active Patient' ? 'selected' : ''}>Active Patient</option>
						<option value="Monitoring" ${record.status === 'Monitoring' ? 'selected' : ''}>Monitoring</option>
						<option value="Critical" ${record.status === 'Critical' ? 'selected' : ''}>Critical</option>
					</select>
				</div>
			</div>

			<div class="modal-footer" style="justify-content: space-between;">
				<button type="button" class="btn btn-danger" data-modal-action="open-delete" data-id="${record.id}">${ICONS.trash} Delete Record</button>
				<div style="display:flex; gap:10px; flex-wrap:wrap;">
					<button type="button" class="btn btn-soft" data-modal-action="close-modal">Cancel</button>
					<button type="submit" class="btn btn-primary">Save Changes</button>
				</div>
			</div>
		</form>
	`;
}

function renderDeleteModal(record) {
	if (!record) return '<div class="empty-state">Record not found.</div>';
	return `
		<div>
			<h2 id="records-modal-title">Delete Patient Record?</h2>
			<p class="muted">This action removes the record permanently. Type DELETE to confirm.</p>
			<div class="delete-warning">
				<strong>${escapeHtml(record.petName)}</strong><br>
				<span class="muted">Owner: ${escapeHtml(record.ownerName)}</span>
			</div>
			<div class="field">
				<label for="delete-confirm">Type DELETE to confirm</label>
				<input class="form-input" id="delete-confirm" type="text" placeholder="DELETE" autocomplete="off">
			</div>
			<div class="modal-footer">
				<button type="button" class="btn btn-soft" data-modal-action="close-modal">Cancel</button>
				<button type="button" class="btn btn-danger" data-modal-action="confirm-delete" data-id="${record.id}">Delete Record</button>
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
			navigate('list', { q: state.query, type: button.dataset.filterType, status: state.filterStatus }, true);
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
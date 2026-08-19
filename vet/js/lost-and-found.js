'use strict';

const LF_ENDPOINT = '/api/lost-found/lost_and_found.php';
const FALLBACK_IMAGE = '../../public/images/img/upload-pet.png';
const PET_TYPES = ['Dog', 'Cat'];

const lfData = {
	filters: {
		types: ['All Types', 'Lost', 'Found'],
		sources: ['All Sources', 'Owner', 'Admin/Clinic'],
		barangays: ['Select Barangay']
	},
	tabs: [
		{ id: 'pending', label: 'Pending Review' },
		{ id: 'active', label: 'Active Reports' },
		{ id: 'potential', label: 'Potential Matches', badge: 'NEW' },
		{ id: 'resolved', label: 'Resolved Cases' },
		{ id: 'claims', label: 'Claims' },
		{ id: 'sighting', label: 'Sighting' }
	],
	pendingReports: [],
	activeReports: [],
	potentialMatches: [],
	resolvedCases: [],
	claims: [],
	sightings: [],
	// Every report regardless of status (pending/active/resolved/rejected) — separate
	// from the status-scoped lists above, used only to look up the specific lost report
	// a sighting was filed against (sighting.reportId), which can be in any status.
	allReports: []
};

const barangayCoordinates = {
	Tiaong: [14.942488, 120.896141],
	Poblacion: [14.952325, 120.902748],
	'San Jose': [14.949194, 120.897469],
	Tangos: [14.97498, 120.897369],
	'Bagong Nayon': [14.96041, 120.898087],
	Sulivan: [14.979081, 120.885002],
	Pagala: [14.962781, 120.889984],
	'Virgen Delas Flores': [14.946227, 120.88604],
	Matangtubig: [14.954293, 120.861511],
	Makinabang: [14.919284, 120.883728],
	Tilapayong: [14.977394, 120.873024],
	Tibag: [14.956218, 120.904831],
	Hinukay: [15.001118, 120.891594],
	Pinagbarilan: [14.952386, 120.878044],
	Concepcion: [14.952222, 120.888626],
	Tarcan: [14.935418, 120.866425],
	'San Roque': [15.000359, 120.889992],
	Calantipay: [14.970637, 120.863106],
	Subic: [14.96235, 120.902748],
	Barangca: [14.986587, 120.900276],
	Paitan: [15.01128, 120.894753],
	Sabang: [14.968414, 120.908592],
	Piel: [14.986943, 120.88723],
	'Sta. Barbara': [14.938139, 120.889046],
	'Sto. Nino': [14.983848, 120.893478],
	'Sto. Niño': [14.983848, 120.893478],
	'Sto. Cristo': [14.956154, 120.893936],
	Catulinan: [14.968497, 120.877312],
	'Select Barangay': [14.9577, 120.9055]
};

function formatDate(value) {
	if (!value) return 'No date';
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function todayISODate() {
	const now = new Date();
	const offset = now.getTimezoneOffset();
	return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function nearestBarangay(lat, lng) {
	let closest = null;
	let closestDist = Infinity;
	Object.keys(barangayCoordinates).forEach((name) => {
		if (name === 'Select Barangay') return;
		const [blat, blng] = barangayCoordinates[name];
		const dist = Math.hypot(blat - lat, blng - lng);
		if (dist < closestDist) {
			closestDist = dist;
			closest = name;
		}
	});
	return closest;
}

const lfState = {
	activeTab: 'pending',
	search: '',
	typeFilter: 'All Types',
	sourceFilter: 'All Sources',
	barangayFilter: 'Select Barangay',
	selectedMatchId: null,
	matchesView: 'found', // 'found' = lost/found report pairs, 'sighting' = community sightings
	modalMaps: [],
	resolvedPage: 1
};

// Potential Matches only ever shows lost-vs-found report pairs by default.
// Sighting-based candidates (found_report_id null, sighting_id set) are kept
// out of that list and surfaced instead behind the "View Sighting Reports" toggle.
function splitMatches(matches) {
	return {
		found: matches.filter((match) => match.found?.reportId),
		sighting: matches.filter((match) => !match.found?.reportId && match.found?.sightingId)
	};
}

// Desktop gets more rows per page than a phone screen can comfortably show.
function pageSizeForViewport() {
	return window.innerWidth <= 768 ? 5 : 10;
}

function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>"']/g, (char) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#039;'
	}[char]));
}

/* ── Click-to-expand photos (lightbox) ──────────
   Same pattern as the public-facing Lost & Found page: wraps a thumbnail with a
   small expand-icon badge; clicking either opens it full-size. `small` shrinks
   the badge for compact thumbnails (match-card pet photos). */
const EXPAND_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5.5 1.5H2.5a1 1 0 00-1 1v3M8.5 1.5h3a1 1 0 011 1v3M5.5 12.5H2.5a1 1 0 01-1-1v-3M8.5 12.5h3a1 1 0 001-1v-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function expandableImg(src, alt, imgClass, small = false) {
	const safeSrc = escapeHtml(src || FALLBACK_IMAGE);
	const safeAlt = escapeHtml(alt || '');
	return `
		<div class="lf-img-expand-wrap${small ? ' small' : ''}" data-lightbox-src="${safeSrc}" data-lightbox-alt="${safeAlt}">
			<img src="${safeSrc}" alt="${safeAlt}" class="${imgClass}" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';this.closest('.lf-img-expand-wrap').dataset.lightboxSrc='${FALLBACK_IMAGE}';">
			<button type="button" class="lf-expand-badge" aria-label="Expand photo" tabindex="-1">${EXPAND_ICON_SVG}</button>
		</div>
	`;
}

function openLightbox(src, alt) {
	const overlay = document.getElementById('lfLightbox');
	const img = document.getElementById('lfLightboxImg');
	if (!overlay || !img || !src) return;
	img.src = src;
	img.alt = alt || '';
	overlay.hidden = false;
}

function closeLightboxDirect() {
	const overlay = document.getElementById('lfLightbox');
	if (overlay) overlay.hidden = true;
}

document.addEventListener('click', (event) => {
	if (event.target.closest('[data-lightbox-close]')) {
		closeLightboxDirect();
		return;
	}
	const trigger = event.target.closest('[data-lightbox-src]');
	if (trigger) {
		event.stopPropagation();
		openLightbox(trigger.dataset.lightboxSrc, trigger.dataset.lightboxAlt);
		return;
	}
	if (event.target.id === 'lfLightbox') closeLightboxDirect();
});

function getSession() {
	try {
		return JSON.parse(localStorage.getItem('vbetter_session') || 'null');
	} catch {
		return null;
	}
}

function lfForm(action, data = {}) {
	const form = data instanceof FormData ? data : new FormData();
	form.append('action', action);
	if (!(data instanceof FormData)) {
		Object.entries(data).forEach(([key, value]) => {
			if (value !== undefined && value !== null && value !== '' && value !== 'all') form.append(key, value);
		});
	}
	const session = getSession();
	form.append('role', session?.role || 'vet');
	if (session?.userId && !form.has('user_id')) form.append('user_id', session.userId);
	if (session?.userId && !form.has('reviewed_by_user_id')) form.append('reviewed_by_user_id', session.userId);
	return form;
}

// Staff actions on this endpoint are guarded by requireRole(), which reads the
// Authorization header only -- the user_id in the form body is not identity.
// Without this the whole management page 401s, which is what it was doing.
// No Content-Type here: FormData sets its own multipart boundary.
function lfAuthHeaders() {
	const session = getSession();
	const token = session?.token || localStorage.getItem('bvetter_token');
	return token ? { Authorization: `Bearer ${token}` } : {};
}

async function lfRequest(action, data = {}) {
	const response = await fetch(LF_ENDPOINT, { method: 'POST', headers: lfAuthHeaders(), body: lfForm(action, data) });
	const result = await response.json();
	if (!result.success) throw new Error(result.message || 'Lost and found request failed.');
	return result;
}

function normalizeReport(report) {
	return {
		...report,
		id: String(report.id),
		type: report.type || 'Lost',
		title: report.title || report.petName || (String(report.type).toLowerCase() === 'found' ? 'Found Pet Report' : 'Lost Pet Report'),
		petName: report.petName || report.title || 'Unknown',
		source: report.source || 'Owner',
		image: report.image || FALLBACK_IMAGE,
		uploadedBy: report.uploadedBy || report.uploader || 'Unknown',
		uploader: report.uploader || report.uploadedBy || 'Unknown',
		contact: report.contact || '',
		barangay: report.barangay || 'Baliwag',
		date: report.date || report.created_at || '',
		time: report.time || '',
		markings: report.markings || '',
		notes: report.notes || '',
		lat: report.lat ?? report.latitude ?? null,
		lng: report.lng ?? report.longitude ?? null
	};
}

function normalizeClaim(claim) {
	return {
		id: String(claim.id),
		caseId: claim.case_number,
		title: claim.claimant_name || 'Claimant',
		petName: claim.pet_name || 'Found Pet Report',
		source: 'Owner',
		barangay: claim.barangay_name || '',
		uploadedAt: claim.created_at || '',
		contact: claim.claimant_phone || '',
		image: claim.photo_path || FALLBACK_IMAGE,
		finderName: claim.finder_name || 'Unknown',
		finderContact: claim.finder_phone || claim.finder_email || 'No contact provided',
		// Found report's own attributes, for the staff-only side-by-side comparison
		// against what the claimant submitted — a claim has no structured pet data
		// of its own (just contact info + a proof document), so there's nothing to
		// auto-score; staff compare these against the proof themselves.
		species: claim.report_species || '',
		breed: claim.report_breed || '',
		sex: claim.report_sex || '',
		size: claim.report_size || '',
		markings: claim.report_markings || '',
		proofFile: claim.proof_file_path || null,
		proofType: claim.proof_type || 'Evidence',
		proofNotes: claim.proof_notes || ''
	};
}

function normalizeSighting(sighting) {
	return {
		id: String(sighting.id),
		caseId: sighting.case_number,
		title: sighting.notes || 'Sighting Report',
		source: 'Owner',
		barangay: sighting.barangay_name || '',
		uploadedAt: sighting.created_at || '',
		dateLost: sighting.sighting_date || '',
		timeLost: sighting.sighting_time || '',
		uploader: sighting.contact_name || 'Unknown',
		contact: sighting.contact_phone || '',
		image: sighting.photo_path || FALLBACK_IMAGE,
		lat: sighting.latitude ?? null,
		lng: sighting.longitude ?? null,
		// The specific lost report this sighting was filed against — captured when the
		// finder clicked "Report a Sighting" from that report's page (see
		// public/js/lost-found.js submitSighting -> report_id). Null for the rare
		// sighting submitted without that context.
		reportId: sighting.report_id ? String(sighting.report_id) : null
	};
}

async function initLostFound() {
	populateFilterSelects();
	bindControls();
	renderTabs();
	await loadAllData();
}

async function loadAllData() {
	const content = document.getElementById('lfContent');
	if (content) content.innerHTML = '<div class="list-note">Loading lost and found records...</div>';

	try {
		const [pending, active, resolved, all, matches, claims, sightings, barangays] = await Promise.all([
			lfRequest('management_list', { status: 'pending' }),
			lfRequest('management_list', { status: 'active' }),
			lfRequest('management_list', { status: 'resolved' }),
			lfRequest('management_list', { status: 'all' }),
			lfRequest('matches'),
			lfRequest('management_claims', { status: 'pending' }),
			lfRequest('list_sightings', { status: 'pending' }),
			fetch('/api/barangays/list.php').then((r) => r.json()).catch(() => null)
		]);

		lfData.pendingReports = (pending.data || []).map(normalizeReport);
		lfData.activeReports = (active.data || []).map(normalizeReport);
		lfData.resolvedCases = (resolved.data || []).map(normalizeReport);
		lfData.allReports = (all.data || []).map(normalizeReport);
		lfData.potentialMatches = matches.data || [];
		lfData.claims = (claims.data || []).map(normalizeClaim);
		lfData.sightings = (sightings.data || []).map(normalizeSighting);
		if (barangays?.success) {
			lfData.filters.barangays = ['Select Barangay', ...barangays.data.map((item) => item.name)];
			populateFilterSelects();
		}
		lfState.matchesView = 'found';
		lfState.selectedMatchId = splitMatches(lfData.potentialMatches).found[0]?.id || null;
		renderEverything();
	} catch (error) {
		if (content) content.innerHTML = `<div class="list-note">${escapeHtml(error.message)}</div>`;
	}
}

function bindControls() {
	document.getElementById('searchInput')?.addEventListener('input', (event) => {
		lfState.search = event.target.value.trim().toLowerCase();
		renderContent();
	});
	document.getElementById('typeFilter')?.addEventListener('change', (event) => {
		lfState.typeFilter = event.target.value;
		renderContent();
	});
	document.getElementById('sourceFilter')?.addEventListener('change', (event) => {
		lfState.sourceFilter = event.target.value;
		renderContent();
	});
	document.getElementById('barangayFilter')?.addEventListener('change', (event) => {
		lfState.barangayFilter = event.target.value;
		renderContent();
	});
	document.getElementById('uploadFoundBtn')?.addEventListener('click', () => openModal(buildUploadModal()));
	document.getElementById('closeModalBtn')?.addEventListener('click', closeModal);
	document.getElementById('lfModalOverlay')?.addEventListener('click', (event) => {
		if (event.target.id === 'lfModalOverlay') closeModal();
	});
}

function populateFilterSelects() {
	fillSelect(document.getElementById('typeFilter'), lfData.filters.types);
	fillSelect(document.getElementById('sourceFilter'), lfData.filters.sources);
	fillSelect(document.getElementById('barangayFilter'), lfData.filters.barangays);
}

function fillSelect(element, values) {
	if (!element) return;
	element.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
}

function renderEverything() {
	renderStats();
	renderTabs();
	renderContent();
}

function renderStats() {
	const stats = [
		{ label: 'Pending Review', value: lfData.pendingReports.length, foot: 'Submissions', featured: true },
		{ label: 'Active Reports', value: lfData.activeReports.length, foot: 'Publicly visible' },
		{ label: 'Clinic Uploaded', value: lfData.activeReports.filter((item) => item.source !== 'Owner').length, foot: 'From clinic staff' },
		{ label: 'Suggested Matches', value: lfData.potentialMatches.length, foot: 'Candidates' },
		{ label: 'Resolved', value: lfData.resolvedCases.length, foot: 'Closed reports' }
	];
	document.getElementById('statsRow').innerHTML = stats.map((stat) => `
		<article class="stat-card ${stat.featured ? 'featured' : ''}">
			<h5>${escapeHtml(stat.label)}</h5>
			<strong>${stat.value}</strong>
			<small>${escapeHtml(stat.foot)}</small>
		</article>
	`).join('');
}

function renderTabs() {
	const tabRoot = document.getElementById('tabBar');
	tabRoot.innerHTML = lfData.tabs.map((tab) => {
		const activeClass = lfState.activeTab === tab.id ? 'active' : '';
		// Scoped to real lost-vs-found report pairs only — the tab's own default
		// view — not sighting-based candidates, which live behind the in-tab toggle.
		const badge = tab.badge && splitMatches(lfData.potentialMatches).found.length ? `<span class="tab-pill">${tab.badge}</span>` : '';
		return `<button type="button" class="tab-btn ${activeClass}" data-tab-id="${tab.id}">${escapeHtml(tab.label)}${badge}</button>`;
	}).join('');
	tabRoot.querySelectorAll('.tab-btn').forEach((button) => {
		button.addEventListener('click', () => {
			lfState.activeTab = button.dataset.tabId;
			renderTabs();
			renderContent();
		});
	});
}

function filtered(items, mapFn) {
	return items.filter((item) => {
		const model = mapFn(item);
		const searchable = `${model.title} ${model.breed} ${model.barangay} ${model.source}`.toLowerCase();
		return (!lfState.search || searchable.includes(lfState.search))
			&& (lfState.typeFilter === 'All Types' || model.type === lfState.typeFilter)
			&& (lfState.sourceFilter === 'All Sources' || model.source === lfState.sourceFilter)
			&& (lfState.barangayFilter === 'Select Barangay' || model.barangay === lfState.barangayFilter);
	});
}

function renderContent() {
	const root = document.getElementById('lfContent');
	if (lfState.activeTab === 'pending') return renderReportList(root, lfData.pendingReports, 'pending');
	if (lfState.activeTab === 'active') return renderActive(root);
	if (lfState.activeTab === 'potential') return renderPotential(root);
	if (lfState.activeTab === 'resolved') return renderResolved(root);
	if (lfState.activeTab === 'claims') return renderClaims(root);
	return renderSightings(root);
}

function empty(message) {
	return `<div class="list-note">${escapeHtml(message)}</div>`;
}

function reportCard(report, mode) {
	return `
		<article class="report-card ${report.type === 'Found' ? 'pending-found' : 'pending-lost'}">
			<div class="report-image">
				<img src="${escapeHtml(report.image)}" alt="${escapeHtml(report.petName)}" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';">
				<span class="tag-chip ${report.type.toLowerCase()}">${escapeHtml(report.type.toUpperCase())}</span>
			</div>
			<div class="report-body">
				<h3>${escapeHtml(report.title)}</h3>
				<p class="meta-line">Submitted by ${escapeHtml(report.uploader)} - ${escapeHtml(report.date || 'No date')}</p>
				<p class="desc-line">${escapeHtml(report.notes || 'No notes')}</p>
				<div class="card-actions">
					${mode === 'pending' ? `
						<button type="button" class="btn btn-success" data-action="approve-pending" data-id="${report.id}">Approve</button>
						<button type="button" class="btn btn-danger" data-action="reject-pending" data-id="${report.id}">Reject</button>
					` : ''}
					${mode === 'active' ? `
						<button type="button" class="btn btn-success" data-action="resolve-active" data-id="${report.id}">Resolve</button>
					` : ''}
					<button type="button" class="btn btn-secondary" data-action="view-${mode}" data-id="${report.id}">View</button>
				</div>
			</div>
			<div class="report-side">
				<span class="pill">${escapeHtml(report.barangay)}</span>
				<span class="pill">${escapeHtml(report.size || '')}</span>
			</div>
		</article>
	`;
}

function renderReportList(root, reports, mode) {
	const list = filtered(reports, (item) => ({
		title: item.title,
		breed: item.breed,
		barangay: item.barangay,
		source: item.source,
		type: item.type
	}));
	root.innerHTML = `${mode === 'pending' ? '<div class="list-note">Owner reports wait here until vet approval. Approved reports become public and active.</div>' : ''}${list.length ? list.map((item) => reportCard(item, mode)).join('') : empty('No records found.')}`;
	bindRootActions(root);
}

function renderActive(root) {
	const list = filtered(lfData.activeReports, (item) => ({
		title: item.title,
		breed: item.breed,
		barangay: item.barangay,
		source: item.source,
		type: item.type
	}));
	root.innerHTML = list.length ? `<div class="active-grid">${list.map((item) => `
		<article class="active-card" data-action="view-active" data-id="${item.id}">
			<div class="active-card-media">
				<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';">
				<span class="tag-chip ${(item.type || 'lost').toLowerCase()}">${escapeHtml((item.type || 'Lost').toUpperCase())}</span>
			</div>
			<div class="active-card-body">
				<h4>${escapeHtml(item.title)}</h4>
				<small>${escapeHtml(item.barangay)} &middot; ${escapeHtml(item.date || '')}</small>
				<div class="mini-row">
					<span class="mini-chip">${escapeHtml(item.breed || '')}</span>
					${item.sex ? `<span class="mini-chip">${escapeHtml(item.sex)}</span>` : ''}
					<span class="mini-chip">${escapeHtml(item.size || '')}</span>
				</div>
				<div class="foot">
					<div class="uploader-info"><span class="uploader-label">Uploaded by</span><strong>${escapeHtml(item.source)}</strong></div>
					<button type="button" class="btn btn-success resolve-btn" data-action="resolve-active" data-id="${item.id}">Resolve</button>
				</div>
			</div>
		</article>
	`).join('')}</div>` : empty('No active reports found.');
	bindRootActions(root);
}

function confidenceGauge(confidence) {
	const pct = Math.max(0, Math.min(100, Number(confidence) || 0));
	const tone = pct >= 75 ? '#199f44' : pct >= 50 ? '#a07a13' : '#c52c2c';
	return `
		<div class="score-gauge" style="--gauge-pct:${pct}; --gauge-tone:${tone};">
			<span class="score-gauge-value">${pct}%</span>
		</div>
	`;
}

function renderPotential(root) {
	const { found, sighting } = splitMatches(lfData.potentialMatches);
	const showingSightings = lfState.matchesView === 'sighting';
	const list = showingSightings ? sighting : found;
	const selectedMatch = list.find((item) => String(item.id) === String(lfState.selectedMatchId)) || list[0];

	const toggleBtn = (sighting.length || showingSightings)
		? `<button type="button" class="btn btn-secondary matches-view-toggle" data-action="toggle-matches-view">
			${showingSightings ? '&larr; Back to Potential Matches' : `View Sighting Reports (${sighting.length})`}
		</button>`
		: '';

	if (!found.length && !sighting.length) {
		root.innerHTML = empty('No potential matches yet.');
		bindRootActions(root);
		return;
	}

	root.innerHTML = `
		<div class="potential-layout">
			<div class="potential-main">
				<div class="suggested-banner">
					<span class="suggested-banner-icon">&#9432;</span>
					${showingSightings
						? 'Community-submitted sightings matched to lost reports. Approving marks the sighting as resolved.'
						: 'Suggested matches are generated from pet details, image metadata, and location similarity.'}
				</div>
				${toggleBtn ? `<div class="matches-toggle-row">${toggleBtn}</div>` : ''}
				${list.length ? list.map((match) => `
					<article class="match-card ${selectedMatch && String(match.id) === String(selectedMatch.id) ? 'is-selected' : ''}" data-action="select-match" data-id="${match.id}">
						<div class="match-pair">
							<div class="match-side">${expandableImg(match.lost.image, match.lost.name, '', true)}<h4>${escapeHtml(match.lost.name)}</h4><small>${escapeHtml(match.lost.breed || '')}</small></div>
							${confidenceGauge(match.confidence)}
							<div class="match-side">${expandableImg(match.found.image, showingSightings ? 'Community Sighting' : match.found.name, '', true)}<h4>${escapeHtml(showingSightings ? 'Community Sighting' : match.found.name)}</h4><small>${escapeHtml(match.found.breed || '')}</small></div>
						</div>
						<div class="reason-row">${(match.reasons || []).map((reason) => `<span class="reason-chip">${escapeHtml(reason)}</span>`).join('')}</div>
						<div class="match-actions">
							<button type="button" class="btn btn-danger" data-action="dismiss-match" data-id="${match.id}">Dismiss</button>
							<button type="button" class="btn btn-success" data-action="approve-match" data-id="${match.id}">Approve Match</button>
						</div>
					</article>
				`).join('') : empty(showingSightings ? 'No sighting matches yet.' : 'No potential matches yet.')}
			</div>
			<aside class="approval-card">
				<h3>Approve The Match</h3>
				${selectedMatch ? `
					<p>Approving marks the matching case as resolved and notifies both submitters.</p>
					<div class="summary-box">
						<div class="summary-row"><span class="summary-label">Lost</span><span class="summary-value">${escapeHtml(selectedMatch.lost.name)}</span></div>
						<div class="summary-row"><span class="summary-label">${showingSightings ? 'Sighting' : 'Found'}</span><span class="summary-value">${escapeHtml(showingSightings ? 'Community Sighting' : selectedMatch.found.name)}</span></div>
						<div class="summary-row"><span class="summary-label">Confidence</span><span class="summary-value">${escapeHtml(String(selectedMatch.confidence))}%</span></div>
					</div>
					<button type="button" class="btn btn-primary approval-card-btn" data-action="approve-match" data-id="${selectedMatch.id}">Approve Match</button>
				` : '<p>No suggested match selected.</p>'}
			</aside>
		</div>
	`;
	bindRootActions(root);
}

function renderResolved(root) {
	if (!lfData.resolvedCases.length) { root.innerHTML = empty('No resolved cases yet.'); return; }
	const locIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

	const pageSize   = pageSizeForViewport();
	const totalPages = Math.max(1, Math.ceil(lfData.resolvedCases.length / pageSize));
	lfState.resolvedPage = Math.min(Math.max(1, lfState.resolvedPage), totalPages);
	const start   = (lfState.resolvedPage - 1) * pageSize;
	const pageRows = lfData.resolvedCases.slice(start, start + pageSize);

	root.innerHTML = `
		<div class="lf-table-wrap">
			<table class="lf-table">
				<thead>
					<tr>
						<th>Pet</th>
						<th>Type / Breed</th>
						<th>Source</th>
						<th>Owner / Submitter</th>
						<th>Date</th>
						<th>Status</th>
					</tr>
				</thead>
				<tbody>
					${pageRows.map((item) => `
						<tr>
							<td>
								<div class="lf-pet-cell">
									<div class="lf-pet-avatar">${escapeHtml((item.petName || '?')[0].toUpperCase())}</div>
									<span class="lf-pet-name">${escapeHtml(item.petName)}</span>
								</div>
							</td>
							<td><span class="lf-breed-text">${escapeHtml(item.breed || item.type || '—')}</span></td>
							<td><span class="lf-source-chip${String(item.source||'').toLowerCase()==='admin'?' lf-source-chip--admin':''}">${escapeHtml(item.source)}</span></td>
							<td>
								<div class="lf-submitter-cell">
									<span class="lf-submitter-name">${escapeHtml(item.uploader)}</span>
									<span class="lf-submitter-loc">${locIcon}${escapeHtml(item.barangay)}</span>
								</div>
							</td>
							<td><span class="lf-date-text">${escapeHtml(item.date || '—')}</span></td>
							<td><span class="lf-status-pill lf-pill-resolved">Resolved</span></td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		</div>
		${renderTablePagination(pageRows.length, lfData.resolvedCases.length, lfState.resolvedPage, totalPages)}
	`;

	const paginationEl = root.querySelector('.report-footer');
	if (paginationEl) {
		paginationEl.addEventListener('click', (event) => {
			const btn = event.target.closest('button[data-page]');
			if (!btn || btn.disabled) return;
			lfState.resolvedPage = btn.dataset.page === 'prev' ? lfState.resolvedPage - 1 : lfState.resolvedPage + 1;
			renderResolved(root);
		});
	}
}

// Same "Displaying X of Y Records" + boxed page-number pager markup/
// style used on the Reports table, so pagination looks consistent
// (and clean) across every table in the app.
function renderTablePagination(shown, total, page, totalPages) {
	if (totalPages <= 1) return '';
	return `
		<div class="report-footer">
			<p>Displaying ${shown} of ${total} Records</p>
			<div class="pagination">
				<button type="button" class="page-btn" data-page="prev" aria-label="Previous page" ${page <= 1 ? 'disabled' : ''}>&lsaquo;</button>
				<button type="button" class="page-btn active" disabled>${page}</button>
				<button type="button" class="page-btn" data-page="next" aria-label="Next page" ${page >= totalPages ? 'disabled' : ''}>&rsaquo;</button>
			</div>
		</div>
	`;
}

function renderClaims(root) {
	root.innerHTML = lfData.claims.length ? lfData.claims.map((claim) => `
		<article class="report-card pending-found">
			<div class="report-image"><img src="${escapeHtml(claim.image)}" alt="${escapeHtml(claim.petName)}" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';"><span class="tag-chip found">CLAIM</span></div>
			<div class="report-body">
				<h3>Claimant: ${escapeHtml(claim.title)}</h3>
				<p class="meta-line">Uploaded: ${escapeHtml(claim.uploadedAt)}</p>
				<p class="desc-line">Contact Number: ${escapeHtml(claim.contact)}</p>
				<div class="card-actions">
					<button type="button" class="btn btn-success" data-action="approve-claim" data-id="${claim.id}">Approve</button>
					<button type="button" class="btn btn-danger" data-action="reject-claim" data-id="${claim.id}">Reject</button>
					<button type="button" class="btn btn-secondary" data-action="view-claim" data-id="${claim.id}">View</button>
				</div>
			</div>
			<div class="report-side"><span class="pill">${escapeHtml(claim.barangay)}</span></div>
		</article>
	`).join('') : empty('No claims pending.');
	bindRootActions(root);
}

function renderSightings(root) {
	root.innerHTML = lfData.sightings.length ? lfData.sightings.map((sighting) => `
		<article class="report-card pending-found">
			<div class="report-image"><img src="${escapeHtml(sighting.image)}" alt="${escapeHtml(sighting.title)}" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';"><span class="tag-chip found">SIGHTING</span></div>
			<div class="report-body">
				<h3>${escapeHtml(sighting.title)}</h3>
				<p class="meta-line">Uploaded: ${escapeHtml(sighting.uploadedAt)}</p>
				<p class="desc-line">${escapeHtml(sighting.barangay)}, Baliwag, Bulacan</p>
				<div class="card-actions">
					<button type="button" class="btn btn-success" data-action="approve-sighting" data-id="${sighting.id}">Approve</button>
					<button type="button" class="btn btn-danger" data-action="reject-sighting" data-id="${sighting.id}">Reject</button>
					<button type="button" class="btn btn-secondary" data-action="view-sighting" data-id="${sighting.id}">View</button>
				</div>
			</div>
			<div class="report-side"><span class="pill">${escapeHtml(sighting.barangay)}</span></div>
		</article>
	`).join('') : empty('No sightings pending.');
	bindRootActions(root);
}

// ─── BUG FIX: Route view actions to the correct dedicated modal builder
//             and pass the mode to buildDetailModal for context-aware buttons.
// Every mutating action on this page confirms before it fires. One config entry
// per action drives both the root-level buttons and the buttons inside modals
// (wireModalActionButtons below) so the copy and behavior can't drift apart.
const CONFIRM_ACTIONS = {
	'approve-pending': { tone: 'success', title: 'Approve this report?', message: 'The report will go public and become visible to pet owners.', confirmLabel: 'Approve', request: 'approve_report', idKey: 'report_id' },
	'reject-pending': { tone: 'danger', title: 'Reject this report?', message: 'The submitter will be notified that their report was not approved.', confirmLabel: 'Reject', request: 'reject_report', idKey: 'report_id' },
	'resolve-active': { tone: 'success', title: 'Mark this case as resolved?', message: 'The report will be moved to Resolved Cases and removed from the active list.', confirmLabel: 'Resolve', request: 'resolve_report', idKey: 'report_id' },
	'approve-match': { tone: 'success', title: 'Approve this match?', message: 'This will mark both the lost and found reports as resolved and notify the submitters.', confirmLabel: 'Approve Match', request: 'approve_match', idKey: 'match_id' },
	'dismiss-match': { tone: 'danger', title: 'Dismiss this match?', message: 'This suggested match will be removed. This cannot be undone.', confirmLabel: 'Dismiss Match', request: 'dismiss_match', idKey: 'match_id' },
	'approve-claim': { tone: 'success', title: 'Approve this claim?', message: 'The claimant will be notified that their claim was approved.', confirmLabel: 'Approve', request: 'approve_claim', idKey: 'claim_id' },
	'reject-claim': { tone: 'danger', title: 'Reject this claim?', message: 'The claimant will be notified that their claim was not approved.', confirmLabel: 'Reject', request: 'reject_claim', idKey: 'claim_id' },
	'approve-sighting': { tone: 'success', title: 'Approve this sighting?', message: 'The sighting will be published and made visible to pet owners.', confirmLabel: 'Approve', request: 'approve_sighting', idKey: 'sighting_id' },
	'reject-sighting': { tone: 'danger', title: 'Reject this sighting?', message: 'The sighting will be rejected and removed from the queue.', confirmLabel: 'Reject', request: 'reject_sighting', idKey: 'sighting_id' }
};

function runConfirmableAction(action, id) {
	const config = CONFIRM_ACTIONS[action];
	if (!config) return false;
	openConfirmDialog({
		tone: config.tone,
		title: config.title,
		message: config.message,
		confirmLabel: config.confirmLabel,
		onConfirm: () => lfRequest(config.request, { [config.idKey]: id })
	});
	return true;
}

function bindRootActions(root) {
	root.querySelectorAll('[data-action]').forEach((button) => {
		button.addEventListener('click', async (event) => {
			// Let a click on an expand-photo badge open the lightbox instead of
			// triggering this card's own action (e.g. select-match) — otherwise
			// stopPropagation() below would swallow the click before the
			// document-level lightbox listener ever sees it.
			if (event.target.closest('[data-lightbox-src]')) return;
			event.preventDefault();
			event.stopPropagation();
			const action = button.dataset.action;
			const id = button.dataset.id;
			try {
				if (action.startsWith('view-')) {
					const mode = action.replace('view-', '');
					// Route claims and sightings to their own modal builders
					if (mode === 'claim') return openModal(buildClaimModal(findRecord(action, id)));
					if (mode === 'sighting') return openModal(buildSightingModal(findRecord(action, id)));
					// Pending and active reports go to the report detail modal with mode
					return openModal(buildDetailModal(findRecord(action, id), mode));
				}
				if (action === 'select-match') {
					lfState.selectedMatchId = id;
					return renderContent();
				}
				if (action === 'toggle-matches-view') {
					lfState.matchesView = lfState.matchesView === 'sighting' ? 'found' : 'sighting';
					const list = splitMatches(lfData.potentialMatches)[lfState.matchesView];
					lfState.selectedMatchId = list[0]?.id || null;
					return renderContent();
				}
				runConfirmableAction(action, id);
			} catch (error) {
				await vbAlert(error.message);
			}
		});
	});
}

function findRecord(action, id) {
	if (action.includes('pending')) return lfData.pendingReports.find((item) => item.id === id);
	if (action.includes('active')) return lfData.activeReports.find((item) => item.id === id);
	if (action.includes('claim')) return lfData.claims.find((item) => item.id === id);
	if (action.includes('sighting')) return lfData.sightings.find((item) => item.id === id);
	return null;
}

function openConfirmDialog({ tone = 'success', title, message, confirmLabel, cancelLabel = 'Cancel', onConfirm }) {
	document.getElementById('lfModalBody').innerHTML = `
		<div class="confirm-dialog">
			<div class="confirm-icon confirm-icon--${tone}">${tone === 'danger' ? '&#33;' : '&#10003;'}</div>
			<h3 class="confirm-title">${escapeHtml(title)}</h3>
			<p class="confirm-message">${escapeHtml(message)}</p>
			<div class="confirm-actions">
				<button type="button" class="btn btn-secondary" id="lfConfirmCancel">${escapeHtml(cancelLabel)}</button>
				<button type="button" class="btn ${tone === 'danger' ? 'btn-danger-solid' : 'btn-success'}" id="lfConfirmOk">${escapeHtml(confirmLabel)}</button>
			</div>
		</div>
	`;
	document.getElementById('lfModalOverlay').hidden = false;
	document.getElementById('lfConfirmCancel').addEventListener('click', closeModal);
	document.getElementById('lfConfirmOk').addEventListener('click', async () => {
		const okButton = document.getElementById('lfConfirmOk');
		okButton.disabled = true;
		try {
			await onConfirm();
			closeModal();
			await loadAllData(true);
		} catch (error) {
			okButton.disabled = false;
			await vbAlert(error.message);
		}
	});
}

function openModal(content) {
	document.getElementById('lfModalBody').innerHTML = content;
	document.getElementById('lfModalOverlay').hidden = false;
	setupModalMaps();
	wireUploadFormIfPresent();
	// Wire close / back buttons
	document.querySelectorAll('[data-modal-action]').forEach((button) => {
		button.addEventListener('click', () => {
			if (button.dataset.modalAction === 'close') closeModal();
			if (button.dataset.modalAction === 'back-to-report') {
				const report = findReportById(button.dataset.reportId);
				if (report) openModal(buildDetailModal(report, 'active'));
			}
		});
	});
	// ─── BUG FIX: Wire approve/reject/resolve action buttons inside the modal
	wireModalActionButtons();
	// Wire embedded Potential Match cards (inside a report's own detail modal) to
	// open the bigger Match Details view instead of sitting there inert.
	wireEmbeddedMatchCards();
}

// ─── BUG FIX: Handle data-action buttons that live inside the modal body
//             (e.g. Approve / Reject / Resolve in the detail/claim/sighting modals).
function wireModalActionButtons() {
	document.querySelectorAll('#lfModalBody [data-action]').forEach((button) => {
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			runConfirmableAction(button.dataset.action, button.dataset.id);
		});
	});
}

// Embedded Potential Match cards live inside a report's own detail modal
// (buildDetailModal's matchesSection) — clicking one opens buildMatchDetailModal()
// for that specific match, without needing to close this modal and hunt for the
// same match on the separate Potential Matches tab.
function wireEmbeddedMatchCards() {
	document.querySelectorAll('#lfModalBody .match-card[data-match-id]').forEach((card) => {
		card.addEventListener('click', (event) => {
			// A click on the expand-photo badge should only open the lightbox.
			if (event.target.closest('[data-lightbox-src]')) return;
			const reportId = card.closest('[data-report-id]')?.dataset.reportId;
			const match = lfData.potentialMatches.find((m) => String(m.id) === String(card.dataset.matchId));
			const report = findReportById(reportId);
			if (!match || !report) return;
			openModal(buildMatchDetailModal(match, report));
		});
	});
}

function closeModal() {
	destroyModalMaps();
	document.getElementById('lfModalOverlay').hidden = true;
	document.getElementById('lfModalBody').innerHTML = '';
}

// ─── BUG FIX 1 & 3: Added `mode` parameter for context-aware footer buttons.
//                    Added "04. Potential Matches" section pulled from lfData.potentialMatches.
//                    Modal content is scrollable via inline style.
function buildDetailModal(report, mode = 'view') {
	if (!report) return '<div class="upload-success"><h2 id="lfModalTitle">Record not found</h2></div>';

	// Find any potential matches involving this report
	const matches = mode === 'active'
		? lfData.potentialMatches.filter((m) =>
			String(m.lost?.reportId) === String(report.id) ||
			String(m.found?.reportId) === String(report.id)
		)
		: [];

	// Reuses the same match-card / confidence-gauge component as the Potential
	// Matches tab (renderPotential) instead of one-off markup, so styling stays consistent.
	// Unlike the read-only cards this used to render, these are now clickable —
	// wireEmbeddedMatchCards() (called from openModal()) opens buildMatchDetailModal()
	// for whichever card was clicked, so staff can Approve/Dismiss without leaving
	// the report they're already reviewing.
	const matchesSection = matches.length
		? `
			<div class="details-section">
				<h4 class="details-section-title green">Potential Matches</h4>
				<p class="lf-matches-hint">Suggested from pet details, photo, and location similarity. Click a match for full details and to Approve or Dismiss it.</p>
				<div class="potential-main" data-report-id="${escapeHtml(report.id)}">
					${matches.map((m) => `
						<article class="match-card" data-match-id="${escapeHtml(String(m.id))}">
							<div class="match-pair">
								<div class="match-side">
									${expandableImg(m.lost.image, m.lost.name || 'Lost Pet', '', true)}
									<h4>${escapeHtml(m.lost.name || 'Lost Pet')}</h4>
									<small>${escapeHtml(m.lost.breed || '')}</small>
								</div>
								${confidenceGauge(m.confidence)}
								<div class="match-side">
									${expandableImg(m.found.image, m.found.reportId ? (m.found.name || 'Found Pet') : 'Community Sighting', '', true)}
									<h4>${escapeHtml(m.found.reportId ? (m.found.name || 'Found Pet') : 'Community Sighting')}</h4>
									<small>${escapeHtml(m.found.breed || '')}</small>
								</div>
							</div>
							<div class="reason-row">
								${(m.reasons || []).map((r) => `<span class="reason-chip">${escapeHtml(r)}</span>`).join('')}
							</div>
						</article>
					`).join('')}
				</div>
			</div>
		`
		: (mode === 'active'
			? '<div class="list-note" style="margin:8px 0;font-size:0.85rem;">No potential matches found for this report.</div>'
			: '');

	// Context-aware footer buttons per mode
	let footerButtons = `<button type="button" class="btn-details-close" data-modal-action="close">Close</button>`;
	if (mode === 'pending') {
		footerButtons += `
			<button type="button" class="btn-details-danger"  data-action="reject-pending"  data-id="${report.id}">Reject</button>
			<button type="button" class="btn-details-success" data-action="approve-pending" data-id="${report.id}">Approve</button>
		`;
	} else if (mode === 'active') {
		footerButtons += `
			<button type="button" class="btn-details-success" data-action="resolve-active" data-id="${report.id}">Resolve</button>
		`;
	}

	const isLost = String(report.type).toLowerCase() === 'lost';
	const locationLabel = isLost ? 'Last Seen Location' : 'Found Location';
	const dateValue = escapeHtml(report.dateLost || report.date || '');
	const timeValue = escapeHtml(report.timeLost || report.time || '');

	return `
    <div class="details-modal-box">
        <div class="details-img-side">
            <img src="${escapeHtml(report.image)}" alt="${escapeHtml(report.petName || report.title)}" class="details-pet-img" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';">
            <div class="details-status-badge ${isLost ? 'lost' : 'found'}">${escapeHtml(report.type || 'Lost')}</div>
            <button type="button" class="lf-expand-badge lf-expand-badge-lg" aria-label="Expand photo" data-lightbox-src="${escapeHtml(report.image || FALLBACK_IMAGE)}" data-lightbox-alt="${escapeHtml(report.petName || report.title || '')}">${EXPAND_ICON_SVG}</button>
        </div>

        <div class="details-info-side">
            <div class="details-info-header">
                <div>
                    <h2 id="lfModalTitle" class="details-pet-name">${escapeHtml(report.petName || report.title || 'Unknown')}</h2>
                    <span class="details-case-id">Case ID: ${escapeHtml(report.caseId || '')}</span>
                </div>
            </div>

            <div class="details-tags">
                <div class="details-tag"><span class="tag-label">Breed</span><span class="tag-value">${escapeHtml(report.breed || report.petName || 'Unknown')}</span></div>
                <div class="details-tag"><span class="tag-label">Age</span><span class="tag-value">${escapeHtml(report.age || 'Unknown')}</span></div>
                <div class="details-tag"><span class="tag-label">Size</span><span class="tag-value">${escapeHtml(report.size || 'Unknown')}</span></div>
                <div class="details-tag"><span class="tag-label">Sex</span><span class="tag-value">${escapeHtml(report.sex || 'Unknown')}</span></div>
            </div>

            <div class="details-section">
                <h4 class="details-section-title">Unique Markings</h4>
                <p class="details-section-text">${escapeHtml(report.markings || 'N/A')}</p>
            </div>

            <div class="details-section">
                <h4 class="details-section-title green">${locationLabel}</h4>
                <div id="mapDetail${escapeHtml(report.id)}" class="map-api details-map-api"
                    data-map-lat="${mapLat(report)}"
                    data-map-lng="${mapLng(report)}"
                    data-map-zoom="14">
                </div>
                <div class="details-location-info">
                    <img src="../../public/images/icons/icon-location.svg" alt="" class="details-loc-icon">
                    <div>
                        <span class="details-date">${dateValue}${timeValue ? ` &middot; ${timeValue}` : ''}</span>
                        <span class="details-location-text">${escapeHtml(report.barangay || '')}, Baliwag</span>
                    </div>
                </div>
            </div>

            <div class="details-section">
                <h4 class="details-section-title">Reporter Information</h4>
                <div class="uploader">
                    <div class="profile-initial">${getInitials(report.uploader || report.title || 'Unknown')}</div>
                    <div>
                        <strong>${escapeHtml(report.uploader || report.title || 'Unknown')}</strong><br>
                        <small>${escapeHtml(report.contact || 'No contact provided')} &middot; ${escapeHtml(report.source || 'Owner')}</small>
                    </div>
                </div>
            </div>

            ${matchesSection}

            <div class="details-footer">
                ${footerButtons}
            </div>
        </div>
    </div>
`;
}

// Bigger detail view of a single embedded Potential Match card — opened from
// inside a report's own detail modal (see wireEmbeddedMatchCards). Unlike the
// owner-facing version of this feature (public/js/lost-found.js), staff aren't
// either party to the match, so both sides' contact info are shown here rather
// than just the counterpart's. Approve/Dismiss reuse the exact same
// CONFIRM_ACTIONS-backed actions the dedicated Potential Matches tab already uses.
function buildMatchDetailModal(match, report) {
	const isResolved = match.status === 'approved';
	const foundIsSighting = !match.found?.reportId;
	const lostIsCurrent = String(match.lost.reportId) === String(report.id);

	const contactBlock = (label, contact) => `
		<div class="match-detail-contact-card uploader">
			<div class="profile-initial">${getInitials(contact.name)}</div>
			<div>
				<h5>${escapeHtml(label)}</h5>
				<strong>${escapeHtml(contact.name || 'Not on file')}</strong><br>
				<small>${escapeHtml(contact.phone || contact.email || 'No contact provided')}</small>
			</div>
		</div>
	`;

	const footerButtons = `
		<button type="button" class="btn-details-close" data-modal-action="back-to-report" data-report-id="${escapeHtml(String(report.id))}">&larr; Back to Report</button>
		${isResolved ? '' : `
			<button type="button" class="btn-details-danger" data-action="dismiss-match" data-id="${escapeHtml(String(match.id))}">Dismiss</button>
			<button type="button" class="btn-details-success" data-action="approve-match" data-id="${escapeHtml(String(match.id))}">Approve Match</button>
		`}
	`;

	return `
		<div class="match-detail-modal">
			<div>
				<h2 id="lfModalTitle" class="match-detail-title">Match Details</h2>
				<p class="match-detail-subtitle">${escapeHtml(String(match.confidence))}% match</p>
			</div>

			<div class="match-pair">
				<div class="match-side">
					${expandableImg(match.lost.image, match.lost.name || 'Lost Pet', '')}
					<h4>${escapeHtml(match.lost.name || 'Lost Pet')}</h4>
					<small>${escapeHtml(match.lost.breed || '')}</small>
					${lostIsCurrent ? '<span class="match-detail-viewing-tag">Currently Viewing</span>' : ''}
				</div>
				${confidenceGauge(match.confidence)}
				<div class="match-side">
					${expandableImg(match.found.image, foundIsSighting ? 'Community Sighting' : (match.found.name || 'Found Pet'), '')}
					<h4>${escapeHtml(foundIsSighting ? 'Community Sighting' : (match.found.name || 'Found Pet'))}</h4>
					<small>${escapeHtml(match.found.breed || '')}</small>
					${!lostIsCurrent ? '<span class="match-detail-viewing-tag">Currently Viewing</span>' : ''}
				</div>
			</div>

			<div class="reason-row">
				${(match.reasons || []).map((r) => `<span class="reason-chip">${escapeHtml(r)}</span>`).join('')}
			</div>

			<div class="match-detail-contact-grid">
				${contactBlock('Lost Report Submitter', { name: match.lost.contactName, phone: match.lost.contactPhone, email: match.lost.contactEmail })}
				${contactBlock(foundIsSighting ? 'Sighting Submitter' : 'Found Report Submitter', { name: match.found.contactName, phone: match.found.contactPhone, email: match.found.contactEmail })}
			</div>

			${isResolved ? '<div class="lf-match-resolved-badge" style="text-align:center;padding:10px;background:var(--lf-green-soft);border-radius:8px;color:var(--lf-green-dark);font-weight:700;">Already approved and resolved</div>' : ''}

			<div class="details-footer">
				${footerButtons}
			</div>
		</div>
	`;
}

// Side-by-side comparison of the found report vs. what the claimant submitted.
// Unlike sightings, a claim has no structured pet data of its own (just contact
// info + a proof document) and there's no image-similarity scoring between a
// found-pet photo and a proof document — so no confidence score here, just the
// facts laid out for staff to judge themselves. Staff-only, never shown to owners.
function claimComparisonSection(claim) {
	const proofIsPdf = String(claim.proofFile || '').toLowerCase().endsWith('.pdf');
	return `
		<div class="modal-grid">
			<div class="field"><label>Species</label><p>${escapeHtml(claim.species || 'Not on file')}</p></div>
			<div class="field"><label>Breed</label><p>${escapeHtml(claim.breed || 'Not on file')}</p></div>
			<div class="field"><label>Sex</label><p>${escapeHtml(claim.sex || 'Not on file')}</p></div>
			<div class="field"><label>Size</label><p>${escapeHtml(claim.size || 'Not on file')}</p></div>
			<div class="field"><label>Markings (from found report)</label><p>${escapeHtml(claim.markings || 'Not on file')}</p></div>
		</div>
		<div class="match-pair" style="margin-top:12px;">
			<div class="match-side">
				${expandableImg(claim.image, 'Found Pet Photo', '', true)}
				<h4>Found Pet Photo</h4>
			</div>
			<div class="match-side">
				${claim.proofFile
					? (proofIsPdf
						? `<a href="${escapeHtml(claim.proofFile)}" target="_blank" rel="noopener" class="btn btn-secondary">View Proof (PDF)</a>`
						: expandableImg(claim.proofFile, "Claimant's Proof", '', true))
					: expandableImg(FALLBACK_IMAGE, '', '', true)}
				<h4>Claimant's Proof</h4>
				<small>${escapeHtml(claim.proofType)}</small>
			</div>
		</div>
		${claim.proofNotes ? `<p class="details-section-text" style="margin-top:8px;">${escapeHtml(claim.proofNotes)}</p>` : ''}
	`;
}

// Dedicated modal for Claim records — mirrors buildDetailModal's .details-modal-box
// layout (used by Pending Review / Active Reports / Sighting Report) for visual
// consistency across every report-review modal. Unlike the sighting modal, this
// intentionally has no algorithmic "potential matches" section — a claim has no
// image-similarity scoring, staff compare claimComparisonSection's fields directly.
function buildClaimModal(claim) {
	if (!claim) return '<div class="upload-success"><h2 id="lfModalTitle">Record not found</h2></div>';
	return `
		<div class="details-modal-box">
			<div class="details-img-side">
				<img src="${escapeHtml(claim.image)}" alt="${escapeHtml(claim.petName)}" class="details-pet-img" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';">
				<div class="details-status-badge found">Claim</div>
				<button type="button" class="lf-expand-badge lf-expand-badge-lg" aria-label="Expand photo" data-lightbox-src="${escapeHtml(claim.image || FALLBACK_IMAGE)}" data-lightbox-alt="${escapeHtml(claim.petName || '')}">${EXPAND_ICON_SVG}</button>
			</div>

			<div class="details-info-side">
				<div class="details-info-header">
					<h2 id="lfModalTitle" class="details-pet-name">Claim Report</h2>
					<span class="details-case-id">Case ID: ${escapeHtml(claim.caseId || '')}</span>
				</div>

				<div class="details-tags">
					<div class="details-tag"><span class="tag-label">Pet Name</span><span class="tag-value">${escapeHtml(claim.petName || 'Found Pet Report')}</span></div>
					<div class="details-tag"><span class="tag-label">Barangay</span><span class="tag-value">${escapeHtml(claim.barangay || '')}</span></div>
					<div class="details-tag"><span class="tag-label">Submitted</span><span class="tag-value">${escapeHtml(claim.uploadedAt || '')}</span></div>
				</div>

				<div class="details-section">
					<h4 class="details-section-title">Found/Uploaded By</h4>
					<div class="uploader">
						<div class="profile-initial">${getInitials(claim.finderName)}</div>
						<div>
							<strong>${escapeHtml(claim.finderName)}</strong><br>
							<small>${escapeHtml(claim.finderContact)}</small>
						</div>
					</div>
				</div>

				<div class="details-section">
					<h4 class="details-section-title">Claimant Information</h4>
					<div class="uploader">
						<div class="profile-initial">${getInitials(claim.title)}</div>
						<div>
							<strong>${escapeHtml(claim.title)}</strong><br>
							<small>${escapeHtml(claim.contact || 'No contact provided')}</small>
						</div>
					</div>
				</div>

				<div class="details-section">
					<h4 class="details-section-title green">Comparison to Found Report (Staff Only)</h4>
					${claimComparisonSection(claim)}
				</div>

				<div class="details-footer">
					<button type="button" class="btn-details-close" data-modal-action="close">Close</button>
					<button type="button" class="btn-details-danger" data-action="reject-claim" data-id="${claim.id}">Reject</button>
					<button type="button" class="btn-details-success" data-action="approve-claim" data-id="${claim.id}">Approve</button>
				</div>
			</div>
		</div>
	`;
}

function findReportById(id) {
	if (id === null || id === undefined) return null;
	return (lfData.allReports || []).find((r) => String(r.id) === String(id)) || null;
}

const REPORT_STATUS_PILLS = {
	pending: ['Pending Review', 'lf-pill-pending'],
	active: ['Active', 'lf-pill-active'],
	resolved: ['Resolved', 'lf-pill-resolved'],
	rejected: ['Rejected', 'lf-pill-rejected']
};

function reportStatusPill(status) {
	const [label, cls] = REPORT_STATUS_PILLS[String(status || '').toLowerCase()] || ['Unknown', 'lf-pill-pending'];
	return `<span class="lf-status-pill ${cls}">${escapeHtml(label)}</span>`;
}

// The specific lost report a finder was responding to when they filed this sighting
// (sighting.reportId) — the direct, authoritative comparison target, as opposed to
// the algorithmic image/attribute matcher below. Its status is surfaced (e.g.
// "Resolved") since staff should know if the case it responds to is already closed.
function linkedReportCard(report, sighting) {
	return `
		<article class="match-card static">
			<div class="match-pair">
				<div class="match-side">
					${expandableImg(report.image, report.petName || 'Lost Pet', '', true)}
					<h4>${escapeHtml(report.petName || 'Lost Pet')}</h4>
					<small>${escapeHtml(report.breed || '')}</small>
				</div>
				<div class="link-indicator" title="The lost report this sighting was filed against">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
						<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
					</svg>
				</div>
				<div class="match-side">
					${expandableImg(sighting.image, 'This Sighting', '', true)}
					<h4>This Sighting</h4>
					<small>${escapeHtml(sighting.barangay || '')}</small>
				</div>
			</div>
			<div class="reason-row">
				<span class="reason-chip">Reported in response to this lost report</span>
				${reportStatusPill(report.status)}
			</div>
		</article>
	`;
}

// Same-pet comparison for a sighting against lost report(s), reusing the confidence
// score already computed by the image/attribute matcher (see splitMatches/
// lfData.potentialMatches) instead of judging similarity ourselves — staff-only,
// never shown to the reporting owner.
function renderAutoMatchCards(matches, sighting) {
	return `
		<div class="potential-main">
			${matches.map((m) => `
				<article class="match-card static">
					<div class="match-pair">
						<div class="match-side">
							${expandableImg(m.lost.image, m.lost.name || 'Lost Pet', '', true)}
							<h4>${escapeHtml(m.lost.name || 'Lost Pet')}</h4>
							<small>${escapeHtml(m.lost.breed || '')}</small>
						</div>
						${confidenceGauge(m.confidence)}
						<div class="match-side">
							${expandableImg(sighting.image, 'This Sighting', '', true)}
							<h4>This Sighting</h4>
							<small>${escapeHtml(sighting.barangay || '')}</small>
						</div>
					</div>
					<div class="reason-row">
						${(m.reasons || []).map((r) => `<span class="reason-chip">${escapeHtml(r)}</span>`).join('')}
					</div>
				</article>
			`).join('')}
		</div>
	`;
}

// Staff-only comparison. Primary signal is the specific lost report the finder was
// responding to (sighting.reportId — captured when they clicked "Report a Sighting"
// from that report's page, see public/js/lost-found.js submitSighting). The separate
// algorithmic auto-matcher is shown underneath only when it surfaces a *different*
// candidate than the direct link — a safety net for a finder picking the wrong report,
// without cluttering the common case where the direct link is the whole story.
function sightingComparisonSection(sighting) {
	const linkedReport = findReportById(sighting.reportId);
	const autoMatches = (lfData.potentialMatches || []).filter((m) => String(m.found?.sightingId) === String(sighting.id));

	if (!linkedReport && !autoMatches.length) {
		return '<div class="list-note" style="margin:8px 0;font-size:0.85rem;">No automatic comparison available yet — this sighting hasn\'t been matched to a lost report.</div>';
	}

	if (!linkedReport) {
		return renderAutoMatchCards(autoMatches, sighting);
	}

	const otherMatches = autoMatches.filter((m) => String(m.lost?.reportId) !== String(linkedReport.id));
	const secondary = otherMatches.length ? `
		<div class="comparison-secondary">
			<h5 class="comparison-secondary-title">Other Possible Matches</h5>
			${renderAutoMatchCards(otherMatches, sighting)}
		</div>
	` : '';

	return `<div class="potential-main">${linkedReportCard(linkedReport, sighting)}</div>${secondary}`;
}

// Dedicated modal for Sighting records — mirrors buildDetailModal's .details-modal-box
// layout (used by Pending Review / Active Reports) for visual consistency across the
// three report-review modals, adapted for a sighting's data shape (no breed/age/size/sex —
// a sighting is an observation, not a full pet profile).
function buildSightingModal(sighting) {
	if (!sighting) return '<div class="upload-success"><h2 id="lfModalTitle">Record not found</h2></div>';
	return `
		<div class="details-modal-box">
			<div class="details-img-side">
				<img src="${escapeHtml(sighting.image)}" alt="${escapeHtml(sighting.title)}" class="details-pet-img" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';">
				<div class="details-status-badge found">Sighting</div>
				<button type="button" class="lf-expand-badge lf-expand-badge-lg" aria-label="Expand photo" data-lightbox-src="${escapeHtml(sighting.image || FALLBACK_IMAGE)}" data-lightbox-alt="${escapeHtml(sighting.title || '')}">${EXPAND_ICON_SVG}</button>
			</div>

			<div class="details-info-side">
				<div class="details-info-header">
					<h2 id="lfModalTitle" class="details-pet-name">Sighting Report</h2>
					<span class="details-case-id">Case ID: ${escapeHtml(sighting.caseId || '')}</span>
				</div>

				<div class="details-tags">
					<div class="details-tag"><span class="tag-label">Barangay</span><span class="tag-value">${escapeHtml(sighting.barangay || '')}</span></div>
					<div class="details-tag"><span class="tag-label">Date Sighted</span><span class="tag-value">${escapeHtml(sighting.dateLost || '')}</span></div>
					<div class="details-tag"><span class="tag-label">Submitted</span><span class="tag-value">${escapeHtml(sighting.uploadedAt || '')}</span></div>
				</div>

				<div class="details-section">
					<h4 class="details-section-title">Notes</h4>
					<p class="details-section-text">${escapeHtml(sighting.title || 'No notes provided')}</p>
				</div>

				<div class="details-section">
					<h4 class="details-section-title green">Last Seen Location</h4>
					<div id="mapSighting${escapeHtml(sighting.id)}" class="map-api details-map-api"
						data-map-lat="${mapLat(sighting)}"
						data-map-lng="${mapLng(sighting)}"
						data-map-zoom="14">
					</div>
					<div class="details-location-info">
						<img src="../../public/images/icons/icon-location.svg" alt="" class="details-loc-icon">
						<div>
							<span class="details-date">${escapeHtml(sighting.dateLost || '')}</span>
							<span class="details-location-text">${escapeHtml(sighting.barangay || '')}, Baliwag</span>
						</div>
					</div>
				</div>

				<div class="details-section">
					<h4 class="details-section-title">Reporter Information</h4>
					<div class="uploader">
						<div class="profile-initial">${getInitials(sighting.uploader)}</div>
						<div>
							<strong>${escapeHtml(sighting.uploader || 'Unknown')}</strong><br>
							<small>${escapeHtml(sighting.contact || 'No contact provided')}</small>
						</div>
					</div>
				</div>

				<div class="details-section">
					<h4 class="details-section-title green">Comparison to Lost Report (Staff Only)</h4>
					${sightingComparisonSection(sighting)}
				</div>

				<div class="details-footer">
					<button type="button" class="btn-details-close" data-modal-action="close">Close</button>
					<button type="button" class="btn-details-danger" data-action="reject-sighting" data-id="${sighting.id}">Reject</button>
					<button type="button" class="btn-details-success" data-action="approve-sighting" data-id="${sighting.id}">Approve</button>
				</div>
			</div>
		</div>
	`;
}

function getInitials(name) {
	if (!name) return '?';
	return name
		.trim()
		.split(' ')
		.map((word) => word[0])
		.slice(0, 2)
		.join('')
		.toUpperCase();
}

// ─── BUG FIX 2: Removed the contact panel from the vet/admin upload form.
//                Added dynamic label + required toggling for "Pet Name" when type changes.
//                When type = "found", pet name becomes optional and labelled accordingly.
function buildUploadModal() {
	const barangayOpts = lfData.filters.barangays
		.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`)
		.join('');
	const speciesOpts = PET_TYPES.map((t) => `<option>${escapeHtml(t)}</option>`).join('');

	return `
		<form id="uploadPetForm" class="vet-lf-modal">
			<div class="modal-header">
				<div class="modal-header-left">
					<div class="modal-header-icon">
						<img src="../../public/images/icons/report-paw.svg" alt="" class="modal-header-icon-img">
					</div>
					<div>
						<h2 class="modal-title" id="lfModalTitle">Report Lost Pet</h2>
						<p class="modal-subtitle">Vet uploads are published directly as active reports.</p>
					</div>
				</div>
				<div class="modal-header-right">
					<div class="report-type-toggle" role="group" aria-label="Report type">
						<button type="button" class="type-toggle-btn active" data-type="lost">
							<img src="../../public/images/icons/report-paw.svg" alt="" class="type-toggle-icon">Lost
						</button>
						<button type="button" class="type-toggle-btn" data-type="found">
							<img src="../../public/images/icons/report-paw.svg" alt="" class="type-toggle-icon">Found
						</button>
					</div>
				</div>
			</div>

			<input type="hidden" name="type" id="reportType" value="lost">

			<div class="modal-body">
				<div class="modal-col">
					<div class="modal-section-label">Pet Identification Photo</div>
					<label class="upload-box" for="uploadPhotoInput">
						<div id="uploadPhotoPreviewText">
							<img src="../../public/images/icons/report-upload.svg" alt="" class="upload-cam-icon">
							<span class="upload-text">Upload Clear Portrait</span>
							<span class="upload-hint">High-res JPG or PNG preferred</span>
						</div>
						<img id="uploadPhotoPreview" alt="Preview" hidden style="width:100%;height:100%;object-fit:cover;border-radius:8px;position:absolute;inset:0;">
					</label>
					<input id="uploadPhotoInput" name="photo" type="file" accept="image/*" hidden>

					<div class="modal-section-label" id="petDetailsLabel">Pet Details</div>

					<div class="form-row" id="petNameField">
						<div class="form-group full">
							<label id="petNameLabel">Pet Name <span id="petNameOptional" style="font-weight:400;color:#9ba3ae;text-transform:none;">(if known)</span></label>
							<input name="pet_name" id="petNameInput" class="form-input" placeholder="e.g. Max">
						</div>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label>Type</label>
							<div class="select-wrap">
								<select name="species" class="form-select">${speciesOpts}</select>
								<img src="../../public/images/icons/icon-dropwdown.svg" alt="" class="sel-arrow-img">
							</div>
						</div>
						<div class="form-group">
							<label>Breed</label>
							<input name="breed" class="form-input" placeholder="e.g. Golden Retriever" required>
						</div>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label>Sex <span id="sexOptionalHint" style="font-weight:400;color:#9ba3ae;text-transform:none;" hidden>(if known)</span></label>
							<div class="sex-toggle">
								<button type="button" class="sex-btn" data-value="Male">Male</button>
								<button type="button" class="sex-btn" data-value="Female">Female</button>
								<button type="button" class="sex-btn" data-value="Unknown" id="sexBtnUnknown">Unknown</button>
							</div>
							<input type="hidden" name="sex" id="sexInput" value="">
						</div>
						<div class="form-group">
							<label>Size</label>
							<div class="select-wrap">
								<select name="size" class="form-select">
									<option>Small (Under 10kg)</option>
									<option>Medium (10-25kg)</option>
									<option>Large (25kg+)</option>
								</select>
								<img src="../../public/images/icons/icon-dropwdown.svg" alt="" class="sel-arrow-img">
							</div>
						</div>
					</div>

					<div class="form-row">
						<div class="form-group full">
							<label>Color / Markings</label>
							<textarea name="color_markings" id="markingsTextarea" class="form-textarea" maxlength="200" rows="2" placeholder="e.g. White with brown patches, black collar" required></textarea>
							<span class="char-counter" id="markingsCounter">0/200</span>
						</div>
					</div>
				</div>

				<div class="modal-col">
					<div class="modal-section-label" id="incidentSectionLabel">Incident Details</div>

					<div class="form-row">
						<div class="form-group">
							<label id="dateLostLabel">Date Lost</label>
							<input name="incident_date" id="incidentDateInput" type="date" class="form-input" required>
						</div>
						<div class="form-group">
							<label>Barangay Last Seen</label>
							<div class="select-wrap">
								<select name="barangay" id="uploadBarangay" class="form-select">${barangayOpts}</select>
								<img src="../../public/images/icons/icon-dropwdown.svg" alt="" class="sel-arrow-img">
							</div>
						</div>
					</div>

					<a href="#" class="view-map-link" onclick="return false;">Set exact location on map</a>

					<div id="uploadMap" class="map-api"
						data-map-lat="14.9577"
						data-map-lng="120.9055"
						data-map-editable="true"
						style="height:200px;border-radius:10px;overflow:hidden;margin-top:6px;">
					</div>
					<div style="display:none;">
						<input id="uploadLat" name="lat" value="14.9577">
						<input id="uploadLng" name="lng" value="120.9055">
					</div>

					<div class="form-group" style="margin-top:8px;">
						<label id="notesLabel">Additional Details</label>
						<textarea name="notes" id="notesTextarea" class="form-textarea" maxlength="500" placeholder="Last behavior, collar color, chip ID if known..." required></textarea>
						<span class="char-counter" id="notesCounter">0/500</span>
					</div>
				</div>
			</div>

			<footer class="vlf-footer">
				<button type="button" class="vlf-save-draft">Save Draft</button>
				<div class="vlf-footer-right">
					<button type="button" class="vlf-cancel" data-modal-action="close">Cancel</button>
					<button type="submit" class="vlf-submit" id="submitReportBtn">
						<span id="submitReportBtnText">Submit Lost Pet Report</span>
						<img src="../../public/images/icons/report-submit.svg" alt="" class="btn-icon-img">
					</button>
				</div>
			</footer>
		</form>
	`;
}

function buildUploadSuccessModal() {
	return `<section class="upload-success" id="lfModalTitle"><div class="success-icon">✓</div><h2>Report Has Been Published</h2><p>The vet-created report is active and visible publicly.</p><button type="button" class="btn btn-primary" data-modal-action="close">Close</button></section>`;
}

function wireUploadFormIfPresent() {
	const form = document.getElementById('uploadPetForm');
	if (!form) return;

	const photoInput      = document.getElementById('uploadPhotoInput');
	const preview         = document.getElementById('uploadPhotoPreview');
	const previewText     = document.getElementById('uploadPhotoPreviewText');
	const reportTypeInput = document.getElementById('reportType');
	const petNameInput    = document.getElementById('petNameInput');
	const petNameOptional = document.getElementById('petNameOptional');

	function applyType(type) {
		const isLost = type === 'lost';
		reportTypeInput.value = type;

		const title = document.getElementById('lfModalTitle');
		if (title) title.textContent = `Report ${isLost ? 'Lost' : 'Found'} Pet`;

		const submitBtnText = document.getElementById('submitReportBtnText');
		if (submitBtnText) submitBtnText.textContent = `Submit ${isLost ? 'Lost' : 'Found'} Pet Report`;

		const dateLabel = document.getElementById('dateLostLabel');
		if (dateLabel) dateLabel.textContent = isLost ? 'Date Lost' : 'Date Found';

		const notes = document.getElementById('notesTextarea');
		if (notes) notes.placeholder = isLost
			? 'Last behavior, collar color, chip ID if known...'
			: 'Where found, animal condition, how to contact owner...';

		if (petNameInput) petNameInput.required = isLost;
		if (petNameOptional) petNameOptional.hidden = isLost;

		// Sex rules differ per type: found reports allow "Unknown" (finder may
		// not be able to check the animal) and default to it; lost reports hide
		// Unknown and force an explicit Male/Female pick (no silent default).
		const unknownBtn = document.getElementById('sexBtnUnknown');
		const sexOptionalHint = document.getElementById('sexOptionalHint');
		const sexInput = document.getElementById('sexInput');
		if (unknownBtn) unknownBtn.style.display = isLost ? 'none' : '';
		if (sexOptionalHint) sexOptionalHint.hidden = isLost;
		form.querySelectorAll('.sex-btn').forEach((btn) => {
			btn.classList.toggle('active', !isLost && btn.dataset.value === 'Unknown');
		});
		if (sexInput) sexInput.value = '';

		form.querySelectorAll('.type-toggle-btn').forEach((btn) => {
			btn.classList.toggle('active', btn.dataset.type === type);
		});
	}

	applyType('lost');

	form.querySelectorAll('.type-toggle-btn').forEach((btn) => {
		btn.addEventListener('click', () => applyType(btn.dataset.type));
	});

	form.querySelectorAll('.sex-btn').forEach((btn) => {
		btn.addEventListener('click', () => {
			form.querySelectorAll('.sex-btn').forEach((b) => b.classList.remove('active'));
			btn.classList.add('active');
			const sexInput = document.getElementById('sexInput');
			// "Unknown" is stored as blank → NULL, so the match scorer keeps
			// treating it as no-signal instead of matching Unknown-to-Unknown.
			if (sexInput) sexInput.value = btn.dataset.value === 'Unknown' ? '' : btn.dataset.value;
		});
	});

	const incidentDateInput = document.getElementById('incidentDateInput');
	if (incidentDateInput) incidentDateInput.max = todayISODate();

	const notesTextarea = document.getElementById('notesTextarea');
	const notesCounter  = document.getElementById('notesCounter');
	if (notesTextarea && notesCounter) {
		const updateNotesCounter = () => {
			notesCounter.textContent = `${notesTextarea.value.length}/${notesTextarea.maxLength}`;
		};
		notesTextarea.addEventListener('input', updateNotesCounter);
		updateNotesCounter();
	}

	const markingsTextarea = document.getElementById('markingsTextarea');
	const markingsCounter  = document.getElementById('markingsCounter');
	if (markingsTextarea && markingsCounter) {
		const updateMarkingsCounter = () => {
			markingsCounter.textContent = `${markingsTextarea.value.length}/${markingsTextarea.maxLength}`;
		};
		markingsTextarea.addEventListener('input', updateMarkingsCounter);
		updateMarkingsCounter();
	}

	photoInput.addEventListener('change', () => {
		const file = photoInput.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			preview.src = reader.result;
			preview.hidden = false;
			previewText.hidden = true;
		};
		reader.readAsDataURL(file);
	});

	document.getElementById('uploadBarangay')?.addEventListener('change', (event) => {
		const [lat, lng] = getCoords(event.target.value);
		setUploadMapCenter(lat, lng);
	});

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const formData = new FormData(form);
		if (formData.get('type') === 'lost' && !String(formData.get('pet_name') || '').trim()) {
			await vbAlert('Pet name is required for lost pet reports.');
			return;
		}
		if (formData.get('type') === 'lost' && !String(formData.get('sex') || '').trim()) {
			await vbAlert("Please select the pet's sex.");
			return;
		}
		const incidentDate = String(formData.get('incident_date') || '');
		if (incidentDate && incidentDate > todayISODate()) {
			await vbAlert('Date lost/found cannot be a future date.');
			return;
		}
		const session = getSession();
		formData.append('role', session?.role || 'vet');
		if (session?.name && !formData.has('contact_name')) formData.append('contact_name', session.name);
		if (session?.phone && !formData.has('contact_phone')) formData.append('contact_phone', session.phone);
		if (session?.email && !formData.has('contact_email')) formData.append('contact_email', session.email);
		try {
			await lfRequest('create_report', formData);
			await loadAllData();
			openModal(buildUploadSuccessModal());
		} catch (error) {
			await vbAlert(error.message);
		}
	});
}

function setupModalMaps() {
	if (typeof L === 'undefined') return;
	destroyModalMaps();
	document.querySelectorAll('.map-api').forEach((element) => {
		const lat      = Number(element.dataset.mapLat || 14.9577);
		const lng      = Number(element.dataset.mapLng || 120.9055);
		const zoom     = Number(element.dataset.mapZoom || 14);
		const editable = element.dataset.mapEditable === 'true';
		const map      = L.map(element, { zoomControl: true }).setView([lat, lng], zoom);
		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: '&copy; OpenStreetMap contributors'
		}).addTo(map);
		const marker = L.marker([lat, lng]).addTo(map);
		if (editable) {
			map.on('click', (evt) => {
				const { lat: clickLat, lng: clickLng } = evt.latlng;
				marker.setLatLng([clickLat, clickLng]);
				const latInput = document.getElementById('uploadLat');
				const lngInput = document.getElementById('uploadLng');
				if (latInput && lngInput) {
					latInput.value = clickLat.toFixed(6);
					lngInput.value = clickLng.toFixed(6);
				}
				const barangaySelect = document.getElementById('uploadBarangay');
				const nearest = nearestBarangay(clickLat, clickLng);
				if (barangaySelect && nearest) barangaySelect.value = nearest;
			});
		} else {
			L.marker([lat, lng])
				.addTo(map)
				.bindTooltip('Last Seen Location', { permanent: true, direction: 'top' });
		}
		lfState.modalMaps.push(map);
	});
}

function destroyModalMaps() {
	lfState.modalMaps.forEach((map) => map.remove());
	lfState.modalMaps = [];
}

function setUploadMapCenter(lat, lng) {
	const map = lfState.modalMaps.find((item) => item.getContainer().id === 'uploadMap');
	if (!map) return;
	map.setView([lat, lng], 14);
	map.eachLayer((layer) => {
		if (layer instanceof L.Marker) layer.setLatLng([lat, lng]);
	});
	const latInput = document.getElementById('uploadLat');
	const lngInput = document.getElementById('uploadLng');
	if (latInput && lngInput) {
		latInput.value = lat.toFixed(6);
		lngInput.value = lng.toFixed(6);
	}
}

function getCoords(barangay) {
	return barangayCoordinates[barangay] || barangayCoordinates['Select Barangay'];
}

function mapLat(record) {
	const value = Number(record?.lat);
	return (Number.isFinite(value) && value !== 0 ? value : getCoords(record?.barangay)[0]).toFixed(6);
}

function mapLng(record) {
	const value = Number(record?.lng);
	return (Number.isFinite(value) && value !== 0 ? value : getCoords(record?.barangay)[1]).toFixed(6);
}

document.addEventListener('DOMContentLoaded', initLostFound);

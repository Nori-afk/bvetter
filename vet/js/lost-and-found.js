'use strict';

const LF_ENDPOINT = '/final-VBETTER/bvetter/api/lost-found/lost_and_found.php';
const FALLBACK_IMAGE = '/final-VBETTER/bvetter/public/images/img/upload-pet.png';
const PET_TYPES = ['Dog', 'Cat', 'Other'];

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
	sightings: []
};

const barangayCoordinates = {
	Tangos: [14.9599, 120.9083],
	Poblacion: [14.9621, 120.9017],
	'Sta. Cruz': [14.9578, 120.9066],
	'Santa Cruz': [14.9578, 120.9066],
	'San Jose': [14.9542, 120.9099],
	Tibig: [14.9518, 120.8992],
	Tibag: [14.9518, 120.8992],
	'Sto. Cristo': [14.9498, 120.9038],
	'Santa Cristo': [14.9498, 120.9038],
	'Sta. Barbara': [14.9548, 120.9057],
	'Santa Barbara': [14.9548, 120.9057],
	Sabang: [14.9654, 120.9050],
	Caniogan: [14.9680, 120.8952],
	Pagala: [14.9562, 120.8980],
	Subic: [14.9477, 120.9090],
	Tilapayong: [14.9447, 120.9002],
	Makinabang: [14.9584, 120.9001],
	Matangtubig: [14.9516, 120.8979],
	'Virgen delas Flores': [14.9568, 120.8947],
	Tiaong: [14.9488, 120.8958],
	'Santo Nino': [14.9630, 120.8940],
	'Santo Niño': [14.9630, 120.8940],
	'Select Barangay': [14.9577, 120.9055]
};

const lfState = {
	activeTab: 'pending',
	search: '',
	typeFilter: 'All Types',
	sourceFilter: 'All Sources',
	barangayFilter: 'Select Barangay',
	selectedMatchId: null,
	modalMaps: []
};

function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>"']/g, (char) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#039;'
	}[char]));
}

function getSession() {
	try {
		return JSON.parse(sessionStorage.getItem('vbetter_session') || 'null');
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

async function lfRequest(action, data = {}) {
	const response = await fetch(LF_ENDPOINT, { method: 'POST', body: lfForm(action, data) });
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
		image: report.image,
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
		image: claim.photo_path || FALLBACK_IMAGE
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
		lng: sighting.longitude ?? null
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
		const [pending, active, resolved, matches, claims, sightings, barangays] = await Promise.all([
			lfRequest('management_list', { status: 'pending' }),
			lfRequest('management_list', { status: 'active' }),
			lfRequest('management_list', { status: 'resolved' }),
			lfRequest('matches'),
			lfRequest('management_claims', { status: 'pending' }),
			lfRequest('list_sightings', { status: 'pending' }),
			fetch('/final-VBETTER/bvetter/api/barangays/list.php').then((r) => r.json()).catch(() => null)
		]);

		lfData.pendingReports = (pending.data || []).map(normalizeReport);
		lfData.activeReports = (active.data || []).map(normalizeReport);
		lfData.resolvedCases = (resolved.data || []).map(normalizeReport);
		lfData.potentialMatches = matches.data || [];
		lfData.claims = (claims.data || []).map(normalizeClaim);
		lfData.sightings = (sightings.data || []).map(normalizeSighting);
		if (barangays?.success) {
			lfData.filters.barangays = ['Select Barangay', ...barangays.data.map((item) => item.name)];
			populateFilterSelects();
		}
		lfState.selectedMatchId = lfData.potentialMatches[0]?.id || null;
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
		const badge = tab.badge && lfData.potentialMatches.length ? `<span class="tab-pill">${tab.badge}</span>` : '';
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
				<img src="${escapeHtml(report.image)}" alt="${escapeHtml(report.petName)}">
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
			<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}">
			<div class="active-overlay">
				<h4>${escapeHtml(item.title)}</h4>
				<small>${escapeHtml(item.barangay)} - ${escapeHtml(item.date || '')}</small>
				<div class="mini-row">
					<span class="mini-chip">${escapeHtml(item.breed || '')}</span>
					<span class="mini-chip">${escapeHtml(item.sex || '')}</span>
					<span class="mini-chip">${escapeHtml(item.size || '')}</span>
				</div>
				<div class="foot">
					<div class="uploader-info"><p>Uploaded By:</p><h4>${escapeHtml(item.source)}</h4></div>
					<button type="button" class="btn btn-success resolve-btn" data-action="resolve-active" data-id="${item.id}">Resolve</button>
				</div>
			</div>
		</article>
	`).join('')}</div>` : empty('No active reports found.');
	bindRootActions(root);
}

function renderPotential(root) {
	const selectedMatch = lfData.potentialMatches.find((item) => String(item.id) === String(lfState.selectedMatchId)) || lfData.potentialMatches[0];
	root.innerHTML = lfData.potentialMatches.length ? `
		<div class="potential-layout">
			<div class="potential-main">
				<div class="suggested-banner">Suggested matches are generated from pet details, image metadata, and location similarity.</div>
				${lfData.potentialMatches.map((match) => `
					<article class="match-card" data-action="select-match" data-id="${match.id}">
						<div class="match-pair">
							<div class="match-side"><img src="${escapeHtml(match.lost.image || FALLBACK_IMAGE)}" alt=""><h4>${escapeHtml(match.lost.name)}</h4><small>${escapeHtml(match.lost.breed || '')}</small></div>
							<div class="score-pill">${match.confidence}%</div>
							<div class="match-side"><img src="${escapeHtml(match.found.image || FALLBACK_IMAGE)}" alt=""><h4>${escapeHtml(match.found.name)}</h4><small>${escapeHtml(match.found.breed || '')}</small></div>
						</div>
						<div class="reason-row">${(match.reasons || []).map((reason) => `<span class="reason-chip">${escapeHtml(reason)}</span>`).join('')}</div>
						<button type="button" class="btn btn-success" data-action="approve-match" data-id="${match.id}">Approve Match</button>
						<button type="button" class="btn btn-danger" data-action="dismiss-match" data-id="${match.id}">Dismiss</button>
					</article>
				`).join('')}
			</div>
			<aside class="approval-card">
				<h3>Approve The Match</h3>
				${selectedMatch ? `<p>Approving marks the matching case as resolved.</p><div class="summary-box"><strong>Lost:</strong> ${escapeHtml(selectedMatch.lost.name)}<br><strong>Found:</strong> ${escapeHtml(selectedMatch.found.name)}</div><button type="button" class="btn btn-primary" data-action="approve-match" data-id="${selectedMatch.id}">Approve Match</button>` : '<p>No suggested match selected.</p>'}
			</aside>
		</div>
	` : empty('No potential matches yet.');
	bindRootActions(root);
}

function renderResolved(root) {
	if (!lfData.resolvedCases.length) { root.innerHTML = empty('No resolved cases yet.'); return; }
	const locIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
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
					${lfData.resolvedCases.map((item) => `
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
	`;
}

function renderClaims(root) {
	root.innerHTML = lfData.claims.length ? lfData.claims.map((claim) => `
		<article class="report-card pending-found">
			<div class="report-image"><img src="${escapeHtml(claim.image)}" alt="${escapeHtml(claim.petName)}"><span class="tag-chip found">CLAIM</span></div>
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
			<div class="report-image"><img src="${escapeHtml(sighting.image)}" alt="${escapeHtml(sighting.title)}"><span class="tag-chip found">SIGHTING</span></div>
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
function bindRootActions(root) {
	root.querySelectorAll('[data-action]').forEach((button) => {
		button.addEventListener('click', async (event) => {
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
				if (action === 'approve-pending') await lfRequest('approve_report', { report_id: id });
				if (action === 'reject-pending') await lfRequest('reject_report', { report_id: id });
				if (action === 'resolve-active') await lfRequest('resolve_report', { report_id: id });
				if (action === 'approve-match') await lfRequest('approve_match', { match_id: id });
				if (action === 'dismiss-match') await lfRequest('dismiss_match', { match_id: id });
				if (action === 'approve-claim') await lfRequest('approve_claim', { claim_id: id });
				if (action === 'reject-claim') await lfRequest('reject_claim', { claim_id: id });
				if (action === 'approve-sighting') await lfRequest('approve_sighting', { sighting_id: id });
				if (action === 'reject-sighting') await lfRequest('reject_sighting', { sighting_id: id });
				await loadAllData();
			} catch (error) {
				alert(error.message);
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

function openModal(content) {
	document.getElementById('lfModalBody').innerHTML = content;
	document.getElementById('lfModalOverlay').hidden = false;
	setupModalMaps();
	wireUploadFormIfPresent();
	// Wire close buttons
	document.querySelectorAll('[data-modal-action]').forEach((button) => {
		button.addEventListener('click', () => {
			if (button.dataset.modalAction === 'close') closeModal();
		});
	});
	// ─── BUG FIX: Wire approve/reject/resolve action buttons inside the modal
	wireModalActionButtons();
}

// ─── BUG FIX: Handle data-action buttons that live inside the modal body
//             (e.g. Approve / Reject / Resolve in the detail/claim/sighting modals).
function wireModalActionButtons() {
	document.querySelectorAll('#lfModalBody [data-action]').forEach((button) => {
		button.addEventListener('click', async (event) => {
			event.preventDefault();
			event.stopPropagation();
			const action = button.dataset.action;
			const id = button.dataset.id;
			try {
				if (action === 'approve-pending') await lfRequest('approve_report', { report_id: id });
				if (action === 'reject-pending')  await lfRequest('reject_report',  { report_id: id });
				if (action === 'resolve-active')  await lfRequest('resolve_report', { report_id: id });
				if (action === 'approve-claim')   await lfRequest('approve_claim',  { claim_id: id });
				if (action === 'reject-claim')    await lfRequest('reject_claim',   { claim_id: id });
				if (action === 'approve-sighting') await lfRequest('approve_sighting', { sighting_id: id });
				if (action === 'reject-sighting') await lfRequest('reject_sighting',  { sighting_id: id });
				closeModal();
				await loadAllData(true);
			} catch (error) {
				alert(error.message);
			}
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

	const matchesSection = matches.length
		? `
			<span class="section-title">04. Potential Matches</span>
			<div class="modal-matches">
				${matches.map((m) => `
					<div class="modal-match-item">
						<div class="match-pair">
							<div class="match-side">
								<img src="${escapeHtml(m.lost.image || FALLBACK_IMAGE)}" alt="">
								<small>${escapeHtml(m.lost.name || 'Lost Pet')}</small>
							</div>
							<div class="score-pill">${m.confidence}%</div>
							<div class="match-side">
								<img src="${escapeHtml(m.found.image || FALLBACK_IMAGE)}" alt="">
								<small>${escapeHtml(m.found.name || 'Found Pet')}</small>
							</div>
						</div>
						<div class="reason-row">
							${(m.reasons || []).map((r) => `<span class="reason-chip">${escapeHtml(r)}</span>`).join('')}
						</div>
					</div>
				`).join('')}
			</div>
		`
		: (mode === 'active'
			? '<div class="list-note" style="margin:8px 0;font-size:0.85rem;">No potential matches found for this report.</div>'
			: '');

	// Context-aware footer buttons per mode
	let footerButtons = `<button type="button" class="btn btn-secondary" data-modal-action="close">Close</button>`;
	if (mode === 'pending') {
		footerButtons += `
			<button type="button" class="btn btn-danger"  data-action="reject-pending"  data-id="${report.id}">Reject</button>
			<button type="button" class="btn btn-success" data-action="approve-pending" data-id="${report.id}">Approve</button>
		`;
	} else if (mode === 'active') {
		footerButtons += `
			<button type="button" class="btn btn-success" data-action="resolve-active" data-id="${report.id}">Resolve</button>
		`;
	}

	return `
    <div class="modal-layout">
        <aside class="modal-media">
            <img src="${escapeHtml(report.image)}" alt="${escapeHtml(report.petName || report.title)}">
            <div id="mapDetail${escapeHtml(report.id)}" class="map-api"
                data-map-lat="${mapLat(report)}"
                data-map-lng="${mapLng(report)}"
                data-map-zoom="14">
            </div>
        </aside>

        <!-- Outer wrapper: flex column so footer is always pinned at bottom -->
        <div style="display:flex; flex-direction:column; flex:1; min-height:0;">

            <!-- Scrollable only when active -->
            <section class="modal-content" style="flex:1; overflow-y:${mode === 'active' ? 'auto' : 'hidden'}; min-height:0;">
                <header class="modal-head">
                    <h2 id="lfModalTitle">${escapeHtml(report.type || 'Lost and Found')} Report</h2>
                    <p>Case ID: ${escapeHtml(report.caseId || '')}</p>
                </header>

                <span class="section-title">01. Pet Details</span>
                <div class="modal-grid">
                    <div class="field"><label>Pet Name</label><p>${escapeHtml(report.petName || report.title || 'Unknown')}</p></div>
                    <div class="field"><label>Species / Breed</label><p>${escapeHtml(report.breed || report.petName || '')}</p></div>
                    <div class="field"><label>Size</label><p>${escapeHtml(report.size || '')}</p></div>
                    <div class="field"><label>Sex</label><p>${escapeHtml(report.sex || '')}</p></div>
                    <div class="field"><label>Color / Markings</label><p>${escapeHtml(report.markings || '')}</p></div>
                    <div class="field"><label>Notes</label><p>${escapeHtml(report.notes || report.title || '')}</p></div>
                </div>

                <span class="section-title">02. Location & Date</span>
                <div class="modal-grid">
                    <div class="field"><label>Date</label><p>${escapeHtml(report.dateLost || report.date || '')}</p></div>
                    <div class="field"><label>Time</label><p>${escapeHtml(report.timeLost || report.time || '')}</p></div>
                </div>

                <span class="section-title">03. Uploader Information</span>
                <div class="uploader">
                    <div class="profile-initial">${getInitials(report.uploader || report.title || 'Unknown')}</div>
                    <div>
                        <strong>${escapeHtml(report.uploader || report.title || 'Unknown')}</strong><br>
                        <small>${escapeHtml(report.contact || '')}</small>
                    </div>
                </div>

                ${matchesSection}
            </section>

            <!-- Footer is OUTSIDE the scroll area — always visible -->
            <footer class="modal-footer" style="flex-shrink:0; border-top:1px solid #e5e7eb; padding:12px 16px;">
                ${footerButtons}
            </footer>

        </div>
    </div>
`;
}

// ─── BUG FIX 4: Dedicated modal for Claim records with proper Approve / Reject buttons.
function buildClaimModal(claim) {
	if (!claim) return '<div class="upload-success"><h2 id="lfModalTitle">Record not found</h2></div>';
	return `
		<div class="modal-layout">
			<aside class="modal-media">
				<img src="${escapeHtml(claim.image)}" alt="${escapeHtml(claim.petName)}">
			</aside>
			<section class="modal-content" style="overflow-y:auto;">
				<header class="modal-head">
					<h2 id="lfModalTitle">Claim Report</h2>
					<p>Case ID: ${escapeHtml(claim.caseId || '')}</p>
				</header>

				<span class="section-title">01. Pet Details</span>
				<div class="modal-grid">
					<div class="field"><label>Pet Name</label><p>${escapeHtml(claim.petName || 'Found Pet Report')}</p></div>
					<div class="field"><label>Barangay</label><p>${escapeHtml(claim.barangay || '')}</p></div>
					<div class="field"><label>Submitted</label><p>${escapeHtml(claim.uploadedAt || '')}</p></div>
				</div>

				<span class="section-title">02. Claimant Information</span>
				<div class="uploader">
					<div class="profile-initial">${getInitials(claim.title)}</div>
					<div>
						<strong>${escapeHtml(claim.title)}</strong><br>
						<small>${escapeHtml(claim.contact || 'No contact provided')}</small>
					</div>
				</div>

				<footer class="modal-footer">
					<button type="button" class="btn btn-secondary" data-modal-action="close">Close</button>
					<button  type="button"class="btn btn-danger"  data-action="reject-claim"  data-id="${claim.id}">Reject</button>
					<button  type="button" class="btn btn-success" data-action="approve-claim" data-id="${claim.id}">Approve</button>
				</footer>
			</section>
		</div>
	`;
}

// ─── BUG FIX 4: Dedicated modal for Sighting records with proper Approve / Reject buttons.
function buildSightingModal(sighting) {
	if (!sighting) return '<div class="upload-success"><h2 id="lfModalTitle">Record not found</h2></div>';
	return `
		<div class="modal-layout">
			<aside class="modal-media">
				<img src="${escapeHtml(sighting.image)}" alt="${escapeHtml(sighting.title)}">
			</aside>
			<section class="modal-content" style="overflow-y:auto; ">
				<header class="modal-head">
					<h2 id="lfModalTitle">Sighting Report</h2>
					<p>Case ID: ${escapeHtml(sighting.caseId || '')}</p>
				</header>

				<span class="section-title">01. Sighting Details</span>
				<div class="modal-grid">
					<div class="field"><label>Notes</label><p>${escapeHtml(sighting.title || 'No notes provided')}</p></div>
					<div class="field"><label>Barangay</label><p>${escapeHtml(sighting.barangay || '')}, Baliwag, Bulacan</p></div>
					<div class="field"><label>Date Sighted</label><p>${escapeHtml(sighting.dateLost || '')}</p></div>
					<div class="field"><label>Time Sighted</label><p>${escapeHtml(sighting.timeLost || '')}</p></div>
					<div class="field"><label>Submitted</label><p>${escapeHtml(sighting.uploadedAt || '')}</p></div>
				</div>
				<span class="section-title">02. Last Seen Location</span>
				<div id="mapSighting${escapeHtml(sighting.id)}" class="map-api"
					data-map-lat="${mapLat(sighting)}"
					data-map-lng="${mapLng(sighting)}"
					data-map-zoom="14">
				</div>

				<span class="section-title">03. Reporter Information</span>
				<div class="uploader">
					<div class="profile-initial">${getInitials(sighting.uploader)}</div>
					<div>
						<strong>${escapeHtml(sighting.uploader || 'Unknown')}</strong><br>
						<small>${escapeHtml(sighting.contact || 'No contact provided')}</small>
					</div>
				</div>
				

				<footer class="modal-footer">
				<button type="button" class="btn btn-secondary" data-modal-action="close">Close</button>
				<div class="action-group">
				<button type="button" class="btn btn-danger"  data-action="reject-sighting"  data-id="${sighting.id}">Reject</button>
				<button type="button" class="btn btn-success" data-action="approve-sighting" data-id="${sighting.id}">Approve</button>
				</div>
				</footer>
			</section>
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
						<img src="/bvetter/public/images/icons/report-paw.svg" alt="" class="modal-header-icon-img">
					</div>
					<div>
						<h2 class="modal-title" id="lfModalTitle">Report Lost Pet</h2>
						<p class="modal-subtitle">Vet uploads are published directly as active reports.</p>
					</div>
				</div>
				<div class="modal-header-right">
					<div class="report-type-toggle" role="group" aria-label="Report type">
						<button type="button" class="type-toggle-btn active" data-type="lost">
							<img src="/bvetter/public/images/icons/report-paw.svg" alt="" class="type-toggle-icon">Lost
						</button>
						<button type="button" class="type-toggle-btn" data-type="found">
							<img src="/bvetter/public/images/icons/report-paw.svg" alt="" class="type-toggle-icon">Found
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
							<img src="/bvetter/public/images/icons/report-upload.svg" alt="" class="upload-cam-icon">
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
							</div>
						</div>
						<div class="form-group">
							<label>Breed</label>
							<input name="breed" class="form-input" placeholder="e.g. Golden Retriever" required>
						</div>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label>Sex</label>
							<div class="sex-toggle">
								<button type="button" class="sex-btn active" data-value="Male">Male</button>
								<button type="button" class="sex-btn" data-value="Female">Female</button>
							</div>
							<input type="hidden" name="sex" id="sexInput" value="Male">
						</div>
						<div class="form-group">
							<label>Size</label>
							<div class="select-wrap">
								<select name="size" class="form-select">
									<option>Small (Under 10kg)</option>
									<option>Medium (10-25kg)</option>
									<option>Large (25kg+)</option>
								</select>
							</div>
						</div>
					</div>

					<div class="form-row">
						<div class="form-group full">
							<label>Color / Markings</label>
							<input name="color_markings" class="form-input" placeholder="e.g. White with brown patches, black collar" required>
						</div>
					</div>
				</div>

				<div class="modal-col">
					<div class="modal-section-label" id="incidentSectionLabel">Incident Details</div>

					<div class="form-row">
						<div class="form-group">
							<label id="dateLostLabel">Date Lost</label>
							<input name="incident_date" type="date" class="form-input" required>
						</div>
						<div class="form-group">
							<label>Barangay Last Seen</label>
							<div class="select-wrap">
								<select name="barangay" id="uploadBarangay" class="form-select">${barangayOpts}</select>
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
						<textarea name="notes" id="notesTextarea" class="form-textarea" placeholder="Last behavior, collar color, chip ID if known..." required></textarea>
					</div>
				</div>
			</div>

			<footer class="vlf-footer">
				<button type="button" class="vlf-save-draft">Save Draft</button>
				<div class="vlf-footer-right">
					<button type="button" class="vlf-cancel" data-modal-action="close">Cancel</button>
					<button type="submit" class="vlf-submit" id="submitReportBtn">
						<span>Submit Lost Pet Report</span>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
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

		const submitBtn = document.getElementById('submitReportBtn');
		if (submitBtn) submitBtn.textContent = `Submit ${isLost ? 'Lost' : 'Found'} Pet Report`;

		const dateLabel = document.getElementById('dateLostLabel');
		if (dateLabel) dateLabel.textContent = isLost ? 'Date Lost' : 'Date Found';

		const notes = document.getElementById('notesTextarea');
		if (notes) notes.placeholder = isLost
			? 'Last behavior, collar color, chip ID if known...'
			: 'Where found, animal condition, how to contact owner...';

		if (petNameInput) petNameInput.required = isLost;
		if (petNameOptional) petNameOptional.hidden = isLost;

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
			if (sexInput) sexInput.value = btn.dataset.value;
		});
	});

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
			alert('Pet name is required for lost pet reports.');
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
			alert(error.message);
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

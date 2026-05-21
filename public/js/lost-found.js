/* BVETTER - Lost & Found public page backed by PHP API. */
'use strict';

let currentReportType = 'lost';
let currentFilter = 'all';
let publicReports = [];
let myReports = [];
let currentReportId = null;
let currentClaimReportId = null;

const FALLBACK_IMAGE = '../images/img/upload-pet.png';
const PET_TYPES = ['Dog', 'Cat', 'Other'];
const DEFAULT_COORDS = [14.9577, 120.9055];
let barangays = [];
let reportMap = null;
let reportMarker = null;
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
  'Santo Niño': [14.9630, 120.8940]
};

function sessionUser() {
  try {
    return JSON.parse(sessionStorage.getItem('vbetter_session') || 'null');
  } catch {
    return null;
  }
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

function normalizeType(type) {
  return String(type || '').toLowerCase() === 'found' ? 'found' : 'lost';
}

function formatDate(value) {
  if (!value) return 'No date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function reportImage(report) {
  return report.image || FALLBACK_IMAGE;
}

function reportLocation(report) {
  return report.location || report.barangay || 'Baliwag';
}

function setLoading(target, message = 'Loading reports...') {
  const el = document.getElementById(target);
  if (el) el.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

async function loadReports() {
  setLoading('petGrid');
  const filters = {};
  if (currentFilter !== 'all') filters.type = currentFilter;
  if (activeFilters.type[0]) filters.species = activeFilters.type[0];
  if (activeFilters.barangay[0]) filters.barangay = activeFilters.barangay[0];
  const result = await api.getReports(filters);
  publicReports = result.success ? (result.data || []) : [];
  renderPublicGrid();
}

async function loadBarangays() {
  try {
    const result = await api.getBarangays();
    barangays = result.success ? result.data.map((item) => item.name) : [];
  } catch {
    barangays = [];
  }
  populateSharedOptions();
}

function populateSharedOptions() {
  const barangayOptions = '<option value="">Select Barangay</option>' + barangays.map((name) => `<option>${escapeHtml(name)}</option>`).join('');
  const petTypeOptions = PET_TYPES.map((name) => `<option>${escapeHtml(name)}</option>`).join('');

  const speciesInput = document.getElementById('speciesInput');
  if (speciesInput) speciesInput.innerHTML = petTypeOptions;
  const barangayInput = document.getElementById('barangayInput');
  if (barangayInput) barangayInput.innerHTML = barangayOptions;
  const sightingBarangayInput = document.getElementById('sightingBarangayInput');
  if (sightingBarangayInput) sightingBarangayInput.innerHTML = barangayOptions;

  const filterSections = document.querySelectorAll('.filter-section .filter-chips');
  if (filterSections[0]) {
    filterSections[0].innerHTML = barangays.map((name) => `<button class="filter-chip" onclick="toggleChip(this,'barangay')">${escapeHtml(name)}</button>`).join('');
  }
  if (filterSections[1]) {
    filterSections[1].innerHTML = PET_TYPES.map((name) => `<button class="filter-chip" onclick="toggleChip(this,'type')">${escapeHtml(name)}</button>`).join('');
  }

  document.getElementById('barangayInput')?.addEventListener('change', updateReportMapFromBarangay);
}

async function loadMyReports() {
  const grid = document.querySelector('.my-reports-grid');
  if (grid) grid.innerHTML = '<div class="empty-state">Loading your reports...</div>';
  const result = await api.getMyReports();
  myReports = result.success ? (result.data || []) : [];
  renderMyReports();
}

function renderPublicGrid() {
  const grid = document.getElementById('petGrid');
  if (!grid) return;

  if (!publicReports.length) {
    grid.innerHTML = '<div class="empty-state">No active lost and found reports yet.</div>';
    return;
  }

  grid.innerHTML = publicReports.map((report, index) => {
    const type = normalizeType(report.type);
    return `
      <div class="pet-card" data-status="${type}">
        <div class="pet-card-img-wrap">
          <span class="pet-badge ${type}">${escapeHtml(report.type)}</span>
          <img src="${escapeHtml(reportImage(report))}" alt="" class="pet-card-img"/>
        </div>
        <div class="pet-card-body">
          <div class="pet-card-title-row">
            <span class="pet-card-name">${escapeHtml(report.petName || report.title || 'Unknown')}</span>
            <span class="pet-breed-tag">${escapeHtml(report.breed || report.species || 'Unknown')}</span>
          </div>
          <div class="pet-card-meta">
            <span class="pet-meta-item"><img src="../images/icons/icon-location.svg" class="meta-icon-sm"/> ${escapeHtml(reportLocation(report))}</span>
            <span class="pet-meta-item"><img src="../images/icons/icon-calendar.svg" class="meta-icon-sm"/> ${escapeHtml(formatDate(report.date || report.created_at))}</span>
          </div>
          <button class="btn-view-details" onclick="viewDetails(${index})">View Details</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderMyReports() {
  const grid = document.querySelector('.my-reports-grid');
  if (!grid) return;

  const createCard = `
    <div class="create-report-card">
      <div class="create-report-plus">
        <img src="../images/icons/create-new-report.svg" alt="+" class="create-plus-icon"/>
      </div>
      <h3 class="create-report-title">Create New Report</h3>
      <p class="create-report-desc">File a new lost or found animal report to start the recovery process.</p>
      <button class="btn-start-report" onclick="openModal('lost')">Start Report</button>
    </div>
  `;

  if (!myReports.length) {
    grid.innerHTML = `<div class="empty-state">You have not submitted any lost or found reports yet.</div>${createCard}`;
    renderHistory([]);
    return;
  }

  grid.innerHTML = myReports.map((report) => {
    const type = normalizeType(report.type);
    const pending = report.status === 'pending';
    return `
      <div class="active-report-card" id="reportCard-${report.id}">
        <div class="active-report-img-wrap">
          <span class="pet-badge ${type}">${escapeHtml(report.type)}</span>
          <img src="${escapeHtml(reportImage(report))}" alt="" class="active-report-img"/>
        </div>
        <div class="active-report-body">
          <h3 class="active-report-name">${escapeHtml(report.petName || report.title || 'Unknown')}</h3>
          <span class="active-report-location">
            <img src="../images/icons/icon-location.svg" alt="" class="meta-icon-sm"/> ${escapeHtml(reportLocation(report))}
          </span>
          <div class="active-report-status-row">
            <span class="status-label">CURRENT STATUS</span>
            <span class="status-value ${pending ? 'review' : 'matching'}">
              <img src="../images/icons/${pending ? 'admin-review.svg' : 'matching-progress.svg'}" alt="" class="status-icon"/> ${escapeHtml(pending ? 'Vet Review' : report.status)}
            </span>
          </div>
          <button class="btn-active-details ${pending ? 'outline' : ''}" onclick="openMyReportMatches('${report.id}')">
            ${pending ? 'View Details' : report.status === 'resolved' ? 'View Case' : 'View Potential Matches'}
            <img src="../images/icons/icon-right-arrow.svg" alt="" class="btn-arrow"/>
          </button>
        </div>
      </div>
    `;
  }).join('') + createCard;

  renderHistory(myReports);
}

function renderHistory(reports) {
  const table = document.querySelector('.history-table');
  if (!table) return;

  table.innerHTML = `
    <div class="history-header">
      <span>DATE</span><span>PET NAME</span><span>TYPE</span><span>FINAL STATUS</span><span>ACTION</span>
    </div>
    ${reports.map((report) => {
      const type = normalizeType(report.type);
      return `
        <div class="history-row">
          <span class="history-date">${escapeHtml(formatDate(report.date || report.created_at))}</span>
          <span class="history-pet"><img src="${escapeHtml(reportImage(report))}" alt="" class="history-pet-img"/> ${escapeHtml(report.petName || report.title || 'Unknown')}</span>
          <span><span class="type-tag ${type}-tag">${escapeHtml(report.type)}</span></span>
          <span><span class="final-status ${report.status === 'resolved' ? 'reunited' : 'pending'}">${escapeHtml(report.status)}</span></span>
          <span><button class="btn-view-case" onclick="openMyReportMatches('${report.id}')">View Case</button></span>
        </div>
      `;
    }).join('')}
  `;
}

function filterPets(type, btn) {
  currentFilter = type;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('petGridSection').style.display = 'block';
  document.getElementById('myReportsSection').style.display = 'none';
  loadReports();
}

function showMyReports(btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('petGridSection').style.display = 'none';
  document.getElementById('myReportsSection').style.display = 'block';
  loadMyReports();
}

function openModalById(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  document.body.style.overflow = '';
}

function closeModalOutside(event, id) {
  if (event.target === document.getElementById(id)) closeModal(id);
}

function closeAll() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
  document.body.style.overflow = '';
}

function openModal(type) {
  currentReportType = type;
  const title = document.getElementById('modalTitle');
  const submitText = document.getElementById('submitText');
  const petNameRow = document.getElementById('petNameRow');
  const incidentLabel = document.getElementById('incidentLabel');
  const dateLostLabel = document.getElementById('dateLostLabel');
  const notesLabel = document.getElementById('notesLabel');
  const petDetailsLabel = document.getElementById('petDetailsLabel');

  const isLost = type === 'lost';
  if (title) title.textContent = isLost ? 'Report Lost Pet' : 'Report Found Pet';
  if (submitText) submitText.textContent = isLost ? 'Submit Lost Pet Report' : 'Submit Found Pet Report';
  if (petNameRow) petNameRow.style.display = isLost ? 'block' : 'none';
  if (petDetailsLabel) petDetailsLabel.textContent = isLost ? 'PET DETAILS' : 'ANIMAL DETAILS';
  if (incidentLabel) incidentLabel.textContent = isLost ? 'INCIDENT DETAILS' : 'WHERE AND WHEN FOUND';
  if (dateLostLabel) dateLostLabel.textContent = isLost ? 'Date Lost' : 'Date Found';
  if (notesLabel) notesLabel.textContent = isLost ? 'Additional Details' : 'Current Status / Notes';

  openModalById('reportModal');
  setTimeout(initReportMap, 150);
}

function requiredValue(id, label) {
  const el = document.getElementById(id);
  const value = el ? el.value.trim() : '';
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

async function submitReport() {
  try {
    const formData = new FormData();
    const petName = document.getElementById('petNameInput')?.value.trim() || '';
    if (currentReportType === 'lost' && !petName) throw new Error('Pet name is required for lost pet reports.');

    formData.append('pet_name', petName);
    formData.append('species', requiredValue('speciesInput', 'Type'));
    formData.append('breed', requiredValue('breedInput', 'Breed'));
    formData.append('sex', document.querySelector('#reportModal .sex-btn.active')?.textContent.trim() || 'Male');
    formData.append('size', requiredValue('sizeInput', 'Size'));
    formData.append('color_markings', requiredValue('markingsInput', 'Color / markings'));
    formData.append('incident_date', requiredValue('incidentDateInput', 'Date'));
    formData.append('barangay', requiredValue('barangayInput', 'Barangay'));
    formData.append('lat', document.getElementById('reportLatInput')?.value || '');
    formData.append('lng', document.getElementById('reportLngInput')?.value || '');
    formData.append('notes', requiredValue('notesInput', 'Additional details'));
    formData.append('contact_name', requiredValue('contactName', 'Contact name'));
    formData.append('contact_phone', requiredValue('contactPhone', 'Contact phone'));

    const email = document.getElementById('contactEmail')?.value.trim();
    if (email) formData.append('contact_email', email);
    const photo = document.getElementById('petPhoto')?.files?.[0];
    if (photo) formData.append('photo', photo);

    const submitBtn = document.querySelector('#reportModal .btn-submit');
    if (submitBtn) submitBtn.disabled = true;
    const result = await api.submitReport(currentReportType, formData);
    if (submitBtn) submitBtn.disabled = false;

    if (!result.success) throw new Error(result.message || 'Could not submit report.');
    closeModal('reportModal');
    await loadReports();
    await loadMyReports();
    setTimeout(() => openModalById(currentReportType === 'lost' ? 'lostSuccessModal' : 'foundSuccessModal'), 150);
  } catch (error) {
    alert(error.message);
    const submitBtn = document.querySelector('#reportModal .btn-submit');
    if (submitBtn) submitBtn.disabled = false;
  }
}

function viewDetails(index) {
  const pet = publicReports[index];
  if (!pet) return;
  currentReportId = pet.id;
  currentClaimReportId = pet.id;
  const type = normalizeType(pet.type);

  if (type === 'lost') {
    document.getElementById('detailsPetImg').src = reportImage(pet);
    document.getElementById('detailsPetName').textContent = pet.petName || pet.title || 'Unknown';
    document.getElementById('detailsCaseId').textContent = 'Case ID: ' + pet.caseId;
    document.getElementById('dBreed').textContent = pet.breed || 'Unknown';
    document.getElementById('dAge').textContent = pet.age || 'Unknown';
    document.getElementById('dSize').textContent = pet.size || 'Unknown';
    document.getElementById('dSex').textContent = pet.sex || 'Unknown';
    document.getElementById('dMarkings').textContent = pet.markings || 'N/A';
    document.getElementById('dDate').textContent = formatDate(pet.date);
    document.getElementById('dLocation').textContent = reportLocation(pet);
    openModalById('detailsLostModal');
  } else {
    document.getElementById('detailsFoundImg').src = reportImage(pet);
    document.getElementById('detailsFoundName').textContent = pet.petName || pet.title || 'Unknown';
    document.getElementById('dReportId').textContent = 'Report ID: ' + pet.caseId;
    document.getElementById('dFoundAt').textContent = reportLocation(pet);
    document.getElementById('dDateFound').textContent = formatDate(pet.date);
    document.getElementById('dFoundSize').textContent = pet.size || 'Unknown';
    document.getElementById('dFoundSex').textContent = pet.sex || 'Unknown';
    document.getElementById('dFoundColor').textContent = pet.markings || 'N/A';
    document.getElementById('dFoundNotes').textContent = pet.notes || 'N/A';
    openModalById('detailsFoundModal');
  }
}

async function openMyReportMatches(reportId) {
  const report = myReports.find((item) => String(item.id) === String(reportId));
  const nameEl = document.getElementById('matchesPetName');
  if (nameEl) nameEl.textContent = report?.petName || report?.title || `Report #${reportId}`;

  const panel = document.getElementById('matchesPanel');
  if (panel) panel.querySelectorAll('.lf-match-card').forEach((card) => card.remove());
  const result = await api.getMatchesByReportId(reportId);
  const matches = result.success ? (result.data || []) : [];
  const empty = document.getElementById('noMatchesState');
  if (empty) empty.style.display = matches.length ? 'none' : 'flex';

  const listHtml = matches.map((match) => `
    <article class="lf-match-card">
      <div class="lf-match-photos">
        <img src="${escapeHtml(match.lost.image || FALLBACK_IMAGE)}" alt="">
        <img src="${escapeHtml(match.found.image || FALLBACK_IMAGE)}" alt="">
      </div>
      <div class="lf-match-info">
        <strong>${escapeHtml(match.confidence)}% match</strong>
        <p>${escapeHtml(match.reasons.join(', '))}</p>
        ${match.status === 'approved' ? '<span class="match-alert-badge">Resolved Match</span>' : `<button class="btn-submit" type="button" onclick="openClaimModal(${match.found.reportId || ''})">This is my pet</button>`}
      </div>
    </article>
  `).join('');
  panel?.insertAdjacentHTML('beforeend', listHtml);

  openModalById('matchesPanelOverlay');
}

function closeMatchesPanelDirect() {
  closeModal('matchesPanelOverlay');
}

function closeMatchesPanel(event) {
  if (event.target === document.getElementById('matchesPanelOverlay')) closeMatchesPanelDirect();
}

function handleNotMine(btn) {
  btn.closest('.lf-match-card')?.remove();
}

function handleClaim() {
  openClaimModal();
}

function openSightingModal() {
  closeModal('detailsLostModal');
  closeModal('detailsFoundModal');
  setTimeout(() => openModalById('sightingModal'), 150);
}

async function submitSighting() {
  const formData = new FormData();
  if (currentReportId) formData.append('report_id', currentReportId);
  const modal = document.getElementById('sightingModal');
  const date = modal.querySelector('input[type="date"]')?.value || '';
  const barangay = modal.querySelector('select')?.value || '';
  const location = modal.querySelector('input[type="text"]')?.value || '';
  const notes = modal.querySelector('textarea')?.value || '';
  const photo = document.getElementById('sightingPhoto')?.files?.[0];

  if (!date || !barangay || !notes) {
    alert('Date, barangay, and details are required.');
    return;
  }

  formData.append('sighting_date', date);
  formData.append('barangay', barangay);
  formData.append('location_text', location);
  formData.append('notes', notes);
  if (photo) formData.append('photo', photo);

  const result = await api.submitSighting(formData);
  if (!result.success) {
    alert(result.message || 'Could not submit sighting.');
    return;
  }
  closeModal('sightingModal');
  setTimeout(() => openModalById('sightingSuccessModal'), 150);
}

function initReportMap() {
  if (typeof L === 'undefined') return;
  const mapElement = document.getElementById('reportMap');
  if (!mapElement) return;
  if (reportMap) {
    reportMap.remove();
    reportMap = null;
  }

  const lat = Number(document.getElementById('reportLatInput')?.value || DEFAULT_COORDS[0]);
  const lng = Number(document.getElementById('reportLngInput')?.value || DEFAULT_COORDS[1]);
  reportMap = L.map(mapElement, { zoomControl: true }).setView([lat, lng], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(reportMap);
  reportMarker = L.marker([lat, lng]).addTo(reportMap);
  reportMap.on('click', (event) => setReportMapLocation(event.latlng.lat, event.latlng.lng));
  setTimeout(() => reportMap.invalidateSize(), 100);
}

function focusReportMap(event) {
  event?.preventDefault();
  initReportMap();
  document.getElementById('reportMap')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function setReportMapLocation(lat, lng) {
  document.getElementById('reportLatInput').value = Number(lat).toFixed(6);
  document.getElementById('reportLngInput').value = Number(lng).toFixed(6);
  if (reportMarker) reportMarker.setLatLng([lat, lng]);
  if (reportMap) reportMap.setView([lat, lng], 14);
}

function updateReportMapFromBarangay() {
  const barangay = document.getElementById('barangayInput')?.value || '';
  const [lat, lng] = barangayCoordinates[barangay] || DEFAULT_COORDS;
  setReportMapLocation(lat, lng);
}

function openClaimModal(reportId = null) {
  if (reportId) currentClaimReportId = reportId;
  closeModal('detailsFoundModal');
  setTimeout(() => openModalById('claimModal'), 150);
}

async function submitClaim() {
  if (!currentClaimReportId) {
    alert('Please select a found report first.');
    return;
  }
  const modal = document.getElementById('claimModal');
  const inputs = modal.querySelectorAll('.form-input');
  const formData = new FormData();
  formData.append('claimant_name', inputs[0]?.value.trim() || '');
  formData.append('claimant_phone', inputs[1]?.value.trim() || '');
  formData.append('proof_type', modal.querySelector('.proof-option.active')?.textContent.trim() || 'Photo Evidence');
  const file = document.getElementById('claimDoc')?.files?.[0];
  if (file) formData.append('proof_file', file);

  if (!formData.get('claimant_name') || !formData.get('claimant_phone')) {
    alert('Full name and phone number are required.');
    return;
  }

  const result = await api.submitClaim(currentClaimReportId, formData);
  if (!result.success) {
    alert(result.message || 'Could not submit claim.');
    return;
  }
  closeModal('claimModal');
  setTimeout(() => openModalById('claimSuccessModal'), 150);
}

function selectProof(btn) {
  document.querySelectorAll('.proof-option').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function setSex(btn) {
  const parent = btn.closest('.sex-toggle');
  parent.querySelectorAll('.sex-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function toggleAccountInfo() {
  const toggle = document.getElementById('accountToggle');
  const isOn = toggle.classList.toggle('on');
  const session = sessionUser();
  document.getElementById('contactName').value = isOn ? (session?.name || '') : '';
  document.getElementById('contactPhone').value = isOn ? (session?.phone || '') : '';
  document.getElementById('contactEmail').value = isOn ? (session?.email || '') : '';
}

function toggleFilterPanel() {
  document.getElementById('filterDropdown')?.classList.toggle('open');
  document.getElementById('filterBtn')?.classList.toggle('active');
}

const activeFilters = { barangay: [], type: [], date: [] };

function toggleChip(btn, group) {
  btn.classList.toggle('selected');
  const val = btn.textContent.trim();
  const arr = activeFilters[group];
  const idx = arr.indexOf(val);
  if (idx === -1) arr.push(val);
  else arr.splice(idx, 1);
}

function clearFilters() {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('selected'));
  Object.keys(activeFilters).forEach(k => activeFilters[k] = []);
  loadReports();
}

function applyFilters() {
  document.getElementById('filterDropdown')?.classList.remove('open');
  document.getElementById('filterBtn')?.classList.remove('active');
  loadReports();
}

document.addEventListener('DOMContentLoaded', function () {
  loadBarangays();
  const params = new URLSearchParams(window.location.search);
  if (params.get('tab') === 'myreports') {
    showMyReports(document.getElementById('tab-myreports'));
  } else {
    if (params.get('filter')) currentFilter = params.get('filter');
    loadReports();
  }
});

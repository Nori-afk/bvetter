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
let detailMap = null;
let sightingMap = null;
let sightingMarker = null;
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
  Catulinan: [14.968497, 120.877312]
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
async function getKPI(){
  try{
    const res = await api.getTotalReports();
    const res1 = await api.getActiveReports();
    document.getElementById('ResolvedCases').textContent = res.count;
    document.getElementById('ActiveAlerts').textContent = res1.count;
  }
  catch(error){
    console.error('Error fetching KPIs:', error);
  }
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
    filterSections[0].innerHTML = barangays.map((name) => `<button type="button" class="filter-chip" onclick="toggleChip(this,'barangay')">${escapeHtml(name)}</button>`).join('');
  }
  if (filterSections[1]) {
    filterSections[1].innerHTML = PET_TYPES.map((name) => `<button type="button" class="filter-chip" onclick="toggleChip(this,'type')">${escapeHtml(name)}</button>`).join('');
  }

  document.getElementById('barangayInput')?.addEventListener('change', updateReportMapFromBarangay);
  document.getElementById('sightingBarangayInput')?.addEventListener('change', updateSightingMapFromBarangay);
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
          <button type="button" class="btn-view-details" onclick="viewDetails(${index})">View Details</button>
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
      <button type="button" class="btn-start-report" onclick="openModal('lost')">Start Report</button>
    </div>
  `;

  if (!myReports.length) {
    grid.innerHTML = `<div class="empty-state">You have not submitted any lost or found reports yet.</div>${createCard}`;
    renderHistory([]);
    return;
  }

  // Only ongoing (pending/active) reports belong in the working grid — resolved/rejected
  // cases live in the History table below instead.
  const ongoingReports = myReports.filter((report) => report.status !== 'resolved' && report.status !== 'rejected');

  if (!ongoingReports.length) {
    grid.innerHTML = `<div class="empty-state">No ongoing reports right now. Check your history below.</div>${createCard}`;
    renderHistory(myReports);
    return;
  }

  grid.innerHTML = ongoingReports.map((report) => {
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
          <button type="button" class="btn-active-details ${pending ? 'outline' : ''}" onclick="openMyReportMatches('${report.id}')">
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
          <span><button type="button" class="btn-view-case" onclick="openMyReportMatches('${report.id}')">View Case</button></span>
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
  destroyDetailMap();
  if (id === 'sightingModal') {
    destroySightingMap();
    resetSightingPhotoPreview();
  }

  // reset upload preview
  const fileInput = document.getElementById("petPhoto");
  const uploadBox = document.querySelector(".upload-box");
  const icon = uploadBox.querySelector(".upload-cam-icon");
  const text = uploadBox.querySelector(".upload-text");
  const hint = uploadBox.querySelector(".upload-hint");

  if (fileInput) fileInput.value = ""; // remove selected file

  if (uploadBox) {
    uploadBox.style.backgroundImage = ""; // remove preview
    uploadBox.style.backgroundSize = "";
    uploadBox.style.backgroundPosition = "";
    uploadBox.style.backgroundRepeat = "";
  }

  if (icon) icon.style.display = "block";
  if (text) text.style.display = "block";
  if (hint) hint.style.display = "block";
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
  setTimeout(() => initReportMap(), 100);

  // image preview code
 const fileInput = document.getElementById("petPhoto");
const uploadBox = document.querySelector(".upload-box");

fileInput.addEventListener("change", function () {
    const file = this.files[0];

    if (file) {
        const reader = new FileReader();

        reader.onload = function (e) {
            uploadBox.style.backgroundImage = `url(${e.target.result})`;
            uploadBox.style.backgroundSize = "cover";
            uploadBox.style.backgroundPosition = "center";
            uploadBox.style.backgroundRepeat = "no-repeat";

            // hide icon and text
            uploadBox.querySelector(".upload-cam-icon").style.display = "none";
            uploadBox.querySelector(".upload-text").style.display = "none";
            uploadBox.querySelector(".upload-hint").style.display = "none";
        };

        reader.readAsDataURL(file);
    }
});

  setTimeout(initReportMap, 150);
}

function requiredValue(id, label, minLength = 2) {
  const el = document.getElementById(id);
  const value = el ? el.value.trim() : '';
  if (!value) throw new Error(`${label} is required.`);
  if (value.length < minLength) throw new Error(`${label} must be at least ${minLength} characters.`);
  return value;
}

function todayISODate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

/* Caps every date input at "today" so users can't pick a date that hasn't
   happened yet (an incident/sighting can't be reported before it occurs). */
function setDateInputLimits() {
  const today = todayISODate();
  ['incidentDateInput', 'sightingDateInput'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.max = today;
  });
}

function updateCharCounter(inputId, counterId) {
  const input = document.getElementById(inputId);
  const counter = document.getElementById(counterId);
  if (!input || !counter) return;
  const max = Number(input.getAttribute('maxlength')) || 500;
  counter.textContent = `${input.value.length}/${max}`;
}

function assertDateNotFuture(value, label) {
  if (value && value > todayISODate()) {
    throw new Error(`${label} cannot be a future date.`);
  }
}

function assertValidPhone(value, label) {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^(\+63|0)9\d{9}$/.test(digits)) {
    throw new Error(`${label} must be a valid PH mobile number (e.g. 0917 123 4567).`);
  }
}

function assertValidEmail(value, label) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`${label} must be a valid email address.`);
  }
}

function assertValidPhoto(file, label, allowedTypes, maxSizeMB = 8) {
  if (!file) return;
  if (!allowedTypes.includes(file.type)) {
    throw new Error(`${label} must be a JPG, PNG${allowedTypes.includes('image/webp') ? ', or WEBP' : allowedTypes.includes('application/pdf') ? ', or PDF' : ''} file.`);
  }
  if (file.size > maxSizeMB * 1024 * 1024) {
    throw new Error(`${label} must not exceed ${maxSizeMB}MB.`);
  }
}

async function submitReport() {
  try {
    const session = sessionUser();
    if (!session?.userId) {
      throw new Error('Your session has expired. Please log in again before submitting a report.');
    }

    const formData = new FormData();
    const petName = document.getElementById('petNameInput')?.value.trim() || '';
    if (currentReportType === 'lost' && petName.length < 2) throw new Error('Pet name is required for lost pet reports (min. 2 characters).');

    const incidentDate = requiredValue('incidentDateInput', 'Date');
    assertDateNotFuture(incidentDate, 'Date');

    const contactPhone = requiredValue('contactPhone', 'Contact phone');
    assertValidPhone(contactPhone, 'Contact phone');

    const email = document.getElementById('contactEmail')?.value.trim();
    if (email) assertValidEmail(email, 'Contact email');

    const photo = document.getElementById('petPhoto')?.files?.[0];
    assertValidPhoto(photo, 'Pet photo', ['image/jpeg', 'image/png', 'image/webp']);

    formData.append('pet_name', petName);
    formData.append('species', requiredValue('speciesInput', 'Type'));
    formData.append('breed', requiredValue('breedInput', 'Breed'));
    formData.append('sex', document.querySelector('#reportModal .sex-btn.active')?.textContent.trim() || 'Male');
    formData.append('size', requiredValue('sizeInput', 'Size'));
    formData.append('color_markings', requiredValue('markingsInput', 'Color / markings', 5));
    formData.append('incident_date', incidentDate);
    formData.append('barangay', requiredValue('barangayInput', 'Barangay'));
    formData.append('lat', document.getElementById('reportLatInput')?.value || '');
    formData.append('lng', document.getElementById('reportLngInput')?.value || '');
    formData.append('notes', requiredValue('notesInput', 'Additional details', 5));
    formData.append('contact_name', requiredValue('contactName', 'Contact name'));
    formData.append('contact_phone', contactPhone);

    if (email) formData.append('contact_email', email);
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
    setTimeout(() => initDetailMap('detailsLostMap', pet), 100);
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
    setTimeout(() => initDetailMap('detailsFoundMap', pet), 100);
  }
}
function matchScoreClass(confidence) {
	if (confidence >= 80) return 'high';
	if (confidence >= 60) return 'mid';
	return 'low';
}
function buildMatchCard(match, index, report) {
	const cls        = matchScoreClass(match.confidence);
	const barClass   = cls === 'high' ? 'lf-match-bar' : `lf-match-bar ${cls}-bar`;
	const isResolved = match.status === 'approved';
	const foundId    = match.found?.reportId || '';
 
	// Infer "Found" source label: sightings come from the community, reports from admin/clinic
	const foundSource = match.found?.sightingId && !match.found?.reportId
		? 'Community Report'
		: 'Admin Upload';
 
	// Similarity reason chips
	const simTagsHtml = (match.reasons || [])
		.map((reason) => `<span class="lf-sim-tag">${escapeHtml(reason)}</span>`)
		.join('');
 
	// Action buttons — hide claim button for already-resolved matches
	const actionsHtml = isResolved
		? `<div class="lf-match-resolved-badge">✓ Resolved Match</div>`
		: `
			<button type="button" class="lfd-btn-notmine"
				data-match-id="${match.id}"
				onclick="handleNotMine(this)">
				NOT MY PET
			</button>
			<button type="button" class="lfd-btn-claim"
				data-match-id="${match.id}"
				data-found-id="${foundId}"
				onclick="handleClaim(this)">
				CLAIM THIS PET
			</button>
		`;
 
	return `
		<div class="lf-match-card ${cls}" data-match-id="${escapeHtml(String(match.id))}">
 
			<!-- Score row -->
			<div class="lf-match-top">
				<span class="lf-match-label">Potential Match ${index + 1}</span>
				<div class="lf-match-score-wrap">
					<div class="lf-match-bar-track">
						<div class="${barClass}" data-width="${match.confidence}" style="width:0%"></div>
					</div>
					<span class="lf-match-pct ${cls}">${match.confidence}%</span>
				</div>
			</div>
 
			<!-- Pet pair -->
			<div class="lf-match-pets">
 
				<!-- Lost pet (owner's report) -->
				<div class="lf-match-pet-card owner">
					<img src="${escapeHtml(match.lost.image || FALLBACK_IMAGE)}"
						alt="${escapeHtml(match.lost.name || 'Lost Pet')}"
						class="lf-match-pet-img"/>
					<div class="lf-match-pet-info">
						<h4 class="lf-match-pet-name">
							${escapeHtml(match.lost.name || report?.petName || report?.title || 'Lost Pet')}
						</h4>
						<p class="lf-match-pet-meta">${escapeHtml(match.lost.breed || '')}</p>
						<p class="lf-match-pet-meta">${escapeHtml(match.lost.location || '')}</p>
						<p class="lf-match-pet-meta">Reported: ${escapeHtml(formatDate(match.lost.createdAt))}</p>
						<span class="lf-match-tag lost-tag">Lost (Your Report)</span>
					</div>
				</div>
 
				<!-- VS connector -->
				<div class="lf-match-vs">
					<div class="lf-match-vs-line"></div>
					<div class="lf-match-vs-icon">
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
							<path d="M3.5 7h7M7.5 4.5L10 7l-2.5 2.5"
								stroke="#737781" stroke-width="1.2"
								stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
					</div>
					<div class="lf-match-vs-line"></div>
				</div>
 
				<!-- Found pet (admin/community report) -->
				<div class="lf-match-pet-card admin">
					<img src="${escapeHtml(match.found.image || FALLBACK_IMAGE)}"
						alt="${escapeHtml(match.found.name || 'Found Pet')}"
						class="lf-match-pet-img"/>
					<div class="lf-match-pet-info">
						<h4 class="lf-match-pet-name">
							${escapeHtml(match.found.name || 'Found Pet')}
						</h4>
						<p class="lf-match-pet-meta">${escapeHtml(match.found.breed || '')}</p>
						<p class="lf-match-pet-meta">Source: ${escapeHtml(foundSource)}</p>
						<p class="lf-match-pet-meta">Reported: ${escapeHtml(formatDate(match.found.createdAt))}</p>
						<span class="lf-match-tag found-tag">Found (Admin)</span>
					</div>
				</div>
 
			</div>
 
			<!-- Similarity reason chips -->
			${simTagsHtml ? `<div class="lf-match-similarity-tags">${simTagsHtml}</div>` : ''}
 
			<!-- Actions -->
			<div class="lf-match-actions">${actionsHtml}</div>
 
		</div>
	`;
}
async function openMyReportMatches(reportId) {
	// Find the owner's report for name/breed fallbacks
	const report = myReports.find((item) => String(item.id) === String(reportId));
 
	// Update the panel subtitle with the pet's name
	const nameEl = document.getElementById('matchesPetName');
	if (nameEl) {
		nameEl.textContent = report?.petName || report?.title || `Report #${reportId}`;
	}
 
	// Grab the panel body and remove any previously rendered match cards
	const body = document.querySelector('#matchesPanel .matches-panel-body');
	if (body) body.querySelectorAll('.lf-match-card').forEach((card) => card.remove());
 
	// Show a subtle loading state while fetching
	const emptyEl = document.getElementById('noMatchesState');
	if (emptyEl) emptyEl.style.display = 'none';
 
	// Fetch matches for this specific report
	let matches = [];
	try {
		const result = await api.getMatchesByReportId(reportId);
		matches = result.success ? (result.data || []) : [];
	} catch (err) {
		console.error('Failed to load matches:', err);
	}
 
	// Show empty state if no matches returned
	if (emptyEl) emptyEl.style.display = matches.length ? 'none' : 'flex';
 
	// Build and inject all match cards before the empty-state element
	if (matches.length && body) {
		const cardsHtml = matches
			.map((match, i) => buildMatchCard(match, i, report))
			.join('');
 
		// Insert cards just before the empty state so they appear above it
		if (emptyEl) {
			emptyEl.insertAdjacentHTML('beforebegin', cardsHtml);
		} else {
			body.insertAdjacentHTML('beforeend', cardsHtml);
		}
 
		// Animate the score bars after the DOM is painted (mirrors the CSS transition
		// on the hardcoded cards — bars start at 0% then slide to the real value)
		requestAnimationFrame(() => {
			body.querySelectorAll('.lf-match-bar[data-width]').forEach((bar) => {
				bar.style.transition = 'width 0.65s cubic-bezier(0.25, 0.8, 0.25, 1)';
				bar.style.width = bar.dataset.width + '%';
			});
		});
	}
 
	// Open the slide-in panel
	openModalById('matchesPanelOverlay');
}

getKPI();
function closeMatchesPanelDirect() {
  closeModal('matchesPanelOverlay');
}

function closeMatchesPanel(event) {
  if (event.target === document.getElementById('matchesPanelOverlay')) closeMatchesPanelDirect();
}

function handleNotMine(btn) {
  btn.closest('.lf-match-card')?.remove();
}

function handleClaim(btn) {
  const foundId = btn?.dataset?.foundId || '';
  if (foundId) currentClaimReportId = foundId;
  if (!currentClaimReportId) {
    alert('Only found pet reports can be claimed. Please contact the clinic for sighting reports.');
    return;
  }
  openClaimModal();
}

function openSightingModal() {
  closeModal('detailsLostModal');
  closeModal('detailsFoundModal');
  setTimeout(() => {
    openModalById('sightingModal');
    initSightingMap();
    initSightingPhotoPreview();
  }, 150);
}

async function submitSighting() {
  const session = sessionUser();
  if (!session?.userId) {
    alert('Your session has expired. Please log in again before submitting a sighting.');
    return;
  }

  const formData = new FormData();
  if (currentReportId) formData.append('report_id', currentReportId);

  let date, barangay, location, notes, photo;
  try {
    date = requiredValue('sightingDateInput', 'Date spotted', 1);
    assertDateNotFuture(date, 'Date spotted');
    barangay = requiredValue('sightingBarangayInput', 'Barangay');
    location = requiredValue('sightingLocationInput', 'Specific landmark', 5);
    notes = requiredValue('sightingNotesInput', 'Additional details', 5);
    photo = document.getElementById('sightingPhoto')?.files?.[0];
    assertValidPhoto(photo, 'Sighting photo', ['image/jpeg', 'image/png', 'image/webp']);
  } catch (error) {
    alert(error.message);
    return;
  }

  formData.append('sighting_date', date);
  formData.append('barangay', barangay);
  formData.append('location_text', location);
  formData.append('lat', document.getElementById('sightingLatInput')?.value || '');
  formData.append('lng', document.getElementById('sightingLngInput')?.value || '');
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

function initSightingPhotoPreview() {
  const input = document.getElementById('sightingPhoto');
  if (!input || input.dataset.previewBound === 'true') return;
  input.dataset.previewBound = 'true';
  input.addEventListener('change', updateSightingPhotoPreview);
}

function updateSightingPhotoPreview() {
  const input = document.getElementById('sightingPhoto');
  const uploadBox = input?.closest('.upload-box-wide');
  const file = input?.files?.[0];
  if (!uploadBox || !file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    uploadBox.style.backgroundImage = `url(${event.target.result})`;
    uploadBox.style.backgroundSize = 'cover';
    uploadBox.style.backgroundPosition = 'center';
    uploadBox.style.backgroundRepeat = 'no-repeat';
    uploadBox.querySelector('.upload-cam-lg-img')?.style.setProperty('display', 'none');
    uploadBox.querySelector('.upload-text')?.style.setProperty('display', 'none');
    uploadBox.querySelector('.upload-hint')?.style.setProperty('display', 'none');
  };
  reader.readAsDataURL(file);
}

function resetSightingPhotoPreview() {
  const input = document.getElementById('sightingPhoto');
  const uploadBox = input?.closest('.upload-box-wide');
  if (input) input.value = '';
  if (!uploadBox) return;

  uploadBox.style.backgroundImage = '';
  uploadBox.style.backgroundSize = '';
  uploadBox.style.backgroundPosition = '';
  uploadBox.style.backgroundRepeat = '';
  uploadBox.querySelector('.upload-cam-lg-img')?.style.removeProperty('display');
  uploadBox.querySelector('.upload-text')?.style.removeProperty('display');
  uploadBox.querySelector('.upload-hint')?.style.removeProperty('display');
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

function nearestBarangay(lat, lng) {
  let closest = null;
  let closestDist = Infinity;
  Object.keys(barangayCoordinates).forEach((name) => {
    const [blat, blng] = barangayCoordinates[name];
    const dist = Math.hypot(blat - lat, blng - lng);
    if (dist < closestDist) {
      closestDist = dist;
      closest = name;
    }
  });
  return closest;
}

function setReportMapLocation(lat, lng, syncBarangay = true) {
  document.getElementById('reportLatInput').value = Number(lat).toFixed(6);
  document.getElementById('reportLngInput').value = Number(lng).toFixed(6);
  if (reportMarker) reportMarker.setLatLng([lat, lng]);
  if (reportMap) reportMap.setView([lat, lng], 14);
  if (syncBarangay) {
    const barangaySelect = document.getElementById('barangayInput');
    const nearest = nearestBarangay(lat, lng);
    if (barangaySelect && nearest) barangaySelect.value = nearest;
  }
}

function updateReportMapFromBarangay() {
  const barangay = document.getElementById('barangayInput')?.value || '';
  const [lat, lng] = barangayCoordinates[barangay] || DEFAULT_COORDS;
  setReportMapLocation(lat, lng, false);
}

function initSightingMap() {
  if (typeof L === 'undefined') return;
  const mapElement = document.getElementById('sightingMap');
  if (!mapElement) return;
  destroySightingMap();

  const barangay = document.getElementById('sightingBarangayInput')?.value || '';
  const [fallbackLat, fallbackLng] = barangayCoordinates[barangay] || DEFAULT_COORDS;
  const lat = Number(document.getElementById('sightingLatInput')?.value || fallbackLat);
  const lng = Number(document.getElementById('sightingLngInput')?.value || fallbackLng);
  sightingMap = L.map(mapElement, { zoomControl: true }).setView([lat, lng], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(sightingMap);
  sightingMarker = L.marker([lat, lng]).addTo(sightingMap);
  sightingMap.on('click', (event) => setSightingMapLocation(event.latlng.lat, event.latlng.lng));
  setSightingMapLocation(lat, lng, false);
  setTimeout(() => sightingMap?.invalidateSize(), 100);
}

function setSightingMapLocation(lat, lng, syncBarangay = true) {
  const nextLat = Number(lat);
  const nextLng = Number(lng);
  if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;
  const latInput = document.getElementById('sightingLatInput');
  const lngInput = document.getElementById('sightingLngInput');
  if (latInput) latInput.value = nextLat.toFixed(6);
  if (lngInput) lngInput.value = nextLng.toFixed(6);
  if (sightingMarker) sightingMarker.setLatLng([nextLat, nextLng]);
  if (sightingMap) sightingMap.setView([nextLat, nextLng], 14);
  if (syncBarangay) {
    const barangaySelect = document.getElementById('sightingBarangayInput');
    const nearest = nearestBarangay(nextLat, nextLng);
    if (barangaySelect && nearest) barangaySelect.value = nearest;
  }
}

function updateSightingMapFromBarangay() {
  const barangay = document.getElementById('sightingBarangayInput')?.value || '';
  const [lat, lng] = barangayCoordinates[barangay] || DEFAULT_COORDS;
  setSightingMapLocation(lat, lng, false);
}

function destroySightingMap() {
  if (!sightingMap) return;
  sightingMap.remove();
  sightingMap = null;
  sightingMarker = null;
}

function initDetailMap(elementId, report) {
  if (typeof L === 'undefined') return;
  const element = document.getElementById(elementId);
  if (!element) return;
  destroyDetailMap();
  const [fallbackLat, fallbackLng] = barangayCoordinates[report?.barangay] || DEFAULT_COORDS;
  const reportLat = Number(report?.lat ?? report?.latitude);
  const reportLng = Number(report?.lng ?? report?.longitude);
  const lat = Number.isFinite(reportLat) ? reportLat : fallbackLat;
  const lng = Number.isFinite(reportLng) ? reportLng : fallbackLng;
  detailMap = L.map(element, { zoomControl: true }).setView([lat, lng], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(detailMap);
  L.marker([lat, lng]).addTo(detailMap).bindTooltip('Report Location', { permanent: true, direction: 'top' });
  setTimeout(() => detailMap?.invalidateSize(), 100);
}

function destroyDetailMap() {
  if (!detailMap) return;
  detailMap.remove();
  detailMap = null;
}

function openClaimModal(reportId = null) {
  if (reportId) currentClaimReportId = reportId;
  closeModal('detailsFoundModal');
  setTimeout(() => {
    openModalById('claimModal');
    initClaimDocPreview();
  }, 150);
}

function initClaimDocPreview() {
  const input = document.getElementById('claimDoc');
  resetClaimDocPreview();
  if (!input || input.dataset.previewBound === 'true') return;
  input.dataset.previewBound = 'true';
  input.addEventListener('change', updateClaimDocPreview);
}

function updateClaimDocPreview() {
  const input = document.getElementById('claimDoc');
  const uploadBox = input?.closest('.upload-box-wide');
  const file = input?.files?.[0];
  if (!uploadBox || !file) return;

  uploadBox.querySelector('.upload-doc-icon-img')?.style.setProperty('display', 'none');
  uploadBox.querySelector('.upload-text')?.style.setProperty('display', 'none');
  uploadBox.querySelector('.upload-hint')?.style.setProperty('display', 'none');

  let fileNameEl = uploadBox.querySelector('.upload-file-name');
  if (!fileNameEl) {
    fileNameEl = document.createElement('span');
    fileNameEl.className = 'upload-file-name';
    uploadBox.appendChild(fileNameEl);
  }

  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (event) => {
      uploadBox.style.backgroundImage = `url(${event.target.result})`;
      uploadBox.style.backgroundSize = 'cover';
      uploadBox.style.backgroundPosition = 'center';
      uploadBox.style.backgroundRepeat = 'no-repeat';
      fileNameEl.hidden = true;
      fileNameEl.textContent = '';
    };
    reader.readAsDataURL(file);
  } else {
    uploadBox.style.backgroundImage = '';
    fileNameEl.hidden = false;
    fileNameEl.textContent = `Selected: ${file.name}`;
  }
}

function resetClaimDocPreview() {
  const input = document.getElementById('claimDoc');
  const uploadBox = input?.closest('.upload-box-wide');
  if (input) input.value = '';
  if (!uploadBox) return;

  uploadBox.style.backgroundImage = '';
  uploadBox.style.backgroundSize = '';
  uploadBox.style.backgroundPosition = '';
  uploadBox.style.backgroundRepeat = '';
  uploadBox.querySelector('.upload-doc-icon-img')?.style.removeProperty('display');
  uploadBox.querySelector('.upload-text')?.style.removeProperty('display');
  uploadBox.querySelector('.upload-hint')?.style.removeProperty('display');
  uploadBox.querySelector('.upload-file-name')?.remove();
}

async function submitClaim() {
  const session = sessionUser();
  if (!session?.userId) {
    alert('Your session has expired. Please log in again before submitting a claim.');
    return;
  }

  if (!currentClaimReportId) {
    alert('Please select a found report first.');
    return;
  }

  const modal = document.getElementById('claimModal');
  const formData = new FormData();
  let claimantName, claimantPhone, file;
  try {
    claimantName = requiredValue('claimNameInput', 'Full name');
    claimantPhone = requiredValue('claimPhoneInput', 'Phone number', 1);
    assertValidPhone(claimantPhone, 'Phone number');
    file = document.getElementById('claimDoc')?.files?.[0];
    if (!file) throw new Error('Please upload a proof of ownership document.');
    assertValidPhoto(file, 'Proof document', ['image/jpeg', 'image/png', 'application/pdf']);
  } catch (error) {
    alert(error.message);
    return;
  }

  formData.append('claimant_name', claimantName);
  formData.append('claimant_phone', claimantPhone);
  formData.append('proof_type', modal.querySelector('.proof-option.active')?.textContent.trim() || 'Photo Evidence');
  formData.append('proof_file', file);

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
  setDateInputLimits();
  const params = new URLSearchParams(window.location.search);
  if (params.get('tab') === 'myreports') {
    showMyReports(document.getElementById('tab-myreports'));
  } else {
    if (params.get('filter')) currentFilter = params.get('filter');
    loadReports();
  }
});

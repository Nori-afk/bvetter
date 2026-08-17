/* BVetter - Lost & Found public page backed by PHP API. */
'use strict';

let currentReportType = 'lost';
let currentFilter = 'all';
let publicReports = [];
let myReports = [];
let currentReportId = null;
let currentClaimReportId = null;

const FALLBACK_IMAGE = '../images/img/upload-pet.png';
const PET_TYPES = ['Dog', 'Cat'];
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
    return JSON.parse(localStorage.getItem('vbetter_session') || 'null');
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

/* ── Click-to-expand photos (lightbox) ──────────
   Wraps any pet/report photo with a small expand-icon badge; clicking either
   the photo or the badge opens it full-size. `small` shrinks the badge for
   compact thumbnails (match-card pets, sighting photo). */
const EXPAND_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5.5 1.5H2.5a1 1 0 00-1 1v3M8.5 1.5h3a1 1 0 011 1v3M5.5 12.5H2.5a1 1 0 01-1-1v-3M8.5 12.5h3a1 1 0 001-1v-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function expandableImg(src, alt, imgClass, small = false) {
  const safeSrc = escapeHtml(src || FALLBACK_IMAGE);
  const safeAlt = escapeHtml(alt || '');
  return `
    <div class="lf-img-expand-wrap${small ? ' small' : ''}" data-lightbox-src="${safeSrc}" data-lightbox-alt="${safeAlt}">
      <img src="${safeSrc}" alt="${safeAlt}" class="${imgClass}" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';this.closest('.lf-img-expand-wrap').dataset.lightboxSrc='${FALLBACK_IMAGE}';"/>
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
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightboxDirect() {
  const overlay = document.getElementById('lfLightbox');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

function closeLightbox(event) {
  if (event.target === document.getElementById('lfLightbox')) closeLightboxDirect();
}

document.addEventListener('click', (event) => {
  const lightboxTarget = event.target.closest('[data-lightbox-target]');
  if (lightboxTarget) {
    const img = document.getElementById(lightboxTarget.dataset.lightboxTarget);
    if (img && img.src) {
      event.stopPropagation();
      openLightbox(img.src, img.alt);
    }
    return;
  }

  const lightboxWrap = event.target.closest('.lf-img-expand-wrap');
  if (lightboxWrap) {
    event.stopPropagation();
    openLightbox(lightboxWrap.dataset.lightboxSrc, lightboxWrap.dataset.lightboxAlt);
    return;
  }

  const matchCard = event.target.closest('.lf-match-card');
  if (matchCard && !event.target.closest('.lf-match-actions') && !event.target.closest('.lf-match-resolved-badge')) {
    openMatchDetail(matchCard.dataset.matchId);
  }
});

function setLoading(target, message = 'Loading reports...') {
  const el = document.getElementById(target);
  if (el) el.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

async function loadReports(options = {}) {
  const silent = options.silent === true;
  if (!silent) setLoading('petGrid');
  const filters = {};
  if (currentFilter !== 'all') filters.type = currentFilter;
  if (activeFilters.type[0]) filters.species = activeFilters.type[0];
  if (activeFilters.barangay[0]) filters.barangay = activeFilters.barangay[0];
  const result = await api.getReports(filters);
  const fresh = result.success ? (result.data || []) : [];
  // Silent (polled) refreshes skip the re-render entirely when nothing
  // actually changed, so the grid doesn't flicker/reset scroll every tick.
  if (silent && JSON.stringify(fresh) === JSON.stringify(publicReports)) return;
  publicReports = fresh;
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

    const resolvedCount = res.count || 0;
    const casesCount = resolvedCount + (res1.count || 0);
    const successRateEl = document.getElementById('successRate');
    const successRateDescEl = document.getElementById('successRateDesc');
    if (casesCount === 0) {
      successRateEl.textContent = '—';
      successRateDescEl.textContent = 'No active reports or cases yet.';
    } else {
      successRateEl.textContent = `${Math.round((resolvedCount / casesCount) * 100)}%`;
      successRateDescEl.textContent = 'Pets reunited around Baliwag thanks to the BVetter community.';
    }
  }
  catch(error){
    console.error('Error fetching KPIs:', error);
  }
}

function populateSharedOptions() {
  // "Others" covers pets lost/found/sighted outside Baliwag City — picking it
  // reveals a free-text field (see toggleBarangayOther) instead of forcing a
  // Baliwag barangay that doesn't apply.
  const barangayOptions = '<option value="">Select Barangay</option>' + barangays.map((name) => `<option>${escapeHtml(name)}</option>`).join('') + '<option value="Others">Others (outside Baliwag City)</option>';
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
  document.getElementById('barangayInput')?.addEventListener('change', () => toggleBarangayOther('barangayInput', 'barangayOtherInput'));
  document.getElementById('sightingBarangayInput')?.addEventListener('change', () => toggleBarangayOther('sightingBarangayInput', 'sightingBarangayOtherInput'));
}

function toggleBarangayOther(selectId, otherId) {
  const select = document.getElementById(selectId);
  const other = document.getElementById(otherId);
  if (!select || !other) return;
  const isOthers = select.value === 'Others';
  other.style.display = isOthers ? 'block' : 'none';
  if (!isOthers) other.value = '';
}

// Resolves a barangay <select> to the value that should actually be submitted:
// the picked barangay name, or (when "Others" is chosen) the free-text place
// typed into the paired text field.
function requiredBarangayValue(selectId, otherId, label) {
  const value = requiredValue(selectId, label);
  if (value === 'Others') {
    return requiredValue(otherId, `${label} (please specify)`, 2);
  }
  return value;
}

let myReportClaimants = {};

async function loadMyReports(options = {}) {
  const silent = options.silent === true;
  const grid = document.querySelector('.my-reports-grid');
  if (!silent && grid) grid.innerHTML = '<div class="empty-state">Loading your reports...</div>';
  const result = await api.getMyReports();
  const freshReports = result.success ? (result.data || []) : [];

  const freshClaimants = {};
  try {
    const session = sessionUser();
    if (session?.userId) {
      const claimsResult = await api.getClaims({ report_owner_id: session.userId });
      (claimsResult.success ? (claimsResult.data || []) : []).forEach((claim) => {
        if (['approved', 'resolved'].includes(claim.status)) {
          freshClaimants[claim.report_id] = {
            name: claim.claimant_name || 'Unknown',
            phone: claim.claimant_phone || '',
            email: claim.claimant_email || ''
          };
        }
      });
    }
  } catch (error) {
    /* claimant lookup failed — history table will just omit the column value */
  }

  // Silent (polled) refreshes skip the re-render entirely when nothing
  // actually changed, so the grid doesn't flicker/reset scroll every tick.
  if (silent && JSON.stringify(freshReports) === JSON.stringify(myReports)
      && JSON.stringify(freshClaimants) === JSON.stringify(myReportClaimants)) return;

  myReports = freshReports;
  myReportClaimants = freshClaimants;
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
          ${expandableImg(reportImage(report), report.petName || report.title || 'Pet', 'pet-card-img')}
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
          ${expandableImg(reportImage(report), report.petName || report.title || 'Pet', 'active-report-img')}
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
          <div class="active-report-actions">
            <button type="button" class="btn-active-details ${pending ? 'outline' : ''}" onclick="openMyReportMatches('${report.id}')">
              ${pending ? 'View Details' : report.status === 'resolved' ? 'View Case' : 'View Potential Matches'}
              <img src="../images/icons/icon-right-arrow.svg" alt="" class="btn-arrow"/>
            </button>
            ${!pending ? `
              <button type="button" class="btn-mark-resolved" onclick="handleResolveOwnReport('${report.id}')">
                Mark Resolved
              </button>
            ` : ''}
          </div>
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
      <span>DATE</span><span>PET NAME</span><span>TYPE</span><span>FINAL STATUS</span><span>CLAIMED BY</span><span>ACTION</span>
    </div>
    ${reports.map((report) => {
      const type = normalizeType(report.type);
      const claimant = myReportClaimants[report.id]?.name;
      return `
        <div class="history-row">
          <span class="history-date">${escapeHtml(formatDate(report.date || report.created_at))}</span>
          <span class="history-pet"><img src="${escapeHtml(reportImage(report))}" alt="" class="history-pet-img" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';"/> ${escapeHtml(report.petName || report.title || 'Unknown')}</span>
          <span><span class="type-tag ${type}-tag">${escapeHtml(report.type)}</span></span>
          <span><span class="final-status ${report.status === 'resolved' ? 'reunited' : 'pending'}">${escapeHtml(report.status)}</span></span>
          <span class="history-claimant">${escapeHtml(claimant || '—')}</span>
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
  if (id === 'reportModal') {
    ['petNameInput', 'breedInput', 'markingsInput', 'incidentDateInput', 'notesInput', 'contactName', 'contactPhone', 'contactEmail'].forEach((fieldId) => {
      const field = document.getElementById(fieldId);
      if (field) field.value = '';
    });
    const speciesInput = document.getElementById('speciesInput');
    if (speciesInput) speciesInput.selectedIndex = 0;
    const sizeInput = document.getElementById('sizeInput');
    if (sizeInput) sizeInput.selectedIndex = 0;
    const barangayInput = document.getElementById('barangayInput');
    if (barangayInput) barangayInput.value = '';
    toggleBarangayOther('barangayInput', 'barangayOtherInput');
    document.querySelectorAll('#reportModal .sex-btn').forEach((btn) => btn.classList.remove('active'));
    document.getElementById('accountToggle')?.classList.remove('on');
    updateCharCounter('notesInput', 'notesCounter');
    updateCharCounter('markingsInput', 'markingsCounter');
    const reportLatInput = document.getElementById('reportLatInput');
    const reportLngInput = document.getElementById('reportLngInput');
    if (reportLatInput) reportLatInput.value = DEFAULT_COORDS[0];
    if (reportLngInput) reportLngInput.value = DEFAULT_COORDS[1];
  }
  if (id === 'sightingModal') {
    destroySightingMap();
    resetSightingPhotoPreview();
    toggleBarangayOther('sightingBarangayInput', 'sightingBarangayOtherInput');
    document.getElementById('sightingAccountToggle')?.classList.remove('on');
    ['sightingContactName', 'sightingContactPhone', 'sightingContactEmail'].forEach((fieldId) => {
      const field = document.getElementById(fieldId);
      if (field) field.value = '';
    });
  }
  if (id === 'claimModal') {
    document.getElementById('claimAccountToggle')?.classList.remove('on');
    ['claimNameInput', 'claimPhoneInput', 'claimEmailInput'].forEach((fieldId) => {
      const field = document.getElementById(fieldId);
      if (field) field.value = '';
    });
    document.querySelectorAll('#claimModal .proof-option').forEach((btn, index) => btn.classList.toggle('active', index === 0));
    resetClaimDocPreview();
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
  if (!isLost) {
    const petNameInput = document.getElementById('petNameInput');
    if (petNameInput) petNameInput.value = '';
  }
  if (petDetailsLabel) petDetailsLabel.textContent = isLost ? 'PET DETAILS' : 'ANIMAL DETAILS';
  if (incidentLabel) incidentLabel.textContent = isLost ? 'INCIDENT DETAILS' : 'WHERE AND WHEN FOUND';
  if (dateLostLabel) dateLostLabel.textContent = isLost ? 'Date Lost' : 'Date Found';
  if (notesLabel) notesLabel.textContent = (isLost ? 'Additional Details' : 'Current Status / Notes') + ' (Optional)';

  applySexDefaults(isLost);

  openModalById('reportModal');
  setTimeout(() => initReportMap(), 100);
  restoreDraft(type);
  toggleBarangayOther('barangayInput', 'barangayOtherInput');
  updateCharCounter('markingsInput', 'markingsCounter');

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

/* Sex rules differ per report type: found reports offer "Unknown" (a finder
   often can't check the animal) preselected by default; lost reports hide
   Unknown and force an explicit Male/Female pick — no silent default. */
function applySexDefaults(isLost) {
  const unknownBtn = document.getElementById('sexBtnUnknown');
  const sexOptionalHint = document.getElementById('sexOptionalHint');
  if (unknownBtn) unknownBtn.style.display = isLost ? 'none' : '';
  if (sexOptionalHint) sexOptionalHint.hidden = isLost;
  document.querySelectorAll('#reportModal .sex-btn').forEach((btn) => {
    btn.classList.toggle('active', !isLost && btn.textContent.trim() === 'Unknown');
  });
}

function requiredValue(id, label, minLength = 2) {
  const el = document.getElementById(id);
  const value = el ? el.value.trim() : '';
  if (!value) throw new Error(`${label} is required.`);
  if (value.length < minLength) throw new Error(`${label} must be at least ${minLength} characters.`);
  return value;
}

function optionalValue(id, label, minLength = 2) {
  const el = document.getElementById(id);
  const value = el ? el.value.trim() : '';
  if (value && value.length < minLength) throw new Error(`${label} must be at least ${minLength} characters.`);
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

/* ── Save Draft (browser-local only) ────────────
   No backend draft concept exists (and adding one means a live schema
   migration + relaxing every required-field check in createReport()) — this
   just stashes the form's text fields in localStorage so closing the tab
   doesn't lose what you typed. The photo file itself isn't persisted. */
const DRAFT_STORAGE_PREFIX = 'bvetter_lf_draft_';

function draftFieldIds(kind) {
  if (kind === 'lost' || kind === 'found') {
    return ['petNameInput', 'speciesInput', 'breedInput', 'sizeInput', 'markingsInput', 'incidentDateInput', 'barangayInput', 'barangayOtherInput', 'notesInput', 'contactName', 'contactPhone', 'contactEmail'];
  }
  if (kind === 'claim') {
    return ['claimNameInput', 'claimPhoneInput', 'claimEmailInput'];
  }
  return [];
}

function saveDraft(kind) {
  const data = {};
  draftFieldIds(kind).forEach((fieldId) => {
    const field = document.getElementById(fieldId);
    if (field) data[fieldId] = field.value;
  });
  if (kind === 'lost' || kind === 'found') {
    const sexBtn = document.querySelector('#reportModal .sex-btn.active');
    if (sexBtn) data.__sex = sexBtn.textContent.trim();
  }
  if (kind === 'claim') {
    const proofBtn = document.querySelector('#claimModal .proof-option.active');
    if (proofBtn) data.__proof = proofBtn.textContent.trim();
  }
  try {
    localStorage.setItem(DRAFT_STORAGE_PREFIX + kind, JSON.stringify(data));
  } catch {
    // localStorage unavailable (private browsing quota, etc.) — draft just won't persist.
  }
}

function restoreDraft(kind) {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(DRAFT_STORAGE_PREFIX + kind) || 'null');
  } catch {
    data = null;
  }
  if (!data) return;

  draftFieldIds(kind).forEach((fieldId) => {
    const field = document.getElementById(fieldId);
    if (field && data[fieldId]) field.value = data[fieldId];
  });

  // Never restore "Unknown" onto a lost report — that button is hidden there
  // and the owner must pick Male/Female explicitly.
  if ((kind === 'lost' || kind === 'found') && data.__sex && !(kind === 'lost' && data.__sex === 'Unknown')) {
    document.querySelectorAll('#reportModal .sex-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.textContent.trim() === data.__sex);
    });
    updateCharCounter('notesInput', 'notesCounter');
  }
  if (kind === 'claim' && data.__proof) {
    document.querySelectorAll('#claimModal .proof-option').forEach((btn) => {
      btn.classList.toggle('active', btn.textContent.trim() === data.__proof);
    });
  }
}

function clearDraft(kind) {
  try {
    localStorage.removeItem(DRAFT_STORAGE_PREFIX + kind);
  } catch {
    // ignore
  }
}

async function handleSaveDraftClick(kind) {
  saveDraft(kind);
  await vbAlert('Draft saved on this device. It will be restored the next time you open this form here.');
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
    const petName = currentReportType === 'lost' ? (document.getElementById('petNameInput')?.value.trim() || '') : '';
    if (currentReportType === 'lost' && petName.length < 2) throw new Error('Pet name is required for lost pet reports (min. 2 characters).');

    const incidentDate = requiredValue('incidentDateInput', 'Date');
    assertDateNotFuture(incidentDate, 'Date');

    const contactPhone = requiredValue('contactPhone', 'Contact phone');
    assertValidPhone(contactPhone, 'Contact phone');

    const email = document.getElementById('contactEmail')?.value.trim();
    if (email) assertValidEmail(email, 'Contact email');

    const photo = document.getElementById('petPhoto')?.files?.[0];
    assertValidPhoto(photo, 'Pet photo', ['image/jpeg', 'image/png', 'image/webp']);

    if (currentReportType === 'lost') formData.append('pet_name', petName);
    formData.append('species', requiredValue('speciesInput', 'Type'));
    formData.append('breed', requiredValue('breedInput', 'Breed'));
    // Lost reports need an explicit Male/Female pick; found reports may leave
    // sex as Unknown, which is submitted blank and stored as NULL.
    const sexChoice = document.querySelector('#reportModal .sex-btn.active')?.textContent.trim() || '';
    if (currentReportType === 'lost' && (!sexChoice || sexChoice === 'Unknown')) {
      throw new Error("Please select your pet's sex.");
    }
    if (sexChoice && sexChoice !== 'Unknown') formData.append('sex', sexChoice);
    formData.append('size', requiredValue('sizeInput', 'Size'));
    formData.append('color_markings', requiredValue('markingsInput', 'Color / markings', 5));
    formData.append('incident_date', incidentDate);
    formData.append('barangay', requiredBarangayValue('barangayInput', 'barangayOtherInput', 'Barangay'));
    formData.append('lat', document.getElementById('reportLatInput')?.value || '');
    formData.append('lng', document.getElementById('reportLngInput')?.value || '');
    const notes = optionalValue('notesInput', 'Additional details', 5);
    if (notes) formData.append('notes', notes);
    formData.append('contact_name', requiredValue('contactName', 'Contact name'));
    formData.append('contact_phone', contactPhone);

    if (email) formData.append('contact_email', email);
    if (photo) formData.append('photo', photo);


    const submitBtn = document.querySelector('#reportModal .btn-submit');
    if (submitBtn) submitBtn.disabled = true;
    const result = await api.submitReport(currentReportType, formData);
    if (submitBtn) submitBtn.disabled = false;

    if (!result.success) throw new Error(result.message || 'Could not submit report.');
    clearDraft(currentReportType);
    closeModal('reportModal');
    await loadReports();
    await loadMyReports();
    setTimeout(() => openModalById(currentReportType === 'lost' ? 'lostSuccessModal' : 'foundSuccessModal'), 150);
  } catch (error) {
    await vbAlert(error.message);
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

// The clicked/owned report always renders in the LEFT ("owner") slot, regardless
// of whether it's a lost or found report — the counterpart candidate goes right.
function buildMatchCard(match, index, report) {
	const cls        = matchScoreClass(match.confidence);
	const barClass   = cls === 'high' ? 'lf-match-bar' : `lf-match-bar ${cls}-bar`;
	const isResolved = match.status === 'approved';
	const foundId    = match.found?.reportId || '';

	const ownerIsFound = normalizeType(report?.type) === 'found';
	const ownerPet    = ownerIsFound ? match.found : match.lost;
	const otherPet    = ownerIsFound ? match.lost : match.found;
	const ownerFallbackName = ownerIsFound ? 'Found Pet' : 'Lost Pet';
	const ownerTagClass = ownerIsFound ? 'found-tag' : 'lost-tag';
	const ownerTagText  = ownerIsFound ? 'Found (Your Report)' : 'Lost (Your Report)';
	const otherTagClass = ownerIsFound ? 'lost-tag' : 'found-tag';
	const otherTagText  = ownerIsFound ? 'Lost Pet Report' : 'Found Pet Report';

	// Similarity reason chips
	const simTagsHtml = (match.reasons || [])
		.map((reason) => `<span class="lf-sim-tag">${escapeHtml(reason)}</span>`)
		.join('');

	// Action buttons — hide claim button for already-resolved matches. Claimant
	// info for a resolved report is shown once at the panel level (see
	// matchesClaimantBlock in openMyReportMatches), not per-card, since a claim
	// can be approved directly without ever promoting this specific match row.
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

			<div class="lf-match-top">
				<span class="lf-match-label">Potential Match ${index + 1}</span>
				<div class="lf-match-score-wrap">
					<div class="lf-match-bar-track">
						<div class="${barClass}" data-width="${match.confidence}" style="width:0%"></div>
					</div>
					<span class="lf-match-pct ${cls}">${match.confidence}%</span>
				</div>
			</div>

			<div class="lf-match-pets">

				<div class="lf-match-pet-card owner">
					${expandableImg(ownerPet.image, ownerPet.name || ownerFallbackName, 'lf-match-pet-img', true)}
					<div class="lf-match-pet-info">
						<h4 class="lf-match-pet-name">
							${escapeHtml(ownerPet.name || report?.petName || report?.title || ownerFallbackName)}
						</h4>
						<p class="lf-match-pet-meta">${escapeHtml(ownerPet.breed || '')}</p>
						<p class="lf-match-pet-meta">${escapeHtml(ownerPet.location || '')}</p>
						<p class="lf-match-pet-meta">Reported: ${escapeHtml(formatDate(ownerPet.createdAt))}</p>
						<span class="lf-match-tag ${ownerTagClass}">${ownerTagText}</span>
					</div>
				</div>

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

				<div class="lf-match-pet-card admin">
					${expandableImg(otherPet.image, otherPet.name || 'Pet', 'lf-match-pet-img', true)}
					<div class="lf-match-pet-info">
						<h4 class="lf-match-pet-name">
							${escapeHtml(otherPet.name || 'Pet')}
						</h4>
						<p class="lf-match-pet-meta">${escapeHtml(otherPet.breed || '')}</p>
						<p class="lf-match-pet-meta">${escapeHtml(otherPet.location || '')}</p>
						<p class="lf-match-pet-meta">Reported: ${escapeHtml(formatDate(otherPet.createdAt))}</p>
						<span class="lf-match-tag ${otherTagClass}">${otherTagText}</span>
					</div>
				</div>

			</div>

			${simTagsHtml ? `<div class="lf-match-similarity-tags">${simTagsHtml}</div>` : ''}

			<div class="lf-match-actions${isResolved ? ' resolved' : ''}">${actionsHtml}</div>

		</div>
	`;
}

// Community sighting matched to the owner's lost report. Rendered separately from
// the lost/found match cards above — reached only via the "View Sighting Reports"
// toggle, since a sighting isn't a formal found report and can't be claimed. Owners
// only ever see a sighting once staff has already approved it (enforced server-side
// in listMatches()), so this is plain info, not a match to evaluate — no confidence
// score or "is this the same pet" comparison, that judgment call is staff's alone.
function buildSightingCard(match, index) {
	const sighting = match.found;
	const spottedDate = sighting.spottedDate || sighting.createdAt;

	const contactRows = [
		sighting.contactPhone ? `<a href="tel:${escapeHtml(sighting.contactPhone)}" class="pet-meta-item"><img src="../images/icons/report-phone.svg" alt="" class="meta-icon-sm"/> ${escapeHtml(sighting.contactPhone)}</a>` : '',
		sighting.contactEmail ? `<a href="mailto:${escapeHtml(sighting.contactEmail)}" class="pet-meta-item"><img src="../images/icons/report-mail.svg" alt="" class="meta-icon-sm"/> ${escapeHtml(sighting.contactEmail)}</a>` : '',
	].filter(Boolean).join('');

	return `
		<div class="lf-sighting-card" data-match-id="${escapeHtml(String(match.id))}">

			<div class="lf-sighting-card-head">
				<span class="lf-match-tag sighting-tag">Sighting Report ${index + 1}</span>
				<span class="lf-sighting-date">Spotted ${escapeHtml(formatDate(spottedDate))}</span>
			</div>

			<div class="lf-sighting-card-body">
				${expandableImg(sighting.image, 'Sighting photo', 'lf-sighting-photo', true)}

				<div class="lf-sighting-info">
					<p class="pet-meta-item"><img src="../images/icons/icon-location.svg" alt="" class="meta-icon-sm"/> ${escapeHtml(sighting.location || 'Location not provided')}</p>
					${sighting.notes ? `<p class="lf-sighting-notes">${escapeHtml(sighting.notes)}</p>` : ''}

					<div class="lf-sighting-contact">
						<span class="lf-sighting-contact-name">${escapeHtml(sighting.contactName || 'Community member')}</span>
						${contactRows || '<span class="lf-sighting-notes">No contact details were provided.</span>'}
					</div>
				</div>
			</div>

		</div>
	`;
}

let currentFoundMatches = [];
let currentSightingMatches = [];
let currentMatchesReport = null;
let sightingViewOpen = false;

// Bigger detail view of a single Potential Match card (formal lost-vs-found
// pairs only — sighting cards already show everything inline, there's nothing
// further to reveal). Reuses the same NOT MY PET / CLAIM THIS PET actions.
function openMatchDetail(matchId) {
	const match = currentFoundMatches.find((item) => String(item.id) === String(matchId));
	if (!match) return;
	renderMatchDetailBody(match);
	openModalById('matchDetailModal');
}

function renderMatchDetailBody(match) {
	const report = currentMatchesReport;
	const isResolved = match.status === 'approved';
	const foundId = match.found?.reportId || '';

	const ownerIsFound = normalizeType(report?.type) === 'found';
	const ownerPet = ownerIsFound ? match.found : match.lost;
	const otherPet = ownerIsFound ? match.lost : match.found;
	const ownerFallbackName = ownerIsFound ? 'Found Pet' : 'Lost Pet';
	const ownerTagClass = ownerIsFound ? 'found-tag' : 'lost-tag';
	const ownerTagText = ownerIsFound ? 'Found (Your Report)' : 'Lost (Your Report)';
	const otherTagClass = ownerIsFound ? 'lost-tag' : 'found-tag';
	const otherTagText = ownerIsFound ? 'Lost Pet Report' : 'Found Pet Report';

	const simTagsHtml = (match.reasons || [])
		.map((reason) => `<span class="lf-sim-tag">${escapeHtml(reason)}</span>`)
		.join('');

	// Only the counterpart's contact info is shown — you already know your own.
	const contactRows = [
		otherPet.contactPhone ? `<a href="tel:${escapeHtml(otherPet.contactPhone)}" class="pet-meta-item"><img src="../images/icons/report-phone.svg" alt="" class="meta-icon-sm"/> ${escapeHtml(otherPet.contactPhone)}</a>` : '',
		otherPet.contactEmail ? `<a href="mailto:${escapeHtml(otherPet.contactEmail)}" class="pet-meta-item"><img src="../images/icons/report-mail.svg" alt="" class="meta-icon-sm"/> ${escapeHtml(otherPet.contactEmail)}</a>` : '',
	].filter(Boolean).join('');

	const actionsHtml = isResolved
		? `<div class="lf-match-resolved-badge">✓ Resolved Match</div>`
		: `
			<button type="button" class="lfd-btn-notmine" onclick="handleNotMineModal('${match.id}')">NOT MY PET</button>
			<button type="button" class="lfd-btn-claim" onclick="handleClaimModal('${match.id}', '${foundId}')">CLAIM THIS PET</button>
		`;

	const subtitleEl = document.getElementById('matchDetailSubtitle');
	if (subtitleEl) subtitleEl.textContent = `${match.confidence}% match for ${report?.petName || report?.title || 'your report'}`;

	const body = document.getElementById('matchDetailBody');
	if (!body) return;
	body.innerHTML = `
		<div class="lf-match-pets lf-match-detail-pets">
			<div class="lf-match-pet-card owner">
				${expandableImg(ownerPet.image, ownerPet.name || ownerFallbackName, 'lf-match-pet-img')}
				<div class="lf-match-pet-info">
					<h4 class="lf-match-pet-name">${escapeHtml(ownerPet.name || report?.petName || report?.title || ownerFallbackName)}</h4>
					<p class="lf-match-pet-meta">${escapeHtml(ownerPet.breed || '')}</p>
					<p class="lf-match-pet-meta">${escapeHtml(ownerPet.location || '')}</p>
					<p class="lf-match-pet-meta">Reported: ${escapeHtml(formatDate(ownerPet.createdAt))}</p>
					<span class="lf-match-tag ${ownerTagClass}">${ownerTagText}</span>
				</div>
			</div>
			<div class="lf-match-vs">
				<div class="lf-match-vs-line"></div>
				<div class="lf-match-vs-icon">
					<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
						<path d="M3.5 7h7M7.5 4.5L10 7l-2.5 2.5" stroke="#737781" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</div>
				<div class="lf-match-vs-line"></div>
			</div>
			<div class="lf-match-pet-card admin">
				${expandableImg(otherPet.image, otherPet.name || 'Pet', 'lf-match-pet-img')}
				<div class="lf-match-pet-info">
					<h4 class="lf-match-pet-name">${escapeHtml(otherPet.name || 'Pet')}</h4>
					<p class="lf-match-pet-meta">${escapeHtml(otherPet.breed || '')}</p>
					<p class="lf-match-pet-meta">${escapeHtml(otherPet.location || '')}</p>
					<p class="lf-match-pet-meta">Reported: ${escapeHtml(formatDate(otherPet.createdAt))}</p>
					<span class="lf-match-tag ${otherTagClass}">${otherTagText}</span>
				</div>
			</div>
		</div>

		${simTagsHtml ? `<div class="lf-match-similarity-tags">${simTagsHtml}</div>` : ''}

		<div class="lf-match-detail-contact">
			<h4 class="details-section-title green">Contact Information</h4>
			<span class="lf-match-detail-contact-name">${escapeHtml(otherPet.contactName || 'Not provided')}</span>
			${contactRows ? `<div class="lf-match-detail-contact-rows">${contactRows}</div>` : '<p class="lf-match-detail-empty-contact">No contact details were provided.</p>'}
		</div>

		<div class="lf-match-actions${isResolved ? ' resolved' : ''}">${actionsHtml}</div>
	`;
}

function handleNotMineModal(matchId) {
	currentFoundMatches = currentFoundMatches.filter((match) => String(match.id) !== String(matchId));
	currentSightingMatches = currentSightingMatches.filter((match) => String(match.id) !== String(matchId));
	closeModal('matchDetailModal');
	// closeModal() unconditionally clears body scroll-lock — restore it since the
	// matches panel underneath is still open.
	if (document.getElementById('matchesPanelOverlay')?.classList.contains('open')) {
		document.body.style.overflow = 'hidden';
	}
	renderMatchesBody();
}

function handleClaimModal(matchId, foundId) {
	closeModal('matchDetailModal');
	handleClaim({ dataset: { foundId } });
}

function animateMatchBars(container) {
	requestAnimationFrame(() => {
		container.querySelectorAll('.lf-match-bar[data-width]').forEach((bar) => {
			bar.style.transition = 'width 0.65s cubic-bezier(0.25, 0.8, 0.25, 1)';
			bar.style.width = bar.dataset.width + '%';
		});
	});
}

// Renders either the found-report matches or the sighting matches for the
// currently open report, depending on `sightingViewOpen`.
function renderMatchesBody() {
	const body = document.querySelector('#matchesPanel .matches-panel-body');
	const emptyEl = document.getElementById('noMatchesState');
	const toggleRow = document.getElementById('sightingToggleRow');
	const toggleBtn = document.getElementById('viewSightingsBtn');
	if (!body) return;

	body.querySelectorAll('.lf-match-card, .lf-sighting-card').forEach((card) => card.remove());

	if (toggleRow) toggleRow.style.display = currentSightingMatches.length ? 'flex' : 'none';
	if (toggleBtn) {
		toggleBtn.textContent = sightingViewOpen
			? '← Back to Potential Matches'
			: `View Sighting Reports (${currentSightingMatches.length})`;
	}

	const claimant = myReportClaimants[currentMatchesReport?.id];
	const list = sightingViewOpen ? currentSightingMatches : currentFoundMatches;
	const builder = sightingViewOpen ? buildSightingCard : buildMatchCard;

	if (emptyEl) {
		const showEmpty = !list.length;
		emptyEl.style.display = showEmpty ? 'flex' : 'none';
		if (showEmpty) {
			const titleEl = emptyEl.querySelector('h3');
			const descEl = emptyEl.querySelector('p');
			if (sightingViewOpen) {
				if (titleEl) titleEl.textContent = 'No Sighting Reports';
				if (descEl) descEl.textContent = 'No community sightings have been reported for this pet yet.';
			} else if (currentMatchesReport?.status === 'resolved') {
				if (titleEl) titleEl.textContent = 'Case Resolved';
				if (descEl) descEl.textContent = claimant
					? 'This report has been resolved and the pet was claimed.'
					: 'This report has been marked as resolved.';
			} else {
				if (titleEl) titleEl.textContent = 'No More Matches';
				if (descEl) descEl.textContent = 'The system will notify you when new found pets are reported in your area.';
			}
		}
	}

	if (list.length) {
		const cardsHtml = list.map((match, i) => builder(match, i, currentMatchesReport)).join('');
		if (emptyEl) {
			emptyEl.insertAdjacentHTML('beforebegin', cardsHtml);
		} else {
			body.insertAdjacentHTML('beforeend', cardsHtml);
		}
		animateMatchBars(body);
	}
}

function toggleSightingView() {
	sightingViewOpen = !sightingViewOpen;
	renderMatchesBody();
}

async function openMyReportMatches(reportId) {
	// Find the owner's report for name/breed fallbacks
	const report = myReports.find((item) => String(item.id) === String(reportId));
	currentMatchesReport = report;
	sightingViewOpen = false;

	// Update the panel subtitle with the pet's name
	const nameEl = document.getElementById('matchesPetName');
	if (nameEl) {
		nameEl.textContent = report?.petName || report?.title || `Report #${reportId}`;
	}

	// Claimant info is shown once at the panel level, independent of whether any
	// match card exists — a claim can be approved directly (without ever
	// promoting a lost_found_matches row), so this can't rely on match data.
	const claimant = myReportClaimants[reportId];
	const claimantBlock = document.getElementById('matchesClaimantBlock');
	if (claimantBlock) {
		if (claimant) {
			document.getElementById('matchesClaimantName').textContent = claimant.name;
			document.getElementById('matchesClaimantContact').textContent = claimant.phone || claimant.email || '';
			claimantBlock.style.display = 'flex';
		} else {
			claimantBlock.style.display = 'none';
		}
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

	// Potential Matches only ever shows lost-vs-found report pairs. Sighting-based
	// candidates (found.sightingId set, found.reportId null) are kept out of this
	// list and surfaced instead behind the "View Sighting Reports" toggle.
	currentFoundMatches = matches.filter((match) => match.found?.reportId);
	currentSightingMatches = matches.filter((match) => !match.found?.reportId && match.found?.sightingId);

	renderMatchesBody();

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
  const matchId = btn?.dataset?.matchId;
  if (matchId) {
    currentFoundMatches = currentFoundMatches.filter((match) => String(match.id) !== String(matchId));
    currentSightingMatches = currentSightingMatches.filter((match) => String(match.id) !== String(matchId));
  }
  btn.closest('.lf-match-card')?.remove();
}

async function handleClaim(btn) {
  const foundId = btn?.dataset?.foundId || '';
  if (foundId) currentClaimReportId = foundId;
  if (!currentClaimReportId) {
    await vbAlert('Only found pet reports can be claimed. Please contact the clinic for sighting reports.');
    return;
  }
  openClaimModal();
}

// General "mark resolved" action reachable straight from the report card —
// covers a Lost pet coming home on its own, or a Found pet being reunited
// with its owner outside the app, with no sighting/claim flow involved at all.
async function handleResolveOwnReport(reportId) {
  const report = myReports.find((item) => String(item.id) === String(reportId));
  const isFound = normalizeType(report?.type) === 'found';
  const confirmMsg = isFound
    ? 'Mark this case as resolved? This will remove it from the active found pets list.'
    : 'Mark this case as resolved? This will remove it from the active lost pets list.';
  if (!(await vbConfirm(confirmMsg, 'Mark Resolved'))) return;

  const result = await api.resolveOwnReport(reportId);
  if (!result.success) {
    await vbAlert(result.message || 'Could not resolve this report.');
    return;
  }

  await loadReports();
  await loadMyReports();
  await vbAlert(isFound ? 'Marked as resolved. Thanks for helping reunite this pet!' : 'Marked as resolved. Glad you got your pet back!');
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
    await vbAlert('Your session has expired. Please log in again before submitting a sighting.');
    return;
  }

  const formData = new FormData();
  if (currentReportId) formData.append('report_id', currentReportId);

  let date, barangay, location, notes, photo;
  try {
    date = requiredValue('sightingDateInput', 'Date spotted', 1);
    assertDateNotFuture(date, 'Date spotted');
    barangay = requiredBarangayValue('sightingBarangayInput', 'sightingBarangayOtherInput', 'Barangay');
    location = requiredValue('sightingLocationInput', 'Specific landmark', 5);
    notes = optionalValue('sightingNotesInput', 'Additional details', 5);
    photo = document.getElementById('sightingPhoto')?.files?.[0];
    assertValidPhoto(photo, 'Sighting photo', ['image/jpeg', 'image/png', 'image/webp']);
  } catch (error) {
    await vbAlert(error.message);
    return;
  }

  formData.append('sighting_date', date);
  formData.append('barangay', barangay);
  formData.append('location_text', location);
  formData.append('lat', document.getElementById('sightingLatInput')?.value || '');
  formData.append('lng', document.getElementById('sightingLngInput')?.value || '');
  formData.append('notes', notes);
  if (photo) formData.append('photo', photo);

  const sightingContactName = document.getElementById('sightingContactName')?.value.trim();
  const sightingContactPhone = document.getElementById('sightingContactPhone')?.value.trim();
  const sightingContactEmail = document.getElementById('sightingContactEmail')?.value.trim();
  if (sightingContactName) formData.append('contact_name', sightingContactName);
  if (sightingContactPhone) formData.append('contact_phone', sightingContactPhone);
  if (sightingContactEmail) formData.append('contact_email', sightingContactEmail);

  const result = await api.submitSighting(formData);
  if (!result.success) {
    await vbAlert(result.message || 'Could not submit sighting.');
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
    restoreDraft('claim');
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
    await vbAlert('Your session has expired. Please log in again before submitting a claim.');
    return;
  }

  if (!currentClaimReportId) {
    await vbAlert('Please select a found report first.');
    return;
  }

  const modal = document.getElementById('claimModal');
  const formData = new FormData();
  let claimantName, claimantPhone, claimantEmail, file;
  try {
    claimantName = requiredValue('claimNameInput', 'Full name');
    claimantPhone = requiredValue('claimPhoneInput', 'Phone number', 1);
    assertValidPhone(claimantPhone, 'Phone number');
    claimantEmail = requiredValue('claimEmailInput', 'Email address', 1);
    assertValidEmail(claimantEmail, 'Email address');
    file = document.getElementById('claimDoc')?.files?.[0];
    if (!file) throw new Error('Please upload a proof of ownership document.');
    assertValidPhoto(file, 'Proof document', ['image/jpeg', 'image/png', 'application/pdf']);
  } catch (error) {
    await vbAlert(error.message);
    return;
  }

  formData.append('claimant_name', claimantName);
  formData.append('claimant_phone', claimantPhone);
  formData.append('claimant_email', claimantEmail);
  formData.append('proof_type', modal.querySelector('.proof-option.active')?.textContent.trim() || 'Photo Evidence');
  formData.append('proof_file', file);

  const result = await api.submitClaim(currentClaimReportId, formData);
  if (!result.success) {
    await vbAlert(result.message || 'Could not submit claim.');
    return;
  }
  clearDraft('claim');
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

async function toggleSightingAccountInfo() {
  const toggle = document.getElementById('sightingAccountToggle');
  const isOn = toggle.classList.toggle('on');
  const session = sessionUser();
  if (!isOn) {
    document.getElementById('sightingContactName').value = '';
    document.getElementById('sightingContactPhone').value = '';
    document.getElementById('sightingContactEmail').value = '';
    return;
  }

  document.getElementById('sightingContactName').value = session?.name || '';
  document.getElementById('sightingContactPhone').value = session?.phone || '';
  document.getElementById('sightingContactEmail').value = session?.email || '';

  // localStorage can be stale (e.g. session created before the account's
  // email was set/changed), so pull the current profile from the server too.
  try {
    const result = await api.getProfile();
    if (result?.success && toggle.classList.contains('on')) {
      document.getElementById('sightingContactName').value = result.data.fullName || session?.name || '';
      document.getElementById('sightingContactPhone').value = result.data.phone || session?.phone || '';
      document.getElementById('sightingContactEmail').value = result.data.email || session?.email || '';
    }
  } catch {
    // Keep the session-derived values already filled in above.
  }
}

async function toggleClaimAccountInfo() {
  const toggle = document.getElementById('claimAccountToggle');
  const isOn = toggle.classList.toggle('on');
  const session = sessionUser();
  if (!isOn) {
    document.getElementById('claimNameInput').value = '';
    document.getElementById('claimPhoneInput').value = '';
    document.getElementById('claimEmailInput').value = '';
    return;
  }

  document.getElementById('claimNameInput').value = session?.name || '';
  document.getElementById('claimPhoneInput').value = session?.phone || '';
  document.getElementById('claimEmailInput').value = session?.email || '';

  // localStorage can be stale (e.g. session created before the account's
  // email was set/changed), so pull the current profile from the server too.
  try {
    const result = await api.getProfile();
    if (result?.success && toggle.classList.contains('on')) {
      document.getElementById('claimNameInput').value = result.data.fullName || session?.name || '';
      document.getElementById('claimPhoneInput').value = result.data.phone || session?.phone || '';
      document.getElementById('claimEmailInput').value = result.data.email || session?.email || '';
    }
  } catch {
    // Keep the session-derived values already filled in above.
  }
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

  // Keep whichever view (All/Lost/Found grid, or My Reports) is currently
  // visible in sync without a manual page reload.
  if (typeof startPolling === 'function') {
    startPolling((opts) => {
      const myReportsSection = document.getElementById('myReportsSection');
      return (myReportsSection && myReportsSection.style.display !== 'none')
        ? loadMyReports(opts)
        : loadReports(opts);
    }, 15000);
  }
});

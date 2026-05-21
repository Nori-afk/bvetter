'use strict';

let claims = [];
let activeStatus = 'all';

const FALLBACK_IMAGE = '../images/img/upload-pet.png';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function formatDate(value) {
  if (!value) return 'No date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function toggleUserMenu() {
  document.getElementById('userDropdown')?.classList.toggle('open');
}

document.addEventListener('click', function (event) {
  const pill = document.querySelector('.nav-user-pill');
  const dropdown = document.getElementById('userDropdown');
  if (dropdown && !pill?.contains(event.target) && !dropdown.contains(event.target)) {
    dropdown.classList.remove('open');
  }
});

function logout() {
  if (window.VBetterAuth) window.VBetterAuth.logout();
  else window.location.href = 'login.html';
}

async function loadClaims() {
  const table = document.querySelector('.mc-table');
  if (table) table.innerHTML = '<div class="mc-table-row"><span class="mc-cell">Loading claims...</span></div>';

  const filters = activeStatus === 'all' ? {} : { status: activeStatus };
  const result = await api.getClaims(filters);
  claims = result.success ? (result.data || []) : [];
  renderClaims();
  renderStats();
}

function renderStats() {
  const total = claims.length;
  const approved = claims.filter((claim) => claim.status === 'approved' || claim.status === 'resolved').length;
  const pending = claims.filter((claim) => claim.status === 'pending').length;
  const stats = document.querySelectorAll('.mc-hero-stat-num');
  if (stats[0]) stats[0].textContent = total;
  if (stats[1]) stats[1].textContent = approved;
  if (stats[2]) stats[2].textContent = pending;
}

function renderClaims() {
  const table = document.querySelector('.mc-table');
  if (!table) return;

  table.innerHTML = `
    <div class="mc-table-header">
      <span>PET</span>
      <span>DATE FILED</span>
      <span>UPLOADED BY</span>
      <span>STATUS</span>
      <span>ACTION</span>
    </div>
    ${claims.length ? claims.map(renderClaimRow).join('') : '<div class="mc-table-row"><span class="mc-cell">No claims found.</span></div>'}
  `;

  document.getElementById('claimsShowing').textContent = claims.length
    ? `Showing 1 to ${claims.length} of ${claims.length} result${claims.length === 1 ? '' : 's'}`
    : 'No claims found';
}

function renderClaimRow(claim) {
  const status = claim.status || 'pending';
  const petName = claim.pet_name || 'Found Pet Report';
  return `
    <div class="mc-table-row" data-status="${escapeHtml(status)}" data-claim="${claim.id}" onclick="openClaimDetail('${claim.id}')">
      <div class="mc-pet-cell">
        <img src="${escapeHtml(claim.photo_path || FALLBACK_IMAGE)}" alt="${escapeHtml(petName)}" class="mc-pet-thumb"/>
        <div class="mc-pet-info">
          <span class="mc-pet-name">${escapeHtml(petName)}</span>
          <span class="mc-pet-breed">${escapeHtml(claim.barangay_name || 'Baliwag')}</span>
        </div>
      </div>
      <span class="mc-cell mc-date">${escapeHtml(formatDate(claim.created_at))}</span>
      <span class="mc-cell">${escapeHtml(claim.claimant_name || 'You')}</span>
      <span class="mc-cell"><span class="mc-status-badge ${escapeHtml(status)}">${escapeHtml(status)}</span></span>
      <span class="mc-cell">
        <button type="button" class="mc-action-btn ${escapeHtml(status)}" onclick="event.stopPropagation(); openClaimDetail('${claim.id}')">
          ${status === 'approved' ? 'View Claim Instructions' : 'View Details'}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6h7M6.5 3.5L9 6l-2.5 2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </span>
    </div>
  `;
}

function filterClaims(status) {
  activeStatus = status;
  loadClaims();
}

function openClaimDetail(claimId) {
  const claim = claims.find((item) => String(item.id) === String(claimId));
  if (!claim) return;

  removeDynamicDetails();
  document.body.insertAdjacentHTML('beforeend', buildDetailPanel(claim));
  document.getElementById(`detailClaim${claim.id}`)?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function buildDetailPanel(claim) {
  const status = claim.status || 'pending';
  const approved = status === 'approved' || status === 'resolved';
  const petName = claim.pet_name || 'Found Pet Report';
  return `
    <div class="mc-detail-overlay dynamic-claim-detail" id="detailClaim${claim.id}" onclick="closeDetailOutside(event,'detailClaim${claim.id}')">
      <div class="mc-detail-panel" role="dialog" aria-modal="true" aria-label="Claim detail">
        <div class="mc-detail-panel-header">
          <div>
            <h2 class="mc-detail-panel-title">Claim Details</h2>
            <span class="mc-detail-panel-sub">Case ${escapeHtml(claim.case_number || claim.report_case || claim.id)} - ${escapeHtml(petName)}</span>
          </div>
          <button type="button" class="mc-detail-close" onclick="closeDetail('detailClaim${claim.id}')" aria-label="Close panel">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="#424750" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="mc-detail-body">
          <div class="${approved ? 'mc-approved-banner' : 'mc-pending-banner'}">
            <div class="${approved ? 'mc-approved-check' : 'mc-pending-icon'}"></div>
            <div>
              <h3 class="${approved ? 'mc-approved-title' : 'mc-pending-title'}">${approved ? 'Claim Approved' : status === 'rejected' ? 'Claim Rejected' : 'Claim Under Review'}</h3>
              <p class="${approved ? 'mc-approved-sub' : 'mc-pending-sub'}">${approved ? 'Your claim has been verified. Coordinate safely before marking this case resolved.' : 'Your claim is being reviewed by the vet management team.'}</p>
            </div>
          </div>
          <div class="mc-detail-cols">
            <div class="mc-detail-left">
              <div class="mc-instructions-header">
                <span class="mc-instructions-label">${approved ? 'Claim Instructions' : 'Review Details'}</span>
                <span class="mc-case-id-badge">CASE ${escapeHtml(claim.case_number || claim.id)}</span>
              </div>
              <div class="mc-steps">
                <div class="mc-step">
                  <div class="mc-step-num">1</div>
                  <div class="mc-step-content">
                    <h4 class="mc-step-title">${approved ? 'Contact the clinic or uploader' : 'Wait for vet review'}</h4>
                    <p class="mc-step-desc">${approved ? 'Bring your proof of ownership and coordinate the safe handover.' : 'Your submitted proof and notes are visible to vet management.'}</p>
                  </div>
                </div>
                <div class="mc-step-connector"></div>
                <div class="mc-step">
                  <div class="mc-step-num pending-num">2</div>
                  <div class="mc-step-content">
                    <h4 class="mc-step-title">Proof Type</h4>
                    <p class="mc-step-desc">${escapeHtml(claim.proof_type || 'Not specified')}</p>
                  </div>
                </div>
                <div class="mc-step-connector"></div>
                <div class="mc-step">
                  <div class="mc-step-num pending-num">3</div>
                  <div class="mc-step-content">
                    <h4 class="mc-step-title">Notes</h4>
                    <p class="mc-step-desc">${escapeHtml(claim.proof_notes || claim.review_notes || 'No notes provided.')}</p>
                  </div>
                </div>
              </div>
              ${approved && status !== 'resolved' ? `<button type="button" class="mc-resolve-btn" onclick="handleResolved('${claim.id}')">Mark as Resolved</button>` : ''}
            </div>
            <div class="mc-detail-right">
              <div class="mc-found-pet-card">
                <div class="mc-found-pet-img-wrap">
                  <img src="${escapeHtml(claim.photo_path || FALLBACK_IMAGE)}" alt="${escapeHtml(petName)}" class="mc-found-pet-img"/>
                  <span class="mc-found-pet-badge">FOUND PET</span>
                </div>
                <div class="mc-found-pet-details">
                  <h3 class="mc-found-pet-name">${escapeHtml(petName)}</h3>
                  <div class="mc-found-detail-row"><span class="mc-found-detail-label">Date Filed</span><span class="mc-found-detail-value">${escapeHtml(formatDate(claim.created_at))}</span></div>
                  <div class="mc-found-detail-row"><span class="mc-found-detail-label">Location</span><span class="mc-found-detail-value">${escapeHtml(claim.barangay_name || 'Baliwag')}</span></div>
                  <div class="mc-found-detail-row"><span class="mc-found-detail-label">Status</span><span class="mc-found-detail-value">${escapeHtml(status)}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function removeDynamicDetails() {
  document.querySelectorAll('.dynamic-claim-detail').forEach((el) => el.remove());
}

function closeDetail(panelId) {
  document.getElementById(panelId)?.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(removeDynamicDetails, 200);
}

function closeDetailOutside(event, panelId) {
  if (event.target === document.getElementById(panelId)) closeDetail(panelId);
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

async function handleResolved(claimId) {
  const panelId = `detailClaim${claimId}`;
  closeDetail(panelId);
  const result = await api.resolveClaim(claimId);
  if (!result.success) {
    alert(result.message || 'Could not resolve claim.');
    return;
  }
  await loadClaims();
  setTimeout(() => openModalById('resolvedModal'), 220);
}

document.addEventListener('keydown', function (event) {
  if (event.key !== 'Escape') return;
  document.querySelectorAll('.mc-detail-overlay.open, .modal-overlay.open').forEach((el) => el.classList.remove('open'));
  document.body.style.overflow = '';
  setTimeout(removeDynamicDetails, 200);
});

document.addEventListener('DOMContentLoaded', async function () {
  await loadClaims();
  const params = new URLSearchParams(window.location.search);
  const openId = params.get('open');
  if (openId) openClaimDetail(openId);
});

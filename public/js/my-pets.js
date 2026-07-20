'use strict';

let myPets = [];

const MP_FALLBACK_IMAGE = '../images/img/upload-pet.png';

function escapeHtmlPets(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function logout() {
  if (window.VBetterAuth) window.VBetterAuth.logout();
  else window.location.href = 'login.html';
}

async function loadMyPets() {
  const grid = document.getElementById('mpGrid');
  if (grid) grid.innerHTML = '<p class="mp-empty">Loading your pets&hellip;</p>';

  const result = await api.getMyPets().catch(() => ({ success: false, data: [] }));
  myPets = result.success && Array.isArray(result.data) ? result.data : [];

  renderPetsGrid();

  const totalEl = document.getElementById('mpTotalPets');
  if (totalEl) totalEl.textContent = String(myPets.length);

  const params = new URLSearchParams(window.location.search);
  const petId = params.get('petId');
  if (petId && myPets.some((pet) => String(pet.id) === String(petId))) {
    openPetDetail(petId);
  }
}

function petStatusBadgeClass(statusType) {
  if (statusType === 'warning') return 'mp-badge-warning';
  if (statusType === 'danger') return 'mp-badge-danger';
  return 'mp-badge-success';
}

function renderPetsGrid() {
  const grid = document.getElementById('mpGrid');
  if (!grid) return;

  if (!myPets.length) {
    grid.innerHTML = `
      <div class="mp-empty-state">
        <img src="../images/icons/icon-pawprint.svg" alt="" class="mp-empty-icon"/>
        <h3>No pets on file yet</h3>
        <p>Pets registered by the clinic or through a booked appointment will appear here automatically once they're linked to your account.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = myPets.map(renderPetCard).join('');
}

function renderPetCard(pet) {
  const breed = [pet.species, pet.breed].filter(Boolean).join(' · ');
  return `
    <div class="mp-card" onclick="openPetDetail('${pet.id}')">
      <img src="${escapeHtmlPets(pet.photo || MP_FALLBACK_IMAGE)}" alt="${escapeHtmlPets(pet.petName)}" class="mp-card-img"/>
      <div class="mp-card-body">
        <div class="mp-card-top">
          <h3 class="mp-card-name">${escapeHtmlPets(pet.petName)}</h3>
          <span class="mp-badge ${petStatusBadgeClass(pet.statusType)}">${escapeHtmlPets(pet.healthStatus || pet.status)}</span>
        </div>
        <p class="mp-card-breed">${escapeHtmlPets(breed || 'Species not set')}</p>
        <div class="mp-card-meta">
          <span>${escapeHtmlPets(pet.sex || '')}${pet.age ? ' · ' + escapeHtmlPets(pet.age) : ''}</span>
          <span>${pet.lastVisit ? 'Last visit ' + escapeHtmlPets(pet.lastVisit) : 'No visits yet'}</span>
        </div>
      </div>
    </div>
  `;
}

async function openPetDetail(petId) {
  const overlay = document.getElementById('mpDetailOverlay');
  const body = document.getElementById('mpDetailBody');
  const nameEl = document.getElementById('mpDetailName');
  const subEl = document.getElementById('mpDetailSub');
  if (!overlay || !body) return;

  nameEl.textContent = 'Loading…';
  subEl.textContent = '';
  body.innerHTML = '<p class="mp-empty">Loading pet record&hellip;</p>';
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  const result = await api.getMyPet(petId).catch(() => ({ success: false }));
  if (!result.success) {
    body.innerHTML = '<p class="mp-empty">Could not load this pet\'s record.</p>';
    return;
  }

  renderPetDetail(result.data);
}

function renderPetDetail(pet) {
  const nameEl = document.getElementById('mpDetailName');
  const subEl = document.getElementById('mpDetailSub');
  const body = document.getElementById('mpDetailBody');
  if (!body) return;

  const breed = [pet.species, pet.breed].filter(Boolean).join(' · ');
  nameEl.textContent = pet.petName || 'Pet';
  subEl.textContent = breed || 'Pet profile';

  const visits = Array.isArray(pet.visitHistory) ? pet.visitHistory : [];
  const vaccinations = Array.isArray(pet.vaccinationHistory) ? pet.vaccinationHistory : [];

  body.innerHTML = `
    <div class="mp-detail-profile">
      <img src="${escapeHtmlPets(pet.photo || MP_FALLBACK_IMAGE)}" alt="" class="mp-detail-profile-img"/>
      <div class="mp-detail-profile-info">
        <span class="mp-badge ${petStatusBadgeClass(pet.statusType)}">${escapeHtmlPets(pet.healthStatus || pet.status)}</span>
        <div class="mp-detail-profile-grid">
          <div><span class="mp-detail-label">Species</span><span class="mp-detail-value">${escapeHtmlPets(pet.species || '—')}</span></div>
          <div><span class="mp-detail-label">Breed</span><span class="mp-detail-value">${escapeHtmlPets(pet.breed || '—')}</span></div>
          <div><span class="mp-detail-label">Sex</span><span class="mp-detail-value">${escapeHtmlPets(pet.sex || '—')}</span></div>
          <div><span class="mp-detail-label">Age</span><span class="mp-detail-value">${escapeHtmlPets(pet.age || '—')}</span></div>
          <div><span class="mp-detail-label">Weight</span><span class="mp-detail-value">${escapeHtmlPets(pet.weight || '—')}</span></div>
          <div><span class="mp-detail-label">Markings</span><span class="mp-detail-value">${escapeHtmlPets(pet.colorMarkings || '—')}</span></div>
        </div>
      </div>
    </div>

    <div class="mp-detail-section">
      <h3 class="mp-detail-section-title">Visit History</h3>
      ${visits.length ? `<div class="mp-timeline">${visits.map(renderVisitItem).join('')}</div>` : '<p class="mp-empty">No visits recorded yet.</p>'}
    </div>

    <div class="mp-detail-section">
      <h3 class="mp-detail-section-title">Vaccination History</h3>
      ${vaccinations.length ? `<div class="mp-vacc-list">${vaccinations.map(renderVaccinationItem).join('')}</div>` : '<p class="mp-empty">No vaccination records yet.</p>'}
    </div>
  `;
}

function renderVisitItem(visit) {
  return `
    <div class="mp-timeline-item">
      <div class="mp-timeline-dot"></div>
      <div class="mp-timeline-content">
        <div class="mp-timeline-top">
          <span class="mp-timeline-title">${escapeHtmlPets(visit.title)}</span>
          <span class="mp-timeline-date">${escapeHtmlPets(visit.date)}</span>
        </div>
        ${visit.attendingVet ? `<p class="mp-timeline-vet">Attending: ${escapeHtmlPets(visit.attendingVet)}</p>` : ''}
        ${visit.diagnosis ? `<p class="mp-timeline-diag"><strong>Diagnosis:</strong> ${escapeHtmlPets(visit.diagnosis)}</p>` : ''}
        ${visit.treatment ? `<p class="mp-timeline-diag"><strong>Treatment:</strong> ${escapeHtmlPets(visit.treatment)}</p>` : ''}
        ${visit.symptoms ? `<p class="mp-timeline-diag"><strong>Symptoms:</strong> ${escapeHtmlPets(visit.symptoms)}</p>` : ''}
      </div>
    </div>
  `;
}

function renderVaccinationItem(vacc) {
  return `
    <div class="mp-vacc-item">
      <div>
        <span class="mp-vacc-name">${escapeHtmlPets(vacc.name)}</span>
        <span class="mp-vacc-meta">Given ${escapeHtmlPets(vacc.date)} · Next due ${escapeHtmlPets(vacc.nextDue)}</span>
      </div>
      <span class="mp-badge mp-badge-success">${escapeHtmlPets(vacc.status)}</span>
    </div>
  `;
}

function closePetDetail() {
  const overlay = document.getElementById('mpDetailOverlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';

  const params = new URLSearchParams(window.location.search);
  if (params.has('petId')) {
    params.delete('petId');
    const query = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
  }
}

function closePetDetailOutside(event) {
  if (event.target === document.getElementById('mpDetailOverlay')) closePetDetail();
}

document.addEventListener('DOMContentLoaded', loadMyPets);

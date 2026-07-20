/* =============================================
   BVETTER — Account Profile JS
   File: js/account-profile.js
   Depends: nav.js (nav pill + buildOwnerNotifications), api.js

   On load:
   - api.getProfile()   → hero name/avatar, member-since
   - api.getMyReports() → active lost-report count
   - api.getClaims()    → pending claim count
   - api.getAppointments() → upcoming appointment count
   - buildOwnerNotifications() (from nav.js) → Recent Activity list,
     same appointment/claim/report data that feeds the bell dropdown
   ============================================= */

function escapeHtmlProfile(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

/* Maps a buildOwnerNotifications() item to activity-card visuals.
   id prefixes come from nav.js: 'appt-', 'claim-', 'report-'.        */
function activityCardMeta(item) {
  if (item.id.startsWith('appt-')) {
    const pending = item.title.includes('Awaiting');
    return {
      dotClass: 'blue-dot',
      icon: 'profile-report-submitted.svg',
      refLabel: 'Appointment',
      badgeClass: pending ? 'badge-pending' : 'badge-review',
      badgeText: pending ? 'PENDING' : 'UPCOMING'
    };
  }
  if (item.id.startsWith('claim-')) {
    return {
      dotClass: 'teal-dot',
      icon: 'profile-report-verification.svg',
      refLabel: 'Claim',
      badgeClass: item.title.includes('Approved') ? 'badge-approved' : item.title.includes('Rejected') ? 'badge-rejected' : 'badge-completed',
      badgeText: item.title.includes('Approved') ? 'APPROVED' : item.title.includes('Rejected') ? 'REJECTED' : 'RESOLVED'
    };
  }
  if (item.id.startsWith('report-')) {
    return {
      dotClass: 'green-dot',
      icon: 'profile-appointment-completed.svg',
      refLabel: 'Report',
      badgeClass: item.title.includes('Approved') ? 'badge-approved' : item.title.includes('Rejected') ? 'badge-rejected' : 'badge-completed',
      badgeText: item.title.includes('Approved') ? 'APPROVED' : item.title.includes('Rejected') ? 'REJECTED' : 'RESOLVED'
    };
  }
  return { dotClass: 'blue-dot', icon: 'profile-report-submitted.svg', refLabel: 'Update', badgeClass: 'badge-review', badgeText: 'INFO' };
}

const ACTIVITY_PAGE_SIZE = 5;
let activityItems = [];
let activityPage = 1;

function renderActivityPage() {
  const list = document.getElementById('activityList');
  const pagination = document.getElementById('activityPagination');
  if (!list) return;

  if (!activityItems.length) {
    list.innerHTML = '<p class="activity-empty">No recent activity yet.</p>';
    if (pagination) pagination.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(activityItems.length / ACTIVITY_PAGE_SIZE);
  activityPage = Math.max(1, Math.min(activityPage, totalPages));
  const start = (activityPage - 1) * ACTIVITY_PAGE_SIZE;
  const pageItems = activityItems.slice(start, start + ACTIVITY_PAGE_SIZE);

  list.innerHTML = pageItems.map((item) => {
    const meta = activityCardMeta(item);
    const ref = item.id.replace(/^(\w+)-/, '').toUpperCase();
    return `
      <div class="activity-card">
        <div class="activity-card-top">
          <div class="activity-left">
            <div class="activity-dot-wrap ${meta.dotClass}">
              <img src="../images/icons/${meta.icon}" alt="" class="activity-dot-icon"/>
            </div>
            <div class="activity-meta">
              <div class="activity-title">${escapeHtmlProfile(item.title)}</div>
              <div class="activity-ref">${meta.refLabel} ID: #${escapeHtmlProfile(ref)}</div>
            </div>
          </div>
          <span class="activity-badge ${meta.badgeClass}">${meta.badgeText}</span>
        </div>
        <div class="activity-body">
          <p class="activity-desc">${escapeHtmlProfile(item.detail)}</p>
          <span class="activity-time">${escapeHtmlProfile(item.time)}</span>
        </div>
      </div>
    `;
  }).join('');

  if (!pagination) return;
  if (totalPages <= 1) {
    pagination.innerHTML = '';
    return;
  }

  const pageButtons = Array.from({ length: totalPages }, (_, i) => i + 1)
    .map((page) => `<button type="button" class="activity-page-btn${page === activityPage ? ' active' : ''}" data-page="${page}">${page}</button>`)
    .join('');

  pagination.innerHTML = `
    <button type="button" class="activity-page-btn" data-page="${activityPage - 1}" ${activityPage === 1 ? 'disabled' : ''}>&lsaquo;</button>
    ${pageButtons}
    <button type="button" class="activity-page-btn" data-page="${activityPage + 1}" ${activityPage === totalPages ? 'disabled' : ''}>&rsaquo;</button>
  `;

  pagination.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activityPage = Number(btn.getAttribute('data-page'));
      renderActivityPage();
    });
  });
}

async function renderRecentActivity() {
  const list = document.getElementById('activityList');
  if (!list || typeof buildOwnerNotifications !== 'function') return;

  const items = await buildOwnerNotifications().catch(() => []);
  activityItems = items.filter((item) => item.id !== 'empty');
  activityPage = 1;
  renderActivityPage();
}

const PET_STATUS_BADGE = {
  success: 'badge-approved',
  warning: 'badge-pending',
  danger: 'badge-rejected'
};

function renderPetsRow(pets) {
  const row = document.getElementById('petsRow');
  if (!row) return;

  if (!pets.length) {
    row.innerHTML = '<p class="pets-empty">You don\'t have any pets on file yet. Pets registered with the clinic will appear here automatically.</p>';
    return;
  }

  row.innerHTML = pets.map((pet) => {
    const badgeClass = PET_STATUS_BADGE[pet.statusType] || 'badge-review';
    const breed = [pet.species, pet.breed].filter(Boolean).join(' · ');
    return `
      <a class="pet-mini-card" href="my-pets.html?petId=${encodeURIComponent(pet.id)}">
        <img src="${pet.photo || '../images/img/upload-pet.png'}" alt="" class="pet-mini-avatar"/>
        <div class="pet-mini-info">
          <div class="pet-mini-name">${escapeHtmlProfile(pet.petName)}</div>
          <div class="pet-mini-breed">${escapeHtmlProfile(breed)}</div>
          <span class="pet-mini-badge ${badgeClass}">${escapeHtmlProfile(pet.healthStatus || pet.status)}</span>
        </div>
      </a>
    `;
  }).join('');
}

async function loadAccountProfile() {
  const session = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (!session) return;

  const [profileResult, reportsResult, claimsResult, appointmentsResult, petsResult] = await Promise.all([
    api.getProfile().catch(() => ({ success: false })),
    api.getMyReports().catch(() => ({ success: false, data: [] })),
    api.getClaims().catch(() => ({ success: false, data: [] })),
    api.getAppointments({ owner_id: session.userId }).catch(() => ({ success: false, data: [] })),
    api.getMyPets().catch(() => ({ success: false, data: [] }))
  ]);

  const pets = petsResult.success && Array.isArray(petsResult.data) ? petsResult.data : [];
  renderPetsRow(pets);

  if (profileResult.success) {
    const profile = profileResult.data;
    const heroName = document.getElementById('heroName');
    const heroSub = document.getElementById('heroSub');
    const heroAvatar = document.getElementById('heroAvatar');
    if (heroName) heroName.textContent = profile.fullName || session.name || 'Pet Owner';
    if (heroSub) heroSub.textContent = profile.memberSince ? `Pet Owner since ${profile.memberSince}.` : 'Pet Owner';
    if (heroAvatar && profile.avatarUrl) heroAvatar.src = profile.avatarUrl;
  }

  const reports = reportsResult.success && Array.isArray(reportsResult.data) ? reportsResult.data : [];
  const activeReports = reports.filter((r) => r.status === 'active').length;

  const claims = claimsResult.success && Array.isArray(claimsResult.data) ? claimsResult.data : [];
  const pendingClaims = claims.filter((c) => c.status === 'pending').length;

  const appointments = appointmentsResult.success && Array.isArray(appointmentsResult.data) ? appointmentsResult.data : [];
  const upcomingAppointments = appointments.filter((a) => ['pending', 'confirmed'].includes(a.status)).length;

  const statActiveReports = document.getElementById('statActiveReports');
  const statPendingClaims = document.getElementById('statPendingClaims');
  const statUpcomingAppointments = document.getElementById('statUpcomingAppointments');
  if (statActiveReports) statActiveReports.textContent = String(activeReports).padStart(2, '0');
  if (statPendingClaims) statPendingClaims.textContent = String(pendingClaims).padStart(2, '0');
  if (statUpcomingAppointments) statUpcomingAppointments.textContent = String(upcomingAppointments).padStart(2, '0');
}

document.addEventListener('DOMContentLoaded', loadAccountProfile);
document.addEventListener('DOMContentLoaded', renderRecentActivity);

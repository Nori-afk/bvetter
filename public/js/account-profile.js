/* =============================================
   BVetter — Account Profile JS
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

   Categorises on `type`, the notifications table's own column. It used to read
   a prefix off the id ('appt-', 'claim-', 'report-') back when nav.js
   synthesised those ids itself. Once notifications became real per-user rows
   the id became the table's auto-increment INT, so calling a string method on
   it threw "startsWith is not a function"; the map died before assigning
   innerHTML, and the page sat on its "Loading recent activity..." placeholder
   forever. Owners with no notifications never reached this code, which is why
   the failure looked intermittent.

   The legacy prefix check is kept as a fallback so any caller still passing a
   synthetic string id keeps working. */
function activityCardMeta(item) {
  const type  = String(item.type || '');
  const idStr = String(item.id || '');
  const title = String(item.title || '');
  const isAppointment = type === 'appointment_status'       || idStr.startsWith('appt-');
  const isClaim       = type === 'lost_found_claim_status'  || idStr.startsWith('claim-');
  const isReport      = type === 'lost_found_report_status' || idStr.startsWith('report-');

  if (isAppointment) {
    const pending = title.includes('Awaiting');
    return {
      dotClass: 'blue-dot',
      icon: 'profile-report-submitted.svg',
      refLabel: 'Appointment',
      badgeClass: pending ? 'badge-pending' : 'badge-review',
      badgeText: pending ? 'PENDING' : 'UPCOMING'
    };
  }
  if (isClaim) {
    return {
      dotClass: 'teal-dot',
      icon: 'profile-report-verification.svg',
      refLabel: 'Claim',
      badgeClass: title.includes('Approved') ? 'badge-approved' : title.includes('Rejected') ? 'badge-rejected' : 'badge-completed',
      badgeText: title.includes('Approved') ? 'APPROVED' : title.includes('Rejected') ? 'REJECTED' : 'RESOLVED'
    };
  }
  if (isReport) {
    return {
      dotClass: 'green-dot',
      icon: 'profile-appointment-completed.svg',
      refLabel: 'Report',
      badgeClass: title.includes('Approved') ? 'badge-approved' : title.includes('Rejected') ? 'badge-rejected' : 'badge-completed',
      badgeText: title.includes('Approved') ? 'APPROVED' : title.includes('Rejected') ? 'REJECTED' : 'RESOLVED'
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

  /* Built into a local first, then assigned. If anything in here throws, the
     assignment below never runs and the "Loading recent activity..." placeholder
     survives -- which is exactly how a TypeError in activityCardMeta presented as
     a permanent loading state with no visible error. Now a failure says so. */
  let cardsHtml;
  try {
    cardsHtml = pageItems.map((item) => {
    const meta = activityCardMeta(item);
    // String() for the same reason as activityCardMeta: `id` is an INT from the
    // notifications table, and numbers have no .replace either. With a numeric id
    // the regex simply does not match, so the id renders as-is -- which is the
    // correct reference to show now that it IS the notification's real id.
    const ref = String(item.id).replace(/^(\w+)-/, '').toUpperCase();
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
  } catch (err) {
    console.error('[account-profile] could not render Recent Activity:', err);
    list.innerHTML = '<p class="activity-empty">Recent activity could not be displayed. '
      + 'Please refresh the page.</p>';
    if (pagination) pagination.innerHTML = '';
    return;
  }

  list.innerHTML = cardsHtml;

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

/* =============================================
   BVetter — Public Nav JS
   File: public/js/nav.js
   Depends: ../../shared/js/auth.js (loaded first)

   INCLUDE ORDER on every public auth page:
     <script src="../../shared/js/auth.js"></script>
     <script src="../js/nav.js"></script>
     <script src="../js/api.js"></script>
     <script src="../js/[page].js"></script>

   Functions:
   - toggleUserMenu()        — opens/closes user dropdown
   - openNotificationModal() — builds + opens the live notification modal
   - dismiss-notif click     — removes one notification, persisted per
                               owner in localStorage so it stays hidden
   - toggleMobileNav()       — opens/closes mobile nav-links menu
   NOTE: logout() and loginAs() live in auth.js
   ============================================= */

function toggleUserMenu() {
  var dd = document.getElementById('userDropdown');
  if (dd) dd.classList.toggle('open');
  var panel = document.getElementById('notifPanel');
  if (panel) panel.classList.remove('open');
}

/* =============================================
   NAV USER PILL — fills in the real logged-in
   name/role/avatar over the placeholder markup.
   Runs on every page that loads nav.js, so pages
   no longer depend on landing.js being present.
   ============================================= */
function hydrateNavUser() {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const navGuest = document.getElementById('navGuest');
  const navAuth = document.getElementById('navAuth');

  if (navGuest) navGuest.style.display = user ? 'none' : 'flex';
  if (navAuth) navAuth.style.display = user ? 'flex' : 'none';
  if (!user) return;

  const nameEl = document.querySelector('.nav-user-name');
  const roleEl = document.querySelector('.nav-user-role');
  const avatarEl = document.querySelector('.nav-user-avatar');
  if (nameEl) nameEl.textContent = user.name || 'Pet Owner';
  if (roleEl) roleEl.textContent = user.role === 'admin' ? 'Administrator' : (user.role === 'vet' ? 'Veterinarian' : 'Pet Owner');
  if (avatarEl && user.avatarUrl) avatarEl.src = user.avatarUrl;
}

document.addEventListener('DOMContentLoaded', hydrateNavUser);

/* Close dropdown when clicking outside */
document.addEventListener('click', function (e) {
  var pill = document.querySelector('.nav-user-pill');
  var dd   = document.getElementById('userDropdown');
  if (dd && !dd.contains(e.target) && (!pill || !pill.contains(e.target))) {
    dd.classList.remove('open');
  }
});

/* =============================================
   NOTIFICATION BELL — live dropdown modal
   Pulls the pet owner's own appointments, claims,
   and lost & found reports to summarize status
   changes, instead of redirecting to settings.
   ============================================= */

function escapeHtmlNav(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

/* Category glyph (light, thin-stroke, currentColor) + status color mapping —
   one icon set shared by all three notification bells in the app. Color
   signals status (positive/negative/neutral); the glyph signals category. */
const NOTIF_ICONS = {
  appointment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8.5 15.5l2 2 4-4"/></svg>',
  lostfound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6"/><line x1="20" y1="20" x2="14.5" y2="14.5"/></svg>',
  match: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>',
  vaccination: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
  general: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
};

function notifCategoryFromId(id) {
  if (id.indexOf('appt-') === 0) return 'appointment';
  if (id.indexOf('claim-') === 0 || id.indexOf('report-') === 0) return 'lostfound';
  if (id.indexOf('match-') === 0) return 'match';
  return 'general';
}

function notifStatusFromTitle(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('reject') || t.includes('cancel')) return 'negative';
  if (t.includes('confirmed') || t.includes('approve') || t.includes('resolve') || t.includes('upcoming') || t.includes('claimed')) return 'positive';
  return 'neutral';
}

function formatNotifDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ensureNotifModalRoot() {
  let root = document.getElementById('owner-modal-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'owner-modal-root';
    root.hidden = true;
    document.body.appendChild(root);
  }
  return root;
}

function closeNotifModal() {
  const root = document.getElementById('owner-modal-root');
  if (root) {
    root.hidden = true;
    root.innerHTML = '';
  }
}

function getCurrentOwnerId() {
  const session = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  return session?.userId || session?.id || 0;
}

function getDismissedNotifIds(ownerId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(`vbetter_dismissed_notifs_${ownerId}`) || '[]'));
  } catch {
    return new Set();
  }
}

function addDismissedNotifId(ownerId, id) {
  const ids = getDismissedNotifIds(ownerId);
  ids.add(id);
  localStorage.setItem(`vbetter_dismissed_notifs_${ownerId}`, JSON.stringify([...ids]));
}

function getReadNotifIds(ownerId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(`vbetter_read_notifs_${ownerId}`) || '[]'));
  } catch {
    return new Set();
  }
}

function addReadNotifId(ownerId, id) {
  const ids = getReadNotifIds(ownerId);
  ids.add(id);
  localStorage.setItem(`vbetter_read_notifs_${ownerId}`, JSON.stringify([...ids]));
}

function markAllNotifRead(ownerId, ids) {
  const readIds = getReadNotifIds(ownerId);
  ids.forEach((id) => readIds.add(id));
  localStorage.setItem(`vbetter_read_notifs_${ownerId}`, JSON.stringify([...readIds]));
}

async function buildOwnerNotifications() {
  const ownerId = getCurrentOwnerId();
  const dismissed = getDismissedNotifIds(ownerId);
  const read = getReadNotifIds(ownerId);
  const notifications = [];

  try {
    const formData = new FormData();
    formData.append('action', 'list');
    formData.append('owner_id', ownerId);
    const apptRes = await fetch('/api/appointments/appointment.php', {
      method: 'POST',
      body: formData
    }).then((r) => r.json());

    (apptRes?.data || [])
      .filter((appt) => ['pending', 'confirmed'].includes(appt.status))
      .slice(0, 3)
      .forEach((appt) => {
        const id = `appt-${appt.id}`;
        notifications.push({
          id,
          title: appt.status === 'pending' ? 'Appointment Awaiting Confirmation' : 'Upcoming Appointment',
          detail: `${appt.pet?.name || appt.patient || 'Your pet'} — ${formatNotifDate(appt.preferred_date)}${appt.time_slot ? ` at ${appt.time_slot}` : ''}`,
          time: formatNotifDate(appt.created_at || appt.preferred_date) || 'Just now',
          read: read.has(id)
        });
      });
  } catch (error) {
    /* appointment lookup failed — skip silently */
  }

  try {
    const claimsRes = await lostFoundRequest('list_claims', {});
    (claimsRes?.data || [])
      .filter((claim) => claim.status !== 'pending')
      .slice(0, 3)
      .forEach((claim) => {
        const id = `claim-${claim.id}`;
        const label = claim.status === 'approved' ? 'Claim Approved' : claim.status === 'rejected' ? 'Claim Rejected' : 'Claim Resolved';
        notifications.push({
          id,
          title: label,
          detail: `Your claim for ${claim.pet_name || 'a pet'}${claim.report_case ? ` (${claim.report_case})` : ''} was ${claim.status}.`,
          time: formatNotifDate(claim.reviewed_at || claim.updated_at || claim.created_at) || 'Just now',
          read: read.has(id)
        });
      });
  } catch (error) {
    /* claims lookup failed — skip silently */
  }

  let myReports = [];
  try {
    const reportsRes = await lostFoundRequest('list', { status: 'all', owner_id: ownerId });
    myReports = reportsRes?.data || [];
    myReports
      .filter((report) => ['active', 'rejected', 'resolved'].includes(report.status))
      .slice(0, 3)
      .forEach((report) => {
        const id = `report-${report.id}`;
        const label = report.status === 'active' ? 'Report Approved' : report.status === 'rejected' ? 'Report Rejected' : 'Report Resolved';
        notifications.push({
          id,
          title: label,
          detail: `Your ${(report.type || '').toLowerCase()} report for ${report.petName || 'a pet'} is now ${report.status}.`,
          time: formatNotifDate(report.resolved_at || report.updated_at || report.created_at) || 'Just now',
          read: read.has(id)
        });
      });
  } catch (error) {
    /* report lookup failed — skip silently */
  }

  try {
    const myLostReports = myReports.filter((report) => (report.type || '').toLowerCase() === 'lost' && report.status === 'active');
    const matchResults = await Promise.all(
      myLostReports.map((report) => lostFoundRequest('matches', { report_id: report.id }).catch(() => null))
    );
    matchResults
      .flatMap((result, idx) => (result?.data || []).map((match) => ({ match, report: myLostReports[idx] })))
      .filter(({ match }) => match.status === 'suggested')
      .slice(0, 3)
      .forEach(({ match, report }) => {
        const id = `match-${match.id}`;
        notifications.push({
          id,
          title: 'New Potential Match Found',
          detail: `A possible match (${match.confidence}% confidence) was found for ${report.petName || report.title || 'your lost pet'}.`,
          time: formatNotifDate(match.createdAt) || 'Just now',
          read: read.has(id)
        });
      });
  } catch (error) {
    /* matches lookup failed — skip silently */
  }

  try {
    const incomingClaimsRes = await lostFoundRequest('list_claims', { report_owner_id: ownerId });
    (incomingClaimsRes?.data || [])
      .filter((claim) => claim.status === 'pending')
      .slice(0, 3)
      .forEach((claim) => {
        const id = `claim-in-${claim.id}`;
        notifications.push({
          id,
          title: 'New Claim on Your Found Report',
          detail: `Someone submitted a claim for ${claim.pet_name || 'a pet'}${claim.report_case ? ` (${claim.report_case})` : ''}.`,
          time: formatNotifDate(claim.created_at) || 'Just now',
          read: read.has(id)
        });
      });
    (incomingClaimsRes?.data || [])
      .filter((claim) => ['approved', 'resolved'].includes(claim.status))
      .slice(0, 3)
      .forEach((claim) => {
        const id = `claim-out-${claim.id}`;
        notifications.push({
          id,
          title: 'Your Found Pet Was Claimed',
          detail: `${claim.claimant_name || 'A claimant'} was approved for ${claim.pet_name || 'the pet'}${claim.report_case ? ` (${claim.report_case})` : ''} you posted.`,
          time: formatNotifDate(claim.reviewed_at || claim.updated_at || claim.created_at) || 'Just now',
          read: read.has(id)
        });
      });
  } catch (error) {
    /* incoming claims lookup failed — skip silently */
  }

  const visible = notifications.filter((item) => !dismissed.has(item.id));

  if (!visible.length) {
    visible.push({
      id: 'empty',
      title: 'No New Notifications',
      detail: 'You are all caught up. Check back later for updates.',
      time: 'Just checked',
      read: true
    });
  }

  return visible;
}

const NOTIF_PAGE_SIZE = 5;
let notifListExpanded = false;
/* Tracked so the global dismiss-click listener (outside this closure) can
   mutate the same array the open modal is rendering from, and trigger a
   redraw that respects the current cap/expanded state. */
let currentNotifItems = [];
let redrawNotifList = null;

function renderNotificationItems(root, items) {
  const list = root.querySelector('.dash-notification-list');
  if (!list) return;

  currentNotifItems = items;

  function draw() {
    if (!items.length) {
      items.push({
        id: 'empty',
        title: 'No New Notifications',
        detail: 'You are all caught up. Check back later for updates.',
        time: 'Just checked',
        read: true
      });
    }

    const header = root.querySelector('.dash-modal-header h2');
    if (header) {
      const unreadCount = items.filter((item) => !item.read && item.id !== 'empty').length;
      header.textContent = `Notification${unreadCount ? ` (${unreadCount})` : ''}`;
    }

    const visible = notifListExpanded ? items : items.slice(0, NOTIF_PAGE_SIZE);
    const remaining = items.length - visible.length;

    list.innerHTML = visible
      .map((item) => {
        const category = item.id === 'empty' ? 'general' : notifCategoryFromId(item.id);
        const status = item.id === 'empty' ? 'neutral' : notifStatusFromTitle(item.title);
        return `
        <article class="dash-notification-item ${item.read ? 'read' : 'unread'}" data-notif-id="${escapeHtmlNav(item.id)}">
          <div class="notif-badge notif-badge--${status}">${NOTIF_ICONS[category]}</div>
          <div class="dash-notification-item-body">
            <h4>${escapeHtmlNav(item.title)}</h4>
            <p>${escapeHtmlNav(item.detail)}</p>
            <small>${escapeHtmlNav(item.time)}</small>
          </div>
          ${item.id === 'empty' ? '' : `<button type="button" class="notif-item-delete" data-action="dismiss-notif" aria-label="Dismiss notification">&times;</button>`}
        </article>
      `;
      })
      .join('') + (remaining > 0 ? `<button type="button" class="notif-show-more-btn" id="notif-show-more-btn">Show ${remaining} more</button>` : '');

    const showMoreBtn = list.querySelector('#notif-show-more-btn');
    if (showMoreBtn) {
      showMoreBtn.addEventListener('click', () => {
        notifListExpanded = true;
        draw();
      });
    }

    list.querySelectorAll('.dash-notification-item').forEach((element) => {
      element.addEventListener('click', () => {
        const id = element.dataset.notifId;
        if (!id || id === 'empty') return;
        const entry = items.find((notif) => notif.id === id);
        if (!entry || entry.read) return;
        entry.read = true;
        addReadNotifId(getCurrentOwnerId(), id);
        syncNotifDotFromItems(items);
        draw();
      });
    });
  }

  redrawNotifList = draw;
  draw();
}

/* ── Notification bell dot — reflects real unread state, not a static
   always-on marker. Public owner notifications have no backing table, so
   the count is cached briefly to avoid re-running the full aggregation
   (6 endpoints) on every page load/navigation. ── */
const NOTIF_DOT_CACHE_TTL_MS = 60000;

function getNotifDotElements() {
  return Array.from(document.querySelectorAll('.nav-notif-dot'));
}

function setNotifDotVisible(hasUnread) {
  getNotifDotElements().forEach((dot) => { dot.hidden = !hasUnread; });
}

function syncNotifDotFromItems(items) {
  const unreadCount = items.filter((item) => !item.read && item.id !== 'empty').length;
  try {
    sessionStorage.setItem(`vbetter_notif_unread_${getCurrentOwnerId()}`, JSON.stringify({ count: unreadCount, ts: Date.now() }));
  } catch { /* storage unavailable — dot still reflects current in-memory state */ }
  setNotifDotVisible(unreadCount > 0);
}

async function refreshNotifDot() {
  if (!getNotifDotElements().length) return;

  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (!user) {
    setNotifDotVisible(false);
    return;
  }

  const cacheKey = `vbetter_notif_unread_${getCurrentOwnerId()}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (cached && (Date.now() - cached.ts) < NOTIF_DOT_CACHE_TTL_MS) {
      setNotifDotVisible(cached.count > 0);
      return;
    }
  } catch { /* malformed cache — fall through to a fresh fetch */ }

  const items = await buildOwnerNotifications();
  syncNotifDotFromItems(items);
}

document.addEventListener('DOMContentLoaded', refreshNotifDot);

/* Dismiss a single notification: hide it going forward via localStorage,
   since notifications are rebuilt live from appointments/claims/reports
   on every open rather than stored server-side. */
document.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-action="dismiss-notif"]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();

  const item = btn.closest('.dash-notification-item');
  if (!item) return;

  const id = item.dataset.notifId;
  if (!id) return;
  addDismissedNotifId(getCurrentOwnerId(), id);

  const idx = currentNotifItems.findIndex((entry) => entry.id === id);
  if (idx !== -1) currentNotifItems.splice(idx, 1);

  if (redrawNotifList) redrawNotifList();
  syncNotifDotFromItems(currentNotifItems);
});

async function openNotificationModal() {
  const root = ensureNotifModalRoot();
  root.innerHTML = `
    <div class="dash-modal-overlay" role="dialog" aria-modal="true">
      <section class="dash-modal-shell dash-modal-mini">
        <header class="dash-modal-header">
          <h2>Notification</h2>
          <div class="dash-modal-header-actions">
            <button type="button" class="dash-header-action" id="mark-all-read-btn">Mark all as read</button>
            <button type="button" class="dash-close-btn" data-modal-close>&times;</button>
          </div>
        </header>
        <div class="dash-modal-content">
          <div class="dash-notification-list"><p>Loading notifications&hellip;</p></div>
        </div>
      </section>
    </div>
  `;
  root.hidden = false;

  const overlay = root.querySelector('.dash-modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeNotifModal();
    });
  }
  root.querySelectorAll('[data-modal-close]').forEach((button) => {
    button.addEventListener('click', closeNotifModal);
  });

  notifListExpanded = false;
  const items = await buildOwnerNotifications();
  if (!root.hidden) renderNotificationItems(root, items);
  syncNotifDotFromItems(items);

  const markAllBtn = document.getElementById('mark-all-read-btn');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', () => {
      const ids = items.filter((item) => item.id !== 'empty').map((item) => item.id);
      markAllNotifRead(getCurrentOwnerId(), ids);
      items.forEach((item) => { item.read = true; });
      if (redrawNotifList) redrawNotifList();
      syncNotifDotFromItems(items);
    });
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const notifBtn = document.getElementById('notification-icon-btn');
  if (notifBtn) {
    notifBtn.addEventListener('click', function (event) {
      event.preventDefault();
      openNotificationModal();
    });
  }
});

function toggleMobileNav() {
  var links = document.querySelector('.nav-links');
  if (links) links.classList.toggle('open');
}

/* Close mobile nav when a link is picked, or when clicking outside it */
document.addEventListener('click', function (e) {
  var links = document.querySelector('.nav-links');
  var hamburger = document.querySelector('.nav-hamburger');
  if (!links || !links.classList.contains('open')) return;
  if (links.contains(e.target) && e.target.tagName !== 'A') return;
  if (hamburger && hamburger.contains(e.target)) return;
  links.classList.remove('open');
});

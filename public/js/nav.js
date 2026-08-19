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
   - openNotificationModal() — opens the notification modal, fed by
                               api/notifications/notifications.php
   - dismiss-notif click     — soft-deletes one notification server-side
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

  if (user.role !== 'owner') stripOwnerOnlyNav(user.role);

  const nameEl = document.querySelector('.nav-user-name');
  const roleEl = document.querySelector('.nav-user-role');
  const avatarEl = document.querySelector('.nav-user-avatar');
  if (nameEl) nameEl.textContent = user.name || 'Pet Owner';
  if (roleEl) roleEl.textContent = user.role === 'admin' ? 'Administrator' : (user.role === 'vet' ? 'Veterinarian' : 'Pet Owner');
  if (avatarEl && user.avatarUrl) avatarEl.src = user.avatarUrl;
}

/* =============================================
   NON-OWNER NAV — this nav is owner-shaped: every
   link in it (Book An Appointment, My Pets, Lost And
   Found, and the whole account dropdown) leads to a
   page guarded by requireAuth(['owner']).

   Entry-point pages call requireOwnerOrGuest() and
   bounce staff before they ever render, but the legal
   pages (privacy-policy, terms-of-service) stay open to
   everyone on purpose — a vet may need to read the
   clinic's own terms, and nothing in the vet portal
   links there, so a bounce would make them unreachable.

   On those pages, strip the links a vet/admin cannot
   follow instead of letting them click into a redirect.
   ============================================= */
function dashboardHref(role) {
  return role === 'admin' ? '../../admin/pages/index.html' : '../../vet/html/index.html';
}

function stripOwnerOnlyNav(role) {
  const OWNER_ONLY = [
    'book-appointment.html', 'lost-found.html', 'my-pets.html', 'my-claims.html',
    'account-profile.html', 'account-settings.html', 'notification-settings.html',
    'my-tickets.html'
  ];

  document.querySelectorAll('.nav-links a, .nav-user-dropdown a').forEach((link) => {
    const href = (link.getAttribute('href') || '').split('/').pop();
    if (!OWNER_ONLY.includes(href)) return;
    // Drop the whole <li> in the top nav; the bare <a> in the dropdown.
    (link.closest('li') || link).remove();
  });

  // "Home" means landing.html, which now bounces staff via
  // requireOwnerOrGuest(). Point it at their own dashboard so the link
  // goes straight there instead of arriving via a redirect.
  const home = document.querySelector('.nav-links a[href$="landing.html"]');
  if (home) {
    home.setAttribute('href', dashboardHref(role));
    home.textContent = 'Dashboard';
  }

  // Owner notification rows only — staff read theirs in their own portal.
  const bell = document.getElementById('notification-icon-btn');
  if (bell) bell.style.display = 'none';

  // The dropdown is down to just Log Out now; give them the way home.
  const dropdown = document.getElementById('userDropdown');
  const divider = dropdown && dropdown.querySelector('.dropdown-divider');
  if (dropdown && divider) {
    const link = document.createElement('a');
    link.className = 'dropdown-item';
    link.href = dashboardHref(role);
    link.textContent = role === 'admin' ? 'Admin Dashboard' : 'Vet Dashboard';
    dropdown.insertBefore(link, divider);
  }
}

document.addEventListener('DOMContentLoaded', hydrateNavUser);

/* =============================================
   LIGHTWEIGHT POLLING — keeps a page's own data
   fresh without a manual reload. Loaded here (not a
   separate file) since nav.js is already included on
   every page that needs it, before the page's own JS.

   Pauses while the tab is hidden (nothing to refresh
   if nobody's looking), re-checks immediately when the
   tab regains focus (same pattern as the session-check
   polling in shared/js/auth.js), and never lets two
   ticks overlap if a fetch is slow.

   loadFn is called as loadFn({ silent: true }) so each
   page's loader can skip its own "Loading..." flash and
   skip the re-render entirely when the fetched data is
   unchanged — callers opt into that by checking options.silent.
   ============================================= */
function startPolling(loadFn, intervalMs = 15000) {
  let inFlight = false;

  async function tick() {
    if (inFlight || document.hidden) return;
    inFlight = true;
    try {
      await loadFn({ silent: true });
    } catch {
      // Network hiccup — try again next tick.
    } finally {
      inFlight = false;
    }
  }

  const intervalId = setInterval(tick, intervalMs);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });

  return { stop: () => clearInterval(intervalId) };
}

/* Close dropdown when clicking outside */
document.addEventListener('click', function (e) {
  var pill = document.querySelector('.nav-user-pill');
  var dd   = document.getElementById('userDropdown');
  if (dd && !dd.contains(e.target) && (!pill || !pill.contains(e.target))) {
    dd.classList.remove('open');
  }
});

/* =============================================
   NOTIFICATION BELL — dropdown modal over the
   owner's own notification rows.
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

/* Keyed off the row's `type`. This used to parse the synthetic id prefixes
   ('appt-', 'claim-', 'match-') the browser invented when it built the feed
   itself; ids are database keys now and carry no meaning. */
function notifCategoryFromType(type) {
  if (String(type).indexOf('appointment') === 0) return 'appointment';
  if (type === 'lost_found_match') return 'match';
  if (String(type).indexOf('lost_found') === 0) return 'lostfound';
  if (type === 'csp_registration') return 'vaccination';
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

/* ── Notification feed ────────────────────────────────────────
   Owner notifications are database rows, fetched from
   api/notifications/notifications.php like every other role's.

   They used to be synthesized here on every open: six API calls
   (appointments, claims, reports, matches, incoming claims) stitched into
   a list, with read and dismissed state kept in localStorage under
   `vbetter_read_notifs_<ownerId>`. That made "read" per-browser rather
   than per-person, lost it whenever storage was cleared, and reset the
   bell dot whenever the owner id resolved to 0 because the session
   had not hydrated yet. The rows are written at event time now, so this
   only has to read them. ── */

async function buildOwnerNotifications(limit) {
  if (typeof api === 'undefined' || !api.getNotifications) return [];

  const result = await api.getNotifications(limit || 30).catch(() => null);
  if (!result || !result.success) return [];

  return (result.data || []).map((row) => ({
    id: row.id,
    title: row.title,
    detail: row.message,
    time: formatNotifDate(row.created_at) || 'Just now',
    sortTime: Date.parse(row.created_at) || 0,
    read: row.is_read
  }));
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
        const category = item.id === 'empty' ? 'general' : notifCategoryFromType(item.type);
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
      element.addEventListener('click', async () => {
        const id = element.dataset.notifId;
        if (!id || id === 'empty') return;
        // dataset values are strings; row ids are numbers.
        const entry = items.find((notif) => String(notif.id) === id);
        if (!entry || entry.read) return;

        entry.read = true;
        syncNotifDotFromItems(items);
        draw();

        // Put it back if the server did not accept it, rather than leaving
        // the item looking read until a refresh contradicts it.
        const result = await api.markNotificationRead(entry.id).catch(() => null);
        if (!result || !result.success) {
          entry.read = false;
          syncNotifDotFromItems(items);
          draw();
        }
      });
    });
  }

  redrawNotifList = draw;
  draw();
}

/* ── Notification bell dot ────────────────────────────────────
   One indexed COUNT against the caller's own rows. This used to run the
   full six-endpoint aggregation just to work out whether the dot should
   show, which is why it needed a sessionStorage cache with a TTL — and
   why a cache written before the session hydrated could leave the dot
   wrong for a minute. Neither the cache nor its staleness window is
   needed now. ── */

function getNotifDotElements() {
  return Array.from(document.querySelectorAll('.nav-notif-dot'));
}

function setNotifDotVisible(hasUnread) {
  getNotifDotElements().forEach((dot) => { dot.hidden = !hasUnread; });
}

function syncNotifDotFromItems(items) {
  setNotifDotVisible(items.some((item) => !item.read && item.id !== 'empty'));
}

async function refreshNotifDot() {
  if (!getNotifDotElements().length) return;
  if (typeof api === 'undefined' || !api.getUnreadNotificationCount) return;

  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (!user) {
    setNotifDotVisible(false);
    return;
  }

  const result = await api.getUnreadNotificationCount().catch(() => null);
  if (!result || !result.success) return;

  setNotifDotVisible(result.unread_count > 0);
}

document.addEventListener('DOMContentLoaded', refreshNotifDot);
document.addEventListener('DOMContentLoaded', () => startPolling(refreshNotifDot, 20000));

/* Dismiss a single notification. Soft-deleted server-side (dismissed_at) on
   the caller's own row only — safe now that rows belong to one recipient,
   where it would once have hidden the notification from everybody. */
document.addEventListener('click', async function (e) {
  const btn = e.target.closest('[data-action="dismiss-notif"]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();

  const item = btn.closest('.dash-notification-item');
  if (!item) return;

  const id = item.dataset.notifId;
  if (!id || id === 'empty') return;

  const idx = currentNotifItems.findIndex((entry) => String(entry.id) === id);
  if (idx === -1) return;
  const [removed] = currentNotifItems.splice(idx, 1);

  if (redrawNotifList) redrawNotifList();
  syncNotifDotFromItems(currentNotifItems);

  const result = await api.dismissNotification(removed.id).catch(() => null);
  if (!result || !result.success) {
    currentNotifItems.splice(idx, 0, removed);
    if (redrawNotifList) redrawNotifList();
    syncNotifDotFromItems(currentNotifItems);
  }
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
    markAllBtn.addEventListener('click', async () => {
      // Confirm the write landed before showing everything as read. The
      // admin bell used to do the opposite and hid a write that had been
      // failing every single time.
      const result = await api.markAllNotificationsRead().catch(() => null);
      if (!result || !result.success) return;

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

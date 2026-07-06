/* =============================================
   BVETTER — Public Nav JS
   File: public/js/nav.js
   Depends: ../../shared/js/auth.js (loaded first)

   INCLUDE ORDER on every public auth page:
     <script src="../../shared/js/auth.js"></script>
     <script src="../js/nav.js"></script>
     <script src="../js/api.js"></script>
     <script src="../js/[page].js"></script>

   Functions:
   - toggleUserMenu()     — opens/closes user dropdown
   - toggleNotifPanel()   — opens/closes notification panel
   - markAllNotifsRead()  — clears unread state client-side
   - dismissNotif(e, btn) — removes a single notification item
   - clearAllNotifs()     — removes all notification items
   - toggleMobileNav()    — opens/closes mobile nav-links menu
   NOTE: logout() and loginAs() live in auth.js
   ============================================= */

function toggleUserMenu() {
  var dd = document.getElementById('userDropdown');
  if (dd) dd.classList.toggle('open');
  var panel = document.getElementById('notifPanel');
  if (panel) panel.classList.remove('open');
}

/* Close dropdown when clicking outside */
document.addEventListener('click', function (e) {
  var pill = document.querySelector('.nav-user-pill');
  var dd   = document.getElementById('userDropdown');
  if (dd && !dd.contains(e.target) && (!pill || !pill.contains(e.target))) {
    dd.classList.remove('open');
  }
});

function toggleNotifPanel() {
  var panel = document.getElementById('notifPanel');
  if (panel) panel.classList.toggle('open');
  var dd = document.getElementById('userDropdown');
  if (dd) dd.classList.remove('open');
}

function markAllNotifsRead() {
  document.querySelectorAll('.notif-panel-item.unread').forEach(function (item) {
    item.classList.remove('unread');
  });
  var dot = document.querySelector('.nav-notif-dot');
  if (dot) dot.style.display = 'none';
}

/* TODO backend: call api.deleteNotification(id) here once notif items carry a real id */
function dismissNotif(e, btn) {
  e.preventDefault();
  e.stopPropagation();
  var item = btn.closest('.notif-panel-item');
  if (item) item.remove();
  refreshNotifEmptyState();
  refreshNotifDot();
}

/* TODO backend: call api.clearAllNotifications() here */
function clearAllNotifs() {
  var list = document.querySelector('.notif-panel-list');
  if (list) list.querySelectorAll('.notif-panel-item').forEach(function (item) {
    item.remove();
  });
  refreshNotifEmptyState();
  refreshNotifDot();
}

function refreshNotifDot() {
  var dot = document.querySelector('.nav-notif-dot');
  if (dot) dot.style.display = document.querySelector('.notif-panel-item.unread') ? '' : 'none';
}

function refreshNotifEmptyState() {
  var list = document.querySelector('.notif-panel-list');
  if (!list) return;
  var hasItems = !!list.querySelector('.notif-panel-item');
  var empty = list.querySelector('.notif-panel-empty');
  if (!hasItems && !empty) {
    empty = document.createElement('p');
    empty.className = 'notif-panel-empty';
    empty.textContent = "You're all caught up.";
    list.appendChild(empty);
  } else if (hasItems && empty) {
    empty.remove();
  }
}

/* Close notification panel when clicking outside */
document.addEventListener('click', function (e) {
  var wrap  = document.querySelector('.nav-notif-wrap');
  var panel = document.getElementById('notifPanel');
  if (panel && wrap && !wrap.contains(e.target)) {
    panel.classList.remove('open');
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

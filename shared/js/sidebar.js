/**
 * VBetter – Shared Sidebar Controller  (shared/js/sidebar.js)
 * ─────────────────────────────────────────────────────────────
 * FIXES:
 *  1. All nav routes are ABSOLUTE so they work from /final-VBETTER/bvetter/vet/html/
 *     AND /admin/pages/ — no more "Cannot GET" errors.
 *  2. Profile card is always built from sessionStorage, so the
 *     real name (Dr. Kizea) always shows — never "Guest".
 *  3. data-roles hides admin-only items from vet users.
 *  4. Dashboard route is role-aware — admin goes to
 *     /admin/pages/index.html, vet goes to /final-VBETTER/bvetter/vet/html/index.html.
 * ─────────────────────────────────────────────────────────────
 */

(function () {
    'use strict';

    /* ── Absolute routes — work from ANY page in ANY folder ─── */
    const ROUTES = {
        'appointment management': '/final-VBETTER/bvetter/vet/html/appointment.html',
        'patient records':        '/final-VBETTER/bvetter/vet/html/patient-records.html',
        'report':                 '/final-VBETTER/bvetter/vet/html/report.html',
        'disease analytics':      '/final-VBETTER/bvetter/vet/html/disease-analytics.html',
        'lost and found':         '/final-VBETTER/bvetter/vet/html/lost-and-found.html',
        'chatbot management':     '/final-VBETTER/bvetter/vet/html/chatbot-management.html',
        'mass vaccination':       '/final-VBETTER/bvetter/vet/html/mass-vaccination.html',
        // Admin-only — absolute paths
        'account management':     '/final-VBETTER/bvetter/admin/pages/account-management.html',
        'website management':     '/final-VBETTER/bvetter/admin/pages/website-management.html', // input here the directory of the Website management.
    };

    /* Default profile photos — used until the user uploads their own.
       Reuses images already in the project (no external fetches):
       vet-profile.png is the existing vet headshot used elsewhere
       (book-appointment.html); account-avatar.png is the generic
       silhouette already used as the pet-owner default. */
    const DEFAULT_AVATARS = {
        vet:   '/final-VBETTER/bvetter/public/images/img/vet-profile.png',
        admin: '/final-VBETTER/bvetter/public/images/img/account-avatar.png'
    };

    const ACTIVE_ICON_CAPABLE = new Set([
        'dashboard',
        'appointment',
        'patient-records',
        'report',
        'disease-analytics',
        'lost-found',
        'chatbot',
        'mass-vacc',
        'acc-management',
        'web-settings'
    ]);

    /* ── Bootstrap ──────────────────────────────────────────── */
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;

        const session = readSession();
        const role    = session ? session.role : null;

        applyRoleVisibility(sidebar, role);
        buildToggleButton(sidebar);
        buildProfileCard(sidebar, session);
        buildMobileActions(sidebar, session);
        console.log(session);

        const navItems = Array.from(sidebar.querySelectorAll('.nav-item'));
        hydrateNavItems(navItems, role);
        wireExpand(sidebar);
        syncToggleState(sidebar);
        wrapMobilePanel(sidebar);
    }

    /* ── Mobile top-bar actions (notification bell + avatar) ──
       Always visible in the collapsed mobile bar, next to the
       hamburger/logo — mirrors the public pet-owner nav's bell+
       avatar pair. No-op on desktop/tablet (hidden via CSS). ── */
    function buildMobileActions(sidebar, session) {
        if (sidebar.querySelector('.sidebar-mobile-actions')) return;

        const avatarUrl = resolveAvatarUrl(session);
        const name      = (session && session.name) ? session.name : 'Unknown';

        const wrap = document.createElement('div');
        wrap.className = 'sidebar-mobile-actions';
        wrap.innerHTML =
            '<button type="button" class="sidebar-mobile-notif-btn" id="sidebar-mobile-notif-btn" aria-label="Notifications">' +
            '<img src="/bvetter/public/images/icons/icon-bell.svg" class="sidebar-mobile-notif-icon" alt="">' +
            '<span class="sidebar-mobile-notif-dot"></span>' +
            '</button>' +
            '<img src="' + avatarUrl + '" alt="' + name + '" class="sidebar-mobile-avatar" id="sidebar-mobile-avatar-btn" ' +
            'onerror="this.onerror=null;this.src=\'/bvetter/public/images/img/account-avatar.png\'">';

        sidebar.appendChild(wrap);

        const avatarBtn = wrap.querySelector('#sidebar-mobile-avatar-btn');
        if (avatarBtn) {
            avatarBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                sidebar.classList.toggle('mobile-open');
                syncToggleState(sidebar);
            });
        }
    }

    /* ── Mobile dropdown panel ─────────────────────────────────
       Moves the existing nav + profile/logout footer into one
       wrapper so both can render as a single dropdown panel below
       the collapsed mobile bar (profile above, nav below). Uses
       `display:contents` on desktop/tablet so it's fully invisible
       to that layout — nav/footer behave exactly as before there. */
    function wrapMobilePanel(sidebar) {
        if (sidebar.querySelector('.sidebar-mobile-panel')) return;

        const nav    = sidebar.querySelector('.sidebar-nav');
        const footer = sidebar.querySelector('.sidebar-footer');
        if (!nav || !footer) return;

        const panel = document.createElement('div');
        panel.className = 'sidebar-mobile-panel';
        sidebar.appendChild(panel);
        panel.appendChild(footer);
        panel.appendChild(nav);
    }

    /* ── Read session — works with or without VBetterAuth ────── */
    function readSession() {
        try {
            if (window.VBetterAuth && window.VBetterAuth.getSession) {
                return window.VBetterAuth.getSession();
            }
            const raw = sessionStorage.getItem('vbetter_session');
            console.log(raw)
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    }

    /* ── Role visibility ─────────────────────────────────────── */
    function applyRoleVisibility(sidebar, role) {
        sidebar.querySelectorAll('[data-roles]').forEach(el => {
            const allowed = el.getAttribute('data-roles').split(' ');
            if (role === 'admin') return; // admin sees everything
            if (!role || !allowed.includes(role)) {
                el.style.display = 'none';
            }
        });
    }

    /* ── Toggle button ──────────────────────────────────────── */
    function buildToggleButton(sidebar) {
        const header = sidebar.querySelector('.sidebar-header');
        if (!header) return;

        let btn = document.getElementById('sidebar-toggle');
        if (!btn) {
            btn = document.createElement('button');
            btn.type      = 'button';
            btn.className = 'sidebar-toggle';
            btn.id        = 'sidebar-toggle';
            btn.setAttribute('aria-label', 'Toggle sidebar');
            btn.innerHTML = '&#9776;';
            header.prepend(btn);
        }

        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            if (window.innerWidth <= 768) {
                sidebar.classList.toggle('mobile-open');
                syncToggleState(sidebar);
                return;
            }
            sidebar.classList.toggle('expanded');
            syncToggleState(sidebar);
        });
    }

    /* Single source of truth for "which photo represents this user" —
       used by both the desktop/expanded profile card and the mobile
       top-bar avatar, so they can never show a different picture. */
    function resolveAvatarUrl(session) {
        const role = (session && session.role) ? session.role : '';
        return (session && session.pfp) ? session.pfp : (DEFAULT_AVATARS[role] || DEFAULT_AVATARS.admin);
    }

    /* ── Profile card — ALWAYS from session, never "Guest" ───── */
    function buildProfileCard(sidebar, session) {
    const footer = sidebar.querySelector('.sidebar-footer');
    if (!footer) return;

    const name      = (session && session.name)      ? session.name      : 'Unknown';
    const role      = (session && session.role)      ? session.role      : '';
    const avatarUrl = resolveAvatarUrl(session);
    const roleLabel = roleDisplayLabel(role);
    const firstLet  = name.slice(0, 1).toUpperCase();

    // Always render a photo; fall back to a letter avatar only if the
    // image itself fails to load (broken path, offline, etc).
    const avatarHTML =
        '<img src="' + avatarUrl + '" alt="' + name + '" class="sidebar-profile-avatar" ' +
        'onerror="this.onerror=null;this.outerHTML=\'<div class=\\\'sidebar-profile-avatar sidebar-profile-avatar--initials\\\'>' + firstLet + '</div>\'">';

    footer.innerHTML =
        '<article class="sidebar-profile-card" data-role="' + role + '" aria-label="' + name + ' profile">' +
        avatarHTML +
        '<div class="sidebar-profile-meta">' +
        '<strong class="sidebar-profile-name">' + name + '</strong>' +
        '<span class="sidebar-profile-role">' + roleLabel + '</span>' +
        '</div>' +
        '</article>' +
        '<button type="button" class="nav-item logout-item" id="sidebar-logout-btn" title="Log Out">' +
        '<img src="/final-VBETTER/bvetter/shared/images/sidebar/logout.svg" class="nav-icon" alt="Log Out">' +
        '<span class="nav-label">Log Out</span>' +
        '</button>';

    const card = footer.querySelector('.sidebar-profile-card');
    if (card) {
        card.addEventListener('click', function () {
            const dest = role === 'admin'
                ? '/final-VBETTER/bvetter/admin/pages/profile.html'
                : '/final-VBETTER/bvetter/vet/html/profile.html';
            if (!window.location.pathname.toLowerCase().endsWith('profile.html')) {
                window.location.href = dest;
            }
        });
    }

    const logoutBtn = footer.querySelector('#sidebar-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (window.VBetterAuth && window.VBetterAuth.logout) {
                window.VBetterAuth.logout();
                return;
            }
            // Fallback: some pages don't load auth.js yet — clear the
            // session directly so logout still works everywhere.
            sessionStorage.removeItem('vbetter_session');
            window.location.href = '/bvetter/public/pages/login.html';
        });
    }
}
    function roleDisplayLabel(role) {
        return { vet: 'Vet III', admin: 'Administrator', owner: 'Pet Owner' }[role] || '';
    }

    /* ── Hydrate nav links & active state ────────────────────── */
    function hydrateNavItems(navItems, role) {
        const currentPath = window.location.pathname.toLowerCase();

        // Dashboard route depends on role — admin gets admin dashboard
        ROUTES['dashboard'] = (role === 'admin')
            ? '/final-VBETTER/bvetter/admin/pages/index.html'
            : '/final-VBETTER/bvetter/vet/html/index.html';

        navItems.forEach(function (item) {
            if (item.style.display === 'none') return;

            const labelEl  = item.querySelector('.nav-label');
            const rawLabel = (labelEl ? labelEl.textContent : '').trim().toLowerCase();
            const route    = ROUTES[rawLabel];

            if (route) item.setAttribute('href', route);

            const isActive = Boolean(route) && currentPath === route.toLowerCase();
            item.classList.toggle('active', isActive);
            swapIcon(item, isActive);

            item.addEventListener('click', function () {
                if (window.innerWidth <= 768) {
                    const sb = document.querySelector('.sidebar');
                    if (sb) sb.classList.remove('mobile-open');
                }
            });
        });
    }

    /* ── Icon swap ──────────────────────────────────────────── */
    function swapIcon(item, isActive) {
        const icon = item.querySelector('.nav-icon');
        if (!icon) return;

        const src        = icon.getAttribute('src') || '';
        const fileName   = src.split('/').pop() || '';
        const dot        = fileName.lastIndexOf('.');
        const base       = dot >= 0 ? fileName.slice(0, dot) : fileName;
        const ext        = dot >= 0 ? fileName.slice(dot) : '';
        const normalBase = base.endsWith('-active') ? base.slice(0, -7) : base;

        if (!ACTIVE_ICON_CAPABLE.has(normalBase)) return;

        const folder  = src.substring(0, src.lastIndexOf('/') + 1);
        const newFile = isActive ? (normalBase + '-active' + ext) : (normalBase + ext);
        icon.setAttribute('src', folder + newFile);
    }

    /* ── Expand / collapse ──────────────────────────────────── */
    function wireExpand(sidebar) {
        sidebar.addEventListener('click', function (e) {
            if (window.innerWidth <= 768) return;
            if (e.target.closest('.nav-item') || e.target.closest('#sidebar-toggle')) return;
            sidebar.classList.toggle('expanded');
            syncToggleState(sidebar);
        });

        document.addEventListener('click', function (e) {
            if (window.innerWidth > 768) return;
            if (!sidebar.contains(e.target)) sidebar.classList.remove('mobile-open');
        });

        window.addEventListener('resize', function () {
            if (window.innerWidth > 768) sidebar.classList.remove('mobile-open');
            syncToggleState(sidebar);
        });
    }

    function syncToggleState(sidebar) {
        const btn = document.getElementById('sidebar-toggle');
        if (!btn) return;
        const isOpen = sidebar.classList.contains('expanded') ||
                       sidebar.classList.contains('mobile-open');
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

}());
/**
 * BVetter – auth.js  (shared/js/auth.js)
 * ─────────────────────────────────────────────────────────────
 * Single source of truth for authentication + role routing.
 *
 * ROLES
 *   'vet'   → /vet/html/index.html
 *   'admin' → /admin/pages/index.html
 *   'owner' → /public/pages/landing.html
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

/* ── Constants ─────────────────────────────────────────────── */
const SESSION_KEY = 'vbetter_session';

const ROLE_ROUTES = {
    vet:   '/vet/html/index.html',
    admin: '/admin/pages/index.html',
    owner: '/public/pages/landing.html'
};

const LOGIN_PAGE = '/public/pages/login.html';
const ADMIN_LOGIN_PAGE = '/admin/pages/ops-3bab26d632.html';
const SESSION_API = '/api/auth/session.php';
const SESSION_CHECK_INTERVAL_MS = 10000;

/* ── App base path ──────────────────────────────────────────────
   Every path in this file, and in api.js / vet-api.js, is written
   root-absolute ('/api/...'). That only resolves when the app IS the
   document root. Served from a subfolder — XAMPP's
   /final-VBETTER/bvetter/, or reached over a LAN IP — every one of
   them 404s, which took the whole backend and all session
   enforcement with it.

   Derive the prefix from where this script itself was loaded from,
   so it is correct wherever the app is mounted, and empty (a no-op)
   when the app really is at the root. */
const APP_BASE = (function () {
    const script = document.currentScript
        || Array.prototype.slice.call(document.scripts)
              .find(s => s.src && /\/shared\/js\/auth\.js/.test(s.src));
    if (script && script.src) {
        return new URL(script.src, location.href).pathname
            .replace(/\/shared\/js\/auth\.js.*$/, '');
    }
    return location.pathname.replace(/\/(public|admin|vet|shared)\/.*$/, '');
})();

/** Prefixes a root-absolute app path with the base. No-op at the root. */
function withBase(path) {
    if (!APP_BASE || typeof path !== 'string') return path;
    if (path.charAt(0) !== '/' || path.charAt(1) === '/') return path;
    if (path.indexOf(APP_BASE + '/') === 0) return path;
    return APP_BASE + path;
}

/** Which login page a given (possibly stale/unknown) role should land on. */
function loginPageFor(role) {
    return withBase(role === 'admin' ? ADMIN_LOGIN_PAGE : LOGIN_PAGE);
}

/* ── fetch() wrapper ────────────────────────────────────────────
   Two jobs, both applied to every same-origin request:

   1. Rebase root-absolute paths onto APP_BASE. Doing it here fixes
      all 51+ '/api/...' call sites in api.js, plus the direct
      fetch('/api/...') calls scattered through the page scripts,
      without editing any of them.

   2. Attach the bearer token. Server-side role guards
      (api/config/auth_guard.php) identify the caller by the
      Authorization header and not every call site sets it. Call
      sites that do set it are left untouched. */
(function () {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        try {
            if (typeof input === 'string') {
                input = withBase(input);
            }
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            const sameOriginApi = url.indexOf('/api/') !== -1 && !/^https?:\/\//i.test(url);
            const token = sessionStorage.getItem('bvetter_token');
            if (token && sameOriginApi) {
                init = init ? { ...init } : {};
                const headers = new Headers(init.headers || {});
                if (!headers.has('Authorization')) {
                    headers.set('Authorization', 'Bearer ' + token);
                }
                init.headers = headers;
            }
        } catch {
            // Never break a request over header injection.
        }
        return nativeFetch(input, init);
    };
})();

/* ── Session helpers ────────────────────────────────────────── */
function getSession() {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

/**
 * Self-contained confirm modal (styles injected once) used in place of the
 * native window.confirm() dialog — works identically on every page since it
 * doesn't depend on that page's stylesheet.
 */
function vbConfirm(message, confirmLabel) {
    return new Promise((resolve) => {
        let overlay = document.getElementById('vbConfirmOverlay');
        if (!overlay) {
            const style = document.createElement('style');
            style.textContent = `
                #vbConfirmOverlay { position:fixed; inset:0; z-index:9999; display:none;
                    align-items:center; justify-content:center; background:rgba(15,23,42,0.55); }
                #vbConfirmOverlay .vb-confirm-box { background:#fff; border-radius:16px; padding:28px 32px;
                    text-align:center; max-width:340px; box-shadow:0 20px 60px rgba(0,0,0,0.25); font-family:inherit; }
                #vbConfirmOverlay .vb-confirm-msg { color:#1f2937; font-size:15px; font-weight:600; margin-bottom:20px; }
                #vbConfirmOverlay .vb-confirm-actions { display:flex; gap:12px; justify-content:center; }
                #vbConfirmOverlay button { border:none; border-radius:8px; padding:10px 20px;
                    font-weight:700; font-size:14px; cursor:pointer; font-family:inherit; }
                #vbConfirmOverlay .vb-confirm-yes { background:#00B928; color:#fff; }
                #vbConfirmOverlay .vb-confirm-no { background:#eef2f7; color:#1f2937; }
            `;
            document.head.appendChild(style);
            overlay = document.createElement('div');
            overlay.id = 'vbConfirmOverlay';
            document.body.appendChild(overlay);
        }

        overlay.innerHTML = `
            <div class="vb-confirm-box">
                <div class="vb-confirm-msg"></div>
                <div class="vb-confirm-actions">
                    <button type="button" class="vb-confirm-no">Cancel</button>
                    <button type="button" class="vb-confirm-yes">${confirmLabel || 'Confirm'}</button>
                </div>
            </div>
        `;
        overlay.querySelector('.vb-confirm-msg').textContent = message;
        overlay.style.display = 'flex';

        const cleanup = (result) => {
            overlay.style.display = 'none';
            resolve(result);
        };
        overlay.querySelector('.vb-confirm-yes').addEventListener('click', () => cleanup(true), { once: true });
        overlay.querySelector('.vb-confirm-no').addEventListener('click', () => cleanup(false), { once: true });
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) cleanup(false);
        }, { once: true });
    });
}

/**
 * Self-contained alert modal (styles injected once) used in place of the
 * native window.alert() dialog — same look as vbConfirm, single "OK" button.
 * Works identically on every page since it doesn't depend on that page's
 * stylesheet.
 */
function vbAlert(message, okLabel) {
    return new Promise((resolve) => {
        let overlay = document.getElementById('vbAlertOverlay');
        if (!overlay) {
            const style = document.createElement('style');
            style.textContent = `
                #vbAlertOverlay { position:fixed; inset:0; z-index:9999; display:none;
                    align-items:center; justify-content:center; background:rgba(15,23,42,0.55); }
                #vbAlertOverlay .vb-alert-box { background:#fff; border-radius:16px; padding:28px 32px;
                    text-align:center; max-width:340px; box-shadow:0 20px 60px rgba(0,0,0,0.25); font-family:inherit; }
                #vbAlertOverlay .vb-alert-msg { color:#1f2937; font-size:15px; font-weight:600; margin-bottom:20px;
                    white-space:pre-line; }
                #vbAlertOverlay .vb-alert-ok { border:none; border-radius:8px; padding:10px 24px;
                    font-weight:700; font-size:14px; cursor:pointer; font-family:inherit; background:#00B928; color:#fff; }
            `;
            document.head.appendChild(style);
            overlay = document.createElement('div');
            overlay.id = 'vbAlertOverlay';
            document.body.appendChild(overlay);
        }

        overlay.innerHTML = `
            <div class="vb-alert-box">
                <div class="vb-alert-msg"></div>
                <button type="button" class="vb-alert-ok">${okLabel || 'OK'}</button>
            </div>
        `;
        overlay.querySelector('.vb-alert-msg').textContent = message;
        overlay.style.display = 'flex';

        const cleanup = () => {
            overlay.style.display = 'none';
            resolve();
        };
        overlay.querySelector('.vb-alert-ok').addEventListener('click', cleanup, { once: true });
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) cleanup();
        }, { once: true });
    });
}

function setSession(session) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('bvetter_token');
    sessionStorage.removeItem('bvetter_user');
}

/**
 * Asks the server whether this device's session is still valid.
 * Called on every protected page load and polled while the page stays
 * open, so an admin ending a session from Manage Security actually logs
 * the other device out — not just a local-storage flag.
 */
async function verifySessionWithServer() {
    const token = sessionStorage.getItem('bvetter_token');
    if (!token) return;

    try {
        const body = new FormData();
        body.append('action', 'check');
        const res = await fetch(SESSION_API, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body
        });
        const data = await res.json();
        if (!data.valid) {
            const role = getSession()?.role;
            clearSession();
            window.location.replace(loginPageFor(role));
        }
    } catch {
        // Network hiccup — don't force a logout over a dropped request.
    }
}

let sessionPollingStarted = false;
function startSessionPolling() {
    if (sessionPollingStarted) return;
    sessionPollingStarted = true;
    verifySessionWithServer();
    setInterval(verifySessionWithServer, SESSION_CHECK_INTERVAL_MS);

    // Background tabs get their setInterval throttled by the browser (can
    // stretch well past 30s), so a revoked session might not visibly log
    // the tab out until the timer eventually fires. Re-check immediately
    // whenever the tab regains focus/visibility so switching back to it
    // reflects the current state right away instead of needing a refresh.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') verifySessionWithServer();
    });
    window.addEventListener('focus', verifySessionWithServer);
}

/* ── Public API ─────────────────────────────────────────────── */

/** Returns { userId, role, name, token } or null */
function getCurrentUser() {
    return getSession();
}

/** Logs out and redirects to login */
async function logout() {
    const confirmed = await vbConfirm('Are you sure you want to log out?', 'Log Out');
    if (!confirmed) return;

    const role = getSession()?.role;
    const token = sessionStorage.getItem('bvetter_token');
    if (token) {
        try {
            const body = new FormData();
            body.append('action', 'logout');
            await fetch(SESSION_API, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                body
            });
        } catch {
            // Best-effort — still clear locally and redirect even if this fails.
        }
    }
    clearSession();
    window.location.href = loginPageFor(role);
}

/**
 * Page guard — call at top of every protected page.
 * @param {string[]} allowedRoles e.g. ['vet'] or ['admin','vet']
 *
 * NOTE: Admin has a superset role. Pass allowedRoles normally;
 * the function automatically grants admin access to any page
 * that allows at least one authenticated role.
 */
function requireAuth(allowedRoles = []) {
    const session = getSession();

    if (!session || !session.role) {
        // Admin-only pages (requireAuth(['admin'])) send an unauthenticated
        // visitor straight to the hidden admin login rather than the public
        // one, which no longer accepts admin credentials at all.
        const isAdminOnlyPage = allowedRoles.length === 1 && allowedRoles[0] === 'admin';
        window.location.replace(withBase(isAdminOnlyPage ? ADMIN_LOGIN_PAGE : LOGIN_PAGE));
        return;
    }

    startSessionPolling();

    // Admin can access any protected page (except owner-only public pages)
    if (session.role === 'admin') return;

    if (allowedRoles.length && !allowedRoles.includes(session.role)) {
        const route = ROLE_ROUTES[session.role] || LOGIN_PAGE;
        window.location.replace(withBase(route));
    }
}

function redirectToDashboard(role) {
    const route = ROLE_ROUTES[role] || LOGIN_PAGE;
    window.location.href = withBase(route);
}

/** Root index.html auto-router */
function autoRoute() {
    const session = getSession();
    if (session && session.role) {
        redirectToDashboard(session.role);
    } else {
        window.location.replace(withBase(LOGIN_PAGE));
    }
}

/* ── Exports ────────────────────────────────────────────────── */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getCurrentUser, requireAuth, logout, redirectToDashboard, autoRoute, getSession };
} else {
    window.VBetterAuth = { getCurrentUser, requireAuth, logout, redirectToDashboard, autoRoute, getSession };
}

/**
 * Start enforcing session revocation the moment this script loads on any
 * page — not only pages that remember to call requireAuth(). Several pages
 * (e.g. public/pages/landing.html, most vet/html/*.html) never call it or
 * have the call commented out, which meant a session an admin ended from
 * Manage Security was only actually enforced on the couple of pages that
 * did call it (e.g. vet/html/index.html) — everyone else stayed logged in.
 */
if (typeof window !== 'undefined' && getSession()) {
    startSessionPolling();
}

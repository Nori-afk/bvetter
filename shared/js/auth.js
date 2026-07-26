/**
 * VBetter – auth.js  (shared/js/auth.js)
 * ─────────────────────────────────────────────────────────────
 * Single source of truth for authentication + role routing.
 *
 * ROLES
 *   'vet'   → /vet/html/index.html
 *   'admin' → /admin/pages/index.html
 *   'owner' → /public/pages/landing.html
 *
 * [BACKEND] markers = replace with real fetch() calls later.
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
const SESSION_API = '/api/auth/session.php';
const SESSION_CHECK_INTERVAL_MS = 30000;

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
            clearSession();
            window.location.replace(LOGIN_PAGE);
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
    window.location.href = LOGIN_PAGE;
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
        window.location.replace(LOGIN_PAGE);
        return;
    }

    startSessionPolling();

    // Admin can access any protected page (except owner-only public pages)
    if (session.role === 'admin') return;

    if (allowedRoles.length && !allowedRoles.includes(session.role)) {
        const route = ROLE_ROUTES[session.role] || LOGIN_PAGE;
        window.location.replace(route);
    }
}

/**
 * Login attempt.
 * [BACKEND] Replace mock with:
 *   const res = await fetch('/api/auth/login', { method:'POST', ... });
 *   const data = await res.json(); // { userId, role, name, token }
 */
async function login(email, password) {
    /* ── MOCK (remove when backend is ready) ── */
    // const MOCK_USERS = [
    //     { email: 'vet@vbetter.ph',   password: 'vet123',   userId: 'U-001', role: 'vet',   name: 'Dr. Kizea Bien Igaya', avatarUrl: '' },
    //     { email: 'admin@vbetter.ph', password: 'admin123', userId: 'U-002', role: 'admin', name: 'Admin User',           avatarUrl: '' },
    //     { email: 'owner@vbetter.ph', password: 'owner123', userId: 'U-003', role: 'owner', name: 'Pet Owner',            avatarUrl: '' },
    //     // login.js test credentials
    //     { email: 'vet@test.com',     password: 'vet123',   userId: 'U-001', role: 'vet',   name: 'Dr. Aris V.',          avatarUrl: '' },
    //     { email: 'admin@test.com',   password: 'admin123', userId: 'U-002', role: 'admin', name: 'Admin User',           avatarUrl: '' },
    //     { email: 'owner@test.com',   password: 'owner123', userId: 'U-003', role: 'owner', name: 'Mark Depa',            avatarUrl: '' },
    // ];

    const match = MOCK_USERS.find(
        u => u.email === email.trim().toLowerCase() && u.password === password
    );

    if (!match) return { ok: false, error: 'Invalid email or password.' };

    const session = {
        userId:    match.userId,
        role:      match.role,
        name:      match.name,
        avatarUrl: match.avatarUrl,
        token:     `mock-token-${Date.now()}` // [BACKEND] real JWT
    };

    setSession(session);
    return { ok: true, session };
    /* ── END MOCK ── */
}

function redirectToDashboard(role) {
    const route = ROLE_ROUTES[role] || LOGIN_PAGE;
    window.location.href = route;
}

/** Root index.html auto-router */
function autoRoute() {
    const session = getSession();
    if (session && session.role) {
        redirectToDashboard(session.role);
    } else {
        window.location.replace(LOGIN_PAGE);
    }
}

/* ── Exports ────────────────────────────────────────────────── */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getCurrentUser, requireAuth, login, logout, redirectToDashboard, autoRoute, getSession };
} else {
    window.VBetterAuth = { getCurrentUser, requireAuth, login, logout, redirectToDashboard, autoRoute, getSession };
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

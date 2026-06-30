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
    vet:   '/Final-Backend/vet/html/index.html',
    admin: '/Final-Backend/admin/pages/index.html',
    owner: '/Final-Backend/public/pages/landing.html'
};

const LOGIN_PAGE = '/Final-Backend/public/pages/login.html';

/* ── Session helpers ────────────────────────────────────────── */
function getSession() {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        console.log(raw)
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function setSession(session) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
}

/* ── Public API ─────────────────────────────────────────────── */

/** Returns { userId, role, name, token } or null */
function getCurrentUser() {
    return getSession();
}

/** Logs out and redirects to login */
function logout() {
    clearSession();
    // [BACKEND] POST /api/auth/logout
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

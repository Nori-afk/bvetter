/* =============================================
   BVETTER — Auth & Role Guard
   File: shared/js/auth.js

   INCLUDE THIS FIRST on every protected page,
   before any other script.

   Path from public/pages/  → ../../shared/js/auth.js
   Path from vet/html/      → ../../shared/js/auth.js
   Path from admin/pages/   → ../../shared/js/auth.js

   ROLES:
     'pet_owner' → public/ pages only
     'vet_staff' → vet/ pages only
     'admin'     → admin/ pages + can view public/

   HOW IT WORKS NOW (frontend mock for demo):
     Reads user object from sessionStorage.
     guardPage([ROLES.VET_STAFF]) at top of vet pages.
     Wrong role → redirected to their own home.

   WHEN BACKEND IS READY:
     Replace sessionStorage mock with JWT token decode.
     Real security = backend middleware, not this file.
     This file is a UX guard only.

   Functions:
   - getCurrentUser()        → user object or null
   - getCurrentRole()        → role string or null
   - guardPage(allowedRoles) → redirect if wrong role
   - redirectToHome(role)    → go to role's home page
   - loginAs(userData)       → save session + redirect
   - logout()                → clear session + go login
   ============================================= */

const ROLES = {
  PET_OWNER: 'pet_owner',
  VET_STAFF: 'vet_staff',
  ADMIN:     'admin'
};

/* ── Home page per role ───────────────────────
   Update these paths if folder names change.    */
const HOME_URLS = {
  [ROLES.PET_OWNER]: '/final-VBETTER/bvetter/public/pages/landing.html',
  [ROLES.VET_STAFF]: '/final-VBETTER/bvetter/vet/html/index.html',
  [ROLES.ADMIN]:     '/final-VBETTER/bvetter/admin/pages/index.html'
};

const LOGIN_URL = '/final-VBETTER/bvetter/public/pages/login.html';

/* ── Get current user ─────────────────────────
   TODO backend: decode from JWT instead of
   reading sessionStorage                        */
function getCurrentUser() {
  try {
    const raw = sessionStorage.getItem('bvetter_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getCurrentRole() {
  const user = getCurrentUser();
  return user ? user.role : null;
}

/* ── Route guard ──────────────────────────────
   Call at top of every protected page.

   Examples:
   guardPage([ROLES.PET_OWNER]);
   guardPage([ROLES.VET_STAFF]);
   guardPage([ROLES.ADMIN]);
   guardPage([ROLES.VET_STAFF, ROLES.ADMIN]);    */
function guardPage(allowedRoles) {
  const role = getCurrentRole();
  if (!role) {
    window.location.replace(LOGIN_URL);
    return;
  }
  if (!allowedRoles.includes(role)) {
    redirectToHome(role);
  }
}

function redirectToHome(role) {
  window.location.replace(HOME_URLS[role] || LOGIN_URL);
}

/* ── Login — saves user, redirects by role ────
   Call this from login.js on successful auth.
   userData = { id, name, role, token }

   TODO backend: userData comes from api.login()
   response. Pass the real token here.           */
function loginAs(userData) {
  sessionStorage.setItem('bvetter_user',  JSON.stringify(userData));
  sessionStorage.setItem('bvetter_token', userData.token || '');
  redirectToHome(userData.role);
}

/* ── Logout ───────────────────────────────────
   TODO backend: call api.logout() first to
   invalidate the token on the server, then clear. */
function logout() {
  if (!window.confirm('Are you sure you want to log out?')) return;

  sessionStorage.removeItem('bvetter_user');
  sessionStorage.removeItem('bvetter_token');
  window.location.replace(LOGIN_URL);
}

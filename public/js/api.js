/* =============================================
   BVETTER — Centralized API Layer
   File: js/api.js
   Depends: nothing (load before all page JS)

   RULE: ALL fetch() calls live here ONLY.
   Never write fetch() directly in page JS files.

   HOW TO USE in any page JS:
     const data = await api.getReports({ status: 'lost' });

   HOW TO SWAP TO REAL BACKEND:
     1. Change API_BASE to your production URL
     2. On login success, save token:
        sessionStorage.setItem('bvetter_token', response.token)
     3. All other calls auto-attach the token via authHeaders()

   Functions:
   - authHeaders()          — builds Authorization header from token
   - api.login()            — POST /auth/login
   - api.logout()           — POST /auth/logout
   - api.register()         — POST /auth/register
   - api.forgotPassword()   — POST /auth/forgot-password
   - api.getReports()       — GET  /reports (with filters)
   - api.getReportById()    — GET  /reports/:id
   - api.getMyReports()     — GET  /reports/mine
   - api.getMatchesByReportId() — GET /reports/:id/matches
   - api.submitReport()     — POST /reports/lost or /reports/found
   - api.submitSighting()   — POST /sightings
   - api.getClaims()        — GET  /claims
   - api.submitClaim()      — POST /claims
   - api.resolveClaim()     — PATCH /claims/:id/resolve
   - api.getAppointments()  — GET  /appointments
   - api.bookAppointment()  — POST /appointments
   - api.getProfile()       — GET  /user/profile
   - api.updateProfile()    — PATCH /user/profile
   - api.changePassword()   — PATCH /user/password
   - api.getNotifPrefs()    — GET  /notifications/preferences
   - api.updateNotifPrefs() — PATCH /notifications/preferences
   ============================================= */

/* ── Base URL ─────────────────────────────────
   TODO: Change to production URL before deploy   */
const API_BASE = 'http://localhost:8000/api';
const API_BASE_REG = 'http://localhost/final-VBETTER/bvetter/api';
const LOST_FOUND_ENDPOINT = `${API_BASE_REG}/lost-found/lost_and_found.php`;
const PROFILE_ENDPOINT = `${API_BASE_REG}/users/profile.php`;
const DASHBOARD_ENDPOINT = `${API_BASE_REG}/dashboard/dashboard.php`;
const MASS_VACCINATION_ENDPOINT = `${API_BASE_REG}/mass-vaccination/events.php`;
const CHATBOT_ENDPOINT = `${API_BASE_REG}/chatbot/chatbot.php`;
const ANNOUNCEMENTS_ENDPOINT = `${API_BASE_REG}/announcements/announcements.php`;
const SITE_SETTINGS_ENDPOINT = `${API_BASE_REG}/site-settings/site-settings.php`;
const NOTIFICATIONS_ENDPOINT = `${API_BASE_REG}/notifications/notifications.php`;

/* ── Auth Header Builder ──────────────────────
   Reads JWT token saved on login.
   Backend must return { token: '...' } on login. */
function authHeaders() {
  const token = sessionStorage.getItem('bvetter_token');
  return token
    ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

/* ── Auth header for FormData (file uploads) ──
   Do NOT set Content-Type — browser sets it
   automatically with the correct boundary.       */
function authHeadersFormData() {
  const token = sessionStorage.getItem('bvetter_token');
  return token ? { 'Authorization': 'Bearer ' + token } : {};
}

function currentSession() {
  try {
    return JSON.parse(sessionStorage.getItem('vbetter_session') || 'null');
  } catch {
    return null;
  }
}

function profileRequest(action, data = {}) {
  const session = currentSession();
  return fetch(PROFILE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      user_id: data.user_id || data.userId || session?.userId || session?.id || 0,
      ...data
    })
  }).then(r => r.json());
}

function lostFoundForm(action, data = {}) {
  const formData = data instanceof FormData ? data : new FormData();
  formData.append('action', action);

  if (!(data instanceof FormData)) {
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, value);
      }
    });
  }

  const session = currentSession();
  if (session?.userId && !formData.has('user_id')) formData.append('user_id', session.userId);
  if (session?.userId && !formData.has('owner_id')) formData.append('owner_id', session.userId);
  if (session?.role && !formData.has('role')) formData.append('role', session.role);
  return formData;
}

function lostFoundRequest(action, data = {}) {
  return fetch(LOST_FOUND_ENDPOINT, {
    method: 'POST',
    body: lostFoundForm(action, data)
  }).then(r => r.json());
}

const api = {

  getDashboard: (scope = 'vet') =>
    fetch(`${DASHBOARD_ENDPOINT}?scope=${encodeURIComponent(scope)}`)
      .then(r => r.json()),

  getVetDashboard: () =>
    api.getDashboard('vet'),

  getAdminDashboard: () =>
    api.getDashboard('admin'),

  getMassVaccinationEvents: () =>
    fetch(MASS_VACCINATION_ENDPOINT, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action: 'list' })
    }).then(r => r.json()),

  createMassVaccinationEvent: (data) =>
    fetch(MASS_VACCINATION_ENDPOINT, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action: 'create', ...data })
    }).then(r => r.json()),

  getChatbotDashboardStats: () =>
    fetch(CHATBOT_ENDPOINT, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action: 'dashboard_stats' })
    }).then(r => r.json()),

  getAnnouncements: (filters = {}) =>
    fetch(ANNOUNCEMENTS_ENDPOINT, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action: 'list', ...filters })
    }).then(r => r.json()),

  saveAnnouncement: (data) => {
    const isForm = data instanceof FormData;
    if (isForm && !data.has('action')) data.append('action', data.get('id') ? 'update' : 'create');
    return fetch(ANNOUNCEMENTS_ENDPOINT, {
      method: 'POST',
      headers: isForm ? authHeadersFormData() : authHeaders(),
      body: isForm ? data : JSON.stringify({ action: data.id ? 'update' : 'create', ...data })
    }).then(r => r.json());
  },

  deleteAnnouncement: (id) =>
    fetch(ANNOUNCEMENTS_ENDPOINT, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action: 'delete', id })
    }).then(r => r.json()),

  /**
   * Get public site branding/profile settings (logo, color, contact info, etc.)
   */
  getSiteSettings: () =>
    fetch(SITE_SETTINGS_ENDPOINT, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action: 'get' })
    }).then(r => r.json()),

  /**
   * Save site branding/profile settings
   * @param {FormData} formData — text fields + optional image files
   */
  saveSiteSettings: (formData) => {
    formData.append('action', 'save');
    return fetch(SITE_SETTINGS_ENDPOINT, {
      method: 'POST',
      headers: authHeadersFormData(),
      body: formData
    }).then(r => r.json());
  },

  /* ══════════════════════════════════════════
     AUTH
     ══════════════════════════════════════════ */

  /**
   * Login user
   * TODO: On success → save response.token to sessionStorage
   * @param {string} email
   * @param {string} password
   */
  login: (email, password) =>
    fetch(`${API_BASE_REG}/auth/login.php`, {
      method: 'POST',
      body: (() => {
        const formData = new FormData();
        formData.append('email', email);
        formData.append('password', password);
        return formData;
      })()
    }).then(r => r.json()),

  /**
   * Logout — invalidates token on server
   */
  logout: () => {
    const body = new FormData();
    body.append('action', 'logout');
    return fetch(`${API_BASE_REG}/auth/session.php`, {
      method: 'POST',
      headers: authHeadersFormData(),
      body
    }).then(r => r.json());
  },

  /* ══════════════════════════════════════════
     SESSIONS — Manage Security page
     ══════════════════════════════════════════ */

  /** List the current user's own active sessions/devices */
  listSessions: () => {
    const body = new FormData();
    body.append('action', 'list');
    return fetch(`${API_BASE_REG}/auth/session.php`, {
      method: 'POST',
      headers: authHeadersFormData(),
      body
    }).then(r => r.json());
  },

  /** End one of the current user's other sessions */
  endSession: (sessionId) => {
    const body = new FormData();
    body.append('action', 'end');
    body.append('session_id', sessionId);
    return fetch(`${API_BASE_REG}/auth/session.php`, {
      method: 'POST',
      headers: authHeadersFormData(),
      body
    }).then(r => r.json());
  },

  /** End every session except the one making this request */
  endOtherSessions: () => {
    const body = new FormData();
    body.append('action', 'end_others');
    return fetch(`${API_BASE_REG}/auth/session.php`, {
      method: 'POST',
      headers: authHeadersFormData(),
      body
    }).then(r => r.json());
  },

  /** (Admin only) list every active session, across every user account */
  adminListSessions: () => {
    const body = new FormData();
    body.append('action', 'admin_list');
    return fetch(`${API_BASE_REG}/auth/session.php`, {
      method: 'POST',
      headers: authHeadersFormData(),
      body
    }).then(r => r.json());
  },

  /** (Admin only) end any session by id, belonging to any user */
  adminEndSession: (sessionId) => {
    const body = new FormData();
    body.append('action', 'admin_end');
    body.append('session_id', sessionId);
    return fetch(`${API_BASE_REG}/auth/session.php`, {
      method: 'POST',
      headers: authHeadersFormData(),
      body
    }).then(r => r.json());
  },

  /** (Admin only) end every session system-wide except the caller's own */
  adminEndOtherSessions: () => {
    const body = new FormData();
    body.append('action', 'admin_end_others');
    return fetch(`${API_BASE_REG}/auth/session.php`, {
      method: 'POST',
      headers: authHeadersFormData(),
      body
    }).then(r => r.json());
  },

  /* ══════════════════════════════════════════
     SESSIONS — Manage Security page
     ══════════════════════════════════════════ */

  /** List the current user's own active sessions/devices */
  listSessions: () => {
    const body = new FormData();
    body.append('action', 'list');
    return fetch(`${API_BASE_REG}/auth/session.php`, {
      method: 'POST',
      headers: authHeadersFormData(),
      body
    }).then(r => r.json());
  },

  /** End one of the current user's other sessions */
  endSession: (sessionId) => {
    const body = new FormData();
    body.append('action', 'end');
    body.append('session_id', sessionId);
    return fetch(`${API_BASE_REG}/auth/session.php`, {
      method: 'POST',
      headers: authHeadersFormData(),
      body
    }).then(r => r.json());
  },

  /** End every session except the one making this request */
  endOtherSessions: () => {
    const body = new FormData();
    body.append('action', 'end_others');
    return fetch(`${API_BASE_REG}/auth/session.php`, {
      method: 'POST',
      headers: authHeadersFormData(),
      body
    }).then(r => r.json());
  },

  /** (Admin only) list every active session, across every user account */
  adminListSessions: () => {
    const body = new FormData();
    body.append('action', 'admin_list');
    return fetch(`${API_BASE_REG}/auth/session.php`, {
      method: 'POST',
      headers: authHeadersFormData(),
      body
    }).then(r => r.json());
  },

  /** (Admin only) end any session by id, belonging to any user */
  adminEndSession: (sessionId) => {
    const body = new FormData();
    body.append('action', 'admin_end');
    body.append('session_id', sessionId);
    return fetch(`${API_BASE_REG}/auth/session.php`, {
      method: 'POST',
      headers: authHeadersFormData(),
      body
    }).then(r => r.json());
  },

  /** (Admin only) end every session system-wide except the caller's own */
  adminEndOtherSessions: () => {
    const body = new FormData();
    body.append('action', 'admin_end_others');
    return fetch(`${API_BASE_REG}/auth/session.php`, {
      method: 'POST',
      headers: authHeadersFormData(),
      body
    }).then(r => r.json());
  },

  /**
   * Register new account
   * @param {Object} data — { full_name, email, password, barangay, phone_number }
   */
  register: (data) =>
    fetch(`${API_BASE_REG}/auth/register.php`, {
      method: 'POST',
      body: data
    }).then(r => r.json()),

  /**
   * Send password reset link
   * @param {string} email
   */
forgotPassword: (email) => {
  const body = new FormData();
  body.append('action', 'forgot_password');
  body.append('email', email);
  return fetch(`${API_BASE_REG}/admin/verify-contact.php`, {
    method: 'POST',
    body
  }).then(r => r.json());
},

  /* ══════════════════════════════════════════
     LOST & FOUND — REPORTS
     ══════════════════════════════════════════ */

  /**
   * Get all reports (with optional filters)
   * @param {Object} filters — { status, barangay, type, date }
   * Replaces: const petData = [...] in lost-found.js
   */
  getReports: (filters = {}) =>
    lostFoundRequest('list', filters),

  /**
   * Get single report — used in lost-found-detail.html
   * @param {string} id — report ID from URL ?id=
   */
  getReportById: (id) =>
    lostFoundRequest('get', { report_id: id }),

  /**
   * Get current user's own reports — My Reports tab
   */
  getMyReports: () =>
    lostFoundRequest('my_reports'),
  getTotalReports: () =>
    lostFoundRequest('get_total_reports'),
  getActiveReports: () =>
    lostFoundRequest('get_active_reports'),
  /**
   * Get Jaccard Similarity matches for a lost report
   * @param {string} reportId
   */
  getMatchesByReportId: (reportId) =>
    lostFoundRequest('matches', { report_id: reportId, include_resolved: 1 }),

  /**
   * Submit lost or found report (includes photo upload)
   * @param {string} type — 'lost' | 'found'
   * @param {FormData} formData — use FormData, NOT JSON (photo upload)
   */
  submitReport: (type, formData) => {
    formData.append('type', type);
    return lostFoundRequest('create_report', formData);
  },


  /* ══════════════════════════════════════════
     SIGHTINGS
     ══════════════════════════════════════════ */

  /**
   * Submit a sighting report (optional photo)
   * @param {FormData} formData
   */
  submitSighting: (formData) =>
    lostFoundRequest('submit_sighting', formData),


  /* ══════════════════════════════════════════
     CLAIMS — My Claims page
     ══════════════════════════════════════════ */

  /**
   * Get all claims by current user — My Claims tab
   * Replaces: static rows in my-claims.html
   */
  getClaims: (filters = {}) =>
    lostFoundRequest('list_claims', filters),

  /**
   * Submit ownership claim with proof documents
   * @param {string} reportId — which found-pet report to claim
   * @param {FormData} formData — includes proof files
   */
  submitClaim: (reportId, formData) => {
    formData.append('report_id', reportId);
    return lostFoundRequest('submit_claim', formData);
  },

  /**
   * Mark a claim as resolved (pet returned home)
   * @param {string} claimId
   */
  resolveClaim: (claimId) =>
    lostFoundRequest('resolve_claim', { claim_id: claimId }),

  vetLostFoundReports: (filters = {}) =>
    lostFoundRequest('management_list', filters),

  approveLostFoundReport: (reportId, reviewNotes = '') =>
    lostFoundRequest('approve_report', { report_id: reportId, review_notes: reviewNotes }),

  rejectLostFoundReport: (reportId, reviewNotes = '') =>
    lostFoundRequest('reject_report', { report_id: reportId, review_notes: reviewNotes }),

  resolveLostFoundReport: (reportId, reviewNotes = '') =>
    lostFoundRequest('resolve_report', { report_id: reportId, review_notes: reviewNotes }),

  lostFoundMatches: (reportId = '') =>
    lostFoundRequest('matches', reportId ? { report_id: reportId } : {}),

  approveLostFoundMatch: (matchId) =>
    lostFoundRequest('approve_match', { match_id: matchId }),

  dismissLostFoundMatch: (matchId) =>
    lostFoundRequest('dismiss_match', { match_id: matchId }),

  vetLostFoundSightings: (filters = {}) =>
    lostFoundRequest('list_sightings', filters),

  approveLostFoundSighting: (sightingId, reviewNotes = '') =>
    lostFoundRequest('approve_sighting', { sighting_id: sightingId, review_notes: reviewNotes }),

  rejectLostFoundSighting: (sightingId, reviewNotes = '') =>
    lostFoundRequest('reject_sighting', { sighting_id: sightingId, review_notes: reviewNotes }),

  vetLostFoundClaims: (filters = {}) =>
    lostFoundRequest('management_claims', filters),

  approveLostFoundClaim: (claimId, reviewNotes = '') =>
    lostFoundRequest('approve_claim', { claim_id: claimId, review_notes: reviewNotes }),

  rejectLostFoundClaim: (claimId, reviewNotes = '') =>
    lostFoundRequest('reject_claim', { claim_id: claimId, review_notes: reviewNotes }),


  /* ══════════════════════════════════════════
     APPOINTMENTS
     ══════════════════════════════════════════ */

  /**
   * Get all appointments for current user
   * Replaces: static appt rows in book-appointment.html
   */
  getAppointments: (filters = {}) => {
    const formData = new FormData();
    formData.append('action', 'list');
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, value);
      }
    });
    return fetch(`${API_BASE_REG}/appointments/appointment.php`, {
      method: 'POST',
      body: formData
    }).then(r => r.json());
  },

  /**
   * Book a new appointment
   * @param {Object} data — { owner, pet, visit_type, date, time, notes }
   */
  bookAppointment: (data) =>
    fetch(`${API_BASE_REG}/appointments/appointment.php`, {
      method: 'POST',
      body: JSON.stringify(data)
    }).then(r => r.json()),

  getVets: () => {
    const formData = new FormData();
    formData.append('action', 'vets');
    return fetch(`${API_BASE_REG}/appointments/appointment.php`, {
      method: 'POST',
      body: formData
    }).then(r => r.json());
  },


  /* ══════════════════════════════════════════
     USER / ACCOUNT
     ══════════════════════════════════════════ */

  /**
   * Get logged-in user profile
   * Replaces: hardcoded 'Mark Depa' everywhere
   */
  getProfile: () =>
    profileRequest('get'),

  /**
   * Update profile info (name, email, phone)
   * @param {Object} data
   */
  updateProfile: (data) =>
    profileRequest('update', data),

  /**
   * Change password
   * @param {Object} data — { current_password, new_password }
   */
  changePassword: (data) =>
    profileRequest('password', data),


  /* ══════════════════════════════════════════
     NOTIFICATIONS
     ══════════════════════════════════════════ */

  /**
   * Get notification preferences
   */
  getNotifPrefs: () =>
    profileRequest('get').then(result => ({
      ...result,
      data: result.data?.notifications || {}
    })),

  /**
   * Save notification preferences
   * @param {Object} data — { lost_found: { email, sms, app }, ... }
   */
  updateNotifPrefs: (data) =>
    profileRequest('preferences', data),

    getBarangays: () =>
  fetch(`${API_BASE_REG}/barangays/list.php`)
    .then(r => r.json()),


  allUsers: () => {
    const formData = new FormData();
    formData.append('action', 'list');
    return fetch(`${API_BASE_REG}/admin/account-management.php`, {
      method: 'POST',
      body: formData
    }).then(r => r.json());
  },

  accountRoles: () => {
    const formData = new FormData();
    formData.append('action', 'roles');
    return fetch(`${API_BASE_REG}/admin/account-management.php`, {
      method: 'POST',
      body: formData
    }).then(r => r.json());
  },

  createAccountUser: (data) => {
    data.append('action', 'create');
    return fetch(`${API_BASE_REG}/admin/account-management.php`, {
      method: 'POST',
      body: data
    }).then(r => r.json());
  },

  approveUser: (userId) => {
    const formData = new FormData();
    formData.append('action', 'approve');
    formData.append('user_id', userId);
    return fetch(`${API_BASE_REG}/admin/account-management.php`, {
      method: 'POST',
      body: formData
    }).then(r => r.json());
  },

  rejectUser: (userId, reviewNotes = '') => {
    const formData = new FormData();
    formData.append('action', 'reject');
    formData.append('user_id', userId);
    formData.append('review_notes', reviewNotes);
    return fetch(`${API_BASE_REG}/admin/account-management.php`, {
      method: 'POST',
      body: formData
    }).then(r => r.json());
  },

  updateUserStatus: (userId, status) => {
    const formData = new FormData();
    formData.append('action', 'update_status');
    formData.append('user_id', userId);
    formData.append('status', status);
    return fetch(`${API_BASE_REG}/admin/account-management.php`, {
      method: 'POST',
      body: formData
    }).then(r => r.json());
  },

  deleteUser: (userId) => {
    const formData = new FormData();
    formData.append('action', 'delete');
    formData.append('user_id', userId);
    return fetch(`${API_BASE_REG}/admin/account-management.php`, {
      method: 'POST',
      body: formData
    }).then(r => r.json());
  },

  /**
   * Shared admin/vet notification feed (api/notifications/notifications.php).
   * role: 'admin' | 'vet'
   */
  getStaffNotifications: (role) =>
    fetch(NOTIFICATIONS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', role })
    }).then(r => r.json()),

  markNotificationRead: (id) =>
    fetch(NOTIFICATIONS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_read', id })
    }).then(r => r.json()),

  markAllNotificationsRead: (role) =>
    fetch(NOTIFICATIONS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_all_read', role })
    }).then(r => r.json()),

};


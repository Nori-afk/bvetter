/**
 * VBetter – Vet API Layer
 * /final-VBETTER/bvetter/vet/js/vet-api.js
 * ─────────────────────────────────────────────────────────────
 * Centralises every fetch() call used by the vet-side pages.
 * All functions are async and return { ok, data, error }.
 *
 * BACKEND INTEGRATION
 * Change BASE_URL to your server's base URL when the backend
 * is ready.  Every function already calls the correct endpoint
 * so you only need to flip the URL and remove the mock returns.
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

const BASE_URL = '/final-VBETTER/bvetter/api';   // [BACKEND] e.g. 'https://api.vbetter.ph'
const BACKEND_URL = '/final-VBETTER/bvetter/api';
const LOST_FOUND_URL = `${BACKEND_URL}/lost-found/lost_and_found.php`;
const MASS_VACCINATION_URL = `${BACKEND_URL}/mass-vaccination/events.php`;
const CHATBOT_URL = `${BACKEND_URL}/chatbot/chatbot.php`;
const ANNOUNCEMENTS_URL = `${BACKEND_URL}/announcements/announcements.php`;

/* ── Helpers ─────────────────────────────────────────────── */

function getAuthHeaders() {
    const session = JSON.parse(sessionStorage.getItem('vbetter_session') || 'null');
    return {
        'Content-Type': 'application/json',
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {})
    };
}

async function apiFetch(endpoint, options = {}) {
    try {
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            headers: getAuthHeaders(),
            ...options
        });

        if (response.status === 401) {
            // Token expired → log out
            sessionStorage.removeItem('vbetter_session');
            window.location.href = '/final-VBETTER/bvetter/public/pages/login.html';
            return { ok: false, error: 'Unauthorised' };
        }

        const data = await response.json();
        return { ok: response.ok, data, error: response.ok ? null : (data.message || 'Request failed') };
    } catch (error) {
        return { ok: false, data: null, error: error.message };
    }
}

/* ── Dashboard ───────────────────────────────────────────── */

/** GET /final-VBETTER/bvetter/api/vet/dashboard/summary */
async function getDashboardSummary(filters = {}) {
    try {
        const params = new URLSearchParams({ scope: 'vet', ...filters }).toString();
        const response = await fetch(`${BACKEND_URL}/dashboard/dashboard.php?${params}`);
        const result = await response.json();
        return { ok: result.success, data: result.data || {}, error: result.success ? null : result.message };
    } catch (error) {
        return { ok: false, data: {}, error: error.message };
    }
}

/* ── Appointments ────────────────────────────────────────── */

/** GET /final-VBETTER/bvetter/api/vet/appointments */
async function getAppointments(filters = {}) {
    const formData = new FormData();
    formData.append('action', 'list');
    Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '' && value !== 'all') {
            formData.append(key, value);
        }
    });

    try {
        const response = await fetch(`${BACKEND_URL}/appointments/appointment.php`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        return { ok: result.success, data: result.data || [], error: result.success ? null : result.message };
    } catch (error) {
        return { ok: false, data: [], error: error.message };
    }
}

function sessionValue() {
    try {
        return JSON.parse(sessionStorage.getItem('vbetter_session') || 'null');
    } catch {
        return null;
    }
}

function lostFoundForm(action, data = {}) {
    const formData = data instanceof FormData ? data : new FormData();
    formData.append('action', action);

    if (!(data instanceof FormData)) {
        Object.entries(data).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '' && value !== 'all') {
                formData.append(key, value);
            }
        });
    }

    const session = sessionValue();
    if (session?.userId && !formData.has('reviewed_by_user_id')) formData.append('reviewed_by_user_id', session.userId);
    if (session?.role && !formData.has('role')) formData.append('role', session.role);
    return formData;
}

async function lostFoundFetch(action, data = {}) {
    try {
        const response = await fetch(LOST_FOUND_URL, {
            method: 'POST',
            body: lostFoundForm(action, data)
        });
        const result = await response.json();
        return { ok: result.success, data: result.data || result, error: result.success ? null : result.message };
    } catch (error) {
        return { ok: false, data: null, error: error.message };
    }
}

/** PATCH /final-VBETTER/bvetter/api/vet/appointments/:id/status */
async function updateAppointmentStatus(id, status) {
    const formData = new FormData();
    formData.append('action', 'update_status');
    formData.append('appointment_id', id);
    formData.append('status', status);

    try {
        const response = await fetch(`${BACKEND_URL}/appointments/appointment.php`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        return { ok: result.success, data: { id, status }, error: result.success ? null : result.message };
    } catch (error) {
        return { ok: false, data: null, error: error.message };
    }
}

/** PATCH /final-VBETTER/bvetter/api/vet/appointments/:id/reschedule */
async function rescheduleAppointment(id, preferredDate, timeSlot) {
    const formData = new FormData();
    formData.append('action', 'reschedule');
    formData.append('appointment_id', id);
    formData.append('preferred_date', preferredDate);
    formData.append('time_slot', timeSlot);

    try {
        const response = await fetch(`${BACKEND_URL}/appointments/appointment.php`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        return { ok: result.success, data: { id, preferredDate, timeSlot }, error: result.success ? null : result.message };
    } catch (error) {
        return { ok: false, data: null, error: error.message };
    }
}

/** DELETE /final-VBETTER/bvetter/api/vet/appointments/:id */
async function deleteAppointment(id) {
    const formData = new FormData();
    formData.append('action', 'delete');
    formData.append('appointment_id', id);

    try {
        const response = await fetch(`${BACKEND_URL}/appointments/appointment.php`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        return { ok: result.success, data: { deleted: id }, error: result.success ? null : result.message };
    } catch (error) {
        return { ok: false, data: null, error: error.message };
    }
}

/* ── Patient Records ─────────────────────────────────────── */

/** GET /final-VBETTER/bvetter/api/vet/patients */
async function getPatients(filters = {}) {
    const params = new URLSearchParams(filters).toString();
    // [BACKEND] return apiFetch(`/vet/patients?${params}`);
    return { ok: true, data: [] };
}

/** GET /final-VBETTER/bvetter/api/vet/patients/:id */
async function getPatientById(id) {
    // [BACKEND] return apiFetch(`/vet/patients/${id}`);
    return { ok: true, data: null };
}

/** POST /final-VBETTER/bvetter/api/vet/patients */
async function createPatient(payload) {
    // [BACKEND]
    // return apiFetch('/final-VBETTER/bvetter/vet/patients', { method: 'POST', body: JSON.stringify(payload) });
    return { ok: true, data: { ...payload, id: `P-${Date.now()}` } };
}

/** PATCH /final-VBETTER/bvetter/api/vet/patients/:id */
async function updatePatient(id, payload) {
    // [BACKEND]
    // return apiFetch(`/vet/patients/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    return { ok: true, data: { id, ...payload } };
}

/* ── Reports ─────────────────────────────────────────────── */

/** GET /final-VBETTER/bvetter/api/vet/reports */
async function getReports(filters = {}) {
    const params = new URLSearchParams(filters).toString();
    try {
        const response = await fetch(`${BACKEND_URL}/reports/reports.php?${params}`);
        const result = await response.json();
        console.log('Report API Response:', result);
        return { ok: result.success, data: result.data || {}, error: result.success ? null : result.message };
    } catch (error) {
        return { ok: false, data: {}, error: error.message };
    }
}

function getReportExportUrl(filters = {}, format = 'pdf') {
    const params = new URLSearchParams({ ...filters, format }).toString();
    return `${BACKEND_URL}/reports/reports.php?${params}`;
}

/* ── Disease Analytics ───────────────────────────────────── */

/** GET /final-VBETTER/bvetter/api/vet/disease-analytics */
async function getDiseaseAnalytics(disease = 'all', period = 'year') {
    const params = new URLSearchParams({ scope: 'disease_analytics', disease, period }).toString();
    try {
        const response = await fetch(`${BACKEND_URL}/dashboard/dashboard.php?${params}`, { cache: 'no-store' });
        const result = await response.json();
        return { ok: result.success, data: result.data || {}, error: result.success ? null : result.message };
    } catch (error) {
        return { ok: false, data: {}, error: error.message };
    }
}

/* ── Lost and Found ──────────────────────────────────────── */

/** GET /final-VBETTER/bvetter/api/vet/lost-and-found */
async function getLostAndFound(tab = 'pending', filters = {}) {
    if (tab === 'claims') return lostFoundFetch('management_claims', { status: 'pending', ...filters });
    if (tab === 'sighting') return lostFoundFetch('list_sightings', { status: 'pending', ...filters });
    if (tab === 'potential') return lostFoundFetch('matches', filters);
    if (tab === 'resolved') return lostFoundFetch('management_list', { ...filters, status: 'resolved' });
    if (tab === 'active') return lostFoundFetch('management_list', { ...filters, status: 'active' });
    return lostFoundFetch('management_list', { ...filters, status: 'pending' });
}

/** PATCH /final-VBETTER/bvetter/api/vet/lost-and-found/:id/approve */
async function approveLostFoundReport(id, reviewNotes = '') {
    return lostFoundFetch('approve_report', { report_id: id, review_notes: reviewNotes });
}

/** PATCH /final-VBETTER/bvetter/api/vet/lost-and-found/:id/resolve */
async function resolveLostFoundCase(id, reviewNotes = '') {
    return lostFoundFetch('resolve_report', { report_id: id, review_notes: reviewNotes });
}

async function rejectLostFoundReport(id, reviewNotes = '') {
    return lostFoundFetch('reject_report', { report_id: id, review_notes: reviewNotes });
}

async function approveLostFoundMatch(id) {
    return lostFoundFetch('approve_match', { match_id: id });
}

async function dismissLostFoundMatch(id) {
    return lostFoundFetch('dismiss_match', { match_id: id });
}

async function approveLostFoundClaim(id, reviewNotes = '') {
    return lostFoundFetch('approve_claim', { claim_id: id, review_notes: reviewNotes });
}

async function rejectLostFoundClaim(id, reviewNotes = '') {
    return lostFoundFetch('reject_claim', { claim_id: id, review_notes: reviewNotes });
}

async function approveLostFoundSighting(id, reviewNotes = '') {
    return lostFoundFetch('approve_sighting', { sighting_id: id, review_notes: reviewNotes });
}

async function rejectLostFoundSighting(id, reviewNotes = '') {
    return lostFoundFetch('reject_sighting', { sighting_id: id, review_notes: reviewNotes });
}

/* ── Chatbot Management ──────────────────────────────────── */

/** GET /final-VBETTER/bvetter/api/vet/chatbot/inquiry-rules */
async function getInquiryRules() {
    // [BACKEND] return apiFetch('/final-VBETTER/bvetter/vet/chatbot/inquiry-rules');
    return { ok: true, data: [] };
}

/** POST /final-VBETTER/bvetter/api/vet/chatbot/inquiry-rules */
async function createInquiryRule(payload) {
    // [BACKEND]
    // return apiFetch('/final-VBETTER/bvetter/vet/chatbot/inquiry-rules', { method: 'POST', body: JSON.stringify(payload) });
    return { ok: true, data: { ...payload, id: Date.now() } };
}

/** PATCH /final-VBETTER/bvetter/api/vet/chatbot/inquiry-rules/:id */
async function updateInquiryRule(id, payload) {
    // [BACKEND]
    // return apiFetch(`/vet/chatbot/inquiry-rules/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    return { ok: true, data: { id, ...payload } };
}

/** DELETE /final-VBETTER/bvetter/api/vet/chatbot/inquiry-rules/:id */
async function deleteInquiryRule(id) {
    // [BACKEND]
    // return apiFetch(`/vet/chatbot/inquiry-rules/${id}`, { method: 'DELETE' });
    return { ok: true, data: { deleted: id } };
}

/** GET /final-VBETTER/bvetter/api/vet/chatbot/consultation-rules */
async function getConsultationRules() {
    // [BACKEND] return apiFetch('/final-VBETTER/bvetter/vet/chatbot/consultation-rules');
    return { ok: true, data: [] };
}

/** POST /final-VBETTER/bvetter/api/vet/chatbot/consultation-rules */
async function createConsultationRule(payload) {
    // [BACKEND]
    // return apiFetch('/final-VBETTER/bvetter/vet/chatbot/consultation-rules', { method: 'POST', body: JSON.stringify(payload) });
    return { ok: true, data: { ...payload, id: Date.now() } };
}

/* ── Mass Vaccination ────────────────────────────────────── */

/** GET /final-VBETTER/bvetter/api/vet/mass-vaccination/events */
async function getVaccinationEvents() {
    try {
        const response = await fetch(MASS_VACCINATION_URL, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action: 'list' })
        });
        const result = await response.json();
        return { ok: result.success, data: result.data || [], error: result.success ? null : result.message };
    } catch (error) {
        return { ok: false, data: [], error: error.message };
    }
}

async function getChatbotDashboardStats() {
    try {
        const response = await fetch(CHATBOT_URL, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action: 'dashboard_stats' })
        });
        const result = await response.json();
        return { ok: result.success, data: result.data || {}, error: result.success ? null : result.message };
    } catch (error) {
        return { ok: false, data: {}, error: error.message };
    }
}

async function getAnnouncements(filters = {}) {
    try {
        const response = await fetch(ANNOUNCEMENTS_URL, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action: 'list', ...filters })
        });
        const result = await response.json();
        return { ok: result.success, data: result.data || [], error: result.success ? null : result.message };
    } catch (error) {
        return { ok: false, data: [], error: error.message };
    }
}

async function saveAnnouncement(payload) {
    try {
        let options;
        if (payload instanceof FormData) {
            if (!payload.has('action')) payload.append('action', payload.get('id') ? 'update' : 'create');
            options = { method: 'POST', body: payload };
        } else {
            options = {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ action: payload.id ? 'update' : 'create', ...payload })
            };
        }
        if (payload instanceof FormData) {
    console.log(payload.get('id'));
    console.log(payload.get('action'));
}
        console.log(payload);
        console.log(options);
        const response = await fetch(ANNOUNCEMENTS_URL, options);
        // console.log(response.status);
        // console.log(await response.text());

        const result = await response.json();
        // const text = await response.text();
        // console.log(text);
        return { ok: result.success, data: result.data || null, error: result.success ? null : result.message };
    } catch (error) {
        return { ok: false, data: null, error: error.message };
    }
}

async function deleteAnnouncement(id) {
    try {
        const response = await fetch(ANNOUNCEMENTS_URL, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action: 'delete', id })
        });
        const result = await response.json();
        return { ok: result.success, data: result, error: result.success ? null : result.message };
    } catch (error) {
        return { ok: false, data: null, error: error.message };
    }
}

/** POST /final-VBETTER/bvetter/api/vet/mass-vaccination/events */
async function createVaccinationEvent(payload) {
    try {
        const response = await fetch(MASS_VACCINATION_URL, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action: 'create', ...payload })
        });
        const result = await response.json();
        return { ok: result.success, data: result.data || null, error: result.success ? null : result.message };
    } catch (error) {
        return { ok: false, data: null, error: error.message };
    }
}

/** PATCH /final-VBETTER/bvetter/api/vet/mass-vaccination/events/:id/report */
async function submitVaccinationReport(id, payload) {
    try {
        const response = await fetch(MASS_VACCINATION_URL, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action: 'submit_report', id, ...payload })
        });
        const result = await response.json();
        return { ok: result.success, data: result.data || null, error: result.success ? null : result.message };
    } catch (error) {
        return { ok: false, data: null, error: error.message };
    }
}

async function getDiseaseRiskPrediction(barangays, currentCasesByBarangay = {}) {
    barangays = barangays || [];
    try {
        const response = await fetch(`${BACKEND_URL}/dashboard/dashboard.php?scope=disease_risk_prediction`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body:    JSON.stringify({
                barangays: barangays,
                current_cases_by_barangay: currentCasesByBarangay || {}
            })
        });
        const result = await response.json();
        return { ok: result.success, data: result.data || [], error: result.success ? null : result.error };
    } catch (error) {
        return { ok: false, data: [], error: error.message };
    }
}
async function getMassVaccinationDataset() {
    try {
        const response = await fetch(
            `${BACKEND_URL}/dashboard/dashboard.php?scope=mass_vaccination_dataset`
        );
        const result = await response.json();
        return {
            ok:    result.success,
            data:  result.data || {},
            error: result.success ? null : result.message
        };
    } catch (error) {
        return { ok: false, data: {}, error: error.message };
    }
}

// Add to window.VetAPI exports:
// getMassVaccinationDataset,

async function getVaccinationForecast(steps) {
    steps = steps || 3;
    try {
        const response = await fetch(`${BACKEND_URL}/dashboard/dashboard.php?scope=vaccination_forecast`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ steps: steps })
        });
        const result = await response.json();
        return { ok: result.success, data: result.data || {}, error: result.success ? null : result.error };
    } catch (error) {
        return { ok: false, data: {}, error: error.message };
    }
}

async function getRFModelInfo() {
    try {
        const response = await fetch(`${BACKEND_URL}/dashboard/dashboard.php?scope=rf_model_info`);
        const result   = await response.json();
        return { ok: result.success, data: result.data || {}, error: result.success ? null : result.error };
    } catch (error) {
        return { ok: false, data: {}, error: error.message };
    }
}

/* ── Exports ─────────────────────────────────────────────── */
window.VetAPI = {
    getDashboardSummary,
    getChatbotDashboardStats,
    getAnnouncements,
    saveAnnouncement,
    deleteAnnouncement,
    getAppointments,
    updateAppointmentStatus,
    rescheduleAppointment,
    deleteAppointment,
    getPatients,
    getPatientById,
    createPatient,
    updatePatient,
    getReports,
    getReportExportUrl,
    getDiseaseAnalytics,
    getLostAndFound,
    approveLostFoundReport,
    resolveLostFoundCase,
    rejectLostFoundReport,
    approveLostFoundMatch,
    dismissLostFoundMatch,
    approveLostFoundClaim,
    rejectLostFoundClaim,
    approveLostFoundSighting,
    rejectLostFoundSighting,
    getInquiryRules,
    createInquiryRule,
    updateInquiryRule,
    deleteInquiryRule,
    getConsultationRules,
    createConsultationRule,
    getVaccinationEvents,
    createVaccinationEvent,
    submitVaccinationReport,
    getVaccinationForecast,
    getDiseaseRiskPrediction,
    getMassVaccinationDataset,
    getRFModelInfo
};

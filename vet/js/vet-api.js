/**
 * VBetter – Vet API Layer
 * /vet/js/vet-api.js
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

const BASE_URL = '/api';   // [BACKEND] e.g. 'https://api.vbetter.ph'
const BACKEND_URL = '/Final-backend(VBETTER)/Final-Backend/backend';

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
            window.location.href = '/public/pages/login.html';
            return { ok: false, error: 'Unauthorised' };
        }

        const data = await response.json();
        return { ok: response.ok, data, error: response.ok ? null : (data.message || 'Request failed') };
    } catch (error) {
        return { ok: false, data: null, error: error.message };
    }
}

/* ── Dashboard ───────────────────────────────────────────── */

/** GET /api/vet/dashboard/summary */
async function getDashboardSummary() {
    // [BACKEND] return apiFetch('/vet/dashboard/summary');
    return {
        ok: true,
        data: {
            pendingAppointments: 5,
            confirmedToday:      8,
            activeLostFound:     3,
            pendingVaccReports:  2
        }
    };
}

/* ── Appointments ────────────────────────────────────────── */

/** GET /api/vet/appointments */
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

/** PATCH /api/vet/appointments/:id/status */
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

/** DELETE /api/vet/appointments/:id */
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

/** GET /api/vet/patients */
async function getPatients(filters = {}) {
    const params = new URLSearchParams(filters).toString();
    // [BACKEND] return apiFetch(`/vet/patients?${params}`);
    return { ok: true, data: [] };
}

/** GET /api/vet/patients/:id */
async function getPatientById(id) {
    // [BACKEND] return apiFetch(`/vet/patients/${id}`);
    return { ok: true, data: null };
}

/** POST /api/vet/patients */
async function createPatient(payload) {
    // [BACKEND]
    // return apiFetch('/vet/patients', { method: 'POST', body: JSON.stringify(payload) });
    return { ok: true, data: { ...payload, id: `P-${Date.now()}` } };
}

/** PATCH /api/vet/patients/:id */
async function updatePatient(id, payload) {
    // [BACKEND]
    // return apiFetch(`/vet/patients/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    return { ok: true, data: { id, ...payload } };
}

/* ── Reports ─────────────────────────────────────────────── */

/** GET /api/vet/reports */
async function getReports(filters = {}) {
    const params = new URLSearchParams(filters).toString();
    // [BACKEND] return apiFetch(`/vet/reports?${params}`);
    return { ok: true, data: [] };
}

/* ── Disease Analytics ───────────────────────────────────── */

/** GET /api/vet/disease-analytics */
async function getDiseaseAnalytics(disease = 'all') {
    // [BACKEND] return apiFetch(`/vet/disease-analytics?disease=${disease}`);
    return { ok: true, data: window.diseaseAnalyticsData || {} };
}

/* ── Lost and Found ──────────────────────────────────────── */

/** GET /api/vet/lost-and-found */
async function getLostAndFound(tab = 'pending', filters = {}) {
    const params = new URLSearchParams({ tab, ...filters }).toString();
    // [BACKEND] return apiFetch(`/vet/lost-and-found?${params}`);
    return { ok: true, data: window.lfData || {} };
}

/** PATCH /api/vet/lost-and-found/:id/approve */
async function approveLostFoundReport(id) {
    // [BACKEND]
    // return apiFetch(`/vet/lost-and-found/${id}/approve`, { method: 'PATCH' });
    return { ok: true, data: { id, status: 'active' } };
}

/** PATCH /api/vet/lost-and-found/:id/resolve */
async function resolveLostFoundCase(id) {
    // [BACKEND]
    // return apiFetch(`/vet/lost-and-found/${id}/resolve`, { method: 'PATCH' });
    return { ok: true, data: { id, status: 'resolved' } };
}

/* ── Chatbot Management ──────────────────────────────────── */

/** GET /api/vet/chatbot/inquiry-rules */
async function getInquiryRules() {
    // [BACKEND] return apiFetch('/vet/chatbot/inquiry-rules');
    return { ok: true, data: [] };
}

/** POST /api/vet/chatbot/inquiry-rules */
async function createInquiryRule(payload) {
    // [BACKEND]
    // return apiFetch('/vet/chatbot/inquiry-rules', { method: 'POST', body: JSON.stringify(payload) });
    return { ok: true, data: { ...payload, id: Date.now() } };
}

/** PATCH /api/vet/chatbot/inquiry-rules/:id */
async function updateInquiryRule(id, payload) {
    // [BACKEND]
    // return apiFetch(`/vet/chatbot/inquiry-rules/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    return { ok: true, data: { id, ...payload } };
}

/** DELETE /api/vet/chatbot/inquiry-rules/:id */
async function deleteInquiryRule(id) {
    // [BACKEND]
    // return apiFetch(`/vet/chatbot/inquiry-rules/${id}`, { method: 'DELETE' });
    return { ok: true, data: { deleted: id } };
}

/** GET /api/vet/chatbot/consultation-rules */
async function getConsultationRules() {
    // [BACKEND] return apiFetch('/vet/chatbot/consultation-rules');
    return { ok: true, data: [] };
}

/** POST /api/vet/chatbot/consultation-rules */
async function createConsultationRule(payload) {
    // [BACKEND]
    // return apiFetch('/vet/chatbot/consultation-rules', { method: 'POST', body: JSON.stringify(payload) });
    return { ok: true, data: { ...payload, id: Date.now() } };
}

/* ── Mass Vaccination ────────────────────────────────────── */

/** GET /api/vet/mass-vaccination/events */
async function getVaccinationEvents() {
    // [BACKEND] return apiFetch('/vet/mass-vaccination/events');
    return { ok: true, data: [] };
}

/** POST /api/vet/mass-vaccination/events */
async function createVaccinationEvent(payload) {
    // [BACKEND]
    // return apiFetch('/vet/mass-vaccination/events', { method: 'POST', body: JSON.stringify(payload) });
    return { ok: true, data: { ...payload, id: `evt-${Date.now()}` } };
}

/** PATCH /api/vet/mass-vaccination/events/:id/report */
async function submitVaccinationReport(id, payload) {
    // [BACKEND]
    // return apiFetch(`/vet/mass-vaccination/events/${id}/report`, {
    //     method: 'PATCH',
    //     body: JSON.stringify(payload)
    // });
    return { ok: true, data: { id, ...payload, status: 'Completed' } };
}

/* ── Exports ─────────────────────────────────────────────── */
window.VetAPI = {
    getDashboardSummary,
    getAppointments,
    updateAppointmentStatus,
    deleteAppointment,
    getPatients,
    getPatientById,
    createPatient,
    updatePatient,
    getReports,
    getDiseaseAnalytics,
    getLostAndFound,
    approveLostFoundReport,
    resolveLostFoundCase,
    getInquiryRules,
    createInquiryRule,
    updateInquiryRule,
    deleteInquiryRule,
    getConsultationRules,
    createConsultationRule,
    getVaccinationEvents,
    createVaccinationEvent,
    submitVaccinationReport
};

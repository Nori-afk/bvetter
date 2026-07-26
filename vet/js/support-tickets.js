/**
 * VBetter – Support Tickets (vet/html/support-tickets.html)
 * Shared by both vet and admin (same page, same pattern as Appointment
 * Management): vets submit + see only their own tickets, admins see and
 * manage every ticket.
 */
'use strict';

const TICKETS_API = '/api/tickets/tickets.php';

const state = {
    role: 'vet',
    userId: 0,
    tickets: [],
    expandedId: null,
};

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
}

function statusLabel(status) {
    return { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved' }[status] || status;
}

function formatDate(value) {
    if (!value) return '';
    const date = new Date(value.replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function apiCall(payload) {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => formData.append(key, value));
    try {
        const response = await fetch(TICKETS_API, { method: 'POST', body: formData });
        return await response.json();
    } catch (error) {
        return { success: false, message: 'Network error. Please try again.' };
    }
}

async function loadTickets() {
    const statusFilter = document.getElementById('st-status-filter')?.value || 'all';
    const result = await apiCall({
        action: 'list',
        role: state.role,
        reporter_id: state.userId,
        status: statusFilter,
    });
    state.tickets = result.success ? result.data : [];
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('st-table-body');
    const emptyState = document.getElementById('st-empty-state');
    if (!tbody) return;

    tbody.innerHTML = '';
    emptyState.style.display = state.tickets.length ? 'none' : 'block';

    state.tickets.forEach((ticket) => {
        const row = document.createElement('tr');
        row.className = 'st-row';
        row.dataset.id = ticket.id;
        row.innerHTML = `
            <td>${escapeHtml(ticket.ticketNumber)}</td>
            <td style="display:${state.role === 'admin' ? '' : 'none'};">
                ${escapeHtml(ticket.reporterName || '—')} <small>(${escapeHtml(ticket.reporterRole)})</small>
            </td>
            <td>${escapeHtml(ticket.subject)}</td>
            <td><span class="st-badge st-badge-${ticket.status}">${statusLabel(ticket.status)}</span></td>
            <td>${formatDate(ticket.createdAt)}</td>
        `;
        row.addEventListener('click', () => toggleExpand(ticket.id));
        tbody.appendChild(row);

        if (state.expandedId === ticket.id) {
            tbody.appendChild(buildDetailRow(ticket));
        }
    });
}

function buildDetailRow(ticket) {
    const detailRow = document.createElement('tr');
    detailRow.className = 'st-detail-row';
    const colspan = state.role === 'admin' ? 5 : 4;

    const adminControls = state.role === 'admin' ? `
        <div class="st-admin-controls">
            <label class="field-label" for="st-edit-status-${ticket.id}">Status</label>
            <select id="st-edit-status-${ticket.id}" class="dropdown">
                <option value="open" ${ticket.status === 'open' ? 'selected' : ''}>Open</option>
                <option value="in_progress" ${ticket.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                <option value="resolved" ${ticket.status === 'resolved' ? 'selected' : ''}>Resolved</option>
            </select>
            <label class="field-label" for="st-edit-notes-${ticket.id}">Admin Notes</label>
            <textarea id="st-edit-notes-${ticket.id}" rows="2">${escapeHtml(ticket.adminNotes || '')}</textarea>
            <button type="button" class="btn btn-save-ticket" data-id="${ticket.id}">Save Changes</button>
        </div>
    ` : '';

    detailRow.innerHTML = `
        <td colspan="${colspan}">
            <div class="st-detail">
                <p class="st-detail-desc">${escapeHtml(ticket.description)}</p>
                ${ticket.adminNotes && state.role !== 'admin' ? `<p class="st-detail-notes"><strong>Admin notes:</strong> ${escapeHtml(ticket.adminNotes)}</p>` : ''}
                ${adminControls}
            </div>
        </td>
    `;

    detailRow.querySelector('.btn-save-ticket')?.addEventListener('click', async (event) => {
        event.stopPropagation();
        const id = Number(event.target.dataset.id);
        const status = document.getElementById(`st-edit-status-${id}`).value;
        const adminNotes = document.getElementById(`st-edit-notes-${id}`).value;
        const result = await apiCall({
            action: 'update_status',
            ticket_id: id,
            status,
            admin_notes: adminNotes,
            resolved_by_user_id: state.userId,
        });
        if (!result.success) {
            alert(result.message || 'Failed to update ticket.');
            return;
        }
        await loadTickets();
    });

    detailRow.addEventListener('click', (event) => event.stopPropagation());
    return detailRow;
}

function toggleExpand(id) {
    state.expandedId = state.expandedId === id ? null : id;
    renderTable();
}

async function submitTicket(event) {
    event.preventDefault();
    const subject = document.getElementById('st-subject').value.trim();
    const description = document.getElementById('st-description').value.trim();
    if (!subject || !description) return;

    const submitBtn = document.getElementById('st-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    const session = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    const result = await apiCall({
        action: 'create',
        reporter_id: state.userId,
        reporter_role: state.role,
        reporter_name: session?.name || '',
        reporter_email: session?.email || '',
        subject,
        description,
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Ticket';

    if (!result.success) {
        alert(result.message || 'Failed to submit ticket.');
        return;
    }

    document.getElementById('ticketForm').reset();
    await loadTickets();
}

function init() {
    const session = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    state.role = session?.role === 'admin' ? 'admin' : 'vet';
    state.userId = session?.userId || session?.id || 0;

    if (state.role === 'admin') {
        document.getElementById('st-list-title').textContent = 'All Tickets';
        document.getElementById('st-subtitle').textContent = 'Review and resolve bug reports submitted by vets and pet owners.';
        document.getElementById('st-reporter-col').style.display = '';
        document.getElementById('st-status-filter').style.display = '';
        document.getElementById('st-status-filter').addEventListener('change', loadTickets);
    }

    document.getElementById('ticketForm').addEventListener('submit', submitTicket);
    loadTickets();
}

document.addEventListener('DOMContentLoaded', init);

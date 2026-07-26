/* =============================================
   BVETTER — My Tickets (public/pages/my-tickets.html)
   Pet owner: submit a bug report + track its status.
   ============================================= */
'use strict';

function escapeHtmlTicket(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

function ticketStatusLabel(status) {
  return { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved' }[status] || status;
}

function formatTicketDate(value) {
  if (!value) return '';
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadMyTickets() {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const ownerId = user?.userId || user?.id || '';
  const result = await api.getMyTickets(ownerId);

  const tbody = document.getElementById('mt-table-body');
  const emptyState = document.getElementById('mt-empty-state');
  if (!tbody) return;

  const tickets = result.success ? result.data : [];
  tbody.innerHTML = '';
  emptyState.style.display = tickets.length ? 'none' : 'block';

  tickets.forEach((ticket) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtmlTicket(ticket.ticketNumber)}</td>
      <td>${escapeHtmlTicket(ticket.subject)}</td>
      <td><span class="mt-badge mt-badge-${ticket.status}">${ticketStatusLabel(ticket.status)}</span></td>
      <td>${formatTicketDate(ticket.createdAt)}</td>
    `;
    tbody.appendChild(row);
  });
}

async function submitOwnerTicket(event) {
  event.preventDefault();
  const subject = document.getElementById('mt-subject').value.trim();
  const description = document.getElementById('mt-description').value.trim();
  if (!subject || !description) return;

  const submitBtn = document.getElementById('mt-submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const result = await api.submitTicket({
    reporter_id: user?.userId || user?.id || '',
    reporter_role: 'owner',
    reporter_name: user?.name || '',
    reporter_email: user?.email || '',
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
  await loadMyTickets();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('ticketForm').addEventListener('submit', submitOwnerTicket);
  loadMyTickets();
});

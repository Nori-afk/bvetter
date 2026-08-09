/* =============================================
   BVetter — My Tickets (public/pages/my-tickets.html)
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

let myTickets = [];
let expandedTicketId = null;

async function loadMyTickets() {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const ownerId = user?.userId || user?.id || '';
  const result = await api.getMyTickets(ownerId);

  const tbody = document.getElementById('mt-table-body');
  const emptyState = document.getElementById('mt-empty-state');
  if (!tbody) return;

  myTickets = result.success ? result.data : [];
  renderMyTicketsTable(myTickets, emptyState, tbody);
}

function renderMyTicketsTable(tickets, emptyState, tbody) {
  tbody.innerHTML = '';
  emptyState.style.display = tickets.length ? 'none' : 'block';

  tickets.forEach((ticket) => {
    const row = document.createElement('tr');
    row.className = 'mt-row';
    row.innerHTML = `
      <td>${escapeHtmlTicket(ticket.ticketNumber)}</td>
      <td>${escapeHtmlTicket(ticket.subject)}</td>
      <td><span class="mt-badge mt-badge-${ticket.status}">${ticketStatusLabel(ticket.status)}</span></td>
      <td>${formatTicketDate(ticket.createdAt)}</td>
    `;
    row.addEventListener('click', () => {
      expandedTicketId = expandedTicketId === ticket.id ? null : ticket.id;
      renderMyTicketsTable(myTickets, emptyState, tbody);
    });
    tbody.appendChild(row);

    if (expandedTicketId === ticket.id) {
      tbody.appendChild(buildTicketDetailRow(ticket));
    }
  });
}

function ticketAttachmentHtml(ticket) {
  if (!ticket.attachmentUrl) return '';
  return ticket.attachmentType === 'video'
    ? `<video src="${escapeHtmlTicket(ticket.attachmentUrl)}" class="mt-attachment-preview" controls></video>`
    : `<a href="${escapeHtmlTicket(ticket.attachmentUrl)}" target="_blank" rel="noopener"><img src="${escapeHtmlTicket(ticket.attachmentUrl)}" alt="Attachment" class="mt-attachment-preview"/></a>`;
}

function buildTicketDetailRow(ticket) {
  const detailRow = document.createElement('tr');
  detailRow.className = 'mt-detail-row';
  detailRow.innerHTML = `
    <td colspan="4">
      <div class="mt-detail">
        <p class="mt-detail-desc">${escapeHtmlTicket(ticket.description)}</p>
        ${ticketAttachmentHtml(ticket)}
        ${ticket.adminNotes ? `<p class="mt-detail-notes"><strong>Notes from our team:</strong> ${escapeHtmlTicket(ticket.adminNotes)}</p>` : ''}
      </div>
    </td>
  `;
  detailRow.addEventListener('click', (event) => event.stopPropagation());
  return detailRow;
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
  const attachment = document.getElementById('mt-attachment')?.files?.[0] || null;
  const result = await api.submitTicket({
    reporter_id: user?.userId || user?.id || '',
    reporter_role: 'owner',
    reporter_name: user?.name || '',
    reporter_email: user?.email || '',
    subject,
    description,
    attachment,
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

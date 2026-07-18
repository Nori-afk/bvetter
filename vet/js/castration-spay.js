/* =============================================
   BVETTER — Castration & Spay Program (vet/admin)
   File: vet/js/castration-spay.js
   Depends: vet-api.js (window.VetAPI)
   ============================================= */

const state = {
  programs: [],
  waiting: [],
  roster: [],
  rosterProgramId: null,
};

const STATUS_LABELS = {
  planning: 'Planning',
  open: 'Open',
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
  pending_schedule: 'Pending Schedule',
};

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function statusPill(status) {
  const label = STATUS_LABELS[status] || status || '—';
  return `<span class="pill pill-${status}">${escapeHtml(label)}</span>`;
}

function formatDate(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ── Dashboard tiles ─────────────────────────── */
async function loadDashboard() {
  const result = await window.VetAPI.getCspDashboardStats();
  if (!result.ok) return;
  const data = result.data;

  const set = (metric, val) => {
    const el = document.querySelector(`[data-metric="${metric}"]`);
    if (el) el.textContent = val;
  };

  set('totalWaiting', data.total_waiting ?? 0);
  set('upcomingDate', data.upcoming_program?.program_date ? formatDate(data.upcoming_program.program_date) : 'Not scheduled');
  set('capacity', data.capacity ?? '—');
  set('assignedPets', data.assigned_pets ?? 0);
  set('unassignedPets', data.unassigned_pets ?? 0);
}

/* ── Programs table ──────────────────────────── */
async function loadPrograms() {
  const result = await window.VetAPI.getCspPrograms();
  const tbody = document.getElementById('program-table-body');
  if (!result.ok) {
    tbody.innerHTML = '<tr><td colspan="6" class="csp-loading-cell">Failed to load programs.</td></tr>';
    return;
  }

  state.programs = result.data;
  populateProgramSelects();

  if (!state.programs.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="csp-loading-cell">No programs yet. Create one to get started.</td></tr>';
    return;
  }

  tbody.innerHTML = state.programs.map((program) => `
    <tr>
      <td>${escapeHtml(program.title)}</td>
      <td>${program.program_date ? formatDate(program.program_date) : 'TBA'}${program.time_slot ? ' · ' + escapeHtml(program.time_slot) : ''}</td>
      <td>${escapeHtml(program.venue || 'TBA')}</td>
      <td>${program.assigned_count}${program.capacity !== null ? ' / ' + program.capacity : ''}</td>
      <td>${statusPill(program.status)}</td>
      <td><button class="btn btn-outline btn-sm" data-manage-program="${program.id}" type="button">Manage</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-manage-program]').forEach((btn) => {
    btn.addEventListener('click', () => openProgramModal(Number(btn.dataset.manageProgram)));
  });
}

function populateProgramSelects() {
  const assignableStatuses = ['planning', 'open'];
  const assignSelect = document.getElementById('assign-program-select');
  const rosterSelect = document.getElementById('roster-program-select');

  const assignable = state.programs.filter((p) => assignableStatuses.includes(p.status));
  assignSelect.innerHTML = assignable.length
    ? assignable.map((p) => `<option value="${p.id}">${escapeHtml(p.title)}${p.program_date ? ' — ' + formatDate(p.program_date) : ''}</option>`).join('')
    : '<option value="">No open program — create one first</option>';

  const currentRoster = rosterSelect.value;
  rosterSelect.innerHTML = state.programs.length
    ? state.programs.map((p) => `<option value="${p.id}">${escapeHtml(p.title)}${p.program_date ? ' — ' + formatDate(p.program_date) : ''}</option>`).join('')
    : '<option value="">No programs yet</option>';

  if (currentRoster && state.programs.some((p) => String(p.id) === currentRoster)) {
    rosterSelect.value = currentRoster;
  } else if (state.programs.length) {
    rosterSelect.value = String(state.programs[0].id);
  }
  state.rosterProgramId = rosterSelect.value || null;
}

/* ── Waiting list ─────────────────────────────── */
async function loadWaitingList() {
  const result = await window.VetAPI.getCspRegistrations({ program_id: 'unassigned', status: 'pending_schedule' });
  const tbody = document.getElementById('waiting-table-body');
  if (!result.ok) {
    tbody.innerHTML = '<tr><td colspan="4" class="csp-loading-cell">Failed to load waiting list.</td></tr>';
    return;
  }

  state.waiting = result.data;
  if (!state.waiting.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="csp-loading-cell">No one is waiting right now.</td></tr>';
    return;
  }

  tbody.innerHTML = state.waiting.map((reg) => `
    <tr>
      <td><input type="checkbox" class="waiting-row-check" value="${reg.id}"></td>
      <td>${escapeHtml(reg.pet_name)} <span class="csp-muted">(${escapeHtml(reg.species || '')})</span></td>
      <td>${escapeHtml(reg.owner_name)}</td>
      <td>${reg.registered_at ? formatDate(reg.registered_at) : '—'}</td>
    </tr>
  `).join('');
}

/* ── Assigned roster ──────────────────────────── */
async function loadRoster() {
  const tbody = document.getElementById('roster-table-body');
  const programId = document.getElementById('roster-program-select').value;
  state.rosterProgramId = programId || null;

  if (!programId) {
    tbody.innerHTML = '<tr><td colspan="5" class="csp-loading-cell">Select a program above.</td></tr>';
    return;
  }

  const result = await window.VetAPI.getCspRegistrations({ program_id: programId });
  if (!result.ok) {
    tbody.innerHTML = '<tr><td colspan="5" class="csp-loading-cell">Failed to load roster.</td></tr>';
    return;
  }

  state.roster = result.data.filter((r) => r.status !== 'cancelled');
  if (!state.roster.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="csp-loading-cell">No pets assigned to this program yet.</td></tr>';
    return;
  }

  tbody.innerHTML = state.roster.map((reg) => `
    <tr>
      <td>${reg.queue_number ?? '—'}</td>
      <td>${escapeHtml(reg.pet_name)}</td>
      <td>${escapeHtml(reg.owner_name)}</td>
      <td>${statusPill(reg.status)}</td>
      <td>
        ${reg.status === 'scheduled' ? `
          <button class="btn btn-outline btn-sm" data-complete-reg="${reg.id}" type="button">Mark Completed</button>
          <button class="btn btn-danger btn-sm" data-cancel-reg="${reg.id}" type="button">Cancel</button>
        ` : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-cancel-reg]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this registration?')) return;
      const res = await window.VetAPI.cancelCspRegistration(Number(btn.dataset.cancelReg));
      if (!res.ok) { alert(res.error || 'Failed to cancel.'); return; }
      refreshAll();
    });
  });
  tbody.querySelectorAll('[data-complete-reg]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await window.VetAPI.updateCspProgram({ program_id: state.rosterProgramId, status: 'completed' });
      if (!res.ok) { alert(res.error || 'Failed to update.'); return; }
      refreshAll();
    });
  });
}

/* ── Assign selected waiting registrations ───── */
async function assignSelected() {
  const programId = document.getElementById('assign-program-select').value;
  const selected = Array.from(document.querySelectorAll('.waiting-row-check:checked')).map((cb) => Number(cb.value));

  if (!programId) { alert('Create or select an open program first.'); return; }
  if (!selected.length) { alert('Select at least one waiting registration.'); return; }

  const result = await window.VetAPI.assignCspRegistrations(Number(programId), selected);
  if (!result.ok) { alert(result.error || 'Failed to assign registrations.'); return; }

  await window.VetAPI.notifyCspProgram(Number(programId));
  alert(result.data.message || 'Registrations assigned and owners notified.');
  refreshAll();
}

async function notifyRosterProgram() {
  const programId = document.getElementById('roster-program-select').value;
  if (!programId) return;
  const result = await window.VetAPI.notifyCspProgram(Number(programId));
  alert(result.message || (result.ok ? 'Notifications sent.' : 'Failed to send notifications.'));
}

/* ── Create / Manage Program modal ───────────── */
function openProgramModal(programId = null) {
  const modal = document.getElementById('program-modal');
  const form = document.getElementById('program-form');
  form.reset();
  document.getElementById('program-form-error').textContent = '';
  document.getElementById('program-id-input').value = programId || '';

  const heading = document.getElementById('program-modal-heading');
  if (programId) {
    const program = state.programs.find((p) => p.id === programId);
    heading.textContent = 'Manage Program';
    if (program) {
      document.getElementById('program-title-input').value = program.title || '';
      document.getElementById('program-date-input').value = program.program_date || '';
      document.getElementById('program-time-input').value = program.time_slot || '';
      document.getElementById('program-venue-input').value = program.venue || '';
      document.getElementById('program-capacity-input').value = program.capacity ?? '';
      document.getElementById('program-status-input').value = program.status || 'planning';
    }
  } else {
    heading.textContent = 'Create Program';
    document.getElementById('program-status-input').value = 'planning';
  }

  modal.classList.remove('hidden');
}

function closeProgramModal() {
  document.getElementById('program-modal').classList.add('hidden');
}

async function submitProgramForm(e) {
  e.preventDefault();
  const errorEl = document.getElementById('program-form-error');
  errorEl.textContent = '';

  const programId = document.getElementById('program-id-input').value;
  const capacity = document.getElementById('program-capacity-input').value;

  if (!programId && !capacity) {
    errorEl.textContent = 'A capacity is required to create a program.';
    return;
  }

  const payload = {
    title: document.getElementById('program-title-input').value.trim(),
    program_date: document.getElementById('program-date-input').value,
    time_slot: document.getElementById('program-time-input').value.trim(),
    venue: document.getElementById('program-venue-input').value.trim(),
    capacity,
    status: document.getElementById('program-status-input').value,
  };

  const result = programId
    ? await window.VetAPI.updateCspProgram({ program_id: Number(programId), ...payload })
    : await window.VetAPI.createCspProgram(payload);

  if (!result.ok) {
    errorEl.textContent = result.error || 'Failed to save program.';
    return;
  }

  closeProgramModal();
  refreshAll();
}

/* ── Refresh everything ───────────────────────── */
async function refreshAll() {
  await loadPrograms();
  await Promise.all([loadDashboard(), loadWaitingList(), loadRoster()]);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('open-create-program').addEventListener('click', () => openProgramModal(null));
  document.getElementById('close-program-modal').addEventListener('click', closeProgramModal);
  document.getElementById('cancel-program-modal').addEventListener('click', closeProgramModal);
  document.getElementById('program-modal').addEventListener('click', (e) => {
    if (e.target.id === 'program-modal') closeProgramModal();
  });
  document.getElementById('program-form').addEventListener('submit', submitProgramForm);

  document.getElementById('assign-selected-btn').addEventListener('click', assignSelected);
  document.getElementById('notify-program-btn').addEventListener('click', notifyRosterProgram);
  document.getElementById('roster-program-select').addEventListener('change', loadRoster);

  document.getElementById('waiting-select-all').addEventListener('change', (e) => {
    document.querySelectorAll('.waiting-row-check').forEach((cb) => { cb.checked = e.target.checked; });
  });

  refreshAll();
});

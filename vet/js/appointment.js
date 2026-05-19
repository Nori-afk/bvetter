const FALLBACK_APPOINTMENTS = [
	{ id: 1, datetime: '2026-04-21T09:00:00', patient: 'Luna', owner: 'Eleanor Rigby', service: 'Annual Vaccination', status: 'confirmed', type: 'Follow-up' },
	{ id: 2, datetime: '2026-04-21T10:45:00', patient: 'Oliver', owner: 'Marcus Sterling', service: 'Dental Cleaning', status: 'pending', type: 'Consultation' },
	{ id: 3, datetime: '2026-04-21T14:15:00', patient: 'Bella', owner: 'Sarah Connor', service: 'Skin Consultation', status: 'completed', type: 'Treatment' },
	{ id: 4, datetime: '2026-04-22T08:30:00', patient: 'Coco', owner: 'Angel Peralta', service: 'Neuter Follow-up', status: 'pending', type: 'Follow-up' },
	{ id: 5, datetime: '2026-04-22T11:00:00', patient: 'Milo', owner: 'Jordan Mays', service: 'General Checkup', status: 'confirmed', type: 'Checkup' },
	{ id: 6, datetime: '2026-04-23T15:20:00', patient: 'Nala', owner: 'Ivy Chen', service: 'X-ray Review', status: 'pending', type: 'Review' },
	{ id: 7, datetime: '2026-04-23T17:15:00', patient: 'Simba', owner: 'Chris Nolan', service: 'Post-op Check', status: 'completed', type: 'Post-op' },
	{ id: 8, datetime: '2026-04-24T09:30:00', patient: 'Cooper', owner: 'Faith Evans', service: 'Deworming', status: 'pending', type: 'Vaccination' },
	{ id: 9, datetime: '2026-04-25T13:10:00', patient: 'Mochi', owner: 'Dean Silva', service: 'Booster Shot', status: 'confirmed', type: 'Vaccination' },
	{ id: 10, datetime: '2026-04-25T16:00:00', patient: 'Rocky', owner: 'Monica Reyes', service: 'Ear Infection Follow-up', status: 'pending', type: 'Follow-up' }
];

const VALID_STATUSES = new Set(['pending', 'confirmed', 'completed', 'canceled', 'cancelled', 'rejected']);
const RESCHEDULE_SLOTS = [
	{ label: 'Morning', value: '09:30', display: '09:30 AM' },
	{ label: 'Morning', value: '10:15', display: '10:15 AM' },
	{ label: 'Morning', value: '11:00', display: '11:00 AM' },
	{ label: 'Afternoon', value: '13:45', display: '01:45 PM' },
	{ label: 'Afternoon', value: '14:30', display: '02:30 PM' },
	{ label: 'Afternoon', value: '15:15', display: '03:15 PM' },
	{ label: 'Late Afternoon', value: '16:00', display: '04:00 PM' },
	{ label: 'Late Afternoon', value: '16:45', display: '04:45 PM' }
];
const RESCHEDULE_WEEK_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const ui = {
	pendingCount: document.getElementById('pending-count'),
	confirmedCount: document.getElementById('confirmed-count'),
	pendingHolder: document.getElementById('appt-Holder'),
	pendingEmpty: document.getElementById('pending-empty'),
	tbody: document.getElementById('appointment-tbody'),
	tableSummary: document.getElementById('table-summary'),
	searchInput: document.getElementById('search-input'),
	statusFilter: document.getElementById('status-filter'),
	dateFilter: document.getElementById('date-filter'),
	clearFilters: document.getElementById('clear-filters'),
	acceptAllButton: document.getElementById('accept-butt'),
	prevPage: document.getElementById('prev-page'),
	nextPage: document.getElementById('next-page'),
	pageLabel: document.getElementById('page-label'),
	modalOverlay: document.getElementById('modal-overlay'),
	modalShell: document.getElementById('modal-shell'),
	modalClose: document.getElementById('modal-close'),
	modalContent: document.getElementById('modal-content')
};

const state = {
	appointments: [],
	page: 1,
	pageSize: 6,
	selectedAppointmentId: null,
	selectedSlot: '',
	selectedDate: '',
	rescheduleMonth: null
};

let calendar;

function isValidDateString(value) {
	const date = new Date(value);
	return !Number.isNaN(date.getTime());
}

function normalizeAppointment(item, index) {
	const fallbackDate = '2026-04-21T09:00:00';
	const datetime = typeof item.datetime === 'string' && isValidDateString(item.datetime)
		? item.datetime
		: fallbackDate;
	const status = VALID_STATUSES.has(item.status) ? item.status : 'pending';

	return {
		id: Number.isFinite(Number(item.id)) ? Number(item.id) : index + 1,
		datetime,
		patient: String(item.patient || 'Unknown Patient'),
		owner: String(item.owner || 'Unknown Owner'),
		service: String(item.service || 'General Service'),
		status,
		type: String(item.type || 'General')
	};
}

function loadAppointments(dataset) {
	const source = Array.isArray(dataset)
		? dataset
		: (Array.isArray(window.appointmentDataset) ? window.appointmentDataset : FALLBACK_APPOINTMENTS);

	state.appointments = source.map(normalizeAppointment);
	state.page = 1;
	refreshUI();
}

function getAppointmentById(id) {
	return state.appointments.find((item) => item.id === id);
}

function formatDateTime(value) {
	const date = new Date(value);
	return {
		date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
		time: date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
		isoDate: date.toISOString().slice(0, 10)
	};
}

function toLocalDateTimeString(date) {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	const h = String(date.getHours()).padStart(2, '0');
	const min = String(date.getMinutes()).padStart(2, '0');
	const s = String(date.getSeconds()).padStart(2, '0');
	return `${y}-${m}-${d}T${h}:${min}:${s}`;
}

function toIsoDate(date) {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

function formatLongDateFromIso(isoDate) {
	const date = new Date(`${isoDate}T00:00:00`);
	if (Number.isNaN(date.getTime())) return isoDate;
	return date.toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric'
	});
}

function monthLabel(date) {
	return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
}

function buildRescheduleCalendar(monthDate, selectedIsoDate) {
	const year = monthDate.getFullYear();
	const month = monthDate.getMonth();
	const firstOfMonth = new Date(year, month, 1);
	const lastOfMonth = new Date(year, month + 1, 0);
	const daysInMonth = lastOfMonth.getDate();
	const mondayStartOffset = (firstOfMonth.getDay() + 6) % 7;

	const dayCells = [];
	for (let i = 0; i < mondayStartOffset; i += 1) {
		const prevDate = new Date(year, month, -(mondayStartOffset - i - 1));
		dayCells.push(`<span class="day-filler">${prevDate.getDate()}</span>`);
	}

	for (let day = 1; day <= daysInMonth; day += 1) {
		const dayDate = new Date(year, month, day);
		const iso = toIsoDate(dayDate);
		const isActive = iso === selectedIsoDate ? ' active' : '';
		dayCells.push(`<button type="button" class="day-btn${isActive}" data-resched-date="${iso}">${day}</button>`);
	}

	return dayCells.join('');
}

function statusClass(status) {
	if (status === 'confirmed') return 'status-confirmed';
	if (status === 'completed') return 'status-completed';
	if (status === 'canceled' || status === 'cancelled' || status === 'rejected') return 'status-canceled';
	return 'status-pending';
}

function actionTitle(status) {
	if (status === 'completed') return 'Completed';
	if (status === 'canceled' || status === 'cancelled' || status === 'rejected') return 'Canceled';
	return 'Open';
}

function getFilteredAppointments() {
	const q = (ui.searchInput.value || '').trim().toLowerCase();
	const selectedStatus = ui.statusFilter.value;
	const selectedDate = ui.dateFilter.value;

	return state.appointments.filter((appointment) => {
		const searchable = `${appointment.patient} ${appointment.owner} ${appointment.service}`.toLowerCase();
		const matchesSearch = !q || searchable.includes(q);
		const matchesStatus = selectedStatus === 'all' || appointment.status === selectedStatus;
		const matchesDate = !selectedDate || appointment.datetime.startsWith(selectedDate);
		return matchesSearch && matchesStatus && matchesDate;
	});
}

function updateCounters() {
	const pendingCount = state.appointments.filter((item) => item.status === 'pending').length;
	const confirmedCount = state.appointments.filter((item) => item.status === 'confirmed').length;
	ui.pendingCount.textContent = String(pendingCount).padStart(2, '0');
	ui.confirmedCount.textContent = String(confirmedCount).padStart(2, '0');
	ui.acceptAllButton.disabled = pendingCount === 0;
}

function renderPendingList() {
	const pending = state.appointments
		.filter((item) => item.status === 'pending')
		.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

	ui.pendingHolder.innerHTML = '';
	if (!pending.length) {
		ui.pendingEmpty.hidden = false;
		return;
	}

	ui.pendingEmpty.hidden = true;
	ui.pendingHolder.innerHTML = pending.map((item) => {
		const dt = formatDateTime(item.datetime);
		return `
			<article class="pending-item" data-id="${item.id}">
				<p class="time">${dt.date} - ${dt.time}</p>
				<h4>${item.patient}</h4>
				<p>${item.service}</p>
				<div class="pending-actions">
					<button class="accept" data-action="accept" data-id="${item.id}" type="button">Accept</button>
					<button class="decline" data-action="decline" data-id="${item.id}" type="button">Decline</button>
				</div>
			</article>
		`;
	}).join('');
}

function renderTable() {
	const filtered = getFilteredAppointments().sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
	const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
	state.page = Math.min(state.page, totalPages);

	const start = (state.page - 1) * state.pageSize;
	const pageRows = filtered.slice(start, start + state.pageSize);

	if (!pageRows.length) {
		ui.tbody.innerHTML = '<tr><td colspan="6">No appointments found for your filters.</td></tr>';
	} else {
		ui.tbody.innerHTML = pageRows.map((item) => {
			const dt = formatDateTime(item.datetime);
			const initials = item.patient.slice(0, 1).toUpperCase();
			return `
				<tr>
					<td><strong>${dt.date}</strong><br><span>${dt.time}</span></td>
					<td>
						<div class="patient-cell">
							<div class="patient-avatar">${initials}</div>
							<span>${item.patient}</span>
						</div>
					</td>
					<td>${item.owner}</td>
					<td>${item.service}</td>
					<td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
					<td>
						<div class="action-buttons">
							<button type="button" title="View" data-action="view" data-id="${item.id}"><img src="/vet/images/eye.png" alt="View"></button>
							<button type="button" title="Delete" data-action="delete" data-id="${item.id}"><img src="/vet/images/trash.png" alt="Delete"></button>
						</div>
					</td>
				</tr>
			`;
		}).join('');
	}

	ui.tableSummary.textContent = `Showing ${pageRows.length} of ${filtered.length} appointments`;
	ui.pageLabel.textContent = String(state.page);
	ui.prevPage.disabled = state.page <= 1;
	ui.nextPage.disabled = state.page >= totalPages;
}

function rebuildCalendarEvents() {
	if (!calendar) return;

	calendar.removeAllEvents();
	state.appointments.forEach((item) => {
		calendar.addEvent({
			id: String(item.id),
			title: `${item.patient} (${actionTitle(item.status)})`,
			start: item.datetime,
			color: item.status === 'pending'
				? '#d6a308'
				: item.status === 'completed'
					? '#2f8243'
					: item.status === 'canceled'
						? '#b3202c'
						: '#1e61a7'
		});
	});
}

function refreshUI() {
	updateCounters();
	renderPendingList();
	renderTable();
	rebuildCalendarEvents();
}

async function updateStatus(id, nextStatus) {
	const selected = getAppointmentById(id);
	if (!selected) return;
	if (window.VetAPI?.updateAppointmentStatus) {
		const result = await window.VetAPI.updateAppointmentStatus(id, nextStatus);
		if (!result.ok) {
			alert(result.error || 'Failed to update appointment.');
			return;
		}
	}
	selected.status = nextStatus;
	state.page = 1;
	refreshUI();
}

function removeAppointment(id) {
	const index = state.appointments.findIndex((item) => item.id === id);
	if (index < 0) return;
	state.appointments.splice(index, 1);
	state.page = 1;
	refreshUI();
}

function openModal(contentHtml, widthClass) {
	ui.modalShell.classList.remove('modal-sm', 'modal-md');
	if (widthClass) ui.modalShell.classList.add(widthClass);
	ui.modalContent.innerHTML = contentHtml;
	ui.modalOverlay.hidden = false;
	document.body.style.overflow = 'hidden';
}

function closeModal() {
	ui.modalOverlay.hidden = true;
	ui.modalContent.innerHTML = '';
	document.body.style.overflow = '';
	state.selectedAppointmentId = null;
	state.selectedSlot = '';
	state.selectedDate = '';
	state.rescheduleMonth = null;
}

function detailsModalTemplate(appointment) {
	const dt = formatDateTime(appointment.datetime);
	return `
		<div class="details-header">
		<img src="/vet/images/appticon.png" alt="Patient photo" class="patient-photo">
		<h3 class="modal-title" id="modal-title">Appointment Details</h3>
		</div>
		<p class="modal-subtitle">Track status and take action for ${appointment.patient}.</p>
		<div class="details-top">
			<article class="patient-hero">
				<span class="badge">${appointment.status}</span>
				<h3>${appointment.patient}</h3>
				<p class="muted">${appointment.service} | ${appointment.type}</p>
			</article>
			<div class="detail-actions">
				<button class="btn btn-primary" type="button" data-modal-action="open-complete"><img src="/vet/images/completed.png" alt="Complete">Mark as Completed</button>
				<button class="btn btn-outline" type="button" data-modal-action="open-reschedule"><img src="/vet/images/reschedule.png" alt="Reschedule">Reschedule</button>
				<button class="btn btn-soft-danger" type="button" data-modal-action="open-cancel"><img src="/vet/images/cancel.png" alt="Cancel">Cancel Appointment</button>
			</div>
		</div>
		<div class="info-grid">
			<article class="info-panel">
				<h4>Appointment Information</h4>
				<p class="muted"><strong>Date:</strong> ${dt.date}</p>
				<p class="muted"><strong>Time:</strong> ${dt.time}</p>
				<p class="muted"><strong>Service:</strong> ${appointment.service}</p>
			</article>
			<article class="info-panel">
				<h4>Owner Information</h4>
				<p class="muted"><strong>Name:</strong> ${appointment.owner}</p>
				<p class="muted"><strong>Patient:</strong> ${appointment.patient}</p>
				<p class="muted"><strong>Type:</strong> ${appointment.type}</p>
			</article>
		</div>
		<article class="notes-panel">
			<h4>Medical Notes</h4>
			<p class="muted">Owner noted mild lethargy after morning walk. Observe appetite and hydration for 24 hours.</p>
		</article>
		<div class="modal-footer">
			<button class="btn btn-outline" type="button" data-modal-action="close">Close</button>
			<button class="btn btn-danger" type="button" data-modal-action="open-delete">Delete Record</button>
		</div>
	`;
}

function rescheduleModalTemplate(appointment) {
	const dt = formatDateTime(appointment.datetime);
	const selectedDate = state.selectedDate || dt.isoDate;
	const baseMonth = state.rescheduleMonth || new Date(`${selectedDate}T00:00:00`);
	const monthDate = new Date(baseMonth.getFullYear(), baseMonth.getMonth(), 1);
	const slotsOpenCount = RESCHEDULE_SLOTS.length;
	const selectedDateLabel = formatLongDateFromIso(selectedDate);
	const selectedSlotLabel = state.selectedSlot
		? (RESCHEDULE_SLOTS.find((slot) => slot.value === state.selectedSlot)?.display || state.selectedSlot)
		: 'No time selected';
	const slotCards = RESCHEDULE_SLOTS.map((slot) => {
		const active = state.selectedSlot === slot.value ? ' active' : '';
		return `
			<button type="button" class="slot-btn${active}" data-slot="${slot.value}">
				<span class="slot-label">${slot.label}</span>
				<h1>${slot.display}</h1>
			</button>
		`;
	}).join('');

	return `
		<h3 class="modal-title" id="modal-title">Reschedule Appointment</h3>
		<p class="modal-subtitle">Select a new date and time for ${appointment.patient}.</p>
		<div class="reschedule-layout">
			<section class="reschedule-calendar">
				<div class="reschedule-cal-head">
					<span class="reschedule-month">${monthLabel(monthDate)}</span>
					<div class="reschedule-nav">
						<button type="button" aria-label="Previous month" data-resched-nav="prev">&#8249;</button>
						<button type="button" aria-label="Next month" data-resched-nav="next">&#8250;</button>
					</div>
				</div>
				<div class="reschedule-weekdays">${RESCHEDULE_WEEK_DAYS.map((day) => `<span>${day}</span>`).join('')}</div>
				<div class="reschedule-days">${buildRescheduleCalendar(monthDate, selectedDate)}</div>
				<div class="selected-date-card">
					<p>Selected date</p>
					<div class="detailed-header">
					<img src="/vet/images/appticon.png" alt="Patient photo" class="patient-photo">
					<strong>${selectedDateLabel}</strong>
					</div>
				</div>
			</section>
			<section class="reschedule-slots">
				<div class="reschedule-slots-head">
					<h4>Available slots</h4>
					<span>${slotsOpenCount} Slots Open</span>
				</div>
				<div class="slot-grid">
					${slotCards}
				</div>
				<p class="muted"><strong>Current slot:</strong> ${dt.date} - ${dt.time}</p>
				<p class="muted"><strong>New slot:</strong> <span data-new-slot-line>${selectedDateLabel} at ${selectedSlotLabel}</span></p>
			</section>
		</div>
		<div class="two-actions">
			<button class="btn btn-outline" type="button" data-modal-action="open-details">Cancel</button>
			<button class="btn btn-primary" type="button" data-modal-action="confirm-reschedule">Confirm Reschedule</button>
		</div>
	`;
}

function completeModalTemplate(appointment) {
	const dt = formatDateTime(appointment.datetime);
	return `
		<div class="confirm-content">
			<div class="confirm-icon">&#10003;</div>
			<h3 class="confirm-title" id="modal-title">Mark As Completed</h3>
			<p class="confirm-text">You are about to mark this appointment as completed.</p>
			<article class="danger-card">
				<p class="muted"><strong>Owner:</strong> ${appointment.owner}</p>
				<p class="muted"><strong>Patient:</strong> ${appointment.patient}</p>
				<p class="muted"><strong>Date and Time:</strong> ${dt.date} - ${dt.time}</p>
				<p class="muted"><strong>Service:</strong> ${appointment.service}</p>
			</article>
			<textarea class="textarea" id="completion-notes" placeholder="Completion notes (optional)"></textarea>
			<div class="two-actions">
				<button class="btn btn-outline" type="button" data-modal-action="open-details">Cancel</button>
				<button class="btn btn-primary" type="button" data-modal-action="confirm-complete">Mark as Completed</button>
			</div>
		</div>
	`;
}

function cancelModalTemplate(appointment) {
	const dt = formatDateTime(appointment.datetime);
	return `
		<h3 class="modal-title" id="modal-title">Cancel Appointment</h3>
		<p class="modal-subtitle">The owner will be notified once this cancellation is confirmed.</p>
		<article class="danger-card">
			<p class="muted"><strong>Owner:</strong> ${appointment.owner}</p>
			<p class="muted"><strong>Pet:</strong> ${appointment.patient}</p>
			<p class="muted"><strong>Date and Time:</strong> ${dt.date} - ${dt.time}</p>
			<p class="muted"><strong>Type:</strong> ${appointment.type}</p>
		</article>
		<div class="two-actions">
			<button class="btn btn-outline" type="button" data-modal-action="open-details">Keep appointment</button>
			<button class="btn btn-danger" type="button" data-modal-action="confirm-cancel">Cancel appointment</button>
		</div>
	`;
}

function deleteModalTemplate(appointment) {
	const dt = formatDateTime(appointment.datetime);
	return `
		<h3 class="modal-title" id="modal-title">Delete Appointment Record?</h3>
		<p class="modal-subtitle">This action is permanent and cannot be undone.</p>
		<article class="danger-card">
			<p class="muted"><strong>Owner:</strong> ${appointment.owner}</p>
			<p class="muted"><strong>Pet:</strong> ${appointment.patient}</p>
			<p class="muted"><strong>Date and Time:</strong> ${dt.date} - ${dt.time}</p>
			<p class="muted"><strong>Type:</strong> ${appointment.type}</p>
		</article>
		<label class="muted" for="delete-confirm">Type DELETE to confirm</label>
		<input id="delete-confirm" class="textarea" style="min-height:38px" type="text" placeholder="DELETE">
		<div class="two-actions">
			<button class="btn btn-outline" type="button" data-modal-action="open-details">Keep</button>
			<button class="btn btn-danger" type="button" data-modal-action="confirm-delete">Confirm Delete</button>
		</div>
	`;
}

function openDetailsModal(appointmentId) {
	const selected = getAppointmentById(appointmentId);
	if (!selected) return;
	state.selectedAppointmentId = selected.id;
	openModal(detailsModalTemplate(selected));
}

function openRescheduleModal() {
	const selected = getAppointmentById(state.selectedAppointmentId);
	if (!selected) return;
	const selectedDate = new Date(selected.datetime);
	state.selectedDate = toIsoDate(selectedDate);
	state.rescheduleMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
	const currentTime = `${String(selectedDate.getHours()).padStart(2, '0')}:${String(selectedDate.getMinutes()).padStart(2, '0')}`;
	state.selectedSlot = RESCHEDULE_SLOTS.some((slot) => slot.value === currentTime) ? currentTime : '';
	openModal(rescheduleModalTemplate(selected));
}

function rerenderRescheduleModal() {
	const selected = getAppointmentById(state.selectedAppointmentId);
	if (!selected) return;
	openModal(rescheduleModalTemplate(selected));
}

function openCompleteModal() {
	const selected = getAppointmentById(state.selectedAppointmentId);
	if (!selected) return;
	openModal(completeModalTemplate(selected), 'modal-md');
}

function openCancelModal() {
	const selected = getAppointmentById(state.selectedAppointmentId);
	if (!selected) return;
	openModal(cancelModalTemplate(selected), 'modal-sm');
}

function openDeleteModal() {
	const selected = getAppointmentById(state.selectedAppointmentId);
	if (!selected) return;
	openModal(deleteModalTemplate(selected), 'modal-sm');
}

function applyReschedule() {
	const selected = getAppointmentById(state.selectedAppointmentId);
	if (!selected || !state.selectedSlot || !state.selectedDate) return;

	const nextDate = new Date(`${state.selectedDate}T00:00:00`);
	const [hours, minutes] = state.selectedSlot.split(':').map(Number);
	nextDate.setHours(hours, minutes, 0, 0);
	selected.datetime = toLocalDateTimeString(nextDate);
	selected.status = 'confirmed';
	closeModal();
	refreshUI();
}

function applyComplete() {
	updateStatus(state.selectedAppointmentId, 'completed');
	closeModal();
}

function applyCancel() {
	updateStatus(state.selectedAppointmentId, 'cancelled');
	closeModal();
}

async function applyDelete() {
	const input = document.getElementById('delete-confirm');
	if (!input || input.value !== 'DELETE') return;
	if (window.VetAPI?.deleteAppointment) {
		const result = await window.VetAPI.deleteAppointment(state.selectedAppointmentId);
		if (!result.ok) {
			alert(result.error || 'Failed to delete appointment.');
			return;
		}
	}
	removeAppointment(state.selectedAppointmentId);
	closeModal();
}

function setupCalendar() {
	const calendarEl = document.getElementById('calendar');
	if (!calendarEl || typeof FullCalendar === 'undefined') return;

	calendar = new FullCalendar.Calendar(calendarEl, {
		initialView: 'dayGridMonth',
		headerToolbar: {
			left: 'prev',
			center: 'title',
			right: 'next'
		},
		height: 350,
		fixedWeekCount: true,
		expandRows: true,
		dayMaxEventRows: 1
	});

	calendar.render();
	rebuildCalendarEvents();
}

function onTableFiltersChanged() {
	state.page = 1;
	renderTable();
}

function setupEvents() {
	ui.searchInput.addEventListener('input', onTableFiltersChanged);
	ui.statusFilter.addEventListener('change', onTableFiltersChanged);
	ui.dateFilter.addEventListener('change', onTableFiltersChanged);

	ui.clearFilters.addEventListener('click', () => {
		ui.searchInput.value = '';
		ui.statusFilter.value = 'all';
		ui.dateFilter.value = '';
		onTableFiltersChanged();
	});

	ui.prevPage.addEventListener('click', () => {
		state.page = Math.max(1, state.page - 1);
		renderTable();
	});

	ui.nextPage.addEventListener('click', () => {
		state.page += 1;
		renderTable();
	});

	ui.acceptAllButton.addEventListener('click', async () => {
		const pending = state.appointments.filter((item) => item.status === 'pending');
		await Promise.all(pending.map((item) => updateStatus(item.id, 'confirmed')));
		refreshUI();
	});

	ui.pendingHolder.addEventListener('click', (event) => {
		const button = event.target.closest('button[data-action]');
		if (!button) return;

		const id = Number(button.dataset.id);
		if (button.dataset.action === 'accept') updateStatus(id, 'confirmed');
		if (button.dataset.action === 'decline') {
			state.selectedAppointmentId = id;
			openCancelModal();
		}
	});

	ui.tbody.addEventListener('click', (event) => {
		const button = event.target.closest('button[data-action]');
		if (!button) return;

		const id = Number(button.dataset.id);
		state.selectedAppointmentId = id;

		if (button.dataset.action === 'view') openDetailsModal(id);
		if (button.dataset.action === 'delete') {
			state.selectedAppointmentId = id;
			openDeleteModal();
		}
	});

	ui.modalClose.addEventListener('click', closeModal);

	ui.modalOverlay.addEventListener('click', (event) => {
		if (event.target === ui.modalOverlay) closeModal();
	});

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && !ui.modalOverlay.hidden) closeModal();
	});

	ui.modalContent.addEventListener('click', (event) => {
		const actionEl = event.target.closest('[data-modal-action]');
		if (actionEl) {
			const action = actionEl.dataset.modalAction;
			if (action === 'close') closeModal();
			if (action === 'open-details') openDetailsModal(state.selectedAppointmentId);
			if (action === 'open-reschedule') openRescheduleModal();
			if (action === 'open-complete') openCompleteModal();
			if (action === 'open-cancel') openCancelModal();
			if (action === 'open-delete') openDeleteModal();
			if (action === 'confirm-reschedule') applyReschedule();
			if (action === 'confirm-complete') applyComplete();
			if (action === 'confirm-cancel') applyCancel();
			if (action === 'confirm-delete') applyDelete();
			return;
		}

		const slotEl = event.target.closest('[data-slot]');
		if (slotEl) {
			state.selectedSlot = slotEl.dataset.slot;
			ui.modalContent.querySelectorAll('[data-slot]').forEach((slotButton) => {
				slotButton.classList.remove('active');
			});
			slotEl.classList.add('active');
			const selected = getAppointmentById(state.selectedAppointmentId);
			if (selected) {
				const selectedDateLabel = formatLongDateFromIso(state.selectedDate || formatDateTime(selected.datetime).isoDate);
				const selectedSlotLabel = RESCHEDULE_SLOTS.find((slot) => slot.value === state.selectedSlot)?.display || state.selectedSlot;
				const newSlotLine = ui.modalContent.querySelector('[data-new-slot-line]');
				if (newSlotLine) newSlotLine.textContent = `${selectedDateLabel} at ${selectedSlotLabel}`;
			}
			return;
		}

		const dateEl = event.target.closest('[data-resched-date]');
		if (dateEl) {
			state.selectedDate = dateEl.dataset.reschedDate;
			rerenderRescheduleModal();
			return;
		}

		const navEl = event.target.closest('[data-resched-nav]');
		if (navEl) {
			if (!state.rescheduleMonth) {
				state.rescheduleMonth = new Date();
			}
			const monthStep = navEl.dataset.reschedNav === 'prev' ? -1 : 1;
			state.rescheduleMonth = new Date(
				state.rescheduleMonth.getFullYear(),
				state.rescheduleMonth.getMonth() + monthStep,
				1
			);
			rerenderRescheduleModal();
		}
	});
}

function exposeApi() {
	window.VBetterAppointments = {
		setDataset(dataset) {
			loadAppointments(dataset);
		},
		getDataset() {
			return [...state.appointments];
		},
		refresh() {
			refreshUI();
		}
	};
}

async function init() {
	ui.modalOverlay.hidden = true;
	document.body.style.overflow = '';
	setupCalendar();
	setupEvents();
	if (window.VetAPI?.getAppointments) {
		const result = await window.VetAPI.getAppointments();
		loadAppointments(result.ok ? result.data : undefined);
	} else {
		loadAppointments();
	}
	exposeApi();
}

init();

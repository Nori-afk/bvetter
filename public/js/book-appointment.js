/* =============================================
   BVetter — Book Appointment Page JS
   File: js/book-appointment.js
   Depends: nav.js, api.js

   Functions:
   - showPage(page)       — switch between 3 page views
   - goStep(n)            — navigate booking form steps 1-5
   - updateStepper(n)     — update header step dots
   - populateReview()     — fill step 4 review from form inputs
   - updateVetProfile(v)  — update profile card with vet data
   - buildCalendar(y, m)  — render dynamic calendar grid
   ============================================= */

/* ── Calendar state ──────────────────────────── */
let calYear, calMonth;

/* ── Tracks currently selected vet + date ────── */
let selectedVetId   = null;
let selectedCalDate = null;   // 'YYYY-MM-DD'

/* ── Time picked in the preview calendar's hour grid,
   carried into step 3 so the owner isn't asked to pick
   the same date/time twice. Reset whenever the grid is
   rebuilt (new day / new vet) since availability changes. */
let selectedPreviewSlot = null;

/* ── Local calendar date as 'YYYY-MM-DD' ─────────
   toISOString() converts to UTC first, which is one day
   off from the local date for part of the day in any
   timezone ahead of UTC (e.g. early morning in PH, UTC+8).
   That off-by-one let yesterday's date pass the "min" /
   past-date checks below, so use local Y/M/D instead.
─────────────────────────────────────────────────── */
function toLocalIsoDate(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// getDay() → 0=Sun … 6=Sat, so weekend is either end of that range.
// Shared by the calendar grid and the native apptDate input so both
// agree on what counts as a weekend.
function isWeekendDate(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function isWeekendIso(dateIso) {
  if (!dateIso) return false;
  const [y, m, d] = dateIso.split('-').map(Number);
  return isWeekendDate(new Date(y, m - 1, d));
}

// Weekdays the clinic is closed -- Philippine holidays plus dates the office
// marks closed -- as { 'YYYY-MM-DD': 'Christmas Day' }. Loaded from the
// server, which refuses a booking on these days anyway; this just grays them
// out so nobody picks one.
let CLOSED_DATES = {};

async function loadClosedDates() {
  try {
    const res = await fetch('/api/appointments/appointment.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'closed_dates' })
    });
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      CLOSED_DATES = Object.fromEntries(json.data.map((day) => [day.date, day.name]));
    }
  } catch {
    // Keep what we have; the server still refuses a closed date.
  }
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// How far ahead an owner may book. Keeps the calendar from filling with
// speculative bookings that hold slots nobody will honour. Mirrored
// server-side in bookAppointment() — the input attribute is only UX.
const BOOKING_HORIZON_MONTHS = 3;

// Oldest plausible pet, used as the floor for vaccination history. Matches
// MAX_PET_AGE_YEARS in vet/js/patient-records.js.
const MAX_PET_AGE_YEARS = 30;

function bookingHorizonDate() {
  const horizon = new Date();
  horizon.setHours(0, 0, 0, 0);
  horizon.setMonth(horizon.getMonth() + BOOKING_HORIZON_MONTHS);
  return horizon;
}

function buildCalendar(year, month) {
  const today_input = toLocalIsoDate();
  const apptDate = document.getElementById("apptDate");
  apptDate.min = today_input;
  apptDate.max = toLocalIsoDate(bookingHorizonDate());

  // petVaccDate still spans past and future — owners log a vaccination already
  // given or one already scheduled — but not by decades. The floor matches the
  // oldest plausible pet, the ceiling a year out.
  document.querySelectorAll('#petVaccDate, [data-pet-field="petVaccDate"]').forEach(vaccDate => {
    const floor = new Date();
    floor.setFullYear(floor.getFullYear() - MAX_PET_AGE_YEARS);
    const ceiling = new Date();
    ceiling.setFullYear(ceiling.getFullYear() + 1);
    vaccDate.min = toLocalIsoDate(floor);
    vaccDate.max = toLocalIsoDate(ceiling);
  });

  calYear = year;
  calMonth = month;

  const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  const DAY_LABELS = ['MO','TU','WE','TH','FR','SA','SU'];

  document.querySelector('.cal-month').textContent =
    `${MONTH_NAMES[month]} ${year}`;

  const grid = document.querySelector('.cal-grid');
  const today = new Date();

  // Remove time so only the date is compared
  today.setHours(0, 0, 0, 0);

  const horizon = bookingHorizonDate();

  // Rebuild grid: labels + day cells
  grid.innerHTML = DAY_LABELS
    .map(d => `<div class="cal-day-label">${d}</div>`)
    .join('');

  // getDay() → 0=Sun … 6=Sat; convert to Mon-based (Mon=0 … Sun=6)
  const firstDayRaw = new Date(year, month, 1).getDay();
  const startOffset = firstDayRaw === 0 ? 6 : firstDayRaw - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < startOffset; i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-day empty';
    grid.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');

    const cellDate = new Date(year, month, d);
    cellDate.setHours(0, 0, 0, 0);

    const isPast = cellDate < today;
    // A holiday is treated exactly like a weekend: closed.
    const closedReason = CLOSED_DATES[toIsoDate(cellDate)] || '';
    const isWeekend = isWeekendDate(cellDate) || closedReason !== '';
    const isBeyondHorizon = cellDate > horizon;

    const isToday =
      d === today.getDate() &&
      month === today.getMonth() &&
      year === today.getFullYear();

    cell.className = 'cal-day';

    if (isToday) cell.classList.add('today');
    if (isPast || isWeekend || isBeyondHorizon) cell.classList.add('disabled');
    if (closedReason) {
      cell.classList.add('closed');
      cell.title = `Clinic closed: ${closedReason}`;
    }

    cell.textContent = d;

    // Only allow clicking today/future weekdays inside the booking horizon —
    // vet isn't available weekends
    if (!isPast && !isWeekend && !isBeyondHorizon) {
      cell.addEventListener('click', () => {
        grid.querySelectorAll('.cal-day').forEach(c => c.classList.remove('today'));

        cell.classList.add('today');

        const mm = String(month + 1).padStart(2, '0');
        const dd = String(d).padStart(2, '0');
        selectedCalDate = `${year}-${mm}-${dd}`;

        fetchAndBuildSlots();
      });
    }

    grid.appendChild(cell);
  }
}


// Init calendar to current month and set today as the selected date
(function initCalendar() {
  const now = new Date();

  buildCalendar(now.getFullYear(), now.getMonth());
  // Redraw once the holidays are known.
  loadClosedDates().then(() => buildCalendar(calYear, calMonth));

  // Set today as the default selected date so slots load on page open
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  selectedCalDate = `${now.getFullYear()}-${mm}-${dd}`;

  const calBtns = document.querySelectorAll('.cal-btn');

  calBtns[0].addEventListener('click', () => {
    let m = calMonth - 1;
    let y = calYear;

    if (m < 0) {
      m = 11;
      y--;
    }

    buildCalendar(y, m);
  });

  calBtns[1].addEventListener('click', () => {
    let m = calMonth + 1;
    let y = calYear;

    if (m > 11) {
      m = 0;
      y++;
    }

    buildCalendar(y, m);
  });
})();


/* ── Fetch booked slots then rebuild grid ────────
   Calls appointments.php?action=booked_slots with
   the current vet + date. Confirmed slots come back
   and are passed to buildTimeSlots() as unavailable.
─────────────────────────────────────────────────── */
async function fetchAndBuildSlots() {
  if (!selectedVetId || !selectedCalDate) {
    buildTimeSlots([]);
    return;
  }

  console.log('[slots] fetching for vet:', selectedVetId, 'date:', selectedCalDate);

  try {
    const res  = await fetch('/api/appointments/appointment.php', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        action          : 'booked_slots',
        veterinarian_id : selectedVetId,
        preferred_date  : selectedCalDate
      })
    });
    const json = await res.json();
    console.log('[slots] booked:', json.booked);
    buildTimeSlots(json.success ? (json.booked || []) : [], json.success ? (json.requested || []) : []);
  } catch (err) {
    console.error('[slots] fetch failed:', err);
    buildTimeSlots([]);
  }
}

/* ── Time slot builder ───────────────────────
   Slots must match the format stored in DB
   (same values as the slot-btn data-slot attrs)
─────────────────────────────────────────────── */
const ALL_TIME_SLOTS = [
  '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM',
  '1:00 PM', '2:00 PM',  '3:00 PM',  '4:00 PM'
];

/* ── Slot-time helpers ────────────────────────
   A time slot for TODAY that has already started shouldn't stay
   clickable — otherwise an owner can "book" 8:00 AM at 4:00 PM.
   Slots for any other date are never affected by this check.
─────────────────────────────────────────────── */
function parseSlotMinutes(slot) {
  const match = String(slot || '').match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const meridiem = match[3].toUpperCase();
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return hour * 60 + minute;
}

/* Booked slots come back from the server as 24-hour 'HH:MM' ('15:00'); the
   buttons on this page are labelled '3:00 PM'. Compared as plain strings
   they never matched, so a time another owner already held stayed
   clickable here and the owner only found out when the server refused it.
   Both sides go through this before comparing. */
function canonicalSlot(value) {
  const text = String(value ?? '').trim();
  const minutes = parseSlotMinutes(text);
  if (minutes !== null) {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : text;
}

function isSlotPast(dateIso, slot) {
  if (!dateIso || dateIso !== toLocalIsoDate()) return false;
  const slotMinutes = parseSlotMinutes(slot);
  if (slotMinutes === null) return false;
  const now = new Date();
  return slotMinutes <= (now.getHours() * 60 + now.getMinutes());
}

/* A time another owner has requested but the vet hasn't confirmed shows as
   "Requested" (see the legend). It can still be requested -- the vet
   confirms one request per time and the rest are declined. */
function buildTimeSlots(unavailableSlots = [], requestedSlots = []) {
  const grid = document.getElementById('timeGrid');
  if (!grid) return;
  grid.innerHTML = '';
  selectedPreviewSlot = null;   // grid rebuilt — any earlier pick no longer applies

  const booked = new Set(unavailableSlots.map(canonicalSlot));
  const requested = new Set(requestedSlots.map(canonicalSlot));
  ALL_TIME_SLOTS.forEach(slot => {
    const div    = document.createElement('div');
    const isNA   = booked.has(canonicalSlot(slot)) || isSlotPast(selectedCalDate, slot);
    const isRequested = !isNA && requested.has(canonicalSlot(slot));
    div.className   = 'time-slot ' + (isNA ? 'na' : 'available') + (isRequested ? ' requested' : '');
    div.textContent = slot;
    if (isRequested) div.title = 'Requested';

    if (!isNA) {
      div.addEventListener('click', () => {
        grid.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
        div.classList.add('selected');
        selectedPreviewSlot = slot;
      });
    }

    grid.appendChild(div);
  });
}

// Build on page load — all slots available until backend provides data
buildTimeSlots();



function updateVetProfile(vet) {
  replaceContent()
  console.log(vet)

  const profileImgWrap = document.getElementById('profile-heads');
  if (profileImgWrap) {
    profileImgWrap.innerHTML = avatarMarkup(vet.full_name, vet.avatar, 'vet-profile-img');
  }

  const set = (id, val, fallback = '—') =>
    (document.getElementById(id) || {}).textContent = val || fallback;

  set('profile-name',         vet.full_name,           'Dr. Jane Igaya');
  set('profile-title',        vet.position_title,       'Senior Veterinarian');
  set('profile-clinic',       vet.clinic_location,      'Baliwag Vet Clinic');
  set('profile-rating',       vet.rating,               'New');
  set('profile-review-count', vet.review_count ? `(${vet.review_count} reviews)` : '(No reviews yet)');
  // stat-patients-val is populated by replaceContent() (completed appointment count for this vet)
  set('stat-rating-val',      vet.rating_percentage ? `${vet.rating_percentage}%`        : 'New');
  set('edu-tag',              vet.education,            'DVM, Cornell University');
  set('section-desc',         vet.bio,                  "This veterinarian hasn't added a bio yet.");

  // Keep the booking-steps header (page 2) in sync with whichever vet
  // was actually selected on page 1 — it used to be a static placeholder.
  set('vet-booked-name',      vet.full_name,           'Dr. Jane Igaya');
  set('vet-booked-role',      vet.position_title,      'Senior Veterinarian');
  set('vet-booked-initials',  getInitials(vet.full_name), '?');
}


/* ── Vet list fetch & click wiring ───────────── */
async function fetchVets() {
  const VetAccounts = await api.getVets();
  const temp        = await api.allUsers();

  // Build email → avatar lookup from allUsers (only allUsers has the avatar field)
  const avatarMap = {};
  (temp.data || []).forEach(user => {
    if (user.email) avatarMap[user.email] = user.avatar || '';
  });

  const container = document.getElementById('vetContainer');

  if (!Array.isArray(VetAccounts.data)) {
    console.error('fetchVets: expected VetAccounts.data to be an array, got:', VetAccounts.data);
    return;
  }

  VetAccounts.data.forEach((vet, index) => {
    // Merge avatar onto vet object by matching email
    vet.avatar = avatarMap[vet.email] || '';

    const item = document.createElement('div');
    item.className = 'vet-item' + (index === 0 ? ' active' : '');
    item.dataset.vetId = vet.id;
    item.innerHTML = `
      ${avatarMarkup(vet.full_name, vet.avatar, 'vet-thumb')}
      <div>
        <div class="vet-item-name">${escapeHtml(vet.full_name)}</div>
        <div class="vet-item-role">${escapeHtml(vet.position_title)}</div>
      </div>
    `;

    // FIX: attach click listener directly on the created element
    item.addEventListener('click', () => {
      document.querySelectorAll('.vet-item').forEach(v => v.classList.remove('active'));
      item.classList.add('active');
      selectedVetId = vet.id;          // track selected vet
      updateVetProfile(vet);
      fetchAndBuildSlots();
      loadVetFeedback(vet.id);        // refresh slots for new vet + current date
      loadCommonCases(vet.id);
    });

    container.appendChild(item);
  });

  // Show first vet's profile on load, then fetch real slot availability
  if (VetAccounts.data.length > 0) {
    selectedVetId = VetAccounts.data[0].id;
    updateVetProfile(VetAccounts.data[0]);
    fetchAndBuildSlots();
    loadVetFeedback(VetAccounts.data[0].id);// now both selectedVetId + selectedCalDate are set
    loadCommonCases(VetAccounts.data[0].id);
  }

  // Let the booking-draft restore logic re-select a saved vet now that
  // the list items actually exist.
  document.dispatchEvent(new CustomEvent('bv-vets-loaded'));
}
let lastRecentAppointments = null;

async function loadRecentHistory(options = {}) {
  const silent = options.silent === true;
  try {
    const session = JSON.parse(
      localStorage.getItem('vbetter_session') ||
      localStorage.getItem('bvetter_user') ||
      'null'
    );

    const res = await fetch('/api/appointments/appointment.php', {
      method: 'POST',
      // 'list' authenticates now, and the server pins owner_id to the session
      // for pet owners -- the owner_id below is ignored, kept only so the
      // request shape is unchanged for staff callers.
      headers: authHeaders(),
      body: JSON.stringify({
        action: 'list',
        owner_id: session?.userId || session?.id || ''
      })
    });

    const json = await res.json();

    if (!json.success || !json.data) return;

    // LIMIT TO ONLY 5
    const recentAppointments = json.data.slice(0, 5);

    // Silent (polled) refreshes skip the rebuild when nothing changed.
    const snapshot = JSON.stringify(recentAppointments);
    if (silent && snapshot === lastRecentAppointments) return;
    lastRecentAppointments = snapshot;

    const container = document.getElementById('recentHistoryList');
    container.innerHTML = '';

    recentAppointments.forEach(appt => {
      let reviewBtn = '';

      // completed but no review
      if (appt.status === 'completed' && !appt.owner_rating) {
        reviewBtn = `
          <button class="btn-rate"
            onclick="openReviewForm(${appt.id})">
            Rate & Review
          </button>
        `;
      }

      // already reviewed
      else if (appt.owner_rating) {
        reviewBtn = `
          <button class="btn-rate"
            onclick="openReviewForm(
              ${appt.id},
              ${appt.owner_rating},
              '${(appt.review_comment || '').replace(/'/g, "\\'")}'
            )">
            ${appt.owner_rating} ★ Rated
          </button>
        `;
      }

      // Pending, confirmed, cancelled...: a status, not an action. It used to
      // be a disabled button that still took the hand cursor and a hover
      // fill, so it looked clickable and did nothing.
      else {
        reviewBtn = `
          <span class="status-badge s-${appt.status}">
            <span class="status-dot"></span>
            ${statusText(appt.status)}
          </span>
        `;
      }
//  const icons = {
//   Consultation: "../images/icons/chatbot-consultation.png",
//   Vaccination: "../images/icons/syringe.svg",
//   Surgery: "../images/icons/icon-surgeon.svg",
//   Grooming: "../images/icons/icon-vitality.svg",
//   "Check-up": "../images/icons/icon-doctor.svg"
// };

// json.data.slice(0, 5).forEach(appt => {
//   const iconPath = icons[appt.appointment_type] ;

//   container.innerHTML += `
//     <div class="history-card">
//       <div style="display:flex; align-items:center; gap:14px;">
//         <div class="history-icon">
//           <img src="${iconPath}" alt="${appt.appointment_type}"/>
//         </div>

//         <div class="history-info">
//           <div class="history-name">${appt.service}</div>
//           <div class="history-meta">
//             ${appt.patient} &bull; ${formatDate(appt.preferred_date)}
//           </div>
//         </div>
//       </div>

//       ${reviewBtn}
//     </div>
//   `;
// });
//     });
      container.innerHTML += `
        <div class="history-card">
          <div style="display:flex; align-items:center; gap:14px;">
            <div class="history-icon">
              <img src="../images/icons/syringe.svg" alt="service"/>
            </div>

            <div class="history-info">
              <div class="history-name">
                ${appt.service}
              </div>

              <div class="history-meta">
                ${appt.patient} &bull; ${formatDate(appt.preferred_date)}
              </div>
            </div>
          </div>

          ${reviewBtn}
        </div>
      `;
    });

  } catch (err) {
    console.error('Failed to load recent history:', err);
  }
}

/* ── Castration & Spay Program status card ───── */
async function loadCspStatus() {
  const card = document.getElementById('cspStatusCard');
  if (!card) return;

  try {
    const session = JSON.parse(
      localStorage.getItem('vbetter_session') ||
      localStorage.getItem('bvetter_user') ||
      'null'
    );
    const ownerId = session?.userId || session?.id || '';
    if (!ownerId) return;

    const result = await api.getCspStatus(ownerId);
    if (!result.success || !result.registration) {
      card.classList.add('is-hidden');
      return;
    }

    const reg = result.registration;
    const rows = [];
    if (reg.status === 'scheduled') {
      rows.push(['Status', 'Scheduled']);
      rows.push(['Program Date', reg.program_date ? formatDate(reg.program_date) : 'To Be Announced']);
      rows.push(['Time', formatTimeSlot(reg.time_slot) || 'TBA']);
      rows.push(['Venue', reg.venue || 'TBA']);
      rows.push(['Queue Number', reg.queue_number ?? '—']);
    } else {
      rows.push(['Status', 'Pending Schedule']);
      rows.push(['Current Waiting List', `${result.waiting_count} Pets Registered`]);
      rows.push(['Program Date', 'To Be Announced']);
    }

    card.innerHTML = `
      <div class="csp-status-title">Municipal Castration &amp; Spay Program — ${escapeHtml(reg.pet_name || '')}</div>
      ${rows.map(([label, val]) => `
        <div class="csp-status-row"><span>${label}:</span><span class="csp-status-val">${escapeHtml(String(val))}</span></div>
      `).join('')}
    `;
    card.classList.remove('is-hidden');
  } catch (err) {
    console.error('Failed to load Castration & Spay status:', err);
  }
}

async function submitReview(appointmentId, rating, comment) {
  try {
    const res = await fetch('/api/appointments/appointment.php', {
      method: 'POST',
      // submit_review authenticates now: the server checks the appointment
      // actually belongs to the caller before accepting a rating.
      headers: authHeaders(),
      body: JSON.stringify({
        action: 'submit_review',
        appointment_id: appointmentId,
        rating: rating,
        comment: comment
      })
    });

    const json = await res.json();

    if (json.success) {
      loadAppointmentHistory(); // refresh history
    } else {
      await vbAlert(json.message || 'Failed to submit review.');
    }
  } catch (err) {
    console.error(err);
    await vbAlert('Failed to submit review.');
  }
}
/**
 * Owner's half of a reschedule. The clinic's proposed time isn't applied until
 * this runs, and declining leaves the original booking exactly as it was.
 */
async function respondToReschedule(appointmentId, decision) {
  const confirmText = decision === 'accept'
    ? 'Accept the new date and time for this appointment?'
    : 'Decline the new time? Your original appointment date will stay as it is.';

  if (!(await vbConfirm(confirmText))) return;

  try {
    const res = await fetch('/api/appointments/appointment.php', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        action: 'respond_reschedule',
        appointment_id: appointmentId,
        decision: decision
      })
    });

    const json = await res.json();

    if (json.success) {
      await vbAlert(json.message);
      loadAppointmentHistory();
    } else {
      await vbAlert(json.message || 'Could not save your response.');
    }
  } catch (err) {
    console.error(err);
    await vbAlert('Could not save your response — check your connection.');
  }
}

let activeOwnerRescheduleId = null;

async function openOwnerReschedule(appointmentId) {
  const appointment = ownerAppointmentHistory.find(item => Number(item.id) === Number(appointmentId));
  if (!appointment || !['confirmed', 'completed'].includes(appointment.status)) return;

  activeOwnerRescheduleId = Number(appointmentId);
  await loadClosedDates();
  const dateInput = document.getElementById('ownerRescheduleDate');
  const timeSelect = document.getElementById('ownerRescheduleTime');
  const overlay = document.getElementById('ownerRescheduleModal');
  const error = document.getElementById('ownerRescheduleError');
  const availability = document.getElementById('ownerRescheduleAvailability');
  if (!dateInput || !timeSelect || !overlay) return;

  dateInput.min = toLocalIsoDate();
  dateInput.max = toLocalIsoDate(bookingHorizonDate());
  dateInput.value = '';
  timeSelect.value = '';
  timeSelect.disabled = true;
  document.getElementById('ownerRescheduleReason').value = '';
  availability.textContent = 'Choose a date to check available times.';
  error.hidden = true;
  error.textContent = '';
  document.getElementById('ownerRescheduleCurrent').textContent =
    `Current appointment: ${formatDate(appointment.preferred_date)} at ${formatTimeSlot(appointment.time_slot)}. The current booking stays in place until the clinic responds.`;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  dateInput.focus();
}

function closeOwnerRescheduleModal() {
  document.getElementById('ownerRescheduleModal')?.classList.remove('open');
  document.body.style.overflow = '';
  activeOwnerRescheduleId = null;
}

function ownerRescheduleDateError(dateIso) {
  if (!dateIso) return 'Choose a new date.';
  if (dateIso < toLocalIsoDate()) return 'Choose today or a future date.';
  if (dateIso > toLocalIsoDate(bookingHorizonDate())) return `Appointments can only be scheduled up to ${BOOKING_HORIZON_MONTHS} months ahead.`;
  if (isWeekendIso(dateIso)) return 'The clinic is closed on Saturdays and Sundays.';
  if (CLOSED_DATES[dateIso]) return `The clinic is closed on this date (${CLOSED_DATES[dateIso]}). Choose another date.`;
  return '';
}

async function refreshOwnerRescheduleAvailability() {
  const dateInput = document.getElementById('ownerRescheduleDate');
  const timeSelect = document.getElementById('ownerRescheduleTime');
  const availability = document.getElementById('ownerRescheduleAvailability');
  const error = document.getElementById('ownerRescheduleError');
  const appointment = ownerAppointmentHistory.find(item => Number(item.id) === activeOwnerRescheduleId);
  if (!dateInput || !timeSelect || !availability || !appointment) return;

  error.hidden = true;
  error.textContent = '';

  const dateIso = dateInput.value;
  timeSelect.value = '';
  timeSelect.disabled = true;
  const dateError = ownerRescheduleDateError(dateIso);
  if (dateError) {
    availability.textContent = dateIso ? 'No times available for this date.' : 'Choose a date to check available times.';
    if (dateIso) {
      error.textContent = dateError;
      error.hidden = false;
    }
    return;
  }
  error.hidden = true;
  availability.textContent = 'Checking available times…';

  try {
    const response = await fetch('/api/appointments/appointment.php', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        action: 'booked_slots',
        veterinarian_id: appointment.veterinarian_id || '',
        preferred_date: dateIso,
        exclude_id: appointment.id
      })
    });
    const result = await response.json();
    if (!result.success) throw new Error(result.message || 'Could not check availability.');

    const booked = new Set((result.booked || []).map(canonicalSlot));
    let availableCount = 0;
    [...timeSelect.options].forEach(option => {
      if (!option.value) return;
      const slot = canonicalSlot(option.value);
      const sameCurrentSlot = dateIso === appointment.preferred_date
        && slot === canonicalSlot(appointment.time_slot);
      const unavailable = booked.has(slot) || isSlotPast(dateIso, option.value) || sameCurrentSlot;
      option.disabled = unavailable;
      option.textContent = unavailable ? `${option.value} — unavailable` : option.value;
      if (!unavailable) availableCount += 1;
    });
    timeSelect.disabled = availableCount === 0;
    availability.textContent = availableCount
      ? `${availableCount} time${availableCount === 1 ? '' : 's'} available. Times marked unavailable are already booked or have passed.`
      : 'No times are available on this date. Choose another date.';
  } catch (requestError) {
    availability.textContent = 'Availability could not be checked.';
    error.textContent = requestError.message || 'Could not check available times.';
    error.hidden = false;
  }
}

async function submitOwnerRescheduleRequest(event) {
  event.preventDefault();
  const appointment = ownerAppointmentHistory.find(item => Number(item.id) === activeOwnerRescheduleId);
  const dateIso = document.getElementById('ownerRescheduleDate')?.value || '';
  const timeSlot = document.getElementById('ownerRescheduleTime')?.value || '';
  const reason = (document.getElementById('ownerRescheduleReason')?.value || '').trim();
  const error = document.getElementById('ownerRescheduleError');
  const submitButton = document.getElementById('ownerRescheduleSubmit');
  if (!appointment || !error || !submitButton) return;

  const dateError = ownerRescheduleDateError(dateIso);
  if (dateError) {
    error.textContent = dateError;
    error.hidden = false;
    return;
  }
  if (!timeSlot || document.getElementById('ownerRescheduleTime')?.disabled) {
    error.textContent = 'Choose an available time.';
    error.hidden = false;
    return;
  }
  if (dateIso === appointment.preferred_date && canonicalSlot(timeSlot) === canonicalSlot(appointment.time_slot)) {
    error.textContent = 'Choose a different date or time from your current appointment.';
    error.hidden = false;
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Sending…';
  error.hidden = true;
  try {
    const response = await fetch('/api/appointments/appointment.php', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        action: 'request_reschedule',
        appointment_id: appointment.id,
        preferred_date: dateIso,
        time_slot: timeSlot,
        reason
      })
    });
    const result = await response.json();
    if (!result.success) {
      error.textContent = result.message || 'Could not send the reschedule request.';
      error.hidden = false;
      return;
    }
    closeOwnerRescheduleModal();
    await vbAlert(result.message || 'Your reschedule request was sent to the clinic.');
    await loadAppointmentHistory();
  } catch (requestError) {
    error.textContent = requestError.message || 'Could not send the reschedule request. Check your connection and try again.';
    error.hidden = false;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Send Request';
  }
}

document.getElementById('ownerRescheduleForm')?.addEventListener('submit', submitOwnerRescheduleRequest);
document.getElementById('ownerRescheduleDate')?.addEventListener('change', refreshOwnerRescheduleAvailability);

async function replaceContent(){
   try {
    const res = await fetch('/api/appointments/appointment.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'get_total',
        veterinarian_id: selectedVetId
      })
    });

    const json = await res.json();
    console.log(json)

    if (json.success) {
      document.getElementById('stat-patients-val').textContent = json.data;
      loadAppointmentHistory(); // refresh history
    } else {
      await vbAlert(json.message || 'Failed to submit review.');
    }
  } catch (err) {
    console.error(err);
    await vbAlert('Failed to submit review.');
  }
}

const ratingModalState = { appointmentId: null, value: 0 };

function openReviewForm(appointmentId, currentRating = '', currentComment = '') {
  ratingModalState.appointmentId = appointmentId;
  setRatingValue(parseInt(currentRating) || 0);
  document.getElementById('ratingComment').value = currentComment || '';
  document.getElementById('ratingError').hidden = true;
  document.getElementById('ratingModal').classList.add('open');
}

function closeRatingModal() {
  document.getElementById('ratingModal').classList.remove('open');
  ratingModalState.appointmentId = null;
}

function setRatingValue(value) {
  ratingModalState.value = value;
  const stars = document.querySelectorAll('#ratingStars .rating-star');
  stars.forEach((star) => {
    const isActive = parseInt(star.dataset.value) <= value;
    star.classList.toggle('active', isActive);
    const img = star.querySelector('img');
    if (img) img.src = isActive ? '../images/icons/rating.svg' : '../images/icons/rating-outline.svg';
  });
  const hint = document.getElementById('ratingHint');
  const labels = ['Tap a star to rate', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
  hint.textContent = labels[value] || labels[0];
  if (value > 0) document.getElementById('ratingError').hidden = true;
}

function initRatingStars() {
  const stars = document.querySelectorAll('#ratingStars .rating-star');
  stars.forEach((star) => {
    star.addEventListener('click', () => setRatingValue(parseInt(star.dataset.value)));
    star.addEventListener('mouseenter', () => previewRatingValue(parseInt(star.dataset.value)));
  });
  document.getElementById('ratingStars')?.addEventListener('mouseleave', () => setRatingValue(ratingModalState.value));
}

function previewRatingValue(value) {
  const stars = document.querySelectorAll('#ratingStars .rating-star');
  stars.forEach((star) => {
    const isActive = parseInt(star.dataset.value) <= value;
    star.classList.toggle('active', isActive);
    const img = star.querySelector('img');
    if (img) img.src = isActive ? '../images/icons/rating.svg' : '../images/icons/rating-outline.svg';
  });
}

function submitRatingModal() {
  if (!ratingModalState.value) {
    document.getElementById('ratingError').hidden = false;
    return;
  }
  const comment = document.getElementById('ratingComment').value.trim();
  submitReview(ratingModalState.appointmentId, ratingModalState.value, comment);
  closeRatingModal();
}

initRatingStars();
let lastAppointmentHistory = null;
let ownerAppointmentHistory = [];

async function loadAppointmentHistory(options = {}) {
  const silent = options.silent === true;
  try {
    const session = JSON.parse(
      localStorage.getItem('vbetter_session') ||
      localStorage.getItem('bvetter_user') ||
      'null'
    );

    const res = await fetch('/api/appointments/appointment.php', {
      method: 'POST',
      // 'list' authenticates now, and the server pins owner_id to the session
      // for pet owners -- the owner_id below is ignored, kept only so the
      // request shape is unchanged for staff callers.
      headers: authHeaders(),
      body: JSON.stringify({
        action: 'list',
        owner_id: session?.userId || session?.id || ''
      })
    });

    const json = await res.json();
    console.log('Appointment history:', json);

    // Silent (polled) refreshes skip the rebuild when nothing changed.
    const snapshot = JSON.stringify(json.data || []);
    if (silent && snapshot === lastAppointmentHistory) return;
    lastAppointmentHistory = snapshot;

    // The API keeps staff queues in appointment-date order. Owner history is
    // a record of requests, so show the most recently submitted appointment
    // first even when it is scheduled after an older request.
    const appointments = Array.isArray(json.data) ? [...json.data] : [];
    appointments.sort((a, b) => {
      const requestedAtOrder = String(b.requested_at || '').localeCompare(String(a.requested_at || ''));
      return requestedAtOrder || (Number(b.id) || 0) - (Number(a.id) || 0);
    });
    ownerAppointmentHistory = appointments;

    const histList = document.getElementById('histList');
    const histEmpty = document.getElementById('histEmpty');
    const completedCountEl = document.getElementById('complted-visit');

    completedCountEl.textContent = appointments.filter(appt => appt.status === 'completed').length;

    if (!json.success || appointments.length === 0) {
      histList.style.display = 'none';
      histEmpty.style.display = 'block';
      return;
    }

    histEmpty.style.display = 'none';
    histList.style.display = 'flex';
    histList.innerHTML = '';

    appointments.forEach(appt => {
      const awaitingResponse = appt.status === 'reschedule_pending';
      const awaitingClinic = appt.status === 'owner_reschedule_pending';
      const canRequestReschedule = appt.status === 'confirmed' || appt.status === 'completed';

      const rowClass = awaitingResponse || awaitingClinic
        ? 'appt-row appt-reschedule'
        : appt.status === 'completed'
          ? 'appt-row appt-completed'
          : appt.status === 'cancelled' || appt.status === 'rejected'
            ? 'appt-row appt-cancelled'
            : 'appt-row appt-pending';

      const statusBadge = `
        <span class="status-badge s-${appt.status}">
          <span class="status-dot"></span>
          ${statusText(appt.status)}
        </span>
      `;

      let reviewSection = '';

      // completed + not reviewed
      if (appt.status === 'completed' && !appt.owner_rating) {
        reviewSection = `
          ${statusBadge}
          <button class="btn-rate-review"
            onclick="openReviewForm(${appt.id})">
            Rate & Review
          </button>
          <button class="btn-request-reschedule" onclick="openOwnerReschedule(${appt.id})">Request Reschedule</button>
        `;
      }

      // completed + already reviewed
      else if (appt.status === 'completed' && appt.owner_rating) {
        reviewSection = `
          ${statusBadge}
          <span class="rated-badge"
            onclick="openReviewForm(
              ${appt.id},
              ${appt.owner_rating},
              '${(appt.review_comment || '').replace(/'/g, "\\'")}'
            )"
            style="cursor:pointer;">
            <img src="../images/icons/rating.svg" alt="" class="star-xs"/>
            ${appt.owner_rating} Rated
          </span>
          <button class="btn-request-reschedule" onclick="openOwnerReschedule(${appt.id})">Request Reschedule</button>
        `;
      }

      // The clinic proposed a new time and it isn't applied until the owner
      // answers, so this row needs an explicit accept/decline.
      else if (awaitingResponse) {
        reviewSection = `
          ${statusBadge}
          <div class="reschedule-actions">
            <button class="btn-reschedule-accept" onclick="respondToReschedule(${appt.id}, 'accept')">Accept</button>
            <button class="btn-reschedule-decline" onclick="respondToReschedule(${appt.id}, 'decline')">Decline</button>
          </div>
        `;
      }

      // An owner request does not move the booking until the clinic approves it.
      else if (awaitingClinic) {
        reviewSection = `
          ${statusBadge}
          <span class="owner-reschedule-pending-note">Waiting for clinic review</span>
        `;
      }

      // Confirmed appointments can be moved through a clinic-reviewed request.
      else if (appt.status === 'confirmed' && canRequestReschedule) {
        reviewSection = `
          ${statusBadge}
          <button class="btn-request-reschedule" onclick="openOwnerReschedule(${appt.id})">Request Reschedule</button>
        `;
      }

      // pending / others
      else {
        reviewSection = statusBadge;
      }

      histList.innerHTML += `
        <div class="${rowClass}">
          <div class="appt-col">
            <div class="appt-col-label">PET NAME</div>
            <div class="appt-pet-name">${escapeHtml(appt.patient)}</div>
            <div class="appt-pet-meta">
              ${appt.pets?.length > 1
                ? appt.pets.map(pet => `${escapeHtml(pet.name)}: ${escapeHtml(pet.species)}${pet.age ? ' • ' + escapeHtml(pet.age) : ''}`).join('<br>')
                : `${escapeHtml(appt.pet.species)}${appt.pet.age ? ' &bull; ' + escapeHtml(appt.pet.age) : ''}`}
            </div>
          </div>

          <div class="appt-col">
            <div class="appt-col-label">SERVICE</div>
            <div class="appt-service-name">${appt.service}</div>
            <div class="appt-doctor">
              ${appt.veterinarian || 'No veterinarian assigned'}
            </div>
          </div>

          <div class="appt-col">
            <div class="appt-col-label">DATE</div>
            <div class="appt-date-val${awaitingResponse || awaitingClinic ? ' appt-date-superseded' : ''}">
              ${formatDate(appt.preferred_date)}
            </div>
            <div class="appt-time-val${awaitingResponse || awaitingClinic ? ' appt-date-superseded' : ''}">${formatTimeSlot(appt.time_slot)}</div>
            ${awaitingResponse || awaitingClinic ? `
              <div class="appt-proposed">
                <div class="appt-col-label">${awaitingClinic ? 'REQUESTED' : 'PROPOSED'}</div>
                <div class="appt-date-val">${formatDate(appt.proposed_date)}</div>
                <div class="appt-time-val">${formatTimeSlot(appt.proposed_time_slot)}</div>
                ${appt.reschedule_reason ? `<div class="appt-proposed-reason">${escapeHtml(appt.reschedule_reason)}</div>` : ''}
              </div>
            ` : ''}
          </div>

          <div class="appt-actions">
            ${reviewSection}
          </div>
        </div>
      `;
    });

  } catch (err) {
    console.error('Failed to load appointment history:', err);
  }
}
async function loadVetFeedback(vetId) {
  try {
    const res = await fetch('/api/appointments/appointment.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'vet_reviews',
        veterinarian_id: vetId
      })
    });

    const json = await res.json();

    if (!json.success || !json.data || json.data.length === 0) {
      // No reviews yet
      document.getElementById('feedback-name').textContent = 'No reviews yet';
      document.getElementById('feedback-pet').textContent = '';
      document.getElementById('comment').textContent = 'This veterinarian has not received feedback yet.';
      document.getElementById('rate').innerHTML = '';
      document.getElementById('profile-rating').textContent = 'New';
      document.getElementById('stat-rating-val').textContent = 'New';
      document.getElementById('profile-review-count').textContent = '(No reviews yet)';
      return;
    }

    // Get latest review (or first one)
    const review = json.data.reduce((highest, current) =>
  current.rating > highest.rating ? current : highest
);
    const averageRating =
    json.data.reduce((sum, item) => sum + item.rating, 0) / json.data.length;


    document.getElementById('profile-rating').textContent=    `${averageRating.toFixed(1)} out of 5`;
    document.getElementById('stat-rating-val').textContent=getAverageRate(averageRating);
    document.getElementById('profile-review-count').textContent = "("+ json.data.length + ' reviews )';
    // Update reviewer info
    document.getElementById('feedback-name').textContent =
      review.owner_name || 'Anonymous';

    document.getElementById('feedback-pet').textContent =
      `Pet: ${review.pet_name || 'Unknown Pet'} (${review.species || ''})`;

    document.getElementById('comment').textContent =
      `"${review.comment || 'No comment provided'}"`;

    // Build stars
    const rating = parseInt(review.rating || 0);
    const starsContainer = document.getElementById('rate');

    starsContainer.innerHTML = '';

    for (let i = 0; i < rating; i++) {
      starsContainer.innerHTML += `
        <img src="../images/icons/rate.svg" alt="star" class="star-sm"/>
      `;
    }

  } catch (err) {
    console.error('Failed to load vet feedback:', err);
  }
}

const COMMON_CASE_ICONS = ['vet-symptom-1.svg', 'vet-symptom-3.svg', 'vet-symptom-2.svg', 'vet-symptom-4.svg'];

async function loadCommonCases(vetId) {
  const section = document.getElementById('commonCasesSection');
  const grid = document.getElementById('symptomsGrid');
  if (!section || !grid) return;

  let cases = [];

  try {
    const res = await fetch('/api/appointments/appointment.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'common_cases',
        veterinarian_id: vetId
      })
    });

    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      cases = json.data;
    }
  } catch (err) {
    console.error('Failed to load common cases:', err);
  }

  if (cases.length === 0) {
    section.style.display = 'none';
    grid.innerHTML = '';
    return;
  }

  section.style.display = '';
  grid.innerHTML = cases.map((label, i) => `
    <div class="symptom-item">
      <div class="symptom-icon"><img src="../images/icons/${COMMON_CASE_ICONS[i % COMMON_CASE_ICONS.length]}" alt=""/></div>
      ${escapeHtml(label)}
    </div>
  `).join('');
}

async function openReviewsModal() {
  const overlay = document.getElementById('reviewsModalOverlay');
  const list = document.getElementById('reviewsModalList');
  if (!overlay || !list) return;

  list.innerHTML = '<div class="feedback-text">Loading reviews...</div>';
  overlay.classList.add('active');

  try {
    const res = await fetch('/api/appointments/appointment.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'vet_reviews',
        veterinarian_id: selectedVetId
      })
    });

    const json = await res.json();

    if (!json.success || !json.data || json.data.length === 0) {
      list.innerHTML = '<div class="feedback-text">This veterinarian has not received feedback yet.</div>';
      return;
    }

    list.innerHTML = json.data.map(review => {
      const rating = parseInt(review.rating || 0);
      const stars = '<img src="../images/icons/rate.svg" alt="star" class="star-sm"/>'.repeat(rating);
      return `
        <div class="feedback-card">
          <div class="feedback-user">
            <div class="feedback-avatar"></div>
            <div class="feedback-user-info">
              <div class="feedback-name">${escapeHtml(review.owner_name || 'Anonymous')}</div>
              <div class="feedback-pet">Pet: ${escapeHtml(review.pet_name || 'Unknown Pet')} (${escapeHtml(review.species || '')})</div>
            </div>
            <div class="feedback-stars">${stars}</div>
          </div>
          <div class="feedback-text">"${escapeHtml(review.comment || 'No comment provided')}"</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load reviews:', err);
    list.innerHTML = '<div class="feedback-text">Failed to load reviews.</div>';
  }
}

function closeReviewsModal() {
  const overlay = document.getElementById('reviewsModalOverlay');
  if (overlay) overlay.classList.remove('active');
}

fetchVets();
loadRecentHistory();
loadCspStatus();

// Keep whichever history view is currently on screen in sync without a
// manual page reload — the small "Recent Appointment History" widget on
// the vet-selection page, or the full history page, whichever is active.
// Does nothing while the booking wizard (pageBooking) is on screen, so it
// never touches the in-progress booking draft.
if (typeof startPolling === 'function') {
  startPolling((opts) => {
    const pageHistoryEl = document.getElementById('pageHistory');
    if (pageHistoryEl && pageHistoryEl.classList.contains('active')) return loadAppointmentHistory(opts);
    const pageVetEl = document.getElementById('pageVet');
    if (pageVetEl && pageVetEl.classList.contains('active')) return loadRecentHistory(opts);
  }, 15000);
}

function getAverageRate(average) {
  if (average >= 5.0) {
    return '100%';
  }
  else if (average >= 4.5) {
    return '95%';
  }
  else if (average >= 4.0) {
    return '90%';
  }
  else if (average >= 3.5) {
    return '85%';
  }
  else if (average >= 3.0) {
    return '80%';
  }
  else if (average >= 2.5) {
    return '75%';
  }
  else if (average >= 2.0) {
    return '70%';
  }
  else if (average >= 1.5) {
    return '65%';
  }
  else if (average >= 1.0) {
    return '60%';
  }
  else {
    return '0%';
  }
}
/* ── Page + booking form logic ───────────────── */
(function () {
  'use strict';

  /* ── Page references ─────────────────────── */
  const pageVet     = document.getElementById('pageVet');
  const pageBooking = document.getElementById('pageBooking');
  const pageHistory = document.getElementById('pageHistory');

  /* ── Switch between 3 main page views ─────── */
  function showPage(page) {
    [pageVet, pageBooking, pageHistory].forEach(p => p.classList.remove('active'));
    page.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (page === pageHistory) {
      document.getElementById('histEmpty').style.display = 'none';
      document.getElementById('histList').style.display  = 'flex';
    }
  }

  /* ── Booking draft persistence (Google-Forms-like) ──
     Everything typed in steps 1-3 (plus the chosen vet, date and time
     slot) is autosaved to sessionStorage, so a reload or browser-Back
     drops the owner exactly where they left off instead of wiping the
     form. Cleared once the booking submits successfully (goStep(5)). ── */
  const BOOKING_DRAFT_KEY = 'bvetter_booking_draft';
  const CHATBOT_BOOKING_KEY = 'bvetter_chatbot_booking_context';
  const BOOKING_FIELD_IDS = [
    'ownerName', 'ownerContact', 'ownerEmail', 'ownerBarangay', 'ownerAddress',
    'petName', 'petType', 'petCategory', 'petRecordKind', 'petEstimatedCount', 'petBreed', 'petAgeValue', 'petAgeUnit', 'petSex', 'petVaccDate',
    'visitType', 'visitMode', 'fieldAddress', 'fieldConcern', 'apptDate', 'apptNotes'
  ];
  let currentStep = 1;
  let pendingRestoreVetId = null;

  const PET_FIELD_IDS = ['petName', 'petType', 'petCategory', 'petRecordKind', 'petEstimatedCount', 'petBreed', 'petAgeValue', 'petAgeUnit', 'petSex', 'petVaccDate'];
  const petsContainer = document.getElementById('bookingPets');
  const firstPetCard = petsContainer.querySelector('.booking-pet-card');
  PET_FIELD_IDS.forEach(id => {
    const field = document.getElementById(id);
    field.dataset.petField = id;
    if (id !== 'petAgeUnit') field.closest('.form-group')?.querySelector('label')?.setAttribute('for', id);
  });
  document.getElementById('petAgeUnit').setAttribute('aria-label', 'Age unit');
  const petCardTemplate = firstPetCard.cloneNode(true);
  let assessmentLogId = 0;
  let assessmentAnimal = '';
  let consultSymptomCatalog = [];
  let consultSymptomsLoaded = false;
  let consultSymptomsUnavailable = false;
  let nextPetCardId = 2;
  let activePetIndex = 0;
  let existingPets = [];

  const petCards = () => [...petsContainer.querySelectorAll('.booking-pet-card')];
  const petField = (card, field) => card.querySelector(`[data-pet-field="${field}"]`);
  const petValue = (card, field) => petField(card, field)?.value.trim() || '';

  function petDraftValues(card) {
    return { ...Object.fromEntries(PET_FIELD_IDS.map(id => [id, petValue(card, id)])), petId: card.dataset.petId || '' };
  }

  function fillPetCard(card, values = {}) {
    card.dataset.petId = values.petId || '';
    PET_FIELD_IDS.forEach(id => {
      const defaults = { petAgeUnit: 'Years', petRecordKind: 'individual', petEstimatedCount: '1' };
      petField(card, id).value = values[id] ?? defaults[id] ?? '';
    });
    card.querySelectorAll('.form-group').forEach(group => VBForm.clearGroupError(group));
    syncAnimalCard(card);
    const source = card.querySelector('[data-pet-source]');
    if (source) source.value = card.dataset.petId;
  }

  function syncAnimalCard(card) {
    const species = petValue(card, 'petType');
    const category = petField(card, 'petCategory');
    if (species && species !== 'Rabbit') category.value = ['Dog', 'Cat'].includes(species) ? 'companion' : 'livestock';
    const saved = Boolean(card.dataset.petId);
    category.disabled = saved || Boolean(species && species !== 'Rabbit');
    const kind = petField(card, 'petRecordKind');
    if (category.value === 'companion') kind.value = 'individual';
    kind.querySelector('option[value="group"]').disabled = category.value !== 'livestock';
    kind.disabled = saved;
    const group = kind.value === 'group';
    card.querySelector('[data-group-count]').classList.toggle('is-hidden', !group);
    petField(card, 'petBreed').required = false;
    const livestock = category.value === 'livestock';
    card.querySelector('[data-name-label]').textContent = livestock
      ? (group ? 'Herd/Flock Name *' : 'Name or Identifier *') : 'Pet Name *';
    card.querySelector('[data-species-label]').textContent = livestock ? 'Species *' : 'Pet Type *';
    [...petField(card, 'petSex').options].forEach(option => {
      if (option.value === 'Mixed') option.disabled = !group;
    });
    if (!group && petValue(card, 'petSex') === 'Mixed') petField(card, 'petSex').value = '';
    PET_FIELD_IDS.filter(id => id !== 'petEstimatedCount').forEach(id => {
      const field = petField(card, id);
      if (field.tagName === 'SELECT') {
        if (!['petCategory', 'petRecordKind'].includes(id)) field.disabled = saved;
      } else field.readOnly = saved;
    });
  }
  syncAnimalCard(firstPetCard);

  function updateBookingTerminology() {
    const livestock = petValue(petCards()[0], 'petCategory') === 'livestock';
    document.getElementById('sl2').textContent = livestock ? 'Livestock' : 'Pet';
    document.getElementById('bookingPatientTitle').textContent = livestock ? 'Livestock Details' : 'Pet Information';
    document.getElementById('s1NextLabel').textContent = livestock ? 'Livestock Details' : 'Pet Information';
    document.getElementById('s3BackLabel').textContent = livestock ? 'Livestock Details' : 'Pet Info';
    document.getElementById('reviewPatientTitle').textContent = livestock ? 'LIVESTOCK DETAILS' : 'PET INFO';
  }

  function renumberPetCards() {
    petCards().forEach((card, index) => {
      const livestock = petValue(card, 'petCategory') === 'livestock';
      const fallback = livestock
        ? (petValue(card, 'petRecordKind') === 'group' ? `Herd/Flock ${index + 1}` : `Livestock ${index + 1}`)
        : `Pet ${index + 1}`;
      card.querySelector('.booking-pet-title').textContent = petValue(card, 'petName') || fallback;
      const remove = card.querySelector('.btn-remove-pet');
      remove.hidden = petCards().length === 1;
      remove.setAttribute('aria-label', `Remove ${fallback}`);
    });
    const tabs = document.getElementById('bookingPetTabs');
    tabs.replaceChildren();
    tabs.hidden = petCards().length < 2;
    petCards().forEach((card, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'booking-pet-tab';
      button.dataset.index = index;
      button.textContent = card.querySelector('.booking-pet-title').textContent;
      tabs.appendChild(button);
    });
    showPetCard(Math.min(activePetIndex, petCards().length - 1));
    updateBookingTerminology();
  }

  function showPetCard(index) {
    activePetIndex = index;
    petCards().forEach((card, number) => { card.hidden = number !== index; });
    document.querySelectorAll('#bookingPetTabs .booking-pet-tab').forEach((button, number) => {
      button.classList.toggle('active', number === index);
      button.setAttribute('aria-current', number === index ? 'true' : 'false');
    });
  }

  document.getElementById('bookingPetTabs').addEventListener('click', event => {
    const button = event.target.closest('[data-index]');
    if (button) showPetCard(Number(button.dataset.index));
  });

  function populatePetSources(card) {
    const source = card.querySelector('[data-pet-source]');
    source.replaceChildren(new Option('Add new animal', ''));
    existingPets.forEach(pet => source.add(new Option(`${pet.petName} (${pet.species})`, String(pet.id))));
    source.value = card.dataset.petId || '';
  }

  async function loadExistingPets() {
    let session = null;
    try { session = JSON.parse(localStorage.getItem('vbetter_session') || 'null'); } catch { /* new animal remains available */ }
    if (!localStorage.getItem('bvetter_token') && !session?.token) return;
    try {
      const result = await api.getMyPets();
      if (!result.success || !Array.isArray(result.data)) return;
      existingPets = result.data;
      petCards().forEach(populatePetSources);
    } catch { /* owners can still add a new animal */ }
  }
  populatePetSources(firstPetCard);
  renumberPetCards();
  loadExistingPets();

  function savedPetValues(pet) {
    const age = String(pet.age || '').match(/^(\d+)\s*([a-z]*)/i);
    const species = { Canine: 'Dog', Feline: 'Cat', Avian: 'Chicken' }[pet.species] || pet.species || '';
    return {
      petId: String(pet.id), petName: pet.petName, petType: species,
      petCategory: pet.animalCategory || (['Dog', 'Cat'].includes(species) ? 'companion' : 'livestock'),
      petRecordKind: pet.recordKind || 'individual', petEstimatedCount: pet.estimatedCount || 1,
      petBreed: pet.breed || '', petAgeValue: age?.[1] || '',
      petAgeUnit: /^m/i.test(age?.[2] || '') ? 'Months' : 'Years',
      petSex: pet.sex || 'Unknown', petVaccDate: pet.lastVaccinationDateRaw || ''
    };
  }

  petsContainer.addEventListener('change', event => {
    if (!event.target.matches('[data-pet-source]')) return;
    const card = event.target.closest('.booking-pet-card');
    const pet = existingPets.find(item => String(item.id) === event.target.value);
    if (pet && petCards().some(other => other !== card && other.dataset.petId === String(pet.id))) {
      event.target.value = card.dataset.petId || '';
      void vbAlert('This animal is already included in this booking.');
      return;
    }
    const priorSpecies = petValue(card, 'petType');
    fillPetCard(card, pet ? savedPetValues(pet) : {});
    if (petValue(card, 'petType') === priorSpecies && card === firstPetCard && assessmentLogId) {
      assessmentAnimal = petValue(card, 'petName');
    } else {
      assessmentLogId = 0;
      assessmentAnimal = '';
      document.getElementById('consultResult').classList.add('is-hidden');
    }
    renumberPetCards();
    toggleVisitMode();
    saveBookingDraft();
  });

  function addPetCard(values = {}) {
    const card = petCardTemplate.cloneNode(true);
    const suffix = nextPetCardId++;
    card.querySelectorAll('[id]').forEach(el => { el.id += `-${suffix}`; });
    card.querySelectorAll('label[for]').forEach(el => { el.htmlFor += `-${suffix}`; });
    card.setAttribute('aria-labelledby', card.querySelector('.booking-pet-title').id);
    petsContainer.appendChild(card);
    fillPetCard(card, values);
    populatePetSources(card);
    const vaccinationDate = petField(card, 'petVaccDate');
    vaccinationDate.min = petField(firstPetCard, 'petVaccDate').min;
    vaccinationDate.max = petField(firstPetCard, 'petVaccDate').max;
    activePetIndex = petCards().length - 1;
    renumberPetCards();
    return card;
  }

  function restorePetCards(values) {
    petCards().slice(1).forEach(card => card.remove());
    fillPetCard(firstPetCard, values[0]);
    values.slice(1).forEach(value => addPetCard(value));
    activePetIndex = 0;
    renumberPetCards();
  }

  function bookingPetsPayload() {
    return petCards().map(card => ({
      ...(card.dataset.petId ? { pet_id: Number(card.dataset.petId) } : {}),
      pet_name: petValue(card, 'petName'),
      pet_type: petValue(card, 'petType'),
      animal_category: petValue(card, 'petCategory'),
      record_kind: petValue(card, 'petRecordKind'),
      estimated_count: petValue(card, 'petRecordKind') === 'group' ? Number(petValue(card, 'petEstimatedCount')) : 1,
      pet_breed: petValue(card, 'petBreed'),
      pet_age: formatPetAge(card),
      pet_sex: petValue(card, 'petSex'),
      pet_vaccination_date: petValue(card, 'petVaccDate')
    }));
  }

  document.getElementById('btnAddPet').addEventListener('click', () => {
    const card = addPetCard();
    saveBookingDraft();
    card.querySelector('[data-pet-source]').focus();
  });
  petsContainer.addEventListener('click', event => {
    const remove = event.target.closest('.btn-remove-pet');
    if (!remove || petCards().length === 1) return;
    assessmentLogId = 0;
    assessmentAnimal = '';
    const card = remove.closest('.booking-pet-card');
    // Keep the original field IDs for older drafts and single-pet callers.
    if (card === firstPetCard) {
      const next = petCards()[1];
      fillPetCard(firstPetCard, petDraftValues(next));
      next.remove();
    } else card.remove();
    renumberPetCards();
    saveBookingDraft();
    document.getElementById('btnAddPet').focus();
  });
  ['input', 'change'].forEach(type => petsContainer.addEventListener(type, event => {
    if (!event.target.matches('[data-pet-field]')) return;
    const card = event.target.closest('.booking-pet-card');
    if (['petType', 'petCategory'].includes(event.target.dataset.petField)) {
      assessmentLogId = 0;
      assessmentAnimal = '';
      document.getElementById('consultResult').classList.add('is-hidden');
    }
    if (event.target.dataset.petField === 'petName' && card === firstPetCard && assessmentLogId) assessmentAnimal = petValue(card, 'petName');
    if (['petType', 'petCategory', 'petRecordKind'].includes(event.target.dataset.petField)) {
      syncAnimalCard(card);
      const categories = new Set(petCards().map(item => petValue(item, 'petCategory')));
      if (categories.size === 1 && categories.has('livestock')) document.getElementById('visitMode').value = 'field';
      if (categories.size === 1 && categories.has('companion')) document.getElementById('visitMode').value = 'clinic';
      toggleVisitMode();
    }
    VBForm.clearGroupError(event.target.closest('.form-group'));
    if (['petName', 'petType', 'petCategory', 'petRecordKind'].includes(event.target.dataset.petField)) renumberPetCards();
    saveBookingDraft();
  }));

  function saveBookingDraft() {
    const fields = {};
    BOOKING_FIELD_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) fields[id] = el.value;
    });
    const slotBtn = document.querySelector('#step3 .slot-btn.selected');
    try {
      sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify({
        vetId: selectedVetId || '',
        step: Math.min(currentStep, 4),
        slot: slotBtn ? slotBtn.dataset.slot : '',
        useAccount: usingAccountDetails(),
        pets: petCards().map(petDraftValues),
        consultation: {
          symptoms: [...document.getElementById('consultSymptoms').selectedOptions].map(option => option.value),
          duration: document.getElementById('consultDuration').value,
          severity: document.getElementById('consultSeverity').value,
          logId: assessmentLogId,
          animal: assessmentAnimal,
          result: document.getElementById('consultResult').classList.contains('is-hidden') ? '' : document.getElementById('consultResult').textContent,
          summary: document.getElementById('chatbotBookingSummary').hidden ? '' : document.getElementById('chatbotBookingSummary').textContent
        },
        fields
      }));
    } catch {
      /* storage unavailable — draft just won't persist */
    }
  }

  function clearBookingDraft() {
    try { sessionStorage.removeItem(BOOKING_DRAFT_KEY); } catch { /* ignore */ }
  }

  function restoreBookingDraft() {
    let draft = null;
    try { draft = JSON.parse(sessionStorage.getItem(BOOKING_DRAFT_KEY) || 'null'); } catch { draft = null; }
    if (!draft || !draft.fields) return;

    BOOKING_FIELD_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el && draft.fields[id] != null) el.value = draft.fields[id];
    });
    if (Array.isArray(draft.pets) && draft.pets.length) restorePetCards(draft.pets);
    if (draft.consultation) {
      const prior = draft.consultation;
      const duration = document.getElementById('consultDuration');
      if ([...duration.options].some(option => option.value === prior.duration)) duration.value = prior.duration;
      const severity = document.getElementById('consultSeverity');
      if ([...severity.options].some(option => option.value === prior.severity)) severity.value = prior.severity;
      assessmentLogId = Number(prior.logId) || 0;
      assessmentAnimal = String(prior.animal || '');
      const result = document.getElementById('consultResult');
      result.textContent = prior.result || '';
      result.classList.toggle('is-hidden', !prior.result);
      const summary = document.getElementById('chatbotBookingSummary');
      summary.textContent = prior.summary || '';
      summary.hidden = !prior.summary;
      consultSymptomsReady.then(() => {
        const selected = new Set(prior.symptoms || []);
        [...document.getElementById('consultSymptoms').options].forEach(option => { option.selected = selected.has(option.value); });
        renderConsultSymptomChoices();
      });
    }
    // A saved visit type may not exist in the static options until the API loads.
    visitTypesReady.then(() => {
      if (!document.getElementById('visitType').value) setRebookField('visitType', draft.fields.visitType);
      toggleDewormingNotice();
      toggleCspMode();
      if (currentStep === 4) populateReview();
    });
    // Put the account switch back where it was: with it on, the account's
    // details win over whatever the draft held; with it off, the contact
    // person the owner typed survives the reload.
    const accountSwitch = document.getElementById('useAccountDetails');
    if (accountSwitch && draft.useAccount === false) {
      accountSwitch.checked = false;
      applyAccountSwitch();
    }
    if (draft.slot) {
      const slotBtn = document.querySelector(`#step3 .slot-btn[data-slot="${draft.slot}"]`);
      if (slotBtn) {
        document.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('selected'));
        slotBtn.classList.add('selected');
      }
    }
    toggleDewormingNotice();
    toggleCspMode();

    // Only jump back into the wizard when the draft actually holds input.
    // Owner fields filled from the account aren't the owner's own input.
    const ownerIds = ['ownerName', 'ownerContact', 'ownerEmail', 'ownerBarangay', 'ownerAddress'];
    const hasContent = draft.slot || Object.entries(draft.fields).some(([id, v]) =>
      !(draft.useAccount !== false && ownerIds.includes(id)) && String(v || '').trim() !== '');
    if (!hasContent) return;

    pendingRestoreVetId = draft.vetId || null;
    showPage(pageBooking);
    goStep(Math.min(Math.max(Number(draft.step) || 1, 1), 4));
  }

  // Re-select the saved vet once the list has rendered (fetchVets is async);
  // then re-check slot availability for the restored vet if we're on step 3.
  document.addEventListener('bv-vets-loaded', () => {
    if (!pendingRestoreVetId) return;
    const item = document.querySelector(`.vet-item[data-vet-id="${pendingRestoreVetId}"]`);
    pendingRestoreVetId = null;
    if (item && !item.classList.contains('active')) item.click();
    if (currentStep === 3 && !isCspMode()) refreshStep3Slots();
  });

  // Autosave as the owner types or picks anything in steps 1-3.
  BOOKING_FIELD_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', saveBookingDraft);
    el.addEventListener('change', saveBookingDraft);
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('.slot-btn') || event.target.closest('.vet-item')) saveBookingDraft();
  });

  /* ── Page navigation wiring ─────────────── */
  document.getElementById('btnBook')           .addEventListener('click', () => {
    // Carry the date already picked in the preview calendar into step 3
    // so the owner isn't asked to choose it again.
    const apptDateInput = document.getElementById('apptDate');
    if (apptDateInput && selectedCalDate) apptDateInput.value = selectedCalDate;
    showPage(pageBooking);
    goStep(1);
  });
  document.getElementById('btnViewAll')
  .addEventListener('click', (e) => {
    e.preventDefault();
    showPage(pageHistory);
    loadAppointmentHistory();
  });
  document.getElementById('btnSeeAllReviews')
  .addEventListener('click', (e) => {
    e.preventDefault();
    openReviewsModal();
  });
  document.getElementById('btnCloseReviews')   .addEventListener('click', closeReviewsModal);
  document.getElementById('reviewsModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'reviewsModalOverlay') closeReviewsModal();
  });
  document.getElementById('btnBackToVet')      .addEventListener('click', (e) => { e.preventDefault(); showPage(pageVet); });
  document.getElementById('btnBackHome')       .addEventListener('click', () => showPage(pageVet));
document.getElementById('btnViewHistory')
  .addEventListener('click', () => {
    showPage(pageHistory);
    loadAppointmentHistory();
  });
document.getElementById('btnHistBack')       .addEventListener('click', () => showPage(pageVet));
  document.getElementById('btnBookFromHistory').addEventListener('click', () => { showPage(pageBooking); goStep(1); });

  /* ── Step navigation wiring ─────────────── */
  document.getElementById('s1Next')   .addEventListener('click', () => { if (validateStep(1)) goStep(2); });
  document.getElementById('s2Back')   .addEventListener('click', () => goStep(1));
  document.getElementById('s2Next')   .addEventListener('click', () => { if (validateStep(2)) goStep(3); });
  document.getElementById('s3Back')   .addEventListener('click', () => goStep(2));
  document.getElementById('s3Next')   .addEventListener('click', () => { if (validateStep(3)) goStep(4); });
  document.getElementById('s4Back')   .addEventListener('click', () => goStep(3));
  document.getElementById('s4Confirm').addEventListener('click', submitAppointment);

  /* ── Per-step inline validation ──────────────
     Marks the missing field(s) instead of blocking
     navigation with a popup/alert.

     The generic helpers now live in shared/js/form-validation.js so the other
     forms in the app can use them too; these thin wrappers keep the call sites
     below unchanged. Only the booking-specific rules (weekend, horizon, slot)
     are still defined here.
  ─────────────────────────────────────────── */
  const setGroupError   = (group, message) => VBForm.setGroupError(group, message);
  const clearGroupError = (group)          => VBForm.clearGroupError(group);

  const validateRequiredField = (id, message) => VBForm.validateRequired(id, message);

  // Several checks can apply to one input. Keep them together so a passing
  // rule can't clear an error raised by another rule on the same field.
  function validateIdentityField(id, { label, requiredMessage = '', minLength = 0, maxLength = 0 } = {}) {
    const el = document.getElementById(id);
    if (!el) return true;
    const value = (el.value || '').trim();
    let error = '';
    if (!value && requiredMessage) error = requiredMessage;
    else if (value && minLength > 0 && value.length < minLength) error = `${label} must be at least ${minLength} characters.`;
    else if (value && maxLength > 0 && value.length > maxLength) error = `${label} must be ${maxLength} characters or fewer.`;
    else if (/[<>]|[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/u.test(value)) error = `${label} cannot contain the characters < or >.`;

    if (error) {
      setGroupError(el.closest('.form-group'), error);
      return false;
    }
    clearGroupError(el.closest('.form-group'));
    return true;
  }

  function validatePhoneField(id) {
    const el = document.getElementById(id);
    if (!el) return true;
    const value = (el.value || '').trim();
    let error = '';
    if (!value) error = 'Please enter your contact number.';
    else if (value.length > 30) error = 'Contact number must be 30 characters or fewer.';
    else if (!VBForm.isValidPHPhone(value)) error = 'Please enter a valid Philippine mobile number, e.g. 09171234567.';
    if (error) {
      setGroupError(el.closest('.form-group'), error);
      return false;
    }
    clearGroupError(el.closest('.form-group'));
    return true;
  }

  function validateEmailField(id) {
    const el = document.getElementById(id);
    if (!el) return true;
    const value = (el.value || '').trim();
    let error = '';
    if (!value) error = 'Please enter your email address.';
    else if (value.length > 190) error = 'Email address must be 190 characters or fewer.';
    else if (!VBForm.isValidEmail(value)) error = 'Please enter a valid email address, e.g. juan@example.com.';
    if (error) {
      setGroupError(el.closest('.form-group'), error);
      return false;
    }
    clearGroupError(el.closest('.form-group'));
    return true;
  }

  function validatePetAge(required = false, card = firstPetCard) {
    const el = petField(card, 'petAgeValue');
    if (!el) return true;
    const raw = (el.value || '').trim();
    if (!raw) {
      if (el.validity.badInput || el.validity.stepMismatch) {
        setGroupError(el.closest('.form-group'), 'Age must be a whole number that is zero or greater.');
        return false;
      }
      if (required) return validateRequiredField(el.id, "Please enter your pet's age for Castration & Spay.");
      clearGroupError(el.closest('.form-group'));
      return true;
    }

    const age = Number(raw);
    if (!Number.isFinite(age) || !Number.isInteger(age) || age < 0) {
      setGroupError(el.closest('.form-group'), 'Age must be a whole number that is zero or greater.');
      return false;
    }
    clearGroupError(el.closest('.form-group'));
    return true;
  }

  function validateVaccinationDate(card = firstPetCard) {
    const el = petField(card, 'petVaccDate');
    if (!el) return true;
    if (el.validity.badInput) {
      setGroupError(el.closest('.form-group'), 'Please enter a valid vaccination date.');
      return false;
    }
    if (!el.value) {
      if (el) clearGroupError(el.closest('.form-group'));
      return true;
    }

    const match = el.value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      setGroupError(el.closest('.form-group'), 'Please enter a valid vaccination date.');
      return false;
    }
    const [, year, month, day] = match;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    const isRealDate = parsed.getFullYear() === Number(year)
      && parsed.getMonth() === Number(month) - 1
      && parsed.getDate() === Number(day);
    if (!isRealDate) {
      setGroupError(el.closest('.form-group'), 'Please enter a valid vaccination date.');
      return false;
    }
    if (el.min && el.value < el.min) {
      setGroupError(el.closest('.form-group'), 'Vaccination date is too far in the past.');
      return false;
    }
    if (el.max && el.value > el.max) {
      setGroupError(el.closest('.form-group'), 'Vaccination date can be at most one year ahead.');
      return false;
    }
    clearGroupError(el.closest('.form-group'));
    return true;
  }

  function validateApptDateWeekend() {
    const el = document.getElementById('apptDate');
    if (!el || !el.value) return true;
    const group = el.closest('.form-group');
    if (isWeekendIso(el.value)) {
      setGroupError(group, 'Weekends are not available — please choose a weekday.');
      return false;
    }
    if (CLOSED_DATES[el.value]) {
      setGroupError(group, `The clinic is closed that day (${CLOSED_DATES[el.value]}) — please choose another date.`);
      return false;
    }
    clearGroupError(group);
    return true;
  }

  function validateApptDateHorizon() {
    const el = document.getElementById('apptDate');
    if (!el || !el.value) return true;
    const group = el.closest('.form-group');
    const [y, m, d] = el.value.split('-').map(Number);
    const picked = new Date(y, m - 1, d);
    picked.setHours(0, 0, 0, 0);
    if (picked > bookingHorizonDate()) {
      setGroupError(group, `Appointments can only be booked up to ${BOOKING_HORIZON_MONTHS} months ahead.`);
      return false;
    }
    clearGroupError(group);
    return true;
  }

  function validateTimeSlotField() {
    const slotGrid = document.querySelector('#step3 .slot-grid');
    const group = slotGrid ? slotGrid.closest('.form-group') : null;
    const selected = document.querySelector('#step3 .slot-btn.selected');
    const date = document.getElementById('apptDate')?.value || '';
    if (!selected) {
      setGroupError(group, 'Please select a time slot.');
      return false;
    }
    if (selected.classList.contains('unavailable') || isSlotPast(date, selected.dataset.slot)) {
      setGroupError(group, 'That time slot is no longer available. Please choose another.');
      return false;
    }
    clearGroupError(group);
    return true;
  }

  function validateStep(n) {
    let valid = true;

    // The account fields are read-only when this is on, but the email is
    // still used for appointment notifications. Validate the account values
    // so an incomplete/legacy profile gets a useful field error before submit.
    if (n === 1 && usingAccountDetails()) {
      if (!validateIdentityField('ownerName', { label: 'Full name', requiredMessage: 'Please enter your full name.', minLength: 2, maxLength: 150 })) valid = false;
      if (!validatePhoneField('ownerContact')) valid = false;
      if (!validateEmailField('ownerEmail')) valid = false;
      if (!validateRequiredField('ownerBarangay', 'Please select your barangay.')) valid = false;
      if (!validateIdentityField('ownerAddress', { label: 'Address', requiredMessage: 'Please enter your complete address.', maxLength: 255 })) valid = false;
      if (!valid) VBForm.focusFirstError('#step1');
      return valid;
    }

    // Switch off: name, number and email are the contact person for this
    // appointment. Barangay and address stay the account's and remain required.
    if (n === 1 && !usingAccountDetails() && accountDetails) {
      if (!validateIdentityField('ownerName', { label: 'Contact name', requiredMessage: 'Please enter the name of the person bringing the pet.', minLength: 2, maxLength: 150 })) valid = false;
      if (!validatePhoneField('ownerContact')) valid = false;
      if (!validateEmailField('ownerEmail')) valid = false;
      if (!validateRequiredField('ownerBarangay', 'Please select your barangay.')) valid = false;
      if (!validateIdentityField('ownerAddress', { label: 'Address', requiredMessage: 'Please enter your complete address.', maxLength: 255 })) valid = false;
      if (!valid) VBForm.focusFirstError('#step1');
      return valid;
    }

    if (n === 1) {
      if (!validateIdentityField('ownerName', { label: 'Full name', requiredMessage: 'Please enter your full name.', minLength: 2, maxLength: 150 })) valid = false;
      // Format, not just presence. These two used to be checked for emptiness
      // only, on both the client AND the server, so "asdf" and "abcdefg" booked
      // successfully -- and the email is what the clinic's confirmation mail is
      // sent to. Same rules as signup (api/auth/register.php), because a guest
      // booking creates a real account in the same users columns.
      if (!validatePhoneField('ownerContact')) valid = false;
      if (!validateEmailField('ownerEmail')) valid = false;
      if (!validateRequiredField('ownerBarangay', 'Please select your barangay.'))         valid = false;
      if (!validateIdentityField('ownerAddress', { label: 'Address', requiredMessage: 'Please enter your complete address.', maxLength: 255 })) valid = false;
    } else if (n === 2) {
      const names = new Set();
      petCards().forEach(card => {
        const id = field => petField(card, field).id;
        if (!validateIdentityField(id('petName'), { label: 'Name or identifier', requiredMessage: 'Please enter a name or identifier.', maxLength: 120 })) valid = false;
        if (!validateRequiredField(id('petType'), 'Please select a pet type.')) valid = false;
        if (!petValue(card, 'petCategory')) { setGroupError(petField(card, 'petCategory').closest('.form-group'), 'Select an animal category.'); valid = false; }
        if (petValue(card, 'petBreed') && !validateIdentityField(id('petBreed'), { label: 'Breed', maxLength: 80 })) valid = false;
        if (petValue(card, 'petRecordKind') === 'group' && !(Number.isInteger(Number(petValue(card, 'petEstimatedCount'))) && Number(petValue(card, 'petEstimatedCount')) >= 1 && Number(petValue(card, 'petEstimatedCount')) <= 100000)) {
          setGroupError(petField(card, 'petEstimatedCount').closest('.form-group'), 'Enter a valid owner estimate.'); valid = false;
        }
        if (!validatePetAge(isCspMode(), card)) valid = false;
        if (!validateVaccinationDate(card)) valid = false;
        const name = card.dataset.petId ? `id:${card.dataset.petId}` : `name:${petValue(card, 'petName').toLocaleLowerCase()}`;
        if (name && names.has(name)) {
          setGroupError(petField(card, 'petName').closest('.form-group'), 'This pet is already included. Add each pet only once.');
          valid = false;
        }
        names.add(name);
      });
    } else if (n === 3) {
      if (!validateRequiredField('visitType', 'Please select the type of visit.')) valid = false;
      if (isCspMode() && petCards().some(card => !['Dog', 'Cat'].includes(petValue(card, 'petType')) || petValue(card, 'petRecordKind') !== 'individual')) {
        setGroupError(document.getElementById('visitType').closest('.form-group'), 'Castration & Spay registration is for individual dogs and cats.'); valid = false;
      }
      if (petCards().some(card => petValue(card, 'petCategory') !== (document.getElementById('visitMode').value === 'field' ? 'livestock' : 'companion'))) {
        setGroupError(document.getElementById('visitMode').closest('.form-group'), 'Book companion animals at the clinic and livestock as a separate field visit.'); valid = false;
      }
      if (document.getElementById('visitMode').value === 'field') {
        if (!validateRequiredField('fieldAddress', 'Enter the field location.')) valid = false;
        if (!validateRequiredField('fieldConcern', 'Describe the concern.')) valid = false;
      }
      // The program screens pets by age, so it is required here -- but the
      // field lives on step 2, so send the owner back to it.
      if (isCspMode() && !petCards().map(card => validatePetAge(true, card)).every(Boolean)) {
        valid = false;
        goStep(2);
        VBForm.focusFirstError('#step2');
        return false;
      }
      if (!isCspMode()) {
        if (!validateRequiredField('apptDate', 'Please select a preferred date.')) valid = false;
        else if (!validateApptDateWeekend())                                      valid = false;
        else if (!validateApptDateHorizon())                                      valid = false;
        if (!validateTimeSlotField())                                             valid = false;
        // apptNotes is optional — not validated
      }
    }

    if (!valid) {
      const firstError = document.querySelector('#step' + n + ' .has-error');
      if (n === 2 && firstError) showPetCard(petCards().indexOf(firstError.closest('.booking-pet-card')));
      if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return valid;
  }

  // Clear a field's error as soon as the user fixes it
  document.querySelectorAll('#step1 .form-input, #step1 .form-select, #step2 .form-input, #step2 .form-select, #step3 .form-input, #step3 .form-select, #step3 .form-textarea')
    .forEach(el => {
      const clear = () => clearGroupError(el.closest('.form-group'));
      el.addEventListener('input', clear);
      el.addEventListener('change', clear);
    });

  /* ── Core step switcher ──────────────────── */
  function goStep(n) {
    currentStep = n;
    for (let i = 1; i <= 5; i++) {
      const el = document.getElementById('step' + i);
      if (el) el.style.display = (i === n) ? 'block' : 'none';
    }
    updateStepper(n);
    if (n === 3) { toggleCspMode(); if (!isCspMode()) refreshStep3Slots(); }
    if (n === 3) populateConsultAnimals();
    if (n === 4) populateReview();
    // Booking done → the draft has served its purpose; otherwise remember
    // where the owner is so a reload/back returns them to this step.
    if (n === 5) clearBookingDraft(); else saveBookingDraft();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── Keep step-3 time slots in sync with real availability ──
     The slot buttons here are static markup, so without this
     an already-confirmed slot (for this vet + date) stayed
     clickable and a second owner could submit the same slot.
     Reuses the same booked_slots lookup the vet-selection
     calendar already relies on.
  ─────────────────────────────────────────── */
  async function refreshStep3Slots() {
    const dateVal = document.getElementById('apptDate')?.value || '';
    const slotButtons = document.querySelectorAll('#step3 .slot-btn');
    if (!dateVal) {
      slotButtons.forEach(btn => btn.classList.remove('unavailable'));
      return;
    }

    let booked = [];
    let requested = [];
    try {
      const res = await fetch('/api/appointments/appointment.php', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          action          : 'booked_slots',
          veterinarian_id : selectedVetId,
          preferred_date  : dateVal
        })
      });
      const json = await res.json();
      booked = json.success ? (json.booked || []) : [];
      requested = json.success ? (json.requested || []) : [];
    } catch (err) {
      console.error('[step3 slots] fetch failed:', err);
      return;
    }

    const bookedSet = new Set(booked.map(canonicalSlot));
    const requestedSet = new Set(requested.map(canonicalSlot));
    slotButtons.forEach(btn => {
      const slot = btn.dataset.slot;
      const isUnavailable = bookedSet.has(canonicalSlot(slot)) || isSlotPast(dateVal, slot);
      btn.classList.toggle('unavailable', isUnavailable);
      btn.classList.toggle('requested', !isUnavailable && requestedSet.has(canonicalSlot(slot)));
      btn.title = !isUnavailable && requestedSet.has(canonicalSlot(slot)) ? 'Requested' : '';
      if (isUnavailable && btn.classList.contains('selected')) {
        btn.classList.remove('selected');
      }
    });

    // Carry over the time already picked in the preview calendar —
    // only when the date wasn't changed since, and nothing else is
    // selected yet, so the owner doesn't have to repeat the pick.
    if (selectedPreviewSlot && dateVal === selectedCalDate && !document.querySelector('#step3 .slot-btn.selected')) {
      const match = document.querySelector(`#step3 .slot-btn[data-slot="${selectedPreviewSlot}"]`);
      if (match && !match.classList.contains('unavailable')) {
        match.classList.add('selected');
      }
    }
  }

  document.getElementById('apptDate')?.addEventListener('change', () => {
    validateApptDateWeekend();
    refreshStep3Slots();
  });

  /* ── Populate "Type of Visit" from the vet/admin-managed visit_types
     table so new types added in Appointment Management show up here
     without editing this page. ── */
  async function populateVisitTypes() {
    const select = document.getElementById('visitType');
    if (!select) return;
    try {
      const result = await api.getVisitTypes();
      if (!result.success || !Array.isArray(result.data) || !result.data.length) return;
      const current = select.value;
      const names = result.data.map((type) => type.name);
      select.innerHTML = '<option value="">Select type of visit</option>'
        + names.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join('');
      select.value = names.includes(current) ? current : '';
      toggleDewormingNotice();
      toggleCspMode();
    } catch (err) {
      // Keep the static fallback options already in the markup
    }
  }
  const visitTypesReady = populateVisitTypes();

  /* ── Show the age-limit notice only for Deworming visits ── */
  function toggleDewormingNotice() {
    const visitType = document.getElementById('visitType')?.value || '';
    document.getElementById('dewormingNotice')?.classList.toggle('is-hidden', visitType !== 'Deworming');
  }
  document.getElementById('visitType')?.addEventListener('change', toggleDewormingNotice);
  toggleDewormingNotice();

  /* ── Castration & Spay is a waiting-list registration, not a scheduled
     visit — swap the date/time-slot step for a static notice and make
     "Additional Details" optional whenever it's selected. ── */
  /* ── "Use my account details" switch (step 1) ─────────────
     On by default: the fields are filled from the owner's account and
     locked, so nobody retypes them -- the server takes the owner from the
     login anyway. Off means someone else is bringing the pet: name, number
     and email become editable and are saved as this appointment's contact.
     Barangay and address always stay the account's (they are the pet's
     home, which the disease reports count). */
  let accountDetails = null;

  function usingAccountDetails() {
    return document.getElementById('useAccountDetails')?.checked !== false;
  }

  function setOwnerField(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'SELECT' && value && ![...el.options].some(o => o.value === value || o.textContent === value)) {
      el.add(new Option(value, value));
    }
    el.value = value || '';
    VBForm.clearGroupError(el.closest('.form-group'));
  }

  function applyAccountSwitch() {
    const on = usingAccountDetails();
    const a = accountDetails || {};
    if (on) {
      setOwnerField('ownerName', a.name);
      setOwnerField('ownerContact', a.phone);
      setOwnerField('ownerEmail', a.email);
    }
    // Always the account's.
    if (accountDetails) {
      setOwnerField('ownerBarangay', a.barangay);
      setOwnerField('ownerAddress', a.address);
    }

    ['ownerName', 'ownerContact', 'ownerEmail'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.readOnly = on;
    });
    const barangay = document.getElementById('ownerBarangay');
    if (barangay) barangay.disabled = Boolean(accountDetails);
    const address = document.getElementById('ownerAddress');
    if (address) address.readOnly = Boolean(accountDetails);
    document.getElementById('step1')?.classList.toggle('uses-account', on);
    if (currentStep === 4) populateReview();
  }

  async function loadAccountDetails() {
    const session = window.VBetterAuth?.getSession?.() || {};
    const hasAccount = Boolean(session.userId || session.id || localStorage.getItem('bvetter_token'));
    if (!hasAccount) {
      const accountSwitch = document.getElementById('useAccountDetails');
      accountSwitch.checked = false;
      accountSwitch.closest('.account-switch').hidden = true;
      accountDetails = null;
      applyAccountSwitch();
      return;
    }
    accountDetails = { name: session.name || '', phone: session.phone || '', email: session.email || '', barangay: '', address: '' };
    applyAccountSwitch();
    try {
      const result = await api.getProfile();
      if (result?.success && result.data) {
        accountDetails = {
          name: result.data.fullName || accountDetails.name,
          phone: result.data.phone || accountDetails.phone,
          email: result.data.email || accountDetails.email,
          barangay: result.data.barangay || '',
          address: result.data.address || ''
        };
        applyAccountSwitch();
      }
    } catch {
      // Session values are already in place.
    }
  }

  document.getElementById('useAccountDetails')?.addEventListener('change', applyAccountSwitch);
  const accountDetailsReady = loadAccountDetails();

  function isCspMode() {
    return (document.getElementById('visitType')?.value || '') === 'Castration & Spay';
  }

  function toggleCspMode() {
    const cspMode = isCspMode();
    if (document.getElementById('visitType').value !== 'Consultation') {
      assessmentLogId = 0;
      assessmentAnimal = '';
      document.getElementById('consultResult').classList.add('is-hidden');
    }
    document.getElementById('apptDateGroup')?.classList.toggle('is-hidden', cspMode);
    document.getElementById('apptTimeGroup')?.classList.toggle('is-hidden', cspMode);
    document.getElementById('cspProgramNotice')?.classList.toggle('is-hidden', !cspMode);
    toggleVisitMode();
  }
  function toggleVisitMode() {
    const categories = new Set(petCards().map(card => petValue(card, 'petCategory')));
    if (categories.size === 1 && categories.has('livestock')) document.getElementById('visitMode').value = 'field';
    else if (categories.size === 1 && categories.has('companion')) document.getElementById('visitMode').value = 'clinic';
    const field = document.getElementById('visitMode').value === 'field';
    document.getElementById('visitModeSummary').classList.toggle('is-field', field);
    document.getElementById('visitModeTitle').textContent = field ? 'Field visit for livestock' : 'At the clinic';
    document.getElementById('visitModeDescription').textContent = field
      ? 'A veterinarian visits your location after approval. The clinic may reserve the time or the whole day.'
      : 'Bring your companion animal to the clinic at the approved time.';
    document.getElementById('fieldVisitFields').classList.toggle('is-hidden', !field || isCspMode());
    document.getElementById('bookingConsultation').classList.toggle('is-hidden', isCspMode() || document.getElementById('visitType').value !== 'Consultation');
    updateConsultSuggestions();
  }
  document.getElementById('visitMode').addEventListener('change', toggleVisitMode);
  document.getElementById('visitType')?.addEventListener('change', toggleCspMode);
  toggleCspMode();

  function populateConsultAnimals() {
    const select = document.getElementById('consultAnimal');
    const previous = select.value;
    select.replaceChildren();
    petCards().forEach((card, index) => {
      const option = document.createElement('option');
      option.value = petValue(card, 'petName');
      option.textContent = `${petValue(card, 'petName') || `Animal ${index + 1}`} (${petValue(card, 'petType') || 'species pending'})`;
      select.appendChild(option);
    });
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
    const single = select.options.length === 1;
    document.getElementById('consultAnimalPicker').hidden = single;
    const singleAnimal = document.getElementById('consultAnimalSingle');
    singleAnimal.hidden = !single;
    singleAnimal.textContent = single ? `Checking ${select.selectedOptions[0].textContent}` : '';
  }
  async function loadConsultSymptoms() {
    try {
      const response = await fetch('/api/chatbot/chatbot.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'public_symptoms' }) });
      const result = await response.json();
      if (!result.success) throw new Error('Symptom list unavailable.');
      consultSymptomsLoaded = true;
      consultSymptomCatalog = result.data || [];
      const select = document.getElementById('consultSymptoms');
      select.replaceChildren();
      consultSymptomCatalog.forEach(symptom => {
        const option = document.createElement('option');
        option.value = symptom.name;
        option.textContent = symptom.name;
        select.appendChild(option);
      });
      updateConsultSuggestions();
    } catch {
      consultSymptomsUnavailable = true;
      document.getElementById('consultSymptomChoices').textContent = 'Symptom check is unavailable right now. You can still book your appointment.';
    }
  }

  function renderConsultSymptomChoices(suggested = new Set()) {
    const host = document.getElementById('consultSymptomChoices');
    const options = [...document.getElementById('consultSymptoms').options];
    host.replaceChildren();
    if (!options.length) {
      host.textContent = consultSymptomsUnavailable
        ? 'Symptom check is unavailable right now. You can still book your appointment.'
        : consultSymptomsLoaded ? 'No symptoms are available for this check.' : 'Loading symptoms…';
      return;
    }
    options.sort((a, b) => Number(suggested.has(b.value)) - Number(suggested.has(a.value)));
    options.forEach(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'consult-symptom-choice';
      button.dataset.symptom = option.value;
      button.setAttribute('aria-pressed', String(option.selected));
      const name = document.createElement('span');
      name.textContent = option.textContent;
      button.appendChild(name);
      if (suggested.has(option.value)) {
        button.classList.add('is-suggested');
        const badge = document.createElement('small');
        badge.textContent = 'Suggested';
        button.appendChild(badge);
      }
      host.appendChild(button);
    });
  }

  function updateConsultSuggestions() {
    const host = document.getElementById('consultSymptomSuggestions');
    if (!host) return;
    const livestockConsultation = document.getElementById('visitMode').value === 'field'
      && document.getElementById('visitType').value === 'Consultation';
    const observation = document.getElementById('fieldConcern').value;
    const normalize = value => String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const text = ` ${normalize(observation)} `;
    const matches = livestockConsultation && observation.trim()
      ? consultSymptomCatalog.filter(symptom => [symptom.name, ...(symptom.aliases || [])]
          .some(phrase => phrase && text.includes(` ${normalize(phrase)} `)))
      : [];
    host.hidden = !matches.length;
    host.textContent = matches.length
      ? 'Based on what you noticed, the highlighted symptoms may apply. Tap only the ones you have observed.'
      : '';
    renderConsultSymptomChoices(new Set(matches.map(symptom => symptom.name)));
  }
  document.getElementById('fieldConcern').addEventListener('input', () => {
    assessmentLogId = 0;
    assessmentAnimal = '';
    document.getElementById('consultResult').classList.add('is-hidden');
    updateConsultSuggestions();
    saveBookingDraft();
  });
  document.getElementById('consultSymptomChoices').addEventListener('click', event => {
    const button = event.target.closest('[data-symptom]');
    if (!button) return;
    const option = [...document.getElementById('consultSymptoms').options].find(item => item.value === button.dataset.symptom);
    if (!option) return;
    option.selected = !option.selected;
    assessmentLogId = 0;
    assessmentAnimal = '';
    document.getElementById('consultResult').classList.add('is-hidden');
    updateConsultSuggestions();
    saveBookingDraft();
  });
  const consultSymptomsReady = loadConsultSymptoms();
  document.getElementById('btnAssessSymptoms').addEventListener('click', async () => {
    const selected = document.getElementById('consultAnimal');
    const card = petCards().find(item => petValue(item, 'petName') === selected.value);
    const symptoms = [...document.getElementById('consultSymptoms').selectedOptions].map(option => option.value);
    const resultBox = document.getElementById('consultResult');
    resultBox.classList.remove('is-hidden');
    assessmentLogId = 0;
    assessmentAnimal = '';
    if (!card || !symptoms.length) { resultBox.textContent = 'Choose at least one symptom to see clinic guidance.'; return; }
    resultBox.textContent = 'Checking clinic guidance…';
    try {
      const response = await fetch('/api/chatbot/chatbot.php', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assess_consultation', clinic_approved_only: true,
          petType: petValue(card, 'petType'), animalCategory: petValue(card, 'petCategory'), symptoms,
          duration: document.getElementById('consultDuration').value,
          severity: document.getElementById('consultSeverity').value })
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.message || 'Guidance unavailable.');
      assessmentLogId = Number(result.data.logId) || 0;
      assessmentAnimal = selected.value;
      resultBox.textContent = `${result.data.condition}: ${result.data.recommendation} This is preliminary guidance, not a diagnosis. Booking remains available.`;
      saveBookingDraft();
    } catch (error) { resultBox.textContent = `${error.message} You may continue booking or contact the clinic.`; }
  });
  ['consultAnimal', 'consultSymptoms', 'consultDuration', 'consultSeverity'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      assessmentLogId = 0;
      assessmentAnimal = '';
      document.getElementById('consultResult').classList.add('is-hidden');
      saveBookingDraft();
    });
  });

  /* ── Combine the Age value + unit fields into one string
     (e.g. "2 Years") the same way patient records stores it,
     so history/detail views don't need their own unit suffix. ── */
  function formatPetAge(card = firstPetCard) {
    const value = petValue(card, 'petAgeValue');
    const unit = petValue(card, 'petAgeUnit') || 'Years';
    return value ? `${value} ${unit}` : '';
  }

  /* ── Loading/success window shown while the booking request (and its
     confirmation email) is processing, instead of just swapping the
     Confirm button's label. Self-contained (styles injected once) so it
     renders the same regardless of what CSS this page happens to load. ── */
  function ensureBookingOverlay() {
    let overlay = document.getElementById('vbBookingOverlay');
    if (overlay) return overlay;

    const style = document.createElement('style');
    style.textContent = `
      #vbBookingOverlay { position:fixed; inset:0; z-index:9999; display:none;
        align-items:center; justify-content:center; background:rgba(15,23,42,0.55); }
      #vbBookingOverlay .vb-box { background:#fff; border-radius:16px; padding:32px 40px;
        text-align:center; min-width:260px; max-width:90vw; box-shadow:0 20px 60px rgba(0,0,0,0.25); }
      #vbBookingOverlay .vb-spinner { width:44px; height:44px; margin:0 auto 16px;
        border:4px solid #dbe4f0; border-top-color:#00B928; border-radius:50%;
        animation:vb-spin 0.8s linear infinite; }
      #vbBookingOverlay .vb-check { width:44px; height:44px; margin:0 auto 16px;
        border-radius:50%; background:#00B928; color:#fff; display:flex; align-items:center;
        justify-content:center; font-size:24px; animation:vb-pop 0.25s ease; }
      #vbBookingOverlay .vb-msg { color:#1f2937; font-size:15px; font-weight:600; font-family:inherit; }
      @keyframes vb-spin { to { transform:rotate(360deg); } }
      @keyframes vb-pop { from { transform:scale(0.5); opacity:0; } to { transform:scale(1); opacity:1; } }
    `;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.id = 'vbBookingOverlay';
    overlay.innerHTML = '<div class="vb-box"><div class="vb-icon"></div><div class="vb-msg"></div></div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function showBookingLoading(message) {
    const overlay = ensureBookingOverlay();
    overlay.querySelector('.vb-icon').innerHTML = '<div class="vb-spinner"></div>';
    overlay.querySelector('.vb-msg').textContent = message;
    overlay.style.display = 'flex';
  }

  function showBookingSuccess(message) {
    const overlay = ensureBookingOverlay();
    overlay.querySelector('.vb-icon').innerHTML = '<div class="vb-check">&#10003;</div>';
    overlay.querySelector('.vb-msg').textContent = message;
  }

  function hideBookingOverlay() {
    const overlay = document.getElementById('vbBookingOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  /* ── Submit appointment ──────────────────────
     Guards against double-submits: without this, clicking Confirm
     several times before the request resolves fired one booking per
     click (all landing on the same slot on the vet/admin side). ── */
  let isBookingSubmit = false;

  async function submitAppointment() {
    if (isBookingSubmit) return;

    // Re-check every step before submitting. The per-step checks only run on
    // the Next buttons, so a restored draft (which jumps straight back to the
    // review step) could otherwise reach Confirm without ever being validated.
    for (const step of [1, 2, 3]) {
      if (!validateStep(step)) {
        goStep(step);
        return;
      }
    }

    isBookingSubmit = true;

    const confirmBtn = document.getElementById('s4Confirm');
    if (confirmBtn) confirmBtn.disabled = true;
    showBookingLoading('Submitting your appointment…');

    try {
      await submitAppointmentRequest();
    } finally {
      isBookingSubmit = false;
      if (confirmBtn) confirmBtn.disabled = false;
    }
  }

  async function submitAppointmentRequest() {
const selectedSlot = document.querySelector('.slot-btn.selected');
    const session = JSON.parse(
      localStorage.getItem('vbetter_session') ||
      localStorage.getItem('bvetter_user')    ||
      'null'
    );

    const payload = {
      action:               'create',
      owner_id:             session?.userId || session?.id || '',
      use_account_details:  usingAccountDetails() ? '1' : '0',
      veterinarian_id:      selectedVetId || '',           // ← vet selected on page 1
      owner_name:           document.getElementById('ownerName')?.value.trim()    || '',
      owner_contact:        document.getElementById('ownerContact')?.value.trim() || '',
      owner_email:          document.getElementById('ownerEmail')?.value.trim()   || '',
      owner_barangay_id:    document.getElementById('ownerBarangay')?.value       || '',
      owner_address:        document.getElementById('ownerAddress')?.value.trim() || '',
      pet_name:             document.getElementById('petName')?.value.trim()      || '',
      pet_type:             document.getElementById('petType')?.value             || '',
      pet_breed:            document.getElementById('petBreed')?.value.trim()     || '',
      pet_age:              formatPetAge(),
      pet_sex:              document.getElementById('petSex')?.value              || '',
      pet_vaccination_date: document.getElementById('petVaccDate')?.value         || '',
      pets:                 bookingPetsPayload(),
      visit_mode:           document.getElementById('visitMode').value,
      field_address:        document.getElementById('fieldAddress').value.trim(),
      field_concern:        document.getElementById('fieldConcern').value.trim(),
      owner_assessment_log_id: assessmentLogId,
      owner_assessment_animal: assessmentAnimal,
      appointment_type:     document.getElementById('visitType')?.value           || '',
      preferred_date:       document.getElementById('apptDate')?.value            || '',
time_slot: selectedSlot ? selectedSlot.dataset.slot : '',
      notes:                document.getElementById('apptNotes')?.value.trim()    || ''
    };

    if (isCspMode()) {
      const required = [
        'owner_name', 'owner_contact', 'owner_email', 'owner_barangay_id', 'owner_address',
        'pet_name', 'pet_type', 'pet_age'
      ];
      if (required.some(k => !payload[k])) {
        hideBookingOverlay();
        await vbAlert('Please complete all required fields.');
        return;
      }
      try {
        const result = await api.registerCspProgram(payload);
        if (!result.success) {
          hideBookingOverlay();
          await vbAlert(result.message || 'Failed to submit registration.');
          return;
        }
        showBookingSuccess('Registration submitted successfully!');
        await new Promise((resolve) => setTimeout(resolve, 400));
        hideBookingOverlay();
        showCspSuccess(result.waiting_count);
        goStep(5);
      } catch (error) {
        hideBookingOverlay();
        await vbAlert('Failed to submit registration. Please try again.');
      }
      return;
    }

    const required = [
      'owner_name','owner_contact','owner_email',
      'pet_name','pet_type','appointment_type',
      'preferred_date','time_slot'
    ];
    if (required.some(k => !payload[k])) {
      hideBookingOverlay();
      await vbAlert('Please complete all required appointment fields.');
      return;
    }

    const todayIso = toLocalIsoDate();
    if (payload.preferred_date < todayIso) {
      hideBookingOverlay();
      await vbAlert('Please select a date that has not yet passed.');
      return;
    }

    try {
      const result = await api.bookAppointment(payload);
      if (!result.success) {
        hideBookingOverlay();
        await vbAlert(result.message || 'Failed to book appointment.');
        return;
      }
      showBookingSuccess('Request sent! We’ve sent a confirmation to your email.');
      await new Promise((resolve) => setTimeout(resolve, 400));
      hideBookingOverlay();
      showDefaultSuccess(result.appointment_id, payload.pets.length);
      goStep(5);
    } catch (error) {
      hideBookingOverlay();
      await vbAlert('Failed to book appointment. Please try again.');
    }
  }

  /* ── Toggle step-5 success card between the normal appointment
     confirmation and the Castration & Spay waiting-list confirmation ── */
  function showDefaultSuccess(appointmentId, petCount) {
    document.getElementById('step5Default')?.classList.remove('is-hidden');
    document.getElementById('step5Csp')?.classList.add('is-hidden');
    document.getElementById('rv-refNo').textContent = `#BB-${appointmentId}`;
    document.querySelector('#step5Default .success-desc').textContent =
      `Your appointment request for ${petCount} ${petCount === 1 ? 'pet' : 'pets'} has been submitted and is pending clinic approval. You'll be notified once confirmed. Unconfirmed requests expire after 1 working day.`;
  }

  function showCspSuccess(waitingCount) {
    document.getElementById('step5Default')?.classList.add('is-hidden');
    document.getElementById('step5Csp')?.classList.remove('is-hidden');
    const countEl = document.getElementById('csp-waiting-count');
    if (countEl) countEl.textContent = `${waitingCount ?? '—'} Pets Registered`;
    document.getElementById('cspSuccessDescription').textContent = petCards().length === 1
      ? 'Your pet has been added to the waiting list for the Municipal Castration & Spay Program.'
      : `Your ${petCards().length} pets have been added to the waiting list for the Municipal Castration & Spay Program.`;
  }

  /* ── Header stepper update ───────────────── */
  function updateStepper(active) {
    const eyebrow = document.getElementById('bookingEyebrow');
    if (eyebrow) eyebrow.textContent = 'Step ' + Math.min(active, 4) + ' of 4';

    for (let i = 1; i <= 4; i++) {
      const dot   = document.getElementById('sc' + i);
      const label = document.getElementById('sl' + i);
      const bar   = i < 4 ? document.getElementById('line' + i) : null;
      if (!dot) continue;

      const isDone   = (active === 5 || i < active);
      const isActive = (i === active);

      dot.className   = 'hstep-dot '   + (isDone ? 'done' : isActive ? 'active' : 'todo');
      dot.textContent = isDone ? '\u2713' : i;
      if (label) label.className = 'hstep-label ' + (isDone ? 'done' : isActive ? 'active' : '');
      if (bar)   bar.className   = 'hstep-bar '   + (isDone ? 'done' : '');
    }
  }

  /* ── Slot button selection ───────────────── */
  document.querySelectorAll('.slot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('unavailable')) return;
      document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      clearGroupError(btn.closest('.form-group'));
    });
  });

  /* ── Calendar time slots ─────────────────── */
  // Slots are built dynamically by buildTimeSlots() below.
  // The old querySelectorAll listener is removed — listeners are
  // attached inside buildTimeSlots() on each generated element.

  /* ── History filter pills ────────────────── */
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
    });
  });

  /* ── Populate review step from form inputs ── */
  function populateReview() {
    const val     = id => (document.getElementById(id)?.value.trim() || '—');
    const selText = id => {
      const el = document.getElementById(id);
      return el?.options[el.selectedIndex]?.text || '—';
    };

    document.getElementById('rv-name')     .textContent = val('ownerName');
    document.getElementById('rv-contact')  .textContent = val('ownerContact');
    document.getElementById('rv-barangay') .textContent = selText('ownerBarangay');
    document.getElementById('reviewPets').innerHTML = bookingPetsPayload().map((pet, index) => `
      <div class="review-block">
        <h3 class="review-pet-title">${pet.animal_category === 'livestock' ? (pet.record_kind === 'group' ? 'Herd/Flock' : 'Livestock') : 'Pet'} ${index + 1}</h3>
        <div class="review-row"><span class="review-key">${pet.animal_category === 'livestock' ? (pet.record_kind === 'group' ? 'Herd/Flock Name' : 'Name or Identifier') : 'Pet Name'}:</span><span class="review-val"${index === 0 ? ' id="rv-petname"' : ''}>${escapeHtml(pet.pet_name)}</span></div>
        <div class="review-row"><span class="review-key">${pet.animal_category === 'livestock' ? 'Species' : 'Pet Type'}:</span><span class="review-val"${index === 0 ? ' id="rv-pettype"' : ''}>${escapeHtml(pet.pet_type)}</span></div>
        <div class="review-row"><span class="review-key">Animal Category:</span><span class="review-val">${escapeHtml(pet.animal_category)}</span></div>
        <div class="review-row"><span class="review-key">Record Type:</span><span class="review-val">${pet.record_kind === 'group' ? `Herd / flock · owner estimates ${pet.estimated_count}` : 'Individual'}</span></div>
        <div class="review-row"><span class="review-key">Breed:</span><span class="review-val">${escapeHtml(pet.pet_breed || 'Not provided')}</span></div>
        <div class="review-row"><span class="review-key">Age / Sex:</span><span class="review-val"${index === 0 ? ' id="rv-ageSex"' : ''}>${escapeHtml(pet.pet_age || '—')} / ${escapeHtml(pet.pet_sex)}</span></div>
        <div class="review-row"><span class="review-key">Vaccination Date:</span><span class="review-val">${escapeHtml(pet.pet_vaccination_date || '—')}</span></div>
      </div>`).join('');
    document.getElementById('rv-visitType').textContent = selText('visitType');
    document.getElementById('rv-visitMode').textContent = selText('visitMode');
    document.getElementById('rv-fieldAddress').textContent = document.getElementById('visitMode').value === 'field' ? val('fieldAddress') : '—';
    document.getElementById('rv-assessment').textContent = assessmentLogId
      ? `Preliminary clinic guidance saved for ${assessmentAnimal}; not a diagnosis.` : 'Not used (optional)';

    if (isCspMode()) {
      document.getElementById('rv-date').textContent = 'To Be Announced';
      document.getElementById('rv-time').textContent = 'To Be Announced';
      return;
    }

    const rawDate = val('apptDate');
    if (rawDate && rawDate !== '—') {
      const [y, m, d] = rawDate.split('-');
      document.getElementById('rv-date').textContent = `${m}/${d}/${y.slice(2)}`;
    } else {
      document.getElementById('rv-date').textContent = '—';
    }

    const selSlot = document.querySelector('.slot-btn.selected');
    document.getElementById('rv-time').textContent = selSlot ? selSlot.dataset.slot : '—';
  }

  /* ── "Book Again" from a request that didn't go through (another request
     got the time, or it expired). The link carries ?rebook=<id>&date=<a day
     with free times>, so the same pet, visit type and day are filled in and
     the owner only picks a time. ── */
  function rebookParams() {
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get('rebook'));
    return Number.isInteger(id) && id > 0 ? { id, date: params.get('date') || '' } : null;
  }

  // A weekday within the booking window the clinic is open, else ''.
  function bookableDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
    if (value < toLocalIsoDate() || value > toLocalIsoDate(bookingHorizonDate())) return '';
    return isWeekendIso(value) || CLOSED_DATES[value] ? '' : value;
  }

  function setRebookField(id, value) {
    const el = document.getElementById(id);
    if (!el || value == null || String(value).trim() === '') return;
    if (el.tagName === 'SELECT') {
      const option = [...el.options].find(o => o.value.toLowerCase() === String(value).trim().toLowerCase());
      if (option) el.value = option.value;
      return;
    }
    el.value = value;
  }

  async function restoreRebook({ id, date }) {
    let request = null;
    try {
      const res = await fetch('/api/appointments/appointment.php', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'list' })
      });
      const json = await res.json();
      request = json.success && Array.isArray(json.data) ? json.data.find(a => Number(a.id) === id) : null;
    } catch {
      request = null;
    }
    // A reload after this keeps the owner's own changes (the draft).
    history.replaceState(null, '', window.location.pathname);
    if (!request) {
      restoreBookingDraft();
      return;
    }

    clearBookingDraft();
    const pets = request.pets?.length ? request.pets : [request.pet || {}];
    restorePetCards(pets.map(pet => {
      const age = String(pet.age || '').match(/^(\d+)\s*([a-z]*)/i);
      return {
        petId: pet.id || pet.pet_id || '',
        petName: pet.name || '',
        petType: { Canine: 'Dog', Feline: 'Cat', Avian: 'Chicken' }[pet.species] || pet.species || '',
        petCategory: pet.animal_category || '',
        petRecordKind: pet.record_kind || 'individual',
        petEstimatedCount: pet.estimated_count || 1,
        petBreed: pet.breed || '',
        petSex: ['male', 'female', 'mixed', 'unknown'].includes(String(pet.sex || '').toLowerCase())
          ? String(pet.sex).charAt(0).toUpperCase() + String(pet.sex).slice(1).toLowerCase() : '',
        petAgeValue: age?.[1] || '', petAgeUnit: /^m/i.test(age?.[2] || '') ? 'Months' : 'Years',
        petVaccDate: pet.last_vaccination_date || ''
      };
    }));
    await visitTypesReady;
    setRebookField('visitType', request.type);
    setRebookField('visitMode', request.visit_mode || 'clinic');
    setRebookField('fieldAddress', request.field_address || '');
    setRebookField('fieldConcern', request.field_concern || '');
    setRebookField('apptDate', bookableDate(date) || bookableDate(request.preferred_date));
    toggleDewormingNotice();
    toggleCspMode();

    // Same vet. The list may still be loading; bv-vets-loaded picks it up.
    if (request.veterinarian_id) {
      const vetItem = document.querySelector(`.vet-item[data-vet-id="${request.veterinarian_id}"]`);
      if (vetItem) {
        if (!vetItem.classList.contains('active')) vetItem.click();
      } else {
        pendingRestoreVetId = request.veterinarian_id;
      }
    }

    showPage(pageBooking);
    goStep(validateStep(2) ? 3 : 2);
  }

  async function restoreChatbotBooking() {
    const url = new URL(window.location.href);
    if (url.searchParams.get('from_chatbot') !== '1') return false;
    url.searchParams.delete('from_chatbot');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    let context = null;
    try {
      context = JSON.parse(sessionStorage.getItem(CHATBOT_BOOKING_KEY) || 'null');
      sessionStorage.removeItem(CHATBOT_BOOKING_KEY);
    } catch { /* Fall back to the usual booking flow. */ }
    if (!context || context.version !== 1 || Date.now() - Number(context.createdAt) > 60 * 60 * 1000) return false;

    await Promise.all([accountDetailsReady, visitTypesReady, consultSymptomsReady]);
    clearBookingDraft();
    const species = context.petType === 'Other' ? 'Other livestock' : String(context.petType || '');
    const category = context.animalCategory === 'livestock' ? 'livestock' : 'companion';
    fillPetCard(firstPetCard, { petType: species, petCategory: category });
    renumberPetCards();
    setRebookField('visitType', 'Consultation');
    toggleCspMode();
    toggleVisitMode();

    const symptoms = Array.isArray(context.symptoms)
      ? context.symptoms.filter(item => item && item !== 'No listed symptoms').map(String) : [];
    const concern = symptoms.length ? `Reported symptoms: ${symptoms.join(', ')}` : 'No listed symptoms; owner requests a veterinary consultation.';
    if (category === 'livestock') {
      document.getElementById('fieldAddress').value = accountDetails?.address || '';
      document.getElementById('fieldConcern').value = concern.slice(0, 2000);
    }
    const symptomSelect = document.getElementById('consultSymptoms');
    const symptomKeys = new Set(symptoms.map(item => item.toLocaleLowerCase()));
    [...symptomSelect.options].forEach(option => { option.selected = symptomKeys.has(option.value.toLocaleLowerCase()); });
    const duration = document.getElementById('consultDuration');
    if ([...duration.options].some(option => option.value === context.duration)) duration.value = context.duration;
    const severity = { 'Active but sick': 'Mild', Active: 'Mild', Weak: 'Moderate', 'Not moving': 'Critical' }[context.severity];
    if (severity) document.getElementById('consultSeverity').value = severity;
    updateConsultSuggestions();

    const summary = document.getElementById('chatbotBookingSummary');
    summary.hidden = false;
    summary.textContent = `From your chatbot check: ${species || 'species not selected'} · Age group: ${context.ageGroup || 'Not sure'} · ${symptoms.length ? symptoms.join(', ') : 'No listed symptoms'} · ${context.duration || 'Duration not given'} · ${context.severity || 'Status not given'}${context.barangayName ? ` · Barangay: ${context.barangayName}` : ''}. Confirm the details below and check the field location before submitting.`;
    if (context.assessment && typeof context.assessment === 'object') {
      assessmentLogId = Number(context.assessment.logId) || 0;
      assessmentAnimal = petValue(firstPetCard, 'petName');
      const resultBox = document.getElementById('consultResult');
      resultBox.classList.remove('is-hidden');
      resultBox.textContent = `${context.assessment.condition || 'Clinic guidance'}: ${context.assessment.recommendation || ''} This is preliminary guidance, not a diagnosis.`;
    }
    showPage(pageBooking);
    goStep(validateStep(1) ? 2 : 1);
    return true;
  }

  // Bring back any in-progress booking (must run after all wiring above),
  // or start from the request a "Book Again" link points to.
  const rebook = rebookParams();
  if (rebook) restoreRebook(rebook);
  else restoreChatbotBooking()
    .then(restored => { if (!restored) restoreBookingDraft(); })
    .catch(() => restoreBookingDraft());

})();


/* ── Utility helpers ─────────────────────────── */

/**
 * Converts whatever the DB returns for avatar into a browser-accessible URL.
 *
 * DB returns a site-relative path, e.g. /storage/profile/profile_xxx.png —
 * resolved against the current origin so it works on any host.
 */
function getAvatarUrl(avatarPath) {
  if (avatarPath.startsWith('http')) return avatarPath;  // already a full URL
  return avatarPath.startsWith('/') ? avatarPath : `/${avatarPath}`;
}

/* Vets with no uploaded photo get a 2-letter initials avatar instead of a
   stock placeholder image, so every unphotographed vet doesn't look like
   the same fake person. */
function getInitials(name) {
  const initials = String(name || '').trim().split(/\s+/)
    .map(part => part[0]).join('').slice(0, 2).toUpperCase();
  return initials || '?';
}

function avatarMarkup(name, avatarPath, sizeClass) {
  if (!avatarPath) {
    return `<div class="${sizeClass} avatar-initials">${getInitials(name)}</div>`;
  }
  const src = escapeAttr(getAvatarUrl(avatarPath));
  const initials = getInitials(name);
  return `<img src="${src}" alt="${escapeAttr(name)}" class="${sizeClass}" ` +
    `onerror="this.onerror=null;this.outerHTML='<div class=\\'${sizeClass} avatar-initials\\'>${initials}</div>';">`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
// Slots are stored as 24-hour 'HH:MM'; owners read them as '3:00 PM'.
function formatTimeSlot(slot) {
  const value = String(slot ?? '').trim();
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return value;
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${match[2]} ${suffix}`;
}

// Status values are database enums; never show one to an owner raw, or
// 'reschedule_pending' leaks through underscore and all.
function statusText(status) {
  const value = String(status ?? '').trim();
  if (value === 'reschedule_pending') return 'New time proposed';
  if (value === 'owner_reschedule_pending') return 'Awaiting clinic';
  return capitalize(value.replace(/_/g, ' '));
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/* =============================================
   BVETTER — Book Appointment Page JS
   File: js/book-appointment.js
   Depends: nav.js, api.js

   Functions:
   - showPage(page)       — switch between 3 page views
   - goStep(n)            — navigate booking form steps 1-5
   - updateStepper(n)     — update header step dots
   - populateReview()     — fill step 4 review from form inputs
   - updateVetProfile(v)  — update profile card with vet data
   - buildCalendar(y, m)  — render dynamic calendar grid

   TODO backend:
   - populateReview / goStep(5): replace with
     api.bookAppointment(data)
   - pageHistory: replace static rows with
     api.getAppointments()
   ============================================= */

/* ── Calendar state ──────────────────────────── */
let calYear, calMonth;

/* ── Tracks currently selected vet + date ────── */
let selectedVetId   = null;
let selectedCalDate = null;   // 'YYYY-MM-DD'

function buildCalendar(year, month) {
  calYear  = year;
  calMonth = month;

  const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  const DAY_LABELS = ['MO','TU','WE','TH','FR','SA','SU'];

  document.querySelector('.cal-month').textContent =
    `${MONTH_NAMES[month]} ${year}`;

  const grid  = document.querySelector('.cal-grid');
  const today = new Date();

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
    const isToday =
      d === today.getDate() &&
      month === today.getMonth() &&
      year  === today.getFullYear();
    cell.className   = 'cal-day' + (isToday ? ' today' : '');
    cell.textContent = d;

    cell.addEventListener('click', () => {
      grid.querySelectorAll('.cal-day').forEach(c => c.classList.remove('today'));
      cell.classList.add('today');

      // Zero-pad month/day for YYYY-MM-DD
      const mm = String(month + 1).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      selectedCalDate = `${year}-${mm}-${dd}`;

      fetchAndBuildSlots();   // refresh available hours for this date + vet
    });

    grid.appendChild(cell);
  }
}

// Init calendar to current month and set today as the selected date
(function initCalendar() {
  const now = new Date();
  buildCalendar(now.getFullYear(), now.getMonth());

  // Set today as the default selected date so slots load on page open
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  selectedCalDate = `${now.getFullYear()}-${mm}-${dd}`;

  const calBtns = document.querySelectorAll('.cal-btn');

  calBtns[0].addEventListener('click', () => {
    let m = calMonth - 1, y = calYear;
    if (m < 0) { m = 11; y--; }
    buildCalendar(y, m);
  });

  calBtns[1].addEventListener('click', () => {
    let m = calMonth + 1, y = calYear;
    if (m > 11) { m = 0; y++; }
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
    const res  = await fetch('/FINAL-BACKEND(VBETTER)/Final-Backend/backend/appointments/appointment.php', {
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
    buildTimeSlots(json.success ? (json.booked || []) : []);
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

function buildTimeSlots(unavailableSlots = []) {
  const grid = document.getElementById('timeGrid');
  if (!grid) return;
  grid.innerHTML = '';

  ALL_TIME_SLOTS.forEach(slot => {
    const div    = document.createElement('div');
    const isNA   = unavailableSlots.includes(slot);
    div.className   = 'time-slot ' + (isNA ? 'na' : 'available');
    div.textContent = slot;

    if (!isNA) {
      div.addEventListener('click', () => {
        grid.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
        div.classList.add('selected');
      });
    }

    grid.appendChild(div);
  });
}

// Build on page load — all slots available until backend provides data
buildTimeSlots();



function updateVetProfile(vet) {
  const avatarSrc = getAvatarUrl(vet.avatar);

  // FIX: profile image src was never set
  const profileImg = document.getElementById('profile-heads');
  if (profileImg) profileImg.src = avatarSrc;

  const set = (id, val, fallback = '—') =>
    (document.getElementById(id) || {}).textContent = val || fallback;

  set('profile-name',         vet.full_name,           'Dr. Jane Igaya');
  set('profile-title',        vet.position_title,       'Senior Veterinarian');
  set('profile-clinic',       vet.clinic_location,      'Baliwag Vet Clinic');
  set('profile-rating',       vet.rating,               '4.9');
  set('profile-review-count', `(${vet.review_count || 124} reviews)`);
  set('stat-experience-val',  vet.experience_years  ? `${vet.experience_years}+ Years`   : '12+ Years');
  set('stat-patients-val',    vet.patients_served   ? `${vet.patients_served} Served`    : '2.4k');
  set('stat-rating-val',      vet.rating_percentage ? `${vet.rating_percentage}%`        : '98%');
  set('edu-tag',              vet.education,            'DVM, Cornell University');
  set('section-desc',         vet.bio,                  '');
}


/* ── Vet list fetch & click wiring ───────────── */
async function fectchVets() {
  const VetAccounts = await api.getVets();
  const temp        = await api.allUsers();

  // Build email → avatar lookup from allUsers (only allUsers has the avatar field)
  const avatarMap = {};
  (temp.data || []).forEach(user => {
    if (user.email) avatarMap[user.email] = user.avatar || '';
  });

  const container = document.getElementById('vetContainer');

  VetAccounts.data.forEach((vet, index) => {
    // Merge avatar onto vet object by matching email
    vet.avatar = avatarMap[vet.email] || '';
    const avatarSrc = getAvatarUrl(vet.avatar);

    const item = document.createElement('div');
    item.className = 'vet-item' + (index === 0 ? ' active' : '');
    item.innerHTML = `
      <img src="${escapeAttr(avatarSrc)}" alt="${escapeAttr(vet.full_name)}" class="vet-thumb"/>
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
      fetchAndBuildSlots();            // refresh slots for new vet + current date
    });

    container.appendChild(item);
  });

  // Show first vet's profile on load, then fetch real slot availability
  if (VetAccounts.data.length > 0) {
    selectedVetId = VetAccounts.data[0].id;
    updateVetProfile(VetAccounts.data[0]);
    fetchAndBuildSlots();   // now both selectedVetId + selectedCalDate are set
  }
}

fectchVets();


/* ── Page + booking form logic ───────────────── */
(function () {
  'use strict';

  /* ── Page references ─────────────────────── */
  const pageVet     = document.getElementById('pageVet');
  const pageBooking = document.getElementById('pageBooking');
  console.log(document.getElementById('btnViewAll'));
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

  /* ── Page navigation wiring ─────────────── */
  document.getElementById('btnBook')           .addEventListener('click', () => { showPage(pageBooking); goStep(1); });
  document.getElementById('btnViewAll')        .addEventListener('click', (e) => { e.preventDefault(); showPage(pageHistory); });
  document.getElementById('btnBackToVet')      .addEventListener('click', (e) => { e.preventDefault(); showPage(pageVet); });
  document.getElementById('btnBackHome')       .addEventListener('click', () => showPage(pageVet));
  document.getElementById('btnViewHistory')    .addEventListener('click', () => showPage(pageHistory));
  document.getElementById('btnHistBack')       .addEventListener('click', () => showPage(pageVet));
  document.getElementById('btnBookFromHistory').addEventListener('click', () => { showPage(pageBooking); goStep(1); });

  /* ── Step navigation wiring ─────────────── */
  document.getElementById('s1Next')   .addEventListener('click', () => goStep(2));
  document.getElementById('s2Back')   .addEventListener('click', () => goStep(1));
  document.getElementById('s2Next')   .addEventListener('click', () => goStep(3));
  document.getElementById('s3Back')   .addEventListener('click', () => goStep(2));
  document.getElementById('s3Next')   .addEventListener('click', () => goStep(4));
  document.getElementById('s4Back')   .addEventListener('click', () => goStep(3));
  document.getElementById('s4Confirm').addEventListener('click', submitAppointment);

  /* ── Core step switcher ──────────────────── */
  function goStep(n) {
    for (let i = 1; i <= 5; i++) {
      const el = document.getElementById('step' + i);
      if (el) el.style.display = (i === n) ? 'block' : 'none';
    }
    updateStepper(n);
    if (n === 4) populateReview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── Submit appointment ──────────────────── */
  async function submitAppointment() {
    const selectedSlot = document.querySelector('.slot-btn.selected');
    const session = JSON.parse(
      sessionStorage.getItem('vbetter_session') ||
      sessionStorage.getItem('bvetter_user')    ||
      'null'
    );

    const payload = {
      action:               'create',
      owner_id:             session?.userId || session?.id || '',
      veterinarian_id:      selectedVetId || '',           // ← vet selected on page 1
      owner_name:           document.getElementById('ownerName')?.value.trim()    || '',
      owner_contact:        document.getElementById('ownerContact')?.value.trim() || '',
      owner_email:          document.getElementById('ownerEmail')?.value.trim()   || '',
      owner_barangay_id:    document.getElementById('ownerBarangay')?.value       || '',
      owner_address:        document.getElementById('ownerAddress')?.value.trim() || '',
      pet_name:             document.getElementById('petName')?.value.trim()      || '',
      pet_type:             document.getElementById('petType')?.value             || '',
      pet_breed:            document.getElementById('petBreed')?.value.trim()     || '',
      pet_age:              document.getElementById('petAge')?.value.trim()       || '',
      pet_sex:              document.getElementById('petSex')?.value              || '',
      pet_vaccination_date: document.getElementById('petVaccDate')?.value         || '',
      appointment_type:     document.getElementById('visitType')?.value           || '',
      preferred_date:       document.getElementById('apptDate')?.value            || '',
      time_slot:            selectedSlot ? selectedSlot.dataset.slot              : '',
      notes:                document.getElementById('apptNotes')?.value.trim()    || ''
    };

    const required = [
      'owner_name','owner_contact','owner_email',
      'pet_name','pet_type','appointment_type',
      'preferred_date','time_slot'
    ];
    if (required.some(k => !payload[k])) {
      alert('Please complete all required appointment fields.');
      return;
    }

    try {
      const result = await api.bookAppointment(payload);
      if (!result.success) {
        alert(result.message || 'Failed to book appointment.');
        return;
      }
      goStep(5);
    } catch (error) {
      alert('Failed to book appointment. Please try again.');
    }
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
      document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
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
    document.getElementById('rv-petname')  .textContent = val('petName');
    document.getElementById('rv-pettype')  .textContent = selText('petType');
    document.getElementById('rv-ageSex')   .textContent = val('petAge') + ' / ' + selText('petSex');
    document.getElementById('rv-visitType').textContent = selText('visitType');

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

})();


/* ── Utility helpers ─────────────────────────── */

/**
 * Converts whatever the DB returns for avatar into a browser-accessible URL.
 *
 * DB returns full filesystem paths like:
 *   /Final-backend(VBETTER)/Final-Backend/backend/uploads/profile/profile_xxx.png
 *
 * The backend serves those files from:
 *   http://localhost:3000/uploads/profile/profile_xxx.png
 *
 * Change BASE_URL below if your backend runs on a different port.
 */
const BASE_URL = 'http://localhost';

function getAvatarUrl(avatarPath) {
  if (!avatarPath) return '';
  if (avatarPath.startsWith('http')) return avatarPath;  // already a full URL
  // DB returns the full web-accessible path e.g.
  // /Final-backend(VBETTER)/Final-Backend/backend/uploads/profile/xxx.png
  // so just prepend the host — no stripping needed
  return `${BASE_URL}${avatarPath.startsWith('/') ? '' : '/'}${avatarPath}`;
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
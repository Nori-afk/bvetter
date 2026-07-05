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

function buildCalendar(year, month) {
  const vaccDate = document.getElementById("petVaccDate");
  const today_input = toLocalIsoDate();
  const apptDate = document.getElementById("apptDate");
  apptDate.min = today_input;
  vaccDate.min = today_input;

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

    const isToday =
      d === today.getDate() &&
      month === today.getMonth() &&
      year === today.getFullYear();

    cell.className = 'cal-day';

    if (isToday) cell.classList.add('today');
    if (isPast) cell.classList.add('disabled');

    cell.textContent = d;

    // Only allow clicking today and future dates
    if (!isPast) {
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
    const res  = await fetch('/final-VBETTER/bvetter/api/appointments/appointment.php', {
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
  replaceContent()
  console.log(vet)
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
  // stat-patients-val is populated by replaceContent() (completed appointment count for this vet)
  set('stat-rating-val',      vet.rating_percentage ? `${vet.rating_percentage}%`        : '98%');
  set('edu-tag',              vet.education,            'DVM, Cornell University');
  set('section-desc',         vet.bio,                  '');
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
    const avatarSrc = getAvatarUrl(vet.avatar);

    const item = document.createElement('div');
    item.className = 'vet-item' + (index === 0 ? ' active' : '');
    item.innerHTML = `
      <img src="${escapeAttr(avatarSrc)}" alt="${escapeAttr(vet.full_name)}" class="vet-thumb"
           onerror="this.onerror=null;this.src='../images/img/vet-profile.png';"/>
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
}
async function loadRecentHistory() {
  try {
    const session = JSON.parse(
      sessionStorage.getItem('vbetter_session') ||
      sessionStorage.getItem('bvetter_user') ||
      'null'
    );

    const res = await fetch('/final-VBETTER/bvetter/api/appointments/appointment.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'list',
        owner_id: session?.userId || session?.id || ''
      })
    });

    const json = await res.json();

    if (!json.success || !json.data) return;

    const container = document.getElementById('recentHistoryList');
    container.innerHTML = '';

    // LIMIT TO ONLY 5
    const recentAppointments = json.data.slice(0, 5);

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

      // pending / cancelled
      else {
        reviewBtn = `
          <button class="btn-rate" disabled>
            ${capitalize(appt.status)}
          </button>
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
async function submitReview(appointmentId, rating, comment) {
  try {
    const res = await fetch('/final-VBETTER/bvetter/api/appointments/appointment.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'submit_review',
        appointment_id: appointmentId,
        rating: rating,
        comment: comment
      })
    });

    const json = await res.json();

    if (json.success) {
      alert('Review submitted successfully!');
      loadAppointmentHistory(); // refresh history
    } else {
      alert(json.message || 'Failed to submit review.');
    }
  } catch (err) {
    console.error(err);
    alert('Failed to submit review.');
  }
}
async function replaceContent(){
   try {
    const res = await fetch('/final-VBETTER/bvetter/api/appointments/appointment.php', {
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
      alert(json.message || 'Failed to submit review.');
    }
  } catch (err) {
    console.error(err);
    alert('Failed to submit review.');
  }
}
function openReviewForm(appointmentId, currentRating = '', currentComment = '') {
  const rating = prompt('Rate this appointment (1 to 5):', currentRating);
  if (!rating) return;

  const numRating = parseInt(rating);

  if (numRating < 1 || numRating > 5) {
    alert('Rating must be between 1 and 5.');
    return;
  }

  const comment = prompt('Leave a comment:', currentComment || '');

  submitReview(appointmentId, numRating, comment);
}async function loadAppointmentHistory() {
  try {
    const session = JSON.parse(
      sessionStorage.getItem('vbetter_session') ||
      sessionStorage.getItem('bvetter_user') ||
      'null'
    );

    const res = await fetch('/final-VBETTER/bvetter/api/appointments/appointment.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'list',
        owner_id: session?.userId || session?.id || ''
      })
    });

    const json = await res.json();
    console.log('Appointment history:', json);
    const histList = document.getElementById('histList');
    const histEmpty = document.getElementById('histEmpty');
    const completedCountEl = document.getElementById('complted-visit');

    completedCountEl.textContent = json.data ? json.data.filter(appt => appt.status === 'completed').length : '0';

    if (!json.success || !json.data || json.data.length === 0) {
      histList.style.display = 'none';
      histEmpty.style.display = 'block';
      return;
    }

    histEmpty.style.display = 'none';
    histList.style.display = 'flex';
    histList.innerHTML = '';

    json.data.forEach(appt => {
      const rowClass = appt.status === 'completed'
        ? 'appt-row appt-completed'
        : 'appt-row appt-pending';

      const statusBadge = `
        <span class="status-badge s-${appt.status}">
          <span class="status-dot"></span>
          ${capitalize(appt.status)}
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
            <div class="appt-pet-name">${appt.patient}</div>
            <div class="appt-pet-meta">
              ${appt.pet.species} &bull; ${appt.pet.age} yrs
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
            <div class="appt-date-val">
              ${formatDate(appt.preferred_date)}
            </div>
            <div class="appt-time-val">${appt.time_slot}</div>
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
    const res = await fetch('/final-VBETTER/bvetter/api/appointments/appointment.php', {
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
    const res = await fetch('/final-VBETTER/bvetter/api/appointments/appointment.php', {
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
    const res = await fetch('/final-VBETTER/bvetter/api/appointments/appointment.php', {
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

  /* ── Page navigation wiring ─────────────── */
  document.getElementById('btnBook')           .addEventListener('click', () => { showPage(pageBooking); goStep(1); });
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
const selectedSlot = document.querySelector('.time-slot.selected');
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
time_slot: selectedSlot ? selectedSlot.textContent.trim() : '',
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

    const todayIso = toLocalIsoDate();
    if (payload.preferred_date < todayIso) {
      alert('Please select a date that has not yet passed.');
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
 *   /final-VBETTER/bvetter/api/uploads/profile/profile_xxx.png
 *
 * The backend serves those files from:
 *   http://localhost:3000/uploads/profile/profile_xxx.png
 *
 * Change BASE_URL below if your backend runs on a different port.
 */
const BASE_URL = 'http://localhost';

function getAvatarUrl(avatarPath) {
  const FALLBACK = '../images/img/vet-profile.png';
  if (!avatarPath) return FALLBACK;
  if (avatarPath.startsWith('http')) return avatarPath;  // already a full URL
  // DB returns the full web-accessible path e.g.
  // /final-VBETTER/bvetter/api/uploads/profile/xxx.png
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
let currentEvent = 0;
let totalEvents = 0;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function imageUrl(path, fallback) {
  if (!path) return fallback;
  if (String(path).startsWith('http') || String(path).startsWith('data:')) return path;
  return path;
}

function formatDate(value) {
  if (!value) return 'Date TBA';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function slideEvents(dir) {
  if (!totalEvents) return;
  currentEvent = (currentEvent + dir + totalEvents) % totalEvents;
  updateCarousel();
}

function goToEvent(index) {
  currentEvent = Math.max(0, Math.min(index, totalEvents - 1));
  updateCarousel();
}

function updateCarousel() {
  const track = document.getElementById('eventsTrack');
  if (!track || !track.children.length) return;
  const cardWidth = track.children[0].offsetWidth + 20;
  track.style.transform = `translateX(-${currentEvent * cardWidth}px)`;
  document.querySelectorAll('.events-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === currentEvent);
  });
}

async function loadLandingData() {
  await Promise.all([
    renderLandingEvents(),
    renderLandingLostFound(),
    renderLandingSpecialists()
  ]);
  window.addEventListener('resize', updateCarousel);
}

async function renderLandingEvents() {
  const track = document.getElementById('eventsTrack');
  const dots = document.querySelector('.events-dots');
  if (!track) return;

  const [announcementResult, vaccinationResult] = await Promise.all([
    api.getAnnouncements({ status: 'published', limit: 8 }).catch(() => ({ success: false, data: [] })),
    api.getMassVaccinationEvents().catch(() => ({ success: false, data: [] }))
  ]);

  const announcements = announcementResult.success ? announcementResult.data : [];
  const vaccinationEvents = vaccinationResult.success ? vaccinationResult.data : [];
  const cards = [
    ...announcements.map((item) => ({
      tag: 'Upcoming Event',
      type: item.category || 'Community Advisory',
      title: item.title,
      description: item.description,
      date: item.dateLabel || formatDate(item.date),
      location: item.location || 'Baliwag City Veterinary Services',
      image: imageUrl(item.image, '../images/img/event-1.png')
    })),
    ...vaccinationEvents.map((item) => ({
      tag: item.status || 'Vaccination Event',
      type: item.vaccine || 'Mass Vaccination',
      title: `${item.vaccine || 'Vaccination'} - ${item.barangay || 'Barangay'}`,
      description: 'Community vaccination event managed by the veterinary clinic.',
      date: item.dateLabel || formatDate(item.date),
      location: item.barangay || 'Barangay TBA',
      image: '../images/img/event-2.png'
    }))
  ].slice(0, 8);

  if (!cards.length) {
    track.innerHTML = '<div class="event-card event-empty"><div class="event-card-info"><span class="event-type">NO EVENTS</span><h3>No upcoming health events yet</h3><p>Check back for announcements from the veterinary team.</p></div></div>';
    if (dots) dots.innerHTML = '';
    totalEvents = 1;
    return;
  }

  totalEvents = cards.length;
  currentEvent = 0;
  track.innerHTML = cards.map((item, index) => `
    <div class="event-card">
      <div class="event-card-img-side">
        <span class="event-tag ${index % 2 ? 'seminar' : 'upcoming'}">${escapeHtml(item.tag)}</span>
        <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" class="event-img"/>
      </div>
      <div class="event-card-info">
        <span class="event-type">${escapeHtml(item.type)}</span>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.description)}</p>
        <div class="event-meta">
          <span class="event-meta-item"><img src="../images/icons/icon-calendar.svg" alt="" class="meta-icon"/> ${escapeHtml(item.date)}</span>
          <span class="event-meta-item"><img src="../images/icons/icon-location.svg" alt="" class="meta-icon"/> ${escapeHtml(item.location)}</span>
        </div>
      </div>
    </div>
  `).join('');

  if (dots) {
    dots.innerHTML = cards.map((_, index) => `<div class="events-dot ${index === 0 ? 'active' : ''}" onclick="goToEvent(${index})"></div>`).join('');
  }
  updateCarousel();
}

async function renderLandingLostFound() {
  const grid = document.querySelector('.pets-grid');
  if (!grid) return;
  const result = await api.getReports({ status: 'active' }).catch(() => ({ success: false, data: [] }));
  const reports = result.success && Array.isArray(result.data) ? result.data.slice(0, 3) : [];

  const cards = reports.map((report) => {
    const type = String(report.report_type || report.type || 'lost').toLowerCase();
    const image = imageUrl(report.photo_path || report.image || report.photo, '../images/img/pet-1.jpg');
    return `
      <div class="pet-card">
        <div class="pet-img-wrap">
          <div class="pet-status ${type === 'found' ? 'found' : 'lost'}">${escapeHtml(type)}</div>
          <img src="${escapeHtml(image)}" alt="${escapeHtml(report.pet_name || report.petName || 'Pet report')}" class="pet-img"/>
        </div>
        <div class="pet-info">
          <span class="pet-name">${escapeHtml(report.pet_name || report.petName || `${report.species || 'Pet'} Report`)}</span>
          <span class="pet-location"><img src="../images/icons/icon-location.svg" alt="" class="loc-icon"/> ${escapeHtml(report.barangay_name || report.barangay || report.location_text || 'Baliwag')}</span>
        </div>
      </div>
    `;
  });

  if (!cards.length) {
    cards.push('<div class="pet-card"><div class="pet-info"><span class="pet-name">No active reports</span><span class="pet-location">Lost and found is clear right now.</span></div></div>');
  }

  cards.push(`
    <div class="pet-card pet-card-report" onclick="window.location.href='lost-found.html'">
      <div class="report-icon"><img src="../images/icons/icon-report.svg" alt="report" class="report-svg"/></div>
      <span class="report-text">Report a Pet</span>
    </div>
  `);
  grid.innerHTML = cards.join('');
}

async function renderLandingSpecialists() {
  const grid = document.querySelector('.specialists-grid');
  if (!grid) return;
  const result = await api.allUsers().catch(() => ({ success: false, data: [] }));
  const vets = result.success && Array.isArray(result.data)
    ? result.data.filter((user) => user.role === 'vet' && user.status === 'active').slice(0, 4)
    : [];

  if (!vets.length) {
    grid.innerHTML = '<div class="specialist-card"><div class="specialist-info"><span class="specialist-name">No active specialists listed</span><p>Veterinarian profiles will appear here once active accounts are available.</p></div></div>';
    return;
  }

  grid.innerHTML = vets.map((vet, index) => `
    <div class="specialist-card">
      <div class="specialist-icon ${index % 2 ? 'green' : 'blue'}">
        ${vet.avatar ? `<img src="${escapeHtml(vet.avatar)}" alt="${escapeHtml(vet.name)}" class="specialist-avatar"/>` : '<img src="../images/icons/icon-doctor.svg" alt="" class="doc-icon"/>'}
      </div>
      <div class="specialist-info">
        <span class="specialist-name">${escapeHtml(vet.name)}</span>
        <span class="specialist-role">${escapeHtml(vet.roleLabel || 'Veterinarian')}</span>
        <p>${escapeHtml(vet.email || 'Baliwag Veterinary Services specialist')}</p>
      </div>
    </div>
  `).join('');
}

document.addEventListener('DOMContentLoaded', loadLandingData);

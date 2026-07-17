document.addEventListener('DOMContentLoaded', async function () {
    const [
        dashboardResponse,
        appointmentsResponse,
        vaccinationEventsResponse,
        chatbotStatsResponse,
        announcementsResponse,
        staffNotificationsResponse
    ] = await Promise.all([
        window.VetAPI?.getDashboardSummary ? window.VetAPI.getDashboardSummary({ patient_range: 'weekly' }) : { ok: false, data: null },
        window.VetAPI?.getAppointments ? window.VetAPI.getAppointments({}) : { ok: false, data: [] },
        window.VetAPI?.getVaccinationEvents ? window.VetAPI.getVaccinationEvents() : { ok: false, data: [] },
        window.VetAPI?.getChatbotDashboardStats ? window.VetAPI.getChatbotDashboardStats() : { ok: false, data: {} },
        window.VetAPI?.getAnnouncements ? window.VetAPI.getAnnouncements({ status: 'all' }) : { ok: false, data: [] },
        window.VetAPI?.getStaffNotifications ? window.VetAPI.getStaffNotifications() : { ok: false, data: [] }
    ]);
    let dashboardData = dashboardResponse.ok ? dashboardResponse.data : null;
    const appointments = appointmentsResponse.ok && Array.isArray(appointmentsResponse.data) ? appointmentsResponse.data : [];
    const vaccinationEvents = vaccinationEventsResponse.ok && Array.isArray(vaccinationEventsResponse.data) ? vaccinationEventsResponse.data : [];
    const chatbotStats = chatbotStatsResponse.ok ? chatbotStatsResponse.data : {};
    const staffNotifications = staffNotificationsResponse.ok && Array.isArray(staffNotificationsResponse.data) ? staffNotificationsResponse.data : [];
    applyDashboardKpis(dashboardData);
    renderTodayTimeline(appointments);
    renderRecentPatientAppointment(appointments);
    renderNextMajorEvent(vaccinationEvents);
    renderChatbotInsights(chatbotStats);

    const announcementState = {
        items: announcementsResponse.ok && Array.isArray(announcementsResponse.data) ? announcementsResponse.data : []
    };

    const notificationState = {
        items: [
            ...staffNotifications.map((item) => ({
                id: item.id,
                title: item.title,
                detail: item.message,
                time: new Date(item.created_at).toLocaleString(),
                read: item.is_read,
                serverBacked: true
            })),
            ...buildOperationalNotifications(dashboardData, appointments, vaccinationEvents)
        ]
    };

    const modalRoot = ensureDashboardModalRoot();

    const calendarEl = document.getElementById('calendar');
    if (calendarEl) {
        const dashCal = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            initialDate: new Date().toISOString().slice(0, 10),
            headerToolbar: { left: '', center: '', right: '' },
            height: 'auto',
            fixedWeekCount: false,
            events: buildCalendarEvents(appointments, vaccinationEvents),
            datesSet: function(info) {
                const title = document.querySelector('.calendar-header h3');
                if (title) title.textContent = info.view.currentStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            }
        });
        dashCal.render();

        const [prevBtn, nextBtn] = document.querySelectorAll('.nav-arrow');
        if (prevBtn) prevBtn.addEventListener('click', () => dashCal.prev());
        if (nextBtn) nextBtn.addEventListener('click', () => dashCal.next());
        updateCalendarTitle();
    }

    // Store chart instances globally so filters can update them
    window.dashboardCharts = {
        patientVolume: null,
        disease: null
    };

    const patientVolumeCtx = document.getElementById('patientVolumeChart');
    if (patientVolumeCtx) {
        window.dashboardCharts.patientVolume = new Chart(patientVolumeCtx, {
            type: 'line',
            data: {
                labels: (dashboardData?.patientVolume?.length ? dashboardData.patientVolume : [
                    { label: 'Jan', value: 120 },
                    { label: 'Feb', value: 190 },
                    { label: 'Mar', value: 150 },
                    { label: 'Apr', value: 221 },
                    { label: 'May', value: 200 },
                    { label: 'Jun', value: 290 },
                    { label: 'Jul', value: 250 }
                ]).map((item) => item.label),
                datasets: [
                    {
                        label: 'Patient Volume',
                        data: (dashboardData?.patientVolume?.length ? dashboardData.patientVolume : [
                            { value: 120 },
                            { value: 190 },
                            { value: 150 },
                            { value: 221 },
                            { value: 200 },
                            { value: 290 },
                            { value: 250 }
                        ]).map((item) => item.value),
                        borderColor: '#002A58',
                        backgroundColor: 'rgba(0, 42, 88, 0.07)',
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.45,
                        pointRadius: 3,
                        pointBackgroundColor: '#002A58',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointHoverRadius: 5,
                        pointHoverBackgroundColor: '#002A58',
                        pointHoverBorderWidth: 2
                    },
                    {
                        label: 'Predicted Patient Volume',
                        data: (dashboardData?.patientVolume?.length ? dashboardData.patientVolume : [
                            { predicted: 130 },
                            { predicted: 205 },
                            { predicted: 162 },
                            { predicted: 239 },
                            { predicted: 216 },
                            { predicted: 313 },
                            { predicted: 270 }
                        ]).map((item) => item.predicted || item.value),
                        borderColor: '#677BAE',
                        backgroundColor: 'rgba(103, 123, 174, 0.06)',
                        borderWidth: 1.5,
                        borderDash: [5, 3],
                        fill: true,
                        tension: 0.45,
                        pointRadius: 3,
                        pointBackgroundColor: '#677BAE',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointHoverRadius: 5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            color: '#475569',
                            font: { size: 11, weight: '600', family: "'Inter', sans-serif" },
                            padding: 18,
                            usePointStyle: true,
                            pointStyleWidth: 8
                        }
                    },
                    tooltip: {
                        backgroundColor: '#0F172A',
                        titleColor: '#F8FAFC',
                        bodyColor: '#CBD5E1',
                        titleFont: { size: 12, weight: '700', family: "'Inter', sans-serif" },
                        bodyFont: { size: 11, family: "'Inter', sans-serif" },
                        padding: 12,
                        cornerRadius: 8,
                        boxPadding: 5,
                        borderColor: 'rgba(255,255,255,0.08)',
                        borderWidth: 1
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        border: { display: false, dash: [4, 4] },
                        grid: { color: 'rgba(0,0,0,0.04)' },
                        ticks: {
                            color: '#94A3B8',
                            font: { size: 11, family: "'Inter', sans-serif" },
                            padding: 8
                        }
                    },
                    x: {
                        border: { display: false },
                        grid: { display: false },
                        ticks: {
                            color: '#94A3B8',
                            font: { size: 11, family: "'Inter', sans-serif" },
                            padding: 6
                        }
                    }
                }
            }
        });
    }

    // ===========================
    // DISEASE CASES CHART
    // ===========================
    const diseaseCtx = document.getElementById('diseaseChart');
    if (diseaseCtx) {
        window.dashboardCharts.disease = new Chart(diseaseCtx, {
            type: 'line',
            data: {
                labels: (dashboardData?.diseaseCasesByBarangay?.length ? dashboardData.diseaseCasesByBarangay : [
                    { barangay: 'Poblacion', actual: 5, predicted: 7 },
                    { barangay: 'San Jose', actual: 2, predicted: 3 },
                    { barangay: 'Tangos', actual: 4, predicted: 5 },
                    { barangay: 'Matangtubig', actual: 10, predicted: 8 }
                ]).map((item) => item.barangay),
                datasets: [
                    {
                        label: 'Confirmed Cases',
                        data: (dashboardData?.diseaseCasesByBarangay?.length ? dashboardData.diseaseCasesByBarangay : [
                            { actual: 5 },
                            { actual: 2 },
                            { actual: 4 },
                            { actual: 10 }
                        ]).map((item) => item.actual),
                        borderColor: '#DC2626',
                        backgroundColor: 'rgba(220, 38, 38, 0.06)',
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.45,
                        pointStyle: 'circle',
                        pointRadius: 3,
                        pointBackgroundColor: '#DC2626',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointHoverRadius: 5
                    },
                    {
                        label: 'Predicted Cases',
                        data: (dashboardData?.diseaseCasesByBarangay?.length ? dashboardData.diseaseCasesByBarangay : [
                            { predicted: 7 },
                            { predicted: 3 },
                            { predicted: 5 },
                            { predicted: 8 }
                        ]).map((item) => item.predicted),
                        borderColor: '#F97316',
                        backgroundColor: 'rgba(249, 115, 22, 0.06)',
                        borderWidth: 1.5,
                        borderDash: [5, 3],
                        fill: true,
                        tension: 0.45,
                        pointStyle: 'circle',
                        pointRadius: 3,
                        pointBackgroundColor: '#F97316',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointHoverRadius: 5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#475569',
                            font: { size: 11, weight: '600', family: "'Inter', sans-serif" },
                            padding: 18,
                            usePointStyle: true,
                            pointStyleWidth: 8
                        }
                    },
                    tooltip: {
                        backgroundColor: '#0F172A',
                        titleColor: '#F8FAFC',
                        bodyColor: '#CBD5E1',
                        titleFont: { size: 12, weight: '700', family: "'Inter', sans-serif" },
                        bodyFont: { size: 11, family: "'Inter', sans-serif" },
                        padding: 12,
                        cornerRadius: 8,
                        boxPadding: 5,
                        borderColor: 'rgba(255,255,255,0.08)',
                        borderWidth: 1
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        border: { display: false, dash: [4, 4] },
                        grid: { color: 'rgba(0,0,0,0.04)' },
                        ticks: {
                            color: '#94A3B8',
                            stepSize: 2,
                            font: { size: 11, family: "'Inter', sans-serif" },
                            padding: 8
                        }
                    },
                    x: {
                        border: { display: false },
                        grid: { display: false },
                        ticks: {
                            color: '#94A3B8',
                            font: {
                                size: 11
                            }
                        }
                    }
                }
            }
        });
    }


    const vaccinatedCtx = document.getElementById('vaccinatedChart');
    if (vaccinatedCtx) {
        new Chart(vaccinatedCtx, {
            type: 'doughnut',
            data: {
                labels: ['Dogs', 'Cats'],
                datasets: [
                    {
                        data: [
                            dashboardData?.vaccinated?.dogs || 60,
                            dashboardData?.vaccinated?.cats || 40
                        ],
                        backgroundColor: [
                            '#1B6D24',
                            '#E8EEF6'
                        ],
                        borderColor: '#ffffff',
                        borderWidth: 3,
                        hoverBorderWidth: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#0F172A',
                        titleColor: '#F8FAFC',
                        bodyColor: '#CBD5E1',
                        titleFont: { size: 12, weight: '700', family: "'Inter', sans-serif" },
                        bodyFont: { size: 11, family: "'Inter', sans-serif" },
                        padding: 10,
                        cornerRadius: 8
                    }
                },
                cutout: '72%'
            },
            plugins: [{
                id: 'textCenter',
                beforeDatasetsDraw(chart) {
                    const { width, height, ctx } = chart;
                    ctx.save();
                    
                    const fontSize = (height / 200).toFixed(2);
                    const centerX = width / 2;
                    const centerY = height / 2;
                    
                    // Draw main number
                    ctx.font = `bold ${fontSize * 32}px Manrope, sans-serif`;
                    ctx.textBaseline = 'middle';
                    ctx.textAlign = 'center';
                    ctx.fillStyle = '#002A58';
                    ctx.fillText(formatNumber(dashboardData?.vaccinated?.total || 8402), centerX, centerY - fontSize * 5);
                    
                    // Draw label
                    ctx.font = `${fontSize * 12}px Manrope, sans-serif`;
                    ctx.fillStyle = '#737781';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('Total FY24', centerX, centerY + fontSize * 24);
                   
                    
                    ctx.restore();
                }
            }]
        });
    }

    // ===========================
    // EVENT LISTENERS
    // ===========================

    // Header identity — logged-in vet's name + today's date
    (function renderHeaderIdentity() {
        const nameEl = document.getElementById('headerUserName');
        const dateEl = document.getElementById('headerDate');
        const avatarEl = document.getElementById('headerAvatar');
        if (!nameEl && !dateEl && !avatarEl) return;

        let session = null;
        try {
            if (window.VBetterAuth && window.VBetterAuth.getSession) {
                session = window.VBetterAuth.getSession();
            } else {
                const raw = sessionStorage.getItem('vbetter_session');
                session = raw ? JSON.parse(raw) : null;
            }
        } catch { session = null; }

        const name = (session && session.name) ? session.name : 'Unknown';
        if (nameEl) nameEl.textContent = name;
        if (avatarEl) {
            const words = name.trim().split(/\s+/).filter(Boolean);
            const initials = words.length >= 2
                ? (words[0][0] + words[words.length - 1][0])
                : (words[0] || '?').slice(0, 2);
            avatarEl.textContent = initials.toUpperCase();
        }
        if (dateEl) {
            dateEl.textContent = new Date().toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
            });
        }
    })();


 

    // Add appointment button
    const addAppointmentBtn = document.querySelector('.btn-add-appointment');
    if (addAppointmentBtn) {
        addAppointmentBtn.addEventListener('click', function() {
            window.location.href = '/final-VBETTER/bvetter/vet/html/appointment.html';
        });
    }

    // Manage event button
    const manageEventBtn = document.querySelector('.btn-manage-event');
    if (manageEventBtn) {
        manageEventBtn.addEventListener('click', function() {
            window.location.href = '/final-VBETTER/bvetter/vet/html/mass-vaccination.html';
        });
    }

    document.querySelectorAll('.icon-btn[aria-label="Settings"]').forEach((button) => {
        button.addEventListener('click', () => {
            window.location.href = '/final-VBETTER/bvetter/public/pages/account-settings.html';
        });
    });

    const notificationBtn = document.getElementById('notification-icon-btn');
    if (notificationBtn) {
        notificationBtn.addEventListener('click', function () {
            openNotificationModal();
        });
    }

    const aboutHelpBtn = document.getElementById('about-help-btn');
    if (aboutHelpBtn) {
        aboutHelpBtn.addEventListener('click', function () {
            openAboutHelpModal();
        });
    }

    // Create announcement button
    const createAnnounceBtn = document.getElementById('create-announcement-btn');
    if (createAnnounceBtn) {
        createAnnounceBtn.addEventListener('click', function() {
            openAnnouncementEditorModal({ mode: 'create' });
        });
    }

    // Manage announcement button
    const manageAnnounceBtn = document.getElementById('manage-announcement-btn');
    if (manageAnnounceBtn) {
        manageAnnounceBtn.addEventListener('click', function() {
            openManageAnnouncementModal();
        });
    }

    function ensureDashboardModalRoot() {
        let root = document.getElementById('dashboard-modal-root');
        if (!root) {
            root = document.createElement('div');
            root.id = 'dashboard-modal-root';
            root.hidden = true;
            document.body.appendChild(root);
        }
        return root;
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function showModal(content, shellClass = '') {
        modalRoot.innerHTML = `
            <div class="dash-modal-overlay" role="dialog" aria-modal="true">
                <section class="dash-modal-shell ${shellClass}">
                    ${content}
                </section>
            </div>
        `;
        modalRoot.hidden = false;

        const overlay = modalRoot.querySelector('.dash-modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', function (event) {
                if (event.target === overlay) {
                    closeModal();
                }
            });
        }

        modalRoot.querySelectorAll('[data-modal-close]').forEach((button) => {
            button.addEventListener('click', closeModal);
        });
    }

    function closeModal() {
        modalRoot.hidden = true;
        modalRoot.innerHTML = '';
    }

    function openNotificationModal() {
        const unreadCount = notificationState.items.filter((item) => !item.read).length;

        showModal(`
            <header class="dash-modal-header">
                <h2>Notification${unreadCount ? ` (${unreadCount})` : ''}</h2>
                <div class="dash-modal-header-actions">
                    <button type="button" class="dash-header-action" id="mark-all-read-btn">Mark all as read</button>
                    <button type="button" class="dash-close-btn" data-modal-close>&times;</button>
                </div>
            </header>
            <div class="dash-modal-content">
                <div class="dash-notification-list">
                    ${notificationState.items
                        .map(
                            (item) => `
                            <article class="dash-notification-item ${item.read ? 'read' : 'unread'}" data-notification-id="${escapeHtml(item.id)}">
                                <h4>${escapeHtml(item.title)}</h4>
                                <p>${escapeHtml(item.detail)}</p>
                                <small>${escapeHtml(item.time)}</small>
                            </article>
                        `
                        )
                        .join('')}
                </div>
            </div>
        `);

        const markAllBtn = document.getElementById('mark-all-read-btn');
        if (markAllBtn) {
            markAllBtn.addEventListener('click', () => {
                notificationState.items.forEach((item) => {
                    item.read = true;
                });
                openNotificationModal();
                if (window.VetAPI?.markAllNotificationsRead) {
                    window.VetAPI.markAllNotificationsRead();
                }
            });
        }

        modalRoot.querySelectorAll('[data-notification-id]').forEach((element) => {
            element.addEventListener('click', () => {
                const entry = notificationState.items.find((item) => String(item.id) === element.dataset.notificationId);
                if (entry) {
                    entry.read = true;
                    element.classList.remove('unread');
                    element.classList.add('read');
                    if (entry.serverBacked && window.VetAPI?.markNotificationRead) {
                        window.VetAPI.markNotificationRead(entry.id);
                    }
                }
            });
        });
    }

    function openAboutHelpModal() {
        showModal(`
            <header class="dash-modal-header">
                <h2>About Us & Help</h2>
                <button type="button" class="dash-close-btn" data-modal-close>&times;</button>
            </header>
            <div class="dash-modal-content">
                <section class="dash-help-section">
                    <h3>About VBetter</h3>
                    <p>VBetter is a veterinary operations dashboard for appointments, records, vaccination planning, chatbot insights, and lost & found management.</p>
                </section>
                <section class="dash-help-section">
                    <h3>Quick Help</h3>
                    <ul class="dash-help-list">
                        <li>Use <strong>Create Announcement</strong> to publish advisories for pet owners.</li>
                        <li>Use <strong>Manage Announcement</strong> to edit or remove existing posts.</li>
                        <li>Use the sidebar modules to navigate between clinic features.</li>
                    </ul>
                </section>
                <section class="dash-help-section">
                    <h3>Support Contact</h3>
                    <p>Email: support@vbetter.local</p>
                    <p>Hotline: +63 2 8123 4567</p>
                </section>
            </div>
        `);
    }

function openAnnouncementEditorModal({ mode, item }) {
    const isEdit = mode === 'edit';
    const localState = {
        title: item?.title || '',
        description: item?.description || '',
        image: item?.image || '',
        category: item?.category || 'Preventative Care',
        date: item?.date || '',
        location: item?.location || '',
        file: null
    };

    const CATEGORIES = [
        'Preventative Care',
        'Community Advisory',
        'Health & Wellness',
        'Vaccination Drive',
        'Spay & Neuter',
        'Adoption Event',
        'Emergency Notice',
        'General Announcement',
    ];

    const categoryOptions = CATEGORIES.map(cat =>
        `<option value="${escapeHtml(cat)}" ${localState.category === cat ? 'selected' : ''}>${escapeHtml(cat)}</option>`
    ).join('');

    showModal(`
        <header class="dash-modal-header">
            <div class="dash-modal-header-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
            </div>
            <div class="dash-modal-header-text">
                <h2>${isEdit ? 'Edit Announcement' : 'Create Announcement'}</h2>
                <p>${isEdit ? 'Update the details below and save changes.' : 'Fill in the details to post a new clinic announcement.'}</p>
            </div>
            <button type="button" class="dash-close-btn" data-modal-close>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </header>
        <div class="dash-modal-divider"></div>
        <div class="dash-modal-content">
            <div class="dash-field-wrap">
                <label class="dash-field-label" for="announcement-title">Announcement Title</label>
                <input id="announcement-title" class="dash-input" type="text" placeholder="e.g. Free Vaccination Drive this Saturday" value="${escapeHtml(localState.title)}">
            </div>
            <div class="dash-field-wrap">
                <label class="dash-field-label" for="announcement-description">Description</label>
                <textarea id="announcement-description" class="dash-textarea" placeholder="Write a clear and helpful description for pet owners...">${escapeHtml(localState.description)}</textarea>
            </div>
            <div class="dash-form-row">
                <div class="dash-field-wrap">
                    <label class="dash-field-label" for="announcement-category">Category</label>
                    <select id="announcement-category" class="dash-input">
                        ${categoryOptions}
                    </select>
                </div>
                <div class="dash-field-wrap">
                    <label class="dash-field-label" for="announcement-date">Date</label>
                    <input id="announcement-date" class="dash-input" type="date" value="${escapeHtml(localState.date)}">
                </div>
            </div>
            <div class="dash-field-wrap">
                <label class="dash-field-label" for="announcement-location">Location <span>(optional)</span></label>
                <input id="announcement-location" class="dash-input" type="text" placeholder="e.g. Baliwag Veterinary Clinic, Main Branch" value="${escapeHtml(localState.location)}">
            </div>
            <div class="dash-field-wrap">
                <label class="dash-field-label">Cover Image <span>(optional)</span></label>
                <div class="dash-upload-area" id="announcement-upload-box">
                    ${localState.image
                        ? `<img src="${escapeHtml(localState.image)}" alt="Announcement image preview">`
                        : `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                           <span class="dash-upload-area-label">Click to upload a cover image</span>
                           <span class="dash-upload-area-sub">PNG, JPG or GIF — max 5 MB</span>`
                    }
                </div>
                <input type="file" id="announcement-upload-input" accept="image/*" hidden>
            </div>
        </div>
        <div class="dash-modal-footer">
            <button type="button" class="dash-secondary-btn" data-modal-close>Cancel</button>
            <button type="button" class="dash-primary-btn" id="announcement-submit-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                ${isEdit ? 'Save Changes' : 'Post Announcement'}
            </button>
        </div>
    `);

    const titleInput       = document.getElementById('announcement-title');
    const descriptionInput = document.getElementById('announcement-description');
    const categoryInput    = document.getElementById('announcement-category');
    const dateInput        = document.getElementById('announcement-date');
    const locationInput    = document.getElementById('announcement-location');
    const uploadBox        = document.getElementById('announcement-upload-box');
    const uploadInput      = document.getElementById('announcement-upload-input');
    const submitBtn        = document.getElementById('announcement-submit-btn');

    uploadBox?.addEventListener('click', () => uploadInput?.click());

    uploadInput?.addEventListener('change', () => {
        const file = uploadInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            localState.image = String(reader.result);
            localState.file = file;
            if (uploadBox) {
                uploadBox.innerHTML = `<img src="${escapeHtml(localState.image)}" alt="Announcement image preview" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
            }
        };
        reader.readAsDataURL(file);
    });

    submitBtn?.addEventListener('click', () => {
        const title       = titleInput?.value.trim() || '';
        const description = descriptionInput?.value.trim() || '';

        if (!title || !description) {
            showNotification('Please fill in title and description first.', 'error');
            return;
        }

        localState.title       = title;
        localState.description = description;
        localState.category    = categoryInput?.value || '';
        localState.date        = dateInput?.value || '';
        localState.location    = locationInput?.value.trim() || '';

        openAnnouncementPostConfirmModal({
            onConfirm: async () => {
                const session = sessionValue();
                const payload = new FormData();

                if (isEdit && item) payload.append('id', item.id);
                payload.append('title',       localState.title);
                payload.append('description', localState.description);
                payload.append('category',    localState.category);
                payload.append('date',        localState.date);
                payload.append('location',    localState.location);
                payload.append('status',      'published');
                payload.append('role',        session?.role || 'vet');
                if (session?.userId) payload.append('user_id', session.userId);
                if (localState.file) payload.append('image', localState.file);

                const savedResponse = window.VetAPI?.saveAnnouncement
                    ? await window.VetAPI.saveAnnouncement(payload)
                    : { ok: false, error: 'Announcement API is unavailable.' };

                if (!savedResponse.ok) {
                    showNotification(savedResponse.error || 'Announcement could not be saved.', 'error');
                    return;
                }

                if (isEdit && item) {
                    Object.assign(item, savedResponse.data);
                    openAnnouncementResultModal('Announcement Has Been Updated');
                } else {
                    announcementState.items.unshift(savedResponse.data);
                    openAnnouncementResultModal('Announcement Has Been Uploaded');
                }
            }
        });
    });
}

    function openAnnouncementPostConfirmModal({ onConfirm }) {
        showModal(`
            <div class="dash-confirm-box">
                <div class="dash-confirm-icon">🔒</div>
                <h3>Are You sure You Want to<br>Post This announcement?</h3>
                <p>Upon posting the announcement, pet owner can see it in their landing page.</p>
                <button type="button" class="dash-primary-btn" id="confirm-announcement-btn">Yes</button>
                <button type="button" class="dash-text-btn" data-modal-close>No</button>
            </div>
        `, 'dash-modal-mini');

        const confirmBtn = document.getElementById('confirm-announcement-btn');
        confirmBtn?.addEventListener('click', () => onConfirm());
    }

    function openAnnouncementResultModal(title) {
        showModal(`
            <div class="dash-confirm-box">
                <h3>${escapeHtml(title)}</h3>
                <p>You can now manage the announcement in the Manage Announcement tab.</p>
                <button type="button" class="dash-primary-btn" data-modal-close>Close</button>
            </div>
        `, 'dash-modal-mini');
    }

    function openManageAnnouncementModal() {
        showModal(`
            <header class="dash-modal-header">
                <h2>Manage Announcement</h2>
                <button type="button" class="dash-close-btn" data-modal-close>&times;</button>
            </header>
            <div class="dash-modal-content">
                <div class="dash-announcement-list">
                    ${
                        announcementState.items.length
                            ? announcementState.items
                                  .map(
                                      (item) => `
                                <article class="dash-announcement-card">
                                    <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}">
                                    <div class="dash-announcement-copy">
                                        <h4>${escapeHtml(item.title)}</h4>
                                        <p>${escapeHtml(item.description)}</p>
                                        <small>Date: ${escapeHtml(item.date)}</small>
                                    </div>
                                    <div class="dash-announcement-actions">
                                        <button type="button" class="dash-icon-btn" data-edit-id="${escapeHtml(item.id)}" aria-label="Edit announcement">
                                            <img src="/final-VBETTER/bvetter/vet/images/pen.svg" alt="Edit">
                                        </button>
                                        <button type="button" class="dash-icon-btn" data-delete-id="${escapeHtml(item.id)}" aria-label="Delete announcement">
                                            <img src="/final-VBETTER/bvetter/vet/images/trash.svg" alt="Delete">
                                        </button>
                                    </div>
                                </article>
                            `
                                  )
                                  .join('')
                            : '<p class="dash-empty">No announcements yet.</p>'
                    }
                </div>
            </div>
        `);

        modalRoot.querySelectorAll('[data-edit-id]').forEach((button) => {
            button.addEventListener('click', () => {
                // const target = announcementState.items.find((item) => item.id === button.dataset.editId);
                const target = announcementState.items.find((item) => item.id ===  Number(button.dataset.editId));
                console.log('Editing announcement:', announcementState.items);
                console.log('Editing announcement:', button.dataset.editId);
                console.log('Editing announcement:', target);
                if (target) {
                    openAnnouncementEditorModal({ mode: 'edit', item: target });
                }
            });
        });

        modalRoot.querySelectorAll('[data-delete-id]').forEach((button) => {
            button.addEventListener('click', () => {
                openAnnouncementDeleteConfirmModal(button.dataset.deleteId);
            });
        });
    }

    function openAnnouncementDeleteConfirmModal(targetId) {
        showModal(`
            <div class="dash-delete-box">
                <header>
                    <h3>Delete Announcement?</h3>
                    <button type="button" class="dash-close-btn" data-modal-close>&times;</button>
                </header>
                <p>This action is permanent and cannot be undone.</p>
                <div class="dash-delete-actions">
                    <button type="button" class="dash-secondary-btn" data-modal-close>No, Keep</button>
                    <button type="button" class="dash-primary-btn" id="delete-announcement-confirm-btn">Yes, Delete</button>
                </div>
            </div>
        `, 'dash-modal-mini');

        const deleteBtn = document.getElementById('delete-announcement-confirm-btn');
        deleteBtn?.addEventListener('click', async () => {
            const deleted = window.VetAPI?.deleteAnnouncement
                ? await window.VetAPI.deleteAnnouncement(targetId)
                : { ok: false, error: 'Announcement API is unavailable.' };
            if (!deleted.ok) {
                showNotification(deleted.error || 'Announcement could not be deleted.', 'error');
                return;
            }
            announcementState.items = announcementState.items.filter((item) => String(item.id) !== String(targetId));
            openManageAnnouncementModal();
        });
    }

    // ===========================
    // TAB AND FILTER FUNCTIONALITY
    // ===========================
    const dashboardFilterState = {
        patientRange: 'weekly',
        disease: 'All Diseases'
    };

    function updatePatientVolumeChart(rows = []) {
        if (!window.dashboardCharts.patientVolume || !rows.length) return;
        window.dashboardCharts.patientVolume.data.labels = rows.map((item) => item.label);
        window.dashboardCharts.patientVolume.data.datasets[0].data = rows.map((item) => item.value);
        window.dashboardCharts.patientVolume.data.datasets[1].data = rows.map((item) => item.predicted || item.value);
        window.dashboardCharts.patientVolume.update();
    }

    function updateDiseaseChart(rows = []) {
        if (!window.dashboardCharts.disease || !rows.length) return;
        window.dashboardCharts.disease.data.labels = rows.map((item) => item.barangay);
        window.dashboardCharts.disease.data.datasets[0].data = rows.map((item) => item.actual);
        window.dashboardCharts.disease.data.datasets[1].data = rows.map((item) => item.predicted);
        window.dashboardCharts.disease.update();
    }

    async function refreshDashboardCharts() {
        const response = window.VetAPI?.getDashboardSummary
            ? await window.VetAPI.getDashboardSummary({
                patient_range: dashboardFilterState.patientRange,
                disease: dashboardFilterState.disease
            })
            : { ok: false };
        if (!response.ok) return;
        dashboardData = { ...(dashboardData || {}), ...(response.data || {}) };
        updatePatientVolumeChart(dashboardData.patientVolume || []);
        updateDiseaseChart(dashboardData.diseaseCasesByBarangay || []);
    }

    // Patient Volume Filter (Weekly/Monthly)
    const patientVolumeCard = document.querySelector('.card:has(#patientVolumeChart)') || 
                               Array.from(document.querySelectorAll('.card')).find(card => card.querySelector('#patientVolumeChart'));
    
    if (patientVolumeCard) {
        const patientVolumeCardTabs = patientVolumeCard.querySelectorAll('.card-tabs .tab');
        
        patientVolumeCardTabs.forEach((tab) => {
            tab.addEventListener('click', function() {
                console.log('Patient Volume Tab Clicked:', this.textContent);
                
                // Update active state
                patientVolumeCardTabs.forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                
                const filterType = this.textContent.trim();
                
                dashboardFilterState.patientRange = filterType.toLowerCase();
                refreshDashboardCharts();
            });
        });
    }

    // Disease Cases Filter
    const diseaseFilter = document.getElementById('diseaseFilter');
    if (diseaseFilter) {
        diseaseFilter.addEventListener('change', function() {
            dashboardFilterState.disease = this.value;
            refreshDashboardCharts();
        });
    }

    // Fade in cards on load
    const cards = document.querySelectorAll('.card');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.animation = `fadeIn 0.5s ease-in-out ${index * 0.1}s forwards`;
    });

    // KPI cards animation
    const kpiCards = document.querySelectorAll('.kpi-card');
    kpiCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.animation = `slideUp 0.5s ease-in-out ${index * 0.1}s forwards`;
    });

    console.log('Dashboard initialized successfully');
});

// ===========================
// UTILITY FUNCTIONS
// ===========================

/**
 * Format large numbers with commas
 */
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function safeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function toDateKey(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return date.toISOString().slice(0, 10);
}

function formatDateLabel(value, options = { month: 'short', day: 'numeric' }) {
    if (!value) return 'No date';
    const date = new Date(`${toDateKey(value)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-US', options);
}

function buildCalendarEvents(appointments, vaccinationEvents) {
    const appointmentEvents = appointments.map((item) => ({
        title: `${item.service || item.type || 'Appointment'}: ${item.patient || item.pet?.name || 'Patient'}`,
        date: item.preferred_date || toDateKey(item.datetime),
        backgroundColor: item.status === 'completed' ? '#1B6D24' : (item.status === 'confirmed' ? '#004080' : '#737781')
    })).filter((item) => item.date);

    const vaccinationCalendarEvents = vaccinationEvents.map((item) => ({
        title: `${item.vaccine || 'Vaccination'}: ${item.barangay || 'Barangay'}`,
        date: item.date,
        backgroundColor: '#00B928'
    })).filter((item) => item.date);

    return [...appointmentEvents, ...vaccinationCalendarEvents];
}

function buildOperationalNotifications(data, appointments, vaccinationEvents) {
    const notifications = [];
    const pendingCount = data?.kpis?.pendingActions ?? appointments.filter((item) => ['pending', 'confirmed'].includes(item.status)).length;
    const nextEvent = findNextVaccinationEvent(vaccinationEvents);

    if (pendingCount > 0) {
        notifications.push({
            id: 'N-pending-appointments',
            title: 'Pending Appointments',
            detail: `${pendingCount} appointment${pendingCount === 1 ? '' : 's'} need review or completion.`,
            time: 'Live from appointments',
            read: false
        });
    }

    if (nextEvent) {
        notifications.push({
            id: `N-event-${nextEvent.id}`,
            title: 'Upcoming Vaccination Event',
            detail: `${nextEvent.vaccine} at ${nextEvent.barangay} on ${nextEvent.dateLabel || formatDateLabel(nextEvent.date, { month: 'long', day: 'numeric', year: 'numeric' })}.`,
            time: 'Live from events',
            read: false
        });
    }

    if (!notifications.length) {
        notifications.push({
            id: 'N-empty',
            title: 'No Operational Notifications',
            detail: 'No pending appointments or upcoming vaccination events were found.',
            time: 'Just checked',
            read: true
        });
    }

    return notifications;
}

function updateCalendarTitle() {
    const title = document.querySelector('.calendar-header h3');
    if (!title) return;
    title.textContent = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function renderTodayTimeline(appointments) {
    const dateLabel = document.querySelector('.timeline-date');
    const container = document.querySelector('.timeline-container');
    if (!container) return;

    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    if (dateLabel) dateLabel.textContent = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const todaysAppointments = appointments
        .filter((item) => (item.preferred_date || toDateKey(item.datetime)) === todayKey)
        .sort((a, b) => String(a.time_slot || '').localeCompare(String(b.time_slot || '')))
        .slice(0, 4);

    if (!todaysAppointments.length) {
        container.innerHTML = '<div class="timeline-empty">No appointments scheduled for today.</div>';
        return;
    }

    container.innerHTML = todaysAppointments.map((item) => {
        const statusClass = item.status === 'completed' ? 'completed' : (item.status === 'confirmed' ? 'pending' : '');
        return `
            <div class="timeline-item">
                <div class="timeline-marker ${statusClass}"><span class="marker-dot ${statusClass === 'pending' ? 'pending' : ''}"></span></div>
                <div class="timeline-event ${statusClass}">
                    <p class="event-time">${safeHtml(item.time_slot || 'TBD')}</p>
                    <h4 class="event-title">${safeHtml(item.service || item.type || 'Appointment')}: ${safeHtml(item.patient || item.pet?.name || 'Patient')}</h4>
                    <p class="event-location">${safeHtml(item.veterinarian || 'Unassigned vet')}</p>
                </div>
            </div>
        `;
    }).join('');
}

function renderRecentPatientAppointment(appointments) {
    const patientCard = document.querySelector('.patient-card');
    const patientItem = document.querySelector('.patient-item');
    const viewLink = document.querySelector('.patient-header .view-link');
    if (!patientCard || !patientItem) return;

    if (viewLink) viewLink.href = '/final-VBETTER/bvetter/vet/html/appointment.html';

    const sorted = [...appointments].sort((a, b) => {
        const left = new Date(`${a.preferred_date || toDateKey(a.datetime)}T${a.time_slot || '00:00'}`).getTime();
        const right = new Date(`${b.preferred_date || toDateKey(b.datetime)}T${b.time_slot || '00:00'}`).getTime();
        return right - left;
    });
    const latest = sorted[0];

    if (!latest) {
        patientItem.innerHTML = '<p class="dash-empty">No appointment records found.</p>';
        return;
    }

    const pet = latest.pet || {};
    const firstLetter = pet.name?.trim().charAt(0).toUpperCase() || 'P';
    patientItem.innerHTML = `
        <div class="patient-info">
<div class="patient-avatar">${firstLetter}  </div>           
        <div>
                <h4 class="patient-name">${safeHtml(latest.patient || pet.name || 'Patient')}</h4>
                <p class="patient-details">${safeHtml([pet.breed || pet.species, pet.sex, pet.age].filter(Boolean).join(' - ') || latest.owner || 'Appointment patient')}</p>
            </div>
        </div>
        <div class="patient-status">
            <span class="status-badge">${safeHtml(latest.status || 'pending')}</span>
            <p class="patient-date">Adm: ${safeHtml(formatDateLabel(latest.preferred_date || latest.datetime, { month: 'short', day: 'numeric', year: 'numeric' }))}</p>
        </div>
    `;
}

function findNextVaccinationEvent(events) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return [...events]
        .filter((item) => item.date && new Date(`${item.date}T00:00:00`) >= today)
        .sort((a, b) => new Date(`${a.date}T00:00:00`) - new Date(`${b.date}T00:00:00`))[0] || null;
}

function renderNextMajorEvent(events) {
    const card = document.querySelector('.event-card');
    if (!card) return;
    const event = findNextVaccinationEvent(events);
    const title = card.querySelector('.event-title');
    const date = card.querySelector('.event-date');

    if (!event) {
        if (title) title.textContent = 'No Upcoming Vaccination Event';
        if (date) date.textContent = 'Create an event in Mass Vaccination';
        return;
    }

    if (title) title.textContent = `${event.vaccine || 'Vaccination'} - ${event.barangay || 'Barangay'}`;
    if (date) date.textContent = `${event.dateLabel || formatDateLabel(event.date, { month: 'long', day: 'numeric', year: 'numeric' })} - ${event.status || 'Pending Report'}`;
}

function renderChatbotInsights(stats) {
    const list = document.querySelector('.insights-list');
    const note = document.querySelector('.insights-note');
    if (!list) return;

    const labels = stats?.symptomsByPetType?.all?.labels || [];
    const values = stats?.symptomsByPetType?.all?.values || [];
    const total = values.reduce((sum, value) => sum + Number(value || 0), 0);

    if (!labels.length || total <= 0) {
        list.innerHTML = '<p class="dash-empty">No chatbot symptom logs yet.</p>';
        if (note) note.textContent = 'Insight will appear once pet owners use the symptom checker.';
        return;
    }

    list.innerHTML = labels.slice(0, 4).map((label, index) => {
        const count = Number(values[index] || 0);
        const percent = Math.round((count / total) * 100);
        return `
            <div class="insight-item">
                <div class="insight-header">
                    <span class="insight-name">${safeHtml(label)}</span>
                    <span class="insight-percentage">${percent}% of queries</span>
                </div>
                <div class="insight-bar"><div class="insight-bar-fill" style="width: ${percent}%;"></div></div>
            </div>
        `;
    }).join('');

    if (note) note.textContent = `Insight: ${formatNumber(total)} symptom checker log${total === 1 ? '' : 's'} included.`;
}

function applyDashboardKpis(data) {
    if (!data?.kpis) return;
    const values = document.querySelectorAll('.KPI .kpi-value');
    if (values[0]) values[0].textContent = formatNumber(data.kpis.totalAppointments || 0);
    if (values[1]) values[1].textContent = formatNumber(data.kpis.pendingActions || 0);
    if (values[2]) values[2].textContent = String(data.kpis.activeLostReports || 0).padStart(2, '0');
    if (values[3]) values[3].textContent = `${data.kpis.vaccinationRate || 0}%`;

    const progress = document.querySelector('.vaccination-progress .progress-fill');
    if (progress) progress.style.width = `${Math.min(100, data.kpis.vaccinationRate || 0)}%`;

    // Clinic only administers Anti-Rabies, so only the first forecasted
    // demand figure is shown, always labeled "Anti-Rabies".
    const demandCard = document.querySelector('.vaccine-item');
    const demandEntry = (data.vaccineDemand || [])[0];
    if (demandCard && demandEntry) {
        const value = demandCard.querySelector('.vaccine-item-value');
        if (value) value.textContent = formatNumber(demandEntry.units || 0);
    }
}

/**
 * Update KPI values with animation
 */
function updateKPIValue(element, newValue, duration = 1000) {
    const currentValue = parseInt(element.textContent.replace(/,/g, ''));
    const increment = (newValue - currentValue) / (duration / 16);
    let current = currentValue;

    const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= newValue) || (increment < 0 && current <= newValue)) {
            element.textContent = formatNumber(newValue);
            clearInterval(timer);
        } else {
            element.textContent = formatNumber(Math.round(current));
        }
    }, 16);
}

/**
 * Show notification/toast
 */
function showNotification(message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 24px;
        background: ${type === 'success' ? '#1B6D24' : type === 'error' ? '#93000A' : '#002A58'};
        color: white;
        border-radius: 8px;
        z-index: 1000;
        animation: slideIn 0.3s ease-in-out;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in-out';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===========================
// CSS ANIMATIONS
// ===========================

const style = document.createElement('style');
style.textContent = `
    @keyframes fadeIn {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    @keyframes slideUp {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

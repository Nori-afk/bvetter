document.addEventListener('DOMContentLoaded', async function () {
    const [
        dashboardResponse,
        appointmentsResponse,
        vaccinationEventsResponse,
        chatbotStatsResponse,
        announcementsResponse
    ] = await Promise.all([
        window.VetAPI?.getDashboardSummary ? window.VetAPI.getDashboardSummary({ patient_range: 'weekly' }) : { ok: false, data: null },
        window.VetAPI?.getAppointments ? window.VetAPI.getAppointments({}) : { ok: false, data: [] },
        window.VetAPI?.getVaccinationEvents ? window.VetAPI.getVaccinationEvents() : { ok: false, data: [] },
        window.VetAPI?.getChatbotDashboardStats ? window.VetAPI.getChatbotDashboardStats() : { ok: false, data: {} },
        window.VetAPI?.getAnnouncements ? window.VetAPI.getAnnouncements({ status: 'all' }) : { ok: false, data: [] }
    ]);
    let dashboardData = dashboardResponse.ok ? dashboardResponse.data : null;
    const appointments = appointmentsResponse.ok && Array.isArray(appointmentsResponse.data) ? appointmentsResponse.data : [];
    const vaccinationEvents = vaccinationEventsResponse.ok && Array.isArray(vaccinationEventsResponse.data) ? vaccinationEventsResponse.data : [];
    const chatbotStats = chatbotStatsResponse.ok ? chatbotStatsResponse.data : {};
    applyDashboardKpis(dashboardData);
    renderTodayTimeline(appointments);
    renderRecentPatientAppointment(appointments);
    renderNextMajorEvent(vaccinationEvents);
    renderChatbotInsights(chatbotStats);

    const announcementState = {
        items: announcementsResponse.ok && Array.isArray(announcementsResponse.data) ? announcementsResponse.data : []
    };

    const notificationState = {
        items: buildOperationalNotifications(dashboardData, appointments, vaccinationEvents)
    };

    const modalRoot = ensureDashboardModalRoot();

    const calendarEl = document.getElementById('calendar');
    if (calendarEl) {
        const calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            initialDate: new Date().toISOString().slice(0, 10),
            headerToolbar: {
                left: '',
                center: '',
                right: ''
            },
            events: buildCalendarEvents(appointments, vaccinationEvents),
            dayCellDidMount: function(info) {
                // Highlight weekends lightly
                if (info.date.getDay() === 0 || info.date.getDay() === 6) {
                    info.el.style.backgroundColor = '#f9f9f9';
                }
            }
        });
        calendar.render();
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
                        backgroundColor: 'rgba(0, 42, 88, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 4,
                        pointBackgroundColor: '#002A58',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        pointHoverRadius: 6
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
                        backgroundColor: 'rgba(103, 123, 174, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 4,
                        pointBackgroundColor: '#677BAE',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        pointHoverRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            color: '#002A58',
                            font: {
                                size: 12,
                                weight: '600'
                            },
                            padding: 15,
                            usePointStyle: true
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(216.75, 216.75, 255, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#737781'
                        }
                    },
                    x: {
                        grid: {
                            display: false,
                            drawBorder: false
                        },
                        ticks: {
                            color: '#737781'
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
                        label: 'Number Of Cases',
                        data: (dashboardData?.diseaseCasesByBarangay?.length ? dashboardData.diseaseCasesByBarangay : [
                            { actual: 5 },
                            { actual: 2 },
                            { actual: 4 },
                            { actual: 10 }
                        ]).map((item) => item.actual),
                        borderColor: '#002A58',
                        backgroundColor: 'rgba(255, 146, 138, 0.15)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 4,
                        pointBackgroundColor: '#002A58',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        pointHoverRadius: 6
                    },
                    {
                        label: 'Predictive Cases',
                        data: (dashboardData?.diseaseCasesByBarangay?.length ? dashboardData.diseaseCasesByBarangay : [
                            { predicted: 7 },
                            { predicted: 3 },
                            { predicted: 5 },
                            { predicted: 8 }
                        ]).map((item) => item.predicted),
                        borderColor: '#677BAE',
                        backgroundColor: 'rgba(137.05, 121.10, 255, 0.15)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 4,
                        pointBackgroundColor: '#677BAE',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        pointHoverRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#002A58',
                            font: {
                                size: 12,
                                weight: '600'
                            },
                            padding: 15,
                            usePointStyle: true
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(216.75, 216.75, 255, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#737781',
                            stepSize: 2
                        }
                    },
                    x: {
                        grid: {
                            display: false,
                            drawBorder: false
                        },
                        ticks: {
                            color: '#737781',
                            font: {
                                size: 10
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
                labels: ['Rabies', 'Parvo'],
                datasets: [
                    {
                        data: [
                            dashboardData?.vaccinated?.dogs || 60,
                            dashboardData?.vaccinated?.cats || 40
                        ],
                        backgroundColor: [
                            '#1B6D24',
                            '#E2E2E8'
                        ],
                        borderColor: '#fff',
                        borderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        enabled: false
                    }
                },
                cutout: '70%'
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

    // Search functionality
    const searchInput = document.querySelector('.searchField input');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            console.log('Searching for:', e.target.value);
            // Add search functionality here
        });
    }


 

    // Add appointment button
    const addAppointmentBtn = document.querySelector('.btn-add-appointment');
    if (addAppointmentBtn) {
        addAppointmentBtn.addEventListener('click', function() {
            window.location.href = '/Final-Backend/vet/html/appointment.html';
        });
    }

    // Manage event button
    const manageEventBtn = document.querySelector('.btn-manage-event');
    if (manageEventBtn) {
        manageEventBtn.addEventListener('click', function() {
            window.location.href = '/Final-Backend/vet/html/mass-vaccination.html';
        });
    }

    document.querySelectorAll('.icon-btn[aria-label="Settings"]').forEach((button) => {
        button.addEventListener('click', () => {
            window.location.href = '/Final-Backend/public/pages/account-settings.html';
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
            });
        }

        modalRoot.querySelectorAll('[data-notification-id]').forEach((element) => {
            element.addEventListener('click', () => {
                const entry = notificationState.items.find((item) => item.id === element.dataset.notificationId);
                if (entry) {
                    entry.read = true;
                    element.classList.remove('unread');
                    element.classList.add('read');
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
            <h2>${isEdit ? 'Edit Announcement' : 'Create Announcement'}</h2>
            <button type="button" class="dash-close-btn" data-modal-close>&times;</button>
        </header>
        <div class="dash-modal-content">
            <label class="dash-field-wrap">
                <input id="announcement-title" class="dash-input" type="text" placeholder="Title Of Announcement" value="${escapeHtml(localState.title)}">
            </label>
            <label class="dash-field-wrap">
                <textarea id="announcement-description" class="dash-textarea" placeholder="Description">${escapeHtml(localState.description)}</textarea>
            </label>
            <label class="dash-field-wrap">
                <select id="announcement-category" class="dash-input">
                    ${categoryOptions}
                </select>
            </label>
            <label class="dash-field-wrap">
                <input id="announcement-date" class="dash-input" type="date" value="${escapeHtml(localState.date)}">
            </label>
            <label class="dash-field-wrap">
                <input id="announcement-location" class="dash-input" type="text" placeholder="Location (optional)" value="${escapeHtml(localState.location)}">
            </label>
            <div class="dash-upload-box" id="announcement-upload-box">
                ${localState.image ? `<img src="${escapeHtml(localState.image)}" alt="Announcement image preview">` : '<span>Add To Your Post</span>'}
            </div>
            <div class="dash-upload-actions">
                <button type="button" class="dash-upload-btn" id="announcement-upload-trigger">Add To Your Post</button>
                <input type="file" id="announcement-upload-input" accept="image/*" hidden>
            </div>
            <button type="button" class="dash-primary-btn" id="announcement-submit-btn">${isEdit ? 'Update' : 'Post'}</button>
        </div>
    `);

    const titleInput       = document.getElementById('announcement-title');
    const descriptionInput = document.getElementById('announcement-description');
    const categoryInput    = document.getElementById('announcement-category');
    const dateInput        = document.getElementById('announcement-date');
    const locationInput    = document.getElementById('announcement-location');
    const uploadTrigger    = document.getElementById('announcement-upload-trigger');
    const uploadInput      = document.getElementById('announcement-upload-input');
    const uploadBox        = document.getElementById('announcement-upload-box');
    const submitBtn        = document.getElementById('announcement-submit-btn');

    uploadTrigger?.addEventListener('click', () => uploadInput?.click());

    uploadInput?.addEventListener('change', () => {
        const file = uploadInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            localState.image = String(reader.result);
            localState.file = file;
            if (uploadBox) {
                uploadBox.innerHTML = `<img src="${escapeHtml(localState.image)}" alt="Announcement image preview">`;
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
                                            <img src="/vet/images/pen.svg" alt="Edit">
                                        </button>
                                        <button type="button" class="dash-icon-btn" data-delete-id="${escapeHtml(item.id)}" aria-label="Delete announcement">
                                            <img src="/vet/images/trash.svg" alt="Delete">
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

    // Disease Cases Filter (All/Disease type)
    const diseaseCard = document.querySelector('.card:has(#diseaseChart)') || 
                        Array.from(document.querySelectorAll('.card')).find(card => card.querySelector('#diseaseChart'));
    
    if (diseaseCard) {
        const diseaseDropdownBtn = diseaseCard.querySelector('.dropdown-btn');
        
        if (diseaseDropdownBtn) {
            diseaseDropdownBtn.addEventListener('click', function(e) {
                console.log('Disease Filter Clicked');
                
                const diseases = ['All Diseases', 'Canine Parvovirus', 'Canine Distemper', 'Rabies (Suspected)', 'Leptospirosis'];
                const currentFilter = this.textContent.trim();
                const currentIndex = diseases.indexOf(currentFilter);
                const nextDisease = diseases[((currentIndex >= 0 ? currentIndex : 0) + 1) % diseases.length];
                
                this.textContent = nextDisease;
                dashboardFilterState.disease = nextDisease;
                refreshDashboardCharts();
            });
        }
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

    if (viewLink) viewLink.href = '/Final-Backend/vet/html/appointment.html';

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

    const demandItems = document.querySelectorAll('.vaccine-item');
    (data.vaccineDemand || []).forEach((item, index) => {
        const card = demandItems[index];
        if (!card) return;
        const label = card.querySelector('.vaccine-item-label');
        const value = card.querySelector('.vaccine-item-value');
        if (label) label.textContent = item.label;
        if (value) value.textContent = formatNumber(item.units || 0);
    });
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

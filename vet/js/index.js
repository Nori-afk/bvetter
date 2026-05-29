document.addEventListener('DOMContentLoaded', async function () {
    const dashboardResponse = window.VetAPI?.getDashboardSummary
        ? await window.VetAPI.getDashboardSummary()
        : { ok: false, data: null };
    const dashboardData = dashboardResponse.ok ? dashboardResponse.data : null;
    applyDashboardKpis(dashboardData);

    const announcementState = {
        items: [
            {
                id: `ANN-${Date.now()}`,
                title: 'Vaccine Event 1',
                description: 'Will be in Feb 29, 2025 at barangay tangos',
                date: '02/29/2025',
                image: '/vet/images/Icon.png'
            }
        ]
    };

    const notificationState = {
        items: [
            { id: 'N-1', title: 'New Announcement Posted', detail: 'Vaccine Event 1 is now visible to pet owners.', time: 'Just now', read: false },
            { id: 'N-2', title: 'Pending Appointment Spike', detail: 'Pending queue is up by 12% compared to yesterday.', time: '12 mins ago', read: false },
            { id: 'N-3', title: 'Reminder', detail: 'Mass vaccination planning window starts tomorrow.', time: '1 hour ago', read: true }
        ]
    };

    const modalRoot = ensureDashboardModalRoot();

    const calendarEl = document.getElementById('calendar');
    if (calendarEl) {
        const calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            initialDate: '2026-04-24',
            headerToolbar: {
                left: '',
                center: '',
                right: ''
            },
            events: [
                { title: 'Deworming: Cooper', date: '2026-04-24', backgroundColor: '#1B6D24' },
                { title: 'Vaccination: Buddy', date: '2026-04-25', backgroundColor: '#004080' },
                { title: 'Consultation: Felix', date: '2026-04-28', backgroundColor: '#999' }
            ],
            dayCellDidMount: function(info) {
                // Highlight weekends lightly
                if (info.date.getDay() === 0 || info.date.getDay() === 6) {
                    info.el.style.backgroundColor = '#f9f9f9';
                }
            }
        });
        calendar.render();
    }

    const patientVolumeCtx = document.getElementById('patientVolumeChart');
    if (patientVolumeCtx) {
        new Chart(patientVolumeCtx, {
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
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
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
        new Chart(diseaseCtx, {
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
            alert('Add appointment functionality will be implemented here');
        });
    }

    // Manage event button
    const manageEventBtn = document.querySelector('.btn-manage-event');
    if (manageEventBtn) {
        manageEventBtn.addEventListener('click', function() {
            alert('Manage event functionality will be implemented here');
        });
    }

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
            image: item?.image || ''
        };

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

        const titleInput = document.getElementById('announcement-title');
        const descriptionInput = document.getElementById('announcement-description');
        const uploadTrigger = document.getElementById('announcement-upload-trigger');
        const uploadInput = document.getElementById('announcement-upload-input');
        const uploadBox = document.getElementById('announcement-upload-box');
        const submitBtn = document.getElementById('announcement-submit-btn');

        uploadTrigger?.addEventListener('click', () => uploadInput?.click());

        uploadInput?.addEventListener('change', () => {
            const file = uploadInput.files?.[0];
            if (!file) {
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                localState.image = String(reader.result);
                if (uploadBox) {
                    uploadBox.innerHTML = `<img src="${escapeHtml(localState.image)}" alt="Announcement image preview">`;
                }
            };
            reader.readAsDataURL(file);
        });

        submitBtn?.addEventListener('click', () => {
            const title = titleInput?.value.trim() || '';
            const description = descriptionInput?.value.trim() || '';
            if (!title || !description) {
                showNotification('Please fill in title and description first.', 'error');
                return;
            }

            localState.title = title;
            localState.description = description;

            openAnnouncementPostConfirmModal({
                onConfirm: () => {
                    if (isEdit && item) {
                        item.title = localState.title;
                        item.description = localState.description;
                        item.image = localState.image || item.image;
                        openAnnouncementResultModal('Announcement Has Been Updated');
                    } else {
                        announcementState.items.unshift({
                            id: `ANN-${Date.now()}`,
                            title: localState.title,
                            description: localState.description,
                            date: new Date().toLocaleDateString('en-US'),
                            image: localState.image || '/vet/images/Icon.png'
                        });
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
                const target = announcementState.items.find((item) => item.id === button.dataset.editId);
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
        deleteBtn?.addEventListener('click', () => {
            announcementState.items = announcementState.items.filter((item) => item.id !== targetId);
            openManageAnnouncementModal();
        });
    }

    // ===========================
    // ANIMATIONS
    // ===========================

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

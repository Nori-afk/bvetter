/* Category glyph (light, thin-stroke, currentColor) + status color mapping —
   same icon set/logic as the public and admin notification bells, so all
   three read as one system. Color signals status; the glyph signals category. */
const NOTIF_ICONS = {
    appointment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8.5 15.5l2 2 4-4"/></svg>',
    lostfound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6"/><line x1="20" y1="20" x2="14.5" y2="14.5"/></svg>',
    vaccination: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
    general: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
};

function notifCategoryFromItem(item) {
    if (item.type === 'appointment_new' || item.type === 'appointment_status') return 'appointment';
    if (item.type === 'lost_found_new') return 'lostfound';
    if (item.type === 'csp_registration') return 'vaccination';
    if (typeof item.id === 'string' && item.id.indexOf('N-event-') === 0) return 'vaccination';
    if (typeof item.id === 'string' && item.id.indexOf('N-pending-appointments') === 0) return 'appointment';
    return 'general';
}

function notifStatusFromTitle(title) {
    const t = (title || '').toLowerCase();
    if (t.includes('reject') || t.includes('cancel')) return 'negative';
    if (t.includes('confirmed') || t.includes('approve') || t.includes('resolve') || t.includes('upcoming')) return 'positive';
    return 'neutral';
}

function getNotifDotElements() {
    return Array.from(document.querySelectorAll('.notif-dot'));
}

function syncNotifDot(notificationState) {
    const unreadCount = notificationState.items.filter((item) => !item.read).length;
    getNotifDotElements().forEach((dot) => { dot.hidden = unreadCount <= 0; });
}

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
    // Carried to the charts so a failed load can say what went wrong instead of
    // quietly rendering invented numbers in place of the real ones.
    const dashboardError = dashboardResponse.ok
        ? ''
        : (dashboardResponse.error || 'The dashboard service did not respond.');
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

    // Every notification is a database row now. The old feed mixed these with
    // synthetic "operational" items built from the dashboard KPIs ("N
    // appointments need review"), which were regenerated unread on every page
    // load — so marking them read could never stick, and the bell dot came
    // back after every refresh. Those were rolling counts, not events; the
    // pending-appointment figure already lives on the KPI card, where it stays
    // accurate instead of going stale the moment a vet handles one.
    const notificationState = {
        items: staffNotifications.map((item) => ({
            id: item.id,
            title: item.title,
            detail: item.message,
            time: new Date(item.created_at).toLocaleString(),
            read: item.is_read,
            type: item.type
        }))
    };

    syncNotifDot(notificationState);
    const NOTIF_PAGE_SIZE = 5;
    let notifExpanded = false;

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

    // Declared before the charts are built because the disease chart's forecast
    // is fetched as soon as it renders, and needs to know which disease was
    // selected in order to discard its own response if the dropdown has moved
    // on by the time it arrives.
    const dashboardFilterState = {
        patientRange: 'weekly',
        disease: 'All Diseases'
    };

    /* A chart whose data didn't load is replaced outright rather than drawn
       empty — an empty Chart.js canvas looks like a real chart reporting zero,
       which is a claim about the data we're in no position to make. */
    function showChartUnavailable(canvasId, reason) {
        const canvas = document.getElementById(canvasId);
        const container = canvas ? canvas.closest('.chart-container') : null;
        if (!canvas || !container) return;
        canvas.hidden = true;
        const panel = document.createElement('div');
        panel.className = 'chart-unavailable';
        panel.innerHTML = `<strong>Couldn't load this data</strong><span>${safeHtml(reason)}</span>`;
        container.appendChild(panel);
    }

    const patientVolumeCtx = document.getElementById('patientVolumeChart');
    const patientVolumeRows = dashboardData?.patientVolume || [];
    if (patientVolumeCtx && !patientVolumeRows.length) {
        // The API returns a continuous run of periods, zero-filled where there
        // were no visits, so an empty array means the request failed rather
        // than that the clinic saw nobody.
        showChartUnavailable('patientVolumeChart', dashboardError || 'No patient volume data was returned.');
    } else if (patientVolumeCtx) {
        window.dashboardCharts.patientVolume = new Chart(patientVolumeCtx, {
            type: 'line',
            data: {
                labels: patientVolumeRows.map((item) => item.label),
                datasets: [
                    {
                        label: 'Patient Volume',
                        data: patientVolumeRows.map((item) => item.value),
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
    const diseaseRows = dashboardData?.diseaseCasesByBarangay || [];
    if (diseaseCtx && !diseaseRows.length) {
        showChartUnavailable('diseaseChart', dashboardError || 'No disease cases were returned for this period.');
    } else if (diseaseCtx) {
        // Only Confirmed Cases is drawn here. The Predicted Cases dataset is
        // appended later by refreshDiseaseForecast(), once the analytics
        // service has answered — see the comment on that function.
        window.dashboardCharts.disease = new Chart(diseaseCtx, {
            type: 'line',
            data: {
                labels: diseaseRows.map((item) => item.barangay),
                datasets: [
                    {
                        label: 'Confirmed Cases',
                        data: diseaseRows.map((item) => item.actual),
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
        refreshDiseaseForecast();
    }


    const vaccinatedCtx = document.getElementById('vaccinatedChart');
    const vaccinated = dashboardData?.vaccinated || null;
    // The fiscal year travels with the figure now. The caption was the literal
    // string 'Total FY24' while the number inside the ring was the latest
    // dataset year's, so the label named a year the data never came from.
    const vaccinatedCaption = vaccinated?.year ? `Total FY${vaccinated.year}` : 'Total';
    if (vaccinatedCtx && !vaccinated) {
        showChartUnavailable('vaccinatedChart', dashboardError || 'Vaccination totals were not returned.');
    } else if (vaccinatedCtx) {
        new Chart(vaccinatedCtx, {
            type: 'doughnut',
            data: {
                labels: ['Dogs', 'Cats'],
                datasets: [
                    {
                        data: [
                            Number(vaccinated.dogs) || 0,
                            Number(vaccinated.cats) || 0
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
                    ctx.fillText(formatNumber(Number(vaccinated.total) || 0), centerX, centerY - fontSize * 5);

                    // Draw label
                    ctx.font = `${fontSize * 12}px Manrope, sans-serif`;
                    ctx.fillStyle = '#737781';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(vaccinatedCaption, centerX, centerY + fontSize * 24);
                   
                    
                    ctx.restore();
                }
            }]
        });
    }

    const vaccinationTrendCtx = document.getElementById('vaccinationTrendChart');
    const trend = dashboardData?.vaccinationTrend || [];
    if (vaccinationTrendCtx && !trend.length) {
        showChartUnavailable('vaccinationTrendChart', dashboardError || 'No vaccination history was returned.');
    } else if (vaccinationTrendCtx) {
        new Chart(vaccinationTrendCtx, {
            type: 'bar',
            data: {
                labels: trend.map((item) => item.label),
                datasets: [
                    {
                        label: 'Animals Vaccinated',
                        data: trend.map((item) => item.value),
                        backgroundColor: '#1B6D24',
                        borderRadius: 6,
                        maxBarThickness: 28
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            // Axis labels are bare month names, and a 12-month
                            // window spans two calendar years — the tooltip is
                            // where "Jun" gets told apart from "Jun".
                            title(items) {
                                const row = trend[items[0]?.dataIndex ?? 0];
                                if (!row?.period) return items[0]?.label ?? '';
                                const [year, month] = String(row.period).split('-');
                                return new Date(Number(year), Number(month) - 1, 1)
                                    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                            }
                        }
                    }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } }
                }
            }
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
        const greetingEl = document.getElementById('greeting-name');
        if (!nameEl && !dateEl && !avatarEl && !greetingEl) return;

        let session = null;
        try {
            if (window.VBetterAuth && window.VBetterAuth.getSession) {
                session = window.VBetterAuth.getSession();
            } else {
                const raw = localStorage.getItem('vbetter_session');
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
        if (greetingEl) {
            const titleCased = titleCaseName(name);
            greetingEl.textContent = `Good Day, Dr. ${titleCased}!`;
        }
    })();


 

    // Add appointment button
    const addAppointmentBtn = document.querySelector('.btn-add-appointment');
    if (addAppointmentBtn) {
        addAppointmentBtn.addEventListener('click', function() {
            window.location.href = '../../vet/html/appointment.html';
        });
    }

    // Manage event button
    const manageEventBtn = document.querySelector('.btn-manage-event');
    if (manageEventBtn) {
        manageEventBtn.addEventListener('click', function() {
            window.location.href = '../../vet/html/mass-vaccination.html';
        });
    }

    document.querySelectorAll('.icon-btn[aria-label="Settings"]').forEach((button) => {
        button.addEventListener('click', () => {
            window.location.href = '../../public/pages/account-settings.html';
        });
    });

    const notificationBtn = document.getElementById('notification-icon-btn');
    if (notificationBtn) {
        notificationBtn.addEventListener('click', function () {
            notifExpanded = false;
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
        const visibleItems = notifExpanded ? notificationState.items : notificationState.items.slice(0, NOTIF_PAGE_SIZE);
        const remaining = notificationState.items.length - visibleItems.length;

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
                    ${visibleItems
                        .map(
                            (item) => `
                            <article class="dash-notification-item ${item.read ? 'read' : 'unread'}" data-notification-id="${escapeHtml(item.id)}">
                                <div class="notif-badge notif-badge--${notifStatusFromTitle(item.title)}">${NOTIF_ICONS[notifCategoryFromItem(item)]}</div>
                                <div class="dash-notification-item-body">
                                    <h4>${escapeHtml(item.title)}</h4>
                                    <p>${escapeHtml(item.detail)}</p>
                                    <small>${escapeHtml(item.time)}</small>
                                </div>
                            </article>
                        `
                        )
                        .join('')}
                    ${remaining > 0 ? `<button type="button" class="notif-show-more-btn" id="notif-show-more-btn">Show ${remaining} more</button>` : ''}
                </div>
            </div>
        `);

        const markAllBtn = document.getElementById('mark-all-read-btn');
        if (markAllBtn) {
            markAllBtn.addEventListener('click', async () => {
                // Fired and forgotten before, so a failed write was invisible
                // until the dot came back on the next page load. Confirm the
                // server accepted it before showing everything as read.
                if (window.VetAPI?.markAllNotificationsRead) {
                    const result = await window.VetAPI.markAllNotificationsRead().catch(() => null);
                    if (!result || !result.ok) {
                        showNotification('Could not mark notifications as read. Please try again.', 'error');
                        return;
                    }
                }
                notificationState.items.forEach((item) => {
                    item.read = true;
                });
                syncNotifDot(notificationState);
                openNotificationModal();
            });
        }

        const showMoreBtn = document.getElementById('notif-show-more-btn');
        if (showMoreBtn) {
            showMoreBtn.addEventListener('click', () => {
                notifExpanded = true;
                openNotificationModal();
            });
        }

        modalRoot.querySelectorAll('[data-notification-id]').forEach((element) => {
            element.addEventListener('click', async () => {
                const entry = notificationState.items.find((item) => String(item.id) === element.dataset.notificationId);
                if (!entry) return;

                entry.read = true;
                element.classList.remove('unread');
                element.classList.add('read');
                syncNotifDot(notificationState);

                if (window.VetAPI?.markNotificationRead) {
                    const result = await window.VetAPI.markNotificationRead(entry.id).catch(() => null);
                    if (!result || !result.ok) {
                        entry.read = false;
                        element.classList.remove('read');
                        element.classList.add('unread');
                        syncNotifDot(notificationState);
                        showNotification('Could not mark that notification as read.', 'error');
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
                    <h3>About BVetter</h3>
                    <p>BVetter is a veterinary operations dashboard for appointments, records, vaccination planning, chatbot insights, and lost & found management.</p>
                </section>
                <section class="dash-help-section">
                    <h3>Quick Help</h3>
                    <ul class="dash-help-list">
                        <li>Use <strong>Create Announcement</strong> to publish advisories for pet owners.</li>
                        <li>Use <strong>Manage Announcements</strong> to edit or remove existing posts.</li>
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

    /* Shared bits for the announcement modals so the create/edit sheet and the
       manage list read as the same feature instead of two different screens. */
    const ANNOUNCEMENT_CATEGORIES = [
        'Preventative Care',
        'Community Advisory',
        'Health & Wellness',
        'Vaccination Drive',
        'Spay & Neuter',
        'Adoption Event',
        'Emergency Notice',
        'General Announcement',
    ];

    const ANNOUNCEMENT_MAX_IMAGE_MB = 5;

    const ICON_MEGAPHONE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16 9a3 3 0 0 1 0 6"/><path d="M19 6.5a7 7 0 0 1 0 11"/></svg>';
    const ICON_PENCIL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    const ICON_TRASH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
    const ICON_IMAGE_PLACEHOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    const ICON_CALENDAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
    const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>';

    function announcementModalHeader({ title, subtitle, actions = '' }) {
        return `
            <header class="dash-modal-header">
                <div class="dash-modal-header-icon">${ICON_MEGAPHONE}</div>
                <div class="dash-modal-header-text">
                    <h2>${escapeHtml(title)}</h2>
                    <p>${escapeHtml(subtitle)}</p>
                </div>
                <div class="dash-modal-header-actions">
                    ${actions}
                    <button type="button" class="dash-close-btn" data-modal-close aria-label="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </header>
            <div class="dash-modal-divider"></div>
        `;
    }

    /* Images come back from the API as '/storage/announcements/...'. A row can
       also carry no image at all, and older rows can point at a file that is
       gone -- both used to render as the browser's broken-image glyph with the
       alt text sprawling across the card. Every thumbnail is now a placeholder
       with the picture layered on top, and a failed load just drops the <img>. */
    function announcementThumb(image, alt) {
        return `
            <div class="dash-announcement-thumb">
                <span class="dash-announcement-thumb-ph">${ICON_IMAGE_PLACEHOLDER}</span>
                ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(alt)}" data-announcement-thumb>` : ''}
            </div>
        `;
    }

function openAnnouncementEditorModal({ mode, item, fromManage = false }) {
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

    const categoryOptions = ANNOUNCEMENT_CATEGORIES.map(cat =>
        `<option value="${escapeHtml(cat)}" ${localState.category === cat ? 'selected' : ''}>${escapeHtml(cat)}</option>`
    ).join('');

    function uploadMarkup(image) {
        if (image) {
            return `
                <img class="dash-upload-preview" src="${escapeHtml(image)}" alt="Announcement image preview">
                <div class="dash-upload-overlay">
                    <span class="dash-upload-overlay-label">Click to replace</span>
                    <button type="button" class="dash-upload-remove" id="announcement-image-remove">Remove</button>
                </div>
            `;
        }
        return `
            <span class="dash-upload-icon">${ICON_IMAGE_PLACEHOLDER}</span>
            <span class="dash-upload-area-label">Click to upload a cover image</span>
            <span class="dash-upload-area-sub">JPG, PNG or WEBP &mdash; max ${ANNOUNCEMENT_MAX_IMAGE_MB} MB</span>
        `;
    }

    showModal(`
        ${announcementModalHeader({
            title: isEdit ? 'Edit Announcement' : 'Create Announcement',
            subtitle: isEdit
                ? 'Update the details below and save your changes.'
                : 'Fill in the details to post a new clinic announcement.'
        })}
        <div class="dash-modal-content">
            <div class="dash-field-wrap">
                <label class="dash-field-label" for="announcement-title">Announcement Title <em class="dash-required">*</em></label>
                <input id="announcement-title" class="dash-input" type="text" maxlength="180" placeholder="e.g. Free Vaccination Drive this Saturday" value="${escapeHtml(localState.title)}">
            </div>
            <div class="dash-field-wrap">
                <div class="dash-field-labelrow">
                    <label class="dash-field-label" for="announcement-description">Description <em class="dash-required">*</em></label>
                    <span class="dash-field-count" id="announcement-desc-count"></span>
                </div>
                <textarea id="announcement-description" class="dash-textarea" maxlength="5000" placeholder="Write a clear and helpful description for pet owners...">${escapeHtml(localState.description)}</textarea>
            </div>
            <div class="dash-form-row">
                <div class="dash-field-wrap">
                    <label class="dash-field-label" for="announcement-category">Category</label>
                    <div class="dash-select-wrap">
                        <select id="announcement-category" class="dash-input dash-select">
                            ${categoryOptions}
                        </select>
                        <svg class="dash-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </div>
                </div>
                <div class="dash-field-wrap">
                    <label class="dash-field-label" for="announcement-date">Date</label>
                    <input id="announcement-date" class="dash-input" type="date" min="${announcementDateFloor(localState.date)}" max="${oneYearAheadIso()}" value="${escapeHtml(localState.date)}">
                </div>
            </div>
            <div class="dash-field-wrap">
                <label class="dash-field-label" for="announcement-location">Location <span>(optional)</span></label>
                <input id="announcement-location" class="dash-input" type="text" maxlength="180" placeholder="e.g. Baliwag Veterinary Clinic, Main Branch" value="${escapeHtml(localState.location)}">
            </div>
            <div class="dash-field-wrap">
                <label class="dash-field-label">Cover Image <span>(optional)</span></label>
                <div class="dash-upload-area ${localState.image ? 'has-image' : ''}" id="announcement-upload-box" role="button" tabindex="0">
                    ${uploadMarkup(localState.image)}
                </div>
                <input type="file" id="announcement-upload-input" accept="image/jpeg,image/png,image/webp" hidden>
            </div>
        </div>
        <div class="dash-modal-footer">
            <button type="button" class="dash-secondary-btn" id="announcement-cancel-btn">${fromManage ? 'Back' : 'Cancel'}</button>
            <button type="button" class="dash-primary-btn" id="announcement-submit-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                ${isEdit ? 'Save Changes' : 'Post Announcement'}
            </button>
        </div>
    `);

    const titleInput       = document.getElementById('announcement-title');
    const descriptionInput = document.getElementById('announcement-description');
    const descriptionCount = document.getElementById('announcement-desc-count');
    const categoryInput    = document.getElementById('announcement-category');
    const dateInput        = document.getElementById('announcement-date');
    const locationInput    = document.getElementById('announcement-location');
    const uploadBox        = document.getElementById('announcement-upload-box');
    const uploadInput      = document.getElementById('announcement-upload-input');
    const submitBtn        = document.getElementById('announcement-submit-btn');
    const cancelBtn        = document.getElementById('announcement-cancel-btn');

    // Opened from the manage list, "Back" should return to that list rather
    // than dumping the vet back on the dashboard.
    cancelBtn?.addEventListener('click', () => {
        if (fromManage) openManageAnnouncementModal();
        else closeModal();
    });

    function syncDescriptionCount() {
        if (!descriptionCount || !descriptionInput) return;
        descriptionCount.textContent = `${descriptionInput.value.length} / 5000`;
    }
    descriptionInput?.addEventListener('input', syncDescriptionCount);
    syncDescriptionCount();

    function bindRemoveButton() {
        const removeBtn = document.getElementById('announcement-image-remove');
        removeBtn?.addEventListener('click', (event) => {
            // The whole box is the file picker, so the remove button has to
            // stop the click before it re-opens the dialog it just dismissed.
            event.stopPropagation();
            localState.image = '';
            localState.file = null;
            if (uploadInput) uploadInput.value = '';
            paintUploadBox();
        });
    }

    function paintUploadBox() {
        if (!uploadBox) return;
        uploadBox.classList.toggle('has-image', Boolean(localState.image));
        uploadBox.innerHTML = uploadMarkup(localState.image);
        bindRemoveButton();
    }

    bindRemoveButton();

    uploadBox?.addEventListener('click', () => uploadInput?.click());
    uploadBox?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            uploadInput?.click();
        }
    });

    uploadInput?.addEventListener('change', () => {
        const file = uploadInput.files?.[0];
        if (!file) return;

        // The copy has always promised a size ceiling and a file-type list; the
        // server only checked the type, so a bad pick failed late and vaguely.
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
            showNotification('Cover image must be a JPG, PNG or WEBP file.', 'error');
            uploadInput.value = '';
            return;
        }
        if (file.size > ANNOUNCEMENT_MAX_IMAGE_MB * 1024 * 1024) {
            showNotification(`Cover image must be ${ANNOUNCEMENT_MAX_IMAGE_MB} MB or smaller.`, 'error');
            uploadInput.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            localState.image = String(reader.result);
            localState.file = file;
            paintUploadBox();
        };
        reader.readAsDataURL(file);
    });

    submitBtn?.addEventListener('click', () => {
        const title       = titleInput?.value.trim() || '';
        const description = descriptionInput?.value.trim() || '';

        if (!title || !description) {
            showNotification('Please fill in title and description first.', 'error');
            (title ? descriptionInput : titleInput)?.focus();
            return;
        }

        localState.title       = title;
        localState.description = description;
        localState.category    = categoryInput?.value || '';
        localState.date        = dateInput?.value || '';
        localState.location    = locationInput?.value.trim() || '';

        openAnnouncementPostConfirmModal({
            isEdit,
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
                    openAnnouncementResultModal('Announcement Has Been Posted');
                }
            }
        });
    });
}

    function openAnnouncementPostConfirmModal({ onConfirm, isEdit = false }) {
        showModal(`
            <div class="dash-confirm-box">
                <div class="dash-confirm-icon">${ICON_MEGAPHONE}</div>
                <h3>${isEdit ? 'Save changes to this announcement?' : 'Post this announcement?'}</h3>
                <p>Once posted, pet owners will see it on their landing page.</p>
                <div class="dash-confirm-actions">
                    <button type="button" class="dash-secondary-btn" data-modal-close>No, go back</button>
                    <button type="button" class="dash-primary-btn" id="confirm-announcement-btn">${isEdit ? 'Yes, save' : 'Yes, post it'}</button>
                </div>
            </div>
        `, 'dash-modal-mini');

        const confirmBtn = document.getElementById('confirm-announcement-btn');
        confirmBtn?.addEventListener('click', () => onConfirm());
    }

    function openAnnouncementResultModal(title) {
        showModal(`
            <div class="dash-confirm-box">
                <div class="dash-confirm-icon dash-confirm-icon--success">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <h3>${escapeHtml(title)}</h3>
                <p>You can edit or remove it any time from Manage Announcements.</p>
                <div class="dash-confirm-actions">
                    <button type="button" class="dash-secondary-btn" data-modal-close>Close</button>
                    <button type="button" class="dash-primary-btn" id="result-manage-btn">Manage Announcements</button>
                </div>
            </div>
        `, 'dash-modal-mini');

        document.getElementById('result-manage-btn')
            ?.addEventListener('click', () => openManageAnnouncementModal());
    }

    function announcementCardMarkup(item) {
        const dateLabel = item.date
            ? formatDateLabel(item.date, { month: 'short', day: 'numeric', year: 'numeric' })
            : 'No date set';
        const status = String(item.status || 'published');

        return `
            <article class="dash-announcement-card">
                ${announcementThumb(item.image, item.title || 'Announcement')}
                <div class="dash-announcement-copy">
                    <div class="dash-announcement-tags">
                        ${item.category ? `<span class="dash-announcement-chip">${escapeHtml(item.category)}</span>` : ''}
                        ${status !== 'published' ? `<span class="dash-announcement-chip dash-announcement-chip--muted">${escapeHtml(status)}</span>` : ''}
                    </div>
                    <h4 title="${escapeHtml(item.title || '')}">${escapeHtml(item.title || 'Untitled announcement')}</h4>
                    <p>${escapeHtml(item.description || '')}</p>
                    <div class="dash-announcement-meta">
                        <span>${ICON_CALENDAR}${escapeHtml(dateLabel)}</span>
                        ${item.location ? `<span>${ICON_PIN}${escapeHtml(item.location)}</span>` : ''}
                    </div>
                </div>
                <div class="dash-announcement-actions">
                    <button type="button" class="dash-icon-btn" data-edit-id="${escapeHtml(item.id)}" title="Edit announcement" aria-label="Edit announcement">
                        ${ICON_PENCIL}
                    </button>
                    <button type="button" class="dash-icon-btn dash-icon-btn--danger" data-delete-id="${escapeHtml(item.id)}" title="Delete announcement" aria-label="Delete announcement">
                        ${ICON_TRASH}
                    </button>
                </div>
            </article>
        `;
    }

    function openManageAnnouncementModal() {
        const total = announcementState.items.length;

        showModal(`
            ${announcementModalHeader({
                title: 'Manage Announcements',
                subtitle: total
                    ? `${total} announcement${total === 1 ? '' : 's'} posted — edit or remove any of them below.`
                    : 'Nothing posted yet. Create your first announcement.',
                actions: '<button type="button" class="dash-header-action dash-header-action--primary" id="manage-new-announcement-btn">+ New</button>'
            })}
            <div class="dash-modal-content">
                <div class="dash-announcement-list">
                    ${
                        total
                            ? announcementState.items.map(announcementCardMarkup).join('')
                            : `
                                <div class="dash-empty-state">
                                    <span class="dash-empty-icon">${ICON_MEGAPHONE}</span>
                                    <h4>No announcements yet</h4>
                                    <p>Announcements show up on the pet owner landing page. Post one to get started.</p>
                                    <button type="button" class="dash-primary-btn" id="empty-new-announcement-btn">Create Announcement</button>
                                </div>
                            `
                    }
                </div>
            </div>
        `);

        ['manage-new-announcement-btn', 'empty-new-announcement-btn'].forEach((id) => {
            document.getElementById(id)?.addEventListener('click', () => {
                openAnnouncementEditorModal({ mode: 'create', fromManage: true });
            });
        });

        // A thumbnail whose file is missing just drops out, uncovering the
        // placeholder already sitting behind it.
        modalRoot.querySelectorAll('[data-announcement-thumb]').forEach((image) => {
            image.addEventListener('error', () => image.remove());
        });

        modalRoot.querySelectorAll('[data-edit-id]').forEach((button) => {
            button.addEventListener('click', () => {
                // ids come back as ints from the API but as strings off the DOM.
                const target = announcementState.items.find(
                    (announcement) => String(announcement.id) === String(button.dataset.editId)
                );
                if (target) {
                    openAnnouncementEditorModal({ mode: 'edit', item: target, fromManage: true });
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
            <div class="dash-confirm-box">
                <div class="dash-confirm-icon dash-confirm-icon--danger">${ICON_TRASH}</div>
                <h3>Delete this announcement?</h3>
                <p>It will disappear from the pet owner landing page. This cannot be undone.</p>
                <div class="dash-confirm-actions">
                    <button type="button" class="dash-secondary-btn" id="delete-announcement-cancel-btn">No, keep it</button>
                    <button type="button" class="dash-danger-btn" id="delete-announcement-confirm-btn">Yes, delete</button>
                </div>
            </div>
        `, 'dash-modal-mini');

        document.getElementById('delete-announcement-cancel-btn')
            ?.addEventListener('click', () => openManageAnnouncementModal());

        const deleteBtn = document.getElementById('delete-announcement-confirm-btn');
        deleteBtn?.addEventListener('click', async () => {
            deleteBtn.disabled = true;
            deleteBtn.textContent = 'Deleting...';
            const deleted = window.VetAPI?.deleteAnnouncement
                ? await window.VetAPI.deleteAnnouncement(targetId)
                : { ok: false, error: 'Announcement API is unavailable.' };
            if (!deleted.ok) {
                deleteBtn.disabled = false;
                deleteBtn.textContent = 'Yes, delete';
                showNotification(deleted.error || 'Announcement could not be deleted.', 'error');
                return;
            }
            announcementState.items = announcementState.items.filter((item) => String(item.id) !== String(targetId));
            showNotification('Announcement deleted.', 'success');
            openManageAnnouncementModal();
        });
    }

    // ===========================
    // TAB AND FILTER FUNCTIONALITY
    // ===========================
    // dashboardFilterState is declared above the charts — the forecast fetch
    // needs it before this point in the file.

    function setForecastNote(text) {
        const note = document.getElementById('diseaseForecastNote');
        if (!note) return;
        note.textContent = text;
        note.hidden = !text;
    }

    /* The forecast comes from the Python analytics service, a separate process
       that may not be running. It is fetched only after the chart has already
       drawn its confirmed cases, so a slow or dead service delays the orange
       line and nothing else — the page never waits on it.

       When the service can't be reached the line is left off entirely rather
       than filled in with the +12% arithmetic fallback the API also returns.
       Disease Analytics plots the real model for these same barangays; a made-up
       line here would mean two pages quoting different forecasts for the same
       place, with nothing on screen to say which one to believe. */
    async function refreshDiseaseForecast() {
        const chart = window.dashboardCharts.disease;
        if (!chart || !window.VetAPI?.getDiseaseRiskPrediction) return;

        const barangays = chart.data.labels.slice();
        if (!barangays.length) return;

        const actuals = chart.data.datasets[0]?.data || [];
        const currentCases = {};
        barangays.forEach((barangay, index) => {
            currentCases[barangay] = Number(actuals[index]) || 0;
        });

        const requestedDisease = dashboardFilterState.disease;
        setForecastNote('Loading forecast…');

        const response = await window.VetAPI.getDiseaseRiskPrediction(
            barangays, currentCases, requestedDisease, 'year'
        );

        // The dropdown can move while the service is thinking. Plotting a stale
        // response would put one disease's forecast against another's actuals.
        if (requestedDisease !== dashboardFilterState.disease) return;
        if (window.dashboardCharts.disease !== chart) return;

        const rows = response.ok && Array.isArray(response.data) ? response.data : [];
        const predictedByBarangay = {};
        rows.forEach((row) => {
            const value = Number(row.predicted_cases ?? row.fused_predicted);
            if (row.barangay && Number.isFinite(value)) {
                predictedByBarangay[row.barangay] = value;
            }
        });

        const existing = chart.data.datasets.findIndex((set) => set.label === 'Predicted Cases');
        if (existing !== -1) chart.data.datasets.splice(existing, 1);

        if (!Object.keys(predictedByBarangay).length) {
            chart.update();
            setForecastNote('Forecast unavailable — the analytics service is not responding. Confirmed cases are unaffected.');
            return;
        }

        chart.data.datasets.push({
            label: 'Predicted Cases',
            data: chart.data.labels.map((barangay) => predictedByBarangay[barangay] ?? null),
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
            pointHoverRadius: 5,
            spanGaps: true
        });
        chart.update();
        setForecastNote('');
    }

    function updatePatientVolumeChart(rows = []) {
        if (!window.dashboardCharts.patientVolume || !rows.length) return;
        window.dashboardCharts.patientVolume.data.labels = rows.map((item) => item.label);
        window.dashboardCharts.patientVolume.data.datasets[0].data = rows.map((item) => item.value);
        window.dashboardCharts.patientVolume.update();
    }

    function updateDiseaseChart(rows = []) {
        const chart = window.dashboardCharts.disease;
        if (!chart) return;

        // An empty result used to leave the previous disease's line on screen
        // under the new disease's name. Clear it and say so instead.
        chart.data.labels = rows.map((item) => item.barangay);
        chart.data.datasets[0].data = rows.map((item) => item.actual);
        const stalePrediction = chart.data.datasets.findIndex((set) => set.label === 'Predicted Cases');
        if (stalePrediction !== -1) chart.data.datasets.splice(stalePrediction, 1);
        chart.update();

        if (!rows.length) {
            setForecastNote(`No cases recorded for ${dashboardFilterState.disease}.`);
            return;
        }
        refreshDiseaseForecast();
    }

    async function refreshDashboardCharts() {
        const response = window.VetAPI?.getDashboardSummary
            ? await window.VetAPI.getDashboardSummary({
                patient_range: dashboardFilterState.patientRange,
                disease: dashboardFilterState.disease
            })
            : { ok: false };
        if (!response.ok) {
            setForecastNote('Could not refresh — the dashboard service did not respond.');
            return;
        }
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

    // First-login nudge: vets who haven't written a bio yet get a skippable
    // prompt. No "seen it already" tracking — it simply re-appears on every
    // login until a bio is saved, then never shows again.
    checkBioPrompt();

    // api/users/profile.php authenticates with the bearer token now and ignores
    // any user_id in the body, so both calls below must carry it or they 401.
    // Reads the session itself rather than closing over bioSession, because the
    // save call lives in openBioPromptModal() where that variable is out of scope.
    function bioAuthHeaders() {
        let s = null;
        try {
            s = (window.VBetterAuth && window.VBetterAuth.getSession)
                ? window.VBetterAuth.getSession()
                : JSON.parse(localStorage.getItem('vbetter_session') || 'null');
        } catch { s = null; }
        const token = s?.token || localStorage.getItem('bvetter_token');
        return token
            ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
            : { 'Content-Type': 'application/json' };
    }

    async function checkBioPrompt() {
        let bioSession = null;
        try {
            bioSession = (window.VBetterAuth && window.VBetterAuth.getSession)
                ? window.VBetterAuth.getSession()
                : JSON.parse(localStorage.getItem('vbetter_session') || 'null');
        } catch { bioSession = null; }

        const userId = bioSession?.userId || bioSession?.id || 0;
        if (!userId) return;

        try {
            const response = await fetch('/api/users/profile.php', {
                method: 'POST',
                headers: bioAuthHeaders(),
                body: JSON.stringify({ action: 'get', user_id: userId })
            });
            const result = await response.json();
            if (!result.success || !result.data) return;
            if (result.data.bio && result.data.bio.trim()) return;

            openBioPromptModal(userId, result.data);
        } catch {
            // Silent — this is a nice-to-have nudge, not the critical path.
        }
    }

    function openBioPromptModal(userId, profile) {
        showModal(`
            <header class="dash-modal-header">
                <div class="dash-modal-header-text">
                    <h2>Add a short bio</h2>
                    <p>Pet owners see this on your profile when booking an appointment. You can skip and add it later from your Profile page.</p>
                </div>
                <button type="button" class="dash-close-btn" data-modal-close>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </header>
            <div class="dash-modal-divider"></div>
            <div class="dash-modal-content">
                <div class="dash-field-wrap">
                    <label class="dash-field-label" for="bio-prompt-input">Bio</label>
                    <textarea id="bio-prompt-input" class="dash-textarea" placeholder="Tell pet owners a bit about your background and approach to care."></textarea>
                </div>
            </div>
            <div class="dash-modal-footer">
                <button type="button" class="dash-secondary-btn" id="bio-prompt-skip">Skip for now</button>
                <button type="button" class="dash-primary-btn" id="bio-prompt-save">Save Bio</button>
            </div>
        `);

        const skipBtn = document.getElementById('bio-prompt-skip');
        const saveBtn = document.getElementById('bio-prompt-save');
        if (skipBtn) skipBtn.addEventListener('click', closeModal);
        if (saveBtn) {
            saveBtn.addEventListener('click', async function () {
                const input = document.getElementById('bio-prompt-input');
                const bio = input ? input.value.trim() : '';
                if (!bio) { closeModal(); return; }

                saveBtn.disabled = true;
                try {
                    await fetch('/api/users/profile.php', {
                        method: 'POST',
                        headers: bioAuthHeaders(),
                        body: JSON.stringify({
                            action: 'update',
                            user_id: userId,
                            fullName: profile.fullName || '',
                            email: profile.email || '',
                            phone: profile.phone || '',
                            education: profile.education || '',
                            specialization: profile.specialization || '',
                            bio
                        })
                    });
                } catch {
                    // Worst case it re-prompts next login — nothing else to do here.
                } finally {
                    closeModal();
                }
            });
        }
    }
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

/**
 * Title-case a full name (e.g. "kizea igaya" -> "Kizea Igaya") so the
 * greeting reads consistently regardless of how it was typed at signup.
 */
function titleCaseName(name) {
    return String(name || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ') || 'Unknown';
}

function safeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Nothing is announced more than a year out, so past this is a mistyped year.
function oneYearAheadIso() {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
}

// An announcement can't be scheduled into the past, but editing an older one
// must keep its own date reachable or the record can't be saved.
function announcementDateFloor(current) {
    const today = new Date().toISOString().slice(0, 10);
    const value = String(current ?? '').trim();
    return value && value < today ? value : today;
}

// Slots are stored as 24-hour 'HH:MM'; the timeline reads better as '3:00 PM'.
function displaySlot(slot) {
    const value = String(slot ?? '').trim();
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return value;
    const hour = Number(match[1]);
    return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
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
                    <p class="event-time">${safeHtml(displaySlot(item.time_slot) || 'TBD')}</p>
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

    if (viewLink) viewLink.href = '../../vet/html/appointment.html';

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
    const values = document.querySelectorAll('.KPI .kpi-value');
    const progressFill = document.querySelector('.vaccination-progress .progress-fill');
    const greetValues = document.querySelectorAll('.greet-stat-val');

    // Without data, the markup's own placeholder figures (94%, and friends)
    // would stand there looking like today's numbers. An em dash says plainly
    // that nothing loaded.
    if (!data?.kpis) {
        values.forEach((element) => { element.textContent = '—'; });
        greetValues.forEach((element) => { element.textContent = '—'; });
        if (progressFill) progressFill.style.width = '0%';
        return;
    }

    if (values[0]) values[0].textContent = formatNumber(data.kpis.totalAppointments || 0);
    if (values[1]) values[1].textContent = formatNumber(data.kpis.pendingActions || 0);
    if (values[2]) values[2].textContent = String(data.kpis.activeLostReports || 0).padStart(2, '0');
    if (values[3]) values[3].textContent = `${data.kpis.vaccinationRate || 0}%`;

    if (progressFill) progressFill.style.width = `${Math.min(100, data.kpis.vaccinationRate || 0)}%`;

    // Greeting banner stats mirror the KPI cards above — same figures,
    // just surfaced closer to the top of the page.
    if (greetValues[0]) greetValues[0].textContent = formatNumber(data.kpis.totalAppointments || 0);
    if (greetValues[1]) greetValues[1].textContent = formatNumber(data.kpis.pendingActions || 0);
    if (greetValues[2]) greetValues[2].textContent = `${data.kpis.vaccinationRate || 0}%`;
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

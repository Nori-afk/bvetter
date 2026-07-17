/**
 * VBetter – Admin Dashboard JS
 * Backed by api.getAdminDashboard() (api/dashboard/dashboard.php?scope=admin)
 * and api.allUsers() / api.accountRoles() / api.createAccountUser() /
 * api.approveUser() / api.rejectUser() (api/admin/account-management.php).
 */

'use strict';

let registrationChartInstance = null;
let monthlyChartRows = [];
let pendingUsers = [];

document.addEventListener('DOMContentLoaded', function () {
    loadDashboard();
    loadRoles();
    wireAddAccountModal();
    wireChartTabs();
    wireNotificationsModal();

    document.getElementById('manage-accounts-btn')?.addEventListener('click', function () {
        window.location.href = 'account-management.html';
    });
    document.querySelector('.btn-view-all-pending')?.addEventListener('click', function () {
        window.location.href = 'account-management.html';
    });

    // ===========================
    // HEADER IDENTITY — logged-in admin's name + today's date
    // ===========================
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

    const cards = document.querySelectorAll('.card');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.animation = `fadeIn 0.5s ease-in-out ${index * 0.08}s forwards`;
    });

    const kpiCards = document.querySelectorAll('.kpi-card');
    kpiCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.animation = `slideUp 0.5s ease-in-out ${index * 0.08}s forwards`;
    });
});

/* ── Load dashboard data ────────────────────────────────────── */
async function loadDashboard() {
    const result = await api.getAdminDashboard().catch(() => ({ success: false }));
    if (!result.success) {
        showToast('Could not load dashboard data.', 'error');
        return;
    }

    const data = result.data || {};
    renderGreeting(data.kpis || {});
    renderKpis(data.kpis || {});
    renderChart(data.registrationChart || []);
    renderRecentAccounts(data.recentAccounts || []);
    renderModuleActivity(data.moduleActivity || []);
    renderSnapshot(data.operations || {});
    renderActivityFeed(data.recentActivity || []);

    await loadPendingApprovals();
}

async function loadPendingApprovals() {
    const list = document.getElementById('pending-list');
    const result = await api.allUsers().catch(() => ({ success: false }));
    if (!result.success) {
        if (list) list.innerHTML = '<p class="am-loading-cell">Could not load pending approvals.</p>';
        return;
    }

    pendingUsers = (result.data || []).filter(u => u.status === 'pending');
    renderPendingApprovals(pendingUsers);
}

async function loadRoles() {
    const select = document.getElementById('add-acc-role');
    if (!select) return;

    const result = await api.accountRoles().catch(() => ({ success: false }));
    if (!result.success) return;

    select.innerHTML = '<option value="">Select role…</option>' + result.data.map((role) =>
        `<option value="${role.id}" data-frontend-role="${role.frontendRole}">${role.label}</option>`
    ).join('');
}

/* ── Greeting + KPIs ────────────────────────────────────────── */
function renderGreeting(kpis) {
    setText('greet-total', kpis.totalAccounts ?? 0);
    setText('greet-active', kpis.activeAccounts ?? 0);
    setText('greet-pending', pad2(kpis.pendingApprovals ?? 0));
}

function renderKpis(kpis) {
    setText('kpi-total-accounts', kpis.totalAccounts ?? 0);
    setText('kpi-pending-approvals', pad2(kpis.pendingApprovals ?? 0));
    setText('kpi-system-alerts', pad2(kpis.systemAlerts ?? 0));
    setText('kpi-vacc-rate', `${kpis.clinicVaccinationRate ?? 0}%`);

    const fill = document.getElementById('kpi-vacc-fill');
    if (fill) fill.style.width = `${Math.min(100, kpis.clinicVaccinationRate ?? 0)}%`;

    const badge = document.getElementById('kpi-pending-badge');
    if (badge) badge.hidden = !(kpis.pendingApprovals > 0);
}

/* ── Registration chart ─────────────────────────────────────── */
function wireChartTabs() {
    const tabs = document.querySelectorAll('.card-tabs .tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', function () {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderChart(monthlyChartRows, tab.textContent.trim().toLowerCase());
        });
    });
}

function renderChart(rows, mode = 'monthly') {
    if (rows !== monthlyChartRows) monthlyChartRows = rows;

    const regCtx = document.getElementById('registrationChart');
    if (!regCtx) return;

    const displayRows = mode === 'quarterly' ? toQuarters(monthlyChartRows) : monthlyChartRows;

    if (registrationChartInstance) {
        registrationChartInstance.destroy();
    }

    registrationChartInstance = new Chart(regCtx, {
        type: 'bar',
        data: {
            labels: displayRows.map(r => r.label),
            datasets: [{
                label: 'New Accounts',
                data: displayRows.map(r => r.newAccounts),
                backgroundColor: '#002A58',
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#002A58', font: { size: 12, weight: '600' }, padding: 14, usePointStyle: true }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(216,216,255,0.1)', drawBorder: false },
                    ticks: { color: '#737781', stepSize: 2 }
                },
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: { color: '#737781' }
                }
            }
        }
    });
}

function toQuarters(rows) {
    const quarters = [];
    for (let i = 0; i < rows.length; i += 3) {
        const chunk = rows.slice(i, i + 3);
        if (!chunk.length) continue;
        quarters.push({
            label: chunk.length > 1 ? `${chunk[0].label}–${chunk[chunk.length - 1].label}` : chunk[0].label,
            newAccounts: chunk.reduce((sum, r) => sum + (r.newAccounts || 0), 0)
        });
    }
    return quarters;
}

/* ── Recent accounts table ──────────────────────────────────── */
const ROLE_DISPLAY = {
    veterinarian: { label: 'Vet', css: 'vet' },
    admin:        { label: 'Admin', css: 'admin' },
    pet_owner:    { label: 'Owner', css: 'owner' }
};

function renderRecentAccounts(accounts) {
    const tbody = document.getElementById('recent-accounts-body');
    if (!tbody) return;

    if (!accounts.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="am-loading-cell">No accounts yet.</td></tr>';
        return;
    }

    tbody.innerHTML = accounts.map(a => {
        const initials = (a.name || 'N/A').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
        const roleInfo = ROLE_DISPLAY[a.role] || { label: capitalize(a.role || 'User'), css: 'owner' };
        const avatarClass = roleInfo.css === 'admin' ? 'user-avatar admin-av' : 'user-avatar';
        return `
            <tr>
                <td class="user-cell">
                    <div class="${avatarClass}">${initials}</div>
                    <span>${escapeHtml(a.name || 'N/A')}</span>
                </td>
                <td><span class="role-badge ${roleInfo.css}">${roleInfo.label}</span></td>
                <td class="email-cell">${escapeHtml(a.email || '')}</td>
                <td><span class="status-pill ${a.status || 'inactive'}">${capitalize(a.status || 'inactive')}</span></td>
                <td class="date-cell">${formatShortDate(a.joined)}</td>
            </tr>`;
    }).join('');
}

/* ── Module usage ───────────────────────────────────────────── */
function renderModuleActivity(items) {
    const container = document.getElementById('module-bars');
    if (!container) return;

    if (!items.length) {
        container.innerHTML = '<p class="am-loading-cell">No module activity yet.</p>';
        return;
    }

    container.innerHTML = items.map(item => {
        const tier = item.pct >= 60 ? '' : item.pct >= 30 ? 'blue' : 'muted';
        return `
        <div class="module-bar-item">
            <div class="module-bar-label">
                <span class="module-name">${escapeHtml(item.name)}</span>
                <span class="module-pct">${item.pct}%</span>
            </div>
            <div class="module-track"><div class="module-fill ${tier}" style="width:${item.pct}%"></div></div>
        </div>`;
    }).join('');
}

/* ── Clinic snapshot ─────────────────────────────────────────── */
function renderSnapshot(operations) {
    const kpis = operations.kpis || {};
    setText('snap-appointments-today', kpis.appointmentsToday ?? 0);
    setText('snap-lost-reports', kpis.activeLostReports ?? 0);
    setText('snap-chatbot-queries', operations.chatbotQueries ?? 0);
    setText('snap-pending-actions', kpis.pendingActions ?? 0);
}

/* ── Pending approvals ───────────────────────────────────────── */
function renderPendingApprovals(users) {
    const list = document.getElementById('pending-list');
    const count = document.getElementById('pending-count');
    if (count) count.textContent = users.length;

    if (!list) return;

    if (!users.length) {
        list.innerHTML = '<p class="am-loading-cell">No pending approvals.</p>';
        return;
    }

    list.innerHTML = users.slice(0, 5).map(u => {
        const initials = (u.name || '').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
        const avatarClass = u.role === 'admin' ? 'user-avatar small admin-av' : 'user-avatar small';
        return `
            <div class="pending-item" data-id="${u.id}">
                <div class="${avatarClass}">${initials}</div>
                <div class="pending-info">
                    <p class="pending-name">${escapeHtml(u.name || '')}</p>
                    <p class="pending-role">${escapeHtml(u.roleLabel || capitalize(u.role))} • Joined ${formatShortDate(u.created)}</p>
                </div>
                <div class="pending-actions">
                    <button class="btn-approve" data-id="${u.id}">✓</button>
                    <button class="btn-reject" data-id="${u.id}">✕</button>
                </div>
            </div>`;
    }).join('');

    list.querySelectorAll('.btn-approve').forEach(btn => {
        btn.addEventListener('click', () => handlePendingAction(btn.dataset.id, 'approve'));
    });
    list.querySelectorAll('.btn-reject').forEach(btn => {
        btn.addEventListener('click', () => handlePendingAction(btn.dataset.id, 'reject'));
    });
}

async function handlePendingAction(userId, action) {
    const user = pendingUsers.find(u => u.id === userId);
    const name = user?.name || 'Account';

    const result = action === 'approve'
        ? await api.approveUser(userId).catch(() => ({ success: false }))
        : await api.rejectUser(userId).catch(() => ({ success: false }));

    if (!result.success) {
        showToast(result.message || `Could not ${action} this account.`, 'error');
        return;
    }

    showToast(action === 'approve' ? `${name} approved successfully.` : `${name} was rejected.`, action === 'approve' ? 'success' : 'error');
    await loadDashboard();
}

/* ── Recent activity feed ────────────────────────────────────── */
function renderActivityFeed(events) {
    const feed = document.getElementById('activity-feed');
    if (!feed) return;

    if (!events.length) {
        feed.innerHTML = '<p class="am-loading-cell">No recent activity.</p>';
        return;
    }

    feed.innerHTML = events.map(e => `
        <div class="activity-item">
            <div class="activity-dot ${e.type || 'blue'}"></div>
            <div class="activity-body">
                <p class="activity-text">${e.text}</p>
                <span class="activity-time">${formatRelativeTime(e.time)}</span>
            </div>
        </div>`).join('');
}

/* ── ADD ACCOUNT MODAL ──────────────────────────────────────── */
/* ── Notifications (shared admin/vet feed) ─────────────────── */
function wireNotificationsModal() {
    const bellBtn  = document.getElementById('notification-icon-btn');
    const overlay  = document.getElementById('modal-notifications');
    const closeBtn = document.getElementById('modal-notifications-close');
    const markAllBtn = document.getElementById('notifications-mark-all-read');
    const listEl   = document.getElementById('notifications-list');

    function openModal() {
        if (overlay) overlay.hidden = false;
        loadNotifications();
    }

    function closeModal() {
        if (overlay) overlay.hidden = true;
    }

    async function loadNotifications() {
        if (!listEl) return;
        listEl.innerHTML = '<p class="am-loading-cell">Loading notifications…</p>';
        const result = await api.getStaffNotifications('admin').catch(() => ({ success: false }));
        if (!result.success) {
            listEl.innerHTML = '<p class="am-loading-cell">Could not load notifications.</p>';
            return;
        }
        renderNotifications(result.data || []);
    }

    function renderNotifications(items) {
        if (!listEl) return;
        if (!items.length) {
            listEl.innerHTML = '<p class="am-loading-cell">No notifications yet.</p>';
            return;
        }
        listEl.innerHTML = items.map((item) => `
            <article class="dash-notification-item ${item.is_read ? 'read' : 'unread'}" data-notification-id="${item.id}">
                <h4>${escapeHtml(item.title)}</h4>
                <p>${escapeHtml(item.message)}</p>
                <small>${escapeHtml(new Date(item.created_at).toLocaleString())}</small>
            </article>
        `).join('');

        listEl.querySelectorAll('[data-notification-id]').forEach((el) => {
            el.addEventListener('click', async () => {
                const id = Number(el.dataset.notificationId);
                el.classList.remove('unread');
                el.classList.add('read');
                await api.markNotificationRead(id).catch(() => null);
            });
        });
    }

    if (bellBtn) bellBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (overlay) {
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeModal();
        });
    }
    if (markAllBtn) {
        markAllBtn.addEventListener('click', async () => {
            await api.markAllNotificationsRead('admin').catch(() => null);
            loadNotifications();
        });
    }
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && overlay && !overlay.hidden) closeModal();
    });
}

function wireAddAccountModal() {
    const overlay    = document.getElementById('modal-add-account');
    const addBtn     = document.getElementById('add-account-btn');
    const closeBtn   = document.getElementById('modal-add-close');
    const cancelBtn  = document.getElementById('modal-add-cancel');
    const submitBtn  = document.getElementById('modal-add-submit');
    const photoInput = document.getElementById('add-acc-photo');
    const photoPreview = document.getElementById('add-acc-preview');
    const pwInput    = document.getElementById('add-acc-password');
    const pwToggle   = overlay?.querySelector('.dash-pw-toggle');
    const roleSelect = document.getElementById('add-acc-role');
    const vetFields  = document.getElementById('add-acc-vet-fields');

    const CAMERA_SVG = '<svg width="26" height="26" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><circle cx="12" cy="13" r="3"/></svg>';
    const SUBMIT_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>';

    function openModal() {
        if (overlay) overlay.hidden = false;
        document.getElementById('add-acc-name')?.focus();
    }

    function closeModal() {
        if (overlay) overlay.hidden = true;
        resetForm();
    }

    function resetForm() {
        ['add-acc-name', 'add-acc-phone', 'add-acc-email', 'add-acc-password', 'add-acc-license', 'add-acc-specialization', 'add-acc-education', 'add-acc-clinic'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = ''; el.classList.remove('dash-error'); }
        });
        if (roleSelect) roleSelect.value = '';
        const statusEl = document.getElementById('add-acc-status');
        if (statusEl) statusEl.value = 'active';
        if (vetFields) vetFields.hidden = true;
        overlay?.querySelectorAll('.dash-field-error').forEach(el => el.remove());
        if (photoPreview) photoPreview.innerHTML = CAMERA_SVG;
        if (photoInput) photoInput.value = '';
        if (pwInput) pwInput.type = 'password';
    }

    if (addBtn) addBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    if (overlay) {
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeModal();
        });
    }

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && overlay && !overlay.hidden) closeModal();
    });

    if (photoInput) {
        photoInput.addEventListener('change', function () {
            const file = photoInput.files[0];
            if (!file || !photoPreview) return;
            const reader = new FileReader();
            reader.onload = function (e) {
                photoPreview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
            };
            reader.readAsDataURL(file);
        });
    }

    if (pwToggle && pwInput) {
        pwToggle.addEventListener('click', function () {
            const isHidden = pwInput.type === 'password';
            pwInput.type = isHidden ? 'text' : 'password';
            pwToggle.querySelector('svg').style.opacity = isHidden ? '1' : '0.45';
        });
    }

    roleSelect?.addEventListener('change', function () {
        const option = roleSelect.selectedOptions[0];
        const isVet = option?.dataset.frontendRole === 'vet';
        if (vetFields) vetFields.hidden = !isVet;
    });

    function validateAddForm() {
        let valid = true;
        overlay?.querySelectorAll('.dash-field-error').forEach(el => el.remove());
        overlay?.querySelectorAll('.dash-input.dash-error').forEach(el => el.classList.remove('dash-error'));

        function markError(id, msg) {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.add('dash-error');
            const err = document.createElement('span');
            err.className = 'dash-field-error';
            err.textContent = msg;
            el.closest('.dash-form-group').appendChild(err);
            valid = false;
        }

        const name  = document.getElementById('add-acc-name')?.value.trim();
        const role  = roleSelect?.value;
        const email = document.getElementById('add-acc-email')?.value.trim();
        const pw    = document.getElementById('add-acc-password')?.value;

        if (!name)  markError('add-acc-name',     'Full name is required.');
        if (!role)  markError('add-acc-role',     'Please select a role.');
        if (!email) markError('add-acc-email',    'Email address is required.');
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                    markError('add-acc-email',    'Enter a valid email address.');
        if (!pw)    markError('add-acc-password', 'Password is required.');
        else if (pw.length < 8)
                    markError('add-acc-password', 'Password must be at least 8 characters.');

        const isVet = roleSelect?.selectedOptions[0]?.dataset.frontendRole === 'vet';
        if (isVet) {
            ['add-acc-license', 'add-acc-specialization', 'add-acc-education', 'add-acc-clinic'].forEach(id => {
                if (!document.getElementById(id)?.value.trim()) markError(id, 'Required for veterinarian accounts.');
            });
        }

        return valid;
    }

    if (submitBtn) {
        submitBtn.addEventListener('click', async function () {
            if (!validateAddForm()) return;

            const name = document.getElementById('add-acc-name').value.trim();
            const formData = new FormData();
            formData.append('full_name', name);
            formData.append('email', document.getElementById('add-acc-email').value.trim());
            formData.append('password', document.getElementById('add-acc-password').value);
            formData.append('phone_number', document.getElementById('add-acc-phone')?.value.trim() || '');
            formData.append('role_id', roleSelect.value);
            formData.append('account_status', document.getElementById('add-acc-status')?.value || 'active');

            if (roleSelect.selectedOptions[0]?.dataset.frontendRole === 'vet') {
                formData.append('license_number', document.getElementById('add-acc-license').value.trim());
                formData.append('specialization', document.getElementById('add-acc-specialization').value.trim());
                formData.append('education', document.getElementById('add-acc-education').value.trim());
                formData.append('clinic_location', document.getElementById('add-acc-clinic').value.trim());
            }

            if (photoInput?.files[0]) formData.append('profile_photo', photoInput.files[0]);

            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating…';
            const result = await api.createAccountUser(formData).catch(() => ({ success: false }));
            submitBtn.disabled = false;
            submitBtn.innerHTML = `${SUBMIT_SVG} Create Account`;

            if (!result.success) {
                showToast(result.message || 'Could not create account.', 'error');
                return;
            }

            closeModal();
            showToast(`Account for "${name}" created successfully.`, 'success');
            await loadDashboard();
        });
    }
}

/* ── Helpers ────────────────────────────────────────────────── */
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

function formatShortDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}

function formatRelativeTime(dateStr) {
    if (!dateStr) return '—';
    const then = new Date(dateStr.replace(' ', 'T'));
    if (Number.isNaN(then.getTime())) return '—';
    const diffMs = Date.now() - then.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? '' : 's'} ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
    return then.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

/* ── Toast notification ────────────────────────────────────── */
function showToast(message, type = 'info') {
    const colors = {
        success: '#1B6D24',
        error: '#93000A',
        info: '#002A58'
    };
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 14px 22px;
        background: ${colors[type] || colors.info};
        color: white;
        border-radius: 8px;
        z-index: 1000;
        font-family: 'Manrope', sans-serif;
        font-size: 13px;
        font-weight: 600;
        animation: slideIn 0.3s ease-in-out;
        max-width: 320px;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in-out';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/* ── CSS animations ─────────────────────────────────────────── */
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    @keyframes slideUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
    }
    @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
    }
`;
document.head.appendChild(style);

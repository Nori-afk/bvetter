document.addEventListener('DOMContentLoaded', async function () {
    const dashboardData = await loadAdminDashboard();
    applyAdminDashboard(dashboardData);

    // ===========================
    // REGISTRATION CHART
    // ===========================
    const regCtx = document.getElementById('registrationChart');
    if (regCtx) {
        new Chart(regCtx, {
            type: 'bar',
            data: {
                labels: (dashboardData?.registrationChart?.length ? dashboardData.registrationChart : [
                    { label: 'Nov', newAccounts: 3, deactivated: 1 },
                    { label: 'Dec', newAccounts: 5, deactivated: 0 },
                    { label: 'Jan', newAccounts: 4, deactivated: 1 },
                    { label: 'Feb', newAccounts: 8, deactivated: 2 },
                    { label: 'Mar', newAccounts: 6, deactivated: 0 },
                    { label: 'Apr', newAccounts: 9, deactivated: 1 }
                ]).map((item) => item.label),
                datasets: [
                    {
                        label: 'New Accounts',
                        data: (dashboardData?.registrationChart?.length ? dashboardData.registrationChart : [
                            { newAccounts: 3 },
                            { newAccounts: 5 },
                            { newAccounts: 4 },
                            { newAccounts: 8 },
                            { newAccounts: 6 },
                            { newAccounts: 9 }
                        ]).map((item) => item.newAccounts),
                        backgroundColor: '#002A58',
                        borderRadius: 6,
                        borderSkipped: false
                    },
                    {
                        label: 'Deactivated',
                        data: (dashboardData?.registrationChart?.length ? dashboardData.registrationChart : [
                            { deactivated: 1 },
                            { deactivated: 0 },
                            { deactivated: 1 },
                            { deactivated: 2 },
                            { deactivated: 0 },
                            { deactivated: 1 }
                        ]).map((item) => item.deactivated),
                        backgroundColor: 'rgba(147,0,10,0.25)',
                        borderRadius: 6,
                        borderSkipped: false
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
                            font: { size: 12, weight: '600' },
                            padding: 14,
                            usePointStyle: true
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(216,216,255,0.1)',
                            drawBorder: false
                        },
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

    // ===========================
    // CARD FADE-IN ANIMATIONS
    // ===========================
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

    // ===========================
    // PENDING APPROVE / REJECT
    // ===========================
    document.querySelectorAll('.btn-approve').forEach(btn => {
        btn.addEventListener('click', function () {
            const item = btn.closest('.pending-item');
            const name = item.querySelector('.pending-name')?.textContent || 'Account';
            item.style.transition = 'opacity 0.3s ease';
            item.style.opacity = '0';
            setTimeout(() => {
                item.remove();
                updatePendingCount(-1);
                showToast(`${name} approved successfully.`, 'success');
            }, 300);
        });
    });

    document.querySelectorAll('.btn-reject').forEach(btn => {
        btn.addEventListener('click', function () {
            const item = btn.closest('.pending-item');
            const name = item.querySelector('.pending-name')?.textContent || 'Account';
            item.style.transition = 'opacity 0.3s ease';
            item.style.opacity = '0';
            setTimeout(() => {
                item.remove();
                updatePendingCount(-1);
                showToast(`${name} was rejected.`, 'error');
            }, 300);
        });
    });

    function updatePendingCount(delta) {
        const badge = document.querySelector('.pending-count');
        const kpiPending = document.querySelector('.KPI .kpi-card:nth-child(2) .kpi-value');
        if (badge) {
            const current = parseInt(badge.textContent) || 0;
            const next = Math.max(0, current + delta);
            badge.textContent = next;
        }
        if (kpiPending) {
            const current = parseInt(kpiPending.textContent) || 0;
            const next = Math.max(0, current + delta);
            kpiPending.textContent = String(next).padStart(2, '0');
        }
    }

    // ===========================
    // HEADER BUTTONS (stubs)
    // ===========================
    const addAccountBtn = document.getElementById('add-account-btn');
    if (addAccountBtn) {
        addAccountBtn.addEventListener('click', function () {
            showToast('Add Account: functionality coming soon.', 'info');
        });
    }

    const manageAccountsBtn = document.getElementById('manage-accounts-btn');
    if (manageAccountsBtn) {
        manageAccountsBtn.addEventListener('click', function () {
            window.location.href = '/admin/pages/account-management.html';
        });
    }

    document.querySelector('.btn-view-all-pending')?.addEventListener('click', function () {
        window.location.href = '/admin/pages/account-management.html';
    });

    // ===========================
    // CHART TABS (Monthly / Quarterly)
    // ===========================
    const tabs = document.querySelectorAll('.card-tabs .tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', function () {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
        });
    });

    console.log('Admin dashboard initialized successfully');
});

// ===========================
// TOAST NOTIFICATION
// ===========================
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

async function loadAdminDashboard() {
    try {
        const response = await fetch('/Final-backend(VBETTER)/Final-Backend/backend/dashboard/dashboard.php?scope=admin');
        const result = await response.json();
        return result.success ? result.data : null;
    } catch (error) {
        console.warn('Unable to load admin dashboard backend data:', error);
        return null;
    }
}

function applyAdminDashboard(data) {
    if (!data?.kpis) return;
    const greetStats = document.querySelectorAll('.greet-stat-val');
    if (greetStats[0]) greetStats[0].textContent = String(data.kpis.totalAccounts || 0);
    if (greetStats[1]) greetStats[1].textContent = String(data.kpis.activeAccounts || 0);
    if (greetStats[2]) greetStats[2].textContent = String(data.kpis.pendingApprovals || 0).padStart(2, '0');

    const kpis = document.querySelectorAll('.KPI .kpi-value');
    if (kpis[0]) kpis[0].textContent = String(data.kpis.totalAccounts || 0);
    if (kpis[1]) kpis[1].textContent = String(data.kpis.pendingApprovals || 0).padStart(2, '0');
    if (kpis[2]) kpis[2].textContent = String(data.kpis.systemAlerts || 0).padStart(2, '0');
    if (kpis[3]) kpis[3].textContent = `${data.kpis.clinicVaccinationRate || 0}%`;

    const progress = document.querySelector('.vaccination-progress .progress-fill');
    if (progress) progress.style.width = `${Math.min(100, data.kpis.clinicVaccinationRate || 0)}%`;

    const tableBody = document.querySelector('.accounts-table tbody');
    if (tableBody && data.recentAccounts?.length) {
        tableBody.innerHTML = data.recentAccounts.map((account) => {
            const initials = (account.name || 'NA').split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
            const role = account.role || 'User';
            const status = account.status || 'pending';
            return `
                <tr>
                    <td class="user-cell">
                        <div class="user-avatar">${escapeHtml(initials)}</div>
                        <span>${escapeHtml(account.name || 'N/A')}</span>
                    </td>
                    <td><span class="role-badge ${role.toLowerCase()}">${escapeHtml(role)}</span></td>
                    <td class="email-cell">${escapeHtml(account.email || '')}</td>
                    <td><span class="status-pill ${status.toLowerCase()}">${escapeHtml(status)}</span></td>
                    <td class="date-cell">${escapeHtml(account.joined || '')}</td>
                </tr>
            `;
        }).join('');
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ===========================
// CSS ANIMATIONS
// ===========================
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

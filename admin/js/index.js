document.addEventListener('DOMContentLoaded', function () {

    // ===========================
    // REGISTRATION CHART
    // ===========================
    const regCtx = document.getElementById('registrationChart');
    if (regCtx) {
        new Chart(regCtx, {
            type: 'bar',
            data: {
                labels: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'],
                datasets: [
                    {
                        label: 'New Accounts',
                        data: [3, 5, 4, 8, 6, 9],
                        backgroundColor: '#002A58',
                        borderRadius: 6,
                        borderSkipped: false
                    },
                    {
                        label: 'Deactivated',
                        data: [1, 0, 1, 2, 0, 1],
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
            window.location.href = 'account-management.html';
        });
    }

    document.querySelector('.btn-view-all-pending')?.addEventListener('click', function () {
        window.location.href = 'account-management.html';
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
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
    // ADD ACCOUNT MODAL
    // ===========================
    const addAccountModal  = document.getElementById('modal-add-account');
    const addAccountBtn    = document.getElementById('add-account-btn');
    const modalCloseBtn    = document.getElementById('modal-add-close');
    const modalCancelBtn   = document.getElementById('modal-add-cancel');
    const modalSubmitBtn   = document.getElementById('modal-add-submit');
    const photoInput       = document.getElementById('add-acc-photo');
    const photoPreview     = document.getElementById('add-acc-preview');
    const pwInput          = document.getElementById('add-acc-password');
    const pwToggle         = document.querySelector('.dash-pw-toggle');

    function openAddModal() {
        addAccountModal.hidden = false;
        document.getElementById('add-acc-name').focus();
    }

    function closeAddModal() {
        addAccountModal.hidden = true;
        resetAddForm();
    }

    function resetAddForm() {
        ['add-acc-name','add-acc-phone','add-acc-email','add-acc-password'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = ''; el.classList.remove('dash-error'); }
        });
        document.getElementById('add-acc-role').value = '';
        document.getElementById('add-acc-status').value = 'active';
        document.querySelectorAll('.dash-field-error').forEach(el => el.remove());
        if (photoPreview) {
            photoPreview.innerHTML = '<svg width="26" height="26" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><circle cx="12" cy="13" r="3"/></svg>';
        }
        if (photoInput) photoInput.value = '';
        if (pwInput) pwInput.type = 'password';
    }

    if (addAccountBtn)  addAccountBtn.addEventListener('click', openAddModal);
    if (modalCloseBtn)  modalCloseBtn.addEventListener('click', closeAddModal);
    if (modalCancelBtn) modalCancelBtn.addEventListener('click', closeAddModal);

    // Close on overlay click
    if (addAccountModal) {
        addAccountModal.addEventListener('click', function (e) {
            if (e.target === addAccountModal) closeAddModal();
        });
    }

    // Close on Escape
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && addAccountModal && !addAccountModal.hidden) closeAddModal();
    });

    // Photo preview
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

    // Password toggle
    if (pwToggle && pwInput) {
        pwToggle.addEventListener('click', function () {
            const isHidden = pwInput.type === 'password';
            pwInput.type = isHidden ? 'text' : 'password';
            pwToggle.querySelector('svg').style.opacity = isHidden ? '1' : '0.45';
        });
    }

    // Validation + submit
    function validateAddForm() {
        let valid = true;
        document.querySelectorAll('.dash-field-error').forEach(el => el.remove());
        document.querySelectorAll('.dash-input.dash-error').forEach(el => el.classList.remove('dash-error'));

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
        const role  = document.getElementById('add-acc-role')?.value;
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

        return valid;
    }

    if (modalSubmitBtn) {
        modalSubmitBtn.addEventListener('click', function () {
            if (!validateAddForm()) return;
            const name = document.getElementById('add-acc-name').value.trim();
            modalSubmitBtn.disabled = true;
            modalSubmitBtn.textContent = 'Creating…';
            setTimeout(function () {
                closeAddModal();
                modalSubmitBtn.disabled = false;
                modalSubmitBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> Create Account';
                showToast(`Account for "${name}" created successfully.`, 'success');
            }, 600);
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
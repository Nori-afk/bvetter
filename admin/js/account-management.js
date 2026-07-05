/**
 * VBetter – Account Management JS
 * Backed by api.allUsers() / api.accountRoles() / api.createAccountUser()
 * / api.approveUser() / api.rejectUser() / api.deleteUser() / api.updateUserStatus()
 * (all hitting api/admin/account-management.php).
 *
 * No Edit feature here on purpose — users manage their own profile via
 * account-settings.html and reset their own password via the forgot-password
 * flow, so admin-side editing was dropped rather than left half-wired.
 */

'use strict';

const PAGE_SIZE = 5;
let allUsers      = [];
let filteredUsers = [];
let currentTab    = 'all';
let currentPage   = 1;
let pendingDeleteId  = null;
let pendingVerifyId  = null;
let pendingUnblockId = null;

/* ── Init ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
    wireTabs();
    wireSearch();
    wireAddModal();
    wireUnblockModal();
    wireDeleteModal();
    wireVerifyModal();
    wirePagination();
    wireCloseButtons();

    await Promise.all([loadRoles(), loadUsers()]);
});

/* ── Load real data ─────────────────────────────────────────── */
async function loadUsers() {
    const tbody = document.getElementById('user-table-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="am-loading-cell">Loading users…</td></tr>';

    const result = await api.allUsers().catch(() => ({ success: false }));
    if (!result.success) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="am-loading-cell">Could not load users.</td></tr>';
        return;
    }

    allUsers = result.data || [];
    updateKPIs();
    applyFilters();
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

/* ── Generic close buttons ─────────────────────────────────── */
function wireCloseButtons() {
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-close');
            const el = document.getElementById(id);
            if (el) el.hidden = true;
        });
    });
    // close on overlay click
    document.querySelectorAll('.am-modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.hidden = true;
        });
    });
    // ESC — covers both am-modal-overlay and dash-overlay
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.am-modal-overlay:not([hidden]), .dash-overlay:not([hidden])').forEach(o => o.hidden = true);
        }
    });
}

/* ── KPIs ───────────────────────────────────────────────────── */
function updateKPIs() {
    setEl('kpi-total',   allUsers.length);
    setEl('kpi-vet',     allUsers.filter(u => u.role === 'vet' && u.status === 'active').length);
    setEl('kpi-blocked', allUsers.filter(u => u.status === 'blocked').length);
}

/* ── Table ──────────────────────────────────────────────────── */
function applyFilters() {
    const search = (document.getElementById('search-users')?.value || '').toLowerCase();
    filteredUsers = allUsers.filter(u => {
        const matchTab    = currentTab === 'all' || u.role === currentTab;
        const matchSearch = !search || u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search);
        return matchTab && matchSearch;
    });
    currentPage = 1;
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('user-table-body');
    if (!tbody) return;

    const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, totalPages);
    const start     = (currentPage - 1) * PAGE_SIZE;
    const pageUsers = filteredUsers.slice(start, start + PAGE_SIZE);

    setEl('showing-label', `Showing ${filteredUsers.length} of ${allUsers.length} members`);

    if (!pageUsers.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="am-loading-cell">No users found.</td></tr>';
        return;
    }

    tbody.innerHTML = pageUsers.map(u => {
        const initials = u.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
        const avatarEl = u.avatar
            ? `<img class="am-avatar" src="${u.avatar}" alt="${u.name}">`
            : `<div class="am-avatar-placeholder">${initials}</div>`;

        const roleCss = roleClass(u.roleLabel || u.role);

        const statusEl = `<span class="am-status ${u.status}"><span class="am-status-dot"></span>${capitalize(u.status)}</span>`;

        let actionsEl = `
            <button class="am-btn-delete" onclick="openDeleteModal('${u.id}')" title="Delete user">
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#E53E3E" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path stroke-linecap="round" stroke-linejoin="round" d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m5 0V4a1 1 0 011-1h2a1 1 0 011 1v2"/></svg>
            </button>`;

        if (u.status === 'blocked') {
            actionsEl = `<button class="am-btn-unblock" onclick="openUnblockModal('${u.id}')">Unblock</button>${actionsEl}`;
        }

        if (u.status === 'pending') {
            actionsEl = `
                <button class="am-btn-approve" onclick="openVerifyModal('${u.id}')">Approve</button>
                <button class="am-btn-reject"  onclick="handleReject('${u.id}')">Reject</button>
                ${actionsEl}`;
        }

        return `
            <tr data-id="${u.id}">
                <td>
                    <div class="am-user-cell">
                        ${avatarEl}
                        <div>
                            <span class="am-user-name">${u.name}</span>
                            <span class="am-user-email">${u.email}</span>
                        </div>
                    </div>
                </td>
                <td><span class="am-role-badge ${roleCss}">${u.roleLabel || capitalize(u.role)}</span></td>
                <td>${statusEl}</td>
                <td>${formatDate(u.created)}</td>
                <td><div class="am-actions-cell">${actionsEl}</div></td>
            </tr>`;
    }).join('');

    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
}

/* ── Tabs ───────────────────────────────────────────────────── */
function wireTabs() {
    document.querySelectorAll('.am-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.am-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTab = btn.dataset.tab;
            applyFilters();
        });
    });
}

/* ── Search ─────────────────────────────────────────────────── */
function wireSearch() {
    document.getElementById('search-users')?.addEventListener('input', applyFilters);
}

/* ── Pagination ─────────────────────────────────────────────── */
function wirePagination() {
    document.getElementById('prev-page')?.addEventListener('click', () => {
        if (currentPage > 1) { currentPage--; renderTable(); }
    });
    document.getElementById('next-page')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredUsers.length / PAGE_SIZE);
        if (currentPage < totalPages) { currentPage++; renderTable(); }
    });
}

/* ── ADD USER MODAL (dash-* form) ──────────────────────────── */
function wireAddModal() {
    const overlay    = document.getElementById('modal-add-account');
    const closeBtn   = document.getElementById('modal-add-close');
    const cancelBtn  = document.getElementById('modal-add-cancel');
    const submitBtn  = document.getElementById('add-submit');
    const pwInput    = document.getElementById('add-acc-password');
    const pwToggle   = overlay?.querySelector('.dash-pw-toggle');
    const photoInput = document.getElementById('add-acc-photo');
    const photoCircle= document.getElementById('add-acc-preview');
    const roleSelect = document.getElementById('add-acc-role');
    const vetFields  = document.getElementById('add-acc-vet-fields');

    const CAMERA_SVG = '<svg width="26" height="26" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><circle cx="12" cy="13" r="3"/></svg>';

    function openModal() {
        if (overlay) overlay.hidden = false;
        document.getElementById('add-acc-name')?.focus();
    }

    function closeModal() {
        if (overlay) overlay.hidden = true;
        resetForm();
    }

    function resetForm() {
        ['add-acc-name','add-acc-phone','add-acc-email','add-acc-password','add-acc-license','add-acc-specialization','add-acc-education','add-acc-clinic'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = ''; el.classList.remove('dash-error'); }
        });
        if (roleSelect)  roleSelect.value = '';
        const statusEl = document.getElementById('add-acc-status');
        if (statusEl) statusEl.value = 'active';
        if (vetFields) vetFields.hidden = true;
        overlay?.querySelectorAll('.dash-field-error').forEach(e => e.remove());
        if (photoCircle) photoCircle.innerHTML = CAMERA_SVG;
        if (photoInput)  photoInput.value = '';
        if (pwInput)     pwInput.type = 'password';
    }

    document.getElementById('btn-add-user')?.addEventListener('click', openModal);
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);

    overlay?.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    // Password toggle
    pwToggle?.addEventListener('click', () => {
        if (!pwInput) return;
        const show = pwInput.type === 'password';
        pwInput.type = show ? 'text' : 'password';
        if (pwToggle.querySelector('svg')) pwToggle.querySelector('svg').style.opacity = show ? '1' : '0.4';
    });

    // Photo preview
    photoInput?.addEventListener('change', () => {
        const file = photoInput.files[0];
        if (!file || !photoCircle) return;
        const reader = new FileReader();
        reader.onload = e => { photoCircle.innerHTML = `<img src="${e.target.result}" alt="Preview">`; };
        reader.readAsDataURL(file);
    });

    // Show vet-only fields when the selected role is "veterinarian"
    roleSelect?.addEventListener('change', () => {
        const option = roleSelect.selectedOptions[0];
        const isVet = option?.dataset.frontendRole === 'vet';
        if (vetFields) vetFields.hidden = !isVet;
    });

    // Validation
    function validate() {
        overlay?.querySelectorAll('.dash-field-error').forEach(e => e.remove());
        overlay?.querySelectorAll('.dash-input.dash-error').forEach(e => e.classList.remove('dash-error'));
        let ok = true;

        function err(id, msg) {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.add('dash-error');
            const span = document.createElement('span');
            span.className = 'dash-field-error';
            span.textContent = msg;
            el.closest('.dash-form-group').appendChild(span);
            ok = false;
        }

        const name  = document.getElementById('add-acc-name')?.value.trim();
        const role  = roleSelect?.value;
        const email = document.getElementById('add-acc-email')?.value.trim();
        const pw    = document.getElementById('add-acc-password')?.value;

        if (!name)  err('add-acc-name',     'Full name is required.');
        if (!role)  err('add-acc-role',     'Please select a role.');
        if (!email) err('add-acc-email',    'Email address is required.');
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                    err('add-acc-email',    'Enter a valid email address.');
        if (!pw)    err('add-acc-password', 'Password is required.');
        else if (pw.length < 8)
                    err('add-acc-password', 'Minimum 8 characters.');

        const isVet = roleSelect?.selectedOptions[0]?.dataset.frontendRole === 'vet';
        if (isVet) {
            ['add-acc-license', 'add-acc-specialization', 'add-acc-education', 'add-acc-clinic'].forEach(id => {
                if (!document.getElementById(id)?.value.trim()) err(id, 'Required for veterinarian accounts.');
            });
        }

        return ok;
    }

    submitBtn?.addEventListener('click', async () => {
        if (!validate()) return;

        const formData = new FormData();
        formData.append('full_name', document.getElementById('add-acc-name').value.trim());
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
        const result = await api.createAccountUser(formData).catch(() => ({ success: false }));
        submitBtn.disabled = false;

        if (!result.success) {
            alert(result.message || 'Could not create account.');
            return;
        }

        closeModal();
        await loadUsers();
    });
}

/* ── UNBLOCK MODAL ──────────────────────────────────────────── */
function wireUnblockModal() {
    document.getElementById('unblock-confirm-btn')?.addEventListener('click', async () => {
        if (!pendingUnblockId) return;
        const result = await api.updateUserStatus(pendingUnblockId, 'active').catch(() => ({ success: false }));
        if (!result.success) {
            alert(result.message || 'Could not unblock this account.');
            return;
        }
        pendingUnblockId = null;
        document.getElementById('modal-unblock').hidden = true;
        await loadUsers();
    });
}

function openUnblockModal(id) {
    const user = allUsers.find(u => u.id === id);
    if (!user) return;
    pendingUnblockId = id;

    document.getElementById('unblock-user-id').value = id;
    setEl('unblock-name',  user.name);
    setEl('unblock-role',  user.roleLabel || capitalize(user.role));
    setEl('unblock-phone', user.phone || '—');
    setEl('unblock-email', user.email);

    document.getElementById('modal-unblock').hidden = false;
}

/* ── DELETE MODAL ───────────────────────────────────────────── */
function wireDeleteModal() {
    document.getElementById('delete-confirm-btn')?.addEventListener('click', async () => {
        if (!pendingDeleteId) return;
        const result = await api.deleteUser(pendingDeleteId).catch(() => ({ success: false }));
        if (!result.success) {
            alert(result.message || 'Could not delete this account.');
            return;
        }
        pendingDeleteId = null;
        document.getElementById('modal-delete').hidden = true;
        await loadUsers();
    });
}

function openDeleteModal(id) {
    const user = allUsers.find(u => u.id === id);
    if (!user) return;
    pendingDeleteId = id;

    const initials = user.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
    setEl('delete-avatar', initials);
    setEl('delete-user-name', user.name);

    document.getElementById('modal-delete').hidden = false;
}

/* ── VERIFY MODAL ───────────────────────────────────────────── */
function wireVerifyModal() {
    document.getElementById('verify-approve-btn')?.addEventListener('click', async () => {
        if (!pendingVerifyId) return;
        const result = await api.approveUser(pendingVerifyId).catch(() => ({ success: false }));
        if (!result.success) {
            alert(result.message || 'Could not approve this account.');
            return;
        }
        pendingVerifyId = null;
        document.getElementById('modal-verify').hidden = true;
        await loadUsers();
    });

    document.getElementById('verify-reject-btn')?.addEventListener('click', async () => {
        if (!pendingVerifyId) return;
        const result = await api.rejectUser(pendingVerifyId).catch(() => ({ success: false }));
        if (!result.success) {
            alert(result.message || 'Could not reject this account.');
            return;
        }
        pendingVerifyId = null;
        document.getElementById('modal-verify').hidden = true;
        await loadUsers();
    });
}

function openVerifyModal(id) {
    const user = allUsers.find(u => u.id === id);
    if (!user) return;
    pendingVerifyId = id;

    setEl('verify-name',     user.name);
    setEl('verify-email',    user.email);
    setEl('verify-barangay', user.barangay || '—');

    const idImg     = document.getElementById('verify-id-img');
    const pdfBox     = document.getElementById('verify-id-pdf');
    const pdfName    = document.getElementById('verify-id-pdf-name');
    const emptyState = document.getElementById('verify-id-empty');
    const fullLink   = document.getElementById('verify-fullsize-link');

    const docPath = user.idImage || '';
    const isPdf   = /\.pdf($|\?)/i.test(docPath) || /\.pdf$/i.test(user.proofName || '');

    if (idImg)     idImg.hidden = true;
    if (pdfBox)    pdfBox.hidden = true;
    if (emptyState) { emptyState.hidden = true; emptyState.textContent = 'No document was uploaded.'; }

    if (!docPath) {
        if (emptyState) emptyState.hidden = false;
        if (fullLink) { fullLink.removeAttribute('href'); fullLink.style.pointerEvents = 'none'; fullLink.style.opacity = '0.5'; }
    } else if (isPdf) {
        if (pdfBox) pdfBox.hidden = false;
        if (pdfName) pdfName.textContent = user.proofName || 'Uploaded document.pdf';
        if (fullLink) { fullLink.href = docPath; fullLink.style.pointerEvents = ''; fullLink.style.opacity = ''; }
    } else {
        if (idImg) {
            idImg.hidden = false;
            idImg.onerror = () => {
                idImg.hidden = true;
                if (emptyState) {
                    emptyState.hidden = false;
                    emptyState.textContent = 'Document file is missing from storage.';
                }
            };
            idImg.src = docPath;
        }
        if (fullLink) { fullLink.href = docPath; fullLink.style.pointerEvents = ''; fullLink.style.opacity = ''; }
    }

    document.getElementById('modal-verify').hidden = false;
}

/* ── Actions ────────────────────────────────────────────────── */
async function handleReject(id) {
    const user = allUsers.find(u => u.id === id);
    if (!user) return;
    if (!confirm(`Reject application for ${user.name}?`)) return;

    const result = await api.rejectUser(id).catch(() => ({ success: false }));
    if (!result.success) {
        alert(result.message || 'Could not reject this account.');
        return;
    }
    await loadUsers();
}

/* ── Helpers ─────────────────────────────────────────────────── */
function roleClass(label) {
    const map = {
        'Veterinarian':     'am-role-vet',
        'Veterinarian I':   'am-role-vet-i',
        'Veterinarian II':  'am-role-vet-ii',
        'Veterinarian III': 'am-role-vet-iii',
        'Pet Owner':        'am-role-owner',
        'Administrator':    'am-role-admin',
        'vet':              'am-role-vet',
        'owner':            'am-role-owner',
        'admin':             'am-role-admin',
    };
    return map[label] || 'am-role-vet';
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function setEl(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

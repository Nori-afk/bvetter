/**
 * VBetter – Account Management JS
 * [BACKEND] Replace MOCK_USERS with real API calls.
 */

'use strict';

/* ── Mock data ──────────────────────────────────────────────── */
const MOCK_USERS = [
    { id: 'U-001', name: 'Dr. Sarah Smith',      email: 'sarah.s@vetclinic.com',        role: 'vet',   roleLabel: 'Veterinarian I',   status: 'active',   created: '2023-01-15', phone: '09171234567', barangay: 'Poblacion', avatar: '' },
    { id: 'U-002', name: 'Mark Johnson',          email: 'm.johnson@vetclinic.com',      role: 'vet',   roleLabel: 'Veterinarian II',  status: 'blocked',  created: '2023-03-10', phone: '09991234567', barangay: 'Tangos',    avatar: '' },
    { id: 'U-003', name: 'Dr. Alan Grant',        email: 'a.grant@vetclinic.com',        role: 'vet',   roleLabel: 'Veterinarian III', status: 'active',   created: '2023-05-01', phone: '09181234567', barangay: 'San Jose',  avatar: '' },
    { id: 'U-004', name: 'Mark Ivan Villaster',   email: 'Markivanvillaster@gmail.com',  role: 'owner', roleLabel: 'Pet Owner',        status: 'pending',  created: '2023-05-01', phone: '09271234567', barangay: 'Tangos',    avatar: '', idImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Sport_template_blank.svg/320px-Sport_template_blank.svg.png' },
    { id: 'U-005', name: 'Maria Santos',          email: 'maria@mail.com',               role: 'owner', roleLabel: 'Pet Owner',        status: 'active',   created: '2024-04-02', phone: '09361234567', barangay: 'San Roque', avatar: '' },
    { id: 'U-006', name: 'Juan dela Cruz',        email: 'juan@mail.com',                role: 'owner', roleLabel: 'Pet Owner',        status: 'inactive', created: '2024-05-20', phone: '09051234567', barangay: 'Wawa',      avatar: '' },
    { id: 'U-007', name: 'Admin User',            email: 'admin@vbetter.ph',             role: 'admin', roleLabel: 'Administrator',    status: 'active',   created: '2024-01-01', phone: '09201234567', barangay: 'Poblacion', avatar: '' },
    { id: 'U-008', name: 'Dr. Kizea Bien Igaya',  email: 'vet@vbetter.ph',               role: 'vet',   roleLabel: 'Veterinarian III', status: 'active',   created: '2024-01-10', phone: '09991010101', barangay: 'San Jose',  avatar: '' },
];

const PAGE_SIZE = 5;
let allUsers      = [...MOCK_USERS];
let filteredUsers = [...allUsers];
let currentTab    = 'all';
let currentPage   = 1;
let pendingDeleteId = null;
let pendingVerifyId = null;

/* ── Init ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    updateKPIs();
    renderTable();
    wireTabs();
    wireSearch();
    wireAddModal();
    wireEditModal();
    wireUnblockModal();
    wireDeleteModal();
    wireVerifyModal();
    wirePagination();
    wireCloseButtons();
});

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

        // Action buttons
        let actionsEl = `
            <button class="am-btn-edit" onclick="openEditModal('${u.id}')" title="Edit user">
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            </button>
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
        ['add-acc-name','add-acc-phone','add-acc-email','add-acc-password'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = ''; el.classList.remove('dash-error'); }
        });
        const roleEl = document.getElementById('add-acc-role');
        const statusEl = document.getElementById('add-acc-status');
        if (roleEl)   roleEl.value = '';
        if (statusEl) statusEl.value = 'active';
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
        const role  = document.getElementById('add-acc-role')?.value;
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

        return ok;
    }

    submitBtn?.addEventListener('click', () => {
        if (!validate()) return;

        const name   = document.getElementById('add-acc-name').value.trim();
        const email  = document.getElementById('add-acc-email').value.trim();
        const role   = document.getElementById('add-acc-role').value;
        const status = document.getElementById('add-acc-status').value;
        const phone  = document.getElementById('add-acc-phone')?.value.trim();

        const roleLabels = { admin: 'Administrator', vet: 'Veterinarian I', owner: 'Pet Owner' };

        allUsers.unshift({
            id:        `U-${String(Date.now()).slice(-5)}`,
            name, email, role, phone: phone || '—',
            roleLabel: roleLabels[role] || capitalize(role),
            status:    status || 'active',
            created:   new Date().toISOString().slice(0, 10),
            barangay:  '—',
            avatar:    ''
        });

        closeModal();
        updateKPIs();
        applyFilters();
    });
}

/* ── EDIT USER MODAL ────────────────────────────────────────── */
function wireEditModal() {
    document.getElementById('edit-submit')?.addEventListener('click', () => {
        const id = document.getElementById('edit-user-id')?.value;
        const user = allUsers.find(u => u.id === id);
        if (!user) return;

        user.name   = document.getElementById('edit-name')?.value.trim() || user.name;
        user.email  = document.getElementById('edit-email')?.value.trim() || user.email;
        user.phone  = document.getElementById('edit-phone')?.value.trim() || user.phone;
        user.role   = document.getElementById('edit-role')?.value || user.role;
        user.status = document.getElementById('edit-status')?.value || user.status;

        const roleLabels = { admin: 'Administrator', vet: 'Veterinarian I', owner: 'Pet Owner' };
        user.roleLabel = roleLabels[user.role];

        document.getElementById('modal-edit').hidden = true;
        updateKPIs();
        applyFilters();
    });

    wirePhotoPreview('edit-photo-input', 'edit-photo-preview');
}

function openEditModal(id) {
    const user = allUsers.find(u => u.id === id);
    if (!user) return;

    document.getElementById('edit-user-id').value = id;
    document.getElementById('edit-name').value    = user.name;
    document.getElementById('edit-email').value   = user.email;
    document.getElementById('edit-phone').value   = user.phone || '';
    setSelectValue('edit-role',   user.role);
    setSelectValue('edit-status', user.status);

    document.getElementById('modal-edit').hidden = false;
}

/* ── UNBLOCK MODAL ──────────────────────────────────────────── */
function wireUnblockModal() {
    document.getElementById('unblock-confirm-btn')?.addEventListener('click', () => {
        const id = document.getElementById('unblock-user-id')?.value;
        const user = allUsers.find(u => u.id === id);
        if (!user) return;
        user.status = 'active';
        document.getElementById('modal-unblock').hidden = true;
        updateKPIs();
        applyFilters();
    });

    document.getElementById('unblock-save-btn')?.addEventListener('click', () => {
        const id = document.getElementById('unblock-user-id')?.value;
        const user = allUsers.find(u => u.id === id);
        if (!user) return;
        user.phone  = document.getElementById('unblock-phone')?.value.trim() || user.phone;
        user.status = document.getElementById('unblock-status')?.value || user.status;
        document.getElementById('modal-unblock').hidden = true;
        updateKPIs();
        applyFilters();
    });

    wirePhotoPreview('unblock-photo-input', 'unblock-photo-preview');
}

function openUnblockModal(id) {
    const user = allUsers.find(u => u.id === id);
    if (!user) return;

    document.getElementById('unblock-user-id').value = id;
    document.getElementById('unblock-name').value    = user.name;
    document.getElementById('unblock-email').value   = user.email;
    document.getElementById('unblock-phone').value   = user.phone || '';
    setSelectValue('unblock-role',   user.role);
    setSelectValue('unblock-status', user.status);

    document.getElementById('modal-unblock').hidden = false;
}

/* ── DELETE MODAL ───────────────────────────────────────────── */
function wireDeleteModal() {
    document.getElementById('delete-confirm-btn')?.addEventListener('click', () => {
        if (!pendingDeleteId) return;
        allUsers = allUsers.filter(u => u.id !== pendingDeleteId);
        pendingDeleteId = null;
        document.getElementById('modal-delete').hidden = true;
        updateKPIs();
        applyFilters();
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
    document.getElementById('verify-approve-btn')?.addEventListener('click', () => {
        if (!pendingVerifyId) return;
        const user = allUsers.find(u => u.id === pendingVerifyId);
        if (user) user.status = 'active';
        pendingVerifyId = null;
        document.getElementById('modal-verify').hidden = true;
        updateKPIs();
        applyFilters();
    });

    document.getElementById('verify-reject-btn')?.addEventListener('click', () => {
        if (!pendingVerifyId) return;
        const user = allUsers.find(u => u.id === pendingVerifyId);
        if (user) user.status = 'inactive';
        pendingVerifyId = null;
        document.getElementById('modal-verify').hidden = true;
        updateKPIs();
        applyFilters();
    });
}

function openVerifyModal(id) {
    const user = allUsers.find(u => u.id === id);
    if (!user) return;
    pendingVerifyId = id;

    setEl('verify-name',     user.name);
    setEl('verify-email',    user.email);
    setEl('verify-barangay', user.barangay || '—');

    const idImg = document.getElementById('verify-id-img');
    if (idImg) {
        idImg.src = user.idImage || 'https://placehold.co/500x300?text=No+ID+Uploaded';
    }

    document.getElementById('modal-verify').hidden = false;
}

/* ── Actions ────────────────────────────────────────────────── */
function handleReject(id) {
    const user = allUsers.find(u => u.id === id);
    if (!user) return;
    if (!confirm(`Reject application for ${user.name}?`)) return;
    allUsers = allUsers.filter(u => u.id !== id);
    updateKPIs();
    applyFilters();
}

/* ── Photo preview helper ───────────────────────────────────── */
function wirePhotoPreview(inputId, previewId) {
    const input   = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;

    input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="Preview">`;
        };
        reader.readAsDataURL(file);
    });
}

/* ── Helpers ─────────────────────────────────────────────────── */
function roleClass(label) {
    const map = {
        'Veterinarian I':   'am-role-vet-i',
        'Veterinarian II':  'am-role-vet-ii',
        'Veterinarian III': 'am-role-vet-iii',
        'Pet Owner':        'am-role-owner',
        'Administrator':    'am-role-admin',
        'vet':              'am-role-vet',
        'owner':            'am-role-owner',
        'admin':            'am-role-admin',
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

function setSelectValue(selectId, value) {
    const el = document.getElementById(selectId);
    if (!el) return;
    for (let opt of el.options) {
        if (opt.value === value) { opt.selected = true; break; }
    }
}

function clearFormById(textIds = [], selectIds = []) {
    textIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    selectIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.selectedIndex = 0;
    });
}
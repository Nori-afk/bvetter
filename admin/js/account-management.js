/**
 * VBetter - Account Management
 * Loads users from PHP and lets admin approve/reject pet owner verification.
 */

// 'use strict';

let allUsers = [];
let filteredUsers = [];
let currentTab = 'all';
let currentPage = 1;
let pendingVerifyId = null;
let pendingDeleteId = null;
const PAGE_SIZE = 5;

document.addEventListener('DOMContentLoaded', async () => {
    const searchInput = document.getElementById('search-users');
    if (searchInput) searchInput.value = '';

    wireTabs();
    wireSearch();
    wireVerifyModal();
    wireCloseButtons();
    wirePagination();
    wireCreateModal();
    wireDeleteModal();
    wireTableActions();
    await loadRoles();
    await loadUsers();
});

async function loadUsers() {
    const tbody = document.getElementById('user-table-body');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="5" class="am-loading-cell">Loading users...</td></tr>';
    }

    try {
        const result = await api.allUsers();
        if (!result.success) {
            alert(result.message || 'Failed to load users.');
            allUsers = [];
        } else {
            allUsers = Array.isArray(result.data) ? result.data : [];
        }
    } catch (error) {
        alert('Error loading users. Please try again.');
        allUsers = [];
    }

    applyFilters();
    updateKPIs();
}

function updateKPIs() {
    setEl('kpi-total', allUsers.length);
    setEl('kpi-vet', allUsers.filter(u => u.role === 'vet' && u.status === 'active').length);
    setEl('kpi-blocked', allUsers.filter(u => u.status === 'blocked').length);
    setEl('kpi-new-label', `${allUsers.filter(u => u.status === 'pending').length} Pending Accounts`);
}

function applyFilters() {
    const search = (document.getElementById('search-users')?.value || '').toLowerCase();

    filteredUsers = allUsers.filter(user => {
        const matchTab = currentTab === 'all' || user.role === currentTab;
        const matchSearch = !search ||
            (user.name || '').toLowerCase().includes(search) ||
            (user.email || '').toLowerCase().includes(search);

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

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageUsers = filteredUsers.slice(start, start + PAGE_SIZE);

    setEl('showing-label', `Showing ${pageUsers.length} of ${filteredUsers.length} members`);

    if (!pageUsers.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="am-loading-cell">No users found.</td></tr>';
        setPaginationButtons(totalPages);
        return;
    }

    tbody.innerHTML = pageUsers.map(user => {
        const name = escapeHtml(user.name || 'Unknown User');
        const email = escapeHtml(user.email || '');
        const initials = name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();
        const avatarEl = user.avatar
            ? `<img class="am-avatar" src="${escapeAttr(user.avatar)}" alt="${name}">`
            : `<div class="am-avatar-placeholder">${initials || '?'}</div>`;

        return `
            <tr data-id="${escapeAttr(user.id)}">
                <td>
                    <div class="am-user-cell">
                        ${avatarEl}
                        <div>
                            <span class="am-user-name">${name}</span>
                            <span class="am-user-email">${email}</span>
                        </div>
                    </div>
                </td>
                <td><span class="am-role-badge ${roleClass(user.role)}">${escapeHtml(user.roleLabel || user.role)}</span></td>
                <td><span class="am-status ${escapeAttr(user.status)}"><span class="am-status-dot"></span>${capitalize(user.status)}</span></td>
                <td>${formatDate(user.created)}</td>
                <td><div class="am-actions-cell">${renderActions(user)}</div></td>
            </tr>`;
    }).join('');

    setPaginationButtons(totalPages);
}

function renderActions(user) {
    const id = escapeAttr(user.id);
    const buttons = [];

    if (user.status === 'pending') {
        buttons.push(`<button class="am-btn-approve" onclick="openVerifyModal('${id}')">Review</button>`);
    }

    buttons.push(`
        <button class="am-btn-delete" onclick="openDeleteModal('${id}')" data-delete-user="${id}" title="Delete account" aria-label="Delete account" type="button">
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="#E53E3E" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 6V4h8v2"></path>
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 6l-1 14H6L5 6"></path>
                <path stroke-linecap="round" stroke-linejoin="round" d="M10 11v6"></path>
                <path stroke-linecap="round" stroke-linejoin="round" d="M14 11v6"></path>
            </svg>
        </button>`);

    return buttons.join('');
}

function openDeleteModal(id) {
    const user = allUsers.find(item => String(item.id) === String(id));
    if (!user) return;

    pendingDeleteId = user.id;

    setEl('delete-user-name', user.name || 'User');

    const avatar = document.getElementById('delete-avatar');
    if (avatar) {
        const profilePhoto = user.avatar || user.profile_photo || '';
        console.log('User avatar for delete modal:', profilePhoto);

        if (profilePhoto) {
            avatar.outerHTML = `<img id="delete-avatar" src="${escapeAttr(profilePhoto)}" alt="${escapeAttr(user.name || 'User')}" />`;
        } else {
            const initials = (user.name || 'U')
                .split(' ')
                .map(part => part.charAt(0))
                .join('')
                .slice(0, 2)
                .toUpperCase();
            avatar.outerHTML = `<div class="am-avatar-placeholder-lg" id="delete-avatar">${escapeHtml(initials || '?')}</div>`;
        }
    }

    const modal = document.getElementById('modal-delete');
    if (modal) modal.hidden = false;
}

async function confirmDeleteAccount() {
    if (!pendingDeleteId) return;

    try {
        const result = await api.deleteUser(pendingDeleteId);
        if (!result.success) {
            alert(result.message || 'Failed to delete account.');
            return;
        }

        pendingDeleteId = null;
        closeModal('modal-delete');
        await loadUsers();
    } catch (error) {
        alert('Failed to delete account. Please try again.');
    }
}

function wireTabs() {
    document.querySelectorAll('.am-tab').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.am-tab').forEach(tab => tab.classList.remove('active'));
            button.classList.add('active');
            currentTab = button.dataset.tab;
            applyFilters();
        });
    });
}

function wireSearch() {
    document.getElementById('search-users')?.addEventListener('input', applyFilters);
}

function wirePagination() {
    document.getElementById('prev-page')?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTable();
        }
    });

    document.getElementById('next-page')?.addEventListener('click', () => {
        const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
        if (currentPage < totalPages) {
            currentPage++;
            renderTable();
        }
    });
}

function wireTableActions() {
    document.getElementById('user-table-body')?.addEventListener('click', event => {
        const deleteButton = event.target.closest('[data-delete-user]');
        if (deleteButton) {
            openDeleteModal(deleteButton.getAttribute('data-delete-user'));
        }
    });
}

function wireDeleteModal() {
    document.getElementById('delete-confirm-btn')?.addEventListener('click', confirmDeleteAccount);
}

function setPaginationButtons(totalPages) {
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
}

function wireVerifyModal() {
    document.getElementById('verify-approve-btn')?.addEventListener('click', async () => {
        if (!pendingVerifyId) return;

        const result = await api.approveUser(pendingVerifyId);
        if (!result.success) {
            alert(result.message || 'Failed to approve account.');
            return;
        }

        pendingVerifyId = null;
        closeModal('modal-verify');
        await loadUsers();
    });

    document.getElementById('verify-reject-btn')?.addEventListener('click', async () => {
        if (!pendingVerifyId) return;

        const reason = prompt('Reason for rejection:') || '';
        const result = await api.rejectUser(pendingVerifyId, reason);
        if (!result.success) {
            alert(result.message || 'Failed to reject account.');
            return;
        }

        pendingVerifyId = null;
        closeModal('modal-verify');
        await loadUsers();
    });
}

function openVerifyModal(id) {
    const user = allUsers.find(item => String(item.id) === String(id));
    if (!user) return;

    pendingVerifyId = user.id;

    setEl('verify-name', user.name || '-');
    setEl('verify-email', user.email || '-');
    setEl('verify-barangay', user.barangay || '-');

    const image = document.getElementById('verify-id-img');
    if (image) {
        image.src = user.idImage || 'https://placehold.co/500x300?text=No+Document+Uploaded';
    }

    const fullSizeLink = document.querySelector('.am-verify-fullsize');
    if (fullSizeLink) {
        fullSizeLink.href = user.idImage || '#';
        fullSizeLink.target = user.idImage ? '_blank' : '';
    }

    document.getElementById('modal-verify').hidden = false;
}

function wireCloseButtons() {
    document.querySelectorAll('[data-close]').forEach(button => {
        button.addEventListener('click', () => closeModal(button.getAttribute('data-close')));
    });

    document.querySelectorAll('.am-modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', event => {
            if (event.target === overlay) overlay.hidden = true;
        });
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            document.querySelectorAll('.am-modal-overlay:not([hidden])').forEach(modal => modal.hidden = true);
        }
    });
}

async function loadRoles() {
    const select = document.getElementById('add-role');
    if (!select) return;

    try {
        const result = await api.accountRoles();

        if (!result.success) {
            select.innerHTML = '<option value="">Failed to load roles</option>';
            return;
        }

        select.innerHTML = '<option value="">Select Role</option>';
        result.data.forEach(role => {
            const option = document.createElement('option');
            option.value = role.id;
            option.dataset.roleName = role.name;
            option.dataset.frontendRole = role.frontendRole;
            option.textContent = role.label;
            select.appendChild(option);
        });

        toggleVetFields();
    } catch (error) {
        select.innerHTML = '<option value="">Failed to load roles</option>';
    }
}

function wireCreateModal() {
    document.getElementById('btn-add-user')?.addEventListener('click', () => {
        const modal = document.getElementById('modal-add');
        if (modal) modal.hidden = false;
    });

    document.getElementById('add-role')?.addEventListener('change', toggleVetFields);
    document.getElementById('add-submit')?.addEventListener('click', createAccount);
    document.getElementById('add-photo-input')?.addEventListener('change', previewAddPhoto);
}

function toggleVetFields() {
    const roleSelect = document.getElementById('add-role');
    const selected = roleSelect?.selectedOptions[0];
    const isVet = selected?.dataset.roleName === 'veterinarian';

    const vetFields = document.getElementById('vet-additional-fields');
    if (vetFields) vetFields.style.display = isVet ? 'block' : 'none';

    const positionWrap = document.getElementById('add-position-wrap');
    if (positionWrap) positionWrap.style.display = isVet ? 'block' : 'none';
}

async function createAccount() {
    const roleSelect = document.getElementById('add-role');
    const selected = roleSelect?.selectedOptions[0];
    const isVet = selected?.dataset.roleName === 'veterinarian';

    const fullName = document.getElementById('add-name')?.value.trim() || '';
    const email = document.getElementById('add-email')?.value.trim() || '';
    const password = document.getElementById('add-password')?.value || '';
    const roleId = roleSelect?.value || '';

    if (!fullName || !email || !password || !roleId) {
        alert('Full name, email, password, and role are required.');
        return;
    }

    const formData = new FormData();
    formData.append('full_name', fullName);
    formData.append('email', email);
    formData.append('password', password);
    formData.append('role_id', roleId);
    formData.append('phone_number', document.getElementById('add-phone')?.value.trim() || '');
    formData.append('account_status', document.getElementById('add-status')?.value || 'active');

    const photo = document.getElementById('add-photo-input')?.files[0];
    if (photo) formData.append('profile_photo', photo);

    if (isVet) {
        formData.append('position_title', document.getElementById('add-position-title')?.value.trim() || 'Veterinarian');
        formData.append('education', document.getElementById('add-education')?.value.trim() || '');
        formData.append('specialization', document.getElementById('add-specialization')?.value.trim() || '');
        formData.append('license_number', document.getElementById('add-license')?.value.trim() || '');
        formData.append('clinic_location', document.getElementById('add-clinic-location')?.value.trim() || '');
    }

    try {
        const result = await api.createAccountUser(formData);
        if (!result.success) {
            alert(result.message || 'Failed to create account.');
            return;
        }

        closeModal('modal-add');
        clearCreateForm();
        await loadUsers();
        alert('Account created successfully.');
    } catch (error) {
        alert('Failed to create account. Please try again.');
    }
}

function previewAddPhoto() {
    const input = document.getElementById('add-photo-input');
    const preview = document.getElementById('add-photo-preview');
    if (!input?.files[0] || !preview) return;

    const reader = new FileReader();
    reader.onload = event => {
        preview.innerHTML = `<img src="${event.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="Preview">`;
    };
    reader.readAsDataURL(input.files[0]);
}

function clearCreateForm() {
    [
        'add-name',
        'add-phone',
        'add-email',
        'add-password',
        'add-position-title',
        'add-education',
        'add-specialization',
        'add-license',
        'add-clinic-location',
    ].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });

    const role = document.getElementById('add-role');
    if (role) role.selectedIndex = 0;

    const status = document.getElementById('add-status');
    if (status) status.value = 'active';

    const photo = document.getElementById('add-photo-input');
    if (photo) photo.value = '';

    const preview = document.getElementById('add-photo-preview');
    if (preview) {
        preview.innerHTML = '<svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><circle cx="12" cy="13" r="3"/></svg>';
    }

    toggleVetFields();
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.hidden = true;

    if (id === 'modal-delete') {
        pendingDeleteId = null;
    }
}

function roleClass(role) {
    const map = {
        vet: 'am-role-vet',
        owner: 'am-role-owner',
        admin: 'am-role-admin',
    };
    return map[role] || 'am-role-owner';
}

function capitalize(value) {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function setEl(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

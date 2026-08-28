/**
 * BVetter – Account Management JS
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
let pendingBlockId   = null;

/* ── Init ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
    wireTabs();
    wireSearch();
    wireAddModal();
    wireUnblockModal();
    wireBlockModal();
    wireDeleteModal();
    wireVerifyModal();
    wirePagination();
    wireCloseButtons();

    await Promise.all([loadRoles(), loadUsers()]);

    // Deep link from the notification bell / staff alert email: both send
    // the admin here with ?review=<user_id> instead of making them find the
    // applicant by hand. Runs only after loadUsers() has populated allUsers,
    // since openVerifyModal looks the id up there.
    //
    // Kept as a string, not Number(...) — listUsers() casts id to (string) in
    // its JSON response (see account-management.php), and openVerifyModal's
    // lookup is a strict `u.id === id`, same as every other caller here (e.g.
    // the onclick="openVerifyModal('${u.id}')" above). A numeric id would
    // never match and the deep link would silently do nothing.
    const reviewId = new URLSearchParams(window.location.search).get('review');
    if (reviewId) openVerifyModal(reviewId);
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


function wireCloseButtons() {
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-close');
            const el = document.getElementById(id);
            if (el) el.hidden = true;
        });
    });
    document.querySelectorAll('.am-modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.hidden = true;
        });
    });
    
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.am-modal-overlay:not([hidden]), .dash-overlay:not([hidden])').forEach(o => o.hidden = true);
        }
    });
}

/*  KPIs */
function updateKPIs() {
    setEl('kpi-total',   allUsers.length);
    setEl('kpi-vet',     allUsers.filter(u => u.role === 'vet' && u.status === 'active').length);
    setEl('kpi-blocked', allUsers.filter(u => u.status === 'blocked').length);
}

/* Table */
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
        // u.name, u.email and u.avatar all come from user-controlled
        // registration data and land in an administrator's browser, so they
        // are escaped before being interpolated. Note the alt attribute too:
        // an unescaped value there breaks out of the attribute just as
        // easily as one in element text.
        const esc = window.vbEscapeHtml;
        const initials = u.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
        const avatarEl = u.avatar
            ? `<img class="am-avatar" src="${esc(u.avatar)}" alt="${esc(u.name)}">`
            : `<div class="am-avatar-placeholder">${esc(initials)}</div>`;

        const roleCss = roleClass(u.roleLabel || u.role);

        const blockedTitle = u.status === 'blocked' && u.blockedReason === 'inactivity'
            ? ' title="Blocked automatically for inactivity"'
            : u.status === 'blocked' && u.blockedReason === 'failed_login'
                ? ' title="Blocked after repeated failed login attempts"'
                : u.status === 'blocked' && u.blockedReason === 'user_request'
                    ? ' title="The owner closed this account themselves from Account Settings"'
                    : '';

        // The other two reasons stay hover-only: both are things the system did
        // TO the user, and unblocking is the expected remedy. This one is the
        // user's own decision, so it is spelled out on the row -- restoring an
        // account someone deliberately closed is the mistake worth preventing,
        // and a tooltip is too easy to skim past.
        const selfClosed = u.status === 'blocked' && u.blockedReason === 'user_request'
            ? '<span class="am-status-note"> · Left by request</span>'
            : '';
        const statusEl = `<span class="am-status ${u.status}"${blockedTitle}><span class="am-status-dot"></span>${capitalize(u.status)}${selfClosed}</span>`;

        let actionsEl = `
            <button class="am-btn-delete" onclick="openDeleteModal('${u.id}')" title="Delete user">
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#E53E3E" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path stroke-linecap="round" stroke-linejoin="round" d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m5 0V4a1 1 0 011-1h2a1 1 0 011 1v2"/></svg>
            </button>`;

        if (u.status === 'blocked') {
            actionsEl = `<button class="am-btn-unblock" onclick="openUnblockModal('${u.id}')">Unblock</button>${actionsEl}`;
        } else if (u.status === 'active' || u.status === 'inactive') {
            actionsEl = `<button class="am-btn-block" onclick="openBlockModal('${u.id}')">Block</button>${actionsEl}`;
        }

        if (u.status === 'pending') {
            actionsEl = `
                <button class="am-btn-approve" onclick="openVerifyModal('${u.id}')">Approve</button>
                <button class="am-btn-reject"  onclick="handleReject('${u.id}')">Reject</button>
                ${actionsEl}`;
        }

        // A walk-in is someone a vet entered at the counter, not an app member:
        // never logged in, and usually carrying a synthetic owner_<hash>
        // address that exists only to satisfy the UNIQUE constraint on
        // users.email. Rendering that hash as if it were a real contact
        // address is what made 44 rows read as 44 registered users.
        const walkInTag = u.isWalkIn
            ? '<span class="am-walkin-tag" title="Added by a vet from a clinic visit. This person has never signed in.">Walk-in</span>'
            : '';
        const emailEl = u.emailIsPlaceholder
            ? '<span class="am-email-none">No email on file</span>'
            : esc(u.email);

        return `
            <tr data-id="${u.id}">
                <td>
                    <div class="am-user-cell">
                        ${avatarEl}
                        <div>
                            <span class="am-user-name">${esc(u.name)}${walkInTag}</span>
                            <span class="am-user-email">${emailEl}</span>
                        </div>
                    </div>
                </td>
                <td><span class="am-role-badge ${roleCss}">${esc(u.roleLabel || capitalize(u.role))}</span></td>
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

/*  ADD USER MODAL (dash-* form) */
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
        ['add-acc-name','add-acc-phone','add-acc-email','add-acc-password','add-acc-specialization','add-acc-education','add-acc-clinic'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = ''; el.classList.remove('dash-error'); }
        });
        if (roleSelect)  roleSelect.value = '';
        const statusEl = document.getElementById('add-acc-status');
        if (statusEl) statusEl.value = 'active';
        const bookableEl = document.getElementById('add-acc-bookable');
        if (bookableEl) bookableEl.checked = true;
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
        else {
            const pwError = window.PasswordPolicy
                ? PasswordPolicy.validate(pw)
                : (pw.length < 12 ? 'Minimum 12 characters.' : null);
            if (pwError) err('add-acc-password', pwError);
        }

        const isVet = roleSelect?.selectedOptions[0]?.dataset.frontendRole === 'vet';
        if (isVet) {
            ['add-acc-specialization', 'add-acc-education', 'add-acc-clinic'].forEach(id => {
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
            formData.append('specialization', document.getElementById('add-acc-specialization').value.trim());
            formData.append('education', document.getElementById('add-acc-education').value.trim());
            formData.append('clinic_location', document.getElementById('add-acc-clinic').value.trim());
            formData.append('is_bookable', document.getElementById('add-acc-bookable')?.checked ? '1' : '0');
        }

        if (photoInput?.files[0]) formData.append('profile_photo', photoInput.files[0]);

        submitBtn.disabled = true;
        const result = await api.createAccountUser(formData).catch(() => ({ success: false }));
        submitBtn.disabled = false;

        if (!result.success) {
            await vbAlert(result.message || 'Could not create account.');
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
            await vbAlert(result.message || 'Could not unblock this account.');
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

/* ── BLOCK MODAL ────────────────────────────────────────────── */
function wireBlockModal() {
    document.getElementById('block-confirm-btn')?.addEventListener('click', async () => {
        if (!pendingBlockId) return;
        const result = await api.updateUserStatus(pendingBlockId, 'blocked').catch(() => ({ success: false }));
        if (!result.success) {
            await vbAlert(result.message || 'Could not block this account.');
            return;
        }
        pendingBlockId = null;
        document.getElementById('modal-block').hidden = true;
        await loadUsers();
    });
}

function openBlockModal(id) {
    const user = allUsers.find(u => u.id === id);
    if (!user) return;
    pendingBlockId = id;

    document.getElementById('block-user-id').value = id;
    setEl('block-name',  user.name);
    setEl('block-role',  user.roleLabel || capitalize(user.role));
    setEl('block-phone', user.phone || '—');
    setEl('block-email', user.email);

    document.getElementById('modal-block').hidden = false;
}

/* ── DELETE MODAL ───────────────────────────────────────────── */
function wireDeleteModal() {
    document.getElementById('delete-confirm-btn')?.addEventListener('click', async () => {
        if (!pendingDeleteId) return;
        const result = await api.deleteUser(pendingDeleteId).catch(() => ({ success: false }));
        if (!result.success) {
            await vbAlert(result.message || 'Could not delete this account.');
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

/*
 * Walk-in linking.
 *
 * pendingWalkIns holds the candidates last fetched for the open modal, and
 * selectedWalkInId the one the admin has picked. Both reset every time the
 * modal opens: a selection left over from the previous applicant is exactly
 * the mistake that would attach a stranger's medical history to the wrong
 * person.
 */
let pendingWalkIns    = [];
let selectedWalkInId  = '';

async function loadWalkInCandidates(userId) {
    pendingWalkIns = [];
    selectedWalkInId = '';

    const wrap = document.getElementById('verify-walkin-wrap');
    const list = document.getElementById('verify-walkin-list');
    if (!wrap || !list) return;

    wrap.hidden = true;
    list.innerHTML = '';

    const result = await api.walkInCandidates(userId).catch(() => ({ success: false }));
    // A registrant with no match is the normal case, so silence is correct
    // here -- the section simply stays hidden.
    if (!result.success || !Array.isArray(result.data) || result.data.length === 0) return;

    pendingWalkIns = result.data;
    renderWalkInCandidates();
    wrap.hidden = false;
}

function renderWalkInCandidates() {
    const esc = window.vbEscapeHtml;
    const list = document.getElementById('verify-walkin-list');
    if (!list) return;

    // Every card spells out what linking would actually transfer -- pets by
    // name, how many visits, when the last one was. This is the whole defence
    // against a mis-link: there is no unlink, so the mistake has to be caught
    // before the admin commits, not afterwards.
    const cards = pendingWalkIns.map((c) => {
        const pets = c.pets && c.pets.length
            ? c.pets.map(esc).join(', ')
            : 'no pets on file';
        const visits = c.visitCount === 1 ? '1 visit' : `${c.visitCount} visits`;
        const last = c.lastVisit ? `, last ${formatDate(c.lastVisit)}` : '';
        const checked = selectedWalkInId === c.id ? ' checked' : '';

        return `
            <label class="am-walkin-card${selectedWalkInId === c.id ? ' selected' : ''}">
                <input type="radio" name="walkin-pick" value="${esc(c.id)}"${checked}>
                <span class="am-walkin-body">
                    <span class="am-walkin-name">${esc(c.name)}</span>
                    <span class="am-walkin-meta">${esc(c.phone || 'no phone')} &middot; ${esc(c.barangay || 'no barangay')}</span>
                    <span class="am-walkin-detail">${pets} &middot; ${visits}${last}</span>
                    <span class="am-walkin-why">matched on ${esc(c.matchedOn)}</span>
                </span>
            </label>`;
    }).join('');

    // "None of these" is checked by default and is never removed. Linking must
    // always be a deliberate act, so the safe option is the resting state.
    list.innerHTML = cards + `
        <label class="am-walkin-card${selectedWalkInId === '' ? ' selected' : ''}">
            <input type="radio" name="walkin-pick" value=""${selectedWalkInId === '' ? ' checked' : ''}>
            <span class="am-walkin-body">
                <span class="am-walkin-name">None of these</span>
                <span class="am-walkin-meta">Approve as a brand-new account</span>
            </span>
        </label>`;

    list.querySelectorAll('input[name="walkin-pick"]').forEach((input) => {
        input.addEventListener('change', () => {
            selectedWalkInId = input.value;
            renderWalkInCandidates();
        });
    });
}

function wireVerifyModal() {
    document.getElementById('verify-approve-btn')?.addEventListener('click', async () => {
        if (!pendingVerifyId) return;

        const linkTo = pendingWalkIns.find(c => c.id === selectedWalkInId);

        if (linkTo) {
            const pets = linkTo.pets && linkTo.pets.length ? ` (${linkTo.pets.join(', ')})` : '';
            const ok = await vbConfirm(
                `Link this application to clinic record #${linkTo.id} for ${linkTo.name}? `
                + `The new account takes over ${linkTo.pets.length} pet(s)${pets} and `
                + `${linkTo.visitCount} visit record(s). This cannot be undone.`,
                'Link & Approve'
            );
            if (!ok) return;
        }

        const result = await api
            .approveUser(pendingVerifyId, linkTo ? linkTo.id : 0)
            .catch(() => ({ success: false }));

        if (!result.success) {
            await vbAlert(result.message || 'Could not approve this account.');
            return;
        }
        pendingVerifyId = null;
        pendingWalkIns = [];
        selectedWalkInId = '';
        document.getElementById('modal-verify').hidden = true;
        await loadUsers();
    });

    document.getElementById('verify-reject-btn')?.addEventListener('click', async () => {
        if (!pendingVerifyId) return;
        const result = await api.rejectUser(pendingVerifyId).catch(() => ({ success: false }));
        if (!result.success) {
            await vbAlert(result.message || 'Could not reject this account.');
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

    loadWalkInCandidates(id);

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
    if (!(await vbConfirm(`Reject application for ${user.name}?`, 'Reject'))) return;

    const result = await api.rejectUser(id).catch(() => ({ success: false }));
    if (!result.success) {
        await vbAlert(result.message || 'Could not reject this account.');
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

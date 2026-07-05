/* =============================================
   BVETTER — Account Settings JS
   File: js/account-settings.js
   Depends: nav.js, api.js

   Functions:
   - loadProfile()          — api.getProfile() on load, fills the form
   - (avatar upload preview)
   - (save profile)         — api.updateProfile(data)
   - (password modal open/close/confirm) — api.changePassword(data)
   - (pw eye toggles)
   - (2FA toggle)           — UI-only, no backend endpoint yet
   - (deactivate modal)     — UI-only, no backend endpoint yet
   - showToast(msg, type)
   ============================================= */

(function () {
  'use strict';

  const session = typeof getCurrentUser === 'function' ? getCurrentUser() : null;

  /* ── Load current profile into the form ───── */
  async function loadProfile() {
    if (!session) return;
    const result = await api.getProfile().catch(() => ({ success: false }));
    if (!result.success) {
      showToast(result.message || 'Could not load your profile.', 'error');
      return;
    }
    const profile = result.data;
    const nameInput = document.getElementById('inputFullName');
    const emailInput = document.getElementById('inputEmail');
    const phoneInput = document.getElementById('inputPhone');
    const avatarImg = document.getElementById('profileAvatarImg');
    const navName = document.querySelector('.nav-user-name');

    if (nameInput) nameInput.value = profile.fullName || '';
    if (emailInput) emailInput.value = profile.email || '';
    if (phoneInput) phoneInput.value = profile.phone || '';
    if (avatarImg && profile.avatarUrl) avatarImg.src = profile.avatarUrl;
    if (navName) navName.textContent = profile.fullName || session.name || 'Pet Owner';
  }

  document.addEventListener('DOMContentLoaded', loadProfile);

  /* ── Avatar upload preview ────────────────── */
  const avatarInput = document.getElementById('avatarFileInput');
  const avatarImg   = document.getElementById('profileAvatarImg');
  if (avatarInput && avatarImg) {
    avatarInput.addEventListener('change', function () {
      const file = avatarInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => { avatarImg.src = e.target.result; };
      reader.readAsDataURL(file);
    });
  }

  /* ── Save Profile ─────────────────────────── */
  const btnSave = document.getElementById('btnSaveProfile');
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const name  = document.getElementById('inputFullName')?.value || '';
      const email = document.getElementById('inputEmail')?.value    || '';
      const phone = document.getElementById('inputPhone')?.value    || '';
      if (!name.trim() || !email.trim()) {
        showToast('Please fill in all required fields.', 'error');
        return;
      }
      const result = await api.updateProfile({
        user_id: session?.userId,
        fullName: name.trim(),
        email: email.trim(),
        phone: phone.trim()
      }).catch(() => ({ success: false }));

      if (!result.success) {
        showToast(result.message || 'Could not save your profile.', 'error');
        return;
      }
      const navName = document.querySelector('.nav-user-name');
      if (navName) navName.textContent = result.data.fullName;
      showToast('Profile saved successfully.', 'success');
    });
  }

  /* ── Password Modal ───────────────────────── */
  const pwModal      = document.getElementById('pwModal');
  const btnUpdatePw  = document.getElementById('btnUpdatePw');
  const btnClosePw   = document.getElementById('btnClosePwModal');
  const btnCancelPw  = document.getElementById('btnCancelPw');
  const btnConfirmPw = document.getElementById('btnConfirmPw');

  if (btnUpdatePw) btnUpdatePw.addEventListener('click',  () => pwModal.classList.add('open'));
  if (btnClosePw)  btnClosePw .addEventListener('click',  () => pwModal.classList.remove('open'));
  if (btnCancelPw) btnCancelPw.addEventListener('click',  () => pwModal.classList.remove('open'));
  if (pwModal)     pwModal    .addEventListener('click',  e => { if (e.target === pwModal) pwModal.classList.remove('open'); });

  if (btnConfirmPw) {
    btnConfirmPw.addEventListener('click', async () => {
      const cur  = document.getElementById('inputCurrentPw')?.value || '';
      const next = document.getElementById('inputNewPw')?.value     || '';
      const conf = document.getElementById('inputConfirmPw')?.value || '';
      if (!cur || !next || !conf) { showToast('Fill in all password fields.', 'error'); return; }
      if (next.length < 8)        { showToast('New password must be at least 8 characters.', 'error'); return; }
      if (next !== conf)          { showToast('Passwords do not match.', 'error'); return; }

      const result = await api.changePassword({
        user_id: session?.userId,
        currentPassword: cur,
        newPassword: next
      }).catch(() => ({ success: false }));

      if (!result.success) {
        showToast(result.message || 'Could not update your password.', 'error');
        return;
      }

      pwModal.classList.remove('open');
      showToast('Password updated successfully.', 'success');
      ['inputCurrentPw', 'inputNewPw', 'inputConfirmPw'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    });
  }

  /* ── Password Eye Toggles ─────────────────── */
  document.querySelectorAll('.pw-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.getAttribute('data-target'));
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });
  });

  /* ── 2FA Toggle ─────────────────────────────
     No backend endpoint exists yet — this is still
     a UI-only demo toggle. See PROJECT NOTES below. */
  const btnManage  = document.getElementById('btnManage2FA');
  const twofaBadge = document.getElementById('twofaBadge');
  if (btnManage && twofaBadge) {
    btnManage.addEventListener('click', () => {
      const isEnabled = twofaBadge.classList.contains('enabled');
      twofaBadge.classList.toggle('enabled',  !isEnabled);
      twofaBadge.classList.toggle('disabled',  isEnabled);
      twofaBadge.textContent = isEnabled ? 'DISABLED' : 'ENABLED';
      showToast(isEnabled ? '2FA has been disabled.' : '2FA enabled.', 'success');
    });
  }

  /* ── Deactivate Modal ───────────────────────
     No backend endpoint exists yet — confirm button
     just closes the modal for now. */
  const deactivateModal     = document.getElementById('deactivateModal');
  const btnDeactivate       = document.getElementById('btnDeactivate');
  const btnCancelDeactivate = document.getElementById('btnCancelDeactivate');
  if (btnDeactivate)       btnDeactivate      .addEventListener('click', () => deactivateModal.classList.add('open'));
  if (btnCancelDeactivate) btnCancelDeactivate.addEventListener('click', () => deactivateModal.classList.remove('open'));
  if (deactivateModal)     deactivateModal    .addEventListener('click', e => { if (e.target === deactivateModal) deactivateModal.classList.remove('open'); });

  /* ── Escape key closes any open modal ──────── */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (pwModal)         pwModal.classList.remove('open');
      if (deactivateModal) deactivateModal.classList.remove('open');
    }
  });

  /* ── Toast notification ───────────────────── */
  let toastTimer = null;
  function showToast(msg, type) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'toast ' + (type || '');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

})();

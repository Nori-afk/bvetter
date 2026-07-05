/* =============================================
   BVETTER — Notification Settings JS
   File: js/notification-settings.js
   Depends: nav.js, api.js

   Functions:
   - loadNotifPrefs()      — api.getNotifPrefs() to set checkbox states
   - saveNotifPrefs()      — api.updateNotifPrefs() on checkbox change
   - (clear all history)
   - (configure schedule placeholder)

   NOTE — known backend/UI mismatch:
   The backend (api/users/profile.php) only stores ONE on/off
   switch per category (lostFoundAlerts, appointmentReminders,
   chatbotUpdates) — it does not track email/SMS/app separately.
   This page's UI has 3 channel checkboxes per row, so a row is
   treated as "on" if ANY of its 3 channel checkboxes is checked,
   and all 3 channels move together as one saved preference.

   Also: the 3rd row in this page is labeled "Claim Updates" but
   the backend column behind it is `chatbot_updates`. That is a
   pre-existing naming mismatch — flagging it here rather than
   silently renaming a database column.
   ============================================= */

(function () {
  'use strict';

  const ROW_TO_PREF = {
    lf: 'lostFoundAlerts',
    ar: 'appointmentReminders',
    cu: 'chatbotUpdates' // see NOTE above — UI row is "Claim Updates"
  };

  function rowCheckboxes(row) {
    return Array.from(document.querySelectorAll(`input[data-row="${row}"]`));
  }

  async function loadNotifPrefs() {
    const result = await api.getNotifPrefs().catch(() => ({ success: false }));
    if (!result.success) return;
    const prefs = result.data || {};
    Object.entries(ROW_TO_PREF).forEach(([row, prefKey]) => {
      const enabled = !!prefs[prefKey];
      rowCheckboxes(row).forEach(cb => { cb.checked = enabled; });
    });
  }

  async function saveNotifPrefs() {
    const payload = {};
    Object.entries(ROW_TO_PREF).forEach(([row, prefKey]) => {
      payload[prefKey] = rowCheckboxes(row).some(cb => cb.checked);
    });
    await api.updateNotifPrefs(payload).catch(() => ({ success: false }));
  }

  document.addEventListener('DOMContentLoaded', loadNotifPrefs);

  document.querySelectorAll('[data-row]').forEach(cb => {
    cb.addEventListener('change', saveNotifPrefs);
  });

  /* ── Clear notification history ─────────────
     TODO backend: DELETE /final-VBETTER/bvetter/api/notifications/history */
  const btnClear = document.querySelector('.btn-clear-all');
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      const list = document.querySelector('.history-list');
      if (list) {
        list.innerHTML = '<p style="font-size:13px;color:#737781;padding:16px 0;text-align:center;">No recent notifications.</p>';
      }
    });
  }

  /* ── Configure schedule (placeholder) ───────
     TODO backend: open modal → PATCH /final-VBETTER/bvetter/api/notifications/quiet-hours */
  const btnConfigure = document.querySelector('.btn-configure');
  if (btnConfigure) {
    btnConfigure.addEventListener('click', () => {
      alert('Schedule configuration coming soon.');
    });
  }

})();

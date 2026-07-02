/* =============================================
   BVETTER — Notification Settings JS
   File: js/notification-settings.js
   Depends: nav.js, api.js

   Functions:
   - (clear all history)
   - (configure schedule placeholder)
   - (checkbox state save)

   TODO backend:
   - On load: api.getNotifPrefs() to set checkbox states
   - On checkbox change: api.updateNotifPrefs(data)
   - Configure schedule: open schedule modal → PATCH /notifications/quiet-hours
   ============================================= */

(function () {
  'use strict';

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

  /* ── Checkbox preference saving ──────────────
     TODO backend: on each change, call:
     api.updateNotifPrefs(collectPrefs())

  function collectPrefs() {
    const prefs = {};
    document.querySelectorAll('[data-row]').forEach(cb => {
      const row     = cb.dataset.row;
      const channel = cb.dataset.channel;
      if (!prefs[row]) prefs[row] = {};
      prefs[row][channel] = cb.checked;
    });
    return prefs;
  }

  document.querySelectorAll('[data-row]').forEach(cb => {
    cb.addEventListener('change', () => api.updateNotifPrefs(collectPrefs()));
  });
  */

})();

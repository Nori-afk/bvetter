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

  /* ── Configure schedule ──────────────────────
     TODO backend: persist via PATCH /api/notifications/quiet-hours
     instead of localStorage once that endpoint exists.

     Times are stored internally as 24h "HH:MM" strings; the picker
     UI itself is 12h + AM/PM (hour/minute selects + pill toggle)
     to avoid the inconsistent native <input type="time"> widget. */
  const QUIET_HOURS_KEY = 'vbetter_quiet_hours';
  const btnConfigure     = document.querySelector('.btn-configure');
  const qhModal          = document.getElementById('quietHoursModal');
  const qhScheduleValue  = document.querySelector('.quiet-schedule-value');

  const qhStartHour   = document.getElementById('qhStartHour');
  const qhStartMinute = document.getElementById('qhStartMinute');
  const qhStartPeriod = document.getElementById('qhStartPeriod');
  const qhEndHour     = document.getElementById('qhEndHour');
  const qhEndMinute   = document.getElementById('qhEndMinute');
  const qhEndPeriod   = document.getElementById('qhEndPeriod');

  const MINUTE_STEP = 5;

  function populateTimeSelect(select, options) {
    if (!select) return;
    select.innerHTML = options.map((opt) => `<option value="${opt.value}">${opt.label}</option>`).join('');
  }

  [qhStartHour, qhEndHour].forEach((select) => {
    populateTimeSelect(select, Array.from({ length: 12 }, (_, i) => {
      const h = i + 1;
      return { value: h, label: String(h).padStart(2, '0') };
    }));
  });

  [qhStartMinute, qhEndMinute].forEach((select) => {
    populateTimeSelect(select, Array.from({ length: 60 / MINUTE_STEP }, (_, i) => {
      const m = i * MINUTE_STEP;
      return { value: m, label: String(m).padStart(2, '0') };
    }));
  });

  const qhStartHourUI   = enhanceNumberSelect(qhStartHour, 'qhStartHourWrap', 'qhStartHourTrigger', 'qhStartHourPanel');
  const qhStartMinuteUI = enhanceNumberSelect(qhStartMinute, 'qhStartMinuteWrap', 'qhStartMinuteTrigger', 'qhStartMinutePanel');
  const qhEndHourUI     = enhanceNumberSelect(qhEndHour, 'qhEndHourWrap', 'qhEndHourTrigger', 'qhEndHourPanel');
  const qhEndMinuteUI   = enhanceNumberSelect(qhEndMinute, 'qhEndMinuteWrap', 'qhEndMinuteTrigger', 'qhEndMinutePanel');

  function to12h(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    let hour = h % 12;
    if (hour === 0) hour = 12;
    return { hour, minute: m, period };
  }

  function to24h(hour, minute, period) {
    let h = Number(hour) % 12;
    if (period === 'PM') h += 12;
    return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function to12hLabel(hhmm) {
    const { hour, minute, period } = to12h(hhmm);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${period}`;
  }

  /* ── Custom numeral dropdown: mirrors a native <select> visually so
     the options panel is fully themeable (native <select> popups can't
     be styled at all — they render in the OS's own UI, which is what
     broke the dark picker). The real <select> stays in the DOM,
     visually hidden, as the source of truth for .value. ── */
  function enhanceNumberSelect(select, wrapId, triggerId, panelId) {
    const wrap    = document.getElementById(wrapId);
    const trigger = document.getElementById(triggerId);
    const panel   = document.getElementById(panelId);
    if (!select || !wrap || !trigger || !panel) return null;

    function syncLabel() {
      const opt = select.options[select.selectedIndex];
      trigger.textContent = opt ? opt.textContent : '';
    }

    function buildPanel() {
      panel.innerHTML = '';
      Array.from(select.options).forEach((opt) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'qh-num-option' + (opt.value === select.value ? ' selected' : '');
        item.setAttribute('role', 'option');
        item.textContent = opt.textContent;
        item.addEventListener('click', () => {
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          syncLabel();
          closePanel();
        });
        panel.appendChild(item);
      });
      panel.querySelector('.selected')?.scrollIntoView({ block: 'center' });
    }

    function openPanel() {
      buildPanel();
      wrap.classList.add('open');
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
    }

    function closePanel() {
      wrap.classList.remove('open');
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      if (panel.hidden) openPanel(); else closePanel();
    });

    document.addEventListener('click', (event) => {
      if (!wrap.contains(event.target)) closePanel();
    });

    select.addEventListener('change', syncLabel);
    syncLabel();

    return { syncLabel, closePanel };
  }

  function nearestMinuteOption(minute) {
    return Math.round(minute / MINUTE_STEP) * MINUTE_STEP % 60;
  }

  function setPeriodToggle(toggleEl, period) {
    toggleEl?.querySelectorAll('.qh-ampm-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.period === period);
    });
  }

  function getPeriodToggle(toggleEl) {
    return toggleEl?.querySelector('.qh-ampm-btn.active')?.dataset.period || 'AM';
  }

  [qhStartPeriod, qhEndPeriod].forEach((toggleEl) => {
    toggleEl?.querySelectorAll('.qh-ampm-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        setPeriodToggle(toggleEl, btn.dataset.period);
        updateNightVisual();
      });
    });
  });

  /* ── Night-window visual: coverage track + duration readout ──
     Positions are measured in minutes-from-noon (a 24h track that
     starts/ends at 12 PM) so a typical overnight window like
     10 PM → 7 AM renders as one unbroken segment instead of
     wrapping across the array boundary. */
  const qhTrackFillA = document.getElementById('qhTrackFillA');
  const qhTrackFillB = document.getElementById('qhTrackFillB');
  const qhDuration    = document.getElementById('qhDuration');

  function minutesFromNoon(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return ((h * 60 + m) - 720 + 1440) % 1440;
  }

  function updateNightVisual() {
    const startHHMM = to24h(qhStartHour.value, qhStartMinute.value, getPeriodToggle(qhStartPeriod));
    const endHHMM   = to24h(qhEndHour.value, qhEndMinute.value, getPeriodToggle(qhEndPeriod));

    const startMin = minutesFromNoon(startHHMM);
    const endMin   = minutesFromNoon(endHHMM);
    const startPct = (startMin / 1440) * 100;
    const endPct   = (endMin / 1440) * 100;

    if (qhTrackFillA && qhTrackFillB) {
      if (endPct > startPct) {
        qhTrackFillA.style.left  = startPct + '%';
        qhTrackFillA.style.width = (endPct - startPct) + '%';
        qhTrackFillB.hidden = true;
      } else {
        qhTrackFillA.style.left  = startPct + '%';
        qhTrackFillA.style.width = (100 - startPct) + '%';
        qhTrackFillB.hidden = false;
        qhTrackFillB.style.left  = '0%';
        qhTrackFillB.style.width = endPct + '%';
      }
    }

    if (qhDuration) {
      const durMin = ((endMin - startMin) + 1440) % 1440;
      const durH = Math.floor(durMin / 60);
      const durM = durMin % 60;
      qhDuration.textContent = durM ? `${durH}h ${durM}m` : `${durH}h`;
    }
  }

  [qhStartHour, qhStartMinute, qhEndHour, qhEndMinute].forEach((select) => {
    select?.addEventListener('change', updateNightVisual);
  });

  function loadQuietHours() {
    try {
      const saved = JSON.parse(localStorage.getItem(QUIET_HOURS_KEY) || 'null');
      if (saved && saved.start && saved.end) return saved;
    } catch {}
    return { start: '22:00', end: '07:00' };
  }

  function renderQuietHours(schedule) {
    if (qhScheduleValue) qhScheduleValue.textContent = `${to12hLabel(schedule.start)} — ${to12hLabel(schedule.end)}`;
  }

  let quietHours = loadQuietHours();
  renderQuietHours(quietHours);

  function fillPicker(hhmm, hourSelect, minuteSelect, periodToggle) {
    const { hour, minute, period } = to12h(hhmm);
    hourSelect.value = hour;
    minuteSelect.value = nearestMinuteOption(minute);
    setPeriodToggle(periodToggle, period);
  }

  function openQhModal() {
    if (!qhModal) return;
    fillPicker(quietHours.start, qhStartHour, qhStartMinute, qhStartPeriod);
    fillPicker(quietHours.end, qhEndHour, qhEndMinute, qhEndPeriod);
    qhStartHourUI?.syncLabel();
    qhStartMinuteUI?.syncLabel();
    qhEndHourUI?.syncLabel();
    qhEndMinuteUI?.syncLabel();
    updateNightVisual();
    qhModal.classList.add('open');
  }

  function closeQhModal() {
    qhModal?.classList.remove('open');
    qhStartHourUI?.closePanel();
    qhStartMinuteUI?.closePanel();
    qhEndHourUI?.closePanel();
    qhEndMinuteUI?.closePanel();
  }

  btnConfigure?.addEventListener('click', openQhModal);
  document.getElementById('qhModalClose')?.addEventListener('click', closeQhModal);
  qhModal?.addEventListener('click', (event) => {
    if (event.target === qhModal) closeQhModal();
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

  document.getElementById('qhModalSave')?.addEventListener('click', () => {
    quietHours = {
      start: to24h(qhStartHour.value, qhStartMinute.value, getPeriodToggle(qhStartPeriod)),
      end:   to24h(qhEndHour.value, qhEndMinute.value, getPeriodToggle(qhEndPeriod))
    };
    localStorage.setItem(QUIET_HOURS_KEY, JSON.stringify(quietHours));
    renderQuietHours(quietHours);
    closeQhModal();
    showToast('Quiet hours saved.', 'success');
  });

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

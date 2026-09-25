/* =============================================
   BVetter — Notification Settings JS
   File: js/notification-settings.js
   Depends: nav.js, api.js

   Functions:
   - loadNotifPrefs()      — api.getNotifPrefs() to set checkbox + quiet hours state
   - saveNotifPrefs()      — api.updateNotifPrefs() on checkbox change
   - loadHistory()         — buildOwnerNotifications() (nav.js) into the
                             Recent History card
   - (clear all history)   — api.dismissAllNotifications(); soft-deletes every
                             row, so it empties the nav bell too
   - Quiet Hours modal + enable toggle — api.updateNotifPrefs() on save/toggle

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

    quietHoursEnabled = !!prefs.quietHoursEnabled;
    if (prefs.quietHoursStart && prefs.quietHoursEnd) {
      quietHours = { start: prefs.quietHoursStart, end: prefs.quietHoursEnd };
    }
    if (qhEnabledToggle) qhEnabledToggle.checked = quietHoursEnabled;
    renderQuietHours(quietHours);
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

  /* ── Recent History ───────────────────────────
     This card used to be two hardcoded .history-item blocks sitting in the
     HTML — the same invented "Lost Pet Found Near Sector 4" and "Dr. Aris will
     see 'Max' tomorrow" shown to every person who opened the page — and Clear
     All deleted those nodes from the DOM and nothing else. The notification
     rows were real all along; this card was simply never wired to them, so it
     reported a stranger's demo data as the owner's own history.

     Rendering leans on nav.js rather than growing a fourth copy of
     notification categorisation (nav.js and account-profile.js already have
     one each): buildOwnerNotifications() for the feed, notifCategoryFromType()
     + NOTIF_ICONS for the glyph, notifStatusFromTitle() for the colour. nav.js
     loads before this file on this page and is not an IIFE, so all of them are
     simply in scope. ── */

  // Fetched deeper than shown so Clear All can state the true total: the
  // button empties the whole feed, not just the rows that fit on screen.
  const HISTORY_SHOWN = 5;
  const HISTORY_FETCH = 30;

  const STATUS_DOT = { positive: 'green-dot', negative: 'red-dot', neutral: 'blue-dot' };

  let historyItems = [];

  function historyEl() {
    return document.getElementById('historyList');
  }

  function setHistoryMessage(text) {
    const list = historyEl();
    if (list) list.innerHTML = `<p class="hist-empty">${vbEscapeHtml(text)}</p>`;
  }

  function renderHistory() {
    const list = historyEl();
    if (!list) return;

    if (!historyItems.length) {
      setHistoryMessage('No recent notifications.');
      return;
    }

    // Titles and messages carry pet names, report text and whatever else
    // people typed, so each one is escaped on the way into innerHTML. The
    // glyph is our own markup and is the only part deliberately left raw.
    list.innerHTML = historyItems.slice(0, HISTORY_SHOWN).map((item) => {
      const dot   = STATUS_DOT[notifStatusFromTitle(item.title)] || 'blue-dot';
      const glyph = NOTIF_ICONS[notifCategoryFromType(item.type)] || NOTIF_ICONS.general;
      return `
          <div class="history-item">
            <div class="hist-dot-wrap ${dot}">${glyph}</div>
            <div class="hist-content">
              <div class="hist-title">${vbEscapeHtml(item.title)}</div>
              <div class="hist-desc">${vbEscapeHtml(item.detail)}</div>
              <div class="hist-time">${vbEscapeHtml(item.time)}</div>
            </div>
          </div>`;
    }).join('');
  }

  async function loadHistory() {
    if (typeof buildOwnerNotifications !== 'function') {
      setHistoryMessage('Could not load recent notifications.');
      return;
    }
    const items = await buildOwnerNotifications(HISTORY_FETCH).catch(() => []);
    // 'empty' is the placeholder row nav.js pushes for its own dropdown; it is
    // not a notification and must not be counted as one here.
    historyItems = items.filter((item) => item.id !== 'empty');
    renderHistory();
  }

  document.addEventListener('DOMContentLoaded', loadHistory);

  /* ── Clear notification history ─────────────
     Destructive for real now: dismiss_all soft-deletes every undismissed row,
     and since the bell reads the same dismissed_at IS NULL filter, clearing
     here empties the bell too. Nothing in the UI brings them back, so the
     confirmation says both things plainly. */
  const btnClear = document.querySelector('.btn-clear-all');
  if (btnClear) {
    btnClear.addEventListener('click', async () => {
      if (!historyItems.length) return;

      // The feed is fetched under a LIMIT, so a full page means there may be
      // older rows behind it. dismiss_all clears every row the account has, not
      // just the fetched ones, so naming an exact number here would understate
      // what the button does. Only claim a count when we know we have them all.
      const count     = historyItems.length;
      const truncated = count >= HISTORY_FETCH;
      const subject   = truncated
        ? 'all your notifications'
        : `all ${count} ${count === 1 ? 'notification' : 'notifications'}`;
      const aside = !truncated && count > HISTORY_SHOWN
        ? ' (including older ones not shown here)'
        : '';
      const ok = await vbConfirm(
        `Remove ${subject}${aside}? They will disappear from this list and from your `
        + `notification bell, and cannot be brought back.`,
        'Yes, clear all'
      );
      if (!ok) return;

      btnClear.disabled = true;
      const result = await api.dismissAllNotifications().catch(() => ({ success: false }));
      btnClear.disabled = false;

      // Left exactly as it was on failure. Emptying the list first and hoping
      // is the mistake nav.js's mark-all-read comment records having made:
      // it hid a write that had been failing every single time.
      if (!result || !result.success) {
        await vbAlert(result?.message || 'Could not clear your notifications. Please try again.');
        return;
      }

      historyItems = [];
      renderHistory();
      // The bell dot is driven by its own count, so it would otherwise keep
      // showing unread items that no longer exist until the next page load.
      if (typeof refreshNotifDot === 'function') void refreshNotifDot();
    });
  }

  /* ── Configure schedule ──────────────────────
     Persisted via api.updateNotifPrefs() (quietHoursEnabled/Start/End),
     backed by api/users/profile.php's user_notification_preferences row.

     Times are stored internally as 24h "HH:MM" strings; the picker
     UI itself is 12h + AM/PM (hour/minute selects + pill toggle)
     to avoid the inconsistent native <input type="time"> widget. */
  const btnConfigure     = document.querySelector('.btn-configure');
  const qhModal          = document.getElementById('quietHoursModal');
  const qhScheduleValue  = document.querySelector('.quiet-schedule-value');
  const qhEnabledToggle  = document.getElementById('qhEnabledToggle');

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

  function renderQuietHours(schedule) {
    if (qhScheduleValue) {
      qhScheduleValue.textContent = quietHoursEnabled
        ? `${to12hLabel(schedule.start)} — ${to12hLabel(schedule.end)}`
        : `${to12hLabel(schedule.start)} — ${to12hLabel(schedule.end)} (Off)`;
    }
    document.querySelector('.quiet-card')?.classList.toggle('quiet-disabled', !quietHoursEnabled);
  }

  let quietHours = { start: '22:00', end: '07:00' };
  let quietHoursEnabled = false;
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

  document.getElementById('qhModalSave')?.addEventListener('click', async () => {
    quietHours = {
      start: to24h(qhStartHour.value, qhStartMinute.value, getPeriodToggle(qhStartPeriod)),
      end:   to24h(qhEndHour.value, qhEndMinute.value, getPeriodToggle(qhEndPeriod))
    };
    quietHoursEnabled = true;
    if (qhEnabledToggle) qhEnabledToggle.checked = true;
    renderQuietHours(quietHours);
    closeQhModal();
    await api.updateNotifPrefs({
      quietHoursEnabled: true,
      quietHoursStart: quietHours.start,
      quietHoursEnd: quietHours.end
    }).catch(() => null);
    showToast('Quiet hours saved.', 'success');
  });

  qhEnabledToggle?.addEventListener('change', async () => {
    quietHoursEnabled = qhEnabledToggle.checked;
    renderQuietHours(quietHours);
    await api.updateNotifPrefs({
      quietHoursEnabled,
      quietHoursStart: quietHours.start,
      quietHoursEnd: quietHours.end
    }).catch(() => null);
    showToast(quietHoursEnabled ? 'Quiet hours enabled.' : 'Quiet hours disabled.', 'success');
  });

})();

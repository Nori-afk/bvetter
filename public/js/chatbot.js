/* =============================================
   BVETTER — Chatbot Widget v4.0
   No stepper · Doctor + Heart avatar
   Smooth intro on landing page load
   ============================================= */
(function () {
  'use strict';

  function appBasePath() {
    var script = document.currentScript || Array.prototype.slice.call(document.scripts).find(function (item) {
      return item.src && item.src.indexOf('/public/js/chatbot.js') >= 0;
    });
    var path = script && script.src ? new URL(script.src).pathname : window.location.pathname;
    var marker = '/public/js/chatbot.js';
    if (path.indexOf(marker) >= 0) return path.slice(0, path.indexOf(marker));
    marker = '/public/pages/';
    if (path.indexOf(marker) >= 0) return path.slice(0, path.indexOf(marker));
    return '/final-VBETTER/bvetter';
  }

  var APP_BASE = appBasePath();
  var CHATBOT_API = APP_BASE + '/api/chatbot/chatbot.php';
  var BARANGAY_API = APP_BASE + '/api/barangays/list.php';

  function chatbotRequest(action, payload) {
    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      controller.abort();
    }, 8000);

    return fetch(CHATBOT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    })
      .finally(function () {
        clearTimeout(timeoutId);
      })
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (!result || !result.success) {
          throw new Error((result && result.message) || 'Chatbot request failed.');
        }
        return result.data || result;
      });
  }

  function normalizeRedirect(value) {
    var page = String(value || '').trim();
    var lower = page.toLowerCase();
    if (!page) return 'book-appointment.html';
    if (lower === 'book appointment' || lower.indexOf('appointment') >= 0) return 'book-appointment.html';
    if (lower === 'lost and found' || lower.indexOf('lost') >= 0) return 'lost-found.html';
    return page;
  }

  /* ─────────────────────────────────────────
     1. INJECT FONT + CSS
  ───────────────────────────────────────── */
  var fontLink = document.createElement('link');
  fontLink.rel  = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
  document.head.appendChild(fontLink);

  var cssLink = document.createElement('link');
  cssLink.rel  = 'stylesheet';
  cssLink.href = '../css/chatbot.css';
  document.head.appendChild(cssLink);

  /* ─────────────────────────────────────────
     2. INLINE SVG ICONS  (replace img src
        with your real icon paths later)
  ───────────────────────────────────────── */
  var SVG = {
    close:
      '<svg viewBox="0 0 14 14" fill="none" stroke="rgba(255,255,255,0.75)"' +
      ' stroke-width="1.6" stroke-linecap="round">' +
      '<path d="M2 2l10 10M12 2L2 12"/></svg>',

    chevron:
      '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor"' +
      ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M5 3l4 4-4 4"/></svg>',

    check:
      '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor"' +
      ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M2.5 7.2l3 3L11.5 3.5"/></svg>',

    /* ── Tab icons  (replace img src when ready) ── */
    inquiry:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round">' +
      '<circle cx="8" cy="8" r="6.5"/>' +
      '<path d="M8 7v4M8 5.5v.5"/></svg>',

    stethoscope:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M5 3v5a4 4 0 008 0V3"/>' +
      '<circle cx="13" cy="13.5" r="1.5"/>' +
      '<path d="M9 12v2"/></svg>',

    /* ── Option-button icons (used as SVG fallback when img fails) ── */
    'icon-clock':
      '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round">' +
      '<circle cx="10" cy="10" r="7.5"/>' +
      '<path d="M10 6v4l2.5 2.5"/></svg>',

    'icon-syringe':
      '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M14.5 2.5l3 3-9.5 9.5-3.5 1 1-3.5 9-10z"/>' +
      '<path d="M12 5l3 3M4 16l2-2"/></svg>',

    'icon-calendar':
      '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round">' +
      '<rect x="2.5" y="3.5" width="15" height="14" rx="2"/>' +
      '<path d="M6 2v3M14 2v3M2.5 8.5h15"/></svg>',

    'icon-search':
      '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round">' +
      '<circle cx="9" cy="9" r="5.5"/>' +
      '<path d="M13 13l3.5 3.5"/></svg>',

    'icon-refresh':
      '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 10a6 6 0 1 0 1.5-4"/>' +
      '<path d="M4 5.5V10h4.5"/></svg>',

    'icon-dog':
      '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3 8l2-4h10l2 4v5a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>' +
      '<path d="M7 15v2M13 15v2M7 11h.01M13 11h.01"/></svg>',

    'icon-cat':
      '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 9l1-5 3 3h4l3-3 1 5v4a3 3 0 01-6 0v-1H9v1a3 3 0 01-6 0V9z"/>' +
      '<path d="M8 12h.01M12 12h.01"/></svg>',

    'icon-bird':
      '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M14 3c-3 0-5 2-5 5v1H5l-2 3h6v2a3 3 0 006 0V8c0-3-1-5-3-5z"/>' +
      '<circle cx="14" cy="6" r="1"/></svg>',

    'icon-paw':
      '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round">' +
      '<circle cx="7" cy="5" r="1.5"/>' +
      '<circle cx="13" cy="5" r="1.5"/>' +
      '<circle cx="4" cy="9" r="1.5"/>' +
      '<circle cx="16" cy="9" r="1.5"/>' +
      '<path d="M10 8c-3 0-5 2-5 4.5 0 2 1.5 3 5 3s5-1 5-3C15 10 13 8 10 8z"/></svg>',

    /* Risk card shield icons */
    shieldLow:
      '<svg viewBox="0 0 20 20" fill="none" stroke="#15803D"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M10 2l6.5 2.5v5C16.5 13.8 13.5 17 10 18 6.5 17 3.5 13.8 3.5 9.5v-5L10 2z"/>' +
      '<path d="M7 10l2 2 4-4"/></svg>',

    shieldMod:
      '<svg viewBox="0 0 20 20" fill="none" stroke="#92400E"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M10 2l6.5 2.5v5C16.5 13.8 13.5 17 10 18 6.5 17 3.5 13.8 3.5 9.5v-5L10 2z"/>' +
      '<path d="M10 8v3M10 13v.5"/></svg>',

    shieldHigh:
      '<svg viewBox="0 0 20 20" fill="none" stroke="#B91C1C"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M10 2l6.5 2.5v5C16.5 13.8 13.5 17 10 18 6.5 17 3.5 13.8 3.5 9.5v-5L10 2z"/>' +
      '<path d="M10 8v3M10 13v.5"/></svg>',
  };

  /* ─────────────────────────────────────────
     3. BUILD & INJECT HTML
  ───────────────────────────────────────── */
  /*
   * AVATAR IMAGES — two separate files, layered:
   *
   *   .chatbot-fab-doctor  → ../images/icons/chatbot-doctor.svg
   *                          The full doctor illustration (dark circle bg included)
   *                          Positioned to fill the FAB circle
   *
   *   .chatbot-fab-heart   → ../images/icons/chatbot-heart.svg
   *                          The floating blue heart, sits top-left outside the circle
   *                          Animated with a gentle heartbeat
   *
   * Same pair is used in the panel header at a smaller scale.
   * Just drop the two SVG/PNG files in place and they render correctly.
   */

  var WIDGET_HTML = [
    /* ── FAB ─────────────────────────────── */
    '<button class="chatbot-fab" id="chatbotFab" aria-label="Open Vet Assistant">',
      /* Floating heart — outside circle, top-left */
      '<img class="chatbot-fab-heart"',
          ' src="../images/icons/chatbot-heart.svg"',
          ' alt=""',
          ' aria-hidden="true"/>',
      /* Circle body that clips the doctor illustration */
      '<div class="chatbot-fab-body">',
        '<img class="chatbot-fab-doctor"',
            ' src="../images/icons/chatbot-avatar.svg"',
            ' alt="Vet Assistant"/>',
      '</div>',
      /* Online green dot */
      '<span class="chatbot-fab-dot"></span>',
    '</button>',

    /* ── PANEL ───────────────────────────── */
    '<div class="chatbot-panel" id="chatbotPanel"',
        ' role="dialog"',
        ' aria-label="Baliwag Vet Assistant">',

      /* HEADER */
      '<div class="chatbot-header">',
        '<div class="chatbot-header-left">',
          '<div class="chatbot-header-avatar-wrap">',
            /* circle clip */
            '<div class="chatbot-header-avatar-circle">',
              '<img class="chatbot-header-avatar"',
                  ' src="../images/icons/chatbot-avatar.svg"',
                  ' alt=""/>',
            '</div>',
            /* floating heart (smaller) */
            '<img class="chatbot-header-heart"',
                ' src="../images/icons/chatbot-heart.svg"',
                ' alt=""',
                ' aria-hidden="true"/>',
            /* online ring */
            '<div class="chatbot-online-ring"></div>',
          '</div>',
          '<div>',
            '<div class="chatbot-header-name">Baliwag Vet Assistant</div>',
            '<div class="chatbot-header-status">',
              '<span class="chatbot-status-dot"></span>',
              '<span class="chatbot-status-text">Online &middot; Ready to help</span>',
            '</div>',
          '</div>',
        '</div>',
        '<div class="chatbot-header-actions">',
          '<button class="chatbot-icon-btn" id="chatbotCloseBtn" aria-label="Close">',
            SVG.close,
          '</button>',
        '</div>',
      '</div>',

      /* TABS */
      '<div class="chatbot-tabs">',
        /*
         * Tab icons use <img> so you can swap them for your real SVG files.
         * Filenames shown are placeholders — replace when ready.
         */
        '<button class="chatbot-tab active" id="tabInquiry">',
          '<img src="../images/icons/chatbot-inquiry.png" alt=""/>',
          'Inquiry',
        '</button>',
        '<button class="chatbot-tab" id="tabConsultation">',
          '<img src="../images/icons/chatbot-consultation.png" alt=""/>',
          'Symptom Check',
        '</button>',
      '</div>',

      /* INQUIRY PANEL */
      '<div class="chatbot-tab-panel active" id="panelInquiry">',
        '<div class="chatbot-messages"  id="inquiryMessages"></div>',
        '<div class="chatbot-options"   id="inquiryOptions"></div>',
      '</div>',

      /* CONSULTATION PANEL — no stepper */
      '<div class="chatbot-tab-panel" id="panelConsultation">',
        '<div class="chatbot-messages"  id="consultMessages"></div>',
        '<div class="chatbot-options"   id="consultOptions"></div>',
      '</div>',

    '</div>',
  ].join('');

  var mount = document.createElement('div');
  mount.innerHTML = WIDGET_HTML;
  document.body.appendChild(mount);

  /* ─────────────────────────────────────────
     4. ELEMENT REFS
  ───────────────────────────────────────── */
  var fab          = document.getElementById('chatbotFab');
  var panel        = document.getElementById('chatbotPanel');
  var closeBtn     = document.getElementById('chatbotCloseBtn');
  var tabInquiry   = document.getElementById('tabInquiry');
  var tabConsult   = document.getElementById('tabConsultation');
  var panelInquiry = document.getElementById('panelInquiry');
  var panelConsult = document.getElementById('panelConsultation');
  var iMsgs        = document.getElementById('inquiryMessages');
  var iOpts        = document.getElementById('inquiryOptions');
  var cMsgs        = document.getElementById('consultMessages');
  var cOpts        = document.getElementById('consultOptions');

  var isOpen      = false;
  var inquiryDone = false;
  var consultDone = false;

  /* ─────────────────────────────────────────
     5. LANDING-PAGE INTRO ANIMATION
     Detect if this is the landing page
     (index.html / root path). If so,
     auto-open the chat briefly after
     the page has settled, then close it
     so the user sees a "glimpse".
  ───────────────────────────────────────── */
  function isLandingPage() {
    var p = window.location.pathname;
    return (
      p === '/' ||
      p === '/index.html' ||
      /\/index\.html?$/.test(p) ||
      /* common pattern: just the folder, no file */
      /\/$/.test(p)
    );
  }

  // function runLandingIntro() {
  //   /* Wait for the page to fully paint (2 frames + small offset) */
  //   setTimeout(function () {
  //     /* 1. Open the panel — user sees the chat slide up */
  //     openChat(true /* silent — don't start flow yet */);

  //     /* 2. After 1.8 s close it smoothly */
  //     setTimeout(function () {
  //       closeChat();

  //       /* 3. After close finishes, start the flow so it's
  //             ready the moment they re-open */
  //       setTimeout(function () {
  //         if (!inquiryDone) startInquiry();
  //       }, 350);
  //     }, 1800);
  //   }, 800);
  // }

  /* ─────────────────────────────────────────
     6. OPEN / CLOSE
  ───────────────────────────────────────── */
function openChat(silent) {
  isOpen = true;
  panel.style.display = 'flex';        /* ← add this */
  /* small delay so display:flex registers before opacity transition fires */
  requestAnimationFrame(function () {
    panel.classList.add('open');
  });
  fab.style.display = 'none';
  if (!silent && !inquiryDone) startInquiry();
}

function closeChat() {
  isOpen = false;
  panel.classList.remove('open');
  /* wait for transition to finish before hiding */
  setTimeout(function () {
    panel.style.display = 'none';
  }, 300);                             /* match your transition duration */
  fab.style.display = '';
}

  fab.addEventListener('click', function () { openChat(false); });
  closeBtn.addEventListener('click', closeChat);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) closeChat();
  });

  /* ─────────────────────────────────────────
     7. TABS
  ───────────────────────────────────────── */
  function switchTab(which) {
    if (which === 'inquiry') {
      tabInquiry.classList.add('active');
      tabConsult.classList.remove('active');
      panelInquiry.classList.add('active');
      panelConsult.classList.remove('active');
      if (!inquiryDone) startInquiry();
    } else {
      tabConsult.classList.add('active');
      tabInquiry.classList.remove('active');
      panelConsult.classList.add('active');
      panelInquiry.classList.remove('active');
      if (!consultDone) startConsultation();
    }
  }

  tabInquiry.addEventListener('click', function () { switchTab('inquiry'); });
  tabConsult.addEventListener('click', function () { switchTab('consultation'); });

  /* ─────────────────────────────────────────
     8. UTILITIES
  ───────────────────────────────────────── */
  function getTime() {
    var d  = new Date();
    var h  = d.getHours();
    var m  = d.getMinutes().toString().padStart(2, '0');
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + m + ' ' + ap;
  }

  function scrollBottom(el) {
    /* rAF ensures DOM has painted before we scroll */
    requestAnimationFrame(function () {
      el.scrollTop = el.scrollHeight;
    });
  }

  /* Small bot avatar used inside message rows */
  function makeBotAv() {
    var av  = document.createElement('div');
    av.className = 'chat-bot-av';
    /*
     * Replace src with your real doctor image.
     * On error falls back to the inline SVG silhouette.
     */
    var img = document.createElement('img');
    img.src = '../images/icons/chatbot-avatar.svg';
    img.alt = '';
    img.onerror = function () {
      av.innerHTML =
        '<svg viewBox="0 0 20 20" fill="none" stroke="rgba(255,255,255,0.8)"' +
        ' stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M10 3a3.5 3.5 0 110 7 3.5 3.5 0 010-7z"/>' +
        '<path d="M3 17c0-3.3 3.1-6 7-6s7 2.7 7 6"/>' +
        '</svg>';
    };
    av.appendChild(img);
    return av;
  }

  /* ─────────────────────────────────────────
     9. MESSAGE HELPERS
  ───────────────────────────────────────── */

  /* Returns a Promise that resolves after the
     typing indicator has been replaced by a
     real bot bubble.  delay defaults to 700 ms */
  function addBotBubble(container, text, delay) {
    return new Promise(function (resolve) {
      /* Show typing row */
      var typRow = document.createElement('div');
      typRow.className = 'chat-bot-row';
      typRow.appendChild(makeBotAv());

      var typBub = document.createElement('div');
      typBub.className = 'chat-typing-bubble';
      typBub.innerHTML =
        '<div class="typing-dot"></div>' +
        '<div class="typing-dot"></div>' +
        '<div class="typing-dot"></div>';
      typRow.appendChild(typBub);
      container.appendChild(typRow);
      scrollBottom(container);

      setTimeout(function () {
        /* Remove typing, insert real bubble */
        if (typRow.parentNode) typRow.parentNode.removeChild(typRow);

        var row = document.createElement('div');
        row.className = 'chat-bot-row';
        row.appendChild(makeBotAv());

        var bub = document.createElement('div');
        bub.className = 'chat-bubble-bot';
        bub.textContent = text;
        row.appendChild(bub);
        container.appendChild(row);

        var ts = document.createElement('div');
        ts.className = 'chat-ts';
        ts.textContent = getTime();
        container.appendChild(ts);

        scrollBottom(container);
        resolve();
      }, delay != null ? delay : 700);
    });
  }

  function addUserBubble(container, text) {
    var bub = document.createElement('div');
    bub.className = 'chat-bubble-user';
    bub.textContent = text;
    container.appendChild(bub);

    var ts = document.createElement('div');
    ts.className = 'chat-ts right';
    ts.textContent = getTime();
    container.appendChild(ts);

    scrollBottom(container);
  }

  function addInfoBox(container, title, body) {
    var box = document.createElement('div');
    box.className = 'chat-info-box';

    var ttl = document.createElement('span');
    ttl.className = 'chat-info-box-title';
    ttl.textContent = title;
    box.appendChild(ttl);

    /* body text — pre-line handles \n in CSS */
    var txt = document.createTextNode(body);
    box.appendChild(txt);

    container.appendChild(box);

    var ts = document.createElement('div');
    ts.className = 'chat-ts';
    ts.textContent = getTime();
    container.appendChild(ts);

    scrollBottom(container);
  }

  /*
   * addRiskCard — builds the full coloured risk card.
   * level: 'low' | 'moderate' | 'high'
   */
  function addRiskCard(container, level, content) {
    var card = document.createElement('div');
    card.className = 'chat-risk-card';

    /* ── Header ── */
    var hdr = document.createElement('div');
    hdr.className = 'chat-risk-header ' + level;

    /* Icon tile */
    var ind = document.createElement('div');
    ind.className = 'chat-risk-indicator ' + level;
    var svgKey = level === 'low' ? 'shieldLow' : level === 'moderate' ? 'shieldMod' : 'shieldHigh';
    ind.innerHTML = SVG[svgKey];
    hdr.appendChild(ind);

    /* Text stack */
    var stack = document.createElement('div');

    var lvlEl = document.createElement('span');
    lvlEl.className = 'chat-risk-level';
    var levels = { low: 'Low Risk', moderate: 'Moderate Risk', high: 'High Risk' };
    lvlEl.textContent = levels[level] || 'Risk Assessment';
    stack.appendChild(lvlEl);

    var subEl = document.createElement('span');
    subEl.className = 'chat-risk-sublabel';
    var subs = { low: 'Monitor at home', moderate: 'Attention needed', high: 'Seek veterinary care now' };
    subEl.textContent = subs[level] || '';
    stack.appendChild(subEl);

    hdr.appendChild(stack);
    card.appendChild(hdr);

    /* ── Body ── */
    var body = document.createElement('div');
    body.className = 'chat-risk-body';
    body.textContent = content;     /* CSS white-space:pre-line handles \n */
    card.appendChild(body);

    container.appendChild(card);

    var ts = document.createElement('div');
    ts.className = 'chat-ts';
    ts.textContent = getTime();
    container.appendChild(ts);

    scrollBottom(container);
  }

  function addDivider(container, text) {
    var d = document.createElement('div');
    d.className = 'chat-divider';
    d.innerHTML =
      '<div class="chat-divider-line"></div>' +
      '<div class="chat-divider-text">' + text + '</div>' +
      '<div class="chat-divider-line"></div>';
    container.appendChild(d);
  }

  /* ─────────────────────────────────────────
     10. OPTION / CHIP BUILDERS
  ───────────────────────────────────────── */
  function clearOptions(el) { el.innerHTML = ''; }

  function showOptionLabel(el, text) {
    var lbl = document.createElement('div');
    lbl.className = 'chatbot-options-label';
    lbl.textContent = text;
    el.appendChild(lbl);
  }

  /*
   * addOptionBtn
   * iconFile  – placeholder filename, e.g. 'icon-clock.svg'
   *             (looked up in SVG map as fallback)
   * label     – main text
   * sublabel  – secondary line (pass '' to omit)
   * onClick   – callback
   */
  function addOptionBtn(el, iconFile, label, sublabel, onClick) {
    var btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.type = 'button';
    btn.style.animationDelay = (el.children.length * 45) + 'ms';

    /* Left cluster */
    var left = document.createElement('span');
    left.className = 'option-btn-left';

    /* Icon tile */
    var tile = document.createElement('span');
    tile.className = 'option-btn-icon';

    var img = document.createElement('img');
    img.src = '../images/icons/' + iconFile;
    img.alt = '';
    img.width  = 16;
    img.height = 16;

    /* If image fails, fall back to the matching inline SVG */
    img.onerror = (function (key) {
      return function () {
        img.style.display = 'none';
        tile.innerHTML += SVG[key] || SVG['icon-paw'];
      };
    })(iconFile.replace('.svg', ''));

    tile.appendChild(img);
    left.appendChild(tile);

    /* Text block */
    var tb = document.createElement('span');

    var lbl = document.createElement('span');
    lbl.className = 'option-btn-label';
    lbl.textContent = label;
    tb.appendChild(lbl);

    if (sublabel) {
      var sub = document.createElement('span');
      sub.className = 'option-btn-sub';
      sub.textContent = sublabel;
      tb.appendChild(sub);
    }

    left.appendChild(tb);
    btn.appendChild(left);

    /* Chevron */
    var chev = document.createElement('span');
    chev.className = 'option-btn-chevron';
    chev.innerHTML = SVG.chevron;
    btn.appendChild(chev);

    btn.addEventListener('click', function () {
      btn.classList.add('selected');
      setTimeout(onClick, 220);
    });

    el.appendChild(btn);
  }

  function showChips(el, chips, onSelect) {
    showOptionLabel(el, 'Select one:');

    var row = document.createElement('div');
    row.className = 'chatbot-chips';

    chips.forEach(function (chip) {
      var b = document.createElement('button');
      b.className  = 'chip-btn';
      b.type       = 'button';
      b.textContent = chip;

      b.addEventListener('click', function () {
        row.querySelectorAll('.chip-btn').forEach(function (x) {
          x.classList.remove('selected');
        });
        b.classList.add('selected');
        setTimeout(function () { onSelect(chip); }, 220);
      });

      row.appendChild(b);
    });

    el.appendChild(row);
    scrollBottom(cMsgs);
  }

  /* Multi-select symptom checklist — toggle any number, then Continue */
  function showSymptomChecklist(el, symptoms, onSubmit) {
    showOptionLabel(el, 'Select all that apply:');

    var grid = document.createElement('div');
    grid.className = 'symptom-checklist';

    var picked = [];

    symptoms.forEach(function (symptom, i) {
      var b = document.createElement('button');
      b.className = 'symptom-check-btn';
      b.type = 'button';
      b.style.animationDelay = (i * 45) + 'ms';

      var mark = document.createElement('span');
      mark.className = 'symptom-check-mark';
      mark.innerHTML = SVG.check;
      b.appendChild(mark);

      var lbl = document.createElement('span');
      lbl.className = 'symptom-check-label';
      lbl.textContent = symptom;
      b.appendChild(lbl);

      b.addEventListener('click', function () {
        var idx = picked.indexOf(symptom);
        if (idx >= 0) {
          picked.splice(idx, 1);
          b.classList.remove('selected');
        } else {
          picked.push(symptom);
          b.classList.add('selected');
        }
      });

      grid.appendChild(b);
    });

    el.appendChild(grid);

    var continueBtn = document.createElement('button');
    continueBtn.type = 'button';
    continueBtn.className = 'symptom-continue-btn';
    continueBtn.textContent = 'Continue';
    continueBtn.addEventListener('click', function () {
      if (continueBtn.disabled) return;
      continueBtn.disabled = true;
      grid.querySelectorAll('.symptom-check-btn').forEach(function (x) { x.disabled = true; });
      setTimeout(function () { onSubmit(picked.slice()); }, 200);
    });
    el.appendChild(continueBtn);
    scrollBottom(cMsgs);
  }

  /* Generic restart button */
  function showRestart(msgContainer, optContainer, restartFn) {
    setTimeout(function () {
      clearOptions(optContainer);
      addOptionBtn(
        optContainer,
        'chatbot-ask-again.png',
        'Ask another question', '',
        function () {
          clearOptions(optContainer);
          restartFn();
        }
      );
    }, 300);
  }

  /* ─────────────────────────────────────────
     11. INQUIRY FLOW
  ───────────────────────────────────────── */
  function startInquiry() {
    inquiryDone = true;
    clearOptions(iOpts);
    iMsgs.innerHTML = '';

    addBotBubble(iMsgs, 'Hello! What would you like to know about?', 450)
      .then(showInquiryMenu);
  }

  function showInquiryMenu() {
    clearOptions(iOpts);
    showOptionLabel(iOpts, 'Choose a topic');

    chatbotRequest('public_inquiries')
      .then(function (rules) {
        if (!Array.isArray(rules) || !rules.length) return;

        clearOptions(iOpts);
        showOptionLabel(iOpts, 'Choose a topic');

        rules.forEach(function (rule) {
          var name = rule.name || rule.title || 'Inquiry';
          var lowerName = name.toLowerCase();
          var iconFile = lowerName.indexOf('schedule') >= 0 ? 'chatbot-schedule.png'
            : lowerName.indexOf('vacc') >= 0 ? 'chatbot-vaccination.png'
            : lowerName.indexOf('appointment') >= 0 ? 'chatbot-appointment.png'
            : lowerName.indexOf('lost') >= 0 ? 'chatbot-lf.png'
            : 'chatbot-inquiry.png';

          addOptionBtn(iOpts, iconFile, name, rule.actionLabel || '', function () {
            addUserBubble(iMsgs, name);
            clearOptions(iOpts);
            chatbotRequest('record_inquiry_use', { id: rule.id }).catch(function () {});
            addBotBubble(iMsgs, 'Here is the information:', 500)
              .then(function () {
                addInfoBox(iMsgs, name, rule.response || '');
                if (rule.actionType === 'redirect' && rule.redirectPage) {
                  addOptionBtn(iOpts, iconFile, rule.buttonLabel || rule.actionLabel || 'Open page', '', function () {
                    window.location.href = normalizeRedirect(rule.redirectPage);
                  });
                } else {
                  showRestart(iMsgs, iOpts, showInquiryMenu);
                }
              });
          });
        });
      })
      .catch(function () {});

    /* ── Clinic Schedule ── */
    addOptionBtn(iOpts, 'chatbot-schedule.png', 'Clinic Schedule', 'Hours and availability',
      function () {
        addUserBubble(iMsgs, 'Clinic Schedule');
        clearOptions(iOpts);
        addBotBubble(iMsgs, 'Here are our current clinic hours:', 600)
          .then(function () {
            addInfoBox(iMsgs, 'Clinic Schedule',
              'Monday \u2013 Friday\n8:00 AM \u2013 5:00 PM\n\n' +
              'Saturday\n8:00 AM \u2013 12:00 PM (By appointment)\n\n' +
              'Sunday\nClosed\n\n' +
              'Veterinary Hotline (24/7)\n(049) 523\u20134567\n\n' +
              'Walk-ins accepted Mon\u2013Fri.\nSaturdays require advance booking.'
            );
            showRestart(iMsgs, iOpts, showInquiryMenu);
          });
      }
    );

    /* ── Vaccination Requirements ── */
    addOptionBtn(iOpts, 'chatbot-vaccination.png', 'Vaccination Requirements', 'What to prepare before your visit',
      function () {
        addUserBubble(iMsgs, 'Vaccination Requirements');
        clearOptions(iOpts);
        addBotBubble(iMsgs, 'Here is what you need before your visit:', 600)
          .then(function () {
            addInfoBox(iMsgs, 'Before Your Visit',
              'Your pet must be free from fever, vomiting, or diarrhea.\n\n' +
              'Bring your pet\u2019s vaccination record if available.\n\n' +
              'Keep your pet secured in a carrier or on a leash.\n\n' +
              'Emergency Hotline (24/7)\n(049) 523\u20134567'
            );
            showRestart(iMsgs, iOpts, showInquiryMenu);
          });
      }
    );

    /* ── Book an Appointment ── */
    addOptionBtn(iOpts, 'chatbot-appointment.png', 'Book an Appointment', 'Schedule with a specialist',
      function () {
        addUserBubble(iMsgs, 'Book an Appointment');
        clearOptions(iOpts);
        addBotBubble(iMsgs, 'Redirecting you to our booking page\u2026', 700)
          .then(function () {
            setTimeout(function () {
              window.location.href = 'book-appointment.html';
            }, 900);
          });
      }
    );

    /* ── Lost & Found ── */
    addOptionBtn(iOpts, 'chatbot-lf.png', 'Lost & Found Procedure', 'Report or find a lost pet',
      function () {
        addUserBubble(iMsgs, 'Lost & Found Procedure');
        clearOptions(iOpts);
        addBotBubble(iMsgs, 'Here is how our Lost and Found community works:', 600)
          .then(function () {
            addInfoBox(iMsgs, 'Lost & Found',
              'To report a Lost Pet:\n' +
              '1. Go to Lost & Found \u2192 Report a Lost Pet\n' +
              '2. Upload a clear photo of your pet\n' +
              '3. Fill in pet details and last known location\n\n' +
              'Found a Pet:\n' +
              '1. Go to Lost & Found \u2192 Report Found Pet\n' +
              '2. Describe the pet and where you found it\n\n' +
              'Our team reviews all reports and helps reunite pets with their owners.'
            );
            showRestart(iMsgs, iOpts, showInquiryMenu);
          });
      }
    );
  }

  /* ─────────────────────────────────────────
     12. CONSULTATION FLOW  (no stepper)
  ───────────────────────────────────────── */
  var cState = {};

  function startConsultation() {
    consultDone = true;
    cState = {};
    clearOptions(cOpts);
    cMsgs.innerHTML = '';

    addBotBubble(cMsgs,
      'Welcome to the Symptom Checker. I will ask you a few questions and give you a recommended course of action.',
      500
    )
    .then(function () {
      return addBotBubble(cMsgs,
        'Note: This is not a medical diagnosis. Always consult a licensed veterinarian for serious concerns.',
        750
      );
    })
    .then(function () {
      addDivider(cMsgs, 'Step 1 of 3');
      askPetType();
    });
  }

  /* ── Step 1: Pet type ── */
  function askPetType() {
    clearOptions(cOpts);
    addBotBubble(cMsgs, 'What type of pet do you have?', 550)
      .then(function () {
        showOptionLabel(cOpts, 'Select pet type');

        var pets = [
          { label: 'Dog',   icon: 'chatbot-dogs.png' },
          { label: 'Cat',   icon: 'chatbot-cats.png' },
          { label: 'Other', icon: 'chatbot-others.png'  },
        ];

        pets.forEach(function (p) {
          addOptionBtn(cOpts, p.icon, p.label, '', function () {
            cState.petType = p.label;
            addUserBubble(cMsgs, p.label);
            clearOptions(cOpts);
            addDivider(cMsgs, 'Step 2 of 3');
            askProblem();
          });
        });
      });
  }

  /* ── Step 2: Symptom ── */
  function askProblem() {
    addBotBubble(cMsgs, 'What seems to be the problem with your ' + cState.petType + '?', 550)
      .then(function () {
        showChips(
          cOpts,
          ['Fever', 'Vomiting', 'Diarrhea', 'Weak / Lethargic', 'Not Eating', 'Injury', 'Skin Issues', 'Coughing'],
          function (symptom) {
            cState.symptom = symptom;
            addUserBubble(cMsgs, symptom);
            clearOptions(cOpts);
            addDivider(cMsgs, 'Step 3 of 3');
            askDuration();
          }
        );
      });
  }

  /* ── Step 3: Duration ── */
  function askDuration() {
    addBotBubble(cMsgs, 'How long has this been happening?', 550)
      .then(function () {
        showChips(
          cOpts,
          ['Just started', 'Less than 24 hours', '1\u20133 days', 'More than 3 days', 'Not sure'],
          function (duration) {
            cState.duration = duration;
            addUserBubble(cMsgs, duration);
            clearOptions(cOpts);
            showRiskAssessment();
          }
        );
      });
  }

  /* ── Risk assessment ── */
  function showRiskAssessment() {
    addBotBubble(cMsgs, 'Analyzing your pet\u2019s symptoms\u2026', 500)
      .then(function () {
        var s = cState.symptom  || '';
        var d = cState.duration || '';

        var level, advice;

        if (s === 'Injury' || d === 'More than 3 days') {
          level  = 'high';
          advice =
            'Your pet may need urgent veterinary attention.\n\n' +
            'Immediate Steps:\n' +
            '\u2022 Keep your pet calm and still\n' +
            '\u2022 Do not administer human medications\n' +
            '\u2022 Call our Emergency Line: (049) 523-4567\n' +
            '\u2022 Bring your pet to the clinic immediately\n\n' +
            'Tell the vet:\n' +
            '\u2022 When symptoms started\n' +
            '\u2022 Any recent diet or environment changes\n' +
            '\u2022 Medications already given';

        } else if (
          (d === 'Less than 24 hours' || d === 'Just started') &&
          (s === 'Fever' || s === 'Vomiting' || s === 'Diarrhea')
        ) {
          level  = 'moderate';
          advice =
            'Your pet\u2019s symptoms are notable but may not be immediately critical.\n\n' +
            'Home Care (next 12\u201324 hours):\n' +
            '\u2022 Ensure access to clean water at all times\n' +
            '\u2022 Offer light, bland food in small amounts\n' +
            '\u2022 Monitor stool and behavior changes\n' +
            '\u2022 Do not give human anti-fever medication\n\n' +
            'Visit the Clinic if:\n' +
            '\u2022 Symptoms worsen or persist beyond 2 days\n' +
            '\u2022 Your pet stops drinking water\n' +
            '\u2022 There is blood in vomit or stool\n' +
            '\u2022 Your pet collapses or becomes unresponsive';

        } else {
          level  = 'low';
          advice =
            'Your pet\u2019s condition appears mild at this time.\n\n' +
            'Recommended Steps:\n' +
            '\u2022 Monitor closely over the next 24 hours\n' +
            '\u2022 Ensure fresh water and regular feeding\n' +
            '\u2022 Limit strenuous activity\n' +
            '\u2022 Schedule a routine check-up if needed\n\n' +
            'Contact us if symptoms change or worsen.';
        }

        addDivider(cMsgs, 'Assessment Result');
        addRiskCard(cMsgs, level, advice);
        showConsultActions();
      });
  }

  /* ── Post-assessment actions ── */
  function showConsultActions() {
    clearOptions(cOpts);
    showOptionLabel(cOpts, 'What would you like to do next?');

    addOptionBtn(cOpts, 'chatbot-appointment.png', 'Book an Appointment', 'Schedule with a specialist',
      function () {
        window.location.href = 'book-appointment.html';
      }
    );

    addOptionBtn(cOpts, 'chatbot-ask-again.png', 'Check Again', 'Restart symptom checker',
      function () {
        consultDone = false;
        startConsultation();
      }
    );
  }

  /* ─────────────────────────────────────────
     13. KICK-OFF
  ───────────────────────────────────────── */  /* On all other pages the FAB just sits there ready — no auto-open */

  function askPetType() {
    clearOptions(cOpts);
    addBotBubble(cMsgs, 'What type of pet do you have?', 550)
      .then(function () {
        showOptionLabel(cOpts, 'Select pet type');
        [
          { label: 'Dog', icon: 'chatbot-dogs.png' },
          { label: 'Cat', icon: 'chatbot-cats.png' },
          { label: 'Other', icon: 'chatbot-others.png', sublabel: 'Livestock (cow, goat, pig, etc.)' }
        ].forEach(function (p) {
          addOptionBtn(cOpts, p.icon, p.label, p.sublabel || '', function () {
            cState.petType = p.label;
            addUserBubble(cMsgs, p.label);
            clearOptions(cOpts);
            if (p.label === 'Other') {
              showLivestockAppointmentPrompt();
            } else {
              askAgeGroup();
            }
          });
        });
      });
  }

  /* ── "Other" (livestock) short-circuit: livestock cases need an in-person
     clinic visit, not an online symptom check, so skip straight to booking. ── */
  function showLivestockAppointmentPrompt() {
    addBotBubble(
      cMsgs,
      'For livestock and other farm animals, our vet team needs to examine them in person — ' +
      'we’re not able to give a reliable assessment through online consultation for these cases.\n\n' +
      'Please book an appointment so a veterinarian can see your animal directly at the clinic.',
      600
    ).then(function () {
      clearOptions(cOpts);
      showOptionLabel(cOpts, 'What would you like to do?');

      addOptionBtn(cOpts, 'chatbot-appointment.png', 'Book an Appointment', 'Schedule a clinic visit',
        function () {
          window.location.href = 'book-appointment.html';
        }
      );

      addOptionBtn(cOpts, 'chatbot-ask-again.png', 'Check Again', 'Restart symptom checker',
        function () {
          consultDone = false;
          startConsultation();
        }
      );
    });
  }

  function askAgeGroup() {
    var babyLabel = cState.petType === 'Dog' ? 'Puppy' : cState.petType === 'Cat' ? 'Kitten' : 'Baby';
    addBotBubble(cMsgs, 'What age group is your pet?', 500)
      .then(function () {
        showChips(cOpts, [babyLabel, 'Young', 'Adult', 'Senior', 'Not sure'], function (ageGroup) {
          cState.ageGroup = ageGroup === babyLabel ? 'Baby' : ageGroup;
          addUserBubble(cMsgs, ageGroup);
          clearOptions(cOpts);
          cState.symptoms = [];
          askSymptomsChecklist();
        });
      });
  }

  function askSymptomsChecklist() {
    var symptoms = ['Fever', 'Vomiting', 'Diarrhea', 'Coughing', 'Loss of Appetite', 'Wounds', 'Seizures'];
    addBotBubble(cMsgs, 'Which symptoms does your pet have? Select all that apply.', 450)
      .then(function () {
        showSymptomChecklist(cOpts, symptoms, function (selected) {
          cState.symptoms = selected.length ? selected : ['No listed symptoms'];
          addUserBubble(cMsgs, selected.length ? selected.join(', ') : 'None of these');
          clearOptions(cOpts);
          askDuration();
        });
      });
  }

  function askDuration() {
    addBotBubble(cMsgs, 'How long has this been happening?', 550)
      .then(function () {
        showChips(cOpts, ['Less Than 24 Hours', '1-3 Days', 'More than 3 days'], function (duration) {
          cState.duration = duration;
          addUserBubble(cMsgs, duration);
          clearOptions(cOpts);
          askSeverity();
        });
      });
  }

  function askSeverity() {
    addBotBubble(cMsgs, 'How severe is your pet\'s condition?', 550)
      .then(function () {
        showChips(cOpts, ['Active but sick', 'Weak', 'Not moving'], function (severity) {
          cState.severity = severity;
          addUserBubble(cMsgs, severity);
          clearOptions(cOpts);
          askBarangay();
        });
      });
  }

  function askBarangay() {
    addBotBubble(cMsgs, 'Where are you located?', 550)
      .then(function () {
        return fetch(BARANGAY_API)
          .then(function (response) { return response.json(); })
          .catch(function () { return null; });
      })
      .then(function (result) {
        var barangays = result && result.success && Array.isArray(result.data) ? result.data : [];
        if (!barangays.length) {
          cState.barangayId = null;
          addUserBubble(cMsgs, 'Location skipped');
          showRiskAssessment();
          return;
        }

        showOptionLabel(cOpts, 'Select barangay');
        barangays.forEach(function (barangay) {
          addOptionBtn(cOpts, 'icon-location.svg', barangay.name, '', function () {
            cState.barangayId = barangay.id;
            addUserBubble(cMsgs, barangay.name);
            clearOptions(cOpts);
            setTimeout(showRiskAssessment, 0);
          });
        });
      });
  }

  function showRiskAssessment() {
    addBotBubble(cMsgs, 'Analyzing your pet\'s symptoms...', 500)
      .then(function () {
        return chatbotRequest('assess_consultation', {
          petType: cState.petType,
          ageGroup: cState.ageGroup,
          symptoms: cState.symptoms,
          duration: cState.duration,
          severity: cState.severity,
          barangay_id: cState.barangayId
        });
      })
      .then(function (result) {
        addDivider(cMsgs, 'Assessment Result');
        addInfoBox(
          cMsgs,
          result.condition || 'Recommended Action',
          result.recommendation || 'Please book an appointment for proper veterinary assessment.'
        );
        showConsultActions();
      })
      .catch(function () {
        addDivider(cMsgs, 'Assessment Result');
        addInfoBox(cMsgs, 'Recommended Action',
          'Recommended action: Book appointment\n\nWe could not complete the automated assessment right now. Please book a clinic visit if symptoms continue or your pet becomes weak.'
        );
        showConsultActions();
      });
  }

})();

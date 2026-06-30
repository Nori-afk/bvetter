/* ============================================================
   website-management.js
   Logic for /admin/pages/website-management.html
   ============================================================ */

const STORAGE_KEY = 'vbetter_site_config';

const DEFAULT_CONFIG = {
  primaryColor:  '#002A58',
  logoDataUrl:   null,
  heroBannerUrl: null,
  teamImgUrl:    null,
  event1ImgUrl:  null,
  about:    '',
  email:    'BaliwagtVC@gmail.com',
  phone:    '09959210640',
  address:  'AgriCorp Building, Baliwag Government Complex, 247 Highway, Baliwag, Philippines, 3026',
  announcements: [
    { title: 'Vaccination #1', date: '2026-10-12', type: 'event', body: 'Scheduled on Oct 12, 2AM–4AM' }
  ]
};

let config        = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
let savedConfig   = null;
let announcements = [];

/* ── Load ── */
function loadConfig() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) }; }
    catch (e) { config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
  } else {
    config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  savedConfig   = JSON.stringify(config);
  announcements = config.announcements || [];
}

/* ── Save ── */
function saveConfig() {
  config.announcements = announcements;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  savedConfig = JSON.stringify(config);
  showToast('Changes saved — public site updated');
}

/* ── Discard ── */
function discardConfig() {
  if (savedConfig) {
    config        = JSON.parse(savedConfig);
    announcements = config.announcements || [];
    applyConfigToForm();
    showToast('Changes discarded');
  }
}

/* ── Apply to form ── */
function applyConfigToForm() {
  setColor(config.primaryColor, false);

  if (config.logoDataUrl) {
    const prev = document.getElementById('logo-preview');
    const icon = document.getElementById('logo-placeholder-icon');
    prev.src = config.logoDataUrl;
    prev.style.display = 'block';
    if (icon) icon.style.display = 'none';
  }

  if (config.heroBannerUrl) showAssetPreview('hero-banner',   config.heroBannerUrl);
  if (config.teamImgUrl)    showAssetPreview('team-workspace', config.teamImgUrl);
  if (config.event1ImgUrl)  showAssetPreview('event-1',        config.event1ImgUrl);

  document.getElementById('cp-about').value   = config.about   || '';
  document.getElementById('cp-email').value   = config.email   || '';
  document.getElementById('cp-phone').value   = config.phone   || '';
  document.getElementById('cp-address').value = config.address || '';

  renderAnnouncements();
}

/* ── Color ── */
function setColor(hex, updatePreset = true) {
  config.primaryColor = hex;
  document.getElementById('color-picker').value = hex;
  document.getElementById('color-hex').value    = hex;
  if (updatePreset) {
    document.querySelectorAll('.wm-preset-swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color.toLowerCase() === hex.toLowerCase());
    });
  }
}

document.getElementById('color-picker').addEventListener('input', e => setColor(e.target.value));
document.getElementById('color-hex').addEventListener('input', e => {
  const v = e.target.value;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) setColor(v);
});
document.querySelectorAll('.wm-preset-swatch').forEach(swatch => {
  swatch.addEventListener('click', () => {
    document.querySelectorAll('.wm-preset-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    setColor(swatch.dataset.color, false);
  });
});

/* ── Logo upload ── */
document.getElementById('logo-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    config.logoDataUrl = ev.target.result;
    const prev = document.getElementById('logo-preview');
    const icon = document.getElementById('logo-placeholder-icon');
    prev.src = ev.target.result;
    prev.style.display = 'block';
    if (icon) icon.style.display = 'none';
  };
  reader.readAsDataURL(file);
});

/* ── Asset upload ── */
function triggerAssetUpload(inputId) { document.getElementById(inputId).click(); }

function showAssetPreview(key, dataUrl) {
  const ph  = document.getElementById(key + '-placeholder');
  const img = document.getElementById(key + '-preview');
  if (ph)  ph.style.display  = 'none';
  if (img) { img.src = dataUrl; img.style.display = 'block'; }
}

function clearAsset(key) {
  const ph  = document.getElementById(key + '-placeholder');
  const img = document.getElementById(key + '-preview');
  if (ph)  ph.style.display  = 'flex';
  if (img) { img.src = ''; img.style.display = 'none'; }
  if (key === 'hero-banner')    config.heroBannerUrl = null;
  if (key === 'team-workspace') config.teamImgUrl    = null;
  if (key === 'event-1')        config.event1ImgUrl  = null;
}

function setupAssetInput(inputId, configKey) {
  document.getElementById(inputId).addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      config[configKey] = ev.target.result;
      showAssetPreview(inputId.replace('-input', ''), ev.target.result);
    };
    reader.readAsDataURL(file);
  });
}

setupAssetInput('hero-banner-input',    'heroBannerUrl');
setupAssetInput('team-workspace-input', 'teamImgUrl');
setupAssetInput('event-1-input',        'event1ImgUrl');

/* ── Profile sync ── */
['cp-about', 'cp-email', 'cp-phone', 'cp-address'].forEach(id => {
  document.getElementById(id).addEventListener('input', e => {
    const map = { 'cp-about': 'about', 'cp-email': 'email', 'cp-phone': 'phone', 'cp-address': 'address' };
    config[map[id]] = e.target.value;
  });
});

/* ── Announcements ── */
function renderAnnouncements() {
  const list = document.getElementById('announcements-list');
  list.innerHTML = '';
  if (announcements.length === 0) {
    list.innerHTML = '<p style="font-size:13px;color:var(--text-tertiary);text-align:center;padding:16px 0;">No announcements yet</p>';
    return;
  }
  announcements.forEach((ann, i) => {
    const item = document.createElement('div');
    item.className = 'wm-ann-item';
    item.innerHTML = `
      <div class="wm-ann-icon">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="15" height="15">
          <path stroke-linecap="round" stroke-linejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/>
        </svg>
      </div>
      <div class="wm-ann-content">
        <span class="wm-ann-title-text">${escHtml(ann.title)}</span>
        <span class="wm-ann-date-text">Scheduled on ${ann.date ? formatDate(ann.date) : '—'}</span>
      </div>
      <div class="wm-ann-actions">
        <button class="wm-icon-btn edit" type="button" onclick="editAnn(${i})" title="Edit">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
          </svg>
        </button>
        <button class="wm-icon-btn del" type="button" onclick="deleteAnn(${i})" title="Delete">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m5 0V4a1 1 0 011-1h2a1 1 0 011 1v2"/>
          </svg>
        </button>
      </div>
    `;
    list.appendChild(item);
  });
}

function editAnn(i) {
  const ann = announcements[i];
  document.getElementById('ann-edit-index').value  = i;
  document.getElementById('ann-title-input').value = ann.title;
  document.getElementById('ann-date-input').value  = ann.date;
  document.getElementById('ann-type-input').value  = ann.type;
  document.getElementById('ann-body-input').value  = ann.body || '';
  document.getElementById('ann-modal-title').textContent = 'Edit Announcement';
  openModal('modal-ann');
}

function deleteAnn(i) { announcements.splice(i, 1); renderAnnouncements(); }

document.getElementById('btn-add-ann').addEventListener('click', () => {
  document.getElementById('ann-edit-index').value  = -1;
  document.getElementById('ann-title-input').value = '';
  document.getElementById('ann-date-input').value  = '';
  document.getElementById('ann-type-input').value  = 'event';
  document.getElementById('ann-body-input').value  = '';
  document.getElementById('ann-modal-title').textContent = 'New Announcement';
  openModal('modal-ann');
});

document.getElementById('ann-modal-save').addEventListener('click', () => {
  const title = document.getElementById('ann-title-input').value.trim();
  if (!title) { document.getElementById('ann-title-input').focus(); return; }
  const ann = {
    title,
    date: document.getElementById('ann-date-input').value,
    type: document.getElementById('ann-type-input').value,
    body: document.getElementById('ann-body-input').value.trim()
  };
  const idx = parseInt(document.getElementById('ann-edit-index').value);
  if (idx >= 0) announcements[idx] = ann;
  else          announcements.push(ann);
  renderAnnouncements();
  closeModal('modal-ann');
});

document.getElementById('ann-modal-cancel').addEventListener('click', () => closeModal('modal-ann'));
document.getElementById('ann-modal-close').addEventListener('click',  () => closeModal('modal-ann'));

/* ── Preview mode toggle ── */
document.getElementById('btn-preview-desktop').addEventListener('click', () => {
  document.getElementById('btn-preview-desktop').classList.add('active');
  document.getElementById('btn-preview-mobile').classList.remove('active');
  document.getElementById('browser-shell').classList.remove('mobile-mode');
});
document.getElementById('btn-preview-mobile').addEventListener('click', () => {
  document.getElementById('btn-preview-mobile').classList.add('active');
  document.getElementById('btn-preview-desktop').classList.remove('active');
  document.getElementById('browser-shell').classList.add('mobile-mode');
});

/* ── Save / Discard ── */
document.getElementById('btn-save').addEventListener('click',    saveConfig);
document.getElementById('btn-discard').addEventListener('click', discardConfig);

/* ── Modals ── */
function openModal(id)  { document.getElementById(id).removeAttribute('hidden'); }
function closeModal(id) { document.getElementById(id).setAttribute('hidden', ''); }
document.querySelectorAll('.wm-modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); });
});

/* ── Toast ── */
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('wm-toast');
  document.getElementById('wm-toast-msg').textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ── Side nav active ── */
function setNavActive(el) {
  document.querySelectorAll('.wm-side-nav-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
}

/* ── Utils ── */
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ── Boot ── */
loadConfig();
applyConfigToForm();
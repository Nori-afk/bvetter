/* ============================================================
   website-management.js
   Logic for /admin/pages/website-management.html
   Backed by api.getSiteSettings()/saveSiteSettings() (site_settings
   table) and api.getAnnouncements()/saveAnnouncement()/deleteAnnouncement()
   (announcements table) — see api/site-settings/site-settings.php
   and api/announcements/announcements.php.
   ============================================================ */

const DEFAULT_CONFIG = {
  primaryColor: '#002A58',
  logo:         null,
  heroBanner:   null,
  teamImage:    null,
  event1Image:  null,
  about:    '',
  email:    'BaliwagtVC@gmail.com',
  phone:    '09959210640',
  address:  'AgriCorp Building, Baliwag Government Complex, 247 Highway, Baliwag, Philippines, 3026'
};

let config        = { ...DEFAULT_CONFIG };
let savedConfig    = { ...DEFAULT_CONFIG };
let announcements  = [];

/* Pending (unsaved) file uploads + removals, keyed by asset name */
const pendingFiles  = { logo: null, 'hero-banner': null, 'team-workspace': null, 'event-1': null };
const pendingRemove = { logo: false, 'hero-banner': false, 'team-workspace': false, 'event-1': false };

const ASSET_TO_CONFIG_KEY = {
  logo: 'logo',
  'hero-banner': 'heroBanner',
  'team-workspace': 'teamImage',
  'event-1': 'event1Image'
};

/* ── Load ── */
async function loadConfig() {
  try {
    const result = await api.getSiteSettings();
    config = result.success ? { ...DEFAULT_CONFIG, ...result.data } : { ...DEFAULT_CONFIG };
  } catch (e) {
    config = { ...DEFAULT_CONFIG };
  }
  savedConfig = { ...config };
  applyConfigToForm();
  await loadAnnouncements();
}

async function loadAnnouncements() {
  try {
    const result = await api.getAnnouncements({ status: 'all', limit: 30 });
    announcements = result.success ? result.data : [];
  } catch (e) {
    announcements = [];
  }
  renderAnnouncements();
}

/* ── Save (site settings only — announcements save instantly) ── */
async function saveConfig() {
  const formData = new FormData();
  formData.append('primary_color', config.primaryColor);
  formData.append('about', document.getElementById('cp-about').value);
  formData.append('email', document.getElementById('cp-email').value);
  formData.append('phone', document.getElementById('cp-phone').value);
  formData.append('address', document.getElementById('cp-address').value);

  const fileFieldMap = {
    logo: 'logo_file',
    'hero-banner': 'hero_banner_file',
    'team-workspace': 'team_image_file',
    'event-1': 'event1_image_file'
  };
  const removeFieldMap = {
    logo: 'remove_logo',
    'hero-banner': 'remove_hero_banner',
    'team-workspace': 'remove_team_image',
    'event-1': 'remove_event1_image'
  };

  Object.keys(pendingFiles).forEach(key => {
    if (pendingFiles[key]) {
      formData.append(fileFieldMap[key], pendingFiles[key]);
    } else if (pendingRemove[key]) {
      formData.append(removeFieldMap[key], '1');
    }
  });

  const btn = document.getElementById('btn-save');
  btn.disabled = true;

  try {
    const result = await api.saveSiteSettings(formData);
    if (!result.success) {
      showToast(result.message || 'Could not save changes');
      return;
    }
    config = { ...DEFAULT_CONFIG, ...result.data };
    savedConfig = { ...config };
    Object.keys(pendingFiles).forEach(key => { pendingFiles[key] = null; pendingRemove[key] = false; });
    applyConfigToForm();
    showToast('Changes saved — public site updated');
    sendLivePreviewUpdate();
  } catch (e) {
    console.error('saveConfig failed:', e);
    showToast('Could not save changes — ' + e.message);
  } finally {
    btn.disabled = false;
  }
}

/* ── Discard ── */
function discardConfig() {
  config = { ...savedConfig };
  Object.keys(pendingFiles).forEach(key => { pendingFiles[key] = null; pendingRemove[key] = false; });
  applyConfigToForm();
  showToast('Changes discarded');
}

/* ── Apply to form ── */
function applyConfigToForm() {
  setColor(config.primaryColor, false);

  const prev = document.getElementById('logo-preview');
  const icon = document.getElementById('logo-placeholder-icon');
  if (config.logo) {
    prev.src = config.logo;
    prev.style.display = 'block';
    if (icon) icon.style.display = 'none';
  } else {
    prev.src = '';
    prev.style.display = 'none';
    if (icon) icon.style.display = 'block';
  }

  showOrClearAssetPreview('hero-banner',    config.heroBanner);
  showOrClearAssetPreview('team-workspace', config.teamImage);
  showOrClearAssetPreview('event-1',        config.event1Image);

  document.getElementById('cp-about').value   = config.about   || '';
  document.getElementById('cp-email').value   = config.email   || '';
  document.getElementById('cp-phone').value   = config.phone   || '';
  document.getElementById('cp-address').value = config.address || '';

  sendLivePreviewUpdate();
}

function showOrClearAssetPreview(key, url) {
  if (url) showAssetPreview(key, url);
  else clearAssetPreviewOnly(key);
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
  sendLivePreviewUpdate();
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
  pendingFiles.logo = file;
  pendingRemove.logo = false;
  const reader = new FileReader();
  reader.onload = ev => {
    const prev = document.getElementById('logo-preview');
    const icon = document.getElementById('logo-placeholder-icon');
    prev.src = ev.target.result;
    prev.style.display = 'block';
    if (icon) icon.style.display = 'none';
    sendLivePreviewUpdate();
  };
  reader.readAsDataURL(file);
});

/* ── Asset upload ── */
function triggerAssetUpload(inputId) { document.getElementById(inputId).click(); }

function showAssetPreview(key, url) {
  const ph  = document.getElementById(key + '-placeholder');
  const img = document.getElementById(key + '-preview');
  if (ph)  ph.style.display  = 'none';
  if (img) { img.src = url; img.style.display = 'block'; }
}

function clearAssetPreviewOnly(key) {
  const ph  = document.getElementById(key + '-placeholder');
  const img = document.getElementById(key + '-preview');
  if (ph)  ph.style.display  = 'flex';
  if (img) { img.src = ''; img.style.display = 'none'; }
}

function clearAsset(key) {
  clearAssetPreviewOnly(key);
  pendingFiles[key] = null;
  pendingRemove[key] = true;
  config[ASSET_TO_CONFIG_KEY[key]] = null;
  sendLivePreviewUpdate();
}

function setupAssetInput(inputId, key) {
  document.getElementById(inputId).addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    pendingFiles[key] = file;
    pendingRemove[key] = false;
    const reader = new FileReader();
    reader.onload = ev => {
      showAssetPreview(key, ev.target.result);
      sendLivePreviewUpdate();
    };
    reader.readAsDataURL(file);
  });
}

setupAssetInput('hero-banner-input',    'hero-banner');
setupAssetInput('team-workspace-input', 'team-workspace');
setupAssetInput('event-1-input',        'event-1');

/* ── Profile sync ── */
['cp-about', 'cp-email', 'cp-phone', 'cp-address'].forEach(id => {
  document.getElementById(id).addEventListener('input', e => {
    const map = { 'cp-about': 'about', 'cp-email': 'email', 'cp-phone': 'phone', 'cp-address': 'address' };
    config[map[id]] = e.target.value;
    sendLivePreviewUpdate();
  });
});

/* ── Announcements (persisted immediately via the API — not batched with Save Changes) ── */
function renderAnnouncements() {
  const list = document.getElementById('announcements-list');
  list.innerHTML = '';
  if (announcements.length === 0) {
    list.innerHTML = '<p style="font-size:13px;color:var(--text-tertiary);text-align:center;padding:16px 0;">No announcements yet</p>';
    return;
  }
  announcements.forEach((ann) => {
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
        <button class="wm-icon-btn edit" type="button" onclick="editAnn(${ann.id})" title="Edit">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
          </svg>
        </button>
        <button class="wm-icon-btn del" type="button" onclick="deleteAnn(${ann.id})" title="Delete">
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

function editAnn(id) {
  const ann = announcements.find(a => a.id === id);
  if (!ann) return;
  document.getElementById('ann-edit-index').value  = ann.id;
  document.getElementById('ann-title-input').value = ann.title;
  document.getElementById('ann-date-input').value  = ann.date || '';
  document.getElementById('ann-type-input').value  = ann.category || 'event';
  document.getElementById('ann-body-input').value  = ann.description || '';
  document.getElementById('ann-modal-title').textContent = 'Edit Announcement';
  openModal('modal-ann');
}

async function deleteAnn(id) {
  try {
    const result = await api.deleteAnnouncement(id);
    if (!result.success) { showToast(result.message || 'Could not delete announcement'); return; }
    await loadAnnouncements();
    showToast('Announcement deleted');
  } catch (e) {
    showToast('Could not delete announcement — check your connection');
  }
}

document.getElementById('btn-add-ann').addEventListener('click', () => {
  document.getElementById('ann-edit-index').value  = -1;
  document.getElementById('ann-title-input').value = '';
  document.getElementById('ann-date-input').value  = '';
  document.getElementById('ann-type-input').value  = 'event';
  document.getElementById('ann-body-input').value  = '';
  document.getElementById('ann-modal-title').textContent = 'New Announcement';
  openModal('modal-ann');
});

document.getElementById('ann-modal-save').addEventListener('click', async () => {
  const title = document.getElementById('ann-title-input').value.trim();
  if (!title) { document.getElementById('ann-title-input').focus(); return; }

  const id = parseInt(document.getElementById('ann-edit-index').value, 10);
  const payload = {
    title,
    description: document.getElementById('ann-body-input').value.trim(),
    category: document.getElementById('ann-type-input').value,
    date: document.getElementById('ann-date-input').value,
    status: 'published'
  };
  if (id > 0) payload.id = id;

  try {
    const result = await api.saveAnnouncement(payload);
    if (!result.success) { showToast(result.message || 'Could not save announcement'); return; }
    await loadAnnouncements();
    showToast(id > 0 ? 'Announcement updated' : 'Announcement added');
    closeModal('modal-ann');
  } catch (e) {
    showToast('Could not save announcement — check your connection');
  }
});

document.getElementById('ann-modal-cancel').addEventListener('click', () => closeModal('modal-ann'));
document.getElementById('ann-modal-close').addEventListener('click',  () => closeModal('modal-ann'));

/* ── Live preview iframe ──
   The iframe is scaled down (CSS transform) to fit the shell's width, but a
   transform on an <iframe> breaks native wheel-event routing into its
   document. So the iframe is sized to its full (unclipped) content height,
   and the *outer* .wm-browser-content — a plain element with overflow-y:auto —
   does the scrolling natively over the scaled-down wrap. */
function sizeLivePreview() {
  const wrap = document.getElementById('wm-preview-frame-wrap');
  const iframe = document.getElementById('wm-live-preview-iframe');
  const shell = document.getElementById('browser-shell');
  if (!wrap || !iframe || !shell) return;

  const isMobile = shell.classList.contains('mobile-mode');
  const deviceWidth = isMobile ? 390 : 1440;
  const fallbackHeight = isMobile ? 3600 : 2800;
  const containerWidth = wrap.clientWidth || 1;
  const scale = containerWidth / deviceWidth;

  iframe.style.width = deviceWidth + 'px';

  let contentHeight = fallbackHeight;
  try {
    const doc = iframe.contentDocument;
    const measured = doc && doc.documentElement
      ? Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0)
      : 0;
    if (measured > 0) contentHeight = measured;
  } catch (e) {
    /* Cross-origin or not-yet-loaded — fall back to a generous fixed height. */
  }

  iframe.style.height = contentHeight + 'px';
  iframe.style.transform = `scale(${scale})`;
  wrap.style.height = (contentHeight * scale) + 'px';
}

function sendLivePreviewUpdate() {
  const iframe = document.getElementById('wm-live-preview-iframe');
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage({
    type: 'vbetter-preview-update',
    settings: config
  }, window.location.origin);
}

const livePreviewFrame = document.getElementById('wm-live-preview-iframe');
if (livePreviewFrame) {
  livePreviewFrame.addEventListener('load', () => {
    sizeLivePreview();
    sendLivePreviewUpdate();
    // Images inside the preview can finish loading after 'load' fires and
    // grow the page height — remeasure once they've had a chance to settle.
    setTimeout(sizeLivePreview, 400);
  });
}
window.addEventListener('resize', sizeLivePreview);

/* ── Preview mode toggle ── */
document.getElementById('btn-preview-desktop').addEventListener('click', () => {
  document.getElementById('btn-preview-desktop').classList.add('active');
  document.getElementById('btn-preview-mobile').classList.remove('active');
  document.getElementById('browser-shell').classList.remove('mobile-mode');
  sizeLivePreview();
});
document.getElementById('btn-preview-mobile').addEventListener('click', () => {
  document.getElementById('btn-preview-mobile').classList.add('active');
  document.getElementById('btn-preview-desktop').classList.remove('active');
  document.getElementById('browser-shell').classList.add('mobile-mode');
  sizeLivePreview();
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

/* ============================================================
   site-settings.js
   Applies admin-configured branding (logo, brand color, hero
   image, contact info) to public pages.

   Two sources, same apply function:
   1. On page load — fetches the saved settings from the backend.
   2. Live preview — the Website Management admin page embeds this
      page in an iframe and postMessages unsaved edits here so the
      preview updates as the admin types, before they hit Save.
   ============================================================ */

function applySiteSettings(settings) {
  if (!settings) return;

  if (settings.primaryColor) {
    document.documentElement.style.setProperty('--color-navy', settings.primaryColor);
  }

  if (settings.logo) {
    document.querySelectorAll('.nav-logo').forEach(img => { img.src = settings.logo; });
  }

  if (settings.heroBanner) {
    document.querySelectorAll('.hero-dog-img').forEach(img => { img.src = settings.heroBanner; });
  }

  if (settings.address) {
    const el = document.querySelector('.footer-address');
    if (el) el.textContent = settings.address;
  }

  if (settings.email) {
    const el = document.querySelector('.footer-email');
    if (el) el.textContent = settings.email;
  }

  if (settings.phone) {
    const el = document.querySelector('.footer-phone');
    if (el) el.textContent = settings.phone;
  }
}

async function loadSiteSettings() {
  try {
    const result = await api.getSiteSettings();
    if (result.success) applySiteSettings(result.data);
  } catch (e) {
    /* Public page still renders fine with its default branding. */
  }
}

/* Live preview channel — only trusted same-origin messages are applied,
   so this can't be used to inject content from elsewhere. */
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  const msg = event.data;
  if (!msg || msg.type !== 'vbetter-preview-update') return;
  applySiteSettings(msg.settings);
});

document.addEventListener('DOMContentLoaded', loadSiteSettings);

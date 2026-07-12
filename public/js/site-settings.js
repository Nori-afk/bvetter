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
    /* Staff dashboards (vet/admin) use the shared sidebar's .logo img
       instead of .nav-logo — keep the sidebar mark in sync too. */
    document.querySelectorAll('.sidebar-header .logo img').forEach(img => { img.src = settings.logo; });
  }

  if (settings.heroBanner) {
    document.querySelectorAll('.hero-dog-img').forEach(img => { img.src = settings.heroBanner; });
  }

  if (settings.teamImage) {
    const img = document.getElementById('aboutTeamImg');
    if (img) {
      img.src = settings.teamImage;
      img.classList.add('has-image');
    }
  }

  if (settings.about) {
    const el = document.getElementById('aboutText');
    if (el) el.textContent = settings.about;
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

  if (settings.clinicCapacity) {
    const el = document.getElementById('statClinicCapacity');
    if (el) el.textContent = settings.clinicCapacity;
  }

  if (settings.surgeryRecoveryRate) {
    const el = document.getElementById('statSurgeryRecovery');
    if (el) el.textContent = settings.surgeryRecoveryRate;
  }

  if (settings.specialistsCount !== undefined && settings.specialistsCount !== null) {
    const el = document.getElementById('statSpecialists');
    if (el) el.textContent = settings.specialistsCount;
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

/* Preview wheel-forwarding — only relevant when this page is embedded
   (Website Management's Quick Preview iframe). The preview scales the
   iframe down with a CSS transform so it fits the panel, which breaks
   the browser's normal wheel-scroll routing into the iframe's own
   document. Forward wheel deltas out to the parent instead, which
   scrolls the actual preview viewport on our behalf — see the matching
   'vbetter-preview-scroll' listener in admin/js/website-management.js. */
if (window.self !== window.top) {
  let sameOriginParent = false;
  try {
    sameOriginParent = window.top.location.origin === window.location.origin;
  } catch (e) {
    sameOriginParent = false;
  }

  if (sameOriginParent) {
    window.addEventListener('wheel', (event) => {
      event.preventDefault();
      window.parent.postMessage({ type: 'vbetter-preview-scroll', deltaY: event.deltaY }, window.location.origin);
    }, { passive: false });
  }
}

/**
 * BVetter – PWA install registration.
 * Registers the service worker so the browser will offer "Add to Home
 * Screen" / install. Safe no-op on browsers without service worker support.
 *
 * The worker path is derived from where this script was loaded from rather
 * than hardcoded to '/sw.js'. Registering the root path only works when the
 * app is the document root; from a subfolder — XAMPP's /final-VBETTER/bvetter/,
 * or a phone reaching the LAN IP — it 404s and the install prompt never
 * appears. This runs before auth.js on most pages, so it can't borrow
 * withBase() and works the base out itself.
 */

'use strict';

if ('serviceWorker' in navigator) {
    // Resolved here, not inside the load handler: document.currentScript is
    // only set while a script is actually executing, and is null by the time
    // a listener fires.
    const script = document.currentScript
        || Array.prototype.slice.call(document.scripts)
              .find(s => s.src && /\/shared\/js\/pwa-register\.js/.test(s.src));
    const base = script && script.src
        ? new URL(script.src, location.href).pathname
              .replace(/\/shared\/js\/pwa-register\.js.*$/, '')
        : location.pathname.replace(/\/(public|admin|vet|shared)\/.*$/, '');

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register(base + '/sw.js', { scope: base + '/' })
            .catch(() => {
                // Non-fatal — installability just won't be offered.
            });
    });
}

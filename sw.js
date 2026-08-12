/**
 * BVetter – service worker
 *
 * Intentionally minimal: registering a fetch handler is one of the browser
 * install criteria (alongside a valid manifest + HTTPS), so this exists to
 * make the site installable. It does not cache or intercept anything — the
 * backend is dynamic PHP, and caching pages/API responses here would risk
 * serving stale dashboard data. Real offline support can be layered on
 * later without touching the manifest or the install-criteria contract.
 */

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});

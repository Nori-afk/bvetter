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
    // Same-origin only.
    //
    // WHY. respondWith(fetch(...)) re-issues the request FROM THE WORKER, and
    // the worker inherits the page's Content-Security-Policy — including
    // connect-src 'self' (see .htaccess). So every cross-origin subresource
    // routed through here was blocked the moment a service worker took
    // control: Chart.js, FullCalendar, Leaflet, Leaflet.heat, Lucide, Font
    // Awesome and all the Google Fonts. In practice that meant no charts on
    // any dashboard, no appointment calendar, no barangay risk map and no web
    // font, for every user from their first visit onward — while curl fetched
    // the same URLs with a 200 the whole time, which is what made it look like
    // a CDN outage rather than our own passthrough.
    //
    // Returning early hands the request back to the browser, which fetches it
    // normally under the PAGE's CSP (script-src does allow those CDNs). The
    // install criteria still hold: what they require is a fetch handler, and
    // navigations — the requests that matter for installability — are
    // same-origin and still go through respondWith below.
    if (new URL(event.request.url).origin !== self.location.origin) {
        return;
    }
    event.respondWith(fetch(event.request));
});

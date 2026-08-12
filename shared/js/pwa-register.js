/**
 * BVetter – PWA install registration.
 * Registers the service worker so the browser will offer "Add to Home
 * Screen" / install. Safe no-op on browsers without service worker support.
 */

'use strict';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
            // Non-fatal — installability just won't be offered.
        });
    });
}

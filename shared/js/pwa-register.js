/**
 * BVetter PWA registration and quiet app update check.
 *
 * Static app files are versioned by api/app-version.php. Open pages check for
 * a new version periodically and reload after the page is idle. Edits in form
 * controls and in-flight write requests delay the reload to avoid losing work.
 */

'use strict';

(function () {
    const CHECK_INTERVAL_MS = 5 * 60 * 1000;
    const IDLE_BEFORE_RELOAD_MS = 15 * 1000;
    const editedControls = new Set();
    const controlBaselines = new WeakMap();
    let activeWrites = 0;
    let lastActivityAt = Date.now();
    let knownVersion = '';
    let updatePending = false;
    let reloadStarted = false;
    let idleTimer = 0;

    // Resolve the app root from this script, including when BVetter is hosted
    // in a subfolder such as /final-VBETTER/bvetter/.
    const script = document.currentScript
        || Array.prototype.slice.call(document.scripts)
            .find((item) => item.src && /\/shared\/js\/pwa-register\.js/.test(item.src));
    const base = script && script.src
        ? new URL(script.src, location.href).pathname
            .replace(/\/shared\/js\/pwa-register\.js.*$/, '')
        : location.pathname.replace(/\/(public|admin|vet|shared)\/.*$/, '');
    const versionUrl = `${base}/api/app-version.php`;

    function isEditableControl(element) {
        if (!(element instanceof HTMLElement)) return false;
        if (element.isContentEditable) return true;
        if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
        if (!(element instanceof HTMLInputElement)) return false;
        return !['hidden', 'button', 'submit', 'reset', 'image'].includes(element.type);
    }

    function readControlValue(element) {
        if (element instanceof HTMLInputElement) {
            if (element.type === 'checkbox' || element.type === 'radio') return element.checked;
            if (element.type === 'file') {
                return Array.from(element.files || []).map((file) => `${file.name}:${file.size}:${file.lastModified}`);
            }
            return element.value;
        }
        if (element instanceof HTMLSelectElement && element.multiple) {
            return Array.from(element.selectedOptions).map((option) => option.value);
        }
        if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
        return element.innerHTML;
    }

    function rememberBaseline(element) {
        if (!controlBaselines.has(element)) controlBaselines.set(element, readControlValue(element));
    }

    function recordEdit(event) {
        if (!event.isTrusted || !isEditableControl(event.target)) return;
        editedControls.add(event.target);
    }

    document.addEventListener('focusin', (event) => {
        if (isEditableControl(event.target)) rememberBaseline(event.target);
    }, true);
    document.addEventListener('input', recordEdit, true);
    document.addEventListener('change', recordEdit, true);
    document.addEventListener('focusout', () => {
        window.setTimeout(tryReload, 100);
    }, true);

    function hasUnsavedEdits() {
        for (const element of editedControls) {
            if (!element.isConnected) continue;
            if (!controlBaselines.has(element)) return true;
            if (JSON.stringify(controlBaselines.get(element)) !== JSON.stringify(readControlValue(element))) return true;
        }
        return false;
    }

    function noteActivity() {
        lastActivityAt = Date.now();
        if (updatePending) scheduleReloadCheck();
    }

    ['pointerdown', 'keydown', 'touchstart', 'click'].forEach((eventName) => {
        document.addEventListener(eventName, noteActivity, true);
    });

    // Track writes already in progress so an update never interrupts a save.
    if (typeof window.fetch === 'function') {
        const nativeFetch = window.fetch;
        window.fetch = function (...args) {
            const input = args[0];
            const init = args[1] || {};
            const requestMethod = init.method || (input instanceof Request ? input.method : 'GET');
            const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(String(requestMethod).toUpperCase());
            if (!isWrite) return nativeFetch.apply(this, args);

            activeWrites += 1;
            let request;
            try {
                request = nativeFetch.apply(this, args);
            } catch (error) {
                activeWrites = Math.max(0, activeWrites - 1);
                throw error;
            }
            return Promise.resolve(request).finally(() => {
                activeWrites = Math.max(0, activeWrites - 1);
                tryReload();
            });
        };
    }

    function markUpdatePending() {
        updatePending = true;
        tryReload();
    }

    function scheduleReloadCheck() {
        if (idleTimer || reloadStarted || !updatePending) return;
        const remaining = Math.max(0, IDLE_BEFORE_RELOAD_MS - (Date.now() - lastActivityAt));
        idleTimer = window.setTimeout(() => {
            idleTimer = 0;
            tryReload();
        }, remaining);
    }

    function tryReload() {
        if (!updatePending || reloadStarted || activeWrites > 0 || hasUnsavedEdits()) return;
        const focused = document.activeElement;
        if (document.visibilityState !== 'hidden' && isEditableControl(focused)) return;
        if (document.visibilityState !== 'hidden' && Date.now() - lastActivityAt < IDLE_BEFORE_RELOAD_MS) {
            scheduleReloadCheck();
            return;
        }
        reloadStarted = true;
        location.reload();
    }

    async function checkAppVersion() {
        try {
            const response = await fetch(versionUrl, {
                cache: 'no-store',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            });
            if (!response.ok) return;
            const data = await response.json();
            if (!data || typeof data.version !== 'string' || !data.version) return;
            if (!knownVersion) {
                knownVersion = data.version;
                return;
            }
            if (data.version !== knownVersion) {
                knownVersion = data.version;
                markUpdatePending();
            }
        } catch (_) {
            // A temporary network failure should not affect the app; try again
            // on the next interval or when the user returns to this tab.
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkAppVersion();
        tryReload();
    });

    window.addEventListener('load', () => {
        checkAppVersion();
        window.setInterval(() => {
            if (document.visibilityState === 'visible') checkAppVersion();
        }, CHECK_INTERVAL_MS);
    }, { once: true });

    if ('serviceWorker' in navigator) {
        const wasControlled = Boolean(navigator.serviceWorker.controller);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            // The first installation controls this page without an update;
            // only an already controlled page needs to reload after a change.
            if (wasControlled) markUpdatePending();
        });

        window.addEventListener('load', () => {
            navigator.serviceWorker
                .register(`${base}/sw.js`, { scope: `${base}/`, updateViaCache: 'none' })
                .then((registration) => {
                    const checkWorker = () => {
                        if (document.visibilityState === 'visible') registration.update().catch(() => {});
                    };
                    checkWorker();
                    window.setInterval(checkWorker, CHECK_INTERVAL_MS);
                })
                .catch(() => {
                    // Registration is optional; the app version check still works.
                });
        }, { once: true });
    }
})();

/**
 * password-policy.js — live hints for the clinic-configurable password policy
 *
 * The policy (min length / special / number / uppercase) is set by an admin in
 * Manage Security and enforced server-side. This helper only improves the UX:
 * it fetches the active policy, writes its description into any element marked
 * with [data-pw-policy-hint], and offers a client-side pre-check that mirrors
 * the server's passwordPolicyError().
 *
 * If the fetch fails, validate() falls back to the 8-character floor so forms
 * never block on a network hiccup — the server still has the final say.
 */

'use strict';

window.PasswordPolicy = (() => {
    let policy = null;

    const FALLBACK = {
        minLength: 8,
        requireSpecial: false,
        requireNumber: false,
        requireUppercase: false,
        description: 'At least 8 characters.'
    };

    // Works whether the app is served at the domain root (production droplet)
    // or from a subdirectory (local XAMPP, e.g. /final-VBETTER/bvetter/).
    const APP_BASE = location.pathname.replace(/\/(public|admin|vet|shared)\/.*$/, '');

    async function load() {
        try {
            const res = await fetch(APP_BASE + '/api/auth/password-policy.php');
            const result = await res.json();
            if (result.success && result.data) policy = result.data;
        } catch {
            // Keep fallback — server-side enforcement still applies.
        }

        document.querySelectorAll('[data-pw-policy-hint]').forEach(el => {
            el.textContent = get().description;
        });

        return get();
    }

    function get() {
        return policy || FALLBACK;
    }

    /** Returns a user-facing error message, or null when the password passes. */
    function validate(password) {
        const p = get();
        const failures = [];

        if ((password || '').length < p.minLength) failures.push(`be at least ${p.minLength} characters`);
        if (p.requireSpecial && !/[^a-zA-Z0-9]/.test(password)) failures.push('include a special character');
        if (p.requireNumber && !/[0-9]/.test(password)) failures.push('include a number');
        if (p.requireUppercase && !/[A-Z]/.test(password)) failures.push('include an uppercase letter');

        if (!failures.length) return null;

        const last = failures.pop();
        const list = failures.length ? failures.join(', ') + ' and ' + last : last;
        return 'Password must ' + list + '.';
    }

    document.addEventListener('DOMContentLoaded', load);

    return { load, get, validate };
})();

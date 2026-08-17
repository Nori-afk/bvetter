/**
 * password-policy.js — live hints and strength feedback for the password policy
 *
 * The policy is set by an admin in Manage Security (above a floor the admin
 * cannot go below) and enforced server-side. This helper only improves the
 * UX: it fetches the active policy, writes its description into any element
 * marked [data-pw-policy-hint], renders a live rule checklist and strength
 * bar into any [data-pw-strength] element, and offers a client-side pre-check
 * mirroring the server's passwordPolicyError().
 *
 * Client-side checks are convenience only — trivially bypassed by posting
 * straight to the API, which is exactly why the same rules are enforced in
 * api/config/security_settings.php. Nothing here is a security control.
 *
 * If the fetch fails, validate() falls back to the same floor the server
 * applies, so forms never accidentally accept something weaker on a network
 * hiccup.
 */

'use strict';

window.PasswordPolicy = (() => {
    let policy = null;

    // Mirrors PW_FLOOR_MIN_LENGTH and the locked character classes in
    // api/config/security_settings.php.
    const FALLBACK = {
        minLength: 12,
        requireSpecial: true,
        requireNumber: true,
        requireUppercase: true,
        requireLowercase: true,
        description: 'At least 12 characters, with an uppercase letter, a lowercase letter, a number and a special character.'
    };

    /* Base words, matched after the same normalisation the server applies, so
       "Password123!" and "P@ssw0rd!" are both caught here too and the user
       finds out while typing rather than on submit. Deliberately a short
       subset of api/config/common_passwords.php — the server holds the full
       list and has the final say. */
    const COMMON = new Set([
        'password', 'passwd', 'welcome', 'admin', 'administrator', 'letmein',
        'qwerty', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'abcdef', 'iloveyou',
        'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball',
        'shadow', 'master', 'secret', 'changeme', 'trustno', 'freedom',
        'bvetter', 'vbetter', 'veterinary', 'veterinarian', 'clinic', 'animal',
        'baliwag', 'baliuag', 'bulacan', 'philippines', 'pilipinas', 'barangay',
        'thesis', 'capstone', 'project', 'system', 'database', 'computer',
        'mahalkita', 'salamat', 'kumusta', 'january', 'december', 'christmas'
    ]);

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

        document.querySelectorAll('[data-pw-strength]').forEach(mountStrength);

        return get();
    }

    function get() {
        return policy || FALLBACK;
    }

    /** Mirrors passwordBaseWord() in api/config/security_settings.php. */
    function baseWord(password) {
        return (password || '')
            .toLowerCase()
            .replace(/^[^a-z0-9]+|[^a-z]+$/g, '')
            .replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i')
            .replace(/0/g, 'o').replace(/[$5]/g, 's').replace(/[7+]/g, 't')
            .replace(/[^a-z]/g, '');
    }

    /** The individual rules, each with a label and a test. */
    function rules() {
        const p = get();
        const list = [{
            label: `At least ${p.minLength} characters`,
            test: (v) => (v || '').length >= p.minLength
        }];
        if (p.requireUppercase) list.push({ label: 'An uppercase letter', test: (v) => /[A-Z]/.test(v) });
        if (p.requireLowercase) list.push({ label: 'A lowercase letter', test: (v) => /[a-z]/.test(v) });
        if (p.requireNumber)    list.push({ label: 'A number', test: (v) => /[0-9]/.test(v) });
        if (p.requireSpecial)   list.push({ label: 'A special character', test: (v) => /[^a-zA-Z0-9]/.test(v) });
        list.push({
            label: 'Not a commonly used password',
            test: (v) => !!v && !COMMON.has(baseWord(v))
        });
        return list;
    }

    /** Returns a user-facing error message, or null when the password passes. */
    function validate(password) {
        const p = get();
        const failures = [];

        if ((password || '').length < p.minLength) failures.push(`be at least ${p.minLength} characters`);
        if (p.requireUppercase && !/[A-Z]/.test(password)) failures.push('include an uppercase letter');
        if (p.requireLowercase && !/[a-z]/.test(password)) failures.push('include a lowercase letter');
        if (p.requireNumber && !/[0-9]/.test(password)) failures.push('include a number');
        if (p.requireSpecial && !/[^a-zA-Z0-9]/.test(password)) failures.push('include a special character');

        if (failures.length) {
            const last = failures.pop();
            const list = failures.length ? failures.join(', ') + ' and ' + last : last;
            return 'Password must ' + list + '.';
        }

        if (COMMON.has(baseWord(password))) {
            return 'That password is too easy to guess. Avoid common words like "password" or "welcome", even with numbers or symbols added.';
        }
        return null;
    }

    /**
     * Strength score 0-4. Length does most of the work, because it is what
     * actually costs an attacker time; the classes are already mandatory, so
     * scoring them again would just show 'strong' for every valid password.
     */
    function score(password) {
        const v = password || '';
        if (!v) return 0;
        if (validate(v) !== null) return 0;

        let s = 1;
        if (v.length >= 14) s++;
        if (v.length >= 18) s++;
        if (new Set(v).size >= 12) s++;
        return Math.min(4, s);
    }

    const LEVELS = [
        // Score 0 means the password fails a rule outright. It still needs a
        // label — an empty one next to an empty bar reads as "nothing has
        // been assessed yet" rather than "this is not acceptable".
        { label: 'Too weak', color: '#e53e3e' },
        { label: 'Weak', color: '#e53e3e' },
        { label: 'Fair', color: '#f59e0b' },
        { label: 'Strong', color: '#00B928' },
        { label: 'Very strong', color: '#047857' }
    ];

    let stylesInjected = false;
    function injectStyles() {
        if (stylesInjected) return;
        stylesInjected = true;
        const style = document.createElement('style');
        style.textContent = `
            .pw-strength { margin-top: 8px; font-family: inherit; }
            .pw-strength-bar { height: 6px; border-radius: 99px; background: #e5e7eb; overflow: hidden; }
            .pw-strength-fill { height: 100%; width: 0; border-radius: 99px; transition: width .2s, background-color .2s; }
            .pw-strength-label { font-size: 11.5px; font-weight: 700; margin-top: 5px; min-height: 14px; }
            .pw-rules { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 3px; }
            .pw-rules li { font-size: 11.5px; font-weight: 500; color: #8A94A6; display: flex; align-items: center; gap: 6px; }
            .pw-rules li::before { content: '\\2715'; font-size: 10px; font-weight: 800; color: #c2c8d2; width: 12px; text-align: center; }
            .pw-rules li.ok { color: #1B6D24; }
            .pw-rules li.ok::before { content: '\\2713'; color: #00B928; }
        `;
        document.head.appendChild(style);
    }

    /**
     * Wires a [data-pw-strength="inputId"] element to that password input,
     * rendering the rule checklist and strength bar as the user types.
     *
     * Where a form mounts this, it does NOT also need [data-pw-policy-hint]:
     * the checklist states every rule and reflects an admin-raised minimum
     * the same way. create-account.html in particular must not have both —
     * its .hint span is float:right, so the full policy sentence takes the
     * whole line and collapses the password input beside it.
     */
    function mountStrength(host) {
        const input = document.getElementById(host.getAttribute('data-pw-strength'));
        if (!input || host.dataset.pwMounted === '1') return;
        host.dataset.pwMounted = '1';

        injectStyles();
        host.classList.add('pw-strength');
        host.innerHTML = `
            <div class="pw-strength-bar"><div class="pw-strength-fill"></div></div>
            <div class="pw-strength-label"></div>
            <ul class="pw-rules"></ul>
        `;

        const fill  = host.querySelector('.pw-strength-fill');
        const label = host.querySelector('.pw-strength-label');
        const list  = host.querySelector('.pw-rules');

        const current = rules();
        current.forEach(rule => {
            const li = document.createElement('li');
            li.textContent = rule.label;
            list.appendChild(li);
        });

        const render = () => {
            const value = input.value;
            current.forEach((rule, i) => {
                list.children[i].classList.toggle('ok', rule.test(value));
            });

            const s = score(value);
            const level = LEVELS[s];
            // A sliver of red at score 0, so the bar reads as "assessed and
            // rejected" rather than as an untouched empty track.
            fill.style.width = value ? Math.max(8, s / 4 * 100) + '%' : '0%';
            fill.style.backgroundColor = level.color;
            label.style.color = level.color;
            label.textContent = value ? level.label : '';
        };

        input.addEventListener('input', render);
        render();
    }

    document.addEventListener('DOMContentLoaded', load);

    return { load, get, validate, score, rules, mountStrength };
})();

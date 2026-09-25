/**
 * password-policy.js — live hints and strength feedback for the password policy
 *
 * The policy is set by an admin in Manage Security (above a floor the admin
 * cannot go below) and enforced server-side. This helper only improves the
 * UX: it fetches the active policy, writes its description into any element
 * marked [data-pw-policy-hint], renders a live rule checklist and strength
 * bar into any [data-pw-strength] element, a live "passwords match" line into
 * any [data-pw-match] element, and offers a client-side pre-check mirroring
 * the server's passwordPolicyError().
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

        mountAll();

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
            common: true,
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
     * Length that turns an acceptable password into a strong one. Never
     * below the admin's minimum, so raising the minimum in Manage Security
     * can't make "Strong" easier to reach than "Medium".
     */
    function strongLength() {
        return Math.max(16, get().minLength);
    }

    /**
     * Strength level 0-2, in the three words people actually use:
     *   0 Weak   - a rule is missing, so the form will not accept it
     *   1 Medium - every rule is met; accepted
     *   2 Strong - every rule is met and it is long
     *
     * The old 0-4 score labelled a password that met every rule as a red
     * "Weak" next to an all-green checklist, and nothing said what "strong"
     * meant or how to get there. Only Weak blocks a form -- the rules are the
     * bar the admin set, and demanding Strong on top of it only frustrates.
     */
    function score(password) {
        const v = password || '';
        if (!v || validate(v) !== null) return 0;
        return v.length >= strongLength() ? 2 : 1;
    }

    const LEVELS = [
        { label: 'Weak', color: '#e53e3e', width: 33 },
        { label: 'Medium', color: '#d97706', width: 66 },
        { label: 'Strong', color: '#00B928', width: 100 }
    ];

    /** One line telling the user what to do next at their current level. */
    function hint(password) {
        const v = password || '';
        const s = score(v);

        if (s === 0) {
            // Character rules read well as a list; a common password needs
            // its own sentence ("too easy to guess"), which validate() has.
            const missing = rules().filter(rule => !rule.common && !rule.test(v)).map(rule => rule.label.toLowerCase());
            if (!missing.length) return validate(v) || '';
            const last = missing.pop();
            return 'Still needed: ' + (missing.length ? missing.join(', ') + ' and ' + last : last) + '.';
        }
        if (s === 1) {
            const more = strongLength() - v.length;
            return `Good. Add ${more} more character${more === 1 ? '' : 's'} to make it Strong.`;
        }
        return 'Strong password.';
    }

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
            .pw-strength-label .pw-strength-hint { font-weight: 500; color: #5b6475; }
            .pw-rules { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 3px; }
            .pw-rules li { font-size: 11.5px; font-weight: 500; color: #8A94A6; display: flex; align-items: center; gap: 6px; }
            .pw-rules li::before { content: '\\2715'; font-size: 10px; font-weight: 800; color: #c2c8d2; width: 12px; text-align: center; }
            .pw-rules li.ok { color: #1B6D24; }
            .pw-rules li.ok::before { content: '\\2713'; color: #00B928; }
            .pw-match { font-size: 11.5px; font-weight: 600; margin-top: 6px; min-height: 14px; }
            .pw-match.is-bad { color: #e53e3e; }
            .pw-match.is-ok { color: #1B6D24; }
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
            <div class="pw-strength-label" aria-live="polite"></div>
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

            const level = LEVELS[score(value)];
            fill.style.width = value ? level.width + '%' : '0%';
            fill.style.backgroundColor = level.color;
            label.style.color = level.color;
            label.textContent = '';
            if (!value) return;

            label.append(level.label + ' · ');
            const note = document.createElement('span');
            note.className = 'pw-strength-hint';
            note.textContent = hint(value);
            label.appendChild(note);
        };

        input.addEventListener('input', render);
        render();
    }

    /**
     * Wires a [data-pw-match="passwordId"] element, placed under a confirm
     * field whose id is in [data-pw-confirm], so a mismatch shows while the
     * user types instead of only after they press the form's button.
     *
     * It stays quiet while the confirmation is still the start of the
     * password (they are mid-typing, not wrong), says so the moment a
     * character differs or they leave the field short, and turns green on an
     * exact match. Editing the first password re-checks it. The form's own
     * submit-time check stays as the backstop -- this is feedback only.
     */
    function mountMatch(host) {
        const password = document.getElementById(host.getAttribute('data-pw-match'));
        const confirm  = document.getElementById(host.getAttribute('data-pw-confirm'));
        if (!password || !confirm || host.dataset.pwMounted === '1') return;
        host.dataset.pwMounted = '1';

        injectStyles();
        host.classList.add('pw-match');
        host.setAttribute('aria-live', 'polite');

        let left = false;
        const render = () => {
            const a = password.value;
            const b = confirm.value;
            host.classList.remove('is-ok', 'is-bad');
            host.textContent = '';
            if (!b) return;

            if (a === b) {
                host.classList.add('is-ok');
                host.textContent = '✓ Passwords match';
            } else if (!a.startsWith(b) || left) {
                host.classList.add('is-bad');
                host.textContent = 'Passwords don’t match';
            }
        };

        confirm.addEventListener('input', () => { left = false; render(); });
        confirm.addEventListener('blur', () => { left = true; render(); });
        password.addEventListener('input', render);
        render();
    }

    /** Mounts any strength/match hosts under root (default: the whole page). */
    function mountAll(root) {
        const scope = root || document;
        scope.querySelectorAll('[data-pw-strength]').forEach(mountStrength);
        scope.querySelectorAll('[data-pw-match]').forEach(mountMatch);
    }

    document.addEventListener('DOMContentLoaded', load);

    return { load, get, validate, score, hint, rules, mountStrength, mountMatch, mountAll };
})();

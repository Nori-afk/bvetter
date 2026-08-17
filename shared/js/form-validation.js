/**
 * BVetter – Shared client-side form validation  (shared/js/form-validation.js)
 * ─────────────────────────────────────────────────────────────
 * Extracted from public/js/book-appointment.js, which was the only file in the
 * whole front end that had inline field validation. Every other form — signup,
 * announcements, site settings, tickets — had none, so each one had to grow its
 * own copy or go without. This is the one copy.
 *
 * NOTHING HERE IS A SECURITY CONTROL. All of it is skipped by posting straight
 * to the endpoint, which is why the same rules are enforced server-side:
 *   - identity fields   api/config/input_validation.php
 *   - email / mobile    api/auth/register.php, api/appointments/appointment.php
 * The job of this file is to tell an honest user what is wrong before they
 * submit, and to mark WHICH field is wrong rather than firing one vague popup.
 *
 * Markup contract: an input is expected to sit inside a `.form-group`, which is
 * where `.has-error` and the appended `.field-error-msg` land. That holds for
 * public/pages (58 wrappers) and admin/pages (34), but NOT for vet/html, which
 * uses a flat `.form-input` convention with nothing to hang an error on. Vet
 * forms therefore keep surfacing server-side errors through the existing modal
 * instead — restructuring those pages was judged the riskier change.
 * setGroupError() no-ops safely when there is no `.form-group`, so calling this
 * from a vet page degrades quietly rather than throwing.
 */

'use strict';

window.VBForm = (() => {

    /* ── Field-level error rendering ─────────────────────────── */

    function setGroupError(group, message) {
        if (!group) return;
        group.classList.add('has-error');
        let msg = group.querySelector('.field-error-msg');
        if (!msg) {
            msg = document.createElement('span');
            msg.className = 'field-error-msg';
            group.appendChild(msg);
        }
        msg.textContent = message;
    }

    function clearGroupError(group) {
        if (!group) return;
        group.classList.remove('has-error');
        const msg = group.querySelector('.field-error-msg');
        if (msg) msg.remove();
    }

    /* Two wrapper conventions exist in this codebase and both are supported:
       public/pages uses `.form-group` (58 of them), admin/pages mostly uses
       `.wm-form-group` (11, against 3 plain ones). vet/html has neither, which
       is why vet forms stay on modal errors -- this returns null there and
       every validator degrades to a silent pass rather than throwing. */
    const GROUP_SELECTOR = '.form-group, .wm-form-group';

    function groupOf(el) {
        return el ? el.closest(GROUP_SELECTOR) : null;
    }

    /** Marks `id` with `message` and returns false, or clears it and returns true. */
    function fail(el, message) {
        setGroupError(groupOf(el), message);
        return false;
    }

    function pass(el) {
        clearGroupError(groupOf(el));
        return true;
    }

    /* ── Format rules ───────────────────────────────────────── */

    /* Mirrors FILTER_VALIDATE_EMAIL closely enough to catch what a person
       actually mistypes (missing @, missing domain, trailing dot). It is
       deliberately not an RFC-complete pattern — the server has the final
       say, and an over-clever regex here would reject valid addresses. */
    function isValidEmail(value) {
        const trimmed = String(value || '').trim();
        return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(trimmed);
    }

    /* Mirrors assertValidPHMobile() in api/appointments/appointment.php and the
       same regex in api/auth/register.php. Mobile only — no landlines — because
       both write to users.phone_number and must agree on what that column holds. */
    function isValidPHPhone(value) {
        return /^(?:\+63|63|0)9\d{9}$/.test(String(value || '').trim().replace(/[\s-]/g, ''));
    }

    /* ── Field validators ───────────────────────────────────── */

    /** Non-empty. Returns true when the field is absent, so a form that
        doesn't have this input isn't blocked by a rule about it. */
    function validateRequired(id, message) {
        const el = document.getElementById(id);
        if (!el) return true;
        return (el.value || '').trim() ? pass(el) : fail(el, message);
    }

    /** Non-empty AND a plausible address. */
    function validateEmail(id, requiredMessage, formatMessage) {
        const el = document.getElementById(id);
        if (!el) return true;
        const value = (el.value || '').trim();
        if (!value) return fail(el, requiredMessage || 'Please enter your email address.');
        if (!isValidEmail(value)) {
            return fail(el, formatMessage || 'Please enter a valid email address, e.g. juan@example.com.');
        }
        return pass(el);
    }

    /** Non-empty AND a valid PH mobile number. */
    function validatePHPhone(id, requiredMessage, formatMessage) {
        const el = document.getElementById(id);
        if (!el) return true;
        const value = (el.value || '').trim();
        if (!value) return fail(el, requiredMessage || 'Please enter your contact number.');
        if (!isValidPHPhone(value)) {
            return fail(el, formatMessage || 'Please enter a valid Philippine mobile number, e.g. 09171234567.');
        }
        return pass(el);
    }

    /** Length cap, matching the server's identity-field limits. */
    function validateMaxLength(id, maxLength, message) {
        const el = document.getElementById(id);
        if (!el) return true;
        const value = (el.value || '').trim();
        if (value.length > maxLength) {
            return fail(el, message || `Please use ${maxLength} characters or fewer.`);
        }
        return pass(el);
    }

    /* Rejects the two characters api/config/input_validation.php rejects, so a
       name or title containing markup is reported at the field instead of
       coming back as a bare 422. Same narrow rule: < and > only, so O'Brien
       and Ñina still pass. */
    function validateNoMarkup(id, label) {
        const el = document.getElementById(id);
        if (!el) return true;
        const value = (el.value || '').trim();
        if (/[<>]/.test(value)) {
            return fail(el, `${label || 'This field'} cannot contain the characters < or >.`);
        }
        return pass(el);
    }

    /** Scrolls the first error inside `scopeSelector` into view. */
    function focusFirstError(scopeSelector) {
        const scope = scopeSelector ? document.querySelector(scopeSelector) : document;
        const firstError = scope ? scope.querySelector('.has-error') : null;
        if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return firstError;
    }

    /** Clears every error marker inside `scopeSelector`. */
    function clearAll(scopeSelector) {
        const scope = scopeSelector ? document.querySelector(scopeSelector) : document;
        if (!scope) return;
        scope.querySelectorAll('.has-error').forEach(clearGroupError);
    }

    /** Clears a field's error as soon as the user starts fixing it, so the red
        marker doesn't sit there while they type the correction. */
    function clearOnInput(ids) {
        (Array.isArray(ids) ? ids : [ids]).forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const handler = () => clearGroupError(groupOf(el));
            el.addEventListener('input', handler);
            el.addEventListener('change', handler);
        });
    }

    return {
        setGroupError,
        clearGroupError,
        isValidEmail,
        isValidPHPhone,
        validateRequired,
        validateEmail,
        validatePHPhone,
        validateMaxLength,
        validateNoMarkup,
        focusFirstError,
        clearAll,
        clearOnInput
    };
})();

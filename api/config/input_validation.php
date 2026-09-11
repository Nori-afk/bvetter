<?php
/**
 * BVetter – server-side input validation for identity-type fields
 *
 * Why this is on the server and not only in the browser: a form check in JS
 * is skipped entirely by posting straight to the endpoint with curl, so it
 * protects nobody. The browser-side checks in signup.js and friends are for
 * telling an honest user what's wrong; these are the ones that hold.
 *
 * Scope is deliberate. Two different kinds of text field need two different
 * treatments:
 *
 *   identity fields   names, breeds, barangays, contact details. Angle
 *                     brackets and control characters have no legitimate
 *                     place in them, so they are REJECTED here — the
 *                     narrowest rule that still admits every real value,
 *                     including O'Brien, Ñina and Dela Cruz-Santos.
 *
 *   free text         descriptions, visit notes, ticket bodies. A vet
 *                     legitimately writes "temp > 39C" and an owner writes
 *                     "dog is < 1 year old", so rejecting angle brackets
 *                     there would break real use. Those are made safe on the
 *                     way OUT instead — see apiSafeText() in this file and
 *                     the escaping applied when they are rendered.
 *
 * Length caps apply to both: unbounded text is a denial-of-service surface
 * and a way to blow past column widths.
 */

/** Characters no legitimate name, breed or place contains. */
function containsMarkupOrControl(string $value): bool
{
    if (strpbrk($value, '<>') !== false) {
        return true;
    }
    // C0/C1 control characters, excluding tab/newline/carriage return.
    return preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $value) === 1;
}

/**
 * Validates an identity-type field. Returns a user-facing error message, or
 * null when the value is acceptable.
 *
 * @param string $label  How the field is named to the user, e.g. "Full name".
 */
function identityFieldError(string $value, string $label, int $maxLength = 150, int $minLength = 1): ?string
{
    $trimmed = trim($value);

    if ($minLength > 0 && $trimmed === '') {
        return $label . ' is required.';
    }
    if ($trimmed !== '' && mb_strlen($trimmed) < $minLength) {
        return $label . ' must be at least ' . $minLength . ' characters.';
    }
    if (mb_strlen($trimmed) > $maxLength) {
        return $label . ' must be ' . $maxLength . ' characters or fewer.';
    }
    if (containsMarkupOrControl($trimmed)) {
        return $label . ' cannot contain the characters < or >.';
    }
    return null;
}

/**
 * Runs identityFieldError() over several fields and returns the first
 * problem found, so callers stay a single line per endpoint.
 *
 * @param array $fields [ [value, label] or [value, label, maxLength] , ... ]
 */
function firstIdentityFieldError(array $fields): ?string
{
    foreach ($fields as $field) {
        $error = identityFieldError(
            (string) ($field[0] ?? ''),
            (string) ($field[1] ?? 'This field'),
            (int) ($field[2] ?? 150),
            (int) ($field[3] ?? 1)
        );
        if ($error !== null) {
            return $error;
        }
    }
    return null;
}

/**
 * Neutralises markup in a free-text value on its way out of the API, so a
 * render site that forgets to escape still cannot be made to execute
 * anything. This is the output-side counterpart to identityFieldError():
 * fields that legitimately contain "temp > 39C" can't reject angle
 * brackets, so they get defanged here instead.
 *
 * ANGLE BRACKETS ONLY — deliberately not htmlspecialchars().
 *
 * A full htmlspecialchars() would also encode quotes and ampersands, and
 * the browser then escapes the result a second time at the render site,
 * so the user sees O&#039;Brien instead of O'Brien. Encoding only < and >
 * avoids that entirely: no legitimate value contains them, so legitimate
 * data passes through byte-for-byte and renders correctly. Only an actual
 * injection attempt is altered, and a double-escaped payload looks ugly
 * but is inert — which is the right trade.
 */
function apiSafeText(?string $value): string
{
    return str_replace(['<', '>'], ['&lt;', '&gt;'], (string) $value);
}

/**
 * True when a string is a real calendar date in Y-m-d form.
 *
 * WHY NOT strtotime() ALONE. Every date rule in this codebase used to be
 * shaped `preg_match('/^\d{4}-\d{2}-\d{2}$/') || strtotime() === false`, and
 * that pair looks airtight but is not: strtotime('2027-02-30') does not fail,
 * it rolls the value over to 2 March and returns a perfectly good timestamp.
 * So the shape check passed, the range checks passed, the impossible date went
 * into the INSERT, and MySQL was the first thing to object -- turning what
 * should have been a 422 with a clear message into a 500 and a logged
 * PDOException. checkdate() is the part that actually rejects February 30th,
 * September 31st and friends.
 *
 * The regex is still needed alongside it: it pins the format (so '2026-9-11'
 * and 'next tuesday' are refused rather than silently reinterpreted) and it
 * supplies the three integer parts checkdate() needs.
 *
 * Date pickers cannot produce these values. Everything that posts to an
 * endpoint without going through one can.
 */
function isValidYmd(?string $date): bool
{
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', (string) $date, $parts)) {
        return false;
    }
    return checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1]);
}

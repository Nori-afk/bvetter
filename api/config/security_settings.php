<?php
/**
 * BVetter – Clinic-wide security settings (Manage Security page)
 *
 * Single-row table holding:
 *   - two_factor_enabled   – email-OTP 2FA required for vet/admin logins
 *   - pw_min_length        – password policy: minimum length
 *   - pw_require_special   – password policy: at least one special character
 *   - pw_require_number    – password policy: at least one digit
 *   - pw_require_uppercase – password policy: at least one uppercase letter
 *
 * The password policy is enforced server-side everywhere a password is set:
 * registration, password reset, admin account creation, and password change.
 * Read by api/admin/security-settings.php (admin UI) and
 * api/auth/password-policy.php (public hints for forms).
 */

function ensureSecuritySettingsSchema(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS security_settings (
            id                          TINYINT UNSIGNED PRIMARY KEY,
            two_factor_enabled          TINYINT(1)        NOT NULL DEFAULT 1,
            pw_min_length               TINYINT UNSIGNED  NOT NULL DEFAULT 8,
            pw_require_special          TINYINT(1)        NOT NULL DEFAULT 0,
            pw_require_number           TINYINT(1)        NOT NULL DEFAULT 0,
            pw_require_uppercase        TINYINT(1)        NOT NULL DEFAULT 0,
            inactivity_lockout_enabled  TINYINT(1)        NOT NULL DEFAULT 0,
            inactivity_lockout_days     SMALLINT UNSIGNED NOT NULL DEFAULT 90,
            session_idle_minutes        SMALLINT UNSIGNED NOT NULL DEFAULT 30,
            updated_at                  DATETIME          NOT NULL DEFAULT NOW() ON UPDATE NOW()
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec('INSERT IGNORE INTO security_settings (id) VALUES (1)');

    // Added after initial release — ALTER for installs where the table
    // already existed without these columns (mirrors ensureLoginSecuritySchema()).
    if (!$pdo->query("SHOW COLUMNS FROM security_settings LIKE 'inactivity_lockout_enabled'")->fetch()) {
        $pdo->exec("ALTER TABLE security_settings ADD COLUMN inactivity_lockout_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER pw_require_uppercase");
    }
    if (!$pdo->query("SHOW COLUMNS FROM security_settings LIKE 'inactivity_lockout_days'")->fetch()) {
        $pdo->exec("ALTER TABLE security_settings ADD COLUMN inactivity_lockout_days SMALLINT UNSIGNED NOT NULL DEFAULT 90 AFTER inactivity_lockout_enabled");
    }
    if (!$pdo->query("SHOW COLUMNS FROM security_settings LIKE 'session_idle_minutes'")->fetch()) {
        $pdo->exec("ALTER TABLE security_settings ADD COLUMN session_idle_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30 AFTER inactivity_lockout_days");
    }
}

/** Bounds for the admin-set idle window, enforced on read and on write. */
const SESSION_IDLE_MIN_MINUTES = 5;
const SESSION_IDLE_MAX_MINUTES = 480;

/**
 * Password policy floor. An admin can make the policy stricter than this,
 * never weaker — so "registration requires a strong password" stays true
 * regardless of what anyone toggles later.
 *
 * Applied on READ rather than on write, so it also governs rows written
 * before the floor existed (this table shipped with a default of 8 and
 * every character requirement switched off, which allowed literally
 * "password" as a valid choice at signup).
 */
const PW_FLOOR_MIN_LENGTH = 12;
const PW_MAX_LENGTH       = 64;

function getSecuritySettings(PDO $pdo): array
{
    ensureSecuritySettingsSchema($pdo);

    $row = $pdo->query('SELECT * FROM security_settings WHERE id = 1')->fetch();

    return [
        'two_factor_enabled'         => (bool) $row['two_factor_enabled'],
        // Floor applied here: an admin may raise the minimum, never lower it,
        // and the four character classes are always required.
        'pw_min_length'              => max(PW_FLOOR_MIN_LENGTH, (int) $row['pw_min_length']),
        'pw_require_special'         => true,
        'pw_require_number'          => true,
        'pw_require_uppercase'       => true,
        'pw_require_lowercase'       => true,
        'inactivity_lockout_enabled' => (bool) $row['inactivity_lockout_enabled'],
        'inactivity_lockout_days'    => (int) $row['inactivity_lockout_days'],
        'session_idle_minutes'       => max(
            SESSION_IDLE_MIN_MINUTES,
            min(SESSION_IDLE_MAX_MINUTES, (int) $row['session_idle_minutes'])
        ),
        'updated_at'                 => $row['updated_at'],
    ];
}

/**
 * Reduces a password to the word an attacker would recognise, so the
 * blocklist can be a short list of base words instead of an endless list of
 * decorated variants.
 *
 *   Password123!  ->  password        P@ssw0rd!   ->  password
 *   Welcome2025!  ->  welcome         B@liwag123  ->  baliwag
 *
 * Trailing/leading digits and punctuation go first, then the usual character
 * substitutions are undone, then anything left that isn't a letter is dropped.
 */
function passwordBaseWord(string $password): string
{
    $s = strtolower($password);
    $s = preg_replace('/^[^a-z0-9]+|[^a-z]+$/', '', $s);
    $s = strtr($s, [
        '@' => 'a', '4' => 'a', '3' => 'e', '1' => 'i', '!' => 'i',
        '|' => 'i', '0' => 'o', '$' => 's', '5' => 's', '7' => 't', '+' => 't',
    ]);
    return preg_replace('/[^a-z]/', '', $s);
}

/** True when the password is a known-common word in disguise. */
function isCommonPassword(string $password): bool
{
    static $blocklist = null;
    if ($blocklist === null) {
        $blocklist = array_flip(require __DIR__ . '/common_passwords.php');
    }

    $base = passwordBaseWord($password);
    return $base !== '' && isset($blocklist[$base]);
}

/**
 * True when the password is built out of the user's own name or email —
 * the first thing anyone who knows them would try.
 */
function passwordContainsIdentity(string $password, array $identity): bool
{
    $haystack = strtolower($password);
    $parts = [];

    foreach (preg_split('/\s+/', (string) ($identity['name'] ?? '')) as $word) {
        $parts[] = $word;
    }
    $email = (string) ($identity['email'] ?? '');
    if ($email !== '') {
        $parts[] = substr($email, 0, strpos($email . '@', '@'));
    }

    foreach ($parts as $part) {
        $part = strtolower(preg_replace('/[^a-z0-9]/i', '', $part));
        // Short fragments would produce false rejections ("Li", "de").
        if (strlen($part) >= 4 && strpos($haystack, $part) !== false) {
            return true;
        }
    }
    return false;
}

/**
 * Validates $password against the active policy. Returns null when it
 * passes, otherwise a user-facing message listing what's missing.
 *
 * $identity is optional { name, email } for the account the password is
 * being set on; when supplied, passwords built from the user's own name or
 * email address are rejected.
 */
function passwordPolicyError(PDO $pdo, string $password, array $identity = []): ?string
{
    $settings = getSecuritySettings($pdo);
    $failures = [];

    if (strlen($password) < $settings['pw_min_length']) {
        $failures[] = 'be at least ' . $settings['pw_min_length'] . ' characters';
    }
    if ($settings['pw_require_uppercase'] && !preg_match('/[A-Z]/', $password)) {
        $failures[] = 'include an uppercase letter';
    }
    if ($settings['pw_require_lowercase'] && !preg_match('/[a-z]/', $password)) {
        $failures[] = 'include a lowercase letter';
    }
    if ($settings['pw_require_number'] && !preg_match('/[0-9]/', $password)) {
        $failures[] = 'include a number';
    }
    if ($settings['pw_require_special'] && !preg_match('/[^a-zA-Z0-9]/', $password)) {
        $failures[] = 'include a special character';
    }

    if ($failures) {
        $last = array_pop($failures);
        $list = $failures ? implode(', ', $failures) . ' and ' . $last : $last;
        return 'Password must ' . $list . '.';
    }

    // Checked after the composition rules so the message is specific: these
    // two are the ones that catch an otherwise "valid" Password123!.
    if (isCommonPassword($password)) {
        return 'That password is too easy to guess. Avoid common words like "password" or "welcome", even with numbers or symbols added.';
    }
    if ($identity && passwordContainsIdentity($password, $identity)) {
        return 'Your password must not contain your own name or email address.';
    }

    return null;
}

/**
 * Short human-readable summary of the active policy, for form hints.
 * e.g. "At least 12 characters, with an uppercase letter, a lowercase
 * letter, a number and a special character."
 */
function passwordPolicyDescription(array $settings): string
{
    $extras = [];
    if ($settings['pw_require_uppercase']) $extras[] = 'an uppercase letter';
    if ($settings['pw_require_lowercase']) $extras[] = 'a lowercase letter';
    if ($settings['pw_require_number'])    $extras[] = 'a number';
    if ($settings['pw_require_special'])   $extras[] = 'a special character';

    $text = 'At least ' . $settings['pw_min_length'] . ' characters';
    if ($extras) {
        $last = array_pop($extras);
        $text .= ', with ' . ($extras ? implode(', ', $extras) . ' and ' . $last : $last);
    }
    return $text . '.';
}

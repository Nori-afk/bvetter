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
}

function getSecuritySettings(PDO $pdo): array
{
    ensureSecuritySettingsSchema($pdo);

    $row = $pdo->query('SELECT * FROM security_settings WHERE id = 1')->fetch();

    return [
        'two_factor_enabled'         => (bool) $row['two_factor_enabled'],
        'pw_min_length'              => (int) $row['pw_min_length'],
        'pw_require_special'         => (bool) $row['pw_require_special'],
        'pw_require_number'          => (bool) $row['pw_require_number'],
        'pw_require_uppercase'       => (bool) $row['pw_require_uppercase'],
        'inactivity_lockout_enabled' => (bool) $row['inactivity_lockout_enabled'],
        'inactivity_lockout_days'    => (int) $row['inactivity_lockout_days'],
        'updated_at'                 => $row['updated_at'],
    ];
}

/**
 * Validates $password against the stored policy. Returns null when it
 * passes, otherwise a user-facing message listing what's missing.
 */
function passwordPolicyError(PDO $pdo, string $password): ?string
{
    $settings = getSecuritySettings($pdo);
    $failures = [];

    if (strlen($password) < $settings['pw_min_length']) {
        $failures[] = 'be at least ' . $settings['pw_min_length'] . ' characters';
    }
    if ($settings['pw_require_special'] && !preg_match('/[^a-zA-Z0-9]/', $password)) {
        $failures[] = 'include a special character';
    }
    if ($settings['pw_require_number'] && !preg_match('/[0-9]/', $password)) {
        $failures[] = 'include a number';
    }
    if ($settings['pw_require_uppercase'] && !preg_match('/[A-Z]/', $password)) {
        $failures[] = 'include an uppercase letter';
    }

    if (!$failures) {
        return null;
    }

    $last = array_pop($failures);
    $list = $failures ? implode(', ', $failures) . ' and ' . $last : $last;
    return 'Password must ' . $list . '.';
}

/**
 * Short human-readable summary of the active policy, for form hints.
 * e.g. "At least 8 characters, with a number and a special character."
 */
function passwordPolicyDescription(array $settings): string
{
    $extras = [];
    if ($settings['pw_require_uppercase']) $extras[] = 'an uppercase letter';
    if ($settings['pw_require_number'])    $extras[] = 'a number';
    if ($settings['pw_require_special'])   $extras[] = 'a special character';

    $text = 'At least ' . $settings['pw_min_length'] . ' characters';
    if ($extras) {
        $last = array_pop($extras);
        $text .= ', with ' . ($extras ? implode(', ', $extras) . ' and ' . $last : $last);
    }
    return $text . '.';
}

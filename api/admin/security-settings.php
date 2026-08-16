<?php
/**
 * BVetter – Security & Access Control settings (admin only)
 *
 * Actions (POST, bearer token required):
 *   get                       – current 2FA + password policy + inactivity lockout settings
 *   update_2fa                – enable/disable clinic-wide email-OTP 2FA for vet/admin logins
 *   update_policy              – set password policy (min length / special / number / uppercase)
 *   update_inactivity_lockout – enable/disable auto-block of accounts idle past N days, and set N
 *   send_test_code            – email the calling admin a sample login code (delivery test)
 */

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit;
}

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/auth_guard.php';
require_once __DIR__ . '/../config/security_settings.php';
require_once __DIR__ . '/../config/two_factor.php';

$session = requireRole($pdo, ['admin']);

function respond(int $code, array $payload): never
{
    http_response_code($code);
    echo json_encode($payload);
    exit;
}

function settingsPayload(PDO $pdo): array
{
    $settings = getSecuritySettings($pdo);

    ensureLoginOtpSchema($pdo);
    $lastUsed = $pdo->query('
        SELECT UNIX_TIMESTAMP(MAX(consumed_at)) FROM login_otp_codes WHERE consumed_at IS NOT NULL
    ')->fetchColumn();

    return [
        'twoFactorEnabled'  => $settings['two_factor_enabled'],
        'policy' => [
            'minLength'        => $settings['pw_min_length'],
            'requireSpecial'   => $settings['pw_require_special'],
            'requireNumber'    => $settings['pw_require_number'],
            'requireUppercase' => $settings['pw_require_uppercase'],
            'requireLowercase' => $settings['pw_require_lowercase'],
            // Surfaced so the UI can show the locked controls and explain why.
            'floorMinLength'   => PW_FLOOR_MIN_LENGTH,
            'maxLength'        => PW_MAX_LENGTH,
            'classesLocked'    => true,
        ],
        'policyDescription'   => passwordPolicyDescription($settings),
        'twoFactorLastUsedEpoch' => $lastUsed ? (int) $lastUsed : null,
        'inactivityLockout' => [
            'enabled' => $settings['inactivity_lockout_enabled'],
            'days'    => $settings['inactivity_lockout_days'],
        ],
        'sessionIdle' => [
            'minutes'    => $settings['session_idle_minutes'],
            'minMinutes' => SESSION_IDLE_MIN_MINUTES,
            'maxMinutes' => SESSION_IDLE_MAX_MINUTES,
        ],
    ];
}

$action = $_POST['action'] ?? 'get';

try {
    if ($action === 'get') {
        respond(200, ['success' => true, 'data' => settingsPayload($pdo)]);
    }

    if ($action === 'update_2fa') {
        $enabled = ($_POST['enabled'] ?? '') === '1' ? 1 : 0;

        ensureSecuritySettingsSchema($pdo);
        $pdo->prepare('UPDATE security_settings SET two_factor_enabled = :enabled WHERE id = 1')
            ->execute([':enabled' => $enabled]);

        respond(200, [
            'success' => true,
            'message' => $enabled
                ? 'Two-factor authentication is now required for admin logins.'
                : 'Two-factor authentication has been turned off.',
            'data' => settingsPayload($pdo),
        ]);
    }

    if ($action === 'update_policy') {
        $minLength = (int) ($_POST['min_length'] ?? 0);

        // The floor is the point: the policy can be strengthened from here,
        // not weakened. getSecuritySettings() clamps on read as well, so a
        // value written straight into the table can't get underneath it either.
        if ($minLength < PW_FLOOR_MIN_LENGTH || $minLength > PW_MAX_LENGTH) {
            respond(422, [
                'success' => false,
                'message' => 'Minimum length must be between ' . PW_FLOOR_MIN_LENGTH
                    . ' and ' . PW_MAX_LENGTH . ' characters.',
            ]);
        }

        ensureSecuritySettingsSchema($pdo);
        $pdo->prepare('
            UPDATE security_settings
            SET pw_min_length = :min_length,
                pw_require_special = 1,
                pw_require_number = 1,
                pw_require_uppercase = 1
            WHERE id = 1
        ')->execute([':min_length' => $minLength]);

        respond(200, [
            'success' => true,
            'message' => 'Password policy updated. It applies whenever a password is next set.',
            'data' => settingsPayload($pdo),
        ]);
    }

    if ($action === 'update_inactivity_lockout') {
        $enabled = ($_POST['enabled'] ?? '') === '1' ? 1 : 0;
        $days    = (int) ($_POST['days'] ?? 0);

        if ($days < 1 || $days > 3650) {
            respond(422, ['success' => false, 'message' => 'Inactivity duration must be between 1 and 3650 days.']);
        }

        ensureSecuritySettingsSchema($pdo);
        $pdo->prepare('
            UPDATE security_settings
            SET inactivity_lockout_enabled = :enabled,
                inactivity_lockout_days = :days
            WHERE id = 1
        ')->execute([
            ':enabled' => $enabled,
            ':days'    => $days,
        ]);

        respond(200, [
            'success' => true,
            'message' => $enabled
                ? "Accounts inactive for more than {$days} days will now be blocked automatically."
                : 'Inactivity auto-lockout has been turned off. Accounts already blocked by it stay blocked until manually restored.',
            'data' => settingsPayload($pdo),
        ]);
    }

    if ($action === 'update_session_timeout') {
        $minutes = (int) ($_POST['minutes'] ?? 0);

        if ($minutes < SESSION_IDLE_MIN_MINUTES || $minutes > SESSION_IDLE_MAX_MINUTES) {
            respond(422, [
                'success' => false,
                'message' => 'Session timeout must be between ' . SESSION_IDLE_MIN_MINUTES
                    . ' and ' . SESSION_IDLE_MAX_MINUTES . ' minutes.',
            ]);
        }

        ensureSecuritySettingsSchema($pdo);
        $pdo->prepare('UPDATE security_settings SET session_idle_minutes = :minutes WHERE id = 1')
            ->execute([':minutes' => $minutes]);

        respond(200, [
            'success' => true,
            // Applies immediately: every session's remaining time is computed
            // from last_seen_at against the current setting on each poll, so
            // signed-in users pick the new window up on their next check.
            'message' => "Sessions now end after {$minutes} minutes without activity. This takes effect immediately for everyone signed in.",
            'data' => settingsPayload($pdo),
        ]);
    }

    if ($action === 'send_test_code') {
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);

        $userQuery = $pdo->prepare('SELECT email, full_name FROM users WHERE id = :id LIMIT 1');
        $userQuery->execute([':id' => (int) $session['user_id']]);
        $user = $userQuery->fetch();

        if (!$user || !sendLoginOtpEmail($user['email'], $user['full_name'], $code)) {
            respond(500, ['success' => false, 'message' => 'Could not send the test email. Check the mail configuration.']);
        }

        respond(200, [
            'success' => true,
            'message' => 'Test code sent to ' . $user['email'] . '. This is exactly what staff receive at login.',
        ]);
    }

    respond(400, ['success' => false, 'message' => 'Unknown action.']);
} catch (PDOException $e) {
    respond(500, ['success' => false, 'message' => 'Security settings request failed.', 'error' => $e->getMessage()]);
}

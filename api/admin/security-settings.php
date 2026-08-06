<?php
/**
 * BVetter – Security & Access Control settings (admin only)
 *
 * Actions (POST, bearer token required):
 *   get            – current 2FA + password policy settings, and 2FA last-used info
 *   update_2fa     – enable/disable clinic-wide email-OTP 2FA for vet/admin logins
 *   update_policy  – set password policy (min length / special / number / uppercase)
 *   send_test_code – email the calling admin a sample login code (delivery test)
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
        ],
        'policyDescription'   => passwordPolicyDescription($settings),
        'twoFactorLastUsedEpoch' => $lastUsed ? (int) $lastUsed : null,
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
        if ($minLength < 6 || $minLength > 64) {
            respond(422, ['success' => false, 'message' => 'Minimum length must be between 6 and 64 characters.']);
        }

        ensureSecuritySettingsSchema($pdo);
        $pdo->prepare('
            UPDATE security_settings
            SET pw_min_length = :min_length,
                pw_require_special = :special,
                pw_require_number = :number,
                pw_require_uppercase = :uppercase
            WHERE id = 1
        ')->execute([
            ':min_length' => $minLength,
            ':special'    => ($_POST['require_special'] ?? '') === '1' ? 1 : 0,
            ':number'     => ($_POST['require_number'] ?? '') === '1' ? 1 : 0,
            ':uppercase'  => ($_POST['require_uppercase'] ?? '') === '1' ? 1 : 0,
        ]);

        respond(200, [
            'success' => true,
            'message' => 'Password policy updated. It applies whenever a password is next set.',
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

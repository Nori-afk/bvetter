<?php
/**
 * BVetter – Public password policy hint
 * GET /api/auth/password-policy.php
 *
 * Read-only summary of the active password policy so registration, reset,
 * and change-password forms can show the rules before the user submits.
 * Enforcement happens server-side via passwordPolicyError().
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/security_settings.php';

try {
    $settings = getSecuritySettings($pdo);

    echo json_encode([
        'success' => true,
        'data' => [
            'minLength'        => $settings['pw_min_length'],
            'requireSpecial'   => $settings['pw_require_special'],
            'requireNumber'    => $settings['pw_require_number'],
            'requireUppercase' => $settings['pw_require_uppercase'],
            'requireLowercase' => $settings['pw_require_lowercase'],
            'description'      => passwordPolicyDescription($settings),
        ],
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Could not load password policy.']);
}

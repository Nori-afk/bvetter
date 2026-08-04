<?php

header('Content-Type: application/json');

$requestMethod = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';

if ($requestMethod !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'message' => 'Method not allowed',
        'title' => 'Login Failed'
    ]);
    exit;
}

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/email_verification.php';
require_once __DIR__ . '/../config/session.php';
require_once __DIR__ . '/../config/login_security.php';
require_once __DIR__ . '/../config/security_settings.php';
require_once __DIR__ . '/../config/two_factor.php';

ensureEmailVerificationSchema($pdo);
ensureSessionSchema($pdo);
ensureLoginSecuritySchema($pdo);

function respond($statusCode, $payload)
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

$email = isset($_POST['email']) ? trim($_POST['email']) : '';
$password = isset($_POST['password']) ? $_POST['password'] : '';

if ($email === '' || $password === '') {
    respond(422, [
        'success' => false,
        'message' => 'Please enter your email and password.'
    ]);
}

try {
    $sql = '
        SELECT
            users.id,
            users.full_name,
            users.email,
            users.phone_number,
            users.password_hash,
            users.account_status,
            users.failed_login_attempts,
            users.profile_photo,
            users.email_verified_at,
            roles.name AS role_name,
            owner_profiles.verification_status
        FROM users
        INNER JOIN roles ON roles.id = users.role_id
        LEFT JOIN owner_profiles ON owner_profiles.user_id = users.id
        WHERE users.email = :email
        LIMIT 1
    ';

    $stmt = $pdo->prepare($sql);
    $stmt->execute([':email' => $email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        // Same generic response whether the email exists or not, and even on
        // the attempt that triggers the block — the endpoint never reveals
        // which addresses have accounts. The owner learns about the block
        // from the email sent inside recordFailedLoginAttempt().
        if ($user) {
            recordFailedLoginAttempt($pdo, $user);
        }
        respond(401, [
            'success' => false,
            'message' => 'Invalid email or password.'
        ]);
    }

    if ($user['account_status'] === 'blocked') {
        respond(403, [
            'success' => false,
            'message' => 'Your account has been blocked due to multiple failed login attempts. Please contact the Baliwag City Veterinary Office to restore access.'
        ]);
    }

    if ($user['account_status'] !== 'active') {
        respond(403, [
            'success' => false,
            'message' => 'Your account is not active yet. Please wait for admin approval.'
        ]);
    }

    if ($user['role_name'] === 'pet_owner' && $user['verification_status'] !== 'approved') {
        respond(403, [
            'success' => false,
            'message' => 'Your account is still pending residence verification.'
        ]);
    }

    if (in_array($user['role_name'], ['veterinarian', 'admin'], true) && $user['email_verified_at'] === null) {
        respond(403, [
            'success' => false,
            'message' => 'Please verify your email address before logging in. Check your inbox for the verification link.'
        ]);
    }

    // Email-OTP second factor for staff accounts (see api/config/two_factor.php).
    // First pass (no otp_code) emails a code and stops; the client then retries
    // the same credentials with otp_code attached to complete the login.
    $securitySettings = getSecuritySettings($pdo);
    if ($securitySettings['two_factor_enabled'] && in_array($user['role_name'], ['veterinarian', 'admin'], true)) {
        $otpCode = trim($_POST['otp_code'] ?? '');

        if ($otpCode === '') {
            $issue = issueLoginOtp($pdo, (int) $user['id'], $user['email'], $user['full_name']);

            if ($issue === 'failed') {
                respond(500, [
                    'success' => false,
                    'message' => 'We could not send your verification code. Please try again or contact the clinic.'
                ]);
            }

            respond(200, [
                'success' => true,
                'requires_2fa' => true,
                'message' => $issue === 'throttled'
                    ? 'A code was already sent to your email. Please wait a minute before requesting another.'
                    : 'We emailed a 6-digit verification code to ' . $user['email'] . '. It expires in 10 minutes.'
            ]);
        }

        $verdict = verifyLoginOtp($pdo, (int) $user['id'], $otpCode);

        if ($verdict !== 'ok') {
            $messages = [
                'invalid' => 'Incorrect code. Please check your email and try again.',
                'locked'  => 'Too many incorrect attempts. Please request a new code.',
                'expired' => 'That code has expired. Please request a new one.',
            ];
            respond(401, [
                'success' => false,
                'otp_error' => $verdict,
                'message' => $messages[$verdict]
            ]);
        }
    }

    $token = bin2hex(random_bytes(32));

    $updateLogin = $pdo->prepare('UPDATE users SET last_login_at = NOW(), failed_login_attempts = 0 WHERE id = :id');
    $updateLogin->execute([':id' => $user['id']]);

    recordLoginSession($pdo, (int) $user['id'], $token);

    $frontendRole = $user['role_name'];
    if ($frontendRole === 'pet_owner') {
        $frontendRole = 'owner';
    } elseif ($frontendRole === 'veterinarian') {
        $frontendRole = 'vet';
    }

    respond(200, [
        'success' => true,
        'message' => 'Login successful',
        'data' => [
            'id' => (int) $user['id'],
            'userId' => (int) $user['id'],
            'name' => $user['full_name'],
            'email' => $user['email'],
            'phone' => $user['phone_number'],
            'role' => $frontendRole,
            'db_role' => $user['role_name'],
            'pfp'=>$user['profile_photo'],
            'token' => $token
        ]
    ]);
} catch (PDOException $e) {
    respond(500, [
        'success' => false,
        'message' => 'Database query failed',
        'error' => $e->getMessage()
    ]);
}

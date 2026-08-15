<?php
/**
 * BVetter – Shared login flow
 *
 * Used by both api/auth/login.php (public: owner + vet) and
 * api/auth/admin-login.php (hidden: admin only). Each endpoint passes its
 * own $allowedRoles; anyone whose resolved role isn't in that list gets the
 * exact same generic "Invalid email or password" as a wrong password would,
 * so neither endpoint ever leaks that an email belongs to an account, let
 * alone which role it holds.
 *
 * A correct password on the wrong door does NOT count toward the 3-strike
 * lockout in login_security.php — that counter is for wrong passwords, and
 * an admin mistyping the old public URL out of habit shouldn't get their
 * account blocked over it. Wrong passwords are still counted regardless of
 * which endpoint they're tried against, so brute-forcing an admin's actual
 * password still locks the account after 3 attempts either way.
 */

require_once __DIR__ . '/email_verification.php';
require_once __DIR__ . '/session.php';
require_once __DIR__ . '/login_security.php';
require_once __DIR__ . '/security_settings.php';
require_once __DIR__ . '/two_factor.php';

/**
 * @param string[] $allowedRoles role_name values permitted through this door
 * @return array{0:int,1:array} [http status code, JSON payload]
 */
function attemptLogin(PDO $pdo, string $email, string $password, string $otpCode, array $allowedRoles): array
{
    ensureEmailVerificationSchema($pdo);
    ensureSessionSchema($pdo);
    ensureLoginSecuritySchema($pdo);
    ensureUserTwoFactorColumn($pdo);

    if ($email === '' || $password === '') {
        return [422, [
            'success' => false,
            'message' => 'Please enter your email and password.'
        ]];
    }

    $sql = '
        SELECT
            users.id,
            users.full_name,
            users.email,
            users.phone_number,
            users.password_hash,
            users.account_status,
            users.blocked_reason,
            users.last_login_at,
            users.failed_login_attempts,
            users.profile_photo,
            users.email_verified_at,
            users.two_factor_enabled,
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
        return [401, [
            'success' => false,
            'message' => 'Invalid email or password.'
        ]];
    }

    if (!in_array($user['role_name'], $allowedRoles, true)) {
        // Right password, wrong door — reject without touching the lockout
        // counter (see file header) and without hinting the account exists.
        return [401, [
            'success' => false,
            'message' => 'Invalid email or password.'
        ]];
    }

    // Backstop for the inactivity lockout: even if no admin has opened Account
    // Management (which runs sweepInactiveAccounts()) since this account went
    // stale, the account itself still gets blocked and rejected right here,
    // the moment it tries to log in.
    if ($user['account_status'] === 'active' && maybeBlockForInactivity($pdo, $user)) {
        $user['account_status'] = 'blocked';
        $user['blocked_reason'] = 'inactivity';
    }

    if ($user['account_status'] === 'blocked') {
        if ($user['blocked_reason'] === 'inactivity') {
            $days = getSecuritySettings($pdo)['inactivity_lockout_days'];
            return [403, [
                'success' => false,
                'message' => "Your account was blocked after {$days} days of inactivity. Please contact the Baliwag City Veterinary Office to restore access."
            ]];
        }
        return [403, [
            'success' => false,
            'message' => 'Your account has been blocked due to multiple failed login attempts. Please contact the Baliwag City Veterinary Office to restore access.'
        ]];
    }

    if ($user['account_status'] !== 'active') {
        return [403, [
            'success' => false,
            'message' => 'Your account is not active yet. Please wait for admin approval.'
        ]];
    }

    if ($user['role_name'] === 'pet_owner' && $user['verification_status'] !== 'approved') {
        return [403, [
            'success' => false,
            'message' => 'Your account is still pending residence verification.'
        ]];
    }

    // Email verification gates admin accounts only — veterinarian accounts
    // (incl. assistant vets) skip it and log in on password alone.
    if ($user['role_name'] === 'admin' && $user['email_verified_at'] === null) {
        return [403, [
            'success' => false,
            'message' => 'Please verify your email address before logging in. Check your inbox for the verification link.'
        ]];
    }

    // 2FA applies when either: the site-wide admin switch is on and this is an
    // admin login, OR this specific account opted into its own email-OTP 2FA
    // from its profile settings (any role, most commonly pet owners).
    // First pass (no otp_code) emails a code and stops; the client then retries
    // the same credentials with otp_code attached to complete the login.
    $securitySettings = getSecuritySettings($pdo);
    $requiresTwoFactor = ($securitySettings['two_factor_enabled'] && $user['role_name'] === 'admin')
        || (bool) $user['two_factor_enabled'];
    if ($requiresTwoFactor) {
        if ($otpCode === '') {
            $issue = issueLoginOtp($pdo, (int) $user['id'], $user['email'], $user['full_name']);

            if ($issue === 'failed') {
                return [500, [
                    'success' => false,
                    'message' => 'We could not send your verification code. Please try again or contact the clinic.'
                ]];
            }

            return [200, [
                'success' => true,
                'requires_2fa' => true,
                'message' => $issue === 'throttled'
                    ? 'A code was already sent to your email. Please wait a minute before requesting another.'
                    : 'We emailed a 6-digit verification code to ' . $user['email'] . '. It expires in 10 minutes.'
            ]];
        }

        $verdict = verifyLoginOtp($pdo, (int) $user['id'], $otpCode);

        if ($verdict !== 'ok') {
            $messages = [
                'invalid' => 'Incorrect code. Please check your email and try again.',
                'locked'  => 'Too many incorrect attempts. Please request a new code.',
                'expired' => 'That code has expired. Please request a new one.',
            ];
            return [401, [
                'success' => false,
                'otp_error' => $verdict,
                'message' => $messages[$verdict]
            ]];
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

    return [200, [
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
            'pfp' => $user['profile_photo'],
            'token' => $token
        ]
    ]];
}

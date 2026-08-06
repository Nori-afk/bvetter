<?php
/**
 * BVetter – Email-OTP two-factor authentication for admin logins
 *
 * Veterinarian accounts are exempt — only admin logins go through this.
 * When security_settings.two_factor_enabled is on, api/auth/login.php calls:
 *   - issueLoginOtp()  after the password checks out → emails a 6-digit code
 *   - verifyLoginOtp() when the client retries login with the code attached
 *
 * Codes live in login_otp_codes: one active code per user, 10-minute expiry,
 * max 5 wrong attempts before the code is burned, 60-second resend throttle.
 */

require_once __DIR__ . '/mailer.php';

const LOGIN_OTP_TTL_SECONDS      = 600; // 10 minutes
const LOGIN_OTP_MAX_ATTEMPTS     = 5;
const LOGIN_OTP_RESEND_THROTTLE  = 60;  // seconds

function ensureLoginOtpSchema(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS login_otp_codes (
            id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id     INT UNSIGNED NOT NULL,
            otp_code    CHAR(6)      NOT NULL,
            attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
            expires_at  DATETIME     NOT NULL,
            consumed_at DATETIME     NULL,
            created_at  DATETIME     NOT NULL DEFAULT NOW(),
            INDEX idx_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

/**
 * Issues (or re-uses) a login code for the user and emails it.
 * Returns one of:
 *   'sent'      – a fresh code was emailed
 *   'throttled' – an unexpired code was issued <60s ago; nothing sent
 *   'failed'    – the email could not be sent
 */
function issueLoginOtp(PDO $pdo, int $userId, string $email, string $fullName): string
{
    ensureLoginOtpSchema($pdo);

    $existing = $pdo->prepare('
        SELECT created_at FROM login_otp_codes
        WHERE user_id = :user_id AND consumed_at IS NULL AND expires_at > NOW()
        ORDER BY id DESC LIMIT 1
    ');
    $existing->execute([':user_id' => $userId]);
    $row = $existing->fetch();

    if ($row && (time() - strtotime($row['created_at'])) < LOGIN_OTP_RESEND_THROTTLE) {
        return 'throttled';
    }

    $pdo->prepare('DELETE FROM login_otp_codes WHERE user_id = :user_id AND consumed_at IS NULL')
        ->execute([':user_id' => $userId]);

    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);

    $pdo->prepare('
        INSERT INTO login_otp_codes (user_id, otp_code, expires_at)
        VALUES (:user_id, :code, DATE_ADD(NOW(), INTERVAL ' . LOGIN_OTP_TTL_SECONDS . ' SECOND))
    ')->execute([':user_id' => $userId, ':code' => $code]);

    return sendLoginOtpEmail($email, $fullName, $code) ? 'sent' : 'failed';
}

/**
 * Checks the code the user typed. Returns one of:
 *   'ok'      – correct; the code is consumed and login may proceed
 *   'invalid' – wrong code (attempt counted)
 *   'locked'  – too many wrong attempts; code burned, request a new one
 *   'expired' – no active code (expired or never issued); request a new one
 */
function verifyLoginOtp(PDO $pdo, int $userId, string $code): string
{
    ensureLoginOtpSchema($pdo);

    $stmt = $pdo->prepare('
        SELECT id, otp_code, attempts, expires_at
        FROM login_otp_codes
        WHERE user_id = :user_id AND consumed_at IS NULL
        ORDER BY id DESC LIMIT 1
    ');
    $stmt->execute([':user_id' => $userId]);
    $row = $stmt->fetch();

    if (!$row || strtotime($row['expires_at']) < time()) {
        return 'expired';
    }

    if ($row['attempts'] >= LOGIN_OTP_MAX_ATTEMPTS) {
        return 'locked';
    }

    if (!hash_equals($row['otp_code'], $code)) {
        $pdo->prepare('UPDATE login_otp_codes SET attempts = attempts + 1 WHERE id = :id')
            ->execute([':id' => $row['id']]);
        return ((int) $row['attempts'] + 1) >= LOGIN_OTP_MAX_ATTEMPTS ? 'locked' : 'invalid';
    }

    $pdo->prepare('UPDATE login_otp_codes SET consumed_at = NOW() WHERE id = :id')
        ->execute([':id' => $row['id']]);
    return 'ok';
}

function sendLoginOtpEmail(string $email, string $fullName, string $code): bool
{
    $name = htmlspecialchars($fullName, ENT_QUOTES);

    $body = notificationEmailWrapper(
        'Login Verification Code',
        "<p>Hi <strong>{$name}</strong>,</p>
         <p>Use the code below to finish signing in to BVetter.
            It expires in <strong>10 minutes</strong>.</p>"
        . emailCodeBox($code)
        . "<p style='color:#999;font-size:12px;'>If you didn't try to sign in, someone may
            have your password &mdash; we recommend changing it right away.</p>"
    );

    return sendAppMail($email, $fullName, 'BVetter – Your Login Code', $body);
}

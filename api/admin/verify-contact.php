<?php
/**
 * BVetter – Contact Verification & Forgot Password
 *
 * Actions:
 *   send_email_otp     – generate & email a 6-digit OTP
 *   send_phone_otp     – generate & "SMS" a 6-digit OTP (stub – swap for real SMS gateway)
 *   verify_otp         – confirm the code the user entered
 *   forgot_password    – send a password-reset link by email
 *   reset_password     – consume the token and update the password
 */

header('Content-Type: application/json');
define('APP_URL', getenv('APP_BASE_URL') ?: 'http://68.183.182.176');
header('Content-Type: application/json');
ini_set('display_errors', 0);  // ADD THIS
error_reporting(E_ALL);   

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit;
}

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/mailer.php';
require_once __DIR__ . '/../config/security_settings.php';

/* ── helpers ────────────────────────────────────────────── */

function respond(int $code, array $payload): never
{
    http_response_code($code);
    echo json_encode($payload);
    exit;
}

function generateOtp(): string
{
    return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
}

function ensureOtpTable(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS contact_verifications (
            id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id       INT UNSIGNED NULL,           -- NULL for pre-registration OTP
            contact_type  ENUM('email','phone') NOT NULL,
            contact_value VARCHAR(255) NOT NULL,
            otp_code      CHAR(6)      NOT NULL,
            expires_at    DATETIME     NOT NULL,
            verified_at   DATETIME     NULL,
            created_at    DATETIME     NOT NULL DEFAULT NOW(),
            INDEX idx_contact (contact_type, contact_value)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function ensureResetTable(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id    INT UNSIGNED NOT NULL,
            token      CHAR(64)     NOT NULL UNIQUE,
            expires_at DATETIME     NOT NULL,
            used_at    DATETIME     NULL,
            created_at DATETIME     NOT NULL DEFAULT NOW(),
            INDEX idx_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

/* ── send OTP via email ─────────────────────────────────── */
function sendEmailOtp(PDO $pdo): never
{
    ensureOtpTable($pdo);

    $email  = trim($_POST['email'] ?? '');
    $userId = isset($_POST['user_id']) ? (int) $_POST['user_id'] : null;

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(422, ['success' => false, 'message' => 'Invalid email address.']);
    }

    $otp       = generateOtp();
    $expiresAt = date('Y-m-d H:i:s', time() + 600);

    $pdo->prepare("
        DELETE FROM contact_verifications
        WHERE contact_type = 'email' AND contact_value = :email AND verified_at IS NULL
    ")->execute([':email' => $email]);

    $pdo->prepare("
        INSERT INTO contact_verifications (user_id, contact_type, contact_value, otp_code, expires_at)
        VALUES (:user_id, 'email', :email, :otp, :expires_at)
    ")->execute([
        ':user_id'    => $userId,
        ':email'      => $email,
        ':otp'        => $otp,
        ':expires_at' => $expiresAt,
    ]);

    $body = notificationEmailWrapper(
        'Email Verification',
        "<p>Use the code below to verify your email address.
            It expires in <strong>10 minutes</strong>.</p>"
        . emailCodeBox($otp)
        . "<p style='color:#999;font-size:12px;'>If you did not request this, please ignore this email.</p>"
    );

    if (!sendAppMail($email, $email, 'BVetter – Your Email Verification Code', $body)) {
        respond(500, ['success' => false, 'message' => 'Failed to send verification email. Please try again.']);
    }

    respond(200, [
        'success' => true,
        'message' => 'Verification code sent to ' . $email,
    ]);
}

/* ── send OTP via SMS (stub) ────────────────────────────── */
function sendPhoneOtp(PDO $pdo): never
{
    ensureOtpTable($pdo);

    $phone  = trim($_POST['phone'] ?? '');
    $userId = isset($_POST['user_id']) ? (int) $_POST['user_id'] : null;

    if ($phone === '') {
        respond(422, ['success' => false, 'message' => 'Phone number is required.']);
    }

    // Normalise → +63XXXXXXXXXX
    $normalised = preg_replace('/\D/', '', $phone);
    if (str_starts_with($normalised, '0')) {
        $normalised = '+63' . substr($normalised, 1);
    } elseif (str_starts_with($normalised, '63')) {
        $normalised = '+' . $normalised;
    } else {
        $normalised = '+' . $normalised;
    }

    $otp       = generateOtp();
    $expiresAt = date('Y-m-d H:i:s', time() + 600);

    $pdo->prepare("
        DELETE FROM contact_verifications
        WHERE contact_type = 'phone' AND contact_value = :phone AND verified_at IS NULL
    ")->execute([':phone' => $normalised]);

    $pdo->prepare("
        INSERT INTO contact_verifications (user_id, contact_type, contact_value, otp_code, expires_at)
        VALUES (:user_id, 'phone', :phone, :otp, :expires_at)
    ")->execute([
        ':user_id'    => $userId,
        ':phone'      => $normalised,
        ':otp'        => $otp,
        ':expires_at' => $expiresAt,
    ]);

    // ── Semaphore SMS ────────────────────────────────────────
    $apiKey     = getenv('SEMAPHORE_API_KEY') ?: '';
    $senderName = getenv('SEMAPHORE_SENDER_NAME') ?: 'BVetter';

    $payload = http_build_query([
        'apikey'      => $apiKey,
        'number'      => $normalised,
        'message'     => "Your BVetter verification code is: {$otp}. Valid for 10 minutes. Do not share this with anyone.",
        'sendername'  => $senderName,
    ]);

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => 'https://api.semaphore.co/api/v4/messages',
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
    ]);

    $response = curl_exec($ch);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if ($curlErr) {
        error_log("[BVetter SMS] cURL error: {$curlErr}");
        respond(500, ['success' => false, 'message' => 'Failed to send SMS. Please try again.']);
    }

    $result = json_decode($response, true);

    // Semaphore returns an array of message objects on success
    if (empty($result) || isset($result['status']) && $result['status'] === 'error') {
        error_log("[BVetter SMS] Semaphore error: {$response}");
        respond(500, ['success' => false, 'message' => 'Failed to send SMS. Please try again.']);
    }

    error_log("[BVetter SMS] Sent to {$normalised}");

    respond(200, [
        'success' => true,
        'message' => 'Verification code sent to ' . $phone,
    ]);
}

/* ── verify OTP ─────────────────────────────────────────── */

function verifyOtp(PDO $pdo): never
{
    ensureOtpTable($pdo);

    $type  = $_POST['type']  ?? '';   // 'email' or 'phone'
    $value = trim($_POST['value'] ?? '');
    $code  = trim($_POST['code']  ?? '');

    if (!in_array($type, ['email', 'phone'], true) || $value === '' || $code === '') {
        respond(422, ['success' => false, 'message' => 'Missing verification parameters.']);
    }

    // Normalise phone for lookup
    if ($type === 'phone') {
        $value = preg_replace('/\D/', '', $value);
        if (str_starts_with($value, '0')) {
            $value = '+63' . substr($value, 1);
        } elseif (!str_starts_with($value, '+')) {
            $value = '+' . $value;
        }
    }

    $stmt = $pdo->prepare("
        SELECT id, otp_code, expires_at, verified_at
        FROM contact_verifications
        WHERE contact_type = :type
          AND contact_value = :value
          AND verified_at IS NULL
        ORDER BY id DESC
        LIMIT 1
    ");
    $stmt->execute([':type' => $type, ':value' => $value]);
    $row = $stmt->fetch();

    if (!$row) {
        respond(422, ['success' => false, 'message' => 'No pending verification found. Please request a new code.']);
    }

    if (new DateTime() > new DateTime($row['expires_at'])) {
        respond(422, ['success' => false, 'message' => 'Verification code has expired. Please request a new one.']);
    }

    if (!hash_equals($row['otp_code'], $code)) {
        respond(422, ['success' => false, 'message' => 'Incorrect code. Please try again.']);
    }

    // Mark as verified
    $pdo->prepare("
        UPDATE contact_verifications SET verified_at = NOW() WHERE id = :id
    ")->execute([':id' => $row['id']]);

    respond(200, ['success' => true, 'message' => ucfirst($type) . ' verified successfully.']);
}

/* ── forgot password ────────────────────────────────────── */

function forgotPassword(PDO $pdo): never
{
    ensureResetTable($pdo);

    $email = trim($_POST['email'] ?? '');

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(422, ['success' => false, 'message' => 'Invalid email address.']);
    }

    $stmt = $pdo->prepare('SELECT id, full_name FROM users WHERE email = :email LIMIT 1');
    $stmt->execute([':email' => $email]);
    $user = $stmt->fetch();

    // Explicitly reject unknown emails. Email-enumeration secrecy is moot here:
    // the public registration form already reveals which emails are registered.
    if (!$user) {
        respond(404, [
            'success' => false,
            'message' => 'No account found with that email address.',
        ]);
    }

    // Invalidate old tokens
    $pdo->prepare('
        DELETE FROM password_reset_tokens WHERE user_id = :user_id
    ')->execute([':user_id' => $user['id']]);

    $token     = bin2hex(random_bytes(32)); // 64 hex chars
    $expiresAt = date('Y-m-d H:i:s', time() + 3600); // 1 hour

    $pdo->prepare('
        INSERT INTO password_reset_tokens (user_id, token, expires_at)
        VALUES (:user_id, :token, :expires_at)
    ')->execute([
        ':user_id'    => $user['id'],
        ':token'      => $token,
        ':expires_at' => $expiresAt,
    ]);

    // Build reset URL – adjust base URL to match your deployment
$resetUrl = APP_URL . '/public/pages/reset-password.html?token='
          . urlencode($token);
    $subject = 'BVetter – Password Reset Request';
    $name    = htmlspecialchars($user['full_name'], ENT_QUOTES);
    $body    = notificationEmailWrapper(
        'Password Reset',
        "<p>Hi <strong>{$name}</strong>,</p>
         <p>We received a request to reset your BVetter password.
            Click the button below &mdash; the link expires in <strong>1 hour</strong>.</p>
         <p style='color:#999;font-size:12px;'>If you did not request a password reset,
            you can safely ignore this email.</p>",
        null,
        ['label' => 'Reset My Password', 'url' => $resetUrl]
    );

    $mailSent = sendAppMail($email, $user['full_name'], $subject, $body);

    if ($mailSent) {
        error_log("[BVetter Reset] email sent to {$email}");
    } else {
        error_log("[BVetter Reset] Mailer error: sendAppMail() returned false");
    }

    $response = [
        'success' => true,
        'message' => 'A password reset link has been sent to your email.',
    ];

    // Hand the reset link back in the response so the flow stays testable
    // without real email — but ONLY to a caller on this machine.
    //
    // This used to key off "SMTP looks unconfigured" (send failed + empty
    // SMTP_USER), which is exactly the state a broken production deploy is in.
    // There, any stranger who typed an email address into the form would have
    // been handed a working reset link for that account, administrators
    // included. The condition has to be about WHO is asking, not about how
    // healthy the mailer happens to be.
    $isLocalCaller = in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
    if (!$mailSent && $isLocalCaller) {
        $response['dev_link'] = $resetUrl;
    }

    respond(200, $response);
}

/* ── reset password ─────────────────────────────────────── */

function resetPassword(PDO $pdo): never
{
    ensureResetTable($pdo);

    $token    = trim($_POST['token']    ?? '');
    $password = $_POST['password']      ?? '';
    $confirm  = $_POST['confirm']       ?? '';

    if ($token === '' || $password === '') {
        respond(422, ['success' => false, 'message' => 'Token and new password are required.']);
    }

    if ($password !== $confirm) {
        respond(422, ['success' => false, 'message' => 'Passwords do not match.']);
    }

    $stmt = $pdo->prepare('
        SELECT id, user_id, expires_at, used_at
        FROM password_reset_tokens
        WHERE token = :token
        LIMIT 1
    ');
    $stmt->execute([':token' => $token]);
    $row = $stmt->fetch();

    if (!$row) {
        respond(422, ['success' => false, 'message' => 'Invalid or expired reset link.']);
    }

    if ($row['used_at'] !== null) {
        respond(422, ['success' => false, 'message' => 'This reset link has already been used.']);
    }

    if (new DateTime() > new DateTime($row['expires_at'])) {
        respond(422, ['success' => false, 'message' => 'Reset link has expired. Please request a new one.']);
    }

    // Checked after the token resolves, so the account's own name and email
    // are known and can be rejected as password material.
    $owner = $pdo->prepare('SELECT full_name, email FROM users WHERE id = :id LIMIT 1');
    $owner->execute([':id' => $row['user_id']]);
    $ownerRow = $owner->fetch() ?: [];

    $policyError = passwordPolicyError($pdo, $password, [
        'name'  => $ownerRow['full_name'] ?? '',
        'email' => $ownerRow['email'] ?? '',
    ]);
    if ($policyError !== null) {
        respond(422, ['success' => false, 'message' => $policyError]);
    }

    $pdo->beginTransaction();

    // password_changed_at backs the profile Security card's "Last changed"
    // line. A reset is a password change, so it has to stamp the column too --
    // otherwise resetting via Forgot Password leaves the card under-reporting.
    // Probed rather than assumed: this endpoint never runs setupProfileTables(),
    // so on an install where the PHP is newer than
    // database/migrations/2026-08-22-admin-profile-columns.sql the column may
    // not exist yet, and an unknown column here would break password reset.
    $stampsChangedAt = (bool) $pdo->query("SHOW COLUMNS FROM users LIKE 'password_changed_at'")->fetch();

    $pdo->prepare('UPDATE users SET password_hash = :hash'
            . ($stampsChangedAt ? ', password_changed_at = NOW()' : '')
            . ' WHERE id = :id')
        ->execute([
            ':hash' => password_hash($password, PASSWORD_DEFAULT),
            ':id'   => $row['user_id'],
        ]);

    $pdo->prepare('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = :id')
        ->execute([':id' => $row['id']]);

    // Lift a failed-login block. Three wrong passwords blocks the account
    // (MAX_FAILED_LOGIN_ATTEMPTS in login_security.php), and being locked out
    // is the single most common reason to use this form -- so without this the
    // user resets successfully, is told "You can now log in", and is then
    // refused at login by a message telling them to phone the office.
    //
    // Scoped to blocked_reason = 'failed_login' on purpose. An 'inactivity'
    // block is a deliberate administrative decision about a dormant account,
    // and control of the mailbox must not silently reverse it.
    $pdo->prepare("
        UPDATE users
        SET account_status = 'active', blocked_reason = NULL, failed_login_attempts = 0
        WHERE id = :id AND account_status = 'blocked' AND blocked_reason = 'failed_login'
    ")->execute([':id' => $row['user_id']]);

    // Revoke every live session for this account. Resetting a password is what
    // someone does when they believe another person has it, so leaving that
    // person's user_sessions row valid defeats the point -- and the idle
    // timeout does not save you, since they renew it just by clicking.
    // The owner's own devices are signed out too; they are about to log in
    // with the new password anyway, and that is the honest trade.
    $pdo->prepare('
        UPDATE user_sessions SET revoked_at = NOW()
        WHERE user_id = :id AND revoked_at IS NULL
    ')->execute([':id' => $row['user_id']]);

    $pdo->commit();

    respond(200, ['success' => true, 'message' => 'Password updated successfully. You can now log in.']);
}

/* ── router ─────────────────────────────────────────────── */

$action = $_POST['action'] ?? '';

try {
    match ($action) {
        'send_email_otp' => sendEmailOtp($pdo),
        'send_phone_otp' => sendPhoneOtp($pdo),
        'verify_otp'     => verifyOtp($pdo),
        'forgot_password' => forgotPassword($pdo),
        'reset_password'  => resetPassword($pdo),
        default           => respond(400, ['success' => false, 'message' => 'Unknown action.']),
    };
} catch (PDOException $e) {
    error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    respond(500, [
        'success' => false,
        'message' => 'Server error. Please try again.',
    ]);
}

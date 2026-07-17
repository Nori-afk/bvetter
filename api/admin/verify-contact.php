<?php
/**
 * VBetter – Contact Verification & Forgot Password
 *
 * Actions:
 *   send_email_otp     – generate & email a 6-digit OTP
 *   send_phone_otp     – generate & "SMS" a 6-digit OTP (stub – swap for real SMS gateway)
 *   verify_otp         – confirm the code the user entered
 *   forgot_password    – send a password-reset link by email
 *   reset_password     – consume the token and update the password
 */

header('Content-Type: application/json');
define('APP_URL', getenv('APP_BASE_URL') ?: 'http://localhost/final-VBETTER/bvetter');
header('Content-Type: application/json');
ini_set('display_errors', 0);  // ADD THIS
error_reporting(E_ALL);   

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit;
}

require_once __DIR__ . '/../config/connection.php';

// PHPMailer
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\SMTP;
use PHPMailer\PHPMailer\Exception as MailException;
require_once __DIR__ . '/../phpMailer/PHPMailer-master/src/Exception.php';
require_once __DIR__ . '/../phpMailer/PHPMailer-master/src/PHPMailer.php';
require_once __DIR__ . '/../phpMailer/PHPMailer-master/src/SMTP.php';

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

    // Use PHPMailer instead of mail()
    try {
        $mail = new PHPMailer(true);
        $mail->CharSet    = PHPMailer::CHARSET_UTF8;
        $mail->isSMTP();
        $mail->Host       = getenv('SMTP_HOST') ?: 'smtp.gmail.com';
        $mail->SMTPAuth   = true;
        $mail->Username   = getenv('SMTP_USER') ?: '';
        $mail->Password   = getenv('SMTP_PASS') ?: '';
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port       = (int) (getenv('SMTP_PORT') ?: 587);

        $mail->setFrom(getenv('SMTP_FROM') ?: $mail->Username, 'VBetter');
        $mail->addAddress($email);
        $mail->isHTML(true);
        $mail->Subject = 'VBetter – Your Email Verification Code';

        $logoPath = __DIR__ . '/../../public/images/logos/logo-color.png';
        if (is_file($logoPath)) {
            $mail->addEmbeddedImage($logoPath, 'logo', 'logo.png');
        }

        $mail->Body    = "
            <div style='font-family:sans-serif;max-width:480px;margin:auto;padding:32px;
                        border:1px solid #eee;border-radius:12px;text-align:center;'>
                <img src='cid:logo' alt='Baliwag City Vet' style='height:56px;margin-bottom:20px;'>
                <h2 style='color:#00B928;margin-bottom:8px;'>Email Verification</h2>
                <p style='color:#555;'>Use the code below to verify your email address.
                   It expires in <strong>10 minutes</strong>.</p>
                <div style='font-size:36px;font-weight:800;letter-spacing:10px;text-align:center;
                            background:#f4f4f4;padding:20px;border-radius:8px;margin:24px 0;'>
                    {$otp}
                </div>
                <p style='color:#999;font-size:12px;'>
                    If you did not request this, please ignore this email.
                </p>
            </div>
        ";

        $mail->send();

    } catch (MailException $e) {
        error_log("[VBetter OTP] Mailer error: " . $e->getMessage());
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
    $senderName = getenv('SEMAPHORE_SENDER_NAME') ?: 'VBETTER';

    $payload = http_build_query([
        'apikey'      => $apiKey,
        'number'      => $normalised,
        'message'     => "Your VBetter verification code is: {$otp}. Valid for 10 minutes. Do not share this with anyone.",
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
        error_log("[VBetter SMS] cURL error: {$curlErr}");
        respond(500, ['success' => false, 'message' => 'Failed to send SMS. Please try again.']);
    }

    $result = json_decode($response, true);

    // Semaphore returns an array of message objects on success
    if (empty($result) || isset($result['status']) && $result['status'] === 'error') {
        error_log("[VBetter SMS] Semaphore error: {$response}");
        respond(500, ['success' => false, 'message' => 'Failed to send SMS. Please try again.']);
    }

    error_log("[VBetter SMS] Sent to {$normalised}");

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

    // Always respond success so we don't leak registered emails
    if (!$user) {
        respond(200, [
            'success' => true,
            'message' => 'If that email is registered, a reset link has been sent.',
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
    $subject = 'VBetter – Password Reset Request';
    $name    = htmlspecialchars($user['full_name'], ENT_QUOTES);
    $body    = "
        <div style='font-family:sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #eee;border-radius:12px;text-align:center;'>
            <img src='cid:logo' alt='Baliwag City Vet' style='height:56px;margin-bottom:20px;'>
            <h2 style='color:#00B928;margin-bottom:8px;'>Password Reset</h2>
            <p>Hi <strong>{$name}</strong>,</p>
            <p style='color:#555;'>We received a request to reset your VBetter password.
               Click the button below — the link expires in <strong>1 hour</strong>.</p>
            <div style='text-align:center;margin:32px 0;'>
                <a href='{$resetUrl}'
                   style='background:#00B928;color:#fff;padding:14px 32px;border-radius:8px;
                          text-decoration:none;font-weight:700;font-size:15px;'>
                    Reset My Password
                </a>
            </div>
            <p style='color:#999;font-size:12px;'>
                If you did not request a password reset, you can safely ignore this email.
            </p>
        </div>
    ";

    $mailSent = false;

    try {
        $mail = new PHPMailer(true);
        $mail->CharSet    = PHPMailer::CHARSET_UTF8;
        $mail->isSMTP();
        $mail->Host       = getenv('SMTP_HOST') ?: 'smtp.gmail.com';
        $mail->SMTPAuth   = true;
        $mail->Username   = getenv('SMTP_USER') ?: '';
        $mail->Password   = getenv('SMTP_PASS') ?: '';
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port       = (int) (getenv('SMTP_PORT') ?: 587);

        $mail->setFrom(getenv('SMTP_FROM') ?: $mail->Username, 'VBetter');
        $mail->addAddress($email, $user['full_name']);
        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body    = $body;

        $logoPath = __DIR__ . '/../../public/images/logos/logo-color.png';
        if (is_file($logoPath)) {
            $mail->addEmbeddedImage($logoPath, 'logo', 'logo.png');
        }

        $mail->send();
        $mailSent = true;

        error_log("[VBetter Reset] email sent to {$email}");
    } catch (MailException $e) {
        error_log("[VBetter Reset] Mailer error: " . $e->getMessage());
    }

    $response = [
        'success' => true,
        'message' => 'If that email is registered, a reset link has been sent.',
    ];

    // No SMTP credentials configured locally (no .env / empty SMTP_USER) — hand
    // back the reset link directly so the flow is still testable without real email.
    $smtpUser = getenv('SMTP_USER');
    if (!$mailSent && ($smtpUser === false || $smtpUser === '')) {
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

    if (strlen($password) < 8) {
        respond(422, ['success' => false, 'message' => 'Password must be at least 8 characters.']);
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

    $pdo->beginTransaction();

    $pdo->prepare('UPDATE users SET password_hash = :hash WHERE id = :id')
        ->execute([
            ':hash' => password_hash($password, PASSWORD_DEFAULT),
            ':id'   => $row['user_id'],
        ]);

    $pdo->prepare('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = :id')
        ->execute([':id' => $row['id']]);

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
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    respond(500, [
        'success' => false,
        'message' => 'Server error. Please try again.',
        'error'   => $e->getMessage(),
    ]);
}
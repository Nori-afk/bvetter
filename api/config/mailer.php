<?php

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as MailException;

require_once __DIR__ . '/../phpMailer/PHPMailer-master/src/Exception.php';
require_once __DIR__ . '/../phpMailer/PHPMailer-master/src/PHPMailer.php';
require_once __DIR__ . '/../phpMailer/PHPMailer-master/src/SMTP.php';

if (!defined('APP_URL')) {
    define('APP_URL', getenv('APP_BASE_URL') ?: 'http://localhost');
}

define('EMAIL_LOGO_URL', rtrim(APP_URL, '/') . '/public/images/logos/logo-color.png');

/**
 * Turns a site-relative path (e.g. a pet photo's "/storage/..."
 * value straight from the DB) into an absolute URL for use in an email.
 */
function emailAssetUrl(string $sitePath): string
{
    $parts = parse_url(APP_URL);
    $origin = ($parts['scheme'] ?? 'http') . '://' . ($parts['host'] ?? 'localhost')
        . (isset($parts['port']) ? ':' . $parts['port'] : '');
    return $origin . $sitePath;
}

/**
 * Best-effort email send: never throws, logs and returns false on failure
 * so callers can fire-and-forget without risking their own API response.
 *
 * Images are always linked (hosted URLs), never embedded/attached — an
 * attached image makes an otherwise legitimate notification look like a
 * phishing email in most inboxes. See notificationEmailWrapper()'s
 * $photoUrl param for showing a photo inline via <img src>.
 *
 * Sends over Brevo's HTTPS API (port 443) when BREVO_API_KEY is set —
 * many cloud hosts (DigitalOcean, etc.) block outbound SMTP ports 25/465/587
 * by default, which silently breaks the PHPMailer/SMTP path in production
 * even though it works fine on a local dev machine. Falls back to SMTP
 * when no Brevo key is configured, so local XAMPP setups are unaffected.
 */
function sendAppMail(string $toEmail, string $toName, string $subject, string $htmlBody): bool
{
    $brevoKey = getenv('BREVO_API_KEY') ?: '';
    if ($brevoKey !== '') {
        return sendViaBrevo($brevoKey, $toEmail, $toName, $subject, $htmlBody);
    }
    return sendViaSmtp($toEmail, $toName, $subject, $htmlBody);
}

function sendViaBrevo(string $apiKey, string $toEmail, string $toName, string $subject, string $htmlBody): bool
{
    $payload = [
        'sender' => [
            'name' => getenv('BREVO_FROM_NAME') ?: 'VBetter',
            'email' => getenv('BREVO_FROM_EMAIL') ?: getenv('SMTP_FROM') ?: '',
        ],
        'to' => [['email' => $toEmail, 'name' => $toName ?: $toEmail]],
        'subject' => $subject,
        'htmlContent' => $htmlBody,
    ];

    $ch = curl_init('https://api.brevo.com/v3/smtp/email');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_HTTPHEADER => [
            'accept: application/json',
            'content-type: application/json',
            'api-key: ' . $apiKey,
        ],
        CURLOPT_TIMEOUT => 15,
    ]);
    $response = curl_exec($ch);
    $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError !== '' || $statusCode < 200 || $statusCode >= 300) {
        error_log('[VBetter Mailer] Brevo send failed (' . $statusCode . '): ' . ($curlError ?: $response));
        return false;
    }
    return true;
}

function sendViaSmtp(string $toEmail, string $toName, string $subject, string $htmlBody): bool
{
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
        $mail->addAddress($toEmail, $toName);
        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body    = $htmlBody;

        $mail->send();
        return true;
    } catch (MailException $e) {
        error_log('[VBetter Mailer] SMTP send failed: ' . $e->getMessage());
        return false;
    }
}

/**
 * Whether the given user has opted into a notification category, AND (if
 * they've turned on Quiet Hours) that it isn't currently within their muted
 * window. Falls back to the column's schema default when the user has no
 * preferences row yet (see api/users/profile.php setupProfileTables()).
 *
 * Quiet Hours only applies here — it never suppresses notifyStaff()'s admin
 * alerts, which is what keeps "critical alerts always bypass quiet hours"
 * true without needing a separate urgency flag.
 */
function userWantsNotification(PDO $pdo, int $userId, string $column): bool
{
    $defaults = [
        'lost_found_alerts' => true,
        'appointment_reminders' => true,
        'chatbot_updates' => false,
    ];
    if (!array_key_exists($column, $defaults) || $userId <= 0) {
        return false;
    }

    $stmt = $pdo->prepare("SELECT $column, quiet_hours_enabled, quiet_hours_start, quiet_hours_end FROM user_notification_preferences WHERE user_id = :user_id LIMIT 1");
    $stmt->execute([':user_id' => $userId]);
    $row = $stmt->fetch();

    if ($row === false) {
        return $defaults[$column];
    }
    if (!(bool) $row[$column]) {
        return false;
    }

    return !isWithinQuietHours((bool) $row['quiet_hours_enabled'], (string) $row['quiet_hours_start'], (string) $row['quiet_hours_end']);
}

/**
 * True when "now" (server local time) falls inside the given start–end
 * window. Handles overnight windows (e.g. 22:00 -> 07:00) by wrapping past
 * midnight instead of treating start > end as an empty range.
 */
function isWithinQuietHours(bool $enabled, string $start, string $end): bool
{
    if (!$enabled) return false;

    $now = date('H:i:s');
    if ($start === $end) return true; // 24h window
    if ($start < $end) {
        return $now >= $start && $now < $end;
    }
    return $now >= $start || $now < $end;
}

/**
 * $photoUrl: absolute URL of an image (see emailAssetUrl()), shown below the body text.
 * $button: ['label' => 'View', 'url' => '...'] rendered as a centered green pill button.
 */
function notificationEmailWrapper(string $heading, string $bodyHtml, ?string $photoUrl = null, ?array $button = null): string
{
    $photoHtml = $photoUrl ? "
        <div style='text-align:center;margin:24px 0;'>
            <img src='{$photoUrl}' alt='' style='max-width:280px;max-height:280px;border-radius:12px;object-fit:cover;'>
        </div>
    " : '';

    $buttonHtml = $button ? "
        <div style='text-align:center;margin:32px 0;'>
            <a href='{$button['url']}'
               style='background:#00B928;color:#fff;padding:14px 32px;border-radius:8px;
                      text-decoration:none;font-weight:700;font-size:15px;display:inline-block;'>
                {$button['label']}
            </a>
        </div>
    " : '';

    return "
        <div style='font-family:sans-serif;max-width:480px;margin:auto;padding:32px;
                    border:1px solid #eee;border-radius:12px;text-align:center;'>
            <img src='" . EMAIL_LOGO_URL . "' alt='Baliwag City Vet' style='height:56px;margin-bottom:20px;'>
            <h2 style='color:#00B928;margin-bottom:8px;'>{$heading}</h2>
            <div style='color:#555;text-align:center;'>{$bodyHtml}</div>
            {$photoHtml}
            {$buttonHtml}
        </div>
    ";
}

<?php

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as MailException;

require_once __DIR__ . '/../phpMailer/PHPMailer-master/src/Exception.php';
require_once __DIR__ . '/../phpMailer/PHPMailer-master/src/PHPMailer.php';
require_once __DIR__ . '/../phpMailer/PHPMailer-master/src/SMTP.php';

if (!defined('APP_URL')) {
    define('APP_URL', getenv('APP_BASE_URL') ?: 'http://68.183.182.176');
}

define('EMAIL_LOGO_URL', rtrim(APP_URL, '/') . '/public/images/logos/logo-color-email.png');

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
 * Same as emailAssetUrl(), but for user-uploaded photos (pet photos etc.)
 * that can be up to 8MB straight off a phone camera — way more than the
 * ~280px the email template displays them at. Generates a small cached
 * JPEG copy next to the original (once per file, reused after) and points
 * the email at that instead, so recipients aren't downloading the full
 * upload just to see a thumbnail. Falls back to the untouched original
 * (via emailAssetUrl()) if resizing isn't possible for any reason — the
 * original upload itself is never modified, since other features (image
 * matching, admin review) may rely on full resolution.
 */
function emailPhotoUrl(string $sitePath): string
{
    $original = emailAssetUrl($sitePath);

    if (!extension_loaded('gd')) {
        return $original;
    }

    $projectRoot = dirname(__DIR__, 2);
    $absolutePath = $projectRoot . str_replace('/', DIRECTORY_SEPARATOR, $sitePath);
    if (!is_file($absolutePath)) {
        return $original;
    }

    $pathInfo = pathinfo($absolutePath);
    $thumbPath = $pathInfo['dirname'] . DIRECTORY_SEPARATOR . $pathInfo['filename'] . '_email.jpg';
    $thumbSitePath = rtrim(dirname($sitePath), '/') . '/' . $pathInfo['filename'] . '_email.jpg';

    if (is_file($thumbPath) && filemtime($thumbPath) >= filemtime($absolutePath)) {
        return emailAssetUrl($thumbSitePath);
    }

    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($absolutePath);
    $source = match ($mime) {
        'image/jpeg' => @imagecreatefromjpeg($absolutePath),
        'image/png'  => @imagecreatefrompng($absolutePath),
        'image/webp' => @imagecreatefromwebp($absolutePath),
        default      => null,
    };
    if (!$source) {
        return $original;
    }

    $srcW = imagesx($source);
    $srcH = imagesy($source);
    $maxDimension = 320;
    $scale = min(1, $maxDimension / max($srcW, $srcH));
    $dstW = max(1, (int) round($srcW * $scale));
    $dstH = max(1, (int) round($srcH * $scale));

    $thumb = imagecreatetruecolor($dstW, $dstH);
    $white = imagecolorallocate($thumb, 255, 255, 255);
    imagefill($thumb, 0, 0, $white); // flatten any transparency (source may be PNG/WEBP) onto white for JPEG output
    imagecopyresampled($thumb, $source, 0, 0, 0, 0, $dstW, $dstH, $srcW, $srcH);
    imagedestroy($source);

    $saved = imagejpeg($thumb, $thumbPath, 78);
    imagedestroy($thumb);

    return $saved ? emailAssetUrl($thumbSitePath) : $original;
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
            'name' => getenv('MAIL_FROM_NAME') ?: getenv('BREVO_FROM_NAME') ?: 'BVetter',
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
        CURLOPT_TIMEOUT => 6,
    ]);
    $response = curl_exec($ch);
    $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError !== '' || $statusCode < 200 || $statusCode >= 300) {
        error_log('[BVetter Mailer] Brevo send failed (' . $statusCode . '): ' . ($curlError ?: $response));
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

        $mail->setFrom(getenv('SMTP_FROM') ?: $mail->Username, getenv('MAIL_FROM_NAME') ?: 'BVetter');
        $mail->addAddress($toEmail, $toName);
        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body    = $htmlBody;

        $mail->send();
        return true;
    } catch (MailException $e) {
        error_log('[BVetter Mailer] SMTP send failed: ' . $e->getMessage());
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
 * Bulleted label/value rows for security-alert style emails
 * (Account / When / Device ...). Values must already be HTML-escaped.
 */
function emailDetailList(array $rows): string
{
    $items = '';
    foreach ($rows as $label => $value) {
        $items .= "
            <tr>
                <td style='color:#00B928;font-size:16px;line-height:1.6;padding:3px 10px 3px 0;vertical-align:top;'>&bull;</td>
                <td style='color:#444;font-size:14px;line-height:1.6;padding:3px 0;'>
                    {$label}: <strong style='color:#1a1a1a;'>{$value}</strong>
                </td>
            </tr>
        ";
    }
    return "<table role='presentation' cellpadding='0' cellspacing='0' style='margin:18px 0;'>{$items}</table>";
}

/**
 * Large one-time-code box for verification/OTP emails.
 */
function emailCodeBox(string $code): string
{
    return "
        <div style='font-size:32px;font-weight:800;letter-spacing:8px;text-align:center;color:#1a1a1a;
                    background:#f4f4f4;padding:20px;border-radius:8px;margin:24px 0;'>
            {$code}
        </div>
    ";
}

/**
 * Bold sub-heading that starts a new section in the email body
 * (e.g. "That wasn't me!"), security-alert style.
 */
function emailSectionHeading(string $text): string
{
    return "<h3 style='color:#1a1a1a;font-size:15px;font-weight:700;margin:26px 0 8px;'>{$text}</h3>";
}

/**
 * $photoUrl: absolute URL of an image (see emailAssetUrl()), shown below the body text.
 * $button: ['label' => 'View', 'url' => '...'] rendered as a centered green pill button.
 *
 * Light theme on purpose: inbox dark modes (Gmail, Outlook, Apple Mail)
 * recolor light emails automatically, while hardcoded dark colors render
 * unpredictably. Don't add dark backgrounds here.
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

    $year = date('Y');

    return "
        <div style='font-family:sans-serif;max-width:520px;margin:auto;padding:36px 40px;
                    background:#ffffff;text-align:left;'>
            <img src='" . EMAIL_LOGO_URL . "' alt='Baliwag City Vet' style='height:48px;margin-bottom:28px;'>
            <h1 style='color:#1a1a1a;font-size:25px;font-weight:800;margin:0 0 18px;'>{$heading}</h1>
            <div style='color:#444;font-size:14px;line-height:1.7;'>{$bodyHtml}</div>
            {$photoHtml}
            {$buttonHtml}
            <hr style='border:none;border-top:1px solid #eee;margin:30px 0 16px;'>
            <p style='color:#999;font-size:11.5px;line-height:1.7;margin:0;'>
                This is an automated message from BVetter. If you didn't expect this email, you can safely ignore it.<br>
                &copy; {$year} BVetter &mdash; Baliwag City Veterinary Office
            </p>
        </div>
    ";
}

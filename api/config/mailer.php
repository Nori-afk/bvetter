<?php

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as MailException;

require_once __DIR__ . '/../phpMailer/PHPMailer-master/src/Exception.php';
require_once __DIR__ . '/../phpMailer/PHPMailer-master/src/PHPMailer.php';
require_once __DIR__ . '/../phpMailer/PHPMailer-master/src/SMTP.php';

if (!defined('APP_URL')) {
    define('APP_URL', getenv('APP_BASE_URL') ?: 'http://localhost/final-VBETTER/bvetter');
}

define('EMAIL_LOGO_PATH', __DIR__ . '/../../public/images/logos/logo-color.png');

/**
 * Best-effort email send: never throws, logs and returns false on failure
 * so callers can fire-and-forget without risking their own API response.
 *
 * $embeds: extra inline images beyond the logo, e.g. [['path' => 'C:/.../pet.jpg', 'cid' => 'pet_photo']].
 * Embedding (not linking) is required because these emails render outside
 * the local network — a recipient's inbox can't reach http://localhost.
 */
function sendAppMail(string $toEmail, string $toName, string $subject, string $htmlBody, array $embeds = []): bool
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

        if (is_file(EMAIL_LOGO_PATH)) {
            $mail->addEmbeddedImage(EMAIL_LOGO_PATH, 'logo', 'logo.png');
        }
        foreach ($embeds as $embed) {
            if (!empty($embed['path']) && is_file($embed['path'])) {
                $mail->addEmbeddedImage($embed['path'], $embed['cid'], basename($embed['path']));
            }
        }

        $mail->send();
        return true;
    } catch (MailException $e) {
        error_log('[VBetter Mailer] Send failed: ' . $e->getMessage());
        return false;
    }
}

/**
 * Whether the given user has opted into a notification category.
 * Falls back to the column's schema default when the user has no
 * preferences row yet (see api/users/profile.php setupProfileTables()).
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

    $stmt = $pdo->prepare("SELECT $column FROM user_notification_preferences WHERE user_id = :user_id LIMIT 1");
    $stmt->execute([':user_id' => $userId]);
    $value = $stmt->fetchColumn();

    if ($value === false) {
        return $defaults[$column];
    }
    return (bool) $value;
}

/**
 * $photoCid: cid of an image already passed to sendAppMail()'s $embeds, shown below the body text.
 * $button: ['label' => 'View', 'url' => '...'] rendered as a centered green pill button.
 */
function notificationEmailWrapper(string $heading, string $bodyHtml, ?string $photoCid = null, ?array $button = null): string
{
    $photoHtml = $photoCid ? "
        <div style='text-align:center;margin:24px 0;'>
            <img src='cid:{$photoCid}' alt='' style='max-width:280px;max-height:280px;border-radius:12px;object-fit:cover;'>
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
            <img src='cid:logo' alt='Baliwag City Vet' style='height:56px;margin-bottom:20px;'>
            <h2 style='color:#00B928;margin-bottom:8px;'>{$heading}</h2>
            <div style='color:#555;text-align:center;'>{$bodyHtml}</div>
            {$photoHtml}
            {$buttonHtml}
        </div>
    ";
}

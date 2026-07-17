<?php

require_once __DIR__ . '/mailer.php';

// Where "important" staff alert emails go, in addition to the in-app bell.
define('STAFF_ALERT_EMAIL', 'clementine.cyyy@gmail.com');
define('STAFF_ALERT_NAME', 'VBetter Staff');

/**
 * Writes one row to the shared notifications table so both the admin and
 * vet dashboards can read it (filtered by `audience`). Optionally also
 * emails STAFF_ALERT_EMAIL for events important enough to leave the inbox.
 */
function notifyStaff(
    PDO $pdo,
    string $audience,
    string $type,
    string $title,
    string $message,
    ?int $referenceId = null,
    bool $emailImportant = false
): void {
    $stmt = $pdo->prepare('
        INSERT INTO notifications (audience, type, title, message, reference_id)
        VALUES (:audience, :type, :title, :message, :reference_id)
    ');
    $stmt->execute([
        ':audience' => in_array($audience, ['admin', 'vet', 'both'], true) ? $audience : 'both',
        ':type' => $type,
        ':title' => $title,
        ':message' => $message,
        ':reference_id' => $referenceId,
    ]);

    if ($emailImportant) {
        $subject = 'VBetter Alert – ' . $title;
        $body = notificationEmailWrapper($title, '<p>' . htmlspecialchars($message, ENT_QUOTES) . '</p>');
        sendAppMail(STAFF_ALERT_EMAIL, STAFF_ALERT_NAME, $subject, $body);
    }
}

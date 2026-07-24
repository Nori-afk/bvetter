<?php

require_once __DIR__ . '/mailer.php';

define('STAFF_ALERT_NAME', 'VBetter Staff');

/**
 * Every active admin account's name + email — the actual inboxes that
 * should see a staff alert, instead of one fixed test address.
 */
function staffAlertRecipients(PDO $pdo): array
{
    $stmt = $pdo->query("
        SELECT users.full_name, users.email
        FROM users
        INNER JOIN roles ON roles.id = users.role_id
        WHERE roles.name = 'admin'
          AND users.account_status = 'active'
          AND users.email IS NOT NULL AND users.email <> ''
    ");
    return $stmt->fetchAll();
}

/**
 * Writes one row to the shared notifications table so both the admin and
 * vet dashboards can read it (filtered by `audience`). Optionally also
 * emails every admin account for events important enough to leave the inbox.
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
        foreach (staffAlertRecipients($pdo) as $admin) {
            sendAppMail($admin['email'], $admin['full_name'] ?: STAFF_ALERT_NAME, $subject, $body);
        }
    }
}

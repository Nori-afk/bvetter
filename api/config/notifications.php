<?php

require_once __DIR__ . '/mailer.php';

define('STAFF_ALERT_NAME', 'BVetter Staff');

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
 * Writes one notification row addressed to one person.
 *
 * Every notification belongs to exactly one recipient. Rows used to be
 * broadcast to a whole `audience` with a single shared `is_read`, which
 * meant one admin marking something read marked it read for all of them
 * and there was no way to say "this person has seen it". Fanning out on
 * write costs a handful of rows per event at this scale and makes read
 * state, and dismissal, per-person for free.
 */
function notifyUser(
    PDO $pdo,
    int $userId,
    string $type,
    string $title,
    string $message,
    ?int $referenceId = null
): void {
    $stmt = $pdo->prepare('
        INSERT INTO notifications (user_id, type, title, message, reference_id)
        VALUES (:user_id, :type, :title, :message, :reference_id)
    ');
    $stmt->execute([
        ':user_id' => $userId,
        ':type' => $type,
        ':title' => $title,
        ':message' => $message,
        ':reference_id' => $referenceId,
    ]);
}

/**
 * The active staff accounts an `audience` refers to. Inactive accounts are
 * skipped — writing rows nobody can log in to read is just table growth.
 */
function staffUserIds(PDO $pdo, string $audience): array
{
    $roles = $audience === 'admin' ? ['admin']
        : ($audience === 'vet' ? ['veterinarian'] : ['admin', 'veterinarian']);

    $placeholders = implode(',', array_fill(0, count($roles), '?'));
    $stmt = $pdo->prepare("
        SELECT users.id
        FROM users
        INNER JOIN roles ON roles.id = users.role_id
        WHERE users.account_status = 'active' AND roles.name IN ($placeholders)
    ");
    $stmt->execute($roles);

    return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}

/**
 * Notifies every active member of a staff audience, one row each.
 *
 * The `$audience` argument is kept so the ten call sites read the same as
 * before; it now selects recipients at write time rather than being stored
 * on the row and filtered on at read time.
 *
 * Optionally also emails every admin account for events important enough to
 * leave the inbox.
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
    $audience = in_array($audience, ['admin', 'vet', 'both'], true) ? $audience : 'both';

    foreach (staffUserIds($pdo, $audience) as $userId) {
        notifyUser($pdo, $userId, $type, $title, $message, $referenceId);
    }

    if ($emailImportant) {
        $subject = 'BVetter Alert – ' . $title;
        $body = notificationEmailWrapper($title, '<p>' . htmlspecialchars($message, ENT_QUOTES) . '</p>');
        foreach (staffAlertRecipients($pdo) as $admin) {
            sendAppMail($admin['email'], $admin['full_name'] ?: STAFF_ALERT_NAME, $subject, $body);
        }
    }
}

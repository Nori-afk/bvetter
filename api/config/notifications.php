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
        SELECT users.id, users.full_name, users.email
        FROM users
        INNER JOIN roles ON roles.id = users.role_id
        WHERE roles.name = 'admin'
          AND users.account_status = 'active'
          AND users.email IS NOT NULL AND users.email <> ''
    ");
    return $stmt->fetchAll();
}

/**
 * Maps a notification $type onto the admin preference column that governs it,
 * or null for types no toggle covers.
 *
 * Returning null means "always deliver". That is deliberate: a notification
 * type added later must not silently vanish because nobody remembered to add
 * it to this map. Silence is the expensive failure here, not noise.
 *
 * The returned value is interpolated into SQL below, so it must only ever come
 * from this fixed list — never from caller input.
 */
function staffPrefColumn(string $type): ?string
{
    if (str_starts_with($type, 'appointment')) return 'staff_appointment_alerts';
    if (str_starts_with($type, 'lost_found'))  return 'staff_lost_found_alerts';
    if (str_starts_with($type, 'csp_'))        return 'staff_csp_alerts';
    if ($type === 'new_ticket')                return 'staff_ticket_alerts';
    return null;
}

/**
 * Admin user ids that have switched $column off.
 *
 * Only admins are consulted. Vets receive staff notifications unconditionally,
 * exactly as they do today — the toggles live on the admin profile page and
 * nothing in the vet UI offers the equivalent choice, so filtering vets here
 * would silently drop notifications they have no way to turn back on.
 *
 * An admin with no preferences row is not opted out. Same for a missing column
 * on an install that has not run the 2026-08-22 migration yet: the catch
 * returns an empty set, so the worst case is that everyone keeps getting
 * everything, which is the pre-existing behaviour.
 */
function staffOptedOut(PDO $pdo, string $column): array
{
    try {
        $stmt = $pdo->query("
            SELECT users.id
            FROM users
            INNER JOIN roles ON roles.id = users.role_id
            INNER JOIN user_notification_preferences p ON p.user_id = users.id
            WHERE roles.name = 'admin' AND p.$column = 0
        ");
        return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        return [];
    }
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
    bool $emailImportant = false,
    ?string $actionUrl = null,
    string $actionLabel = 'Review in BVetter'
): void {
    $audience = in_array($audience, ['admin', 'vet', 'both'], true) ? $audience : 'both';

    // Admins who switched this stream off on their profile page. Empty for
    // types no toggle covers, and empty for vets.
    $column   = staffPrefColumn($type);
    $optedOut = $column ? staffOptedOut($pdo, $column) : [];

    foreach (staffUserIds($pdo, $audience) as $userId) {
        if (in_array($userId, $optedOut, true)) continue;
        notifyUser($pdo, $userId, $type, $title, $message, $referenceId);
    }

    if ($emailImportant) {
        $subject = 'BVetter Alert – ' . $title;

        // $actionUrl is where the admin should land AFTER logging in — a
        // bare filename relative to admin/pages/ (e.g.
        // 'account-management.html?review=42'), not the login page itself
        // and not prefixed with 'admin/pages/'. admin-login.js resolves
        // `next` with a plain window.location.href from its own directory
        // (admin/pages/ops-3bab26d632.html), so anything else silently
        // resolves to the wrong place. It's wrapped behind the admin login
        // page as `next` so a reader opening this on their phone, where the
        // app usually has no session, lands on login first and is carried
        // through to the right screen afterward instead of the plain
        // dashboard.
        //
        // The login page path is hardcoded here rather than shared with
        // ADMIN_LOGIN_PAGE in shared/js/auth.js — there's no PHP/JS constant
        // shared between them today. If that page is ever renamed, this
        // link goes stale along with it.
        $button = null;
        if ($actionUrl !== null) {
            $loginUrl = rtrim(APP_URL, '/') . '/admin/pages/ops-3bab26d632.html?next=' . rawurlencode($actionUrl);
            $button = ['url' => $loginUrl, 'label' => $actionLabel];
        }

        $body = notificationEmailWrapper($title, '<p>' . htmlspecialchars($message, ENT_QUOTES) . '</p>', null, $button);
        foreach (staffAlertRecipients($pdo) as $admin) {
            if (in_array((int) $admin['id'], $optedOut, true)) continue;
            sendAppMail($admin['email'], $admin['full_name'] ?: STAFF_ALERT_NAME, $subject, $body);
        }
    }
}

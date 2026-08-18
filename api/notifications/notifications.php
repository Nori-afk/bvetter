<?php

/**
 * BVetter – notification feed
 *
 * One feed for everyone. Rows belong to a single recipient (notifications
 * .user_id), so the caller only ever sees, marks, or dismisses their own —
 * there is no role branching here and no client-supplied identity.
 *
 * Pet owners are included. Their notifications used to be synthesized in
 * the browser from six endpoints with read state in localStorage, which
 * made "read" per-device and unrecoverable; they are ordinary rows now.
 */

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'message' => 'Method not allowed'
    ]);
    exit;
}

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/auth_guard.php';

function respond($statusCode, $payload)
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

function inputData()
{
    $json = json_decode(file_get_contents('php://input'), true);
    if (is_array($json)) {
        return array_merge($_POST, $json);
    }
    return $_POST;
}

function clean($value)
{
    return trim((string) $value);
}

function listNotifications($pdo, $data, $userId)
{
    $limit = (int) ($data['limit'] ?? 30);
    if ($limit <= 0 || $limit > 100) $limit = 30;

    $stmt = $pdo->prepare("
        SELECT id, type, title, message, reference_id, is_read, created_at
        FROM notifications
        WHERE user_id = :user_id AND dismissed_at IS NULL
        ORDER BY created_at DESC
        LIMIT $limit
    ");
    $stmt->execute([':user_id' => $userId]);

    $data = array_map(function ($row) {
        return [
            'id' => (int) $row['id'],
            'type' => $row['type'],
            'title' => $row['title'],
            'message' => $row['message'],
            'reference_id' => $row['reference_id'] !== null ? (int) $row['reference_id'] : null,
            'is_read' => (bool) $row['is_read'],
            'created_at' => $row['created_at'],
        ];
    }, $stmt->fetchAll());

    // Counted over the whole feed, not the page just returned — the bell has
    // to reflect every unread notification, including any past the limit.
    $unread = $pdo->prepare('
        SELECT COUNT(*) FROM notifications
        WHERE user_id = :user_id AND dismissed_at IS NULL AND is_read = 0
    ');
    $unread->execute([':user_id' => $userId]);

    respond(200, [
        'success' => true,
        'data' => $data,
        'unread_count' => (int) $unread->fetchColumn(),
    ]);
}

/**
 * Unread count on its own, for the bell dot.
 *
 * Split out because the dot is refreshed far more often than the list is
 * opened, and it only ever needed one number. The owner-side dot used to
 * cost six API calls per refresh to work this out.
 */
function unreadCount($pdo, $userId)
{
    $stmt = $pdo->prepare('
        SELECT COUNT(*) FROM notifications
        WHERE user_id = :user_id AND dismissed_at IS NULL AND is_read = 0
    ');
    $stmt->execute([':user_id' => $userId]);

    respond(200, ['success' => true, 'unread_count' => (int) $stmt->fetchColumn()]);
}

/**
 * Every write is scoped by user_id as well as the row id, so a valid session
 * still cannot touch somebody else's notification by guessing its id.
 */
function markRead($pdo, $data, $userId)
{
    $id = (int) ($data['id'] ?? 0);
    if ($id <= 0) {
        respond(422, ['success' => false, 'message' => 'Invalid notification id.']);
    }

    $stmt = $pdo->prepare('UPDATE notifications SET is_read = 1 WHERE id = :id AND user_id = :user_id');
    $stmt->execute([':id' => $id, ':user_id' => $userId]);

    // rowCount() counts rows CHANGED, not matched, so 0 here is ambiguous —
    // it means either "already read" or "not your row". Callers should treat
    // `success` as the signal; `updated` is for diagnostics only. In
    // markAllRead() below it is unambiguous, because that WHERE filters on
    // is_read = 0 and so only ever matches rows that are about to change.
    respond(200, ['success' => true, 'message' => 'Notification marked as read.', 'updated' => $stmt->rowCount()]);
}

function markAllRead($pdo, $userId)
{
    $stmt = $pdo->prepare('
        UPDATE notifications SET is_read = 1
        WHERE user_id = :user_id AND dismissed_at IS NULL AND is_read = 0
    ');
    $stmt->execute([':user_id' => $userId]);

    // `updated` distinguishes "the UPDATE ran but matched no rows" from "the
    // UPDATE never ran at all". Without it a failing mark-all-read is
    // indistinguishable from a successful one at the caller.
    respond(200, [
        'success' => true,
        'message' => 'All notifications marked as read.',
        'updated' => $stmt->rowCount(),
    ]);
}

/**
 * Dismiss hides a notification from its own recipient only, which is safe
 * now that rows are not shared. Soft-deleted rather than deleted so a
 * vanished notification stays explainable after the fact.
 */
function dismiss($pdo, $data, $userId)
{
    $id = (int) ($data['id'] ?? 0);
    if ($id <= 0) {
        respond(422, ['success' => false, 'message' => 'Invalid notification id.']);
    }

    $stmt = $pdo->prepare('
        UPDATE notifications SET dismissed_at = NOW()
        WHERE id = :id AND user_id = :user_id AND dismissed_at IS NULL
    ');
    $stmt->execute([':id' => $id, ':user_id' => $userId]);

    respond(200, ['success' => true, 'message' => 'Notification dismissed.', 'updated' => $stmt->rowCount()]);
}

$session = requireRole($pdo, ['admin', 'veterinarian', 'pet_owner']);
$userId = (int) $session['user_id'];

$input = inputData();

// No default action. This used to fall back to 'list', so a request that
// lost its body — a redirect, a proxy stripping POST data — quietly
// returned a successful list instead of failing, which let a write that
// never happened still report success to the caller.
$action = clean($input['action'] ?? '');

try {
    if ($action === 'list') listNotifications($pdo, $input, $userId);
    if ($action === 'unread_count') unreadCount($pdo, $userId);
    if ($action === 'mark_read') markRead($pdo, $input, $userId);
    if ($action === 'mark_all_read') markAllRead($pdo, $userId);
    if ($action === 'dismiss') dismiss($pdo, $input, $userId);

    respond(400, [
        'success' => false,
        'message' => 'Unknown notifications action.'
    ]);
} catch (PDOException $e) {
    error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
    respond(500, [
        'success' => false,
        'message' => 'Notifications request failed.'
    ]);
}

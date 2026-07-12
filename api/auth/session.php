<?php
/**
 * VBetter – Session check / list / end (Manage Security page)
 *
 * Actions (all require an "Authorization: Bearer <token>" header):
 *   check         – is my current session still valid? (polled by shared/js/auth.js)
 *   list          – my own active sessions/devices, most recent first
 *   end           – end one of my other sessions by id
 *   end_others    – end every one of my own other sessions
 *   logout        – end the session making this request (explicit logout)
 *   admin_list    – (admin only) every active session, across every user
 *   admin_end     – (admin only) end any session by id, any user
 *   admin_end_others – (admin only) end every session system-wide except the caller's
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/session.php';

function respond(int $code, array $payload): never
{
    http_response_code($code);
    echo json_encode($payload);
    exit;
}

$action = $_POST['action'] ?? $_GET['action'] ?? '';
$token  = bearerToken();

if (!$token) {
    respond(401, ['success' => false, 'valid' => false, 'message' => 'Missing authorization token.']);
}

$session = findSessionByToken($pdo, $token);

if (!$session || $session['revoked_at'] !== null) {
    respond(401, ['success' => false, 'valid' => false, 'message' => 'This session is no longer active.']);
}

$userId       = (int) $session['user_id'];
$currentHash  = hash('sha256', $token);

try {
    switch ($action) {
        case 'check':
            $pdo->prepare('UPDATE user_sessions SET last_seen_at = NOW() WHERE id = :id')
                ->execute([':id' => $session['id']]);
            respond(200, ['success' => true, 'valid' => true]);

        case 'list':
            $pdo->prepare('UPDATE user_sessions SET last_seen_at = NOW() WHERE id = :id')
                ->execute([':id' => $session['id']]);

            $stmt = $pdo->prepare('
                SELECT id, ip_address, city, country, device_label, last_seen_at, created_at, token_hash
                FROM user_sessions
                WHERE user_id = :user_id AND revoked_at IS NULL
                ORDER BY last_seen_at DESC
            ');
            $stmt->execute([':user_id' => $userId]);

            $data = array_map(function ($row) use ($currentHash) {
                $location = trim(($row['city'] ? $row['city'] . ', ' : '') . ($row['country'] ?? ''), ', ');
                return [
                    'id'           => (int) $row['id'],
                    'device'       => $row['device_label'] ?: 'Unknown device',
                    'location'     => $location !== '' ? $location : 'Unknown location',
                    'ip'           => $row['ip_address'],
                    'lastActivity' => $row['last_seen_at'],
                    'isCurrent'    => hash_equals($row['token_hash'], $currentHash),
                ];
            }, $stmt->fetchAll());

            respond(200, ['success' => true, 'data' => $data]);

        case 'end':
            $sessionId = (int) ($_POST['session_id'] ?? 0);

            $target = $pdo->prepare('
                SELECT token_hash FROM user_sessions WHERE id = :id AND user_id = :user_id LIMIT 1
            ');
            $target->execute([':id' => $sessionId, ':user_id' => $userId]);
            $targetRow = $target->fetch();

            if (!$targetRow) {
                respond(404, ['success' => false, 'message' => 'Session not found.']);
            }
            if (hash_equals($targetRow['token_hash'], $currentHash)) {
                respond(422, ['success' => false, 'message' => 'Use logout to end your current session.']);
            }

            $pdo->prepare('
                UPDATE user_sessions SET revoked_at = NOW() WHERE id = :id AND user_id = :user_id
            ')->execute([':id' => $sessionId, ':user_id' => $userId]);

            respond(200, ['success' => true, 'message' => 'Session ended.']);

        case 'end_others':
            $pdo->prepare('
                UPDATE user_sessions
                SET revoked_at = NOW()
                WHERE user_id = :user_id AND revoked_at IS NULL AND token_hash != :current_hash
            ')->execute([':user_id' => $userId, ':current_hash' => $currentHash]);

            respond(200, ['success' => true, 'message' => 'All other sessions ended.']);

        case 'logout':
            $pdo->prepare('UPDATE user_sessions SET revoked_at = NOW() WHERE id = :id')
                ->execute([':id' => $session['id']]);

            respond(200, ['success' => true, 'message' => 'Logged out.']);

        case 'admin_list':
            if ($session['role_name'] !== 'admin') {
                respond(403, ['success' => false, 'message' => 'Admin access required.']);
            }

            $stmt = $pdo->query('
                SELECT
                    user_sessions.id, user_sessions.ip_address, user_sessions.city, user_sessions.country,
                    user_sessions.device_label, user_sessions.last_seen_at, user_sessions.token_hash,
                    users.full_name, users.email, roles.name AS role_name
                FROM user_sessions
                INNER JOIN users ON users.id = user_sessions.user_id
                INNER JOIN roles ON roles.id = users.role_id
                WHERE user_sessions.revoked_at IS NULL
                ORDER BY user_sessions.last_seen_at DESC
            ');

            $data = array_map(function ($row) use ($currentHash) {
                $location = trim(($row['city'] ? $row['city'] . ', ' : '') . ($row['country'] ?? ''), ', ');
                return [
                    'id'           => (int) $row['id'],
                    'userName'     => $row['full_name'],
                    'userEmail'    => $row['email'],
                    'userRole'     => $row['role_name'],
                    'device'       => $row['device_label'] ?: 'Unknown device',
                    'location'     => $location !== '' ? $location : 'Unknown location',
                    'ip'           => $row['ip_address'],
                    'lastActivity' => $row['last_seen_at'],
                    'isCurrent'    => hash_equals($row['token_hash'], $currentHash),
                ];
            }, $stmt->fetchAll());

            respond(200, ['success' => true, 'data' => $data]);

        case 'admin_end':
            if ($session['role_name'] !== 'admin') {
                respond(403, ['success' => false, 'message' => 'Admin access required.']);
            }

            $sessionId = (int) ($_POST['session_id'] ?? 0);
            $target = $pdo->prepare('SELECT token_hash FROM user_sessions WHERE id = :id LIMIT 1');
            $target->execute([':id' => $sessionId]);
            $targetRow = $target->fetch();

            if (!$targetRow) {
                respond(404, ['success' => false, 'message' => 'Session not found.']);
            }
            if (hash_equals($targetRow['token_hash'], $currentHash)) {
                respond(422, ['success' => false, 'message' => 'Use logout to end your current session.']);
            }

            $pdo->prepare('UPDATE user_sessions SET revoked_at = NOW() WHERE id = :id')
                ->execute([':id' => $sessionId]);

            respond(200, ['success' => true, 'message' => 'Session ended.']);

        case 'admin_end_others':
            if ($session['role_name'] !== 'admin') {
                respond(403, ['success' => false, 'message' => 'Admin access required.']);
            }

            $pdo->prepare('
                UPDATE user_sessions SET revoked_at = NOW()
                WHERE revoked_at IS NULL AND token_hash != :current_hash
            ')->execute([':current_hash' => $currentHash]);

            respond(200, ['success' => true, 'message' => 'All other sessions ended system-wide.']);

        default:
            respond(400, ['success' => false, 'message' => 'Unknown action.']);
    }
} catch (PDOException $e) {
    respond(500, [
        'success' => false,
        'message' => 'Session request failed.',
        'error'   => $e->getMessage(),
    ]);
}

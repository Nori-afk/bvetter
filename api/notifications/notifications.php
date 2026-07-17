<?php

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

function normalizeAudience($role)
{
    $role = strtolower(clean($role));
    return $role === 'admin' ? 'admin' : 'vet';
}

function listNotifications($pdo, $data)
{
    $audience = normalizeAudience($data['role'] ?? '');
    $limit = (int) ($data['limit'] ?? 30);
    if ($limit <= 0 || $limit > 100) $limit = 30;

    $stmt = $pdo->prepare("
        SELECT id, audience, type, title, message, reference_id, is_read, created_at
        FROM notifications
        WHERE audience = :audience OR audience = 'both'
        ORDER BY created_at DESC
        LIMIT $limit
    ");
    $stmt->execute([':audience' => $audience]);
    $rows = $stmt->fetchAll();

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
    }, $rows);

    respond(200, [
        'success' => true,
        'data' => $data,
        'unread_count' => count(array_filter($data, fn($item) => !$item['is_read'])),
    ]);
}

function markRead($pdo, $data)
{
    $id = (int) ($data['id'] ?? 0);
    if ($id <= 0) {
        respond(422, ['success' => false, 'message' => 'Invalid notification id.']);
    }

    $stmt = $pdo->prepare('UPDATE notifications SET is_read = 1 WHERE id = :id');
    $stmt->execute([':id' => $id]);

    respond(200, ['success' => true, 'message' => 'Notification marked as read.']);
}

function markAllRead($pdo, $data)
{
    $audience = normalizeAudience($data['role'] ?? '');

    $stmt = $pdo->prepare("
        UPDATE notifications
        SET is_read = 1
        WHERE (audience = :audience OR audience = 'both') AND is_read = 0
    ");
    $stmt->execute([':audience' => $audience]);

    respond(200, ['success' => true, 'message' => 'All notifications marked as read.']);
}

$input = inputData();
$action = clean($input['action'] ?? 'list');

try {
    if ($action === 'list') listNotifications($pdo, $input);
    if ($action === 'mark_read') markRead($pdo, $input);
    if ($action === 'mark_all_read') markAllRead($pdo, $input);

    respond(400, [
        'success' => false,
        'message' => 'Unknown notifications action.'
    ]);
} catch (PDOException $e) {
    respond(500, [
        'success' => false,
        'message' => 'Notifications request failed.',
        'error' => $e->getMessage()
    ]);
}

<?php

header('Content-Type: application/json');

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';
if ($method !== 'POST') {
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

function nullableClean($value)
{
    $value = clean($value);
    return $value === '' ? null : $value;
}

function normalizeRole($role)
{
    $role = strtolower(clean($role));
    if ($role === 'veterinarian') return 'vet';
    if ($role === 'pet_owner') return 'owner';
    return in_array($role, ['owner', 'vet', 'admin'], true) ? $role : 'owner';
}

function normalizeTicketStatus($status, $fallback = 'open')
{
    $status = strtolower(str_replace(' ', '_', clean($status)));
    $allowed = ['open', 'in_progress', 'resolved'];
    return in_array($status, $allowed, true) ? $status : $fallback;
}

function generateTicketNumber()
{
    return 'TKT-' . date('Ymd') . '-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 6));
}

function ensureTicketSchema($pdo)
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS support_tickets (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ticket_number VARCHAR(40) NOT NULL UNIQUE,
            reporter_id INT NULL,
            reporter_role ENUM('owner','vet','admin') NOT NULL DEFAULT 'owner',
            reporter_name VARCHAR(150) NULL,
            reporter_email VARCHAR(150) NULL,
            subject VARCHAR(150) NOT NULL,
            description TEXT NOT NULL,
            status ENUM('open','in_progress','resolved') NOT NULL DEFAULT 'open',
            admin_notes TEXT NULL,
            resolved_by_user_id INT NULL,
            resolved_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_tickets_reporter (reporter_id),
            INDEX idx_tickets_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ");
}

function mapTicket($row)
{
    return [
        'id' => (int) $row['id'],
        'ticketNumber' => $row['ticket_number'],
        'reporterId' => $row['reporter_id'] !== null ? (int) $row['reporter_id'] : null,
        'reporterRole' => $row['reporter_role'],
        'reporterName' => $row['reporter_name'],
        'reporterEmail' => $row['reporter_email'],
        'subject' => $row['subject'],
        'description' => $row['description'],
        'status' => $row['status'],
        'adminNotes' => $row['admin_notes'],
        'resolvedAt' => $row['resolved_at'],
        'createdAt' => $row['created_at'],
        'updatedAt' => $row['updated_at'],
    ];
}

function createTicket($pdo, $data)
{
    $subject = clean($data['subject'] ?? '');
    $description = clean($data['description'] ?? '');
    if ($subject === '' || $description === '') {
        respond(422, ['success' => false, 'message' => 'Subject and description are required.']);
    }

    $stmt = $pdo->prepare("
        INSERT INTO support_tickets
            (ticket_number, reporter_id, reporter_role, reporter_name, reporter_email, subject, description, status)
        VALUES
            (:ticket_number, :reporter_id, :reporter_role, :reporter_name, :reporter_email, :subject, :description, 'open')
    ");
    $stmt->execute([
        ':ticket_number' => generateTicketNumber(),
        ':reporter_id' => (int) ($data['reporter_id'] ?? 0) ?: null,
        ':reporter_role' => normalizeRole($data['reporter_role'] ?? ''),
        ':reporter_name' => nullableClean($data['reporter_name'] ?? ''),
        ':reporter_email' => nullableClean($data['reporter_email'] ?? ''),
        ':subject' => $subject,
        ':description' => $description,
    ]);

    $id = (int) $pdo->lastInsertId();
    $row = $pdo->query("SELECT * FROM support_tickets WHERE id = $id")->fetch();
    respond(201, ['success' => true, 'data' => mapTicket($row)]);
}

function listTickets($pdo, $data)
{
    $role = normalizeRole($data['role'] ?? $data['reporter_role'] ?? '');
    $reporterId = (int) ($data['reporter_id'] ?? 0);
    $statusFilter = clean($data['status'] ?? '');

    $where = [];
    $params = [];

    // Admin sees every ticket; everyone else only sees their own submissions.
    if ($role !== 'admin') {
        $where[] = 'reporter_id = :reporter_id';
        $params[':reporter_id'] = $reporterId;
    }

    if ($statusFilter !== '' && $statusFilter !== 'all') {
        $where[] = 'status = :status';
        $params[':status'] = normalizeTicketStatus($statusFilter);
    }

    $sql = 'SELECT * FROM support_tickets';
    if ($where) {
        $sql .= ' WHERE ' . implode(' AND ', $where);
    }
    $sql .= ' ORDER BY created_at DESC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    respond(200, ['success' => true, 'data' => array_map('mapTicket', $rows)]);
}

function updateTicketStatus($pdo, $data)
{
    $id = (int) ($data['ticket_id'] ?? $data['id'] ?? 0);
    if ($id <= 0) {
        respond(422, ['success' => false, 'message' => 'A ticket_id is required.']);
    }

    $status = normalizeTicketStatus($data['status'] ?? '', '');
    if ($status === '') {
        respond(422, ['success' => false, 'message' => 'A valid status is required.']);
    }

    $resolvedByUserId = (int) ($data['resolved_by_user_id'] ?? 0) ?: null;

    $stmt = $pdo->prepare("
        UPDATE support_tickets
        SET status = :status,
            admin_notes = :admin_notes,
            resolved_by_user_id = CASE WHEN :status2 = 'resolved' THEN :resolved_by_user_id ELSE resolved_by_user_id END,
            resolved_at = CASE WHEN :status3 = 'resolved' THEN NOW() ELSE resolved_at END
        WHERE id = :id
    ");
    $stmt->execute([
        ':status' => $status,
        ':status2' => $status,
        ':status3' => $status,
        ':admin_notes' => nullableClean($data['admin_notes'] ?? ''),
        ':resolved_by_user_id' => $resolvedByUserId,
        ':id' => $id,
    ]);

    $row = $pdo->query("SELECT * FROM support_tickets WHERE id = $id")->fetch();
    if (!$row) {
        respond(404, ['success' => false, 'message' => 'Ticket not found.']);
    }
    respond(200, ['success' => true, 'data' => mapTicket($row)]);
}

try {
    // $pdo comes from connection.php (required above)
    ensureTicketSchema($pdo);

    $data = inputData();
    $action = clean($data['action'] ?? 'list');

    switch ($action) {
        case 'create':
            createTicket($pdo, $data);
            break;
        case 'update_status':
            updateTicketStatus($pdo, $data);
            break;
        case 'list':
        default:
            listTickets($pdo, $data);
            break;
    }
} catch (Throwable $e) {
    error_log('[VBetter Tickets] ' . $e->getMessage());
    respond(500, ['success' => false, 'message' => 'Server error while processing tickets.']);
}

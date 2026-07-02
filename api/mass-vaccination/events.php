<?php

header('Content-Type: application/json');

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
    return is_array($json) ? array_merge($_POST, $json) : $_POST;
}

function clean($value)
{
    return trim((string) ($value ?? ''));
}

function setupTables($pdo)
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS mass_vaccination_events (
            id INT AUTO_INCREMENT PRIMARY KEY,
            event_date DATE NOT NULL,
            barangay VARCHAR(120) NOT NULL,
            vaccine VARCHAR(120) NOT NULL,
            status VARCHAR(40) NOT NULL DEFAULT 'Pending Report',
            total_vaccinated INT NULL,
            dogs_count INT NOT NULL DEFAULT 0,
            cats_count INT NOT NULL DEFAULT 0,
            others_count INT NOT NULL DEFAULT 0,
            created_by_user_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_mve_date (event_date),
            INDEX idx_mve_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function formatEvent($row)
{
    $date = $row['event_date'];
    $total = $row['total_vaccinated'] === null ? '' : (int) $row['total_vaccinated'];
    $eventTotal = $total === '' ? 0 : $total;
    $average = max(1, (int) round(($eventTotal + 65) / 2));
    $highest = max(100, $eventTotal, $average);

    return [
        'id' => 'evt-' . $row['id'],
        'rawId' => (int) $row['id'],
        'date' => $date,
        'dateLabel' => date('F j, Y', strtotime($date)),
        'barangay' => $row['barangay'],
        'vaccine' => $row['vaccine'],
        'status' => $row['status'],
        'totalVaccinated' => $total,
        'breakdown' => [
            'dogs' => (int) $row['dogs_count'],
            'cats' => (int) $row['cats_count'],
            'others' => (int) $row['others_count'],
        ],
        'comparison' => [
            'event' => $eventTotal,
            'average' => $average,
            'highest' => $highest,
        ],
    ];
}

function listEvents($pdo)
{
    $rows = $pdo->query('SELECT * FROM mass_vaccination_events ORDER BY event_date DESC, id DESC')->fetchAll();
    respond(200, ['success' => true, 'data' => array_map('formatEvent', $rows)]);
}

function createEvent($pdo, $data)
{
    $date = clean($data['date'] ?? $data['event_date'] ?? '');
    $barangay = clean($data['barangay'] ?? '');
    $vaccine = clean($data['vaccine'] ?? '');
    if ($date === '' || $barangay === '' || $vaccine === '') {
        respond(422, ['success' => false, 'message' => 'Date, barangay, and vaccine are required.']);
    }

    $stmt = $pdo->prepare("
        INSERT INTO mass_vaccination_events (event_date, barangay, vaccine, created_by_user_id)
        VALUES (:event_date, :barangay, :vaccine, :created_by_user_id)
    ");
    $stmt->execute([
        ':event_date' => $date,
        ':barangay' => $barangay,
        ':vaccine' => $vaccine,
        ':created_by_user_id' => (int) ($data['user_id'] ?? $data['created_by_user_id'] ?? 0) ?: null,
    ]);

    $id = (int) $pdo->lastInsertId();
    $stmt = $pdo->prepare('SELECT * FROM mass_vaccination_events WHERE id = :id');
    $stmt->execute([':id' => $id]);
    respond(201, ['success' => true, 'data' => formatEvent($stmt->fetch())]);
}

function submitReport($pdo, $data)
{
    $id = (int) preg_replace('/^evt-/', '', (string) ($data['id'] ?? $data['event_id'] ?? 0));
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid event id.']);

    $total = (int) ($data['totalVaccinated'] ?? $data['total_vaccinated'] ?? 0);
    $breakdown = $data['breakdown'] ?? [];
    if (is_string($breakdown)) {
        $decoded = json_decode($breakdown, true);
        $breakdown = is_array($decoded) ? $decoded : [];
    }

    $stmt = $pdo->prepare("
        UPDATE mass_vaccination_events
        SET status = 'Completed',
            total_vaccinated = :total,
            dogs_count = :dogs,
            cats_count = :cats,
            others_count = :others
        WHERE id = :id
    ");
    $stmt->execute([
        ':total' => $total,
        ':dogs' => (int) ($breakdown['dogs'] ?? $data['dogs'] ?? 0),
        ':cats' => (int) ($breakdown['cats'] ?? $data['cats'] ?? 0),
        ':others' => (int) ($breakdown['others'] ?? $data['others'] ?? 0),
        ':id' => $id,
    ]);

    $stmt = $pdo->prepare('SELECT * FROM mass_vaccination_events WHERE id = :id');
    $stmt->execute([':id' => $id]);
    respond(200, ['success' => true, 'data' => formatEvent($stmt->fetch())]);
}

$input = inputData();
$action = clean($input['action'] ?? 'list');

try {
    setupTables($pdo);
    if ($action === 'list') listEvents($pdo);
    if ($action === 'create') createEvent($pdo, $input);
    if ($action === 'submit_report') submitReport($pdo, $input);
    respond(400, ['success' => false, 'message' => 'Unknown mass vaccination action.']);
} catch (PDOException $e) {
    respond(500, ['success' => false, 'message' => 'Mass vaccination request failed.', 'error' => $e->getMessage()]);
}

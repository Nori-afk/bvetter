<?php

header('Content-Type: application/json');
require_once __DIR__ . '/../../config/connection.php';

try {
    $stmt = $pdo->query("
        SELECT id, name, city, province
        FROM barangays
        ORDER BY name ASC
    ");

    echo json_encode([
        'success' => true,
        'data' => $stmt->fetchAll()
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Failed to load barangays'
    ]);
}
<?php
/**
 * BVetter – Public login (pet owner + veterinarian accounts)
 *
 * Admin accounts cannot complete a login here — see login_flow.php's
 * attemptLogin(). They authenticate exclusively through admin-login.php,
 * whose URL is not linked from anywhere in the public site.
 */

header('Content-Type: application/json');

$requestMethod = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';

if ($requestMethod !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'message' => 'Method not allowed',
        'title' => 'Login Failed'
    ]);
    exit;
}

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/login_flow.php';

$email = isset($_POST['email']) ? trim($_POST['email']) : '';
$password = isset($_POST['password']) ? $_POST['password'] : '';
$otpCode = isset($_POST['otp_code']) ? trim($_POST['otp_code']) : '';

try {
    [$statusCode, $payload] = attemptLogin($pdo, $email, $password, $otpCode, ['pet_owner', 'veterinarian']);
    http_response_code($statusCode);
    echo json_encode($payload);
} catch (PDOException $e) {
    error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Database query failed'
    ]);
}

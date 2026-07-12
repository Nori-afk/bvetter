<?php

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
require_once __DIR__ . '/../config/email_verification.php';
require_once __DIR__ . '/../config/session.php';

ensureEmailVerificationSchema($pdo);
ensureSessionSchema($pdo);

function respond($statusCode, $payload)
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

$email = isset($_POST['email']) ? trim($_POST['email']) : '';
$password = isset($_POST['password']) ? $_POST['password'] : '';

if ($email === '' || $password === '') {
    respond(422, [
        'success' => false,
        'message' => 'Please enter your email and password.'
    ]);
}

try {
    $sql = '
        SELECT
            users.id,
            users.full_name,
            users.email,
            users.phone_number,
            users.password_hash,
            users.account_status,
            users.profile_photo,
            users.email_verified_at,
            roles.name AS role_name,
            owner_profiles.verification_status
        FROM users
        INNER JOIN roles ON roles.id = users.role_id
        LEFT JOIN owner_profiles ON owner_profiles.user_id = users.id
        WHERE users.email = :email
        LIMIT 1
    ';

    $stmt = $pdo->prepare($sql);
    $stmt->execute([':email' => $email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        respond(401, [
            'success' => false,
            'message' => 'Invalid email or password.'
        ]);
    }

    if ($user['account_status'] !== 'active') {
        respond(403, [
            'success' => false,
            'message' => 'Your account is not active yet. Please wait for admin approval.'
        ]);
    }

    if ($user['role_name'] === 'pet_owner' && $user['verification_status'] !== 'approved') {
        respond(403, [
            'success' => false,
            'message' => 'Your account is still pending residence verification.'
        ]);
    }

    if (in_array($user['role_name'], ['veterinarian', 'admin'], true) && $user['email_verified_at'] === null) {
        respond(403, [
            'success' => false,
            'message' => 'Please verify your email address before logging in. Check your inbox for the verification link.'
        ]);
    }

    $token = bin2hex(random_bytes(32));

    $updateLogin = $pdo->prepare('UPDATE users SET last_login_at = NOW() WHERE id = :id');
    $updateLogin->execute([':id' => $user['id']]);

    recordLoginSession($pdo, (int) $user['id'], $token);

    $frontendRole = $user['role_name'];
    if ($frontendRole === 'pet_owner') {
        $frontendRole = 'owner';
    } elseif ($frontendRole === 'veterinarian') {
        $frontendRole = 'vet';
    }

    respond(200, [
        'success' => true,
        'message' => 'Login successful',
        'data' => [
            'id' => (int) $user['id'],
            'userId' => (int) $user['id'],
            'name' => $user['full_name'],
            'email' => $user['email'],
            'phone' => $user['phone_number'],
            'role' => $frontendRole,
            'db_role' => $user['role_name'],
            'pfp'=>$user['profile_photo'],
            'token' => $token
        ]
    ]);
} catch (PDOException $e) {
    respond(500, [
        'success' => false,
        'message' => 'Database query failed',
        'error' => $e->getMessage()
    ]);
}

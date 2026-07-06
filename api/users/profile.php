<?php

header('Content-Type: application/json');

require_once __DIR__ . '/../../config/connection.php';

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

function setupProfileTables($pdo)
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS user_notification_preferences (
            user_id INT PRIMARY KEY,
            lost_found_alerts TINYINT(1) NOT NULL DEFAULT 1,
            appointment_reminders TINYINT(1) NOT NULL DEFAULT 1,
            chatbot_updates TINYINT(1) NOT NULL DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function roleLabel($roleName)
{
    if ($roleName === 'veterinarian') return 'Vet III';
    if ($roleName === 'admin') return 'Administrator';
    if ($roleName === 'pet_owner') return 'Pet Owner';
    return ucwords(str_replace('_', ' ', $roleName ?: 'User'));
}

function profileStats($pdo, $userId, $roleName)
{
    $stats = [
        'patientsToday' => 0,
        'surgeriesPerformed' => 0,
        'avgTreatmentTime' => '45m',
        'satisfactionRate' => '0.0',
    ];

    try {
        if ($roleName === 'veterinarian') {
            $stmt = $pdo->prepare("
                SELECT COUNT(*)
                FROM patient_visit_records
                WHERE owner_id IS NOT NULL
                    AND DATE(created_at) = CURDATE()
                    AND (attending_vet IS NULL OR attending_vet <> '')
            ");
            $stmt->execute();
            $stats['patientsToday'] = (int) $stmt->fetchColumn();

            $stats['surgeriesPerformed'] = (int) $pdo->query("SELECT COUNT(*) FROM patient_visit_records WHERE LOWER(category) LIKE '%surgery%'")->fetchColumn();

            if (function_exists('bv_table_exists') && bv_table_exists($pdo, 'reviews')) {
                $stmt = $pdo->prepare('SELECT ROUND(AVG(rating), 1) FROM reviews WHERE veterinarian_id = :id');
                $stmt->execute([':id' => $userId]);
                $rating = $stmt->fetchColumn();
                if ($rating) $stats['satisfactionRate'] = (string) $rating;
            }
        }
    } catch (Throwable $e) {
        return $stats;
    }

    return $stats;
}

function getProfile($pdo, $userId)
{
    if ($userId <= 0) respond(422, ['success' => false, 'message' => 'User id is required.']);

    $stmt = $pdo->prepare("
        SELECT users.id, users.full_name, users.email, users.phone_number, users.profile_photo,
               users.education, users.specialization,
               roles.name AS role_name, users.created_at
        FROM users
        LEFT JOIN roles ON roles.id = users.role_id
        WHERE users.id = :id
        LIMIT 1
    ");
    $stmt->execute([':id' => $userId]);
    $user = $stmt->fetch();
    if (!$user) respond(404, ['success' => false, 'message' => 'User profile not found.']);

    $prefsStmt = $pdo->prepare('SELECT * FROM user_notification_preferences WHERE user_id = :id LIMIT 1');
    $prefsStmt->execute([':id' => $userId]);
    $prefs = $prefsStmt->fetch();
    if (!$prefs) {
        $pdo->prepare('INSERT INTO user_notification_preferences (user_id) VALUES (:id)')->execute([':id' => $userId]);
        $prefs = ['lost_found_alerts' => 1, 'appointment_reminders' => 1, 'chatbot_updates' => 0];
    }

    respond(200, [
        'success' => true,
        'data' => [
            'id' => (int) $user['id'],
            'fullName' => $user['full_name'],
            'email' => $user['email'],
            'phone' => $user['phone_number'],
            'education' => $user['education'],
            'specialization' => $user['specialization'],
            'role' => $user['role_name'],
            'roleLabel' => roleLabel($user['role_name']),
            'avatarUrl' => $user['profile_photo'] ?: '',
            'memberSince' => substr((string) $user['created_at'], 0, 4),
            'stats' => profileStats($pdo, $userId, $user['role_name']),
            'notifications' => [
                'lostFoundAlerts' => (bool) $prefs['lost_found_alerts'],
                'appointmentReminders' => (bool) $prefs['appointment_reminders'],
                'chatbotUpdates' => (bool) $prefs['chatbot_updates'],
            ],
        ],
    ]);
}

function updateProfile($pdo, $data)
{
    $userId = (int) ($data['user_id'] ?? $data['userId'] ?? 0);
    if ($userId <= 0) respond(422, ['success' => false, 'message' => 'User id is required.']);

    $fullName = clean($data['fullName'] ?? $data['full_name'] ?? '');
    $email = clean($data['email'] ?? '');
    $phone = clean($data['phone'] ?? $data['phone_number'] ?? '');
    $education = clean($data['education'] ?? '');
    $specialization = clean($data['specialization'] ?? '');
    if ($fullName === '' || $email === '') {
        respond(422, ['success' => false, 'message' => 'Full name and email are required.']);
    }

    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = :email AND id <> :id LIMIT 1');
    $stmt->execute([':email' => $email, ':id' => $userId]);
    if ($stmt->fetch()) respond(409, ['success' => false, 'message' => 'Email is already used by another account.']);

    $stmt = $pdo->prepare('UPDATE users SET full_name = :name, email = :email, phone_number = :phone, education = :education, specialization = :specialization WHERE id = :id');
    $stmt->execute([':name' => $fullName, ':email' => $email, ':phone' => $phone, ':education' => $education, ':specialization' => $specialization, ':id' => $userId]);

    getProfile($pdo, $userId);
}

function updatePreferences($pdo, $data)
{
    $userId = (int) ($data['user_id'] ?? $data['userId'] ?? 0);
    if ($userId <= 0) respond(422, ['success' => false, 'message' => 'User id is required.']);

    $stmt = $pdo->prepare("
        INSERT INTO user_notification_preferences
            (user_id, lost_found_alerts, appointment_reminders, chatbot_updates)
        VALUES
            (:user_id, :lost_found, :appointments, :chatbot)
        ON DUPLICATE KEY UPDATE
            lost_found_alerts = VALUES(lost_found_alerts),
            appointment_reminders = VALUES(appointment_reminders),
            chatbot_updates = VALUES(chatbot_updates)
    ");
    $stmt->execute([
        ':user_id' => $userId,
        ':lost_found' => !empty($data['lostFoundAlerts']) ? 1 : 0,
        ':appointments' => !empty($data['appointmentReminders']) ? 1 : 0,
        ':chatbot' => !empty($data['chatbotUpdates']) ? 1 : 0,
    ]);

    getProfile($pdo, $userId);
}

function changePassword($pdo, $data)
{
    $userId = (int) ($data['user_id'] ?? $data['userId'] ?? 0);
    $current = (string) ($data['currentPassword'] ?? $data['current_password'] ?? '');
    $next = (string) ($data['newPassword'] ?? $data['new_password'] ?? '');
    if ($userId <= 0 || $current === '' || strlen($next) < 8) {
        respond(422, ['success' => false, 'message' => 'Current password and a new password of at least 8 characters are required.']);
    }

    $stmt = $pdo->prepare('SELECT password_hash FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $userId]);
    $hash = $stmt->fetchColumn();
    if (!$hash || !password_verify($current, $hash)) {
        respond(401, ['success' => false, 'message' => 'Current password is incorrect.']);
    }

    $stmt = $pdo->prepare('UPDATE users SET password_hash = :hash WHERE id = :id');
    $stmt->execute([':hash' => password_hash($next, PASSWORD_DEFAULT), ':id' => $userId]);
    respond(200, ['success' => true, 'message' => 'Password updated.']);
}

$input = inputData();
$action = clean($input['action'] ?? 'get');

try {
    setupProfileTables($pdo);

    if ($action === 'get') getProfile($pdo, (int) ($input['user_id'] ?? $input['userId'] ?? 0));
    if ($action === 'update') updateProfile($pdo, $input);
    if ($action === 'preferences') updatePreferences($pdo, $input);
    if ($action === 'password') changePassword($pdo, $input);

    respond(400, ['success' => false, 'message' => 'Unknown profile action.']);
} catch (PDOException $e) {
    respond(500, ['success' => false, 'message' => 'Profile request failed.', 'error' => $e->getMessage()]);
}

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

function setupProfileTables($pdo)
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS user_notification_preferences (
            user_id INT PRIMARY KEY,
            lost_found_alerts TINYINT(1) NOT NULL DEFAULT 1,
            appointment_reminders TINYINT(1) NOT NULL DEFAULT 1,
            chatbot_updates TINYINT(1) NOT NULL DEFAULT 0,
            quiet_hours_enabled TINYINT(1) NOT NULL DEFAULT 0,
            quiet_hours_start TIME NOT NULL DEFAULT '22:00:00',
            quiet_hours_end TIME NOT NULL DEFAULT '07:00:00',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    // Installs that already had this table from before quiet hours existed
    // won't get the new columns from CREATE TABLE IF NOT EXISTS above.
    try {
        $pdo->exec("
            ALTER TABLE user_notification_preferences
                ADD COLUMN quiet_hours_enabled TINYINT(1) NOT NULL DEFAULT 0,
                ADD COLUMN quiet_hours_start TIME NOT NULL DEFAULT '22:00:00',
                ADD COLUMN quiet_hours_end TIME NOT NULL DEFAULT '07:00:00'
        ");
    } catch (PDOException $e) {
        // Columns already exist — nothing to do.
    }
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
               veterinarian_profiles.education, veterinarian_profiles.specialization,
               roles.name AS role_name, users.created_at
        FROM users
        LEFT JOIN roles ON roles.id = users.role_id
        LEFT JOIN veterinarian_profiles ON veterinarian_profiles.user_id = users.id
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
        $prefs = [
            'lost_found_alerts' => 1,
            'appointment_reminders' => 1,
            'chatbot_updates' => 0,
            'quiet_hours_enabled' => 0,
            'quiet_hours_start' => '22:00:00',
            'quiet_hours_end' => '07:00:00',
        ];
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
                'quietHoursEnabled' => (bool) $prefs['quiet_hours_enabled'],
                'quietHoursStart' => substr((string) $prefs['quiet_hours_start'], 0, 5),
                'quietHoursEnd' => substr((string) $prefs['quiet_hours_end'], 0, 5),
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

    $stmt = $pdo->prepare('UPDATE users SET full_name = :name, email = :email, phone_number = :phone WHERE id = :id');
    $stmt->execute([':name' => $fullName, ':email' => $email, ':phone' => $phone, ':id' => $userId]);

    $stmt = $pdo->prepare('SELECT id FROM veterinarian_profiles WHERE user_id = :id LIMIT 1');
    $stmt->execute([':id' => $userId]);
    if ($stmt->fetch()) {
        $stmt = $pdo->prepare('UPDATE veterinarian_profiles SET education = :education, specialization = :specialization WHERE user_id = :id');
        $stmt->execute([':education' => $education, ':specialization' => $specialization, ':id' => $userId]);
    }

    getProfile($pdo, $userId);
}

function normalizeQuietTime($value)
{
    $value = trim((string) ($value ?? ''));
    if (!preg_match('/^([01]\d|2[0-3]):([0-5]\d)$/', $value)) return null;
    return $value . ':00';
}

/**
 * Each dashboard's notification form (owner channel checkboxes, owner quiet
 * hours modal, vet/admin toggle list) submits only the fields it owns.
 * Columns not present in $data fall back to the row's current value instead
 * of a hardcoded default, so e.g. saving Quiet Hours doesn't reset the
 * category checkboxes and vice versa.
 */
function updatePreferences($pdo, $data)
{
    $userId = (int) ($data['user_id'] ?? $data['userId'] ?? 0);
    if ($userId <= 0) respond(422, ['success' => false, 'message' => 'User id is required.']);

    $existingStmt = $pdo->prepare('SELECT * FROM user_notification_preferences WHERE user_id = :id LIMIT 1');
    $existingStmt->execute([':id' => $userId]);
    $existing = $existingStmt->fetch() ?: [
        'lost_found_alerts' => 1,
        'appointment_reminders' => 1,
        'chatbot_updates' => 0,
        'quiet_hours_enabled' => 0,
        'quiet_hours_start' => '22:00:00',
        'quiet_hours_end' => '07:00:00',
    ];

    $lostFound = array_key_exists('lostFoundAlerts', $data) ? !empty($data['lostFoundAlerts']) : (bool) $existing['lost_found_alerts'];
    $appointments = array_key_exists('appointmentReminders', $data) ? !empty($data['appointmentReminders']) : (bool) $existing['appointment_reminders'];
    $chatbot = array_key_exists('chatbotUpdates', $data) ? !empty($data['chatbotUpdates']) : (bool) $existing['chatbot_updates'];
    $quietEnabled = array_key_exists('quietHoursEnabled', $data) ? !empty($data['quietHoursEnabled']) : (bool) $existing['quiet_hours_enabled'];
    $quietStart = normalizeQuietTime($data['quietHoursStart'] ?? null) ?? $existing['quiet_hours_start'];
    $quietEnd = normalizeQuietTime($data['quietHoursEnd'] ?? null) ?? $existing['quiet_hours_end'];

    $stmt = $pdo->prepare("
        INSERT INTO user_notification_preferences
            (user_id, lost_found_alerts, appointment_reminders, chatbot_updates, quiet_hours_enabled, quiet_hours_start, quiet_hours_end)
        VALUES
            (:user_id, :lost_found, :appointments, :chatbot, :quiet_enabled, :quiet_start, :quiet_end)
        ON DUPLICATE KEY UPDATE
            lost_found_alerts = VALUES(lost_found_alerts),
            appointment_reminders = VALUES(appointment_reminders),
            chatbot_updates = VALUES(chatbot_updates),
            quiet_hours_enabled = VALUES(quiet_hours_enabled),
            quiet_hours_start = VALUES(quiet_hours_start),
            quiet_hours_end = VALUES(quiet_hours_end)
    ");
    $stmt->execute([
        ':user_id' => $userId,
        ':lost_found' => $lostFound ? 1 : 0,
        ':appointments' => $appointments ? 1 : 0,
        ':chatbot' => $chatbot ? 1 : 0,
        ':quiet_enabled' => $quietEnabled ? 1 : 0,
        ':quiet_start' => $quietStart,
        ':quiet_end' => $quietEnd,
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

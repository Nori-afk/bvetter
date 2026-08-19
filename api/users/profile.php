<?php

header('Content-Type: application/json');

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/security_settings.php';
require_once __DIR__ . '/../config/two_factor.php';
require_once __DIR__ . '/../config/input_validation.php';
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
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        // Columns already exist — nothing to do.
    }

    ensureUserTwoFactorColumn($pdo);
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
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        return $stats;
    }

    return $stats;
}

function getProfile($pdo, $userId)
{
    if ($userId <= 0) respond(422, ['success' => false, 'message' => 'User id is required.']);

    $stmt = $pdo->prepare("
        SELECT users.id, users.full_name, users.email, users.phone_number, users.profile_photo,
               users.two_factor_enabled,
               veterinarian_profiles.education, veterinarian_profiles.specialization, veterinarian_profiles.bio,
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
            'bio' => $user['bio'],
            'role' => $user['role_name'],
            'roleLabel' => roleLabel($user['role_name']),
            'avatarUrl' => $user['profile_photo'] ?: '',
            'twoFactorEnabled' => (bool) $user['two_factor_enabled'],
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
    $bio = clean($data['bio'] ?? '');
    if ($fullName === '' || $email === '') {
        respond(422, ['success' => false, 'message' => 'Full name and email are required.']);
    }

    $fieldError = firstIdentityFieldError([
        [$fullName,       'Full name', 150, 2],
        [$email,          'Email address', 190, 5],
        [$phone,          'Phone number', 30, 0],
        [$education,      'Education', 200, 0],
        [$specialization, 'Specialization', 200, 0],
    ]);
    if ($fieldError !== null) {
        respond(422, ['success' => false, 'message' => $fieldError]);
    }

    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = :email AND id <> :id LIMIT 1');
    $stmt->execute([':email' => $email, ':id' => $userId]);
    if ($stmt->fetch()) respond(409, ['success' => false, 'message' => 'Email is already used by another account.']);

    $stmt = $pdo->prepare('UPDATE users SET full_name = :name, email = :email, phone_number = :phone WHERE id = :id');
    $stmt->execute([':name' => $fullName, ':email' => $email, ':phone' => $phone, ':id' => $userId]);

    $stmt = $pdo->prepare('SELECT id FROM veterinarian_profiles WHERE user_id = :id LIMIT 1');
    $stmt->execute([':id' => $userId]);
    if ($stmt->fetch()) {
        $stmt = $pdo->prepare('UPDATE veterinarian_profiles SET education = :education, specialization = :specialization, bio = :bio WHERE user_id = :id');
        $stmt->execute([':education' => $education, ':specialization' => $specialization, ':bio' => $bio, ':id' => $userId]);
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

/**
 * Opts an account into (or out of) its own email-OTP 2FA challenge at login
 * — see requiresTwoFactor in api/auth/login.php for where this is enforced.
 */
function setTwoFactor($pdo, $data)
{
    $userId = (int) ($data['user_id'] ?? $data['userId'] ?? 0);
    if ($userId <= 0) respond(422, ['success' => false, 'message' => 'User id is required.']);

    $enabled = !empty($data['enabled']) ? 1 : 0;
    $pdo->prepare('UPDATE users SET two_factor_enabled = :enabled WHERE id = :id')
        ->execute([':enabled' => $enabled, ':id' => $userId]);

    getProfile($pdo, $userId);
}

function changePassword($pdo, $data)
{
    $userId = (int) ($data['user_id'] ?? $data['userId'] ?? 0);
    $current = (string) ($data['currentPassword'] ?? $data['current_password'] ?? '');
    $next = (string) ($data['newPassword'] ?? $data['new_password'] ?? '');
    if ($userId <= 0 || $current === '' || $next === '') {
        respond(422, ['success' => false, 'message' => 'Current password and a new password are required.']);
    }

    $owner = $pdo->prepare('SELECT full_name, email FROM users WHERE id = :id LIMIT 1');
    $owner->execute([':id' => $userId]);
    $ownerRow = $owner->fetch() ?: [];

    $policyError = passwordPolicyError($pdo, $next, [
        'name'  => $ownerRow['full_name'] ?? '',
        'email' => $ownerRow['email'] ?? '',
    ]);
    if ($policyError !== null) {
        respond(422, ['success' => false, 'message' => $policyError]);
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

/**
 * blocked_reason gained 'user_request' in
 * database/migrations/2026-08-19-deactivate-reason.sql. Self-heal it here so a
 * deploy that ships this code before the migration cannot write a value the
 * column rejects -- the same failure mode that broke production on 2026-08-18,
 * when notification code went out ahead of its schema change.
 *
 * Widening an enum rewrites no rows, so this is safe to run repeatedly.
 */
function ensureDeactivationReason(PDO $pdo): void
{
    $column = $pdo->query("SHOW COLUMNS FROM users LIKE 'blocked_reason'")->fetch();
    if (!$column || strpos($column['Type'], 'user_request') !== false) {
        return;
    }

    try {
        $pdo->exec("ALTER TABLE users
            MODIFY blocked_reason ENUM('failed_login', 'inactivity', 'user_request') NULL DEFAULT NULL");
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
    }
}

/**
 * Self-service deactivation.
 *
 * This DEACTIVATES, it does not delete. account_status='blocked' is the same
 * mechanism the 3-strike lockout and the 365-day inactivity sweep already use,
 * so an admin restores it exactly the way they restore those --
 * updateAccountStatus() in api/admin/account-management.php already clears
 * blocked_reason and resets the failed-login counter. Nothing is destroyed and
 * nothing here is irreversible.
 *
 * Deletion is deliberately NOT offered from this button. The privacy policy
 * routes it through contacting the vet office, it requires the de-identify
 * cascade over pets and visit records, and it would fail today for any owner
 * registered in the castration/spay programme (csp_registrations has foreign
 * keys to both pets and users with no ON DELETE, and deleteUser() never clears
 * them).
 */
function deactivateAccount(PDO $pdo, int $userId): void
{
    if ($userId <= 0) respond(422, ['success' => false, 'message' => 'User id is required.']);

    ensureDeactivationReason($pdo);

    $pdo->beginTransaction();

    $pdo->prepare("
        UPDATE users
        SET account_status = 'blocked',
            blocked_reason = 'user_request'
        WHERE id = :id
    ")->execute([':id' => $userId]);

    // Cut every signed-in device immediately, not just the tab that clicked the
    // button -- otherwise a session on another device keeps working against an
    // account its owner has just closed.
    $pdo->prepare("
        UPDATE user_sessions
        SET revoked_at = NOW()
        WHERE user_id = :id AND revoked_at IS NULL
    ")->execute([':id' => $userId]);

    $pdo->commit();

    respond(200, [
        'success' => true,
        'message' => 'Your account has been deactivated. Contact the Baliwag City Veterinary Office if you want it reopened.'
    ]);
}

$input = inputData();
$action = clean($input['action'] ?? 'get');

// Every action in this file operates on the caller's OWN account. Until now the
// client sent user_id and the server simply believed it, with no token checked
// anywhere in this file -- so an unauthenticated POST could read any account's
// name/email/phone, change any account's email, or switch off any account's
// two-factor. Chained, that is account takeover: repoint the email, disable 2FA,
// then use password reset.
//
// The bearer token is now the only source of identity. Any user_id/userId in the
// request body is overwritten below and can no longer influence which row is
// touched. Kept as an overwrite rather than deleting the parameter so the four
// helpers below keep their existing signatures.
$authSession = requireRole($pdo, ['pet_owner', 'veterinarian', 'admin']);
$authUserId  = (int) $authSession['user_id'];
$input['user_id'] = $authUserId;
$input['userId']  = $authUserId;

try {
    setupProfileTables($pdo);

    if ($action === 'get') getProfile($pdo, $authUserId);
    if ($action === 'update') updateProfile($pdo, $input);
    if ($action === 'preferences') updatePreferences($pdo, $input);
    if ($action === 'password') changePassword($pdo, $input);
    if ($action === 'two_factor') setTwoFactor($pdo, $input);
    if ($action === 'deactivate') deactivateAccount($pdo, $authUserId);

    respond(400, ['success' => false, 'message' => 'Unknown profile action.']);
} catch (PDOException $e) {
    error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
    respond(500, ['success' => false, 'message' => 'Profile request failed.']);
}

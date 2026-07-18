<?php

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit;
}

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/mailer.php';
require_once __DIR__ . '/../config/notifications.php';

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

function normalizeSex($value)
{
    $value = strtolower(clean($value));
    return $value === 'female' ? 'female' : 'male';
}

/* ── Idempotent schema setup (mirrors mass-vaccination/events.php) ── */
function setupCspTables($pdo)
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS csp_programs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(150) NOT NULL DEFAULT 'Municipal Castration & Spay Program',
            program_date DATE NULL,
            time_slot VARCHAR(50) NULL,
            venue VARCHAR(150) NULL,
            capacity INT NULL,
            status ENUM('planning','open','scheduled','completed','cancelled') NOT NULL DEFAULT 'planning',
            created_by_user_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_csp_prog_status (status),
            INDEX idx_csp_prog_date (program_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS csp_registrations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            program_id INT NULL,
            owner_id INT NOT NULL,
            pet_id INT NOT NULL,
            status ENUM('pending_schedule','scheduled','completed','cancelled') NOT NULL DEFAULT 'pending_schedule',
            queue_number INT NULL,
            notes TEXT NULL,
            registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            assigned_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_csp_reg_program (program_id),
            INDEX idx_csp_reg_owner (owner_id),
            INDEX idx_csp_reg_status (status),
            CONSTRAINT fk_csp_reg_program FOREIGN KEY (program_id) REFERENCES csp_programs(id),
            CONSTRAINT fk_csp_reg_owner FOREIGN KEY (owner_id) REFERENCES users(id),
            CONSTRAINT fk_csp_reg_pet FOREIGN KEY (pet_id) REFERENCES pets(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    // Seed the "Castration & Spay" visit type as a protected default, if visit_types exists and doesn't have it yet.
    try {
        $exists = $pdo->prepare('SELECT id FROM visit_types WHERE name = :name LIMIT 1');
        $exists->execute([':name' => 'Castration & Spay']);
        if (!$exists->fetch()) {
            $pdo->prepare('INSERT INTO visit_types (name, is_default, is_active) VALUES (:name, 1, 1)')
                ->execute([':name' => 'Castration & Spay']);
        }
    } catch (PDOException $e) {
        // visit_types may not exist yet in older schemas — CSP registration itself doesn't depend on it.
    }
}

/* ── Owner/pet lookup-or-create, same shape as appointments/appointment.php ── */
function findOrCreateOwner($pdo, $data)
{
    $ownerId = (int) ($data['owner_id'] ?? 0);
    if ($ownerId > 0) return $ownerId;

    $email = clean($data['owner_email'] ?? '');
    if ($email !== '') {
        $stmt = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
        $stmt->execute([':email' => $email]);
        $existing = $stmt->fetch();
        if ($existing) return (int) $existing['id'];
    }

    $fullName = clean($data['owner_name'] ?? '');
    $phone = clean($data['owner_contact'] ?? '');
    $barangayId = (int) ($data['owner_barangay_id'] ?? 0);
    $address = clean($data['owner_address'] ?? '');

    if ($fullName === '' || $email === '' || $phone === '') {
        respond(422, ['success' => false, 'message' => 'Owner name, email, and contact number are required.']);
    }

    $roleStmt = $pdo->prepare('SELECT id FROM roles WHERE name = :name LIMIT 1');
    $roleStmt->execute([':name' => 'pet_owner']);
    $role = $roleStmt->fetch();
    $roleId = $role ? (int) $role['id'] : 0;
    if ($roleId <= 0) {
        respond(500, ['success' => false, 'message' => 'Pet owner role is missing from roles table.']);
    }

    $tempPassword = password_hash(bin2hex(random_bytes(8)), PASSWORD_DEFAULT);
    $insertUser = $pdo->prepare('
        INSERT INTO users (role_id, full_name, email, password_hash, phone_number, account_status)
        VALUES (:role_id, :full_name, :email, :password_hash, :phone_number, :account_status)
    ');
    $insertUser->execute([
        ':role_id' => $roleId,
        ':full_name' => $fullName,
        ':email' => $email,
        ':password_hash' => $tempPassword,
        ':phone_number' => $phone,
        ':account_status' => 'active',
    ]);

    $ownerId = (int) $pdo->lastInsertId();

    if ($barangayId > 0) {
        $insertProfile = $pdo->prepare('
            INSERT INTO owner_profiles (user_id, barangay_id, complete_address, verification_status, verified_at)
            VALUES (:user_id, :barangay_id, :complete_address, :verification_status, NOW())
        ');
        $insertProfile->execute([
            ':user_id' => $ownerId,
            ':barangay_id' => $barangayId,
            ':complete_address' => $address !== '' ? $address : 'N/A',
            ':verification_status' => 'approved',
        ]);
    }

    return $ownerId;
}

function findOrCreatePet($pdo, $ownerId, $data)
{
    $petId = (int) ($data['pet_id'] ?? 0);
    if ($petId > 0) return $petId;

    $petName = clean($data['pet_name'] ?? '');
    $species = clean($data['species'] ?? $data['pet_type'] ?? '');

    if ($petName === '' || $species === '') {
        respond(422, ['success' => false, 'message' => 'Pet name and pet type are required.']);
    }

    $stmt = $pdo->prepare('SELECT id FROM pets WHERE owner_id = :owner_id AND pet_name = :pet_name LIMIT 1');
    $stmt->execute([':owner_id' => $ownerId, ':pet_name' => $petName]);
    $existing = $stmt->fetch();
    if ($existing) return (int) $existing['id'];

    $insertPet = $pdo->prepare('
        INSERT INTO pets
            (owner_id, pet_name, species, breed, sex, age, weight, size, color_markings, last_vaccination_date, health_status)
        VALUES
            (:owner_id, :pet_name, :species, :breed, :sex, :age, :weight, :size, :color_markings, :last_vaccination_date, :health_status)
    ');

    $vaccDate = clean($data['last_vaccination_date'] ?? $data['pet_vaccination_date'] ?? '');
    $insertPet->execute([
        ':owner_id' => $ownerId,
        ':pet_name' => $petName,
        ':species' => $species,
        ':breed' => clean($data['breed'] ?? $data['pet_breed'] ?? ''),
        ':sex' => normalizeSex($data['sex'] ?? $data['pet_sex'] ?? 'male'),
        ':age' => clean($data['age'] ?? $data['pet_age'] ?? ''),
        ':weight' => clean($data['weight'] ?? ''),
        ':size' => clean($data['size'] ?? ''),
        ':color_markings' => clean($data['color_markings'] ?? ''),
        ':last_vaccination_date' => $vaccDate !== '' ? $vaccDate : null,
        ':health_status' => clean($data['health_status'] ?? ''),
    ]);

    return (int) $pdo->lastInsertId();
}

function getWaitingCount($pdo)
{
    return (int) $pdo->query("SELECT COUNT(*) FROM csp_registrations WHERE status = 'pending_schedule'")->fetchColumn();
}

function formatRegistration($row)
{
    return [
        'id' => (int) $row['id'],
        'program_id' => $row['program_id'] !== null ? (int) $row['program_id'] : null,
        'owner_id' => (int) $row['owner_id'],
        'pet_id' => (int) $row['pet_id'],
        'status' => $row['status'],
        'queue_number' => $row['queue_number'] !== null ? (int) $row['queue_number'] : null,
        'notes' => $row['notes'],
        'registered_at' => $row['registered_at'],
        'assigned_at' => $row['assigned_at'],
        'owner_name' => $row['owner_name'] ?? null,
        'owner_email' => $row['owner_email'] ?? null,
        'owner_phone' => $row['owner_phone'] ?? null,
        'pet_name' => $row['pet_name'] ?? null,
        'species' => $row['species'] ?? null,
        'breed' => $row['breed'] ?? null,
        'program_title' => $row['program_title'] ?? null,
        'program_date' => $row['program_date'] ?? null,
        'time_slot' => $row['time_slot'] ?? null,
        'venue' => $row['venue'] ?? null,
    ];
}

const REGISTRATION_SELECT = "
    SELECT
        csp_registrations.*,
        owners.full_name AS owner_name,
        owners.email AS owner_email,
        owners.phone_number AS owner_phone,
        pets.pet_name, pets.species, pets.breed,
        csp_programs.title AS program_title,
        csp_programs.program_date, csp_programs.time_slot, csp_programs.venue
    FROM csp_registrations
    INNER JOIN users owners ON owners.id = csp_registrations.owner_id
    INNER JOIN pets ON pets.id = csp_registrations.pet_id
    LEFT JOIN csp_programs ON csp_programs.id = csp_registrations.program_id
";

function registerInterest($pdo, $data)
{
    $notes = clean($data['notes'] ?? '');

    $ownerId = findOrCreateOwner($pdo, $data);
    $petId = findOrCreatePet($pdo, $ownerId, $data);

    $dupe = $pdo->prepare("
        SELECT id FROM csp_registrations
        WHERE owner_id = :owner_id AND pet_id = :pet_id AND status IN ('pending_schedule', 'scheduled')
        LIMIT 1
    ");
    $dupe->execute([':owner_id' => $ownerId, ':pet_id' => $petId]);
    if ($dupe->fetch()) {
        respond(409, ['success' => false, 'message' => 'This pet is already registered for the Castration & Spay Program.']);
    }

    $insert = $pdo->prepare('
        INSERT INTO csp_registrations (owner_id, pet_id, status, notes)
        VALUES (:owner_id, :pet_id, :status, :notes)
    ');
    $insert->execute([
        ':owner_id' => $ownerId,
        ':pet_id' => $petId,
        ':status' => 'pending_schedule',
        ':notes' => $notes,
    ]);

    $registrationId = (int) $pdo->lastInsertId();

    $ownerStmt = $pdo->prepare('SELECT full_name FROM users WHERE id = :id LIMIT 1');
    $ownerStmt->execute([':id' => $ownerId]);
    $ownerName = $ownerStmt->fetchColumn() ?: 'A pet owner';
    $petStmt = $pdo->prepare('SELECT pet_name FROM pets WHERE id = :id LIMIT 1');
    $petStmt->execute([':id' => $petId]);
    $petName = $petStmt->fetchColumn() ?: 'a pet';

    notifyStaff(
        $pdo,
        'both',
        'csp_registration',
        'New Castration & Spay Registration',
        "{$ownerName} registered {$petName} for the Municipal Castration & Spay Program.",
        $registrationId,
        true
    );

    respond(201, [
        'success' => true,
        'message' => 'Registration submitted.',
        'registration_id' => $registrationId,
        'owner_id' => $ownerId,
        'waiting_count' => getWaitingCount($pdo),
    ]);
}

function getMyStatus($pdo, $data)
{
    $ownerId = (int) ($data['owner_id'] ?? 0);
    $registration = null;

    if ($ownerId > 0) {
        $stmt = $pdo->prepare(REGISTRATION_SELECT . "
            WHERE csp_registrations.owner_id = :owner_id AND csp_registrations.status IN ('pending_schedule', 'scheduled')
            ORDER BY csp_registrations.created_at DESC
            LIMIT 1
        ");
        $stmt->execute([':owner_id' => $ownerId]);
        $row = $stmt->fetch();
        $registration = $row ? formatRegistration($row) : null;
    }

    $upcoming = $pdo->query("
        SELECT * FROM csp_programs
        WHERE status IN ('open', 'scheduled')
        ORDER BY (program_date IS NULL) ASC, program_date ASC
        LIMIT 1
    ")->fetch();

    respond(200, [
        'success' => true,
        'registration' => $registration,
        'waiting_count' => getWaitingCount($pdo),
        'upcoming_program' => $upcoming ?: null,
    ]);
}

function cancelRegistration($pdo, $data)
{
    $id = (int) ($data['registration_id'] ?? $data['id'] ?? 0);
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid registration id.']);

    $stmt = $pdo->prepare('SELECT status FROM csp_registrations WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $reg = $stmt->fetch();
    if (!$reg) respond(404, ['success' => false, 'message' => 'Registration not found.']);
    if ($reg['status'] === 'completed') {
        respond(422, ['success' => false, 'message' => 'A completed registration cannot be cancelled.']);
    }

    $pdo->prepare("UPDATE csp_registrations SET status = 'cancelled' WHERE id = :id")->execute([':id' => $id]);
    respond(200, ['success' => true, 'message' => 'Registration cancelled.']);
}

function listRegistrations($pdo, $data)
{
    $where = [];
    $params = [];

    $status = clean($data['status'] ?? '');
    if ($status !== '' && $status !== 'all') {
        $where[] = 'csp_registrations.status = :status';
        $params[':status'] = $status;
    }

    $programFilter = clean($data['program_id'] ?? '');
    if ($programFilter === 'unassigned') {
        $where[] = 'csp_registrations.program_id IS NULL';
    } elseif ($programFilter !== '') {
        $where[] = 'csp_registrations.program_id = :program_id';
        $params[':program_id'] = (int) $programFilter;
    }

    $sql = REGISTRATION_SELECT;
    if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
    $sql .= ' ORDER BY csp_registrations.queue_number ASC, csp_registrations.registered_at ASC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    respond(200, ['success' => true, 'data' => array_map('formatRegistration', $stmt->fetchAll())]);
}

function listPrograms($pdo)
{
    $rows = $pdo->query("
        SELECT csp_programs.*,
            (SELECT COUNT(*) FROM csp_registrations WHERE csp_registrations.program_id = csp_programs.id AND csp_registrations.status = 'scheduled') AS assigned_count
        FROM csp_programs
        ORDER BY (program_date IS NULL) ASC, program_date ASC, created_at DESC
    ")->fetchAll();

    $data = array_map(function ($row) {
        $row['id'] = (int) $row['id'];
        $row['capacity'] = $row['capacity'] !== null ? (int) $row['capacity'] : null;
        $row['assigned_count'] = (int) $row['assigned_count'];
        return $row;
    }, $rows);

    respond(200, ['success' => true, 'data' => $data]);
}

function createProgram($pdo, $data)
{
    $title = clean($data['title'] ?? '') ?: 'Municipal Castration & Spay Program';
    $capacity = (int) ($data['capacity'] ?? 0);
    if ($capacity <= 0) {
        respond(422, ['success' => false, 'message' => 'A capacity greater than zero is required.']);
    }

    $date = clean($data['program_date'] ?? '');
    $timeSlot = clean($data['time_slot'] ?? '');
    $venue = clean($data['venue'] ?? '');

    $allowedStatuses = ['planning', 'open', 'scheduled', 'completed', 'cancelled'];
    $status = in_array($data['status'] ?? '', $allowedStatuses, true) ? $data['status'] : 'planning';

    if ($date !== '' && (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || strtotime($date) === false)) {
        respond(422, ['success' => false, 'message' => 'A valid program date is required.']);
    }
    if ($date !== '' && strtotime($date) < strtotime(date('Y-m-d'))) {
        respond(422, ['success' => false, 'message' => 'Cannot schedule a program on a past date.']);
    }
    if ($status === 'scheduled' && ($date === '' || $venue === '')) {
        respond(422, ['success' => false, 'message' => 'A program date and venue are required before marking it Scheduled.']);
    }

    $insert = $pdo->prepare('
        INSERT INTO csp_programs (title, program_date, time_slot, venue, capacity, created_by_user_id, status)
        VALUES (:title, :program_date, :time_slot, :venue, :capacity, :created_by_user_id, :status)
    ');
    $insert->execute([
        ':title' => $title,
        ':program_date' => $date !== '' ? $date : null,
        ':time_slot' => $timeSlot !== '' ? $timeSlot : null,
        ':venue' => $venue !== '' ? $venue : null,
        ':capacity' => $capacity,
        ':created_by_user_id' => (int) ($data['created_by_user_id'] ?? $data['user_id'] ?? 0) ?: null,
        ':status' => $status,
    ]);

    respond(201, ['success' => true, 'message' => 'Program created.', 'program_id' => (int) $pdo->lastInsertId()]);
}

function updateProgram($pdo, $data)
{
    $id = (int) ($data['program_id'] ?? $data['id'] ?? 0);
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid program id.']);

    $stmt = $pdo->prepare('SELECT * FROM csp_programs WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $program = $stmt->fetch();
    if (!$program) respond(404, ['success' => false, 'message' => 'Program not found.']);

    $title = array_key_exists('title', $data) ? (clean($data['title']) ?: $program['title']) : $program['title'];
    $date = array_key_exists('program_date', $data) ? clean($data['program_date']) : $program['program_date'];
    $timeSlot = array_key_exists('time_slot', $data) ? clean($data['time_slot']) : $program['time_slot'];
    $venue = array_key_exists('venue', $data) ? clean($data['venue']) : $program['venue'];
    $capacity = array_key_exists('capacity', $data) && clean($data['capacity']) !== '' ? (int) $data['capacity'] : $program['capacity'];
    $status = array_key_exists('status', $data) ? clean($data['status']) : $program['status'];

    $allowedStatuses = ['planning', 'open', 'scheduled', 'completed', 'cancelled'];
    if (!in_array($status, $allowedStatuses, true)) $status = $program['status'];

    if ($date !== '' && $date !== null && (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || strtotime($date) === false)) {
        respond(422, ['success' => false, 'message' => 'A valid program date is required.']);
    }
    if ($date && strtotime($date) < strtotime(date('Y-m-d')) && $status !== 'completed') {
        respond(422, ['success' => false, 'message' => 'Cannot schedule a program on a past date.']);
    }
    if ($status === 'scheduled' && ($date === '' || $date === null || $venue === '' || $venue === null)) {
        respond(422, ['success' => false, 'message' => 'A program date and venue are required before marking it Scheduled.']);
    }

    $update = $pdo->prepare('
        UPDATE csp_programs
        SET title = :title, program_date = :program_date, time_slot = :time_slot,
            venue = :venue, capacity = :capacity, status = :status
        WHERE id = :id
    ');
    $update->execute([
        ':title' => $title,
        ':program_date' => $date !== '' ? $date : null,
        ':time_slot' => $timeSlot !== '' ? $timeSlot : null,
        ':venue' => $venue !== '' ? $venue : null,
        ':capacity' => $capacity,
        ':status' => $status,
        ':id' => $id,
    ]);

    if (in_array($status, ['completed', 'cancelled'], true)) {
        $pdo->prepare("UPDATE csp_registrations SET status = :status WHERE program_id = :program_id AND status = 'scheduled'")
            ->execute([':status' => $status, ':program_id' => $id]);
    }

    respond(200, ['success' => true, 'message' => 'Program updated.']);
}

function assignRegistrations($pdo, $data)
{
    $programId = (int) ($data['program_id'] ?? 0);
    $ids = $data['registration_ids'] ?? [];
    if (is_string($ids)) {
        $decoded = json_decode($ids, true);
        $ids = is_array($decoded) ? $decoded : array_filter(explode(',', $ids));
    }
    $ids = array_values(array_unique(array_map('intval', (array) $ids)));

    if ($programId <= 0 || !$ids) {
        respond(422, ['success' => false, 'message' => 'A program and at least one registration are required.']);
    }

    $stmt = $pdo->prepare('SELECT * FROM csp_programs WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $programId]);
    $program = $stmt->fetch();
    if (!$program) respond(404, ['success' => false, 'message' => 'Program not found.']);

    $countStmt = $pdo->prepare("SELECT COUNT(*), COALESCE(MAX(queue_number), 0) FROM csp_registrations WHERE program_id = :id AND status = 'scheduled'");
    $countStmt->execute([':id' => $programId]);
    [$assignedCount, $maxQueue] = $countStmt->fetch(PDO::FETCH_NUM);
    $assignedCount = (int) $assignedCount;
    $maxQueue = (int) $maxQueue;

    $capacity = $program['capacity'] !== null ? (int) $program['capacity'] : null;
    $availableSlots = $capacity !== null ? max(0, $capacity - $assignedCount) : count($ids);

    $toAssign = array_slice($ids, 0, $availableSlots);
    $overflow = array_slice($ids, $availableSlots);

    $pdo->beginTransaction();
    $queue = $maxQueue;
    foreach ($toAssign as $regId) {
        $queue++;
        $pdo->prepare("
            UPDATE csp_registrations
            SET program_id = :program_id, status = 'scheduled', assigned_at = NOW(), queue_number = :queue_number
            WHERE id = :id AND status = 'pending_schedule'
        ")->execute([':program_id' => $programId, ':queue_number' => $queue, ':id' => $regId]);
    }
    $pdo->commit();

    respond(200, [
        'success' => true,
        'message' => count($overflow)
            ? 'Assigned ' . count($toAssign) . ' registration(s); ' . count($overflow) . " couldn't fit within capacity."
            : 'Assigned ' . count($toAssign) . ' registration(s).',
        'assigned' => $toAssign,
        'overflow' => $overflow,
    ]);
}

function unassignRegistration($pdo, $data)
{
    $id = (int) ($data['registration_id'] ?? $data['id'] ?? 0);
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid registration id.']);

    $stmt = $pdo->prepare('
        SELECT csp_registrations.id, csp_programs.status AS program_status
        FROM csp_registrations
        LEFT JOIN csp_programs ON csp_programs.id = csp_registrations.program_id
        WHERE csp_registrations.id = :id
        LIMIT 1
    ');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    if (!$row) respond(404, ['success' => false, 'message' => 'Registration not found.']);
    if (in_array($row['program_status'], ['scheduled', 'completed'], true)) {
        respond(422, ['success' => false, 'message' => 'Cannot unassign — notifications may already have gone out for this program.']);
    }

    $pdo->prepare("
        UPDATE csp_registrations
        SET program_id = NULL, status = 'pending_schedule', assigned_at = NULL, queue_number = NULL
        WHERE id = :id
    ")->execute([':id' => $id]);

    respond(200, ['success' => true, 'message' => 'Registration moved back to the waiting list.']);
}

function notifyProgram($pdo, $data)
{
    $programId = (int) ($data['program_id'] ?? 0);
    if ($programId <= 0) respond(422, ['success' => false, 'message' => 'Invalid program id.']);

    $stmt = $pdo->prepare('SELECT * FROM csp_programs WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $programId]);
    $program = $stmt->fetch();
    if (!$program) respond(404, ['success' => false, 'message' => 'Program not found.']);

    $regStmt = $pdo->prepare("
        SELECT csp_registrations.id, csp_registrations.queue_number,
               owners.id AS owner_id, owners.full_name AS owner_name, owners.email AS owner_email,
               pets.pet_name
        FROM csp_registrations
        INNER JOIN users owners ON owners.id = csp_registrations.owner_id
        INNER JOIN pets ON pets.id = csp_registrations.pet_id
        WHERE csp_registrations.program_id = :program_id AND csp_registrations.status = 'scheduled'
    ");
    $regStmt->execute([':program_id' => $programId]);
    $registrations = $regStmt->fetchAll();

    $sent = 0;
    foreach ($registrations as $reg) {
        if (!$reg['owner_email']) continue;
        if (!userWantsNotification($pdo, (int) $reg['owner_id'], 'appointment_reminders')) continue;

        $dateLabel = $program['program_date'] ? date('F j, Y', strtotime($program['program_date'])) : 'To be announced';
        $subject = 'VBetter – Castration & Spay Program Scheduled';
        $body = notificationEmailWrapper(
            'Castration & Spay Program Scheduled',
            "<p>Hi {$reg['owner_name']}, {$reg['pet_name']} has been assigned to the <strong>{$program['title']}</strong>.</p>
             <p><strong>Date:</strong> {$dateLabel}<br>
                <strong>Time:</strong> " . ($program['time_slot'] ?: 'TBA') . "<br>
                <strong>Venue:</strong> " . ($program['venue'] ?: 'TBA') . "<br>
                <strong>Queue Number:</strong> {$reg['queue_number']}</p>",
            null,
            ['label' => 'View', 'url' => APP_URL . '/public/pages/book-appointment.html']
        );

        if (sendAppMail($reg['owner_email'], clean($reg['owner_name'] ?? ''), $subject, $body)) $sent++;
    }

    respond(200, ['success' => true, 'message' => "Sent {$sent} of " . count($registrations) . ' notification(s).']);
}

function dashboardStats($pdo)
{
    $waiting = getWaitingCount($pdo);

    $upcoming = $pdo->query("
        SELECT * FROM csp_programs
        WHERE status IN ('planning', 'open', 'scheduled')
        ORDER BY (program_date IS NULL) ASC, program_date ASC, created_at DESC
        LIMIT 1
    ")->fetch();

    $assignedPets = 0;
    if ($upcoming) {
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM csp_registrations WHERE program_id = :id AND status = 'scheduled'");
        $stmt->execute([':id' => $upcoming['id']]);
        $assignedPets = (int) $stmt->fetchColumn();
    }

    respond(200, [
        'success' => true,
        'data' => [
            'total_waiting' => $waiting,
            'upcoming_program' => $upcoming ?: null,
            'capacity' => $upcoming && $upcoming['capacity'] !== null ? (int) $upcoming['capacity'] : null,
            'assigned_pets' => $assignedPets,
            'unassigned_pets' => $waiting,
        ],
    ]);
}

$input = inputData();
$action = clean($input['action'] ?? 'list_registrations');

try {
    setupCspTables($pdo);

    if ($action === 'register') registerInterest($pdo, $input);
    if ($action === 'my_status') getMyStatus($pdo, $input);
    if ($action === 'cancel') cancelRegistration($pdo, $input);
    if ($action === 'list_registrations') listRegistrations($pdo, $input);
    if ($action === 'list_programs') listPrograms($pdo);
    if ($action === 'create_program') createProgram($pdo, $input);
    if ($action === 'update_program') updateProgram($pdo, $input);
    if ($action === 'assign_registrations') assignRegistrations($pdo, $input);
    if ($action === 'unassign') unassignRegistration($pdo, $input);
    if ($action === 'notify_program') notifyProgram($pdo, $input);
    if ($action === 'dashboard_stats') dashboardStats($pdo);

    respond(400, ['success' => false, 'message' => 'Unknown castration & spay program action.']);
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    respond(500, ['success' => false, 'message' => 'Castration & Spay program request failed.', 'error' => $e->getMessage()]);
}

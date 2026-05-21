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

function normalizeSex($value)
{
    $value = strtolower(clean($value));
    return $value === 'female' ? 'female' : 'male';
}

function normalizeStatus($status)
{
    $status = strtolower(clean($status));
    $allowed = ['pending', 'confirmed', 'completed', 'cancelled', 'rejected'];
    return in_array($status, $allowed, true) ? $status : 'pending';
}

function getRoleId($pdo, $roleName)
{
    $stmt = $pdo->prepare('SELECT id FROM roles WHERE name = :name LIMIT 1');
    $stmt->execute([':name' => $roleName]);
    $role = $stmt->fetch();
    return $role ? (int) $role['id'] : 0;
}

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
        respond(422, [
            'success' => false,
            'message' => 'Owner name, email, and contact number are required.'
        ]);
    }

    $roleId = getRoleId($pdo, 'pet_owner');
    if ($roleId <= 0) {
        respond(500, [
            'success' => false,
            'message' => 'Pet owner role is missing from roles table.'
        ]);
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
        respond(422, [
            'success' => false,
            'message' => 'Pet name and pet type are required.'
        ]);
    }

    $stmt = $pdo->prepare('
        SELECT id
        FROM pets
        WHERE owner_id = :owner_id AND pet_name = :pet_name
        LIMIT 1
    ');
    $stmt->execute([
        ':owner_id' => $ownerId,
        ':pet_name' => $petName,
    ]);
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

function listAppointments($pdo, $data)
{
    $where = [];
    $params = [];

    $status = clean($data['status'] ?? '');
    if ($status !== '' && $status !== 'all') {
        $where[] = 'appointments.status = :status';
        $params[':status'] = normalizeStatus($status);
    }

    $ownerId = (int) ($data['owner_id'] ?? 0);
    if ($ownerId > 0) {
        $where[] = 'appointments.owner_id = :owner_id';
        $params[':owner_id'] = $ownerId;
    }

    $vetId = (int) ($data['veterinarian_id'] ?? 0);
    if ($vetId > 0) {
        $where[] = 'appointments.veterinarian_id = :veterinarian_id';
        $params[':veterinarian_id'] = $vetId;
    }

    $date = clean($data['date'] ?? '');
    if ($date !== '') {
        $where[] = 'appointments.preferred_date = :preferred_date';
        $params[':preferred_date'] = $date;
    }

   $sql = '
    SELECT
        appointments.id,
        appointments.owner_id,
        appointments.pet_id,
        appointments.veterinarian_id,
        appointments.appointment_type,
        appointments.preferred_date,
        appointments.time_slot,
        appointments.status,
        appointments.description,
        appointments.notes,
        appointments.created_at,
        pets.pet_name,
        pets.species,
        pets.breed,
        pets.sex,
        pets.age,
        owners.full_name AS owner_name,
        owners.email AS owner_email,
        owners.phone_number AS owner_phone,
        vets.full_name AS veterinarian_name,
        reviews.rating AS owner_rating
    FROM appointments
    INNER JOIN pets ON pets.id = appointments.pet_id
    INNER JOIN users owners ON owners.id = appointments.owner_id
    LEFT JOIN users vets ON vets.id = appointments.veterinarian_id
    LEFT JOIN reviews ON reviews.appointment_id = appointments.id
';

    if ($where) {
        $sql .= ' WHERE ' . implode(' AND ', $where);
    }

    $sql .= ' ORDER BY appointments.preferred_date ASC, appointments.time_slot ASC, appointments.created_at DESC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $data = array_map(function ($row) {
        return [
            'id' => (int) $row['id'],
            'datetime' => $row['preferred_date'] . ' ' . $row['time_slot'],
            'patient' => $row['pet_name'],
            'owner' => $row['owner_name'],
            'service' => $row['appointment_type'],
            'status' => $row['status'],
            'type' => $row['appointment_type'],
            'owner_id' => (int) $row['owner_id'],
            'pet_id' => (int) $row['pet_id'],
            'veterinarian_id' => $row['veterinarian_id'] ? (int) $row['veterinarian_id'] : null,
            'veterinarian' => $row['veterinarian_name'],
            'preferred_date' => $row['preferred_date'],
            'time_slot' => $row['time_slot'],
            'notes' => $row['notes'],
            'description' => $row['description'],
            'owner_rating' => $row['owner_rating'] ? (int)$row['owner_rating'] : null,
            'pet' => [
                'name' => $row['pet_name'],
                'species' => $row['species'],
                'breed' => $row['breed'],
                'sex' => $row['sex'],
                'age' => $row['age'],
            ],
            'owner_info' => [
                'name' => $row['owner_name'],
                'email' => $row['owner_email'],
                'phone' => $row['owner_phone'],
            ],
        ];
    }, $rows);

    respond(200, [
        'success' => true,
        'data' => $data
    ]);
}

function createAppointment($pdo, $data)
{
    $appointmentType = clean($data['appointment_type'] ?? $data['visit_type'] ?? '');
    $preferredDate = clean($data['preferred_date'] ?? $data['date'] ?? '');
    $timeSlot = clean($data['time_slot'] ?? $data['time'] ?? '');
    $description = clean($data['description'] ?? '');
    $notes = clean($data['notes'] ?? '');
    $veterinarianId = (int) ($data['veterinarian_id'] ?? 0);

    if ($appointmentType === '' || $preferredDate === '' || $timeSlot === '') {
        respond(422, [
            'success' => false,
            'message' => 'Appointment type, date, and time slot are required.'
        ]);
    }

    $pdo->beginTransaction();

    $ownerId = findOrCreateOwner($pdo, $data);
    $petId = findOrCreatePet($pdo, $ownerId, $data);

    $insert = $pdo->prepare('
        INSERT INTO appointments
            (owner_id, pet_id, veterinarian_id, appointment_type, preferred_date, time_slot, status, description, notes)
        VALUES
            (:owner_id, :pet_id, :veterinarian_id, :appointment_type, :preferred_date, :time_slot, :status, :description, :notes)
    ');

    $insert->execute([
        ':owner_id' => $ownerId,
        ':pet_id' => $petId,
        ':veterinarian_id' => $veterinarianId > 0 ? $veterinarianId : null,
        ':appointment_type' => $appointmentType,
        ':preferred_date' => $preferredDate,
        ':time_slot' => $timeSlot,
        ':status' => 'pending',
        ':description' => $description,
        ':notes' => $notes,
    ]);

    $appointmentId = (int) $pdo->lastInsertId();
    $pdo->commit();

    respond(201, [
        'success' => true,
        'message' => 'Appointment request submitted.',
        'appointment_id' => $appointmentId
    ]);
}

function updateAppointmentStatus($pdo, $data)
{
    $appointmentId = (int) ($data['appointment_id'] ?? $data['id'] ?? 0);
    $status = normalizeStatus($data['status'] ?? '');
    $reviewedBy = (int) ($data['reviewed_by_user_id'] ?? 0);
    $reviewNotes = clean($data['review_notes'] ?? '');

    if ($appointmentId <= 0) {
        respond(422, [
            'success' => false,
            'message' => 'Invalid appointment id.'
        ]);
    }

    $confirmedAtSql = $status === 'confirmed' ? 'NOW()' : 'confirmed_at';
    $cancelledAtSql = in_array($status, ['cancelled', 'rejected'], true) ? 'NOW()' : 'cancelled_at';

    $stmt = $pdo->prepare("
        UPDATE appointments
        SET status = :status,
            reviewed_by_user_id = :reviewed_by_user_id,
            review_notes = :review_notes,
            confirmed_at = $confirmedAtSql,
            cancelled_at = $cancelledAtSql
        WHERE id = :id
    ");

    $stmt->execute([
        ':status' => $status,
        ':reviewed_by_user_id' => $reviewedBy > 0 ? $reviewedBy : null,
        ':review_notes' => $reviewNotes,
        ':id' => $appointmentId,
    ]);

    respond(200, [
        'success' => true,
        'message' => 'Appointment status updated.'
    ]);
}

function deleteAppointment($pdo, $data)
{
    $appointmentId = (int) ($data['appointment_id'] ?? $data['id'] ?? 0);
    if ($appointmentId <= 0) {
        respond(422, [
            'success' => false,
            'message' => 'Invalid appointment id.'
        ]);
    }

    $stmt = $pdo->prepare('DELETE FROM appointments WHERE id = :id');
    $stmt->execute([':id' => $appointmentId]);

    respond(200, [
        'success' => true,
        'message' => 'Appointment deleted.'
    ]);
}

function listVeterinarians($pdo)
{
    $stmt = $pdo->query("
        SELECT users.id, users.full_name, users.email, users.phone_number,
               veterinarian_profiles.position_title,
               veterinarian_profiles.education,
               veterinarian_profiles.specialization,
               veterinarian_profiles.clinic_location
        FROM users
        INNER JOIN roles ON roles.id = users.role_id
        LEFT JOIN veterinarian_profiles ON veterinarian_profiles.user_id = users.id
        WHERE roles.name = 'veterinarian' AND users.account_status = 'active'
        ORDER BY users.full_name ASC
    ");

    respond(200, [
        'success' => true,
        'data' => $stmt->fetchAll()
    ]);
}

function getBookedSlots($pdo, $data)
{
    $date  = clean($data['preferred_date'] ?? $data['date'] ?? '');
    $vetId = (int)($data['veterinarian_id'] ?? 0);

    if ($date === '') {
        respond(422, ['success' => false, 'message' => 'preferred_date is required.']);
    }

    // If a vet is specified, only block slots for that vet.
    // If no vet assigned (NULL), those appointments block ALL vets
    // since the clinic hasn't assigned them yet.
    if ($vetId > 0) {
        $stmt = $pdo->prepare("
            SELECT time_slot FROM appointments
            WHERE preferred_date = :date
              AND status IN ('confirmed', 'completed')
              AND (veterinarian_id = :vet_id OR veterinarian_id IS NULL)
        ");
        $stmt->execute([':date' => $date, ':vet_id' => $vetId]);
    } else {
        $stmt = $pdo->prepare("
            SELECT time_slot FROM appointments
            WHERE preferred_date = :date
              AND status IN ('confirmed', 'completed')
        ");
        $stmt->execute([':date' => $date]);
    }

    respond(200, [
        'success' => true,
        'booked'  => array_column($stmt->fetchAll(), 'time_slot')
    ]);
}
function submitReview($pdo, $data)
{
    $appointmentId = (int)($data['appointment_id'] ?? 0);
    $rating        = (int)($data['rating']         ?? 0);
    $comment       = clean($data['comment']        ?? '');

    if ($appointmentId <= 0 || $rating < 1 || $rating > 5) {
        respond(422, [
            'success' => false,
            'message' => 'Valid appointment_id and rating (1–5) are required.'
        ]);
    }

    // Make sure the appointment is completed before allowing a review
    $stmt = $pdo->prepare("SELECT id, owner_id, veterinarian_id, status FROM appointments WHERE id = :id");
    $stmt->execute([':id' => $appointmentId]);
    $appt = $stmt->fetch();

    if (!$appt) {
        respond(404, ['success' => false, 'message' => 'Appointment not found.']);
    }
    if ($appt['status'] !== 'completed') {
        respond(422, ['success' => false, 'message' => 'Only completed appointments can be reviewed.']);
    }

    // Insert or update (owner can edit their review)
    $stmt = $pdo->prepare("
        INSERT INTO reviews (appointment_id, owner_id, veterinarian_id, rating, comment)
        VALUES (:appointment_id, :owner_id, :vet_id, :rating, :comment)
        ON DUPLICATE KEY UPDATE rating = :rating2, comment = :comment2
    ");
    $stmt->execute([
        ':appointment_id' => $appointmentId,
        ':owner_id'       => $appt['owner_id'],
        ':vet_id'         => $appt['veterinarian_id'],
        ':rating'         => $rating,
        ':comment'        => $comment,
        ':rating2'        => $rating,
        ':comment2'       => $comment,
    ]);

    respond(200, ['success' => true, 'message' => 'Review submitted.']);
}

$input = inputData();
$action = clean($input['action'] ?? 'list');

try {
    if ($action === 'list') listAppointments($pdo, $input);
    if ($action === 'create') createAppointment($pdo, $input);
    if ($action === 'update_status') updateAppointmentStatus($pdo, $input);
    if ($action === 'delete') deleteAppointment($pdo, $input);
    if ($action === 'vets') listVeterinarians($pdo);
    if ($action === 'booked_slots') getBookedSlots($pdo, $input);
    if ($action === 'submit_review') submitReview($pdo, $input);
    if ($action === 'vet_reviews') getVetReviews($pdo, $input);

    respond(400, [
        'success' => false,
        'message' => 'Unknown appointment action.'
    ]);
} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    respond(500, [
        'success' => false,
        'message' => 'Appointment request failed.',
        'error' => $e->getMessage()
    ]);
}

function getVetReviews($pdo, $data)
{
    $vetId = (int)($data['veterinarian_id'] ?? 0);

    $stmt = $pdo->prepare("
        SELECT
            reviews.rating,
            reviews.comment,
            users.full_name AS owner_name,
            pets.pet_name,
            pets.species
        FROM reviews
        INNER JOIN appointments ON appointments.id = reviews.appointment_id
        INNER JOIN users ON users.id = reviews.owner_id
        INNER JOIN pets ON pets.id = appointments.pet_id
        WHERE reviews.veterinarian_id = :vet_id
        ORDER BY reviews.created_at DESC
        LIMIT 1
    ");

    $stmt->execute([':vet_id' => $vetId]);

    $reviews = $stmt->fetchAll(PDO::FETCH_ASSOC);

    respond(200, [
        'success' => true,
        'data' => $reviews
    ]);
}

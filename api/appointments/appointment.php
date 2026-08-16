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
require_once __DIR__ . '/../config/mailer.php';
require_once __DIR__ . '/../config/notifications.php';
require_once __DIR__ . '/../config/veterinarian_profile.php';
require_once __DIR__ . '/../includes/patient_tables.php';
require_once __DIR__ . '/appointment_notifications.php';

// How far ahead an appointment may be scheduled. Mirrors
// BOOKING_HORIZON_MONTHS in public/js/book-appointment.js — the date input's
// max attribute is UX only, this is the boundary that actually holds.
const BOOKING_HORIZON_MONTHS = 3;

#for reusuedability para di na mag type ng type ng response jusko
function respond($statusCode, $payload)
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

/**
 * Shared date rules for booking and rescheduling: real date, not in the past,
 * a weekday, and inside the booking horizon. Called before any write so both
 * paths agree on what a valid appointment date is.
 */
function assertSchedulableDate($date, $pastMessage)
{
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || strtotime($date) === false) {
        respond(422, ['success' => false, 'message' => 'A valid date is required.']);
    }
    if (strtotime($date) < strtotime(date('Y-m-d'))) {
        respond(422, ['success' => false, 'message' => $pastMessage]);
    }
    if (in_array((int) date('N', strtotime($date)), [6, 7], true)) {
        respond(422, ['success' => false, 'message' => 'The clinic is closed on Saturdays and Sundays.']);
    }
    $horizon = strtotime('+' . BOOKING_HORIZON_MONTHS . ' months', strtotime(date('Y-m-d')));
    if (strtotime($date) > $horizon) {
        respond(422, [
            'success' => false,
            'message' => 'Appointments can only be scheduled up to ' . BOOKING_HORIZON_MONTHS . ' months ahead.'
        ]);
    }
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

/**
 * Time slots have been written in two shapes -- '3:00 PM' from the booking
 * form and '15:00' from the vet's reschedule picker -- and they were compared
 * as plain strings, so a 12-hour row was invisible to a 24-hour conflict check
 * and its slot stayed selectable. Everything is stored as 24-hour 'HH:MM' now
 * and formatted for display; this accepts either shape and returns canonical.
 */
function canonicalTimeSlot($value)
{
    $value = clean($value);
    if ($value === '') return '';

    if (preg_match('/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i', $value, $m)) {
        $hour = (int) $m[1] % 12;
        if (strtoupper($m[3]) === 'PM') $hour += 12;
        return sprintf('%02d:%02d', $hour, (int) $m[2]);
    }

    if (preg_match('/^(\d{1,2}):(\d{2})$/', $value, $m)) {
        return sprintf('%02d:%02d', (int) $m[1], (int) $m[2]);
    }

    return $value;
}

function normalizeSex($value)
{
    $value = strtolower(clean($value));
    return $value === 'female' ? 'female' : 'male';
    #if ung value ba is female ang value nia ay female howehver magiging male.
}

function normalizeStatus($status)
{
    $status = strtolower(clean($status));
    $allowed = ['pending', 'confirmed', 'completed', 'cancelled', 'rejected'];
    return in_array($status, $allowed, true) ? $status : 'pending';
    #ung is_array parang nichchceck niya if ung status natin ay nasa allowed and if gusto ba natin strict search or not (we can 
    #modifty this by changing the boolean, tas if andon ang status ang ireturn ay ung status if wala naman ung pending )
}

function getRoleId($pdo, $roleName)
{
    $stmt = $pdo->prepare('SELECT id FROM roles WHERE name = :name LIMIT 1');
    $stmt->execute([':name' => $roleName]);
    $role = $stmt->fetch();
    return $role ? (int) $role['id'] : 0;
}

/**
 * A vet-proposed reschedule waits for the owner to accept it, so the proposed
 * date/time is held separately from the confirmed one until they respond --
 * a decline has to be able to fall back to the original booking.
 *
 * Applied at runtime (same approach as ensureTicketSchema) so deploying is
 * still just a code pull, with no migration to run by hand on the server.
 */
function ensureRescheduleSchema($pdo)
{
    static $ready = null;
    if ($ready !== null) return $ready;

    // The migration is attempted rather than assumed: on hosting where the
    // database user has no ALTER privilege this must not take the whole
    // appointments API down with it, so a failure degrades to "handshake
    // unavailable" and booking/listing carry on. database/migrations/ has the
    // same statements to run by hand if that happens.
    try {
        if (!$pdo->query("SHOW COLUMNS FROM appointments LIKE 'proposed_date'")->fetch()) {
            $pdo->exec("
                ALTER TABLE appointments
                    ADD COLUMN proposed_date DATE NULL AFTER time_slot,
                    ADD COLUMN proposed_time_slot VARCHAR(50) NULL AFTER proposed_date,
                    ADD COLUMN reschedule_reason VARCHAR(255) NULL AFTER proposed_time_slot,
                    ADD COLUMN reschedule_requested_by INT NULL AFTER reschedule_reason,
                    ADD COLUMN reschedule_requested_at DATETIME NULL AFTER reschedule_requested_by,
                    ADD COLUMN reschedule_prev_status VARCHAR(20) NULL AFTER reschedule_requested_at
            ");
        }

        // Widen the status enum for the awaiting-owner state.
        $status = $pdo->query("SHOW COLUMNS FROM appointments LIKE 'status'")->fetch();
        if ($status && strpos($status['Type'], 'reschedule_pending') === false) {
            $pdo->exec("
                ALTER TABLE appointments
                MODIFY COLUMN status
                ENUM('pending','confirmed','completed','cancelled','rejected','reschedule_pending')
                DEFAULT 'pending'
            ");
        }
    } catch (PDOException $e) {
        error_log('bvetter: reschedule schema migration failed: ' . $e->getMessage());
        return $ready = false;
    }

    return $ready = true;
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

    // Every field the booking form marks with an asterisk is required here
    // too. Previously barangay and address were silently optional -- a missing
    // barangay skipped the owner_profiles insert entirely and a blank address
    // was stored as 'N/A', so an incomplete record looked complete.
    $missing = [];
    if ($fullName === '')   $missing[] = 'full name';
    if ($email === '')      $missing[] = 'email address';
    if ($phone === '')      $missing[] = 'contact number';
    if ($barangayId <= 0)   $missing[] = 'barangay';
    if ($address === '')    $missing[] = 'complete address';

    if ($missing) {
        respond(422, [
            'success' => false,
            'message' => 'Please provide your ' . implode(', ', $missing) . '.'
        ]);
    }

    // Confirm the barangay exists before inserting. Without this the profile
    // insert trips a foreign-key constraint and surfaces as a 500.
    $brgyCheck = $pdo->prepare('SELECT id FROM barangays WHERE id = :id LIMIT 1');
    $brgyCheck->execute([':id' => $barangayId]);
    if (!$brgyCheck->fetch()) {
        respond(422, ['success' => false, 'message' => 'Please select a valid barangay.']);
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

    $insertProfile = $pdo->prepare('
        INSERT INTO owner_profiles (user_id, barangay_id, complete_address, verification_status, verified_at)
        VALUES (:user_id, :barangay_id, :complete_address, :verification_status, NOW())
    ');
    $insertProfile->execute([
        ':user_id' => $ownerId,
        ':barangay_id' => $barangayId,
        ':complete_address' => $address,
        ':verification_status' => 'approved',
    ]);

    return $ownerId;
}

function findOrCreatePet($pdo, $ownerId, $data)
{
    $petId = (int) ($data['pet_id'] ?? 0);
    if ($petId > 0) return $petId;

    $petName = clean($data['pet_name'] ?? '');
    $species = clean($data['species'] ?? $data['pet_type'] ?? '');
    $breed   = clean($data['breed'] ?? $data['pet_breed'] ?? '');
    $age     = clean($data['age'] ?? $data['pet_age'] ?? '');
    $sex     = clean($data['sex'] ?? $data['pet_sex'] ?? '');

    // Breed, age and sex are asterisked on the booking form but used to fall
    // through to '', '' and a 'male' default -- so a pet could be recorded as
    // male without anyone having said so.
    $missing = [];
    if ($petName === '') $missing[] = 'name';
    if ($species === '') $missing[] = 'type';
    if ($breed === '')   $missing[] = 'breed';
    if ($age === '')     $missing[] = 'age';
    if ($sex === '')     $missing[] = 'sex';

    if ($missing) {
        respond(422, [
            'success' => false,
            'message' => "Please provide your pet's " . implode(', ', $missing) . '.'
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
        ':breed' => $breed,
        ':sex' => normalizeSex($sex),
        ':age' => $age,
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
        ' . (ensureRescheduleSchema($pdo)
                ? 'appointments.proposed_date,
                   appointments.proposed_time_slot,
                   appointments.reschedule_reason,'
                : 'NULL AS proposed_date,
                   NULL AS proposed_time_slot,
                   NULL AS reschedule_reason,') . '
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
            // Only set while a vet-proposed reschedule is awaiting the owner.
            'proposed_date' => $row['proposed_date'],
            'proposed_time_slot' => $row['proposed_time_slot'],
            'reschedule_reason' => $row['reschedule_reason'],
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

function listVisitTypes($pdo)
{
    $stmt = $pdo->query('SELECT id, name, is_default FROM visit_types WHERE is_active = 1 ORDER BY id ASC');
    respond(200, [
        'success' => true,
        'data' => array_map(function ($row) {
            return [
                'id' => (int) $row['id'],
                'name' => $row['name'],
                'is_default' => (bool) $row['is_default'],
            ];
        }, $stmt->fetchAll())
    ]);
}

function addVisitType($pdo, $data)
{
    $name = clean($data['name'] ?? '');
    if ($name === '') {
        respond(422, ['success' => false, 'message' => 'Please enter a visit type.']);
    }

    $stmt = $pdo->prepare('SELECT id, is_active FROM visit_types WHERE name = :name LIMIT 1');
    $stmt->execute([':name' => $name]);
    $existing = $stmt->fetch();

    if ($existing) {
        if (!$existing['is_active']) {
            $pdo->prepare('UPDATE visit_types SET is_active = 1 WHERE id = :id')
                ->execute([':id' => $existing['id']]);
            respond(200, ['success' => true, 'data' => ['id' => (int) $existing['id'], 'name' => $name, 'is_default' => false]]);
        }
        respond(422, ['success' => false, 'message' => 'That visit type already exists.']);
    }

    $insert = $pdo->prepare('INSERT INTO visit_types (name) VALUES (:name)');
    $insert->execute([':name' => $name]);

    respond(201, [
        'success' => true,
        'data' => ['id' => (int) $pdo->lastInsertId(), 'name' => $name, 'is_default' => false]
    ]);
}

function removeVisitType($pdo, $data)
{
    $id = (int) ($data['id'] ?? 0);
    if ($id <= 0) {
        respond(422, ['success' => false, 'message' => 'Invalid visit type id.']);
    }

    $stmt = $pdo->prepare('SELECT is_default FROM visit_types WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $type = $stmt->fetch();

    if (!$type) {
        respond(404, ['success' => false, 'message' => 'Visit type not found.']);
    }
    if ($type['is_default']) {
        respond(422, ['success' => false, 'message' => 'Default visit types cannot be removed.']);
    }

    $pdo->prepare('UPDATE visit_types SET is_active = 0 WHERE id = :id')->execute([':id' => $id]);
    respond(200, ['success' => true]);
}

function createAppointment($pdo, $data)
{
    $appointmentType = clean($data['appointment_type'] ?? $data['visit_type'] ?? '');
    $preferredDate = clean($data['preferred_date'] ?? $data['date'] ?? '');
    $timeSlot = canonicalTimeSlot($data['time_slot'] ?? $data['time'] ?? '');
    $description = clean($data['description'] ?? '');
    $notes = clean($data['notes'] ?? '');
    $veterinarianId = (int) ($data['veterinarian_id'] ?? 0);

    if ($appointmentType === '' || $preferredDate === '' || $timeSlot === '') {
        respond(422, [
            'success' => false,
            'message' => 'Appointment type, date, and time slot are required.'
        ]);
    }

    $typeCheck = $pdo->prepare('SELECT id FROM visit_types WHERE name = :name AND is_active = 1 LIMIT 1');
    $typeCheck->execute([':name' => $appointmentType]);
    if (!$typeCheck->fetch()) {
        respond(422, ['success' => false, 'message' => 'Please select a valid visit type.']);
    }
    assertSchedulableDate($preferredDate, 'Cannot book an appointment on a past date.');
    if ($preferredDate === date('Y-m-d')) {
        $slotTimestamp = strtotime($preferredDate . ' ' . $timeSlot);
        if ($slotTimestamp !== false && $slotTimestamp <= time()) {
            respond(422, ['success' => false, 'message' => 'That time slot has already passed today. Please choose a later time.']);
        }
    }

    $pdo->beginTransaction();

    // Re-check the slot server-side (mirrors getBookedSlots) so a race between
    // two owners — or a stale slot list on the client — can't double-book a
    // vet once a prior request for the same date/time has been confirmed.
    // Shares slotConflictExists() with the reschedule path so a slot held for a
    // pending reschedule can't be booked out from under it.
    if (slotConflictExists($pdo, $veterinarianId, $preferredDate, $timeSlot, 0)) {
        $pdo->rollBack();
        respond(409, [
            'success' => false,
            'message' => 'That time slot has just been booked. Please choose another.'
        ]);
    }

    $ownerId = findOrCreateOwner($pdo, $data);
    $petId = findOrCreatePet($pdo, $ownerId, $data);

    // Stored on the appointment (not just used in-memory) so that later
    // status-change emails (confirmed/rejected) also reach the address typed
    // on the booking form, not just the initial "request received" email.
    // findOrCreateOwner() ignores owner_email once an owner_id is resolved,
    // so a logged-in owner's account email is otherwise all downstream code
    // ever sees, even if they typed something different in step 1.
    $contactEmail = clean($data['owner_email'] ?? '');

    $insert = $pdo->prepare('
        INSERT INTO appointments
            (owner_id, pet_id, veterinarian_id, appointment_type, preferred_date, time_slot, contact_email, status, description, notes)
        VALUES
            (:owner_id, :pet_id, :veterinarian_id, :appointment_type, :preferred_date, :time_slot, :contact_email, :status, :description, :notes)
    ');

    $insert->execute([
        ':owner_id' => $ownerId,
        ':pet_id' => $petId,
        ':veterinarian_id' => $veterinarianId > 0 ? $veterinarianId : null,
        ':appointment_type' => $appointmentType,
        ':preferred_date' => $preferredDate,
        ':time_slot' => $timeSlot,
        ':contact_email' => $contactEmail !== '' ? $contactEmail : null,
        ':status' => 'pending',
        ':description' => $description,
        ':notes' => $notes,
    ]);

    $appointmentId = (int) $pdo->lastInsertId();
    $pdo->commit();

    // Sent synchronously and directly, on purpose: two different attempts at
    // deferring this (an early-flush trick, then a detached background
    // process) each broke in a way specific to this server that wasn't
    // reproducible locally. Simple and correct beats clever and broken.
    runAppointmentNotifications($pdo, $appointmentId);

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

    if ($status === 'confirmed') {
        ensurePatientRecordFromAppointment($pdo, $appointmentId);
        notifyOwnerAppointmentConfirmed($pdo, $appointmentId);
        notifyStaff($pdo, 'both', 'appointment_status', 'Appointment Confirmed', "Appointment #{$appointmentId} was confirmed.", $appointmentId, false);
    }
    if (in_array($status, ['cancelled', 'rejected'], true)) {
        $verb = $status === 'cancelled' ? 'cancelled' : 'rejected';
        notifyOwnerAppointmentRejected($pdo, $appointmentId, $verb);
        notifyStaff($pdo, 'both', 'appointment_status', 'Appointment ' . ucfirst($verb), "Appointment #{$appointmentId} was {$verb}.", $appointmentId, true);
    }

    respond(200, [
        'success' => true,
        'message' => 'Appointment status updated.'
    ]);
}

function notifyOwnerAppointmentConfirmed($pdo, $appointmentId)
{
    $stmt = $pdo->prepare('
        SELECT appointments.preferred_date, appointments.time_slot, appointments.contact_email,
               owners.id AS owner_id, owners.full_name AS owner_name, owners.email AS owner_email
        FROM appointments
        INNER JOIN users owners ON owners.id = appointments.owner_id
        WHERE appointments.id = :id
        LIMIT 1
    ');
    $stmt->execute([':id' => (int) $appointmentId]);
    $row = $stmt->fetch();
    if (!$row) return;

    $recipientEmail = $row['contact_email'] ?: $row['owner_email'];
    if (!$recipientEmail) return;

    $ownerId = (int) $row['owner_id'];
    if (!userWantsNotification($pdo, $ownerId, 'appointment_reminders')) return;

    $subject = 'BVetter – Your appointment is confirmed';
    $body = notificationEmailWrapper(
        'Appointment Confirmed',
        "<p>Your appointment on <strong>{$row['preferred_date']}</strong> at
           <strong>{$row['time_slot']}</strong> has been confirmed.</p>",
        null,
        ['label' => 'View', 'url' => APP_URL . '/public/pages/book-appointment.html']
    );

    sendAppMail($recipientEmail, clean($row['owner_name'] ?? ''), $subject, $body);
}

function notifyOwnerAppointmentRejected($pdo, $appointmentId, $verb)
{
    $stmt = $pdo->prepare('
        SELECT appointments.preferred_date, appointments.time_slot, appointments.contact_email,
               owners.id AS owner_id, owners.full_name AS owner_name, owners.email AS owner_email
        FROM appointments
        INNER JOIN users owners ON owners.id = appointments.owner_id
        WHERE appointments.id = :id
        LIMIT 1
    ');
    $stmt->execute([':id' => (int) $appointmentId]);
    $row = $stmt->fetch();
    if (!$row) return;

    $recipientEmail = $row['contact_email'] ?: $row['owner_email'];
    if (!$recipientEmail) return;

    $ownerId = (int) $row['owner_id'];
    if (!userWantsNotification($pdo, $ownerId, 'appointment_reminders')) return;

    $subject = 'BVetter – Your appointment was ' . $verb;
    $body = notificationEmailWrapper(
        'Appointment ' . ucfirst($verb),
        "<p>Your appointment on <strong>{$row['preferred_date']}</strong> at
           <strong>{$row['time_slot']}</strong> has been <strong>{$verb}</strong>.</p>",
        null,
        ['label' => 'View', 'url' => APP_URL . '/public/pages/book-appointment.html']
    );

    sendAppMail($recipientEmail, clean($row['owner_name'] ?? ''), $subject, $body);
}

/**
 * Tell the owner a new time is waiting on them. Unlike a plain confirmation
 * this needs an answer, so the email says so explicitly.
 */
function notifyOwnerRescheduleProposed($pdo, $appointmentId)
{
    $stmt = $pdo->prepare('
        SELECT appointments.preferred_date, appointments.time_slot, appointments.contact_email,
               appointments.proposed_date, appointments.proposed_time_slot,
               appointments.reschedule_reason,
               owners.id AS owner_id, owners.full_name AS owner_name, owners.email AS owner_email
        FROM appointments
        INNER JOIN users owners ON owners.id = appointments.owner_id
        WHERE appointments.id = :id
        LIMIT 1
    ');
    $stmt->execute([':id' => (int) $appointmentId]);
    $row = $stmt->fetch();
    if (!$row) return;

    $recipientEmail = $row['contact_email'] ?: $row['owner_email'];
    if (!$recipientEmail) return;

    $ownerId = (int) $row['owner_id'];
    if (!userWantsNotification($pdo, $ownerId, 'appointment_reminders')) return;

    $reason = clean($row['reschedule_reason'] ?? '');
    $reasonHtml = $reason !== ''
        ? '<p>Reason given: <em>' . htmlspecialchars($reason, ENT_QUOTES, 'UTF-8') . '</em></p>'
        : '';

    $subject = 'BVetter – The clinic proposed a new appointment time';
    $body = notificationEmailWrapper(
        'New Time Proposed',
        "<p>The clinic has asked to move your appointment from
           <strong>{$row['preferred_date']}</strong> at <strong>{$row['time_slot']}</strong>
           to <strong>{$row['proposed_date']}</strong> at
           <strong>{$row['proposed_time_slot']}</strong>.</p>
         {$reasonHtml}
         <p>This change is not final. Your original booking is still held until
            you accept or decline the new time.</p>",
        null,
        ['label' => 'Review the new time', 'url' => APP_URL . '/public/pages/book-appointment.html']
    );

    sendAppMail($recipientEmail, clean($row['owner_name'] ?? ''), $subject, $body);
}

/**
 * Let the clinic know how the owner answered, so a decline doesn't sit unseen
 * on a screen nobody happens to be looking at.
 */
function notifyStaffRescheduleAnswer($pdo, $appointmentId, $verb, $date, $timeSlot)
{
    $stmt = $pdo->prepare('
        SELECT owners.full_name AS owner_name, pets.pet_name
        FROM appointments
        INNER JOIN users owners ON owners.id = appointments.owner_id
        LEFT JOIN pets ON pets.id = appointments.pet_id
        WHERE appointments.id = :id
        LIMIT 1
    ');
    $stmt->execute([':id' => (int) $appointmentId]);
    $row = $stmt->fetch();

    $owner = clean($row['owner_name'] ?? 'A pet owner');
    $pet = clean($row['pet_name'] ?? '');
    $subject = $pet !== '' ? "{$owner} ({$pet})" : $owner;

    $message = $verb === 'accepted'
        ? "{$subject} accepted the new time: {$date} at {$timeSlot}."
        : "{$subject} declined the proposed {$date} at {$timeSlot}. The original appointment still stands.";

    notifyStaff(
        $pdo,
        'both',
        'appointment_reschedule_' . $verb,
        'Reschedule ' . ucfirst($verb),
        $message,
        (int) $appointmentId,
        $verb === 'declined'
    );
}

/**
 * Is this vet's date/time already spoken for? A slot counts as taken when it
 * holds another confirmed booking, and on both sides of a reschedule still
 * awaiting an answer -- the original is held in case the owner declines, the
 * proposed one in case they accept.
 */
function slotConflictExists($pdo, $vetId, $date, $timeSlot, $excludeId)
{
    $vetClause = $vetId > 0 ? 'AND (veterinarian_id = :vet_id OR veterinarian_id IS NULL)' : '';

    $params = [
        ':id'   => $excludeId,
        ':date' => $date,
        ':slot' => $timeSlot,
    ];

    // Without the handshake columns there are no held slots to consider, and
    // referencing them would break booking outright.
    $heldClause = '';
    if (ensureRescheduleSchema($pdo)) {
        $heldClause = "OR (proposed_date = :date2 AND proposed_time_slot = :slot2
                           AND status = 'reschedule_pending')";
        $params[':date2'] = $date;
        $params[':slot2'] = $timeSlot;
    }

    if ($vetId > 0) {
        $params[':vet_id'] = $vetId;
    }

    $stmt = $pdo->prepare("
        SELECT id FROM appointments
        WHERE id <> :id
          AND (
                (preferred_date = :date AND time_slot = :slot
                 AND status IN ('confirmed', 'completed', 'reschedule_pending'))
                {$heldClause}
              )
          {$vetClause}
        LIMIT 1
    ");

    $stmt->execute($params);
    return (bool) $stmt->fetchColumn();
}

function rescheduleAppointment($pdo, $data, $session = null)
{
    $appointmentId = (int) ($data['appointment_id'] ?? $data['id'] ?? 0);
    $date = clean($data['preferred_date'] ?? $data['date'] ?? '');
    $timeSlot = canonicalTimeSlot($data['time_slot'] ?? '');

    if ($appointmentId <= 0) {
        respond(422, ['success' => false, 'message' => 'Invalid appointment id.']);
    }
    assertSchedulableDate($date, 'Cannot reschedule to a past date.');
    if (!preg_match('/^\d{2}:\d{2}$/', $timeSlot)) {
        respond(422, ['success' => false, 'message' => 'A valid time slot is required.']);
    }
    if ($date === date('Y-m-d') && strtotime("{$date} {$timeSlot}") <= time()) {
        respond(422, ['success' => false, 'message' => 'That time slot has already passed today. Please choose a later time.']);
    }

    $stmt = $pdo->prepare('
        SELECT id, veterinarian_id, status, preferred_date, time_slot
        FROM appointments WHERE id = :id LIMIT 1
    ');
    $stmt->execute([':id' => $appointmentId]);
    $appointment = $stmt->fetch();
    if (!$appointment) {
        respond(404, ['success' => false, 'message' => 'Appointment not found.']);
    }

    $vetId = (int) ($appointment['veterinarian_id'] ?? 0);

    // A vet may only reschedule the appointments assigned to them; admins may
    // reschedule any. Unassigned appointments (veterinarian_id NULL) stay open
    // to any vet, matching how the conflict check below already treats them.
    if ($session !== null && ($session['role_name'] ?? '') === 'veterinarian') {
        if ($vetId > 0 && $vetId !== (int) ($session['user_id'] ?? 0)) {
            respond(403, [
                'success' => false,
                'message' => 'You can only reschedule appointments assigned to you.'
            ]);
        }
    }

    if (slotConflictExists($pdo, $vetId, $date, $timeSlot, $appointmentId)) {
        respond(409, ['success' => false, 'message' => 'That time slot is already booked.']);
    }

    $currentStatus = (string) ($appointment['status'] ?? 'pending');
    if (in_array($currentStatus, ['completed', 'cancelled', 'rejected'], true)) {
        respond(409, [
            'success' => false,
            'message' => 'This appointment is already ' . $currentStatus . ' and cannot be rescheduled.'
        ]);
    }
    if ($currentStatus === 'reschedule_pending') {
        respond(409, [
            'success' => false,
            'message' => 'A reschedule for this appointment is already awaiting the pet owner\'s response.'
        ]);
    }
    if ($date === $appointment['preferred_date'] && $timeSlot === $appointment['time_slot']) {
        respond(422, [
            'success' => false,
            'message' => 'That is already the scheduled date and time.'
        ]);
    }

    // Hold the proposal rather than applying it. preferred_date/time_slot stay
    // put so a decline falls straight back to the booking the owner agreed to,
    // and reschedule_prev_status remembers what to fall back to.
    $update = $pdo->prepare("
        UPDATE appointments
        SET proposed_date = :date,
            proposed_time_slot = :time_slot,
            reschedule_reason = :reason,
            reschedule_requested_by = :by,
            reschedule_requested_at = NOW(),
            reschedule_prev_status = :prev_status,
            status = 'reschedule_pending'
        WHERE id = :id
    ");
    $update->execute([
        ':date' => $date,
        ':time_slot' => $timeSlot,
        ':reason' => clean($data['reason'] ?? '') ?: null,
        ':by' => $session !== null ? (int) ($session['user_id'] ?? 0) : null,
        ':prev_status' => $currentStatus,
        ':id' => $appointmentId,
    ]);

    notifyOwnerRescheduleProposed($pdo, $appointmentId);

    respond(200, [
        'success' => true,
        'message' => 'Reschedule proposed. The pet owner has been asked to confirm.'
    ]);
}

/**
 * Owner's answer to a proposed reschedule. Accepting moves the appointment onto
 * the proposed slot; declining puts it back exactly where it was.
 */
function respondToReschedule($pdo, $data, $session)
{
    $appointmentId = (int) ($data['appointment_id'] ?? $data['id'] ?? 0);
    $decision = clean($data['decision'] ?? '');

    if ($appointmentId <= 0) {
        respond(422, ['success' => false, 'message' => 'Invalid appointment id.']);
    }
    if (!in_array($decision, ['accept', 'decline'], true)) {
        respond(422, ['success' => false, 'message' => 'Decision must be accept or decline.']);
    }

    $stmt = $pdo->prepare('
        SELECT id, owner_id, status, preferred_date, time_slot,
               proposed_date, proposed_time_slot, reschedule_prev_status, veterinarian_id
        FROM appointments WHERE id = :id LIMIT 1
    ');
    $stmt->execute([':id' => $appointmentId]);
    $appointment = $stmt->fetch();
    if (!$appointment) {
        respond(404, ['success' => false, 'message' => 'Appointment not found.']);
    }

    // Only the owner this appointment belongs to may answer for it.
    if ((int) $appointment['owner_id'] !== (int) ($session['user_id'] ?? 0)) {
        respond(403, [
            'success' => false,
            'message' => 'You can only respond to your own appointments.'
        ]);
    }
    if ($appointment['status'] !== 'reschedule_pending') {
        respond(409, [
            'success' => false,
            'message' => 'This appointment has no reschedule awaiting your response.'
        ]);
    }

    // Falling back to 'confirmed' rather than 'pending' would silently approve
    // an appointment the vet had never confirmed.
    $previous = $appointment['reschedule_prev_status'] ?: 'pending';
    if (!in_array($previous, ['pending', 'confirmed'], true)) {
        $previous = 'pending';
    }

    if ($decision === 'accept') {
        $newDate = $appointment['proposed_date'];
        $newSlot = $appointment['proposed_time_slot'];

        // The proposed slot was held while the owner decided, but the date may
        // simply have passed by the time they got to it.
        if (strtotime($newDate) < strtotime(date('Y-m-d'))) {
            respond(409, [
                'success' => false,
                'message' => 'That proposed date has already passed. Please ask the clinic for a new time.'
            ]);
        }

        $update = $pdo->prepare("
            UPDATE appointments
            SET preferred_date = :date,
                time_slot = :time_slot,
                status = 'confirmed',
                confirmed_at = NOW(),
                proposed_date = NULL,
                proposed_time_slot = NULL,
                reschedule_reason = NULL,
                reschedule_requested_by = NULL,
                reschedule_requested_at = NULL,
                reschedule_prev_status = NULL
            WHERE id = :id
        ");
        $update->execute([
            ':date' => $newDate,
            ':time_slot' => $newSlot,
            ':id' => $appointmentId,
        ]);

        notifyStaffRescheduleAnswer($pdo, $appointmentId, 'accepted', $newDate, $newSlot);

        respond(200, [
            'success' => true,
            'message' => 'Reschedule accepted. Your appointment has been moved.'
        ]);
    }

    $declinedDate = $appointment['proposed_date'];
    $declinedSlot = $appointment['proposed_time_slot'];

    $update = $pdo->prepare("
        UPDATE appointments
        SET status = :prev_status,
            proposed_date = NULL,
            proposed_time_slot = NULL,
            reschedule_reason = NULL,
            reschedule_requested_by = NULL,
            reschedule_requested_at = NULL,
            reschedule_prev_status = NULL
        WHERE id = :id
    ");
    $update->execute([
        ':prev_status' => $previous,
        ':id' => $appointmentId,
    ]);

    notifyStaffRescheduleAnswer($pdo, $appointmentId, 'declined', $declinedDate, $declinedSlot);

    respond(200, [
        'success' => true,
        'message' => 'Reschedule declined. Your original appointment stands.'
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
    ensureVeterinarianBookableColumn($pdo);

    // is_bookable = 0 hides assistant vets from this pet-owner-facing list —
    // they still have full dashboard access, they're just not a pickable
    // option when booking. NULL (no profile row at all) is treated as
    // bookable so a vet without a profile isn't silently hidden.
    $stmt = $pdo->query("
        SELECT users.id, users.full_name, users.email, users.phone_number,
               users.profile_photo,
               veterinarian_profiles.position_title,
               veterinarian_profiles.education,
               veterinarian_profiles.specialization,
               veterinarian_profiles.clinic_location,
               veterinarian_profiles.bio
        FROM users
        INNER JOIN roles ON roles.id = users.role_id
        LEFT JOIN veterinarian_profiles ON veterinarian_profiles.user_id = users.id
        WHERE roles.name = 'veterinarian' AND users.account_status = 'active'
          AND (veterinarian_profiles.is_bookable IS NULL OR veterinarian_profiles.is_bookable = 1)
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
    // Rescheduling an appointment queries this same date/vet — exclude the
    // appointment's own existing row so it doesn't gray out its own slot.
    $excludeId = (int)($data['exclude_id'] ?? 0);

    if ($date === '') {
        respond(422, ['success' => false, 'message' => 'preferred_date is required.']);
    }

    // Prepares are not emulated, so a named placeholder cannot appear twice in
    // one statement. The UNION branch below therefore needs its own copies of
    // every parameter rather than reusing the ones above.
    $params = [':date' => $date];

    $excludeClause = $excludeId > 0 ? ' AND id <> :exclude_id' : '';
    if ($excludeId > 0) $params[':exclude_id'] = $excludeId;

    // If a vet is specified, only block slots for that vet.
    // If no vet assigned (NULL), those appointments block ALL vets
    // since the clinic hasn't assigned them yet.
    $vetClause = $vetId > 0 ? ' AND (veterinarian_id = :vet_id OR veterinarian_id IS NULL)' : '';
    if ($vetId > 0) $params[':vet_id'] = $vetId;

    // Both halves of a pending reschedule are reported as booked: the original
    // slot is still held in case the owner declines, and the proposed one is
    // held in case they accept. Skipped entirely when the handshake columns
    // aren't present, so slot lookups keep working either way.
    $proposedUnion = '';
    if (ensureRescheduleSchema($pdo)) {
        $excludeClause2 = $excludeId > 0 ? ' AND id <> :exclude_id2' : '';
        $vetClause2 = $vetId > 0 ? ' AND (veterinarian_id = :vet_id2 OR veterinarian_id IS NULL)' : '';
        if ($excludeId > 0) $params[':exclude_id2'] = $excludeId;
        if ($vetId > 0) $params[':vet_id2'] = $vetId;
        $params[':date2'] = $date;

        $proposedUnion = "
            UNION
            SELECT proposed_time_slot AS time_slot FROM appointments
            WHERE proposed_date = :date2
              AND status = 'reschedule_pending'
              AND proposed_time_slot IS NOT NULL
              {$vetClause2}
              {$excludeClause2}
        ";
    }

    $stmt = $pdo->prepare("
        SELECT time_slot FROM appointments
        WHERE preferred_date = :date
          AND status IN ('confirmed', 'completed', 'reschedule_pending')
          {$vetClause}
          {$excludeClause}
        {$proposedUnion}
    ");
    $stmt->execute($params);

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

// Status changes, deletion, and visit-type management are staff-side actions.
// Owner booking/listing/reviews — and the booking page's get_total /
// common_cases stats — keep working as before (owner-side identity
// enforcement is handled separately).
$staffActions = ['update_status', 'delete', 'add_visit_type', 'remove_visit_type', 'reschedule'];
$staffSession = null;
if (in_array($action, $staffActions, true)) {
    require_once __DIR__ . '/../config/auth_guard.php';
    $staffSession = requireRole($pdo, ['veterinarian', 'admin']);
}

// Answering a proposed reschedule is the owner's half of the handshake, so it
// authenticates as the pet owner rather than as staff. respondToReschedule()
// additionally checks the appointment actually belongs to them.
$ownerSession = null;
if ($action === 'respond_reschedule') {
    require_once __DIR__ . '/../config/auth_guard.php';
    $ownerSession = requireRole($pdo, ['pet_owner']);
}

// Resolve the schema once, up front. MySQL implicitly commits on DDL, so
// attempting the migration inside bookAppointment's transaction would silently
// end it and break the rollback -- running it here means every later call just
// reads the cached result.
$rescheduleSchemaReady = ensureRescheduleSchema($pdo);

// The handshake can't run without its columns. Everything else on this
// endpoint works regardless, so only these two actions are blocked.
if (in_array($action, ['reschedule', 'respond_reschedule'], true) && !$rescheduleSchemaReady) {
    respond(503, [
        'success' => false,
        'message' => 'Rescheduling is temporarily unavailable. Please contact the clinic directly.'
    ]);
}

try {
    if ($action === 'list') listAppointments($pdo, $input);
    if ($action === 'create') createAppointment($pdo, $input);
    if ($action === 'update_status') updateAppointmentStatus($pdo, $input);
    if ($action === 'reschedule') rescheduleAppointment($pdo, $input, $staffSession);
    if ($action === 'respond_reschedule') respondToReschedule($pdo, $input, $ownerSession);
    if ($action === 'delete') deleteAppointment($pdo, $input);
    if ($action === 'vets') listVeterinarians($pdo);
    if ($action === 'booked_slots') getBookedSlots($pdo, $input);
    if ($action === 'submit_review') submitReview($pdo, $input);
    if ($action === 'vet_reviews') getVetReviews($pdo, $input);
    if ($action === 'get_total') getTotalAppointment($pdo, $input);
    if ($action === 'common_cases') getCommonCases($pdo, $input);
    if ($action === 'visit_types') listVisitTypes($pdo);
    if ($action === 'add_visit_type') addVisitType($pdo, $input);
    if ($action === 'remove_visit_type') removeVisitType($pdo, $input);

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
        LIMIT 50
    ");

    $stmt->execute([':vet_id' => $vetId]);

    $reviews = $stmt->fetchAll(PDO::FETCH_ASSOC);

    respond(200, [
        'success' => true,
        'data' => $reviews
    ]);
}
function getTotalAppointment($pdo, $data)
{
    $vetId = (int)($data['veterinarian_id'] ?? 0);

    $stmt = $pdo->prepare("
        SELECT COUNT(*)
        FROM appointments
        WHERE veterinarian_id = :vetId
          AND status = 'completed'
    ");

    $stmt->execute([
        ':vetId' => $vetId
    ]);

    $totalAppointments = $stmt->fetchColumn();

    respond(200, [
        'success' => true,
        'data' => (int)$totalAppointments
    ]);
}

function getCommonCases($pdo, $data)
{
    $vetId = (int)($data['veterinarian_id'] ?? 0);

    $vetStmt = $pdo->prepare("SELECT full_name FROM users WHERE id = :vetId");
    $vetStmt->execute([':vetId' => $vetId]);
    $vetName = $vetStmt->fetchColumn();

    $cases = [];
    if ($vetName) {
        $stmt = $pdo->prepare("
            SELECT diagnosis, COUNT(*) AS total
            FROM patient_visit_records
            WHERE attending_vet = :vetName
              AND diagnosis IS NOT NULL AND diagnosis <> ''
            GROUP BY diagnosis
            ORDER BY total DESC
            LIMIT 4
        ");
        $stmt->execute([':vetName' => $vetName]);
        $cases = array_column($stmt->fetchAll(), 'diagnosis');
    }

    respond(200, [
        'success' => true,
        'data' => $cases
    ]);
}

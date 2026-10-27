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
require_once __DIR__ . '/../config/input_validation.php';
require_once __DIR__ . '/../config/mailer.php';
require_once __DIR__ . '/../config/notifications.php';
require_once __DIR__ . '/../config/veterinarian_profile.php';
require_once __DIR__ . '/../includes/patient_tables.php';
require_once __DIR__ . '/appointment_notifications.php';
require_once __DIR__ . '/../includes/timed_rules.php';
require_once __DIR__ . '/../includes/booking_slots.php';
require_once __DIR__ . '/../includes/booking_pets.php';
require_once __DIR__ . '/../includes/animal_visit_schema.php';

// How far ahead an appointment may be scheduled. Mirrors
// BOOKING_HORIZON_MONTHS in public/js/book-appointment.js — the date input's
// max attribute is UX only, this is the boundary that actually holds.
const BOOKING_HORIZON_MONTHS = 3;

#for reusuedability para di na mag type ng type ng response jusko
function respond($statusCode, $payload)
{
    global $pdo;
    if ($statusCode >= 400 && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

/**
 * Shared date rules for booking and rescheduling: real date, not in the past,
 * a weekday, and inside the booking horizon. Called before any write so both
 * paths agree on what a valid appointment date is.
 */
/**
 * Contact-detail rules for booking, deliberately IDENTICAL to the ones
 * api/auth/register.php applies at signup.
 *
 * Both paths write to the same columns -- findOrCreateOwner() INSERTs into
 * users.email / users.phone_number for a guest booking -- so a rule enforced
 * on one path and not the other lets the column hold values the other path
 * forbids. Until now booking checked only that these fields were non-empty,
 * so "asdf" and "abcdefg" both produced a real account and a real
 * appointment, and the address stored in appointments.contact_email is what
 * appointment_notifications.php later tries to email.
 *
 * Mobile-only, matching signup: there is no SMS integration, so the number is
 * a clinic callback field, but accepting a landline here while signup rejects
 * one is the inconsistency worth avoiding. An owner with no mobile books by
 * phoning the clinic, as they do today.
 */
function assertValidContactEmail($email)
{
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(422, [
            'success' => false,
            'message' => 'Please enter a valid email address.'
        ]);
    }
}

/** Mirrors isValidPHPhone() in shared/js/form-validation.js. */
function assertValidPHMobile($phone)
{
    if (!preg_match('/^(?:\+63|63|0)9\d{9}$/', preg_replace('/[\s-]/', '', $phone))) {
        respond(422, [
            'success' => false,
            'message' => 'Please enter a valid Philippine mobile number (e.g. 09171234567).'
        ]);
    }
}

function assertSchedulableDate($date, $pastMessage)
{
    if (!isValidYmd($date)) {
        respond(422, ['success' => false, 'message' => 'A valid date is required.']);
    }
    if (strtotime($date) < strtotime(date('Y-m-d'))) {
        respond(422, ['success' => false, 'message' => $pastMessage]);
    }
    if (in_array((int) date('N', strtotime($date)), [6, 7], true)) {
        respond(422, ['success' => false, 'message' => 'The clinic is closed on Saturdays and Sundays.']);
    }
    // Holidays and the dates the office marked closed (clinic_calendar.php;
    // loaded for this request in the router preamble).
    $closedReason = clinicClosedReason($date);
    if ($closedReason !== null) {
        respond(422, ['success' => false, 'message' => "The clinic is closed on that day ({$closedReason}). Please choose another date."]);
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
    return in_array($value, ['male', 'female', 'mixed'], true) ? $value : 'unknown';
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
 * Vet and owner reschedule requests hold the proposed date/time separately
 * from the current booking until the other side responds.
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

        // Widen the status enum for both sides of the reschedule handshake.
        $status = $pdo->query("SHOW COLUMNS FROM appointments LIKE 'status'")->fetch();
        $statusType = strtolower((string) ($status['Type'] ?? ''));
        if ($status && (
            strpos($statusType, "'reschedule_pending'") === false
            || strpos($statusType, "'owner_reschedule_pending'") === false
            || strpos($statusType, "'expired'") === false
        )) {
            $pdo->exec("
                ALTER TABLE appointments
                MODIFY COLUMN status
                ENUM('pending','confirmed','completed','cancelled','rejected','reschedule_pending','owner_reschedule_pending','expired')
                DEFAULT 'pending'
            ");
        }
    } catch (PDOException $e) {
        error_log('bvetter: reschedule schema migration failed: ' . $e->getMessage());
        return $ready = false;
    }

    return $ready = true;
}

/**
 * contact_name / contact_phone: who to reach about this appointment when it
 * isn't the account holder -- the booking form's "Use my account details"
 * switch turned off because a family member or helper is bringing the pet.
 * NULL means "the account holder", which is every booking made with the
 * switch on. contact_email already existed and keeps its meaning.
 */
function ensureAppointmentContactSchema($pdo)
{
    static $ready = null;
    if ($ready !== null) return $ready;
    try {
        if (!$pdo->query("SHOW COLUMNS FROM appointments LIKE 'contact_name'")->fetch()) {
            $pdo->exec('ALTER TABLE appointments ADD COLUMN contact_name VARCHAR(150) NULL, ADD COLUMN contact_phone VARCHAR(30) NULL');
        }
    } catch (PDOException $e) {
        error_log('[BVetter] appointment contact columns: ' . $e->getMessage());
        return $ready = false;
    }
    return $ready = true;
}

/**
 * The other person's name and number when the booking form's account switch
 * is off. Returns [name, phone], or [null, null] when the account holder is
 * the contact. Validated here because they are only kept in that case.
 */
function appointmentContactPerson($data)
{
    $usesAccount = (string) ($data['use_account_details'] ?? '1') !== '0';
    if ($usesAccount || (int) ($data['owner_id'] ?? 0) <= 0) {
        return [null, null];
    }

    $name = clean($data['owner_name'] ?? '');
    $phone = clean($data['owner_contact'] ?? '');
    $fieldError = firstIdentityFieldError([[$name, 'Contact name', 150, 2]]);
    if ($name === '' || $fieldError !== null) {
        respond(422, ['success' => false, 'message' => $fieldError ?? 'Please enter the name of the person bringing the pet.']);
    }
    assertValidPHMobile($phone);

    return [$name, $phone];
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

    $fieldError = firstIdentityFieldError([
        [$fullName, 'Owner name', 150, 2],
        [$phone,    'Contact number', 30, 0],
        [$address,  'Address', 255, 0],
    ]);
    if ($fieldError !== null) {
        respond(422, ['success' => false, 'message' => $fieldError]);
    }

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

    // Format, not just presence -- this path is about to INSERT into
    // users.email and users.phone_number, the same columns register.php
    // guards. Runs after the $missing check so an empty field reports as
    // missing rather than as malformed.
    assertValidContactEmail($email);
    assertValidPHMobile($phone);

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

    $petFieldError = firstIdentityFieldError([
        [$petName, 'Pet name', 120, 0],
        [$species, 'Species', 60, 0],
        [clean($data['breed'] ?? ''), 'Breed', 80, 0],
    ]);
    if ($petFieldError !== null) {
        respond(422, ['success' => false, 'message' => $petFieldError]);
    }
    $breed   = clean($data['breed'] ?? $data['pet_breed'] ?? '');
    $age     = clean($data['age'] ?? $data['pet_age'] ?? '');
    $sex     = clean($data['sex'] ?? $data['pet_sex'] ?? '');

    // A missing sex is recorded as unknown, never inferred from an empty field.
    //
    // Age is optional for an appointment: many owners don't know it exactly,
    // and the vet records it at the visit. Castration & Spay registration
    // (api/castration-spay/program.php) still requires it, because it decides
    // whether a pet is old enough for the procedure.
    $missing = [];
    if ($petName === '') $missing[] = 'name';
    if ($species === '') $missing[] = 'type';

    if ($missing) {
        respond(422, [
            'success' => false,
            'message' => "Please provide your pet's " . implode(', ', $missing) . '.'
        ]);
    }

    $stmt = $pdo->prepare('
        SELECT id, species, record_kind, animal_category
        FROM pets
        WHERE owner_id = :owner_id AND pet_name = :pet_name
        LIMIT 1
    ');
    $stmt->execute([
        ':owner_id' => $ownerId,
        ':pet_name' => $petName,
    ]);
    $existing = $stmt->fetch();
    if ($existing) {
        if (strcasecmp((string) $existing['species'], $species) !== 0 && animalGroupFromSpecies((string) $existing['species']) !== animalGroupFromSpecies($species)) {
            respond(422, ['success' => false, 'message' => 'An animal with this name already exists under a different species. Use its existing record or a distinct name.']);
        }
        if (($existing['record_kind'] ?? 'individual') !== clean($data['record_kind'] ?? 'individual')) {
            respond(422, ['success' => false, 'message' => 'This name is already used by a different animal record type. Use a distinct group name.']);
        }
        return (int) $existing['id'];
    }

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
    ensureAnimalVisitSchema($pdo);
    $where = [];
    $params = [];

    $status = strtolower(clean($data['status'] ?? ''));
    if ($status !== '' && $status !== 'all') {
        $filterableStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'rejected', 'reschedule_pending', 'owner_reschedule_pending', 'expired'];
        if (!in_array($status, $filterableStatuses, true)) $status = 'pending';
        $where[] = 'appointments.status = :status';
        $params[':status'] = $status;
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
        appointments.visit_mode,
        appointments.field_address,
        appointments.field_concern,
        appointments.field_schedule_scope,
        appointments.owner_assessment_json,
        appointments.status,
        ' . (ensureRescheduleSchema($pdo)
                ? 'appointments.proposed_date,
                   appointments.proposed_time_slot,
                   appointments.reschedule_reason,
                   appointments.reschedule_requested_at,'
                : 'NULL AS proposed_date,
                   NULL AS proposed_time_slot,
                   NULL AS reschedule_reason,
                   NULL AS reschedule_requested_at,') . '
        ' . (ensureTimedRulesSchema($pdo) ? 'appointments.expires_at,' : 'NULL AS expires_at,') . '
        ' . (ensureAppointmentContactSchema($pdo)
                ? 'appointments.contact_name, appointments.contact_phone,'
                : 'NULL AS contact_name, NULL AS contact_phone,') . '
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
    $petsByAppointment = appointmentPetsById($pdo, array_column($rows, 'id'));

    $data = array_map(function ($row) use ($petsByAppointment) {
        $pets = $petsByAppointment[(int) $row['id']] ?? [];
        return [
            'id' => (int) $row['id'],
            'datetime' => $row['preferred_date'] . ' ' . $row['time_slot'],
            'patient' => $pets ? implode(', ', array_column($pets, 'name')) : $row['pet_name'],
            'pets' => $pets,
            'owner' => $row['owner_name'],
            'service' => $row['appointment_type'],
            'visit_mode' => $row['visit_mode'],
            'field_address' => $row['field_address'],
            'field_concern' => $row['field_concern'],
            'field_schedule_scope' => $row['field_schedule_scope'],
            'owner_assessment' => $row['owner_assessment_json'] ? json_decode($row['owner_assessment_json'], true) : null,
            'status' => $row['status'],
            'type' => $row['appointment_type'],
            'owner_id' => (int) $row['owner_id'],
            'pet_id' => (int) $row['pet_id'],
            'veterinarian_id' => $row['veterinarian_id'] ? (int) $row['veterinarian_id'] : null,
            'veterinarian' => $row['veterinarian_name'],
            'preferred_date' => $row['preferred_date'],
            'time_slot' => $row['time_slot'],
            // When the request was made: same-time requests are listed to the
            // vet in this order, and the earliest is marked "1st request".
            'requested_at' => $row['created_at'],
            // When an unconfirmed request expires (api/includes/timed_rules.php).
            // NULL for requests made before the time limit existed.
            'expires_at' => $row['expires_at'],
            // Only set while a vet-proposed reschedule is awaiting the owner.
            'proposed_date' => $row['proposed_date'],
            'proposed_time_slot' => $row['proposed_time_slot'],
            'reschedule_reason' => $row['reschedule_reason'],
            'reschedule_requested_at' => $row['reschedule_requested_at'],
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
            // Set only when someone other than the account holder is bringing
            // the pet (the booking form's account switch turned off).
            'contact' => $row['contact_name'] ? [
                'name' => $row['contact_name'],
                'phone' => $row['contact_phone'],
            ] : null,
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
    $petEntries = bookingPetEntries($data);
    ensureAppointmentPetsSchema($pdo);
    ensureAnimalVisitSchema($pdo);
    $visitMode = clean($data['visit_mode'] ?? 'clinic');
    if (!in_array($visitMode, ['clinic', 'field'], true)) {
        respond(422, ['success' => false, 'message' => 'Choose clinic or field visit.']);
    }
    $storedPet = $pdo->prepare('SELECT species, animal_category FROM pets WHERE id = :id LIMIT 1');
    foreach ($petEntries as $index => $entry) {
        $species = clean($entry['species'] ?? $entry['pet_type'] ?? '');
        $requestedCategory = clean($entry['animal_category'] ?? '');
        if ($species === '' && !empty($entry['pet_id'])) {
            $storedPet->execute([':id' => (int) $entry['pet_id']]);
            $stored = $storedPet->fetch(PDO::FETCH_ASSOC) ?: [];
            $species = clean($stored['species'] ?? '');
            $requestedCategory = $requestedCategory ?: clean($stored['animal_category'] ?? '');
        }
        $category = animalCategory($species, $requestedCategory);
        if (!$category) respond(422, ['success' => false, 'message' => 'Animal ' . ($index + 1) . ': Please select a supported animal and category.']);
        if ($visitMode === 'clinic' && $category === 'livestock') {
            respond(422, ['success' => false, 'message' => 'Livestock requests need a field visit. Book companion animals separately for a clinic visit.']);
        }
        if ($visitMode === 'field' && $category !== 'livestock') {
            respond(422, ['success' => false, 'message' => 'Field visits are for livestock. Book companion animals separately for a clinic visit.']);
        }
    }
    $fieldAddress = clean($data['field_address'] ?? '');
    $fieldConcern = clean($data['field_concern'] ?? '');
    if ($visitMode === 'field' && ($fieldAddress === '' || $fieldConcern === '' || mb_strlen($fieldAddress) > 255 || mb_strlen($fieldConcern) > 2000)) {
        respond(422, ['success' => false, 'message' => 'Field visit location and concern are required.']);
    }
    $ownerAssessment = null;
    $assessmentId = (int) ($data['owner_assessment_log_id'] ?? 0);
    if ($assessmentId > 0) {
        if (clean($data['appointment_type'] ?? $data['visit_type'] ?? '') !== 'Consultation') {
            respond(422, ['success' => false, 'message' => 'The optional symptom check belongs to Consultation bookings.']);
        }
        $animalName = clean($data['owner_assessment_animal'] ?? '');
        $assessmentEntry = null;
        foreach ($petEntries as $entry) {
            if (clean($entry['pet_name'] ?? '') === $animalName) $assessmentEntry = $entry;
        }
        if ($assessmentEntry === null) {
            respond(422, ['success' => false, 'message' => 'The symptom check animal is not in this booking.']);
        }
        $assessmentStmt = $pdo->prepare('SELECT pet_type, age_group, symptoms_json, duration, severity, recommended_action, recommendation FROM chatbot_consultation_logs WHERE id = :id AND booking_context = 1');
        $assessmentStmt->execute([':id' => $assessmentId]);
        $assessmentRow = $assessmentStmt->fetch(PDO::FETCH_ASSOC);
        if (!$assessmentRow) respond(422, ['success' => false, 'message' => 'Please run the symptom check again.']);
        $assessmentSpecies = clean($assessmentEntry['species'] ?? $assessmentEntry['pet_type'] ?? '');
        $expectedType = chatbotSpeciesForBookedAnimal($assessmentSpecies);
        if ($assessmentRow['pet_type'] !== $expectedType) {
            respond(422, ['success' => false, 'message' => 'The symptom check was for a different animal type.']);
        }
        $ownerAssessment = [
            'animal' => $animalName,
            'pet_type' => $assessmentRow['pet_type'],
            'age_group' => $assessmentRow['age_group'],
            'symptoms' => json_decode($assessmentRow['symptoms_json'], true) ?: [],
            'duration' => $assessmentRow['duration'],
            'severity' => $assessmentRow['severity'],
            'action' => $assessmentRow['recommended_action'],
            'recommendation' => $assessmentRow['recommendation'],
        ];
    }
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

    // Checked HERE and not only in findOrCreateOwner(): that function returns
    // early for a logged-in owner and never looks at owner_email, but the
    // address typed on the form is still stored as appointments.contact_email
    // below and used as a mail recipient. Validating only inside
    // findOrCreateOwner() would leave the logged-in path unguarded.
    assertValidContactEmail(clean($data['owner_email'] ?? ''));

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

    // Serialize every schedule change on this date, including whole-day field
    // visits, before checking availability and creating the request.
    $slotLock = lockSlot($pdo, $preferredDate, 'day');

    $pdo->beginTransaction();

    // Re-check the slot server-side (mirrors getBookedSlots) so a stale slot
    // list on the client can't request a time the vet has already given away.
    // Only a CONFIRMED booking takes a slot: several owners may request the
    // same time, the vet confirms one, and the rest are declined then (see
    // declineOtherRequestsForSlot()). Shares slotConflictExists() with the
    // reschedule path so a slot held for a pending reschedule can't be booked
    // out from under it.
    if (slotConflictExists($pdo, $veterinarianId, $preferredDate, $timeSlot, 0)) {
        $pdo->rollBack();
        unlockSlot($pdo, $slotLock);
        respond(409, [
            'success' => false,
            'message' => 'That time slot has just been booked. Please choose another.'
        ]);
    }

    [$contactName, $contactPhone] = appointmentContactPerson($data);

    $ownerId = findOrCreateOwner($pdo, $data);
    $petIds = resolveBookingPetIds($pdo, $ownerId, $petEntries);
    $petId = $petIds[0];

    // Stored on the appointment (not just used in-memory) so that later
    // status-change emails (confirmed/rejected) also reach the address typed
    // on the booking form, not just the initial "request received" email.
    // findOrCreateOwner() ignores owner_email once an owner_id is resolved,
    // so a logged-in owner's account email is otherwise all downstream code
    // ever sees, even if they typed something different in step 1.
    $contactEmail = clean($data['owner_email'] ?? '');

    $insert = $pdo->prepare('
        INSERT INTO appointments
            (owner_id, pet_id, veterinarian_id, appointment_type, preferred_date, time_slot, contact_email, status, description, notes, visit_mode, field_address, field_concern, owner_assessment_json)
        VALUES
            (:owner_id, :pet_id, :veterinarian_id, :appointment_type, :preferred_date, :time_slot, :contact_email, :status, :description, :notes, :visit_mode, :field_address, :field_concern, :owner_assessment)
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
        ':visit_mode' => $visitMode,
        ':field_address' => $visitMode === 'field' ? $fieldAddress : null,
        ':field_concern' => $visitMode === 'field' ? $fieldConcern : null,
        ':owner_assessment' => $ownerAssessment ? json_encode($ownerAssessment, JSON_UNESCAPED_UNICODE) : null,
    ]);

    $appointmentId = (int) $pdo->lastInsertId();
    $linkPet = $pdo->prepare('INSERT INTO appointment_pets (appointment_id, pet_id, position) VALUES (?, ?, ?)');
    foreach ($petIds as $position => $id) {
        $linkPet->execute([$appointmentId, $id, $position]);
    }
    if ($contactName !== null && ensureAppointmentContactSchema($pdo)) {
        $pdo->prepare('UPDATE appointments SET contact_name = :name, contact_phone = :phone WHERE id = :id')
            ->execute([':name' => $contactName, ':phone' => $contactPhone, ':id' => $appointmentId]);
    }
    $pdo->commit();
    unlockSlot($pdo, $slotLock);

    // The clinic has 1 working day to confirm, or until the slot, whichever
    // is sooner; after that the request expires and the slot is released.
    setAppointmentExpiry($pdo, $appointmentId, $preferredDate, $timeSlot);

    // Sent synchronously and directly, on purpose: two different attempts at
    // deferring this (an early-flush trick, then a detached background
    // process) each broke in a way specific to this server that wasn't
    // reproducible locally. Simple and correct beats clever and broken.
    runAppointmentNotifications($pdo, $appointmentId);

    respond(201, [
        'success' => true,
        'message' => 'Appointment request submitted. The clinic confirms requests within 1 working day; if it isn\'t confirmed by then, it expires and you can book again.',
        'appointment_id' => $appointmentId,
        'pet_ids' => $petIds
    ]);
}

function updateAppointmentStatus($pdo, $data)
{
    ensureAnimalVisitSchema($pdo);
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

    // Confirming used to skip the slot check entirely, so with two requests
    // for one time the vet could confirm both. Several owners may request the
    // same time; the first one the vet confirms takes it, and any further
    // confirm for that time is refused.
    $slotLock = null;
    if ($status === 'confirmed') {
        $slotRow = $pdo->prepare('SELECT veterinarian_id, preferred_date, time_slot, status, visit_mode FROM appointments WHERE id = :id LIMIT 1');
        $slotRow->execute([':id' => $appointmentId]);
        $slot = $slotRow->fetch();
        // Its owner has already been told it expired and to book again.
        if ($slot && $slot['status'] === 'expired') {
            respond(409, [
                'success' => false,
                'message' => 'This request expired before it was confirmed, and the owner was asked to book again.'
            ]);
        }
        if ($slot) {
            $fieldScope = $slot['visit_mode'] === 'field' ? clean($data['field_schedule_scope'] ?? '') : 'slot';
            if (!in_array($fieldScope, ['slot', 'day'], true)) {
                respond(422, ['success' => false, 'message' => 'Choose whether the field visit reserves a time slot or the whole clinic day.']);
            }
            $slotLock = lockSlot($pdo, $slot['preferred_date'], 'day');
            if (($fieldScope === 'day' && appointmentDayConflictExists($pdo, $slot['preferred_date'], $appointmentId)) ||
                slotConflictExists($pdo, (int) $slot['veterinarian_id'], $slot['preferred_date'], $slot['time_slot'], $appointmentId)) {
                unlockSlot($pdo, $slotLock);
                respond(409, [
                    'success' => false,
                    'message' => 'Another appointment already occupies that time or day. Choose a different schedule.'
                ]);
            }
        }
    }

    $confirmedAtSql = $status === 'confirmed' ? 'NOW()' : 'confirmed_at';
    $cancelledAtSql = in_array($status, ['cancelled', 'rejected'], true) ? 'NOW()' : 'cancelled_at';
    $fieldScopeSql = $status === 'confirmed' ? ':field_schedule_scope' : 'field_schedule_scope';

    $stmt = $pdo->prepare("
        UPDATE appointments
        SET status = :status,
            reviewed_by_user_id = :reviewed_by_user_id,
            review_notes = :review_notes,
            field_schedule_scope = $fieldScopeSql,
            confirmed_at = $confirmedAtSql,
            cancelled_at = $cancelledAtSql
        WHERE id = :id
    ");

    $statusParams = [
        ':status' => $status,
        ':reviewed_by_user_id' => $reviewedBy > 0 ? $reviewedBy : null,
        ':review_notes' => $reviewNotes,
        ':id' => $appointmentId,
    ];
    if ($status === 'confirmed') $statusParams[':field_schedule_scope'] = $fieldScope ?? 'slot';
    $stmt->execute($statusParams);

    // The time now belongs to this booking; everyone else who asked for it
    // is told straight away rather than waiting for their request to expire.
    $declined = [];
    if ($status === 'confirmed' && !empty($slot)) {
        $declined = $fieldScope === 'day'
            ? declineOtherRequestsForDay($pdo, $appointmentId, $slot['preferred_date'])
            : declineOtherRequestsForSlot($pdo, $appointmentId, (int) $slot['veterinarian_id'], $slot['preferred_date'], $slot['time_slot']);
    }
    unlockSlot($pdo, $slotLock);
    foreach ($declined as $declinedId) {
        notifyOwnerSlotGivenAway($pdo, $declinedId);
    }

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
        'message' => $declined
            ? 'Confirmed. ' . count($declined) . (count($declined) === 1 ? ' other request for this time was' : ' other requests for this time were') . ' declined.'
            : 'Appointment status updated.',
        'declined' => $declined,
    ]);
}

/**
 * Once a vet confirms a time, every other pending request for that same
 * date, time and vet is declined (reviewed_by stays NULL -- the system did
 * it, not a person). Mirrors slotConflictExists()'s vet rule: a booking with
 * no vet assigned competes with every vet's requests at that time, and vice
 * versa. Returns the declined ids; the caller notifies their owners.
 */
function declineOtherRequestsForSlot($pdo, $confirmedId, $vetId, $date, $timeSlot)
{
    $vetClause = $vetId > 0 ? 'AND (veterinarian_id = :vet_id OR veterinarian_id IS NULL)' : '';
    $params = [':id' => $confirmedId, ':date' => $date, ':slot' => $timeSlot];
    if ($vetId > 0) $params[':vet_id'] = $vetId;

    $stmt = $pdo->prepare("
        SELECT id FROM appointments
        WHERE id <> :id AND status = 'pending'
          AND preferred_date = :date AND time_slot = :slot
          {$vetClause}
    ");
    $stmt->execute($params);

    $declined = [];
    $update = $pdo->prepare("
        UPDATE appointments
        SET status = 'rejected', cancelled_at = NOW(),
            review_notes = 'This time was given to another request.'
        WHERE id = :id AND status = 'pending'
    ");
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $id) {
        $update->execute([':id' => $id]);
        if ($update->rowCount() === 1) $declined[] = (int) $id;
    }
    return $declined;
}

/** Tells an owner the time they asked for went to someone else. */
function notifyOwnerSlotGivenAway($pdo, $appointmentId)
{
    $stmt = $pdo->prepare('
        SELECT appointments.preferred_date, appointments.time_slot, appointments.contact_email,
               appointments.veterinarian_id,
               owners.id AS owner_id, owners.full_name AS owner_name, owners.email AS owner_email
        FROM appointments
        INNER JOIN users owners ON owners.id = appointments.owner_id
        WHERE appointments.id = :id
        LIMIT 1
    ');
    $stmt->execute([':id' => (int) $appointmentId]);
    $row = $stmt->fetch();
    if (!$row) return;

    // Up to 3 fully free times that day (or the next open day), and a link
    // back to the form with this pet already filled in.
    $free = freeBookingTimes($pdo, (int) ($row['veterinarian_id'] ?? 0), $row['preferred_date']);
    $message = 'Your ' . bookingSlotLabel($row['time_slot']) . ' request on '
        . (new DateTimeImmutable($row['preferred_date']))->format('M j')
        . ' was given to another request. '
        . ($free ? freeTimesSentence($free, $row['preferred_date']) : 'Please choose another time.');

    try {
        notifyUser($pdo, (int) $row['owner_id'], 'appointment_status', 'Time Slot Taken', $message, (int) $appointmentId);

        $recipientEmail = $row['contact_email'] ?: $row['owner_email'];
        if (!$recipientEmail || !userWantsNotification($pdo, (int) $row['owner_id'], 'appointment_reminders')) return;

        sendAppMail(
            $recipientEmail,
            clean($row['owner_name'] ?? ''),
            'BVetter – Please choose another time',
            notificationEmailWrapper(
                'Time Slot Taken',
                '<p>' . htmlspecialchars($message, ENT_QUOTES) . '</p>',
                null,
                ['label' => 'Book Again', 'url' => rebookUrl((int) $appointmentId, $free)]
            )
        );
    } catch (Throwable $e) {
        error_log('[BVetter] slot-taken notice failed for appointment ' . $appointmentId . ': ' . $e->getMessage());
    }
}

function notifyOwnerAppointmentConfirmed($pdo, $appointmentId)
{
    $stmt = $pdo->prepare('
        SELECT appointments.preferred_date, appointments.time_slot, appointments.contact_email,
               appointments.visit_mode, appointments.field_address, appointments.field_schedule_scope,
               owners.id AS owner_id, owners.full_name AS owner_name, owners.email AS owner_email
        FROM appointments
        INNER JOIN users owners ON owners.id = appointments.owner_id
        WHERE appointments.id = :id
        LIMIT 1
    ');
    $stmt->execute([':id' => (int) $appointmentId]);
    $row = $stmt->fetch();
    if (!$row) return;

    $ownerId = (int) $row['owner_id'];
    $scheduleText = $row['visit_mode'] === 'field'
        ? ($row['field_schedule_scope'] === 'day'
            ? "Your field visit on {$row['preferred_date']} has been confirmed. The clinic will coordinate the arrival time."
            : "Your field visit on {$row['preferred_date']} at {$row['time_slot']} has been confirmed.")
        : "Your appointment on {$row['preferred_date']} at {$row['time_slot']} has been confirmed.";

    // In-app row first, and unconditionally. The checks below gate the
    // *email* — the settings page presents those toggles as email channels
    // and quiet hours says so outright — so letting them skip this would
    // leave the owner with no record at all that their appointment changed.
    notifyUser(
        $pdo,
        $ownerId,
        'appointment_status',
        'Appointment Confirmed',
        $scheduleText,
        (int) $appointmentId
    );

    $recipientEmail = $row['contact_email'] ?: $row['owner_email'];
    if (!$recipientEmail) return;

    if (!userWantsNotification($pdo, $ownerId, 'appointment_reminders')) return;

    $subject = 'BVetter – Your appointment is confirmed';
    $body = notificationEmailWrapper(
        'Appointment Confirmed',
        '<p>' . htmlspecialchars($scheduleText, ENT_QUOTES, 'UTF-8') . '</p>'
            . ($row['visit_mode'] === 'field' ? '<p>Location: ' . htmlspecialchars((string) $row['field_address'], ENT_QUOTES, 'UTF-8') . '</p>' : ''),
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

    $ownerId = (int) $row['owner_id'];

    notifyUser(
        $pdo,
        $ownerId,
        'appointment_status',
        'Appointment ' . ucfirst($verb),
        "Your appointment on {$row['preferred_date']} at {$row['time_slot']} was {$verb}.",
        (int) $appointmentId
    );

    $recipientEmail = $row['contact_email'] ?: $row['owner_email'];
    if (!$recipientEmail) return;

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

    $ownerId = (int) $row['owner_id'];

    notifyUser(
        $pdo,
        $ownerId,
        'appointment_reschedule_proposed',
        'New Time Proposed',
        "The clinic proposed moving your appointment to {$row['proposed_date']} at "
            . "{$row['proposed_time_slot']}. Your original booking is held until you answer.",
        (int) $appointmentId
    );

    $recipientEmail = $row['contact_email'] ?: $row['owner_email'];
    if (!$recipientEmail) return;

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
 * Serialises booking decisions for a date across requests. A failed lock must
 * stop the request: checking availability without it could double-book a day.
 */
function lockSlot($pdo, $date, $timeSlot)
{
    $name = 'bv_slot_' . $date . '_' . $timeSlot;
    $stmt = $pdo->prepare('SELECT GET_LOCK(:name, 5)');
    $stmt->execute([':name' => $name]);
    if ((int) $stmt->fetchColumn() !== 1) {
        respond(503, ['success' => false, 'message' => 'The schedule is busy. Please try again.']);
    }
    return $name;
}

function unlockSlot($pdo, $name)
{
    if ($name === null) return;
    $pdo->prepare('SELECT RELEASE_LOCK(:name)')->execute([':name' => $name]);
}

/**
 * Is this vet's date/time already spoken for? A slot counts as taken when it
 * holds another confirmed booking, and on both sides of a reschedule still
 * awaiting an answer -- the original is held in case the owner declines, the
 * proposed one in case they accept. A pending request does NOT take a slot:
 * only the vet's confirmation does.
 */
function slotConflictExists($pdo, $vetId, $date, $timeSlot, $excludeId)
{
    ensureAnimalVisitSchema($pdo);
    ensureRescheduleSchema($pdo);
    $dayBlock = $pdo->prepare("SELECT id FROM appointments WHERE id <> :id AND visit_mode = 'field' AND field_schedule_scope = 'day' AND ((preferred_date = :date AND status IN ('confirmed','completed','reschedule_pending','owner_reschedule_pending')) OR (proposed_date = :proposed_date AND status IN ('reschedule_pending','owner_reschedule_pending'))) LIMIT 1");
    $dayBlock->execute([':id' => $excludeId, ':date' => $date, ':proposed_date' => $date]);
    if ($dayBlock->fetchColumn()) return true;
    $heldStatuses = "'confirmed', 'completed', 'reschedule_pending', 'owner_reschedule_pending'";

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
                           AND status IN ('reschedule_pending', 'owner_reschedule_pending'))";
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
                 AND status IN ({$heldStatuses}))
                {$heldClause}
              )
          {$vetClause}
        LIMIT 1
    ");

    $stmt->execute($params);
    return (bool) $stmt->fetchColumn();
}

function appointmentDayConflictExists(PDO $pdo, string $date, int $excludeId): bool
{
    $stmt = $pdo->prepare("SELECT id FROM appointments WHERE id <> :id AND preferred_date = :date AND status IN ('confirmed','completed','reschedule_pending','owner_reschedule_pending') LIMIT 1");
    $stmt->execute([':id' => $excludeId, ':date' => $date]);
    if ($stmt->fetchColumn()) return true;
    if (!ensureRescheduleSchema($pdo)) return false;
    $stmt = $pdo->prepare("SELECT id FROM appointments WHERE id <> :id AND proposed_date = :date AND status IN ('reschedule_pending','owner_reschedule_pending') LIMIT 1");
    $stmt->execute([':id' => $excludeId, ':date' => $date]);
    return (bool) $stmt->fetchColumn();
}

function declineOtherRequestsForDay(PDO $pdo, int $confirmedId, string $date): array
{
    $stmt = $pdo->prepare("SELECT id FROM appointments WHERE id <> :id AND preferred_date = :date AND status = 'pending'");
    $stmt->execute([':id' => $confirmedId, ':date' => $date]);
    $ids = array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
    $update = $pdo->prepare("UPDATE appointments SET status = 'rejected', cancelled_at = NOW(), review_notes = 'Clinic closed for a field visit.' WHERE id = :id AND status = 'pending'");
    foreach ($ids as $id) $update->execute([':id' => $id]);
    return $ids;
}

function rescheduleAppointment($pdo, $data, $session = null)
{
    ensureAnimalVisitSchema($pdo);
    $appointmentId = (int) ($data['appointment_id'] ?? $data['id'] ?? 0);
    $date = clean($data['preferred_date'] ?? $data['date'] ?? '');
    $timeSlot = canonicalTimeSlot($data['time_slot'] ?? '');

    if ($appointmentId <= 0) {
        respond(422, ['success' => false, 'message' => 'Invalid appointment id.']);
    }
    assertSchedulableDate($date, 'Cannot reschedule to a past date.');
    if (!in_array($timeSlot, BV_BOOKING_SLOTS, true)) {
        respond(422, ['success' => false, 'message' => 'Choose one of the clinic appointment time slots.']);
    }
    if ($date === date('Y-m-d') && strtotime("{$date} {$timeSlot}") <= time()) {
        respond(422, ['success' => false, 'message' => 'That time slot has already passed today. Please choose a later time.']);
    }

    $stmt = $pdo->prepare('
        SELECT id, veterinarian_id, status, preferred_date, time_slot, field_schedule_scope
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

    $currentStatus = (string) ($appointment['status'] ?? 'pending');
    if (in_array($currentStatus, ['cancelled', 'rejected', 'expired'], true)) {
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
    if ($currentStatus === 'owner_reschedule_pending') {
        respond(409, [
            'success' => false,
            'message' => 'The pet owner already requested a new time. Review that request before proposing another reschedule.'
        ]);
    }
    if ($date === $appointment['preferred_date'] && $timeSlot === $appointment['time_slot']) {
        respond(422, [
            'success' => false,
            'message' => 'That is already the scheduled date and time.'
        ]);
    }

    $slotLock = lockSlot($pdo, $date, 'day');
    if (($appointment['field_schedule_scope'] === 'day' && appointmentDayConflictExists($pdo, $date, $appointmentId)) || slotConflictExists($pdo, $vetId, $date, $timeSlot, $appointmentId)) {
        unlockSlot($pdo, $slotLock);
        respond(409, ['success' => false, 'message' => 'That time slot is already booked.']);
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
    unlockSlot($pdo, $slotLock);

    notifyOwnerRescheduleProposed($pdo, $appointmentId);

    respond(200, [
        'success' => true,
        'message' => 'Reschedule proposed. The pet owner has been asked to confirm.'
    ]);
}

/**
 * Owner asks to move a confirmed appointment. The clinic must approve the
 * requested slot; until then both the current and requested slots are held.
 */
function requestOwnerReschedule($pdo, $data, $session)
{
    ensureAnimalVisitSchema($pdo);
    $appointmentId = (int) ($data['appointment_id'] ?? $data['id'] ?? 0);
    $date = clean($data['preferred_date'] ?? $data['date'] ?? '');
    $timeSlot = canonicalTimeSlot($data['time_slot'] ?? '');
    $reason = clean($data['reason'] ?? '');

    if ($appointmentId <= 0) {
        respond(422, ['success' => false, 'message' => 'Invalid appointment id.']);
    }
    assertSchedulableDate($date, 'Cannot reschedule to a past date.');
    if (!in_array($timeSlot, BV_BOOKING_SLOTS, true)) {
        respond(422, ['success' => false, 'message' => 'Choose one of the clinic appointment time slots.']);
    }
    if (mb_strlen($reason, 'UTF-8') > 255) {
        respond(422, ['success' => false, 'message' => 'The reschedule reason must be 255 characters or fewer.']);
    }
    if ($date === date('Y-m-d') && strtotime("{$date} {$timeSlot}") <= time()) {
        respond(422, ['success' => false, 'message' => 'That time slot has already passed today. Please choose a later time.']);
    }

    $stmt = $pdo->prepare('
        SELECT appointments.id, appointments.owner_id, appointments.veterinarian_id,
               appointments.status, appointments.preferred_date, appointments.time_slot, appointments.field_schedule_scope,
               owners.full_name AS owner_name, pets.pet_name
        FROM appointments
        INNER JOIN users owners ON owners.id = appointments.owner_id
        LEFT JOIN pets ON pets.id = appointments.pet_id
        WHERE appointments.id = :id
        LIMIT 1
    ');
    $stmt->execute([':id' => $appointmentId]);
    $appointment = $stmt->fetch();
    if (!$appointment) {
        respond(404, ['success' => false, 'message' => 'Appointment not found.']);
    }
    if ((int) $appointment['owner_id'] !== (int) ($session['user_id'] ?? 0)) {
        respond(403, ['success' => false, 'message' => 'You can only reschedule your own appointments.']);
    }

    $currentStatus = (string) ($appointment['status'] ?? '');
    if (!in_array($currentStatus, ['confirmed', 'completed'], true)) {
        respond(409, ['success' => false, 'message' => 'Only confirmed or completed appointments can be rescheduled.']);
    }
    if ($date === $appointment['preferred_date'] && $timeSlot === canonicalTimeSlot($appointment['time_slot'])) {
        respond(422, ['success' => false, 'message' => 'That is already the scheduled date and time.']);
    }

    $vetId = (int) ($appointment['veterinarian_id'] ?? 0);
    $slotLock = lockSlot($pdo, $date, 'day');
    if (($appointment['field_schedule_scope'] === 'day' && appointmentDayConflictExists($pdo, $date, $appointmentId)) || slotConflictExists($pdo, $vetId, $date, $timeSlot, $appointmentId)) {
        unlockSlot($pdo, $slotLock);
        respond(409, ['success' => false, 'message' => 'That time slot is already booked. Please choose another slot.']);
    }

    $update = $pdo->prepare("
        UPDATE appointments
        SET proposed_date = :date,
            proposed_time_slot = :time_slot,
            reschedule_reason = :reason,
            reschedule_requested_by = :by,
            reschedule_requested_at = NOW(),
            reschedule_prev_status = :prev_status,
            status = 'owner_reschedule_pending'
        WHERE id = :id AND status = :current_status
    ");
    $update->execute([
        ':date' => $date,
        ':time_slot' => $timeSlot,
        ':reason' => $reason !== '' ? $reason : null,
        ':by' => (int) ($session['user_id'] ?? 0),
        ':prev_status' => $currentStatus,
        ':id' => $appointmentId,
        ':current_status' => $currentStatus,
    ]);
    unlockSlot($pdo, $slotLock);

    if ($update->rowCount() !== 1) {
        respond(409, ['success' => false, 'message' => 'This appointment changed. Refresh the page and try again.']);
    }

    $ownerName = clean($appointment['owner_name'] ?? 'A pet owner');
    $petName = clean($appointment['pet_name'] ?? 'their pet');
    $originalTime = canonicalTimeSlot($appointment['time_slot']);
    notifyUser(
        $pdo,
        (int) $appointment['owner_id'],
        'appointment_reschedule_requested',
        'Reschedule Request Sent',
        "Your request to move the appointment to {$date} at {$timeSlot} was sent to the clinic. Your current booking remains in place until the clinic responds.",
        $appointmentId
    );
    notifyStaff(
        $pdo,
        'both',
        'appointment_reschedule_requested',
        'Owner Requested Reschedule',
        "{$ownerName} requested a new time for {$petName}: {$appointment['preferred_date']} at {$originalTime} to {$date} at {$timeSlot}.",
        $appointmentId,
        true
    );

    respond(200, [
        'success' => true,
        'message' => 'Reschedule request sent. Your current appointment stays in place until the clinic responds.'
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

    // Keep the original status if the owner declines. A completed visit can
    // be proposed again; if accepted, the proposal becomes a confirmed future
    // appointment in the accept branch below.
    $previous = $appointment['reschedule_prev_status'] ?: 'pending';
    if (!in_array($previous, ['pending', 'confirmed', 'completed'], true)) {
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

/** Clinic's approval or decline of a pet owner's proposed appointment time. */
function respondToOwnerReschedule($pdo, $data, $session)
{
    ensureAnimalVisitSchema($pdo);
    $appointmentId = (int) ($data['appointment_id'] ?? $data['id'] ?? 0);
    $decision = clean($data['decision'] ?? '');
    if ($appointmentId <= 0) {
        respond(422, ['success' => false, 'message' => 'Invalid appointment id.']);
    }
    if (!in_array($decision, ['accept', 'decline'], true)) {
        respond(422, ['success' => false, 'message' => 'Decision must be accept or decline.']);
    }

    $stmt = $pdo->prepare('
        SELECT appointments.id, appointments.owner_id, appointments.veterinarian_id,
               appointments.status, appointments.preferred_date, appointments.time_slot,
               appointments.proposed_date, appointments.proposed_time_slot,
               appointments.reschedule_prev_status, appointments.field_schedule_scope
        FROM appointments
        WHERE appointments.id = :id
        LIMIT 1
    ');
    $stmt->execute([':id' => $appointmentId]);
    $appointment = $stmt->fetch();
    if (!$appointment) {
        respond(404, ['success' => false, 'message' => 'Appointment not found.']);
    }
    if (($session['role_name'] ?? '') === 'veterinarian'
        && !empty($appointment['veterinarian_id'])
        && (int) $appointment['veterinarian_id'] !== (int) ($session['user_id'] ?? 0)
    ) {
        respond(403, ['success' => false, 'message' => 'You can only review reschedule requests for appointments assigned to you.']);
    }
    if ($appointment['status'] !== 'owner_reschedule_pending') {
        respond(409, ['success' => false, 'message' => 'This appointment has no owner reschedule request awaiting review.']);
    }

    $ownerId = (int) $appointment['owner_id'];
    $date = (string) $appointment['proposed_date'];
    $timeSlot = canonicalTimeSlot($appointment['proposed_time_slot']);
    $previous = in_array($appointment['reschedule_prev_status'], ['confirmed', 'completed'], true)
        ? $appointment['reschedule_prev_status']
        : 'confirmed';

    if ($decision === 'accept') {
        assertSchedulableDate($date, 'The requested date has passed. Decline the request and ask the owner to submit another time.');
        if ($date === date('Y-m-d') && strtotime("{$date} {$timeSlot}") <= time()) {
            respond(409, ['success' => false, 'message' => 'The requested time has passed today. Decline the request and ask the owner to choose another time.']);
        }
        $slotLock = lockSlot($pdo, $date, 'day');
        if (($appointment['field_schedule_scope'] === 'day' && appointmentDayConflictExists($pdo, $date, $appointmentId)) || slotConflictExists($pdo, (int) ($appointment['veterinarian_id'] ?? 0), $date, $timeSlot, $appointmentId)) {
            unlockSlot($pdo, $slotLock);
            respond(409, ['success' => false, 'message' => 'That requested time is no longer available. Decline the request so the owner can choose another slot.']);
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
            WHERE id = :id AND status = 'owner_reschedule_pending'
        ");
        $update->execute([':date' => $date, ':time_slot' => $timeSlot, ':id' => $appointmentId]);
        unlockSlot($pdo, $slotLock);
        if ($update->rowCount() !== 1) {
            respond(409, ['success' => false, 'message' => 'This request changed. Refresh the page and try again.']);
        }
        notifyUser($pdo, $ownerId, 'appointment_reschedule_approved', 'Reschedule Approved', "The clinic approved your appointment for {$date} at {$timeSlot}.", $appointmentId);
        notifyStaff($pdo, 'both', 'appointment_reschedule_approved', 'Reschedule Approved', "The clinic approved the owner's requested time for appointment #{$appointmentId}.", $appointmentId, false);
        respond(200, ['success' => true, 'message' => 'Reschedule approved. The new appointment time is confirmed.']);
    }

    $update = $pdo->prepare("
        UPDATE appointments
        SET status = :status,
            proposed_date = NULL,
            proposed_time_slot = NULL,
            reschedule_reason = NULL,
            reschedule_requested_by = NULL,
            reschedule_requested_at = NULL,
            reschedule_prev_status = NULL
        WHERE id = :id AND status = 'owner_reschedule_pending'
    ");
    $update->execute([':status' => $previous, ':id' => $appointmentId]);
    if ($update->rowCount() !== 1) {
        respond(409, ['success' => false, 'message' => 'This request changed. Refresh the page and try again.']);
    }
    notifyUser($pdo, $ownerId, 'appointment_reschedule_declined', 'Reschedule Request Declined', "The clinic could not approve the requested time ({$date} at {$timeSlot}). Your original appointment remains scheduled.", $appointmentId);
    notifyStaff($pdo, 'both', 'appointment_reschedule_declined', 'Reschedule Declined', "The clinic declined the owner's requested time for appointment #{$appointmentId}; the original booking remains in place.", $appointmentId, false);
    respond(200, ['success' => true, 'message' => 'Reschedule request declined. The original appointment remains scheduled.']);
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

/**
 * Weekdays the booking calendars must gray out -- holidays and dates the
 * office marked closed -- from today to the end of the booking horizon.
 */
function listClosedDates()
{
    $to = date('Y-m-d', strtotime('+' . BOOKING_HORIZON_MONTHS . ' months'));
    $days = [];
    foreach (clinicClosedDatesBetween(date('Y-m-d'), $to) as $date => $name) {
        $days[] = ['date' => $date, 'name' => $name];
    }
    respond(200, ['success' => true, 'data' => $days]);
}

function getBookedSlots($pdo, $data)
{
    ensureAnimalVisitSchema($pdo);
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
              AND status IN ('reschedule_pending', 'owner_reschedule_pending')
              AND proposed_time_slot IS NOT NULL
              {$vetClause2}
              {$excludeClause2}
        ";
    }

    // Confirmed bookings and both sides of a reschedule request hold a time.
    $stmt = $pdo->prepare("
        SELECT time_slot FROM appointments
        WHERE preferred_date = :date
          AND status IN ('confirmed', 'completed', 'reschedule_pending', 'owner_reschedule_pending')
          {$vetClause}
          {$excludeClause}
        {$proposedUnion}
    ");
    $stmt->execute($params);
    $booked = array_column($stmt->fetchAll(), 'time_slot');
    $wholeDay = $pdo->prepare("SELECT id FROM appointments WHERE visit_mode = 'field' AND field_schedule_scope = 'day' AND ((preferred_date = :date AND status IN ('confirmed','completed','reschedule_pending','owner_reschedule_pending')) OR (proposed_date = :proposed_date AND status IN ('reschedule_pending','owner_reschedule_pending')))" . ($excludeId > 0 ? ' AND id <> :exclude_id' : '') . ' LIMIT 1');
    $dayParams = [':date' => $date, ':proposed_date' => $date];
    if ($excludeId > 0) $dayParams[':exclude_id'] = $excludeId;
    $wholeDay->execute($dayParams);
    if ($wholeDay->fetchColumn()) {
        $booked = array_values(array_unique(array_merge($booked, ['08:00','09:00','10:00','11:00','13:00','14:00','15:00','16:00'])));
    }

    // Times someone has requested but the vet hasn't confirmed yet. Still
    // bookable -- the booking page shows them as "Requested" so an owner
    // knows the vet may give the time to the earlier request instead.
    $pendingParams = [':pdate' => $date];
    $pendingVet = $vetId > 0 ? ' AND (veterinarian_id = :pvet OR veterinarian_id IS NULL)' : '';
    if ($vetId > 0) $pendingParams[':pvet'] = $vetId;
    $pendingExclude = $excludeId > 0 ? ' AND id <> :pexclude' : '';
    if ($excludeId > 0) $pendingParams[':pexclude'] = $excludeId;
    $pending = $pdo->prepare("
        SELECT DISTINCT time_slot FROM appointments
        WHERE preferred_date = :pdate AND status = 'pending'
          {$pendingVet}
          {$pendingExclude}
    ");
    $pending->execute($pendingParams);
    $requested = array_values(array_diff(array_column($pending->fetchAll(), 'time_slot'), $booked));

    respond(200, [
        'success'   => true,
        'booked'    => $booked,
        'requested' => $requested,
    ]);
}
function submitReview($pdo, $data, $callerSession = null)
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

    // A pet owner may only review their own visit. Without this any authenticated
    // owner could rate any completed appointment in the clinic by guessing an id,
    // which would quietly distort the per-vet satisfaction figures. Staff are not
    // constrained here: they never submit reviews through this path.
    if (($callerSession['role_name'] ?? '') === 'pet_owner'
        && (int) $appt['owner_id'] !== (int) $callerSession['user_id']) {
        respond(403, ['success' => false, 'message' => 'You can only review your own appointments.']);
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
$staffActions = ['update_status', 'delete', 'add_visit_type', 'remove_visit_type', 'reschedule', 'respond_owner_reschedule'];
$staffSession = null;
if (in_array($action, $staffActions, true)) {
    require_once __DIR__ . '/../config/auth_guard.php';
    $staffSession = requireRole($pdo, ['veterinarian', 'admin']);
}

// Answering a proposed reschedule is the owner's half of the handshake, so it
// authenticates as the pet owner rather than as staff. respondToReschedule()
// additionally checks the appointment actually belongs to them.
$ownerSession = null;
if (in_array($action, ['respond_reschedule', 'request_reschedule'], true)) {
    require_once __DIR__ . '/../config/auth_guard.php';
    $ownerSession = requireRole($pdo, ['pet_owner']);
}

// Booking, listing and reviewing all act on a specific person's data and had no
// token check at all: owner_id came from the request body, so an unauthenticated
// POST could book an appointment in someone else's name, and `list` sent without
// an owner_id returned EVERY appointment in the clinic -- owner names, pet names,
// dates and contact details.
//
// Staff genuinely do act on other people here: the vet portal books walk-ins
// through findOrCreateOwner() and lists the whole clinic. So this authenticates
// every caller and then constrains only pet owners to their own id, rather than
// forcing one identity on everybody.
$callerSession = null;
if (in_array($action, ['list', 'create', 'submit_review'], true)) {
    require_once __DIR__ . '/../config/auth_guard.php';
    $callerSession = requireRole($pdo, ['pet_owner', 'veterinarian', 'admin']);

    if (($callerSession['role_name'] ?? '') === 'pet_owner') {
        $input['owner_id'] = (int) $callerSession['user_id'];
    }
}

// Resolve the schema once, up front. MySQL implicitly commits on DDL, so
// attempting the migration inside bookAppointment's transaction would silently
// end it and break the rollback -- running it here means every later call just
// reads the cached result.
$rescheduleSchemaReady = ensureRescheduleSchema($pdo);
// Same reason: the time-limit columns are settled before any transaction.
ensureTimedRulesSchema($pdo);
ensureAppointmentContactSchema($pdo);
runTimedRules($pdo);
loadClinicCalendar($pdo);

// The handshake can't run without its columns. Everything else on this
// endpoint works regardless, so only these two actions are blocked.
if (in_array($action, ['reschedule', 'respond_reschedule', 'request_reschedule', 'respond_owner_reschedule'], true) && !$rescheduleSchemaReady) {
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
    if ($action === 'request_reschedule') requestOwnerReschedule($pdo, $input, $ownerSession);
    if ($action === 'respond_owner_reschedule') respondToOwnerReschedule($pdo, $input, $staffSession);
    if ($action === 'delete') deleteAppointment($pdo, $input);
    if ($action === 'vets') listVeterinarians($pdo);
    if ($action === 'booked_slots') getBookedSlots($pdo, $input);
    if ($action === 'closed_dates') listClosedDates();
    if ($action === 'submit_review') submitReview($pdo, $input, $callerSession);
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
} catch (InvalidArgumentException $e) {
    respond(422, ['success' => false, 'message' => $e->getMessage()]);
} catch (PDOException $e) {
    error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    respond(500, [
        'success' => false,
        'message' => 'Appointment request failed.'
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
    ensureAnimalVisitSchema($pdo);
    $vetId = (int)($data['veterinarian_id'] ?? 0);

    $vetStmt = $pdo->prepare("SELECT full_name FROM users WHERE id = :vetId");
    $vetStmt->execute([':vetId' => $vetId]);
    $vetName = $vetStmt->fetchColumn();

    $cases = [];
    if ($vetName) {
        // Restricted to the `diseases` catalog, like the counting queries in
        // api/dashboard/dashboard.php, api/reports/reports.php and
        // api/analytics/arima_service.py. This list is shown to pet owners on
        // the booking page, and the diagnosis form's "Other / Not Listed"
        // option means the column can hold anything a vet typed -- a bare
        // non-empty test would publish that text verbatim to the public.
        $stmt = $pdo->prepare("
            SELECT diagnosis, SUM(COALESCE(affected_count, 1)) AS total
            FROM patient_visit_records
            WHERE attending_vet = :vetName
              AND diagnosis IN (SELECT name FROM diseases WHERE is_active = 1)
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

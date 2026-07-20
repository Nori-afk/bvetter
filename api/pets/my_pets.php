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

function displaySex($sex)
{
    return strtolower((string) $sex) === 'male' ? 'Male' : 'Female';
}

function displayDate($value)
{
    if (!$value) return '';
    $time = strtotime($value);
    return $time ? date('M j, Y', $time) : $value;
}

function statusType($status)
{
    if ($status === 'Monitoring') return 'warning';
    if ($status === 'Critical') return 'danger';
    return 'success';
}

/**
 * Mirrors setupPatientTables() in api/patient-records/patient_records.php so
 * this endpoint works standalone even if the vet module hasn't created
 * these tables yet on a fresh DB.
 */
function setupPetHistoryTables($pdo)
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS patient_record_profiles (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pet_id INT NOT NULL UNIQUE,
            patient_status VARCHAR(60) NOT NULL DEFAULT 'Active Patient',
            health_status VARCHAR(120) NULL,
            alert_text VARCHAR(120) NULL,
            is_archived TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_prp_pet (pet_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS patient_visit_records (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pet_id INT NOT NULL,
            owner_id INT NOT NULL,
            visit_title VARCHAR(160) NULL,
            visit_date DATE NULL,
            follow_up_date DATE NULL,
            symptoms TEXT NULL,
            diagnosis TEXT NULL,
            treatment TEXT NULL,
            medications_json JSON NULL,
            category VARCHAR(80) NULL,
            disease_category VARCHAR(40) NOT NULL DEFAULT 'General/Other',
            attending_vet VARCHAR(160) NULL,
            vaccination_status VARCHAR(120) NULL,
            vaccine_brand VARCHAR(120) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_pvr_pet (pet_id),
            INDEX idx_pvr_visit_date (visit_date),
            INDEX idx_pvr_followup (follow_up_date),
            INDEX idx_pvr_category (category)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS patient_vaccination_records (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pet_id INT NOT NULL,
            visit_id INT NULL,
            vaccine_name VARCHAR(160) NOT NULL,
            description VARCHAR(255) NULL,
            administered_date DATE NULL,
            provider VARCHAR(160) NULL,
            next_due DATE NULL,
            status VARCHAR(120) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_pvacc_pet (pet_id),
            INDEX idx_pvacc_visit (visit_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function mapVisit($row)
{
    return [
        'id' => (int) $row['id'],
        'title' => $row['visit_title'] ?: 'Visit note',
        'date' => displayDate($row['visit_date']),
        'followUp' => $row['follow_up_date'] ? displayDate($row['follow_up_date']) : 'TBD',
        'attendingVet' => $row['attending_vet'],
        'category' => $row['category'],
        'symptoms' => $row['symptoms'],
        'diagnosis' => $row['diagnosis'],
        'treatment' => $row['treatment'],
        'medications' => json_decode($row['medications_json'] ?: '[]', true) ?: [],
        'vaccinationStatus' => $row['vaccination_status'],
    ];
}

function mapVaccination($row)
{
    return [
        'id' => (int) $row['id'],
        'name' => $row['vaccine_name'],
        'description' => $row['description'],
        'date' => displayDate($row['administered_date']),
        'provider' => $row['provider'],
        'nextDue' => $row['next_due'] ? displayDate($row['next_due']) : 'TBD',
        'status' => $row['status'] ?: 'Completed',
    ];
}

function mapPet($pdo, $row, $withHistory)
{
    $visitStmt = $pdo->prepare('SELECT * FROM patient_visit_records WHERE pet_id = :pet_id ORDER BY visit_date DESC, id DESC');
    $visitStmt->execute([':pet_id' => $row['id']]);
    $visits = $visitStmt->fetchAll();

    $vaccStmt = $pdo->prepare('SELECT * FROM patient_vaccination_records WHERE pet_id = :pet_id ORDER BY administered_date DESC, id DESC');
    $vaccStmt->execute([':pet_id' => $row['id']]);
    $vaccinations = $vaccStmt->fetchAll();

    $latest = $visits[0] ?? null;
    $status = $row['patient_status'] ?: 'Active Patient';
    $healthStatus = $row['profile_health_status'] ?: ($row['health_status'] ?: 'Good Standing');
    $lastVisit = $latest ? displayDate($latest['visit_date']) : '';

    $pet = [
        'id' => (int) $row['id'],
        'petName' => $row['pet_name'],
        'species' => $row['species'],
        'breed' => $row['breed'],
        'sex' => displaySex($row['sex']),
        'age' => $row['age'],
        'weight' => $row['weight'],
        'colorMarkings' => $row['color_markings'],
        'photo' => $row['photo'] ?: '',
        'status' => $status,
        'statusType' => statusType($status),
        'healthStatus' => $healthStatus,
        'alert' => $row['alert_text'] ?: '',
        'lastVaccinationDate' => $row['last_vaccination_date'] ? displayDate($row['last_vaccination_date']) : '',
        'lastVisit' => $lastVisit,
        'recordCount' => count($visits),
        'vaccinationCount' => count($vaccinations),
    ];

    if ($withHistory) {
        $pet['visitHistory'] = array_map('mapVisit', $visits);
        $pet['vaccinationHistory'] = array_map('mapVaccination', $vaccinations);
    }

    return $pet;
}

function resolveOwnerId($data)
{
    $ownerId = (int) ($data['owner_id'] ?? $data['ownerId'] ?? $data['user_id'] ?? $data['userId'] ?? 0);
    if ($ownerId <= 0) respond(422, ['success' => false, 'message' => 'Owner id is required.']);
    return $ownerId;
}

function listMyPets($pdo, $data)
{
    $ownerId = resolveOwnerId($data);

    $stmt = $pdo->prepare("
        SELECT pets.*,
               patient_record_profiles.patient_status,
               patient_record_profiles.health_status AS profile_health_status,
               patient_record_profiles.alert_text,
               patient_record_profiles.is_archived
        FROM pets
        LEFT JOIN patient_record_profiles ON patient_record_profiles.pet_id = pets.id
        WHERE pets.owner_id = :owner_id
        ORDER BY pets.created_at DESC
    ");
    $stmt->execute([':owner_id' => $ownerId]);
    $rows = array_filter($stmt->fetchAll(), function ($row) {
        return (int) ($row['is_archived'] ?? 0) === 0;
    });

    $pets = array_map(function ($row) use ($pdo) {
        return mapPet($pdo, $row, false);
    }, array_values($rows));

    respond(200, ['success' => true, 'data' => $pets]);
}

function getMyPetDetail($pdo, $data)
{
    $ownerId = resolveOwnerId($data);
    $petId = (int) ($data['pet_id'] ?? $data['petId'] ?? 0);
    if ($petId <= 0) respond(422, ['success' => false, 'message' => 'Pet id is required.']);

    $stmt = $pdo->prepare("
        SELECT pets.*,
               patient_record_profiles.patient_status,
               patient_record_profiles.health_status AS profile_health_status,
               patient_record_profiles.alert_text
        FROM pets
        LEFT JOIN patient_record_profiles ON patient_record_profiles.pet_id = pets.id
        WHERE pets.id = :pet_id AND pets.owner_id = :owner_id
        LIMIT 1
    ");
    $stmt->execute([':pet_id' => $petId, ':owner_id' => $ownerId]);
    $row = $stmt->fetch();
    if (!$row) respond(404, ['success' => false, 'message' => 'Pet not found.']);

    respond(200, ['success' => true, 'data' => mapPet($pdo, $row, true)]);
}

$input = inputData();
$action = clean($input['action'] ?? 'list');

try {
    setupPetHistoryTables($pdo);

    if ($action === 'list') listMyPets($pdo, $input);
    if ($action === 'detail') getMyPetDetail($pdo, $input);

    respond(400, ['success' => false, 'message' => 'Unknown pets action.']);
} catch (PDOException $e) {
    respond(500, ['success' => false, 'message' => 'My pets request failed.', 'error' => $e->getMessage()]);
}

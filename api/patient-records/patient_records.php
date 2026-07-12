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
    if (is_array($json)) return array_merge($_POST, $json);
    return $_POST;
}

function clean($value)
{
    return trim((string) $value);
}

function normalizeSex($value)
{
    return strtolower(clean($value)) === 'male' ? 'male' : 'female';
}

function statusType($status)
{
    if ($status === 'Monitoring') return 'warning';
    if ($status === 'Critical') return 'danger';
    return 'success';
}

function displaySex($sex)
{
    return strtolower($sex) === 'male' ? 'Male' : 'Female';
}

function displayDate($value)
{
    if (!$value) return '';
    $time = strtotime($value);
    return $time ? date('M j, Y', $time) : $value;
}

function setupPatientTables($pdo)
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
    $columnCheck = $pdo->query("SHOW COLUMNS FROM patient_record_profiles LIKE 'is_archived'")->fetch();
    if (!$columnCheck) {
        $pdo->exec("ALTER TABLE patient_record_profiles ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0");
    }

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
    $diseaseCategoryCheck = $pdo->query("SHOW COLUMNS FROM patient_visit_records LIKE 'disease_category'")->fetch();
    if (!$diseaseCategoryCheck) {
        $pdo->exec("ALTER TABLE patient_visit_records ADD COLUMN disease_category VARCHAR(40) NOT NULL DEFAULT 'General/Other' AFTER category");
        $pdo->exec("ALTER TABLE patient_visit_records ADD INDEX idx_pvr_disease_category (disease_category)");
    }

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

function getRoleId($pdo, $roleName)
{
    $stmt = $pdo->prepare('SELECT id FROM roles WHERE name = :name LIMIT 1');
    $stmt->execute([':name' => $roleName]);
    $row = $stmt->fetch();
    return $row ? (int) $row['id'] : 0;
}

function defaultBarangayId($pdo)
{
    $id = (int) $pdo->query('SELECT id FROM barangays ORDER BY id ASC LIMIT 1')->fetchColumn();
    return $id > 0 ? $id : null;
}

function findOrCreateOwner($pdo, $data)
{
    $email = clean($data['email'] ?? '');
    $ownerName = clean($data['ownerName'] ?? $data['owner_name'] ?? '');
    $phone = clean($data['phone'] ?? '');
    $address = clean($data['address'] ?? '');

    if ($email !== '') {
        $stmt = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
        $stmt->execute([':email' => $email]);
        $existing = $stmt->fetch();
        if ($existing) return (int) $existing['id'];
    }

    if ($ownerName === '') {
        respond(422, ['success' => false, 'message' => 'Owner name is required.']);
    }

    if ($email === '') {
        $email = 'owner_' . substr(sha1($ownerName . microtime(true)), 0, 10) . '@vbetter.local';
    }

    $roleId = getRoleId($pdo, 'pet_owner');
    if ($roleId <= 0) {
        $roleId = getRoleId($pdo, 'owner');
    }

    $stmt = $pdo->prepare("
        INSERT INTO users (role_id, full_name, email, password_hash, phone_number, account_status)
        VALUES (:role_id, :full_name, :email, :password_hash, :phone_number, 'active')
    ");
    $stmt->execute([
        ':role_id' => $roleId ?: null,
        ':full_name' => $ownerName,
        ':email' => $email,
        ':password_hash' => password_hash(bin2hex(random_bytes(8)), PASSWORD_DEFAULT),
        ':phone_number' => $phone,
    ]);
    $ownerId = (int) $pdo->lastInsertId();

    $profile = $pdo->prepare("
        INSERT INTO owner_profiles (user_id, barangay_id, complete_address, verification_status, verified_at)
        VALUES (:user_id, :barangay_id, :complete_address, 'approved', NOW())
    ");
    $profile->execute([
        ':user_id' => $ownerId,
        ':barangay_id' => defaultBarangayId($pdo),
        ':complete_address' => $address,
    ]);

    return $ownerId;
}

function upsertOwnerProfile($pdo, $ownerId, $data)
{
    $ownerName = clean($data['ownerName'] ?? '');
    $phone = clean($data['phone'] ?? '');
    $email = clean($data['email'] ?? '');
    $address = clean($data['address'] ?? '');

    if ($ownerName !== '' || $phone !== '' || $email !== '') {
        $stmt = $pdo->prepare("
            UPDATE users
            SET full_name = COALESCE(NULLIF(:full_name, ''), full_name),
                phone_number = COALESCE(NULLIF(:phone_number, ''), phone_number),
                email = COALESCE(NULLIF(:email, ''), email)
            WHERE id = :id
        ");
        $stmt->execute([
            ':full_name' => $ownerName,
            ':phone_number' => $phone,
            ':email' => $email,
            ':id' => $ownerId,
        ]);
    }

    $exists = $pdo->prepare('SELECT id FROM owner_profiles WHERE user_id = :user_id LIMIT 1');
    $exists->execute([':user_id' => $ownerId]);
    if ($exists->fetch()) {
        $stmt = $pdo->prepare('UPDATE owner_profiles SET complete_address = :address WHERE user_id = :user_id');
    } else {
        $stmt = $pdo->prepare("INSERT INTO owner_profiles (user_id, barangay_id, complete_address, verification_status, verified_at) VALUES (:user_id, :barangay_id, :address, 'approved', NOW())");
    }
    $params = [':user_id' => $ownerId, ':address' => $address];
    if (strpos($stmt->queryString, ':barangay_id') !== false) {
        $params[':barangay_id'] = defaultBarangayId($pdo);
    }
    $stmt->execute($params);
}

function medicationsJson($data)
{
    $medications = $data['medications'] ?? [];
    if (is_string($medications)) {
        $decoded = json_decode($medications, true);
        if (is_array($decoded)) $medications = $decoded;
        else $medications = array_filter(array_map('trim', explode(',', $medications)));
    }
    if (!is_array($medications)) $medications = [];
    return json_encode(array_values(array_filter(array_map('clean', $medications))));
}

function mapVisit($row)
{
    return [
        'id' => (int) $row['id'],
        'title' => $row['visit_title'] ?: 'Visit note',
        'date' => $row['visit_date'],
        'followUp' => $row['follow_up_date'] ?: 'TBD',
        'attendingVet' => $row['attending_vet'],
        'category' => $row['category'],
        'diseaseCategory' => $row['disease_category'],
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
        'date' => $row['administered_date'],
        'provider' => $row['provider'],
        'nextDue' => $row['next_due'] ?: 'TBD',
        'status' => $row['status'] ?: 'Completed',
    ];
}

function mapRecord($pdo, $row)
{
    $visitStmt = $pdo->prepare('SELECT * FROM patient_visit_records WHERE pet_id = :pet_id ORDER BY visit_date DESC, id DESC');
    $visitStmt->execute([':pet_id' => $row['pet_id']]);
    $visits = array_map('mapVisit', $visitStmt->fetchAll());
    $latest = $visits[0] ?? null;

    $vaccStmt = $pdo->prepare('SELECT * FROM patient_vaccination_records WHERE pet_id = :pet_id ORDER BY administered_date DESC, id DESC');
    $vaccStmt->execute([':pet_id' => $row['pet_id']]);
    $vaccinations = array_map('mapVaccination', $vaccStmt->fetchAll());

    $status = $row['patient_status'] ?: 'Active Patient';
    $healthStatus = $row['profile_health_status'] ?: ($row['pet_health_status'] ?: 'Good Standing');
    $followUp = $latest['followUp'] ?? '';
    $alert = $row['alert_text'] ?: ($followUp && $followUp !== 'TBD' ? 'Follow-up set' : '0');
    $lastVisit = $latest && $latest['date'] ? displayDate($latest['date']) : displayDate($row['created_at']);
    $locationParts = array_filter([$row['barangay_name'] ? 'Brgy. ' . $row['barangay_name'] : '', $row['city'], $row['province']]);

    return [
        'id' => (int) $row['pet_id'],
        'petName' => $row['pet_name'],
        'species' => $row['species'],
        'breed' => $row['breed'],
        'age' => $row['age'],
        'sex' => displaySex($row['sex']),
        'weight' => $row['weight'],
        'colorMarkings' => $row['color_markings'],
        'ownerName' => $row['owner_name'],
        'phone' => $row['phone_number'],
        'email' => $row['email'],
        'address' => $row['complete_address'],
        'location' => implode(', ', $locationParts),
        'status' => $status,
        'statusType' => statusType($status),
        'recordCount' => count($visits),
        'lastVisit' => $lastVisit,
        'healthStatus' => $healthStatus,
        'alert' => $alert,
        'visitTitle' => $latest['title'] ?? '',
        'visitDate' => $latest['date'] ?? '',
        'followUpDate' => $latest['followUp'] ?? '',
        'symptoms' => $latest['symptoms'] ?? '',
        'diagnosis' => $latest['diagnosis'] ?? '',
        'treatment' => $latest['treatment'] ?? '',
        'medications' => $latest['medications'] ?? [],
        'category' => $latest['category'] ?? 'Routine Checkup',
        'diseaseCategory' => $latest['diseaseCategory'] ?? 'General/Other',
        'attendingVet' => $latest['attendingVet'] ?? '',
        'vaccinationStatus' => $latest['vaccinationStatus'] ?? '',
        'vaccineBrand' => $vaccinations[0]['name'] ?? '',
        'visitHistory' => $visits,
        'vaccinationHistory' => $vaccinations,
        'history' => array_map(function ($visit) {
            return ['date' => $visit['date'], 'title' => $visit['title'], 'note' => $visit['symptoms']];
        }, $visits),
    ];
}

function listRecords($pdo)
{
    $rows = $pdo->query("
        SELECT
            pets.id AS pet_id,
            pets.pet_name,
            pets.species,
            pets.breed,
            pets.sex,
            pets.age,
            pets.weight,
            pets.color_markings,
            pets.health_status AS pet_health_status,
            pets.created_at,
            users.id AS owner_id,
            users.full_name AS owner_name,
            users.email,
            users.phone_number,
            owner_profiles.complete_address,
            barangays.name AS barangay_name,
            barangays.city,
            barangays.province,
            patient_record_profiles.patient_status,
            patient_record_profiles.health_status AS profile_health_status,
            patient_record_profiles.alert_text
        FROM pets
        INNER JOIN users ON users.id = pets.owner_id
        LEFT JOIN owner_profiles ON owner_profiles.user_id = users.id
        LEFT JOIN barangays ON barangays.id = owner_profiles.barangay_id
        LEFT JOIN patient_record_profiles ON patient_record_profiles.pet_id = pets.id
        WHERE COALESCE(patient_record_profiles.is_archived, 0) = 0
        ORDER BY pets.updated_at DESC, pets.id DESC
    ")->fetchAll();

    $records = array_map(function ($row) use ($pdo) {
        return mapRecord($pdo, $row);
    }, $rows);

    $visitsThisMonth = (int) $pdo->query("SELECT COUNT(*) FROM patient_visit_records WHERE visit_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')")->fetchColumn();
    $infectious = (int) $pdo->query("SELECT COUNT(*) FROM patient_visit_records WHERE LOWER(category) LIKE '%infect%' OR LOWER(diagnosis) LIKE '%infect%'")->fetchColumn();
    $followUps = (int) $pdo->query("SELECT COUNT(*) FROM patient_visit_records WHERE follow_up_date IS NOT NULL AND follow_up_date >= CURDATE()")->fetchColumn();

    respond(200, [
        'success' => true,
        'data' => $records,
        'metrics' => [
            'totalPatients' => count($records),
            'visitsThisMonth' => $visitsThisMonth,
            'infectiousCases' => $infectious,
            'followUpsDue' => $followUps,
        ],
    ]);
}

function insertVisit($pdo, $petId, $ownerId, $data)
{
    $stmt = $pdo->prepare("
        INSERT INTO patient_visit_records
            (pet_id, owner_id, visit_title, visit_date, follow_up_date, symptoms, diagnosis, treatment, medications_json, category, disease_category, attending_vet, vaccination_status, vaccine_brand)
        VALUES
            (:pet_id, :owner_id, :visit_title, :visit_date, :follow_up_date, :symptoms, :diagnosis, :treatment, :medications_json, :category, :disease_category, :attending_vet, :vaccination_status, :vaccine_brand)
    ");
    $visitDate = clean($data['visitDate'] ?? '');
    $followUpDate = clean($data['followUpDate'] ?? '');
    $stmt->execute([
        ':pet_id' => $petId,
        ':owner_id' => $ownerId,
        ':visit_title' => clean($data['visitTitle'] ?? 'Initial visit'),
        ':visit_date' => $visitDate ?: date('Y-m-d'),
        ':follow_up_date' => $followUpDate ?: null,
        ':symptoms' => clean($data['symptoms'] ?? ''),
        ':diagnosis' => clean($data['diagnosis'] ?? ''),
        ':treatment' => clean($data['treatment'] ?? ''),
        ':medications_json' => medicationsJson($data),
        ':category' => clean($data['category'] ?? 'Routine Checkup'),
        ':disease_category' => clean($data['diseaseCategory'] ?? 'General/Other'),
        ':attending_vet' => clean($data['attendingVet'] ?? ''),
        ':vaccination_status' => clean($data['vaccinationStatus'] ?? ''),
        ':vaccine_brand' => clean($data['vaccineBrand'] ?? ''),
    ]);
    $visitId = (int) $pdo->lastInsertId();

    $vaccineBrand = clean($data['vaccineBrand'] ?? '');
    $vaccinationStatus = clean($data['vaccinationStatus'] ?? '');
    if ($vaccineBrand !== '' || $vaccinationStatus !== '') {
        $vacc = $pdo->prepare("
            INSERT INTO patient_vaccination_records
                (pet_id, visit_id, vaccine_name, description, administered_date, provider, next_due, status)
            VALUES
                (:pet_id, :visit_id, :vaccine_name, :description, :administered_date, :provider, :next_due, :status)
        ");
        $vacc->execute([
            ':pet_id' => $petId,
            ':visit_id' => $visitId,
            ':vaccine_name' => $vaccineBrand ?: 'Vaccination record',
            ':description' => $vaccinationStatus,
            ':administered_date' => $visitDate ?: date('Y-m-d'),
            ':provider' => clean($data['attendingVet'] ?? ''),
            ':next_due' => $followUpDate ?: null,
            ':status' => $vaccinationStatus ?: 'Completed',
        ]);
    }
}

function saveRecord($pdo, $data)
{
    $petId = (int) ($data['id'] ?? $data['pet_id'] ?? 0);
    $isNewPet = $petId <= 0;

    $pdo->beginTransaction();

    if ($isNewPet) {
        $ownerId = findOrCreateOwner($pdo, $data);
        $stmt = $pdo->prepare("
            INSERT INTO pets (owner_id, pet_name, species, breed, sex, age, weight, color_markings, health_status, last_vaccination_date)
            VALUES (:owner_id, :pet_name, :species, :breed, :sex, :age, :weight, :color_markings, :health_status, :last_vaccination_date)
        ");
        $stmt->execute([
            ':owner_id' => $ownerId,
            ':pet_name' => clean($data['petName'] ?? ''),
            ':species' => clean($data['species'] ?? ''),
            ':breed' => clean($data['breed'] ?? ''),
            ':sex' => normalizeSex($data['sex'] ?? ''),
            ':age' => clean($data['age'] ?? ''),
            ':weight' => clean($data['weight'] ?? ''),
            ':color_markings' => clean($data['colorMarkings'] ?? ''),
            ':health_status' => clean($data['healthStatus'] ?? 'Good Standing'),
            ':last_vaccination_date' => clean($data['visitDate'] ?? '') ?: null,
        ]);
        $petId = (int) $pdo->lastInsertId();
    } else {
        $ownerStmt = $pdo->prepare('SELECT owner_id FROM pets WHERE id = :id');
        $ownerStmt->execute([':id' => $petId]);
        $ownerId = (int) $ownerStmt->fetchColumn();
        if ($ownerId <= 0) respond(404, ['success' => false, 'message' => 'Patient not found.']);
    }

    $profile = $pdo->prepare("
        INSERT INTO patient_record_profiles (pet_id, patient_status, health_status, alert_text, is_archived)
        VALUES (:pet_id, :patient_status, :health_status, :alert_text, 0)
        ON DUPLICATE KEY UPDATE
            patient_status = VALUES(patient_status),
            health_status = VALUES(health_status),
            alert_text = VALUES(alert_text),
            is_archived = 0
    ");
    $profile->execute([
        ':pet_id' => $petId,
        ':patient_status' => clean($data['status'] ?? 'Active Patient'),
        ':health_status' => clean($data['healthStatus'] ?? 'Good Standing'),
        ':alert_text' => clean($data['alert'] ?? ''),
    ]);

    insertVisit($pdo, $petId, $ownerId, $data);
    $pdo->commit();

    respond(201, ['success' => true, 'id' => $petId, 'message' => 'Patient record saved.']);
}

function updateRecord($pdo, $data)
{
    $petId = (int) ($data['id'] ?? $data['pet_id'] ?? 0);
    if ($petId <= 0) respond(422, ['success' => false, 'message' => 'Invalid patient id.']);

    $stmt = $pdo->prepare('SELECT owner_id FROM pets WHERE id = :id');
    $stmt->execute([':id' => $petId]);
    $ownerId = (int) $stmt->fetchColumn();
    if ($ownerId <= 0) respond(404, ['success' => false, 'message' => 'Patient not found.']);

    $pdo->beginTransaction();
    $stmt = $pdo->prepare("
        UPDATE pets
        SET pet_name = :pet_name,
            species = :species,
            breed = :breed,
            sex = :sex,
            age = :age,
            weight = :weight,
            color_markings = :color_markings,
            health_status = :health_status
        WHERE id = :id
    ");
    $stmt->execute([
        ':pet_name' => clean($data['petName'] ?? ''),
        ':species' => clean($data['species'] ?? ''),
        ':breed' => clean($data['breed'] ?? ''),
        ':sex' => normalizeSex($data['sex'] ?? ''),
        ':age' => clean($data['age'] ?? ''),
        ':weight' => clean($data['weight'] ?? ''),
        ':color_markings' => clean($data['colorMarkings'] ?? ''),
        ':health_status' => clean($data['healthStatus'] ?? ''),
        ':id' => $petId,
    ]);

    upsertOwnerProfile($pdo, $ownerId, $data);

    $profile = $pdo->prepare("
        INSERT INTO patient_record_profiles (pet_id, patient_status, health_status, alert_text, is_archived)
        VALUES (:pet_id, :patient_status, :health_status, :alert_text, 0)
        ON DUPLICATE KEY UPDATE
            patient_status = VALUES(patient_status),
            health_status = VALUES(health_status),
            alert_text = VALUES(alert_text),
            is_archived = 0
    ");
    $profile->execute([
        ':pet_id' => $petId,
        ':patient_status' => clean($data['status'] ?? 'Active Patient'),
        ':health_status' => clean($data['healthStatus'] ?? ''),
        ':alert_text' => clean($data['alert'] ?? ''),
    ]);
    $pdo->commit();

    respond(200, ['success' => true, 'id' => $petId, 'message' => 'Patient record updated.']);
}

function deleteRecord($pdo, $data)
{
    $petId = (int) ($data['id'] ?? $data['pet_id'] ?? 0);
    if ($petId <= 0) respond(422, ['success' => false, 'message' => 'Invalid patient id.']);

    $stmt = $pdo->prepare("
        INSERT INTO patient_record_profiles (pet_id, patient_status, health_status, alert_text, is_archived)
        VALUES (:pet_id, 'Archived', 'Archived', 'Archived', 1)
        ON DUPLICATE KEY UPDATE is_archived = 1, patient_status = 'Archived', alert_text = 'Archived'
    ");
    $stmt->execute([':pet_id' => $petId]);

    respond(200, ['success' => true, 'deleted' => $petId]);
}

$input = inputData();
$action = clean($input['action'] ?? 'list');

try {
    setupPatientTables($pdo);

    if ($action === 'list') listRecords($pdo);
    if ($action === 'save') saveRecord($pdo, $input);
    if ($action === 'update') updateRecord($pdo, $input);
    if ($action === 'delete') deleteRecord($pdo, $input);

    respond(400, ['success' => false, 'message' => 'Unknown patient records action.']);
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    respond(500, [
        'success' => false,
        'message' => 'Patient records request failed.',
        'error' => $e->getMessage(),
    ]);
}

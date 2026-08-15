<?php

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

    $sourceCheck = $pdo->query("SHOW COLUMNS FROM patient_record_profiles LIKE 'source'")->fetch();
    if (!$sourceCheck) {
        // Existing rows predate this column and have no reliable way to know
        // their true origin, so they default to 'walk_in' on backfill — see
        // the caller of ensurePatientRecordFromAppointment() for the only
        // place 'appointment' is ever set going forward.
        $pdo->exec("ALTER TABLE patient_record_profiles ADD COLUMN source ENUM('walk_in','appointment') NOT NULL DEFAULT 'walk_in' AFTER pet_id");
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

    // Snapshot of patient_record_profiles.patient_status at the moment this
    // visit was saved. patient_record_profiles keeps only the pet's CURRENT
    // status (pet_id is UNIQUE there), so without this snapshot an older
    // visit's risk level would silently drift whenever the pet's status
    // later changes -- see db_consultation_rows() in api/reports/reports.php.
    $statusAtVisitCheck = $pdo->query("SHOW COLUMNS FROM patient_visit_records LIKE 'patient_status_at_visit'")->fetch();
    if (!$statusAtVisitCheck) {
        $pdo->exec("ALTER TABLE patient_visit_records ADD COLUMN patient_status_at_visit VARCHAR(60) NULL AFTER disease_category");
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

function ensurePatientRecordFromAppointment($pdo, $appointmentId)
{
    setupPatientTables($pdo);

    $stmt = $pdo->prepare('SELECT pet_id FROM appointments WHERE id = :id');
    $stmt->execute([':id' => $appointmentId]);
    $petId = (int) $stmt->fetchColumn();
    if ($petId <= 0) return;

    $profile = $pdo->prepare("
        INSERT INTO patient_record_profiles (pet_id, patient_status, health_status, alert_text, source, is_archived)
        VALUES (:pet_id, 'Active Patient', 'Good Standing', '', 'appointment', 0)
        ON DUPLICATE KEY UPDATE
            patient_status = VALUES(patient_status),
            health_status = VALUES(health_status),
            is_archived = 0
    ");
    $profile->execute([':pet_id' => $petId]);
}

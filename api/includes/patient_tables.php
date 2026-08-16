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

    setupDiseaseCatalog($pdo);
}

/**
 * Maps Consult_Diagnosis_3Y's ten-value disease_category vocabulary onto the
 * four bucket columns the risk model actually consumes.
 *
 * The RandomForestClassifier's features include skin_ratio / para_ratio /
 * resp_ratio / gastro_ratio (FEATURE_COLS in api/analytics/arima_service.py),
 * which are built from exactly four bucket columns -- but the Excel sheet
 * describes cases with ten richer categories. This collapses one onto the
 * other by each category's dominant clinical sense.
 *
 * This mapping is deliberately NOT validated against Barangay_Disease_Monthly:
 * the two sheets are independent datasets whose totals don't reconcile (their
 * per-barangay-month counts differ ~3-4x), so there is no ground truth to
 * check it against. Categories with no matching bucket stay 'General/Other',
 * which counts toward total_cases without landing in a bucket -- exactly how
 * unrecognised categories already behaved, so this adds no new behaviour.
 */
function diseaseBucketForCategory($displayCategory)
{
    switch (trim((string) $displayCategory)) {
        case 'Skin / external parasite':     return 'Skin';
        case 'Gastrointestinal / parasitic': return 'Gastrointestinal';
        case 'Respiratory':                  return 'Respiratory';
        case 'Vector-borne / parasitic':     return 'Parasitic';
        default:                             return 'General/Other';
    }
}

/**
 * Canonical diagnosis list, seeded once from the Excel's Consult_Diagnosis_3Y
 * sheet so the vet form, the reports and the forecasting pipeline all agree on
 * one vocabulary.
 *
 * Why this exists: live visits only reach the per-disease forecast if their
 * diagnosis text matches the historical series (load_db_consult_rows() in
 * api/analytics/arima_service.py matches on that text), so free-text entries
 * like 'nag susuka' were invisible to prediction. Holding the list in the DB
 * rather than hardcoding it also gives insertVisit() a server-side
 * diagnosis -> category lookup, so the category is derived rather than typed:
 * diagnosis determines it uniquely (all 42 diagnoses map to exactly one
 * category in the source sheet, verified), which is why the form no longer
 * asks for it.
 */
function setupDiseaseCatalog($pdo)
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS diseases (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(160) NOT NULL UNIQUE,
            display_category VARCHAR(60) NOT NULL DEFAULT 'Other',
            bucket_category VARCHAR(40) NOT NULL DEFAULT 'General/Other',
            animal_groups VARCHAR(120) NOT NULL DEFAULT '',
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_diseases_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    // Seeded only while empty. Parsing the 4,986-row sheet is far too costly to
    // repeat on every patient-records request, and re-seeding would also undo
    // any disease the clinic later edits or deactivates through the table.
    if ((int) $pdo->query("SELECT COUNT(*) FROM diseases")->fetchColumn() > 0) return;

    require_once __DIR__ . '/dataset.php';
    $rows = bv_sheet_rows('Consult_Diagnosis_3Y');
    if (!$rows) return;

    $catalog = [];
    foreach ($rows as $row) {
        $name = trim((string) ($row['diagnosis'] ?? ''));
        if ($name === '') continue;
        if (!isset($catalog[$name])) {
            $catalog[$name] = [
                'display_category' => trim((string) ($row['disease_category'] ?? 'Other')),
                'animal_groups'    => [],
            ];
        }
        $group = trim((string) ($row['animal_group'] ?? ''));
        if ($group !== '') $catalog[$name]['animal_groups'][$group] = true;
    }
    if (!$catalog) return;

    $insert = $pdo->prepare("
        INSERT INTO diseases (name, display_category, bucket_category, animal_groups)
        VALUES (:name, :display_category, :bucket_category, :animal_groups)
        ON DUPLICATE KEY UPDATE name = name
    ");
    foreach ($catalog as $name => $meta) {
        $groups = array_keys($meta['animal_groups']);
        sort($groups);
        $insert->execute([
            ':name'             => $name,
            ':display_category' => $meta['display_category'] !== '' ? $meta['display_category'] : 'Other',
            ':bucket_category'  => diseaseBucketForCategory($meta['display_category']),
            ':animal_groups'    => implode(', ', $groups),
        ]);
    }
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

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

    // Barangay and species as of THIS visit, for exactly the same reason as
    // patient_status_at_visit above. Both are otherwise derived by joining
    // pets -> owner_profiles -> barangays, which makes every historical visit
    // answer to the owner's CURRENT profile: edit an owner's barangay and all
    // of their past visits silently move with it, rewriting the surveillance
    // history the Disease Incidence Report is built from.
    //
    // They also let a visit outlive its pet. deleteUserAccount() in
    // api/admin/account-management.php de-identifies visits by clearing pet_id
    // rather than destroying the clinical record; these two columns are what
    // keeps such a row usable for disease surveillance afterwards.
    // Owner barangay: make "unknown" representable, and keep "outside Baliwag"
    // distinct from it.
    //
    // barangay_id was NOT NULL, which is why patient_records.php invented a
    // value (the lowest id in `barangays` -- Tiaong) rather than storing
    // nothing. database/migrations/2026-08-19-apply.php --part=1 is the
    // explicit path for this, but it is mirrored here so a code deploy that
    // lands before the migration still works: the notifications rollout on
    // 2026-08-18 broke production for exactly that window.
    try {
        $barangayCol = $pdo->query("SHOW COLUMNS FROM owner_profiles LIKE 'barangay_id'")->fetch();
        if ($barangayCol && strtoupper($barangayCol['Null']) !== 'YES') {
            $pdo->exec('ALTER TABLE owner_profiles MODIFY barangay_id INT NULL');
        }
        if (!$pdo->query("SHOW COLUMNS FROM owner_profiles LIKE 'is_outside_baliwag'")->fetch()) {
            $pdo->exec('ALTER TABLE owner_profiles ADD COLUMN is_outside_baliwag TINYINT(1) NOT NULL DEFAULT 0 AFTER barangay_id');
        }
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        // owner_profiles may not exist yet on a fresh install; the migration
        // runner covers that case.
    }

    $barangayAtVisitCheck = $pdo->query("SHOW COLUMNS FROM patient_visit_records LIKE 'barangay_at_visit'")->fetch();
    if (!$barangayAtVisitCheck) {
        $pdo->exec("ALTER TABLE patient_visit_records ADD COLUMN barangay_at_visit VARCHAR(120) NULL AFTER patient_status_at_visit");
        $pdo->exec("ALTER TABLE patient_visit_records ADD COLUMN species_at_visit VARCHAR(60) NULL AFTER barangay_at_visit");

        // One-time backfill for visits saved before these columns existed.
        // Only rows whose pet still exists can be recovered; rows already
        // orphaned by an earlier hard delete have no barangay left to find
        // and stay NULL, which the reports render as 'Unspecified'.
        try {
            $pdo->exec("
                UPDATE patient_visit_records pvr
                INNER JOIN pets ON pets.id = pvr.pet_id
                LEFT JOIN owner_profiles op ON op.user_id = pets.owner_id
                LEFT JOIN barangays b ON b.id = op.barangay_id
                SET pvr.barangay_at_visit = CASE WHEN op.is_outside_baliwag = 1 THEN 'Outside Baliwag' ELSE NULLIF(b.name, '') END,
                    pvr.species_at_visit  = NULLIF(pets.species, '')
                WHERE pvr.barangay_at_visit IS NULL
            ");
        } catch (Throwable $e) {
            error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
            // owner_profiles/barangays may not exist yet on a fresh install;
            // the columns are in place either way and new visits fill them.
        }
    }

    // pet_id/owner_id must accept NULL so a visit can be de-identified -- pet
    // and account erased, clinical record retained -- instead of being left
    // pointing at a row that no longer exists.
    foreach (['pet_id', 'owner_id'] as $nullableColumn) {
        $columnInfo = $pdo->query("SHOW COLUMNS FROM patient_visit_records LIKE '{$nullableColumn}'")->fetch();
        if ($columnInfo && strtoupper((string) ($columnInfo['Null'] ?? '')) === 'NO') {
            $pdo->exec("ALTER TABLE patient_visit_records MODIFY COLUMN {$nullableColumn} INT NULL");
        }
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
    setupDiseaseDataCoverage($pdo);
}

/**
 * Records how far the encoder has finished entering patient visits.
 *
 * The forecasting pipeline cannot otherwise tell "this barangay had no cases
 * in February" apart from "February isn't encoded yet", so it conservatively
 * distrusts every live month after the first gap (_arima_safe_frame and
 * _trusted_db_cutoff in api/analytics/arima_service.py). The Excel history it
 * was built on is fully dense -- 27 barangays x 36 months, a row for every
 * combination -- but live consultation data never will be, because a quiet
 * barangay simply produces no row that month.
 *
 * Declaring a cutoff turns that ambiguity into a fact: at or before this
 * month, a missing barangay-month genuinely means zero cases, so the pipeline
 * can fill it and trust the run. Months after it stay distrusted, since they
 * may be only partly entered.
 *
 * Deliberately starts NULL: until someone declares a month complete, behaviour
 * is exactly what it was before this table existed.
 */
function setupDiseaseDataCoverage($pdo)
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS disease_data_coverage (
            id TINYINT NOT NULL PRIMARY KEY,
            complete_through_year INT NULL,
            complete_through_month TINYINT NULL,
            updated_by VARCHAR(160) NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $pdo->exec("INSERT IGNORE INTO disease_data_coverage (id, complete_through_year, complete_through_month) VALUES (1, NULL, NULL)");
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

<?php

header('Content-Type: application/json');

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../includes/patient_tables.php';
require_once __DIR__ . '/../includes/dataset_versions.php';
require_once __DIR__ . '/../config/input_validation.php';
require_once __DIR__ . '/../config/auth_guard.php';
require_once __DIR__ . '/../config/walk_in_accounts.php';

requireRole($pdo, ['veterinarian', 'admin']);

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

function getRoleId($pdo, $roleName)
{
    $stmt = $pdo->prepare('SELECT id FROM roles WHERE name = :name LIMIT 1');
    $stmt->execute([':name' => $roleName]);
    $row = $stmt->fetch();
    return $row ? (int) $row['id'] : 0;
}

/**
 * The barangay the caller actually chose -- never a guess.
 *
 * This replaced defaultBarangayId(), which returned the lowest id in
 * `barangays` (id 3, Tiaong) whenever the vet form omitted a barangay -- which
 * it always did, because the form had no barangay field. Every owner created
 * here was filed under Tiaong regardless of the address typed, and
 * visitSnapshot() froze that onto the visit, so the Disease Incidence Report,
 * Disease Analytics and the per-barangay forecast all inflated one barangay and
 * deflated the rest. Tiaong is a real Baliwag barangay, so the wrong answer
 * never looked wrong.
 *
 * The other three owner-creation paths (register.php, appointments,
 * castration-spay) already require and validate a barangay. This brings the
 * patient-records path in line with them.
 *
 * Returns [barangayId, isOutsideBaliwag]. 'outside' is the one deliberate way
 * to have no barangay: the clinic serves Baliwag, so `barangays` holds only
 * Baliwag rows and an owner from a neighbouring town is otherwise
 * unrepresentable -- which would push the encoder into filing them under a
 * Baliwag barangay they do not live in.
 */
function resolveBarangay($pdo, $data)
{
    $raw = clean($data['barangayId'] ?? $data['barangay_id'] ?? '');

    if (strtolower($raw) === 'outside') {
        return [null, 1];
    }

    $barangayId = (int) $raw;
    if ($barangayId <= 0) {
        respond(422, ['success' => false, 'message' => 'Please select a barangay.']);
    }

    $check = $pdo->prepare('SELECT id FROM barangays WHERE id = :id LIMIT 1');
    $check->execute([':id' => $barangayId]);
    if (!$check->fetch()) {
        respond(422, ['success' => false, 'message' => 'Please select a valid barangay.']);
    }

    return [$barangayId, 0];
}

function findOrCreateOwner($pdo, $data)
{
    $email = clean($data['email'] ?? '');
    $ownerName = clean($data['ownerName'] ?? $data['owner_name'] ?? '');
    $phone = clean($data['phone'] ?? '');
    $address = clean($data['address'] ?? '');

    // Validated up front, so the barangay is required on every save -- not just
    // when the owner happens to be new. The early return below would otherwise
    // let a visit for an existing owner skip the field entirely.
    [$barangayId, $isOutside] = resolveBarangay($pdo, $data);

    if ($email !== '') {
        $stmt = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
        $stmt->execute([':email' => $email]);
        $existing = $stmt->fetch();
        if ($existing) {
            // An owner already on file still gets their barangay refreshed from
            // what was just entered. Without this, an owner carrying the old
            // defaulted Tiaong could never be corrected by ordinary use, and
            // visitSnapshot() would keep stamping the wrong barangay on every
            // new visit -- the original bug, still running.
            $existingId = (int) $existing['id'];
            $pdo->prepare('
                UPDATE owner_profiles
                SET barangay_id = :barangay_id, is_outside_baliwag = :is_outside
                WHERE user_id = :user_id
            ')->execute([
                ':barangay_id' => $barangayId,
                ':is_outside' => $isOutside,
                ':user_id' => $existingId,
            ]);
            return $existingId;
        }
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

    // is_walk_in = 1 whether or not an email was supplied. The flag records how
    // the row was created, not what its address looks like: a vet who types a
    // real email for a brand-new patient still produces someone who never
    // registered and whose password is the discarded random one below. Keying
    // off the '@vbetter.local' suffix instead would miss exactly those rows --
    // see api/config/walk_in_accounts.php.
    //
    // The column is guaranteed by the ensureWalkInSchema() call in the router
    // below, NOT here: saveRecord() and saveBatch() both call this function
    // from inside an open transaction, and ensureWalkInSchema() can run DDL,
    // which forces an implicit commit in MySQL and would silently end that
    // transaction on the first save after a deploy.
    $stmt = $pdo->prepare("
        INSERT INTO users (role_id, full_name, email, password_hash, phone_number, account_status, is_walk_in)
        VALUES (:role_id, :full_name, :email, :password_hash, :phone_number, 'active', 1)
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
        INSERT INTO owner_profiles (user_id, barangay_id, is_outside_baliwag, complete_address, verification_status, verified_at)
        VALUES (:user_id, :barangay_id, :is_outside, :complete_address, 'approved', NOW())
    ");
    $profile->execute([
        ':user_id' => $ownerId,
        ':barangay_id' => $barangayId,
        ':is_outside' => $isOutside,
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

    // users.email is UNIQUE, so typing an address that already belongs to
    // someone else throws SQLSTATE 23000 and lands in the catch-all at the
    // bottom of this file as "Patient records request failed." -- which tells
    // the vet nothing and looks like an outage. Checked up front instead so
    // the real reason reaches them.
    if ($email !== '') {
        $clash = $pdo->prepare('SELECT id FROM users WHERE email = :email AND id <> :id LIMIT 1');
        $clash->execute([':email' => $email, ':id' => $ownerId]);
        if ($clash->fetch()) {
            respond(409, [
                'success' => false,
                'message' => 'That email address already belongs to another account. Leave the field blank to keep this record as it is.',
            ]);
        }
    }

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

    // barangay_id used to be written on INSERT only, so an owner's barangay
    // could never be corrected once set -- the reason the defaulted Tiaong rows
    // were stuck. It is updated here too now.
    //
    // Correcting a profile deliberately does NOT rewrite barangay_at_visit on
    // past visits: that snapshot exists so surveillance history stays put when
    // an owner moves house. Use action=resync_visit_barangay to move a single
    // visit when the snapshot itself was the mistake.
    [$barangayId, $isOutside] = resolveBarangay($pdo, $data);

    $exists = $pdo->prepare('SELECT id FROM owner_profiles WHERE user_id = :user_id LIMIT 1');
    $exists->execute([':user_id' => $ownerId]);

    if ($exists->fetch()) {
        $stmt = $pdo->prepare('
            UPDATE owner_profiles
            SET complete_address = :address,
                barangay_id = :barangay_id,
                is_outside_baliwag = :is_outside
            WHERE user_id = :user_id
        ');
    } else {
        $stmt = $pdo->prepare("
            INSERT INTO owner_profiles (user_id, barangay_id, is_outside_baliwag, complete_address, verification_status, verified_at)
            VALUES (:user_id, :barangay_id, :is_outside, :address, 'approved', NOW())
        ");
    }

    $stmt->execute([
        ':user_id' => $ownerId,
        ':address' => $address,
        ':barangay_id' => $barangayId,
        ':is_outside' => $isOutside,
    ]);
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
        'diagnosis' => apiSafeText($row['diagnosis']),
        'treatment' => $row['treatment'],
        'medications' => json_decode($row['medications_json'] ?: '[]', true) ?: [],
        'vaccinationStatus' => $row['vaccination_status'],
        // Surfaced so the vet can see what this case is actually reported under
        // and correct it -- the value the Disease Incidence Report reads, not
        // the owner's present-day barangay.
        'barangayAtVisit' => $row['barangay_at_visit'] ?: null,
    ];
}

function mapVaccination($row)
{
    return [
        'id' => (int) $row['id'],
        'name' => $row['vaccine_name'],
        'description' => apiSafeText($row['description']),
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
    // The table column reads this. It must never silently fall back to
    // complete_address: that is what let the owner panel show one barangay
    // while the table showed another. An owner with no barangay reads
    // 'Unspecified' -- visibly missing rather than quietly substituted.
    if ((int) ($row['is_outside_baliwag'] ?? 0) === 1) {
        $location = 'Outside Baliwag';
    } elseif ($row['barangay_name']) {
        $location = implode(', ', array_filter(['Brgy. ' . $row['barangay_name'], $row['city'], $row['province']]));
    } else {
        $location = 'Unspecified';
    }

    return [
        'id' => (int) $row['pet_id'],
        'ownerId' => (int) $row['owner_id'],
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
        'location' => $location,
        'barangayId' => $row['barangay_id'] !== null ? (int) $row['barangay_id'] : null,
        'isOutsideBaliwag' => (int) ($row['is_outside_baliwag'] ?? 0) === 1,
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
        'diagnosis' => apiSafeText($latest['diagnosis'] ?? ''),
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
            owner_profiles.barangay_id,
            owner_profiles.is_outside_baliwag,
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
          AND (
              patient_record_profiles.pet_id IS NOT NULL
              OR EXISTS (
                  SELECT 1 FROM appointments a
                  WHERE a.pet_id = pets.id AND a.status IN ('confirmed', 'completed')
              )
          )
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

/**
 * Every visit date passes through here. saveRecord() and saveBatch() are the
 * only actions that create a visit -- updateRecord() never writes visit_date
 * and addPetForOwner() creates no visit -- so this is the whole server-side
 * surface for date rules.
 *
 * The uploaded-dataset rule lives in bv_manual_entry_allowed_from()
 * (api/includes/dataset_versions.php), which is the single source of truth for
 * the covered range. Look there first if the boundary behaviour ever needs to
 * change.
 */
function validateVisitDates($pdo, $data)
{
    $today = date('Y-m-d');
    $visitDate = clean($data['visitDate'] ?? '');
    $followUpDate = clean($data['followUpDate'] ?? '');

    if ($visitDate !== '' && $visitDate > $today) {
        respond(400, ['success' => false, 'message' => 'Visit date cannot be in the future.']);
    }
    if ($followUpDate !== '' && $followUpDate < $today) {
        respond(400, ['success' => false, 'message' => 'Follow-up date cannot be in the past.']);
    }

    // Records for months an uploaded file already covers are managed through
    // uploads, not manual entry. Without this the visit would save happily and
    // then be excluded from every chart and forecast with nothing to explain it.
    //
    // Only dates INSIDE the covered range are blocked. Yesterday's visit, or any
    // date after the upload ends, is unaffected -- this is not a ban on
    // backdating.
    if ($visitDate === '') return;
    $allowedFrom = bv_manual_entry_allowed_from($pdo);
    if ($allowedFrom !== null && $visitDate < $allowedFrom) {
        $month = date('F Y', strtotime($visitDate));
        respond(422, [
            'success' => false,
            'message' => "$month is already covered by an uploaded records file. "
                       . "Records up to " . date('F j, Y', strtotime($allowedFrom . ' -1 day'))
                       . " are managed through file uploads, not manual entry. "
                       . "You can enter visits dated " . date('F j, Y', strtotime($allowedFrom))
                       . " onwards.",
            'allowedFrom' => $allowedFrom,
        ]);
    }
}

/**
 * Looks the disease category up from the diagnosis rather than trusting the
 * client to send one. Every diagnosis in the catalog maps to exactly one
 * category, so asking the vet to pick it separately was redundant and let the
 * two disagree -- a "Rabies (Suspected)" visit could be filed as General/Other.
 * Anything not in the catalog (the form's "Other / Not Listed" free text) has
 * no known category and falls back to 'General/Other', which counts toward
 * total_cases without landing in a model bucket.
 */
function deriveDiseaseCategory($pdo, $diagnosis)
{
    $diagnosis = clean($diagnosis);
    if ($diagnosis === '') return 'General/Other';

    // display_category (ten values, straight from Consult_Diagnosis_3Y), NOT
    // bucket_category (five).
    //
    // The four-bucket scheme collapsed 18 of 42 diagnoses into 'General/Other'
    // -- including BOTH reportable ones, Rabies (Suspected) and Leptospirosis.
    // A live rabies case was therefore stored under the same label as a dental
    // problem, which made the single most action-worthy signal in the system
    // impossible to see in live data. Surveillance cannot flag what it cannot
    // distinguish.
    //
    // The buckets existed to feed skin_ratio/para_ratio/etc. to a classifier
    // trained on Barangay_Disease_Monthly. That sheet is no longer read (the
    // pipeline is single-source on the consultations now) and
    // load_db_disease_monthly(), the only consumer that matched on the bucket
    // strings, is dead code. So nothing needs the narrower vocabulary any more.
    try {
        $stmt = $pdo->prepare('SELECT display_category FROM diseases WHERE name = :name LIMIT 1');
        $stmt->execute([':name' => $diagnosis]);
        $category = $stmt->fetchColumn();
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        return 'General/Other';
    }

    return $category !== false && $category !== null && trim((string) $category) !== ''
        ? (string) $category
        : 'General/Other';
}

function getCoverage($pdo)
{
    $row = $pdo->query("SELECT complete_through_year, complete_through_month, updated_by, updated_at
                        FROM disease_data_coverage WHERE id = 1")->fetch();
    // uploadCoverage is a DIFFERENT concept from the encoding declaration above
    // and is deliberately a separate key. The declaration says "entry is
    // finished through month X"; this says "an uploaded file OWNS months up to
    // X, so do not enter them by hand". Conflating the two would block manual
    // entry the moment an encoder reported progress.
    respond(200, [
        'success' => true,
        'data' => [
            'year'      => $row && $row['complete_through_year'] !== null ? (int) $row['complete_through_year'] : null,
            'month'     => $row && $row['complete_through_month'] !== null ? (int) $row['complete_through_month'] : null,
            'updatedBy' => $row['updated_by'] ?? null,
            'updatedAt' => $row['updated_at'] ?? null,
        ],
        'uploadCoverage' => (function () use ($pdo) {
            $coverage = bv_active_upload_coverage($pdo);
            if (!$coverage) return null;
            return [
                'from'        => $coverage['from'],
                'through'     => $coverage['through'],
                'allowedFrom' => bv_manual_entry_allowed_from($pdo),
                'versionId'   => $coverage['versionId'],
            ];
        })(),
    ]);
}

/**
 * Declares patient-visit encoding complete through a given month, which is what
 * lets the forecasting pipeline treat an empty barangay-month as a real zero
 * instead of un-entered data. See setupDiseaseDataCoverage() for why.
 *
 * Refuses future months: a month that hasn't finished can't have been fully
 * encoded, and declaring one would hand the forecaster a partial month as if it
 * were complete -- the exact failure the trust gate exists to prevent.
 */
function setCoverage($pdo, $data)
{
    $year  = (int) ($data['year'] ?? 0);
    $month = (int) ($data['month'] ?? 0);

    // Clearing the declaration restores the pre-declaration behaviour.
    if ($year === 0 && $month === 0) {
        $pdo->prepare("UPDATE disease_data_coverage
                       SET complete_through_year = NULL, complete_through_month = NULL, updated_by = :by
                       WHERE id = 1")->execute([':by' => clean($data['updatedBy'] ?? '')]);
        respond(200, ['success' => true, 'message' => 'Coverage declaration cleared.']);
    }

    if ($month < 1 || $month > 12 || $year < 2000 || $year > 2100) {
        respond(422, ['success' => false, 'message' => 'Invalid coverage month.']);
    }
    if (($year * 12 + $month) > ((int) date('Y') * 12 + (int) date('n'))) {
        respond(422, ['success' => false, 'message' => 'Cannot declare a future month complete.']);
    }

    $pdo->prepare("UPDATE disease_data_coverage
                   SET complete_through_year = :y, complete_through_month = :m, updated_by = :by
                   WHERE id = 1")
        ->execute([':y' => $year, ':m' => $month, ':by' => clean($data['updatedBy'] ?? '')]);

    // Declaring a month complete makes the forecaster read every empty
    // barangay-month in it as a real zero. If entry isn't actually finished,
    // that hands ARIMA a fabricated collapse to zero -- the precise failure
    // the trust gate was written to catch. Report the density back so a
    // premature declaration is visible immediately instead of surfacing later
    // as a mysteriously crashed forecast.
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM patient_visit_records
                           WHERE visit_date IS NOT NULL
                             AND (YEAR(visit_date) * 12 + MONTH(visit_date)) <= :end");
    $stmt->execute([':end' => $year * 12 + $month]);
    $visits = (int) $stmt->fetchColumn();
    $months = max(1, count_declared_months($pdo, $year, $month));

    $payload = [
        'success' => true,
        'message' => sprintf('Patient records declared complete through %04d-%02d.', $year, $month),
        'visitsInWindow' => $visits,
        'monthsDeclared' => $months,
    ];
    if ($visits < $months) {
        $payload['warning'] = sprintf(
            'Only %d visit(s) recorded across %d declared month(s). If encoding is not actually finished, '
            . 'the forecast will read those empty months as a genuine drop to zero cases.',
            $visits, $months
        );
    }
    respond(200, $payload);
}

/**
 * Months between the historical snapshot's end and the declared cutoff -- i.e.
 * how many months this declaration is vouching for. Anchored on the earliest
 * live visit when one predates the snapshot, so the count never goes negative.
 */
function count_declared_months($pdo, $year, $month)
{
    $first = $pdo->query("SELECT MIN(visit_date) FROM patient_visit_records WHERE visit_date IS NOT NULL")->fetchColumn();
    if (!$first) return 0;
    $startIdx = ((int) date('Y', strtotime($first))) * 12 + (int) date('n', strtotime($first));
    return max(0, ($year * 12 + $month) - $startIdx + 1);
}

function listDiseases($pdo)
{
    try {
        $rows = $pdo->query("
            SELECT name, display_category, bucket_category, animal_groups
            FROM diseases
            WHERE is_active = 1
            ORDER BY name ASC
        ")->fetchAll();
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        $rows = [];
    }

    respond(200, ['success' => true, 'data' => $rows]);
}

/**
 * Barangay and species as they stand at the moment a visit is saved.
 *
 * Written onto the visit row itself (see setupPatientTables) so the Disease
 * Incidence Report attributes a case to where the animal actually was, rather
 * than to wherever its owner's profile happens to point today -- and so the
 * case still counts after the pet or the owner's account is deleted.
 */
function visitSnapshot($pdo, $petId, $ownerId)
{
    try {
        // complete_address is NOT a fallback source here any more. It is free
        // text meaning house number and street -- and for owners created via
        // register.php it holds a barangay name instead -- so reading it as a
        // barangay wrote strings like '123 Rizal St.' into a surveillance
        // column. An owner with no barangay now yields NULL, which the reports
        // render as 'Unspecified': a true statement rather than a wrong one.
        //
        // is_outside_baliwag is kept distinct from NULL. Both mean "no Baliwag
        // barangay", but one is a case that legitimately belongs to another
        // town and the other is a Baliwag case with missing data.
        $stmt = $pdo->prepare("
            SELECT
                CASE
                    WHEN op.is_outside_baliwag = 1 THEN 'Outside Baliwag'
                    ELSE NULLIF(b.name, '')
                END AS barangay,
                NULLIF(pets.species, '') AS species
            FROM pets
            LEFT JOIN owner_profiles op ON op.user_id = COALESCE(pets.owner_id, :owner_id)
            LEFT JOIN barangays b ON b.id = op.barangay_id
            WHERE pets.id = :pet_id
            LIMIT 1
        ");
        $stmt->execute([':pet_id' => $petId, ':owner_id' => $ownerId]);
        $row = $stmt->fetch();
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        return ['barangay' => null, 'species' => null];
    }

    return [
        'barangay' => $row && clean($row['barangay'] ?? '') !== '' ? $row['barangay'] : null,
        'species'  => $row && clean($row['species'] ?? '')  !== '' ? $row['species']  : null,
    ];
}

function insertVisit($pdo, $petId, $ownerId, $data)
{
    $stmt = $pdo->prepare("
        INSERT INTO patient_visit_records
            (pet_id, owner_id, visit_title, visit_date, follow_up_date, symptoms, symptom_cluster, diagnosis, treatment, medications_json, category, disease_category, patient_status_at_visit, barangay_at_visit, species_at_visit, attending_vet, vaccination_status, vaccine_brand)
        VALUES
            (:pet_id, :owner_id, :visit_title, :visit_date, :follow_up_date, :symptoms, :symptom_cluster, :diagnosis, :treatment, :medications_json, :category, :disease_category, :patient_status_at_visit, :barangay_at_visit, :species_at_visit, :attending_vet, :vaccination_status, :vaccine_brand)
    ");
    $visitDate = clean($data['visitDate'] ?? '');
    $followUpDate = clean($data['followUpDate'] ?? '');
    $snapshot = visitSnapshot($pdo, $petId, $ownerId);
    $stmt->execute([
        ':pet_id' => $petId,
        ':owner_id' => $ownerId,
        ':visit_title' => clean($data['visitTitle'] ?? 'Initial visit'),
        ':visit_date' => $visitDate ?: date('Y-m-d'),
        ':follow_up_date' => $followUpDate ?: null,
        ':symptoms' => clean($data['symptoms'] ?? ''),
        // NULL rather than '' when the vet skipped the picker: the analytics
        // pipeline drops null clusters, and an empty string would instead reach
        // the classifier as an unrecognised value.
        ':symptom_cluster' => clean($data['symptomCluster'] ?? '') !== ''
            ? clean($data['symptomCluster']) : null,
        ':diagnosis' => clean($data['diagnosis'] ?? ''),
        ':treatment' => clean($data['treatment'] ?? ''),
        ':medications_json' => medicationsJson($data),
        ':category' => clean($data['category'] ?? 'Routine Checkup'),
        ':disease_category' => deriveDiseaseCategory($pdo, $data['diagnosis'] ?? ''),
        ':patient_status_at_visit' => clean($data['status'] ?? 'Active Patient'),
        ':barangay_at_visit' => $snapshot['barangay'],
        ':species_at_visit' => $snapshot['species'],
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

function insertPetRow($pdo, $ownerId, $data)
{
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
    return (int) $pdo->lastInsertId();
}

function finalizePetVisit($pdo, $petId, $ownerId, $data)
{
    // This path is reached only from the manual Add/Save Patient Record form,
    // so a freshly-created profile is always a walk-in. 'source' is left out
    // of the UPDATE clause so re-saving a visit never overwrites an existing
    // profile's origin (e.g. one created via ensurePatientRecordFromAppointment).
    $profile = $pdo->prepare("
        INSERT INTO patient_record_profiles (pet_id, patient_status, health_status, alert_text, source, is_archived)
        VALUES (:pet_id, :patient_status, :health_status, :alert_text, 'walk_in', 0)
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
}

/**
 * Identity-type fields on a patient record. Clinical free text (diagnosis,
 * notes, medications) is deliberately not here — a vet legitimately writes
 * "temp > 39C" — and is made safe on output instead.
 */
function validatePatientIdentityFields($data): void
{
    $error = firstIdentityFieldError([
        [clean($data['petName']   ?? ''), 'Pet name', 120, 0],
        [clean($data['species']   ?? ''), 'Species', 60, 0],
        [clean($data['breed']     ?? ''), 'Breed', 80, 0],
        [clean($data['ownerName'] ?? $data['owner_name'] ?? ''), 'Owner name', 150, 0],
        [clean($data['attendingVet']  ?? ''), 'Attending vet', 150, 0],
        [clean($data['vaccineBrand']  ?? ''), 'Vaccine brand', 120, 0],
        [clean($data['colorMarkings'] ?? ''), 'Colour and markings', 200, 0],
    ]);
    if ($error !== null) {
        respond(422, ['success' => false, 'message' => $error]);
    }
}

/**
 * Registers another pet under an owner already on file.
 *
 * Takes owner_id directly instead of routing through findOrCreateOwner(),
 * which can only reconnect to an existing owner by exact email match -- so a
 * blank or mistyped email there silently creates a duplicate owner account
 * rather than reusing the real one. The caller opens this from that owner's
 * own record and already knows their id, so the guess is unnecessary.
 *
 * No visit row is written. A pet that has just been registered has not been
 * seen yet, and inventing an empty visit for it would inflate the visit
 * metrics and leave a blank entry in its clinical history.
 */
function addPetForOwner($pdo, $data)
{
    validatePatientIdentityFields($data);

    $ownerId = (int) ($data['ownerId'] ?? $data['owner_id'] ?? 0);
    if ($ownerId <= 0) respond(422, ['success' => false, 'message' => 'Invalid owner id.']);

    $ownerStmt = $pdo->prepare('SELECT id FROM users WHERE id = :id LIMIT 1');
    $ownerStmt->execute([':id' => $ownerId]);
    if (!$ownerStmt->fetchColumn()) respond(404, ['success' => false, 'message' => 'Owner not found.']);

    if (clean($data['petName'] ?? '') === '') {
        respond(422, ['success' => false, 'message' => 'Pet name is required.']);
    }

    $pdo->beginTransaction();
    $petId = insertPetRow($pdo, $ownerId, $data);

    // listRecords() only surfaces pets that have a profile row or a confirmed
    // appointment, so without this the new pet would save but never appear.
    $profile = $pdo->prepare("
        INSERT INTO patient_record_profiles (pet_id, patient_status, health_status, alert_text, source, is_archived)
        VALUES (:pet_id, 'Active Patient', 'Good Standing', '', 'walk_in', 0)
    ");
    $profile->execute([':pet_id' => $petId]);
    $pdo->commit();

    respond(201, ['success' => true, 'id' => $petId, 'message' => 'Pet added.']);
}

function saveRecord($pdo, $data)
{
    validateVisitDates($pdo, $data);
    validatePatientIdentityFields($data);

    $petId = (int) ($data['id'] ?? $data['pet_id'] ?? 0);
    $isNewPet = $petId <= 0;

    $pdo->beginTransaction();

    if ($isNewPet) {
        $ownerId = findOrCreateOwner($pdo, $data);
        $petId = insertPetRow($pdo, $ownerId, $data);
    } else {
        $ownerStmt = $pdo->prepare('SELECT owner_id FROM pets WHERE id = :id');
        $ownerStmt->execute([':id' => $petId]);
        $ownerId = (int) $ownerStmt->fetchColumn();
        if ($ownerId <= 0) respond(404, ['success' => false, 'message' => 'Patient not found.']);
    }

    finalizePetVisit($pdo, $petId, $ownerId, $data);
    $pdo->commit();

    respond(201, ['success' => true, 'id' => $petId, 'message' => 'Patient record saved.']);
}

function saveBatch($pdo, $data)
{
    validateVisitDates($pdo, $data);
    validatePatientIdentityFields($data);

    $pets = $data['pets'] ?? [];
    if (!is_array($pets)) $pets = [];

    // Each pet in the batch carries its own name/species/breed.
    foreach ($pets as $petData) {
        if (is_array($petData)) {
            validatePatientIdentityFields(array_merge($data, $petData));
        }
    }

    $pdo->beginTransaction();

    $ownerId = findOrCreateOwner($pdo, $data);

    $petIds = [];
    foreach ($pets as $petData) {
        if (!is_array($petData) || clean($petData['petName'] ?? '') === '') continue;
        $merged = array_merge($data, $petData);
        $petId = insertPetRow($pdo, $ownerId, $merged);
        finalizePetVisit($pdo, $petId, $ownerId, $merged);
        $petIds[] = $petId;
    }

    if (count($petIds) === 0) {
        $pdo->rollBack();
        respond(422, ['success' => false, 'message' => 'At least one pet name is required.']);
    }

    $pdo->commit();

    respond(201, ['success' => true, 'id' => $petIds[0], 'ids' => $petIds, 'message' => 'Patient records saved.']);
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

    // 'source' defaults to walk_in only on first insert (e.g. editing a
    // pet that has appointments but no profile row yet); it's excluded from
    // the UPDATE clause so an existing 'appointment' origin isn't overwritten.
    $profile = $pdo->prepare("
        INSERT INTO patient_record_profiles (pet_id, patient_status, health_status, alert_text, source, is_archived)
        VALUES (:pet_id, :patient_status, :health_status, :alert_text, 'walk_in', 0)
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

/**
 * Permanently removes pets and everything clinical hanging off them.
 *
 * This is a real DELETE, not the archive flag it replaced. Deleting a patient
 * record here means "this was never a real patient" -- scratch entries,
 * duplicates, typed-in test names -- so the visits attached to it are not
 * cases that happened and must not keep feeding the disease reports or the
 * forecasting model. Hiding them was not enough: an archived record still sat
 * in the database, and anything that queried visits without knowing about the
 * flag went on counting it.
 *
 * Deliberately NOT the de-identify treatment used by deleteUserAccount() in
 * api/admin/account-management.php. That path exists for a real patient whose
 * owner closed their account: the visit is a genuine case, so it is stripped
 * of personal links and kept for surveillance. Junk has no case to preserve,
 * so keeping an anonymised copy would defeat the entire point of deleting it.
 *
 * Order matters. appointments.pet_id and csp_registrations.pet_id are
 * ON DELETE NO ACTION, so the pets row cannot go until they are cleared, and
 * the three patient_* tables carry no foreign key at all -- nothing cascades
 * on their behalf, so skipping them would silently orphan their rows.
 */
function purgePets($pdo, array $petIds)
{
    $petIds = array_values(array_unique(array_filter(array_map('intval', $petIds), fn($id) => $id > 0)));
    if (count($petIds) === 0) return [];

    $placeholders = implode(',', array_fill(0, count($petIds), '?'));

    foreach ([
        'patient_vaccination_records',
        'patient_visit_records',
        'patient_record_profiles',
        'appointments',
        'csp_registrations',
    ] as $table) {
        $pdo->prepare("DELETE FROM {$table} WHERE pet_id IN ({$placeholders})")->execute($petIds);
    }

    $pdo->prepare("DELETE FROM pets WHERE id IN ({$placeholders})")->execute($petIds);

    return $petIds;
}

function deleteRecord($pdo, $data)
{
    $petId = (int) ($data['id'] ?? $data['pet_id'] ?? 0);
    if ($petId <= 0) respond(422, ['success' => false, 'message' => 'Invalid patient id.']);

    $pdo->beginTransaction();
    purgePets($pdo, [$petId]);
    $pdo->commit();

    respond(200, ['success' => true, 'deleted' => $petId]);
}

/**
 * Same purge as deleteRecord(), for a whole batch of ids in one transaction --
 * so clearing out twenty scratch records is one confirmation instead of
 * twenty, and a failure partway through leaves nothing deleted rather than an
 * inconsistent half-done batch.
 */
function bulkDeleteRecords($pdo, $data)
{
    $ids = $data['ids'] ?? [];
    if (!is_array($ids)) $ids = [];

    $pdo->beginTransaction();
    $deleted = purgePets($pdo, $ids);
    if (count($deleted) === 0) {
        $pdo->rollBack();
        respond(422, ['success' => false, 'message' => 'No records selected.']);
    }
    $pdo->commit();

    respond(200, ['success' => true, 'deleted' => $deleted]);
}

/**
 * Re-takes the barangay snapshot for ONE visit from its owner's current
 * profile.
 *
 * barangay_at_visit is frozen on purpose: an owner who moves house must not
 * retroactively relocate every case they ever had, and the snapshot is all that
 * survives de-identification. That makes an encoder's mis-click permanent,
 * though -- and a profile edit alone would leave the owner panel showing the
 * corrected barangay while the report still showed the old one, which is the
 * exact mismatch this whole change exists to remove.
 *
 * So correction is explicit and per-visit. It can only copy a validated
 * barangay_id (or the outside-Baliwag marker), never free text, so it cannot
 * introduce a value the catalog does not contain.
 */
function resyncVisitBarangay($pdo, $data)
{
    $visitId = (int) ($data['visitId'] ?? $data['visit_id'] ?? 0);
    if ($visitId <= 0) respond(422, ['success' => false, 'message' => 'Invalid visit id.']);

    $stmt = $pdo->prepare('SELECT id, pet_id, owner_id, barangay_at_visit FROM patient_visit_records WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $visitId]);
    $visit = $stmt->fetch();
    if (!$visit) respond(404, ['success' => false, 'message' => 'Visit not found.']);

    // A de-identified visit has no owner left to read a barangay from; its
    // snapshot is the only record of where the case happened.
    if (!$visit['owner_id'] && !$visit['pet_id']) {
        respond(409, [
            'success' => false,
            'message' => 'This visit has been de-identified. Its barangay can no longer be recovered.',
        ]);
    }

    $snapshot = visitSnapshot($pdo, (int) $visit['pet_id'], (int) $visit['owner_id']);

    $update = $pdo->prepare('UPDATE patient_visit_records SET barangay_at_visit = :barangay WHERE id = :id');
    $update->execute([':barangay' => $snapshot['barangay'], ':id' => $visitId]);

    respond(200, [
        'success' => true,
        'visitId' => $visitId,
        'from' => $visit['barangay_at_visit'],
        'to' => $snapshot['barangay'],
        'message' => 'Visit barangay updated to ' . ($snapshot['barangay'] ?: 'Unspecified') . '.',
    ]);
}

$input = inputData();
$action = clean($input['action'] ?? 'list');

try {
    // Both of these can run DDL, so they belong here -- before any action
    // opens a transaction -- and never inside one.
    setupPatientTables($pdo);
    ensureWalkInSchema($pdo);

    if ($action === 'list') listRecords($pdo);
    if ($action === 'diseases') listDiseases($pdo);
    if ($action === 'coverage_get') getCoverage($pdo);
    if ($action === 'coverage_set') setCoverage($pdo, $input);
    if ($action === 'save') saveRecord($pdo, $input);
    if ($action === 'save_batch') saveBatch($pdo, $input);
    if ($action === 'add_pet') addPetForOwner($pdo, $input);
    if ($action === 'update') updateRecord($pdo, $input);
    if ($action === 'delete') deleteRecord($pdo, $input);
    if ($action === 'bulk_delete') bulkDeleteRecords($pdo, $input);
    if ($action === 'resync_visit_barangay') resyncVisitBarangay($pdo, $input);

    respond(400, ['success' => false, 'message' => 'Unknown patient records action.']);
} catch (PDOException $e) {
    error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
    if ($pdo->inTransaction()) $pdo->rollBack();

    // Backstop for the same UNIQUE-email clash upsertOwnerProfile() checks for
    // up front. That check is the one that normally fires; this covers the race
    // where the address is taken between the check and the write, and any other
    // path that reaches a duplicate key.
    if ($e->getCode() === '23000') {
        respond(409, [
            'success' => false,
            'message' => 'That email address already belongs to another account.',
        ]);
    }

    respond(500, [
        'success' => false,
        'message' => 'Patient records request failed.',
    ]);
}

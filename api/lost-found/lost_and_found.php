<?php

header('Content-Type: application/json');

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';
if ($method !== 'POST') {
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
require_once __DIR__ . '/matching.php';
require_once __DIR__ . '/../includes/timed_rules.php';

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

function nullableClean($value)
{
    $value = clean($value);
    return $value === '' ? null : $value;
}

function normalizeType($type)
{
    $type = strtolower(clean($type));
    return $type === 'found' ? 'found' : 'lost';
}

function normalizeRole($role)
{
    $role = strtolower(clean($role));
    if ($role === 'veterinarian') return 'vet';
    if ($role === 'pet_owner') return 'owner';
    return $role;
}

function normalizeStatus($status, $fallback = 'pending')
{
    $status = strtolower(clean($status));
    $allowed = ['pending', 'active', 'resolved', 'rejected', 'expired', 'dismissed', 'approved', 'awaiting_handoff'];
    return in_array($status, $allowed, true) ? $status : $fallback;
}

function normalizeSpecies($species)
{
    $species = strtolower(clean($species));
    $aliases = [
        'canine' => 'Dog',
        'dog' => 'Dog',
        'dogs' => 'Dog',
        'feline' => 'Cat',
        'cat' => 'Cat',
        'cats' => 'Cat',
        'avian' => 'Other',
        'bird' => 'Other',
        'birds' => 'Other',
        'other' => 'Other',
        'others' => 'Other',
    ];
    return $aliases[$species] ?? ucfirst($species);
}

function ensureLostFoundSchema($pdo)
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS lost_found_reports (
            id INT AUTO_INCREMENT PRIMARY KEY,
            case_number VARCHAR(40) NOT NULL UNIQUE,
            report_type ENUM('lost','found') NOT NULL,
            status ENUM('pending','active','resolved','rejected','expired') NOT NULL DEFAULT 'pending',
            source ENUM('owner','vet','admin','public') NOT NULL DEFAULT 'owner',
            owner_id INT NULL,
            pet_name VARCHAR(120) NULL,
            species VARCHAR(60) NULL,
            breed VARCHAR(120) NULL,
            sex VARCHAR(30) NULL,
            size VARCHAR(60) NULL,
            color_markings TEXT NULL,
            notes TEXT NULL,
            barangay_id INT NULL,
            barangay_name VARCHAR(120) NULL,
            location_text VARCHAR(255) NULL,
            latitude DECIMAL(10,7) NULL,
            longitude DECIMAL(10,7) NULL,
            incident_date DATE NULL,
            incident_time TIME NULL,
            photo_path VARCHAR(255) NULL,
            image_features LONGTEXT NULL,
            contact_name VARCHAR(150) NULL,
            contact_phone VARCHAR(40) NULL,
            contact_email VARCHAR(150) NULL,
            reviewed_by_user_id INT NULL,
            review_notes TEXT NULL,
            reviewed_at DATETIME NULL,
            resolved_at DATETIME NULL,
            expires_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_lfr_type_status (report_type, status),
            INDEX idx_lfr_barangay (barangay_id),
            INDEX idx_lfr_owner (owner_id),
            CONSTRAINT fk_lfr_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
            CONSTRAINT fk_lfr_barangay FOREIGN KEY (barangay_id) REFERENCES barangays(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS lost_found_sightings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            case_number VARCHAR(40) NOT NULL UNIQUE,
            report_id INT NULL,
            submitted_by_user_id INT NULL,
            status ENUM('pending','active','resolved','rejected') NOT NULL DEFAULT 'pending',
            barangay_id INT NULL,
            barangay_name VARCHAR(120) NULL,
            location_text VARCHAR(255) NULL,
            latitude DECIMAL(10,7) NULL,
            longitude DECIMAL(10,7) NULL,
            sighting_date DATE NULL,
            sighting_time TIME NULL,
            notes TEXT NULL,
            photo_path VARCHAR(255) NULL,
            image_features LONGTEXT NULL,
            contact_name VARCHAR(150) NULL,
            contact_phone VARCHAR(40) NULL,
            contact_email VARCHAR(150) NULL,
            reviewed_by_user_id INT NULL,
            reviewed_at DATETIME NULL,
            review_notes TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_lfs_report (report_id),
            INDEX idx_lfs_status (status),
            CONSTRAINT fk_lfs_report FOREIGN KEY (report_id) REFERENCES lost_found_reports(id) ON DELETE SET NULL,
            CONSTRAINT fk_lfs_user FOREIGN KEY (submitted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
            CONSTRAINT fk_lfs_barangay FOREIGN KEY (barangay_id) REFERENCES barangays(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS lost_found_matches (
            id INT AUTO_INCREMENT PRIMARY KEY,
            lost_report_id INT NOT NULL,
            found_report_id INT NULL,
            sighting_id INT NULL,
            confidence TINYINT UNSIGNED NOT NULL DEFAULT 0,
            reasons_json LONGTEXT NULL,
            status ENUM('suggested','approved','dismissed') NOT NULL DEFAULT 'suggested',
            reviewed_by_user_id INT NULL,
            reviewed_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_lfm_pair (lost_report_id, found_report_id, sighting_id),
            INDEX idx_lfm_status (status),
            CONSTRAINT fk_lfm_lost FOREIGN KEY (lost_report_id) REFERENCES lost_found_reports(id) ON DELETE CASCADE,
            CONSTRAINT fk_lfm_found FOREIGN KEY (found_report_id) REFERENCES lost_found_reports(id) ON DELETE CASCADE,
            CONSTRAINT fk_lfm_sighting FOREIGN KEY (sighting_id) REFERENCES lost_found_sightings(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS lost_found_claims (
            id INT AUTO_INCREMENT PRIMARY KEY,
            case_number VARCHAR(40) NOT NULL UNIQUE,
            report_id INT NOT NULL,
            claimant_user_id INT NULL,
            status ENUM('pending','approved','awaiting_handoff','rejected','resolved') NOT NULL DEFAULT 'pending',
            claimant_name VARCHAR(150) NULL,
            claimant_phone VARCHAR(40) NULL,
            claimant_email VARCHAR(150) NULL,
            match_id INT NULL,
            proof_type VARCHAR(80) NULL,
            proof_notes TEXT NULL,
            proof_file_path VARCHAR(255) NULL,
            reviewed_by_user_id INT NULL,
            reviewed_at DATETIME NULL,
            review_notes TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_lfc_report (report_id),
            INDEX idx_lfc_match (match_id),
            INDEX idx_lfc_status (status),
            CONSTRAINT fk_lfc_report FOREIGN KEY (report_id) REFERENCES lost_found_reports(id) ON DELETE CASCADE,
            CONSTRAINT fk_lfc_user FOREIGN KEY (claimant_user_id) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function ensureClaimWorkflowSchema($pdo)
{
    $status = $pdo->query("SHOW COLUMNS FROM lost_found_claims LIKE 'status'")->fetch();
    if ($status && strpos((string) ($status['Type'] ?? ''), "'awaiting_handoff'") === false) {
        $pdo->exec("ALTER TABLE lost_found_claims MODIFY status ENUM('pending','approved','awaiting_handoff','rejected','resolved') NOT NULL DEFAULT 'pending'");
    }

    $matchColumn = $pdo->query("SHOW COLUMNS FROM lost_found_claims LIKE 'match_id'")->fetch();
    if (!$matchColumn) {
        $pdo->exec('ALTER TABLE lost_found_claims ADD COLUMN match_id INT NULL AFTER report_id');
    }

    $matchIndex = $pdo->query("SHOW INDEX FROM lost_found_claims WHERE Key_name = 'idx_lfc_match'")->fetch();
    if (!$matchIndex) {
        $pdo->exec('ALTER TABLE lost_found_claims ADD INDEX idx_lfc_match (match_id)');
    }
}

/** Ensure existing installations can retain reports after their public lifespan. */
function ensureReportLifespanSchema(PDO $pdo): bool
{
    static $ready = null;
    if ($ready !== null) return $ready;

    try {
        $status = $pdo->query("SHOW COLUMNS FROM lost_found_reports LIKE 'status'")->fetch();
        if ($status && strpos((string) ($status['Type'] ?? ''), "'expired'") === false) {
            $pdo->exec("ALTER TABLE lost_found_reports MODIFY status ENUM('pending','active','resolved','rejected','expired') NOT NULL DEFAULT 'pending'");
        }

        if (!$pdo->query("SHOW COLUMNS FROM lost_found_reports LIKE 'expires_at'")->fetch()) {
            $pdo->exec('ALTER TABLE lost_found_reports ADD COLUMN expires_at DATETIME NULL AFTER resolved_at');
        }

        if (!$pdo->query("SHOW INDEX FROM lost_found_reports WHERE Key_name = 'idx_lfr_status_expiry'")->fetch()) {
            $pdo->exec('ALTER TABLE lost_found_reports ADD INDEX idx_lfr_status_expiry (status, expires_at)');
        }

        // Existing reports receive the same three-month lifespan, measured from
        // their original submission time. The expiry sweep below archives
        // overdue open reports without deleting their history.
        $pdo->exec('UPDATE lost_found_reports SET expires_at = DATE_ADD(COALESCE(created_at, NOW()), INTERVAL ' . BV_LF_REPORT_LIFESPAN_MONTHS . ' MONTH) WHERE expires_at IS NULL');
        $ready = true;
    } catch (Throwable $e) {
        error_log('[BVetter] lost & found lifespan schema: ' . $e->getMessage());
        $ready = false;
    }

    return $ready;
}

function generateCaseNumber($prefix)
{
    return strtoupper($prefix) . '-' . date('Ymd') . '-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 6));
}

function findBarangay($pdo, $data)
{
    $barangayId = (int) ($data['barangay_id'] ?? 0);
    $barangayName = clean($data['barangay_name'] ?? $data['barangay'] ?? '');

    if ($barangayId > 0) {
        $stmt = $pdo->prepare('SELECT id, name FROM barangays WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $barangayId]);
        $row = $stmt->fetch();
        if ($row) return [(int) $row['id'], $row['name']];
    }

    if ($barangayName !== '' && strtolower($barangayName) !== 'select barangay') {
        $stmt = $pdo->prepare('SELECT id, name FROM barangays WHERE name = :name LIMIT 1');
        $stmt->execute([':name' => $barangayName]);
        $row = $stmt->fetch();
        if ($row) return [(int) $row['id'], $row['name']];
        return [null, $barangayName];
    }

    return [null, null];
}

function normalizeDate($value)
{
    $value = clean($value);
    if ($value === '') return null;
    $timestamp = strtotime($value);
    return $timestamp ? date('Y-m-d', $timestamp) : null;
}

function normalizeTimeValue($value)
{
    $value = clean($value);
    if ($value === '') return null;
    $timestamp = strtotime($value);
    return $timestamp ? date('H:i:s', $timestamp) : null;
}

function assertDateNotFuture($normalizedDate, $label)
{
    if ($normalizedDate && strtotime($normalizedDate) > strtotime(date('Y-m-d'))) {
        respond(422, ['success' => false, 'message' => "{$label} cannot be a future date."]);
    }
}

function publicUploadPath($fileName, $folder)
{
    return '/storage/' . $folder . '/' . $fileName;
}

function absoluteUploadPath($publicPath)
{
    $publicPath = clean($publicPath);
    if ($publicPath === '') return null;

    $needle = '/storage/';
    $position = strpos($publicPath, $needle);
    if ($position === false) return null;

    $relative = substr($publicPath, $position); // e.g. /storage/lost_found/file.jpg
    $absolute = dirname(dirname(__DIR__)) . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    return file_exists($absolute) ? $absolute : null;
}

function saveUpload($field, $folder, $required = false)
{
    if (!isset($_FILES[$field]) || $_FILES[$field]['error'] === UPLOAD_ERR_NO_FILE) {
        if ($required) {
            respond(422, ['success' => false, 'message' => 'Please upload a pet photo.']);
        }
        return [null, null];
    }

    if ($_FILES[$field]['error'] !== UPLOAD_ERR_OK) {
        respond(422, ['success' => false, 'message' => 'Upload failed. Please try again.']);
    }

    $file = $_FILES[$field];
    if ($file['size'] > 8 * 1024 * 1024) {
        respond(422, ['success' => false, 'message' => 'Uploaded file must not exceed 8MB.']);
    }

    $allowed = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'application/pdf' => 'pdf',
    ];

    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file($file['tmp_name']);
    if (!isset($allowed[$mime])) {
        respond(422, ['success' => false, 'message' => 'Only JPG, PNG, WEBP, or PDF uploads are allowed.']);
    }

    $directory = dirname(dirname(__DIR__)) . '/storage/' . $folder;
    if (!is_dir($directory) && !mkdir($directory, 0775, true)) {
        respond(500, ['success' => false, 'message' => 'Could not create upload directory.']);
    }

    $name = $folder . '_' . time() . '_' . bin2hex(random_bytes(6)) . '.' . $allowed[$mime];
    $absolute = $directory . '/' . $name;

    $moved = move_uploaded_file($file['tmp_name'], $absolute);
    if (!$moved) {
        // Transient lock/permission-propagation issues (common right after a fresh
        // deploy or under momentary disk contention) can make the first attempt fail
        // even though the directory is otherwise writable — one short retry self-heals
        // those without bothering the user.
        usleep(150000);
        $moved = move_uploaded_file($file['tmp_name'], $absolute);
    }

    if (!$moved) {
        $lastError = error_get_last();
        error_log(sprintf(
            'Lost & Found upload failed: field=%s dest=%s dir_writable=%s reason=%s',
            $field,
            $absolute,
            is_writable($directory) ? 'yes' : 'no',
            $lastError['message'] ?? 'unknown'
        ));
        respond(500, ['success' => false, 'message' => 'Could not save uploaded file.']);
    }

    return [publicUploadPath($name, $folder), $absolute];
}

function imageFeatures($absolutePath)
{
    if (!$absolutePath || !file_exists($absolutePath)) {
        return null;
    }

    $pythonFeatures = pythonImageFeatures($absolutePath);
    if ($pythonFeatures) {
        return $pythonFeatures;
    }

    $info = @getimagesize($absolutePath);
    $features = [
        'sha1' => sha1_file($absolutePath),
        'width' => $info ? (int) $info[0] : null,
        'height' => $info ? (int) $info[1] : null,
        'mime' => $info ? $info['mime'] : null,
        'engine' => 'metadata',
    ];

    if ($info && function_exists('imagecreatefromjpeg')) {
        $image = null;
        if ($info['mime'] === 'image/jpeg') $image = @imagecreatefromjpeg($absolutePath);
        if ($info['mime'] === 'image/png') $image = @imagecreatefrompng($absolutePath);
        if ($info['mime'] === 'image/webp' && function_exists('imagecreatefromwebp')) $image = @imagecreatefromwebp($absolutePath);

        if ($image) {
            $w = imagesx($image);
            $h = imagesy($image);
            $sample = 12;
            $r = 0;
            $g = 0;
            $b = 0;
            $brightness = [];
            $count = 0;

            for ($y = 0; $y < $sample; $y++) {
                for ($x = 0; $x < $sample; $x++) {
                    $px = imagecolorat($image, (int) floor($x * max(1, $w - 1) / ($sample - 1)), (int) floor($y * max(1, $h - 1) / ($sample - 1)));
                    $cr = ($px >> 16) & 0xFF;
                    $cg = ($px >> 8) & 0xFF;
                    $cb = $px & 0xFF;
                    $r += $cr;
                    $g += $cg;
                    $b += $cb;
                    $brightness[] = (int) round(($cr + $cg + $cb) / 3);
                    $count++;
                }
            }

            $avg = array_sum($brightness) / max(1, count($brightness));
            $bits = '';
            foreach ($brightness as $value) {
                $bits .= $value >= $avg ? '1' : '0';
            }

            $features['avg_rgb'] = [
                (int) round($r / $count),
                (int) round($g / $count),
                (int) round($b / $count),
            ];
            $features['brightness_hash'] = $bits;
            $features['engine'] = 'gd';
            imagedestroy($image);
        }
    }

    return $features;
}

function pythonImageFeatures($absolutePath)
{
    if (!function_exists('shell_exec')) return null;

    $script = __DIR__ . '/image_matcher.py';
    if (!file_exists($script)) return null;

    $commands = [
        'py -3 ' . escapeshellarg($script) . ' features ' . escapeshellarg($absolutePath),
        'python ' . escapeshellarg($script) . ' features ' . escapeshellarg($absolutePath),
    ];

    foreach ($commands as $command) {
        $output = @shell_exec($command . ' 2>NUL');
        if (!$output) continue;
        $data = json_decode($output, true);
        if (is_array($data) && !empty($data['success']) && isset($data['features'])) {
            return $data['features'];
        }
    }

    return null;
}

function reportRowToArray($row)
{
    return [
        'id' => (int) $row['id'],
        'caseId' => $row['case_number'],
        'case_number' => $row['case_number'],
        'type' => ucfirst($row['report_type']),
        'status' => $row['status'],
        'claimReserved' => !empty($row['claim_reserved']),
        'source' => $row['source'] === 'owner' ? 'Owner' : 'Admin/Clinic',
        'owner_id' => $row['owner_id'] ? (int) $row['owner_id'] : null,
        'petName' => $row['pet_name'] ?: ($row['report_type'] === 'found' ? 'Found Pet Report' : 'Lost Pet Report'),
        'title' => $row['pet_name'] ?: ($row['report_type'] === 'found' ? 'Found Pet Report' : 'Lost Pet Report'),
        'species' => $row['species'],
        'breed' => trim(($row['species'] ? $row['species'] . ' - ' : '') . (string) $row['breed'], ' -'),
        'breedRaw' => $row['breed'],
        'sex' => $row['sex'],
        'size' => $row['size'],
        'markings' => $row['color_markings'],
        'notes' => apiSafeText($row['notes']),
        'barangay' => $row['barangay_name'],
        'location' => $row['location_text'] ?: ($row['barangay_name'] ? $row['barangay_name'] . ', Baliwag' : null),
        'lat' => $row['latitude'] !== null ? (float) $row['latitude'] : null,
        'lng' => $row['longitude'] !== null ? (float) $row['longitude'] : null,
        'date' => $row['incident_date'],
        'time' => $row['incident_time'],
        'dateLost' => $row['incident_date'],
        'timeLost' => $row['incident_time'],
        'image' => $row['photo_path'],
        'uploadedBy' => $row['contact_name'] ?: $row['owner_name'],
        'uploader' => $row['contact_name'] ?: $row['owner_name'],
        'contact' => $row['contact_phone'],
        'email' => $row['contact_email'],
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'] ?? $row['created_at'],
        'resolved_at' => $row['resolved_at'] ?? null,
        'expiresAt' => $row['expires_at'] ?? null,
        // Time limits (api/includes/timed_rules.php): when a pending owner
        // report goes live on its own, and whether a live one got there that
        // way without a vet having looked at it yet.
        'autoPublishAt' => $row['auto_publish_at'] ?? null,
        'autoPublished' => !empty($row['auto_published_at']) && empty($row['reviewed_by_user_id']),
    ];
}

/**
 * Owner reports nobody reviewed within BV_LF_AUTO_PUBLISH_MINUTES go live on
 * their own, tagged "Auto-published" for the vets until one marks it
 * reviewed. Every poster is an ID-verified resident, and a lost pet can't
 * wait for the vets to come back from the field.
 *
 * Runs at the start of every Lost & Found request -- the board loading is
 * exactly when it matters -- and from api/cron/timed-rules.php. Only reports
 * made after this shipped have auto_publish_at; older pending ones stay in
 * the vets' queue.
 */
function autoPublishDueReports($pdo)
{
    try {
        if (!ensureTimedRulesSchema($pdo)) return;

        $stmt = $pdo->prepare("
            SELECT id, owner_id, report_type, pet_name
            FROM lost_found_reports
            WHERE status = 'pending' AND auto_publish_at IS NOT NULL AND auto_publish_at <= :now
        ");
        $stmt->execute([':now' => date('Y-m-d H:i:s')]);

        foreach ($stmt->fetchAll() as $row) {
            $id = (int) $row['id'];
            $publish = $pdo->prepare("UPDATE lost_found_reports SET status = 'active', auto_published_at = NOW() WHERE id = :id AND status = 'pending'");
            $publish->execute([':id' => $id]);
            if ($publish->rowCount() !== 1) continue;

            rebuildMatchesForReport($pdo, $id);
            notifyReportOwnerStatus($pdo, (int) $row['owner_id'], $id, 'active');
            notifyStaff(
                $pdo,
                'both',
                'lost_found_new',
                'Report Auto-Published',
                'A ' . $row['report_type'] . ' pet report' . ($row['pet_name'] ? ' (' . $row['pet_name'] . ')' : '')
                    . ' went live after 3 hours without review. Please check it and mark it reviewed.',
                $id,
                false
            );
        }
    } catch (Throwable $e) {
        error_log('[BVetter] lost & found auto-publish: ' . $e->getMessage());
    }
}

/** Hide overdue reports unless a claim/handoff is open; keep the history. */
function expireOldReports(PDO $pdo): void
{
    if (!ensureReportLifespanSchema($pdo)) return;

    try {
        $stmt = $pdo->query("
            SELECT id, owner_id
            FROM lost_found_reports
            WHERE status IN ('pending','active')
              AND expires_at IS NOT NULL
              AND expires_at <= NOW()
              AND NOT EXISTS (
                  SELECT 1 FROM lost_found_claims open_claim
                  WHERE open_claim.report_id = lost_found_reports.id
                    AND open_claim.status IN ('pending','approved','awaiting_handoff')
              )
        ");

        foreach ($stmt->fetchAll() as $row) {
            $id = (int) $row['id'];
            $expire = $pdo->prepare("UPDATE lost_found_reports SET status = 'expired' WHERE id = :id AND status IN ('pending','active')");
            $expire->execute([':id' => $id]);
            if ($expire->rowCount() === 1) {
                notifyReportOwnerStatus($pdo, (int) $row['owner_id'], $id, 'expired');
            }
        }
    } catch (Throwable $e) {
        error_log('[BVetter] lost & found report expiry: ' . $e->getMessage());
    }
}

/** A vet has now looked at an auto-published report; clears its tag. */
function markReportReviewed($pdo, $data, $staffSession)
{
    $id = (int) ($data['id'] ?? $data['report_id'] ?? 0);
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid report id.']);

    $pdo->prepare('UPDATE lost_found_reports SET reviewed_by_user_id = :user, reviewed_at = NOW() WHERE id = :id')
        ->execute([':user' => (int) $staffSession['user_id'], ':id' => $id]);

    respond(200, ['success' => true, 'message' => 'Marked as reviewed.']);
}

// A logged-out visitor only ever sees reports through the landing page, which
// shows the type, photo, pet name and barangay. Everything that identifies or
// locates the person who posted -- their name, phone, email, account id and the
// exact map pin -- is blanked for them. Fields are nulled rather than removed so
// the response shape stays the same for every caller.
function withoutPosterDetails(array $report)
{
    foreach (['owner_id', 'lat', 'lng', 'uploadedBy', 'uploader', 'contact', 'email'] as $field) {
        $report[$field] = null;
    }
    return $report;
}

function isStaffViewer($viewer)
{
    return $viewer !== null && in_array($viewer['role_name'], ['veterinarian', 'admin'], true);
}

function reportSelectSql()
{
    return "
        SELECT lost_found_reports.*, users.full_name AS owner_name,
               EXISTS (
                   SELECT 1 FROM lost_found_claims reserved_claim
                   WHERE reserved_claim.report_id = lost_found_reports.id
                     AND reserved_claim.status IN ('awaiting_handoff', 'approved')
               ) AS claim_reserved
        FROM lost_found_reports
        LEFT JOIN users ON users.id = lost_found_reports.owner_id
    ";
}

/**
 * How long a claimed/reunited report stays in the main board grid, grayed
 * out, before it moves under the Reunited filter only.
 */
const CLAIMED_ON_BOARD_DAYS = 30;

function listReports($pdo, $data, $management = false, $viewer = null)
{
    $where = [];
    $params = [];

    // The public board shows active reports and, grayed out, the ones resolved
    // in the last CLAIMED_ON_BOARD_DAYS days. A resolved report used to vanish
    // the moment a claim or match was approved, so if the wrong person claimed
    // a pet, its real owner never saw that it had been claimed at all.
    // 'reunited' lists every resolved report, for the board's Reunited filter.
    //
    // The status filter used to be honoured for anyone, so a logged-out
    // request for status=rejected or status=pending returned posts a vet had
    // turned down or not yet reviewed, contact details included. Only staff
    // may browse other statuses here.
    $status = clean($data['status'] ?? '');
    $reunitedOnly = !$management && strtolower($status) === 'reunited';
    if (!$management && !isStaffViewer($viewer)) {
        // Open cases only is the one narrower view the public may ask for --
        // the landing page's "recent reports" strip does.
        $status = strtolower($status) === 'active' ? 'active' : '';
    }
    if ($reunitedOnly) {
        $where[] = "lost_found_reports.status = 'resolved'";
    } elseif ($status !== '' && $status !== 'all') {
        $where[] = 'lost_found_reports.status = :status';
        $params[':status'] = normalizeStatus($status, $management ? 'pending' : 'active');
    } elseif (!$management) {
        $where[] = "(lost_found_reports.status = 'active'
                     OR (lost_found_reports.status = 'resolved' AND lost_found_reports.resolved_at >= :claimed_since))";
        $params[':claimed_since'] = date('Y-m-d H:i:s', time() - CLAIMED_ON_BOARD_DAYS * 86400);
    }

    $type = clean($data['type'] ?? $data['report_type'] ?? '');
    if ($type !== '' && strtolower($type) !== 'all') {
        $where[] = 'lost_found_reports.report_type = :type';
        $params[':type'] = normalizeType($type);
    }

    $species = clean($data['species'] ?? '');
    if ($species !== '' && strtolower($species) !== 'all') {
        $where[] = 'lost_found_reports.species = :species';
        $params[':species'] = normalizeSpecies($species);
    }

    $barangay = clean($data['barangay'] ?? $data['barangay_name'] ?? '');
    if ($barangay !== '' && strtolower($barangay) !== 'select barangay') {
        $where[] = 'lost_found_reports.barangay_name = :barangay';
        $params[':barangay'] = $barangay;
    }

    $search = clean($data['search'] ?? '');
    if ($search !== '') {
        // One placeholder per use: prepares are native (not emulated), and a
        // named placeholder repeated in one statement fails outright -- which
        // made every search on this board return an error.
        $columns = ['pet_name', 'breed', 'color_markings', 'notes', 'case_number'];
        $likes = [];
        foreach ($columns as $i => $column) {
            $likes[] = "lost_found_reports.{$column} LIKE :search{$i}";
            $params[":search{$i}"] = '%' . $search . '%';
        }
        $where[] = '(' . implode(' OR ', $likes) . ')';
    }

    $sql = reportSelectSql();
    if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
    // Open cases first; the grayed-out claimed ones after them.
    $sql .= $reunitedOnly
        ? ' ORDER BY lost_found_reports.resolved_at DESC'
        : " ORDER BY (lost_found_reports.status = 'resolved') ASC, lost_found_reports.created_at DESC";

    $limit = (int) ($data['limit'] ?? 0);
    if ($limit > 0 && $limit <= 100) {
        $sql .= ' LIMIT ' . $limit;
    }

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $reports = array_map('reportRowToArray', $stmt->fetchAll());
    // A closed case needs nobody's phone number any more; a dispute goes
    // through the clinic ("This is my pet" files a ticket), not the poster.
    $reports = array_map(function ($report) use ($management, $viewer) {
        $hide = !$management && ($viewer === null || ($report['status'] === 'resolved' && !isStaffViewer($viewer)));
        return $hide ? withoutPosterDetails($report) : $report;
    }, $reports);

    respond(200, ['success' => true, 'data' => $reports]);
}

function listMyReports($pdo, $data)
{
    $ownerId = (int) ($data['owner_id'] ?? $data['user_id'] ?? 0);
    if ($ownerId <= 0) {
        respond(401, ['success' => false, 'message' => 'You must be logged in to view your reports.']);
    }

    $where = ['lost_found_reports.owner_id = :owner_id'];
    $params = [':owner_id' => $ownerId];

    $status = clean($data['status'] ?? '');
    if ($status !== '' && $status !== 'all') {
        $where[] = 'lost_found_reports.status = :status';
        $params[':status'] = normalizeStatus($status, 'pending');
    }

    $type = clean($data['type'] ?? $data['report_type'] ?? '');
    if ($type !== '' && strtolower($type) !== 'all') {
        $where[] = 'lost_found_reports.report_type = :type';
        $params[':type'] = normalizeType($type);
    }

    $sql = reportSelectSql() . ' WHERE ' . implode(' AND ', $where) . ' ORDER BY lost_found_reports.created_at DESC';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $reports = array_map('reportRowToArray', $stmt->fetchAll());

    respond(200, ['success' => true, 'data' => $reports]);
}

function getReport($pdo, $data, $viewer = null)
{
    $id = (int) ($data['id'] ?? $data['report_id'] ?? 0);
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid report id.']);

    $stmt = $pdo->prepare(reportSelectSql() . ' WHERE lost_found_reports.id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();

    // Same rule as the board: anyone may open an active report, the person who
    // posted it may open it in any state, and only staff see the rest. Anything
    // else answers exactly like a missing id, so ids can't be probed for
    // pending or rejected posts.
    $isOwnReport = $row && $viewer !== null && (int) $row['owner_id'] === (int) $viewer['user_id'];
    $publicStatus = $row && in_array($row['status'], ['active', 'resolved'], true);
    if (!$row || (!$publicStatus && !$isOwnReport && !isStaffViewer($viewer))) {
        respond(404, ['success' => false, 'message' => 'Report not found.']);
    }

    $report = reportRowToArray($row);
    $hide = $viewer === null || ($row['status'] === 'resolved' && !$isOwnReport && !isStaffViewer($viewer));
    respond(200, ['success' => true, 'data' => $hide ? withoutPosterDetails($report) : $report]);
}

function createReport($pdo, $data)
{
    $ownerId = (int) ($data['owner_id'] ?? $data['user_id'] ?? 0);
    if ($ownerId <= 0) {
        respond(401, ['success' => false, 'message' => 'You must be logged in to submit a report.']);
    }

    [$photoPath, $absolutePhoto] = saveUpload('photo', 'lost_found', false);
    [$barangayId, $barangayName] = findBarangay($pdo, $data);

    $type = normalizeType($data['report_type'] ?? $data['type'] ?? '');
    $role = normalizeRole($data['role'] ?? $data['source_role'] ?? '');
    $source = in_array($role, ['vet', 'admin'], true) ? $role : 'owner';
    $status = in_array($role, ['vet', 'admin'], true) ? 'active' : 'pending';

    $petName = nullableClean($data['pet_name'] ?? $data['petName'] ?? '');
    $species = nullableClean($data['species'] ?? $data['pet_type'] ?? '');
    if ($species) $species = normalizeSpecies($species);
    $breed = nullableClean($data['breed'] ?? $data['pet_breed'] ?? '');
    $accountContact = userContactFromAccount($pdo, $data);
    $contactName = nullableClean($data['contact_name'] ?? $data['uploader'] ?? $data['owner_name'] ?? '') ?: ($accountContact['name'] ?? null);
    $contactPhone = nullableClean($data['contact_phone'] ?? $data['contact'] ?? $data['phone'] ?? '') ?: ($accountContact['phone'] ?? null);
    $contactEmail = nullableClean($data['contact_email'] ?? $data['email'] ?? '') ?: ($accountContact['email'] ?? null);

    $lfFieldError = firstIdentityFieldError([
        [(string) $petName,     'Pet name', 120, 0],
        [(string) $species,     'Species', 60, 0],
        [(string) $breed,       'Breed', 80, 0],
        [(string) $contactName, 'Contact name', 150, 0],
        [(string) $contactPhone,'Contact number', 30, 0],
        [(string) $contactEmail,'Contact email', 190, 0],
    ]);
    if ($lfFieldError !== null) {
        respond(422, ['success' => false, 'message' => $lfFieldError]);
    }

    if (!$species || !$breed) {
        respond(422, ['success' => false, 'message' => 'Species and breed are required.']);
    }
    // Sex is optional for found reports (a finder often can't check the
    // animal); "Unknown" is normalized to NULL so match scoring keeps
    // treating it as no-signal. Lost reports still require Male/Female.
    $sex = nullableClean($data['sex'] ?? '');
    if ($sex !== null && strcasecmp($sex, 'unknown') === 0) {
        $sex = null;
    }
    if ($type === 'lost' && !$sex) {
        respond(422, ['success' => false, 'message' => 'Sex is required for lost pet reports.']);
    }
    if (!nullableClean($data['size'] ?? '')) {
        respond(422, ['success' => false, 'message' => 'Size is required.']);
    }
    $colorMarkings = nullableClean($data['color_markings'] ?? $data['markings'] ?? '');
    if (!$colorMarkings) {
        respond(422, ['success' => false, 'message' => 'Color or markings are required.']);
    }
    if (mb_strlen($colorMarkings) > 200) {
        respond(422, ['success' => false, 'message' => 'Color / markings must be 200 characters or fewer.']);
    }
    $notes = nullableClean($data['notes'] ?? '');
    if ($notes && mb_strlen($notes) > 500) {
        respond(422, ['success' => false, 'message' => 'Additional details must be 500 characters or fewer.']);
    }
    $incidentDate = normalizeDate($data['incident_date'] ?? $data['dateLost'] ?? $data['date'] ?? '');
    if (!$incidentDate) {
        respond(422, ['success' => false, 'message' => 'Incident date is required.']);
    }
    assertDateNotFuture($incidentDate, 'Incident date');
    if ($type === 'lost' && !$petName) {
        respond(422, ['success' => false, 'message' => 'Pet name is required for lost pet reports.']);
    }
    if ($type !== 'lost') {
        $petName = null;
    }
    if (!$contactName || !$contactPhone) {
        respond(422, ['success' => false, 'message' => 'Contact name and phone are required.']);
    }
    if (!$barangayName && clean($data['location_text'] ?? '') === '') {
        respond(422, ['success' => false, 'message' => 'Location or barangay is required.']);
    }

    $features = imageFeatures($absolutePhoto);
    $insert = $pdo->prepare("
        INSERT INTO lost_found_reports
            (case_number, report_type, status, source, owner_id, pet_name, species, breed, sex, size, color_markings,
             notes, barangay_id, barangay_name, location_text, latitude, longitude, incident_date, incident_time,
             photo_path, image_features, contact_name, contact_phone, contact_email)
        VALUES
            (:case_number, :report_type, :status, :source, :owner_id, :pet_name, :species, :breed, :sex, :size, :color_markings,
             :notes, :barangay_id, :barangay_name, :location_text, :latitude, :longitude, :incident_date, :incident_time,
             :photo_path, :image_features, :contact_name, :contact_phone, :contact_email)
    ");

    $insert->execute([
        ':case_number' => generateCaseNumber($type === 'lost' ? 'LP' : 'FP'),
        ':report_type' => $type,
        ':status' => $status,
        ':source' => $source,
        ':owner_id' => (int) ($data['owner_id'] ?? $data['user_id'] ?? 0) ?: null,
        ':pet_name' => $petName,
        ':species' => $species,
        ':breed' => $breed,
        ':sex' => $sex,
        ':size' => nullableClean($data['size'] ?? ''),
        ':color_markings' => $colorMarkings,
        ':notes' => $notes,
        ':barangay_id' => $barangayId,
        ':barangay_name' => $barangayName,
        ':location_text' => nullableClean($data['location_text'] ?? $data['location'] ?? ''),
        ':latitude' => clean($data['latitude'] ?? $data['lat'] ?? '') !== '' ? (float) ($data['latitude'] ?? $data['lat']) : null,
        ':longitude' => clean($data['longitude'] ?? $data['lng'] ?? '') !== '' ? (float) ($data['longitude'] ?? $data['lng']) : null,
        ':incident_date' => $incidentDate,
        ':incident_time' => normalizeTimeValue($data['incident_time'] ?? $data['timeLost'] ?? $data['time'] ?? ''),
        ':photo_path' => $photoPath,
        ':image_features' => $features ? json_encode($features) : null,
        ':contact_name' => $contactName,
        ':contact_phone' => $contactPhone,
        ':contact_email' => $contactEmail,
    ]);

    $reportId = (int) $pdo->lastInsertId();
    rebuildMatchesForReport($pdo, $reportId);
    setReportExpiry($pdo, $reportId);

    if ($status === 'pending') {
        setReportAutoPublish($pdo, $reportId);
    }

    if ($status === 'active') {
        notifyReportOwnerStatus($pdo, $ownerId, $reportId, 'active');
    } else {
        $label = $type === 'lost' ? 'lost pet' : 'found pet';
        notifyStaff(
            $pdo,
            'both',
            'lost_found_new',
            'New Lost & Found Report',
            "A new {$label} report ({$contactName}) is awaiting review.",
            $reportId,
            true
        );
    }

    respond(201, [
        'success' => true,
        'message' => $status === 'active'
            ? 'Report published.'
            : 'Report submitted for vet review.',
        'report_id' => $reportId,
        'status' => $status
    ]);
}

function updateReportStatus($pdo, $data, $status)
{
    $id = (int) ($data['id'] ?? $data['report_id'] ?? 0);
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid report id.']);

    $reviewedBy = (int) ($data['reviewed_by_user_id'] ?? $data['vet_id'] ?? 0);
    $notes = clean($data['review_notes'] ?? '');
    $resolvedSql = $status === 'resolved' ? ', resolved_at = NOW()' : '';

    $stmt = $pdo->prepare("
        UPDATE lost_found_reports
        SET status = :status,
            reviewed_by_user_id = :reviewed_by_user_id,
            review_notes = :review_notes,
            reviewed_at = NOW()
            $resolvedSql
        WHERE id = :id
    ");
    $stmt->execute([
        ':status' => $status,
        ':reviewed_by_user_id' => $reviewedBy > 0 ? $reviewedBy : null,
        ':review_notes' => $notes,
        ':id' => $id,
    ]);

    if ($status === 'active') {
        rebuildMatchesForReport($pdo, $id);
    }

    if (in_array($status, ['active', 'rejected'], true)) {
        $ownerStmt = $pdo->prepare('SELECT owner_id FROM lost_found_reports WHERE id = :id LIMIT 1');
        $ownerStmt->execute([':id' => $id]);
        $ownerId = (int) ($ownerStmt->fetchColumn() ?: 0);
        notifyReportOwnerStatus($pdo, $ownerId, $id, $status);
    }

    respond(200, ['success' => true, 'message' => 'Report status updated.']);
}

function fetchReportForMatch($pdo, $id)
{
    $stmt = $pdo->prepare('SELECT * FROM lost_found_reports WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    return $stmt->fetch();
}

function notifyReportOwnerStatus($pdo, $ownerId, $reportId, $status)
{
    $ownerId = (int) $ownerId;
    if ($ownerId <= 0) return;

    $stmt = $pdo->prepare('SELECT case_number, report_type, pet_name, photo_path FROM lost_found_reports WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => (int) $reportId]);
    $report = $stmt->fetch();
    if (!$report) return;

    $label = $report['report_type'] === 'lost' ? 'lost pet' : 'found pet';

    // In-app row first, and unconditionally. The lost_found_alerts toggle is
    // an email channel on the settings page, so gating this on it would hide
    // the outcome of the owner's own report from them entirely.
    notifyUser(
        $pdo,
        $ownerId,
        'lost_found_report_status',
        $status === 'active' ? 'Report Published' : ($status === 'expired' ? 'Report Expired' : 'Report Rejected'),
        "Your {$label} report" . ($report['pet_name'] ? " for {$report['pet_name']}" : '')
            . " (case #{$report['case_number']}) was "
            . ($status === 'active'
                ? 'published and is now live.'
                : ($status === 'expired'
                    ? 'closed after its three-month lifespan. It remains in your report history. If the pet is still missing, submit an updated report.'
                    : 'rejected.')),
        (int) $reportId
    );

    if (!userWantsNotification($pdo, $ownerId, 'lost_found_alerts')) return;

    $userStmt = $pdo->prepare('SELECT full_name, email FROM users WHERE id = :id LIMIT 1');
    $userStmt->execute([':id' => $ownerId]);
    $user = $userStmt->fetch();
    if (!$user || !$user['email']) return;

    $petLabel = $report['pet_name'] ? " for <strong>" . htmlspecialchars($report['pet_name']) . "</strong>" : '';

    if ($status === 'active') {
        $subject = 'BVetter – Your ' . $label . ' report is now live';
        $photoUrl = !empty($report['photo_path']) ? emailPhotoUrl($report['photo_path']) : null;
        $body = notificationEmailWrapper(
            'Report Published',
            "<p>Your {$label} report{$petLabel} (case #{$report['case_number']}) is now live and visible to the community.</p>",
            $photoUrl,
            ['label' => 'View', 'url' => APP_URL . '/public/pages/lost-found.html?tab=myreports']
        );
    } elseif ($status === 'expired') {
        $subject = 'BVetter – Your ' . $label . ' report has expired';
        $body = notificationEmailWrapper(
            'Report Expired',
            "<p>Your {$label} report{$petLabel} (case #{$report['case_number']}) has reached its three-month lifespan and is no longer visible on the public board. It remains in your report history. If the pet is still missing, submit an updated report.</p>",
            null,
            ['label' => 'View', 'url' => APP_URL . '/public/pages/lost-found.html?tab=myreports']
        );
    } else {
        $subject = 'BVetter – Your ' . $label . ' report was rejected';
        $body = notificationEmailWrapper(
            'Report Rejected',
            "<p>Your {$label} report{$petLabel} (case #{$report['case_number']}) has been <strong>rejected</strong>.</p>",
            null,
            ['label' => 'View', 'url' => APP_URL . '/public/pages/lost-found.html?tab=myreports']
        );
    }

    sendAppMail($user['email'], nullableClean($user['full_name'] ?? ''), $subject, $body);
}

function userContactFromAccount($pdo, $data)
{
    $userId = (int) ($data['user_id'] ?? $data['owner_id'] ?? $data['reviewed_by_user_id'] ?? $data['vet_id'] ?? 0);
    if ($userId <= 0) return null;

    $stmt = $pdo->prepare('SELECT full_name, phone_number, email FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $userId]);
    $user = $stmt->fetch();
    if (!$user) return null;

    return [
        'name' => nullableClean($user['full_name'] ?? ''),
        'phone' => nullableClean($user['phone_number'] ?? ''),
        'email' => nullableClean($user['email'] ?? ''),
    ];
}

function rebuildMatchesForReport($pdo, $reportId)
{
    $report = fetchReportForMatch($pdo, $reportId);
    if (!$report || $report['status'] !== 'active') return;

    if ($report['report_type'] === 'lost') {
        $lost = $report;
        $stmt = $pdo->prepare("SELECT * FROM lost_found_reports WHERE id <> :id AND report_type = 'found' AND status = 'active'");
    } else {
        $stmt = $pdo->prepare("SELECT * FROM lost_found_reports WHERE id <> :id AND report_type = 'lost' AND status = 'active'");
    }
    $stmt->execute([':id' => $reportId]);
    $candidates = $stmt->fetchAll();

    foreach ($candidates as $candidate) {
        $lostReport = $report['report_type'] === 'lost' ? $report : $candidate;
        $foundReport = $report['report_type'] === 'found' ? $report : $candidate;
        if (strtolower(clean($lostReport['species'] ?? '')) !== strtolower(clean($foundReport['species'] ?? ''))) continue;
        [$score, $reasons] = scoreMatch($lostReport, $foundReport);
        if ($score < MATCH_CUTOFF) continue;

        $existing = $pdo->prepare("
            SELECT id
            FROM lost_found_matches
            WHERE lost_report_id = :lost_report_id
              AND found_report_id = :found_report_id
              AND sighting_id IS NULL
            LIMIT 1
        ");
        $existing->execute([
            ':lost_report_id' => (int) $lostReport['id'],
            ':found_report_id' => (int) $foundReport['id'],
        ]);
        $matchId = $existing->fetchColumn();

        if ($matchId) {
            $update = $pdo->prepare('UPDATE lost_found_matches SET confidence = :confidence, reasons_json = :reasons_json, updated_at = NOW() WHERE id = :id');
            $update->execute([
                ':confidence' => $score,
                ':reasons_json' => json_encode($reasons),
                ':id' => (int) $matchId,
            ]);
        } else {
            $insert = $pdo->prepare("
                INSERT INTO lost_found_matches (lost_report_id, found_report_id, sighting_id, confidence, reasons_json, status)
                VALUES (:lost_report_id, :found_report_id, NULL, :confidence, :reasons_json, 'suggested')
            ");
            $insert->execute([
                ':lost_report_id' => (int) $lostReport['id'],
                ':found_report_id' => (int) $foundReport['id'],
                ':confidence' => $score,
                ':reasons_json' => json_encode($reasons),
            ]);
            notifyLostReportOwnerOfMatch($pdo, (int) $lostReport['id'], (int) $pdo->lastInsertId());
        }
    }

    $lostId = $report['report_type'] === 'lost' ? (int) $report['id'] : 0;
    if ($lostId > 0) rebuildSightingMatches($pdo, $lostId);
}

/**
 * Tell the owner of a lost report that a new possible match turned up.
 *
 * Only called from the INSERT branches of the match rebuilds, never the
 * UPDATE ones — rebuilds are upserts rather than delete-and-recreate, so an
 * insert really is a match that did not exist before. Re-scoring an existing
 * match must stay silent or every rebuild would notify the whole board.
 */
function notifyLostReportOwnerOfMatch($pdo, $lostReportId, $matchId)
{
    $stmt = $pdo->prepare('
        SELECT owner_id, case_number, pet_name FROM lost_found_reports WHERE id = :id LIMIT 1
    ');
    $stmt->execute([':id' => (int) $lostReportId]);
    $report = $stmt->fetch();
    if (!$report || (int) $report['owner_id'] <= 0) return;

    notifyUser(
        $pdo,
        (int) $report['owner_id'],
        'lost_found_match',
        'New Potential Match Found',
        'A possible match was found for your lost report'
            . ($report['pet_name'] ? " for {$report['pet_name']}" : '')
            . " (case #{$report['case_number']}).",
        (int) $matchId
    );
}

function rebuildSightingMatches($pdo, $lostReportId)
{
    $lost = fetchReportForMatch($pdo, $lostReportId);
    if (!$lost || $lost['status'] !== 'active') return;

    // A sighting is only ever a candidate for the lost report it was actually
    // submitted against — matching it here by species/location similarity
    // against every other active lost report is what caused one sighting to
    // fan out and appear under unrelated reports.
    $stmt = $pdo->prepare("SELECT * FROM lost_found_sightings WHERE status = 'active' AND report_id = :lost_report_id");
    $stmt->execute([':lost_report_id' => $lostReportId]);
    foreach ($stmt->fetchAll() as $sighting) {
        // Sightings never collect species/breed/sex/size (the sighting form only
        // asks for date, barangay, location, photo, and notes) — leave these blank
        // instead of copying the lost report's own values onto the candidate.
        // Copying them made every sighting trivially "match" every active lost
        // report via the species/breed/sex/size score components, regardless of
        // what the sighting actually reported.
        $candidate = [
            'species' => '',
            'breed' => '',
            'sex' => '',
            'size' => '',
            'color_markings' => '',
            'notes' => apiSafeText($sighting['notes']),
            'barangay_id' => $sighting['barangay_id'],
            'latitude' => $sighting['latitude'],
            'longitude' => $sighting['longitude'],
            'image_features' => $sighting['image_features'],
        ];
        [$score, $reasons] = scoreMatch($lost, $candidate);

        $existing = $pdo->prepare("
            SELECT id
            FROM lost_found_matches
            WHERE lost_report_id = :lost_report_id
              AND found_report_id IS NULL
              AND sighting_id = :sighting_id
            LIMIT 1
        ");
        $existing->execute([
            ':lost_report_id' => $lostReportId,
            ':sighting_id' => (int) $sighting['id'],
        ]);
        $matchId = $existing->fetchColumn();

        // The sighting was explicitly submitted against this report, so it's
        // always linked here — $score/$reasons are kept only as display/sort
        // metadata (confidence, ORDER BY confidence in listMatches()), never
        // as a gate on whether the match exists.
        if ($matchId) {
            $update = $pdo->prepare('UPDATE lost_found_matches SET confidence = :confidence, reasons_json = :reasons_json, updated_at = NOW() WHERE id = :id');
            $update->execute([
                ':confidence' => $score,
                ':reasons_json' => json_encode($reasons),
                ':id' => (int) $matchId,
            ]);
        } else {
            $insert = $pdo->prepare("
                INSERT INTO lost_found_matches (lost_report_id, found_report_id, sighting_id, confidence, reasons_json, status)
                VALUES (:lost_report_id, NULL, :sighting_id, :confidence, :reasons_json, 'suggested')
            ");
            $insert->execute([
                ':lost_report_id' => $lostReportId,
                ':sighting_id' => (int) $sighting['id'],
                ':confidence' => $score,
                ':reasons_json' => json_encode($reasons),
            ]);
            notifyLostReportOwnerOfMatch($pdo, (int) $lostReportId, (int) $pdo->lastInsertId());
        }
    }
}

function listMatches($pdo, $data, $viewer)
{
    $reportId = (int) ($data['report_id'] ?? $data['id'] ?? 0);
    $includeResolved = (int) ($data['include_resolved'] ?? 0) === 1;

    // Every match carries both sides' contact details, so a pet owner only gets
    // the matches for a report of their own -- the My Reports panel is the one
    // place they are shown. Without a report id, or with someone else's, the
    // answer is an empty list. Staff review every match and keep seeing all.
    if (!isStaffViewer($viewer)) {
        $ownReport = $reportId > 0 ? fetchReportForMatch($pdo, $reportId) : null;
        if (!$ownReport || (int) $ownReport['owner_id'] !== (int) $viewer['user_id']) {
            respond(200, ['success' => true, 'data' => []]);
        }
    }

    // A "suggested" match is only actionable while every party involved is still
    // active. An "approved" match only ever exists once every party involved has
    // been flipped to resolved together (see updateMatchStatus()) — so the two
    // states must never mix, otherwise a stale "suggested" candidate for an
    // already-closed case would keep showing live Claim/Dismiss buttons.
    $activeBranch = "(lost_found_matches.status = 'suggested'"
        . " AND lost.status = 'active'"
        . " AND (lost_found_matches.found_report_id IS NULL OR found.status = 'active')"
        . " AND (lost_found_matches.sighting_id IS NULL OR sightings.status = 'active'))";
    $resolvedBranch = "(lost_found_matches.status = 'approved'"
        . " AND lost.status = 'resolved'"
        . " AND (lost_found_matches.found_report_id IS NULL OR found.status = 'resolved')"
        . " AND (lost_found_matches.sighting_id IS NULL OR sightings.status = 'resolved'))";

    $where = [
        $includeResolved ? "($activeBranch OR $resolvedBranch)" : $activeBranch,
    ];
    $params = [];
    if ($reportId > 0) {
        $report = fetchReportForMatch($pdo, $reportId);
        $allowedStatuses = $includeResolved ? ['active', 'resolved'] : ['active'];
        if (!$report || !in_array($report['status'], $allowedStatuses, true)) {
            respond(200, ['success' => true, 'data' => []]);
        }
        if ($report['report_type'] === 'lost') {
            $where[] = 'lost_found_matches.lost_report_id = :report_id';
        } else {
            $where[] = 'lost_found_matches.found_report_id = :report_id';
        }
        $params[':report_id'] = $reportId;
    }

    $sql = "
        SELECT
            lost_found_matches.*,
            lost.case_number AS lost_case, lost.pet_name AS lost_name, lost.species AS lost_species, lost.breed AS lost_breed, lost.sex AS lost_sex, lost.size AS lost_size, lost.color_markings AS lost_markings, lost.notes AS lost_notes, lost.photo_path AS lost_photo, lost.barangay_name AS lost_barangay, lost.created_at AS lost_created_at,
            lost.contact_name AS lost_contact_name, lost.contact_phone AS lost_contact_phone, lost.contact_email AS lost_contact_email,
            found.case_number AS found_case, found.pet_name AS found_name, found.species AS found_species, found.breed AS found_breed, found.sex AS found_sex, found.size AS found_size, found.color_markings AS found_markings, found.notes AS found_notes, found.photo_path AS found_photo, found.barangay_name AS found_barangay, found.created_at AS found_created_at,
            found.contact_name AS found_contact_name, found.contact_phone AS found_contact_phone, found.contact_email AS found_contact_email,
            EXISTS (
                SELECT 1 FROM lost_found_claims reserved_claim
                WHERE reserved_claim.report_id = found.id
                  AND reserved_claim.status IN ('awaiting_handoff', 'approved')
            ) AS found_claim_reserved,
            sightings.case_number AS sighting_case, sightings.photo_path AS sighting_photo, sightings.barangay_name AS sighting_barangay, sightings.notes AS sighting_notes, sightings.created_at AS sighting_created_at,
            sightings.sighting_date AS sighting_spotted_date, sightings.contact_name AS sighting_contact_name, sightings.contact_phone AS sighting_contact_phone, sightings.contact_email AS sighting_contact_email
        FROM lost_found_matches
        INNER JOIN lost_found_reports lost ON lost.id = lost_found_matches.lost_report_id
        LEFT JOIN lost_found_reports found ON found.id = lost_found_matches.found_report_id
        LEFT JOIN lost_found_sightings sightings ON sightings.id = lost_found_matches.sighting_id
        WHERE " . implode(' AND ', $where) . "
          AND (lost_found_matches.found_report_id IS NULL OR LOWER(lost.species) = LOWER(found.species))
        ORDER BY lost_found_matches.confidence DESC, lost_found_matches.created_at DESC
    ";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $matches = [];
    foreach ($stmt->fetchAll() as $row) {
        if ($row['found_report_id'] && clearlyDifferentBreeds($row['lost_breed'], $row['found_breed'])) continue;
        $matches[] = [
            'id' => (int) $row['id'],
            'confidence' => (int) $row['confidence'],
            'reasons' => json_decode((string) $row['reasons_json'], true) ?: [],
            'status' => $row['status'],
            'createdAt' => $row['created_at'],
            'lost' => [
                'reportId' => (int) $row['lost_report_id'],
                'caseId' => $row['lost_case'],
                'name' => $row['lost_name'] ?: 'Lost Pet Report',
                'species' => $row['lost_species'],
                'breed' => $row['lost_breed'],
                'sex' => $row['lost_sex'],
                'size' => $row['lost_size'],
                'markings' => $row['lost_markings'],
                'notes' => apiSafeText($row['lost_notes']),
                'location' => $row['lost_barangay'],
                'image' => $row['lost_photo'],
                'createdAt' => $row['lost_created_at'],
                'contactName' => $row['lost_contact_name'],
                'contactPhone' => $row['lost_contact_phone'],
                'contactEmail' => $row['lost_contact_email'],
            ],
            'found' => [
                'reportId' => $row['found_report_id'] ? (int) $row['found_report_id'] : null,
                'sightingId' => $row['sighting_id'] ? (int) $row['sighting_id'] : null,
                'caseId' => $row['found_case'] ?: $row['sighting_case'],
                'name' => $row['found_report_id'] ? ($row['found_name'] ?: 'Found Pet Report') : 'Sighting Report',
                'species' => $row['found_species'],
                'breed' => $row['found_breed'],
                'sex' => $row['found_sex'],
                'size' => $row['found_size'],
                'markings' => $row['found_markings'],
                'location' => $row['found_barangay'] ?: $row['sighting_barangay'],
                'image' => $row['found_photo'] ?: $row['sighting_photo'],
                'notes' => apiSafeText($row['found_report_id'] ? $row['found_notes'] : $row['sighting_notes']),
                'createdAt' => $row['found_report_id'] ? $row['found_created_at'] : $row['sighting_created_at'],
                'spottedDate' => $row['sighting_spotted_date'],
                'contactName' => $row['found_report_id'] ? $row['found_contact_name'] : $row['sighting_contact_name'],
                'contactPhone' => $row['found_report_id'] ? $row['found_contact_phone'] : $row['sighting_contact_phone'],
                'contactEmail' => $row['found_report_id'] ? $row['found_contact_email'] : $row['sighting_contact_email'],
                'claimReserved' => (bool) ($row['found_claim_reserved'] ?? false),
            ],
        ];
    }

    respond(200, ['success' => true, 'data' => $matches]);
}

/* ── Competing claimants for one found pet ─────────────────────────────
 *
 * Faculty feedback: when two people claim the same pet, warn the approver
 * if they are about to pick the lower match. A "candidate" for a found pet
 * is either a pending claim (scored by the claimant's own lost report's
 * match to this pet, when they filed one -- a claim on its own has no
 * score) or a suggested match from a lost report whose owner hasn't claimed
 * yet: the owner who hasn't seen the found report is the likeliest real
 * owner to lose out. The percentage measures how alike the reports look,
 * not who owns the pet, so a lower pick is allowed -- with a reason.
 */

/** review_notes on matches holds the approver's reason for a lower pick. */
function ensureMatchReviewNotes($pdo)
{
    static $ready = null;
    if ($ready !== null) return $ready;
    try {
        if (!$pdo->query("SHOW COLUMNS FROM lost_found_matches LIKE 'review_notes'")->fetch()) {
            $pdo->exec('ALTER TABLE lost_found_matches ADD COLUMN review_notes TEXT NULL');
        }
    } catch (PDOException $e) {
        error_log('[BVetter] lost_found_matches.review_notes: ' . $e->getMessage());
        return $ready = false;
    }
    return $ready = true;
}

function foundPetCandidates($pdo, $foundReportId)
{
    $claims = $pdo->prepare("
        SELECT c.id, c.claimant_user_id, COALESCE(u.full_name, c.claimant_name) AS name,
               (SELECT MAX(m.confidence)
                FROM lost_found_matches m
                INNER JOIN lost_found_reports lr ON lr.id = m.lost_report_id
                WHERE m.found_report_id = c.report_id AND lr.owner_id = c.claimant_user_id
                  AND m.status IN ('suggested', 'approved')) AS score
        FROM lost_found_claims c
        LEFT JOIN users u ON u.id = c.claimant_user_id
        WHERE c.report_id = :found AND c.status = 'pending'
    ");
    $claims->execute([':found' => $foundReportId]);

    $candidates = [];
    $claimantIds = [];
    foreach ($claims->fetchAll() as $row) {
        $candidates[] = [
            'kind' => 'claim',
            'id' => (int) $row['id'],
            'ownerId' => (int) $row['claimant_user_id'],
            'name' => $row['name'] ?: 'Claimant',
            'score' => $row['score'] !== null ? (int) $row['score'] : null,
        ];
        if ((int) $row['claimant_user_id'] > 0) $claimantIds[] = (int) $row['claimant_user_id'];
    }

    $matches = $pdo->prepare("
        SELECT m.id, m.confidence, lr.owner_id, lr.case_number, lr.breed AS lost_breed, fr.breed AS found_breed,
               COALESCE(NULLIF(lr.contact_name, ''), u.full_name) AS name
        FROM lost_found_matches m
        INNER JOIN lost_found_reports lr ON lr.id = m.lost_report_id
        INNER JOIN lost_found_reports fr ON fr.id = m.found_report_id
        LEFT JOIN users u ON u.id = lr.owner_id
        WHERE m.found_report_id = :found AND m.status = 'suggested' AND lr.status = 'active'
    ");
    $matches->execute([':found' => $foundReportId]);
    foreach ($matches->fetchAll() as $row) {
        if (clearlyDifferentBreeds($row['lost_breed'] ?? '', $row['found_breed'] ?? '')) continue;
        // Someone who both claimed and has a matching lost report is one
        // person, already listed through their claim.
        if (in_array((int) $row['owner_id'], $claimantIds, true)) continue;
        $candidates[] = [
            'kind' => 'match',
            'id' => (int) $row['id'],
            'ownerId' => (int) $row['owner_id'],
            'name' => ($row['name'] ?: 'Owner') . ' (' . $row['case_number'] . ')',
            'score' => (int) $row['confidence'],
        ];
    }
    return $candidates;
}

/**
 * The candidate being approved and any others that score higher. Returns
 * null when there is no found pet to compare over (e.g. a sighting match).
 */
function approvalComparison($pdo, $kind, $id)
{
    if ($kind === 'claim') {
        $stmt = $pdo->prepare('SELECT report_id, claimant_user_id FROM lost_found_claims WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        if (!$row) return null;
        $foundId = (int) $row['report_id'];
        $ownerId = (int) $row['claimant_user_id'];
    } else {
        $stmt = $pdo->prepare('
            SELECT m.found_report_id, m.confidence, lr.owner_id
            FROM lost_found_matches m
            INNER JOIN lost_found_reports lr ON lr.id = m.lost_report_id
            WHERE m.id = :id LIMIT 1
        ');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        if (!$row || !$row['found_report_id']) return null;
        $foundId = (int) $row['found_report_id'];
        $ownerId = (int) $row['owner_id'];
    }

    $subject = null;
    $others = [];
    foreach (foundPetCandidates($pdo, $foundId) as $candidate) {
        $isSubject = ($candidate['kind'] === $kind && $candidate['id'] === $id)
            || ($ownerId > 0 && $candidate['ownerId'] === $ownerId);
        if ($isSubject) $subject = $candidate;
        else $others[] = $candidate;
    }
    if ($subject === null && $kind === 'match') {
        $subject = ['kind' => 'match', 'id' => $id, 'ownerId' => $ownerId, 'name' => 'This match', 'score' => (int) $row['confidence']];
    }
    if ($subject === null) return null;

    // No score counts as lowest.
    $rank = function ($c) { return $c['score'] === null ? -1 : $c['score']; };
    $higher = array_values(array_filter($others, function ($c) use ($rank, $subject) {
        return $rank($c) > $rank($subject);
    }));
    usort($higher, function ($a, $b) use ($rank) { return $rank($b) <=> $rank($a); });

    return ['foundId' => $foundId, 'subject' => $subject, 'higher' => $higher];
}

function approvalCheck($pdo, $data)
{
    $kind = ($data['kind'] ?? '') === 'match' ? 'match' : 'claim';
    $id = (int) ($data['id'] ?? 0);
    $comparison = $id > 0 ? approvalComparison($pdo, $kind, $id) : null;
    respond(200, [
        'success' => true,
        'data' => [
            'subject' => $comparison['subject'] ?? null,
            'higher' => $comparison['higher'] ?? [],
        ],
    ]);
}

/**
 * Refuses a lower-scoring approval that came without a reason. The page
 * asks for one; this keeps a direct request from skipping it.
 */
function assertReasonForLowerPick($pdo, $kind, $id, $reason)
{
    $comparison = approvalComparison($pdo, $kind, $id);
    if ($comparison && $comparison['higher'] && trim($reason) === '') {
        respond(422, [
            'success' => false,
            'message' => 'Another claimant has a higher match. Enter a reason to approve this one.',
        ]);
    }
    return $comparison;
}

/**
 * Once a found pet goes to someone, the other pending claims on it are
 * closed (each claimant notified), and the other suggested matches are
 * dismissed quietly -- those owners' lost reports stay active, because
 * their own pet is still missing. The kept owner's best suggested match stays
 * available until the claimant confirms handoff, so both reports can close then.
 */
function closeOtherCandidates($pdo, $foundId, $keptKind, $keptId, $keptOwnerId, $keptMatchId = 0)
{
    $closed = [];
    $candidates = foundPetCandidates($pdo, $foundId);
    if ($keptKind === 'claim' && $keptMatchId <= 0) {
        foreach ($candidates as $candidate) {
            if ($candidate['kind'] === 'match' && (int) $candidate['ownerId'] === (int) $keptOwnerId
                && (int) $candidate['id'] !== (int) $keptMatchId) {
                if ($keptMatchId <= 0 || (int) $candidate['score'] > (int) ($keptMatchScore ?? -1)) {
                    $keptMatchId = (int) $candidate['id'];
                    $keptMatchScore = (int) $candidate['score'];
                }
            }
        }
    }
    foreach ($candidates as $candidate) {
        if ($candidate['kind'] === $keptKind && $candidate['id'] === $keptId) continue;

        if ($candidate['kind'] === 'claim') {
            $isKeptOwner = $keptOwnerId > 0 && $candidate['ownerId'] === $keptOwnerId;
            $pdo->prepare("
                UPDATE lost_found_claims
                SET status = :status, reviewed_at = NOW(), review_notes = :notes
                WHERE id = :id AND status = 'pending'
            ")->execute([
                ':status' => 'rejected',
                ':notes' => $isKeptOwner ? 'Another claim from your account is already awaiting handoff.' : 'Returned to another claimant.',
                ':id' => $candidate['id'],
            ]);
            if (!$isKeptOwner) $closed[] = $candidate['id'];
        } else {
            if ($keptMatchId > 0 && $candidate['id'] === $keptMatchId) continue;
            $pdo->prepare("UPDATE lost_found_matches SET status = 'dismissed', reviewed_at = NOW() WHERE id = :id AND status = 'suggested'")
                ->execute([':id' => $candidate['id']]);
        }
    }
    return $closed;
}

/** Tells a claimant the pet they claimed went to someone else. */
function notifyClaimReturnedToOther($pdo, $claimId)
{
    $stmt = $pdo->prepare('
        SELECT c.claimant_user_id, c.claimant_email, c.claimant_name, r.case_number
        FROM lost_found_claims c
        INNER JOIN lost_found_reports r ON r.id = c.report_id
        WHERE c.id = :id LIMIT 1
    ');
    $stmt->execute([':id' => $claimId]);
    $claim = $stmt->fetch();
    if (!$claim) return;

    $message = "Case {$claim['case_number']}: the pet was returned to another claimant.";
    try {
        $userId = (int) $claim['claimant_user_id'];
        if ($userId > 0) notifyUser($pdo, $userId, 'lost_found_claim_status', 'Claim Closed', $message, $claimId);
        $email = nullableClean($claim['claimant_email'] ?? '');
        if ($email && userWantsNotification($pdo, $userId, 'lost_found_alerts')) {
            sendAppMail(
                $email,
                nullableClean($claim['claimant_name'] ?? ''),
                'BVetter – Claim closed',
                notificationEmailWrapper(
                    'Claim Closed',
                    '<p>' . htmlspecialchars($message, ENT_QUOTES) . '</p>',
                    null,
                    ['label' => 'View', 'url' => APP_URL . '/public/pages/my-claims.html']
                )
            );
        }
    } catch (Throwable $e) {
        error_log('[BVetter] claim-closed notice failed for claim ' . $claimId . ': ' . $e->getMessage());
    }
}

/**
 * How a resolved report was closed, for the staff Resolved Cases view:
 * who got the pet, on what evidence, who approved it, and whether anyone
 * has disputed it since (a "This is My Pet" ticket on either case).
 */
function reportResolution($pdo, $data)
{
    $id = (int) ($data['report_id'] ?? $data['id'] ?? 0);
    $stmt = $pdo->prepare('SELECT * FROM lost_found_reports WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $report = $stmt->fetch();
    if (!$report) respond(404, ['success' => false, 'message' => 'Report not found.']);

    $person = function ($name, $phone, $email) {
        return ($name || $phone || $email) ? ['name' => $name, 'phone' => $phone, 'email' => $email] : null;
    };
    $userName = function ($userId) use ($pdo) {
        if (!$userId) return null;
        $s = $pdo->prepare('SELECT full_name FROM users WHERE id = :id');
        $s->execute([':id' => (int) $userId]);
        return $s->fetchColumn() ?: null;
    };
    $reportContact = function ($r) use ($pdo, $person) {
        if (!$r) return null;
        $name = $r['contact_name'] ?: null; $phone = $r['contact_phone'] ?: null; $email = $r['contact_email'] ?: null;
        if ((!$name || !$phone) && $r['owner_id']) {
            $s = $pdo->prepare('SELECT full_name, phone_number, email FROM users WHERE id = :id');
            $s->execute([':id' => (int) $r['owner_id']]);
            if ($u = $s->fetch()) { $name = $name ?: $u['full_name']; $phone = $phone ?: $u['phone_number']; $email = $email ?: $u['email']; }
        }
        return $person($name, $phone, $email);
    };
    $fetchReport = function ($rid) use ($pdo) {
        if (!$rid) return null;
        $s = $pdo->prepare('SELECT * FROM lost_found_reports WHERE id = :id');
        $s->execute([':id' => (int) $rid]);
        return $s->fetch() ?: null;
    };

    $out = [
        'resolvedAt' => $report['resolved_at'],
        'how' => 'owner',
        'returnedTo' => null,
        'foundBy' => null,
        'counterpart' => null,
        'confidence' => null,
        'proof' => null,
        'reason' => null,
        'approvedBy' => null,
        'approvedAt' => null,
        'disputes' => [],
    ];

    // A claim decided it: on this found report, or -- for a lost report --
    // this owner's claim on the found report their report matched.
    $claimStmt = $pdo->prepare("
        SELECT c.* FROM lost_found_claims c
        WHERE c.status IN ('approved', 'resolved')
          AND (c.report_id = :id
               OR (c.claimant_user_id = :owner AND EXISTS (
                     SELECT 1 FROM lost_found_matches m
                     WHERE m.lost_report_id = :id2 AND m.found_report_id = c.report_id)))
        ORDER BY c.reviewed_at DESC LIMIT 1
    ");
    $claimStmt->execute([':id' => $id, ':owner' => (int) $report['owner_id'], ':id2' => $id]);
    $claim = $claimStmt->fetch();

    $matchStmt = $pdo->prepare("
        SELECT * FROM lost_found_matches
        WHERE status = 'approved' AND (lost_report_id = :id OR found_report_id = :id2)
        ORDER BY reviewed_at DESC LIMIT 1
    ");
    $matchStmt->execute([':id' => $id, ':id2' => $id]);
    $match = $matchStmt->fetch();

    $caseNumbers = [$report['case_number']];

    if ($claim) {
        $found = (int) $claim['report_id'] === $id ? $report : $fetchReport($claim['report_id']);
        $out['how'] = 'claim';
        $out['returnedTo'] = $person($claim['claimant_name'], $claim['claimant_phone'], $claim['claimant_email']);
        $out['foundBy'] = $reportContact($found);
        $out['proof'] = $claim['proof_file_path'] ?: null;
        $out['reason'] = $claim['review_notes'] ?: null;
        $out['approvedBy'] = $userName($claim['reviewed_by_user_id']);
        $out['approvedAt'] = $claim['reviewed_at'];
        $score = $pdo->prepare('
            SELECT MAX(m.confidence) FROM lost_found_matches m
            INNER JOIN lost_found_reports lr ON lr.id = m.lost_report_id
            WHERE m.found_report_id = :found AND lr.owner_id = :claimant
        ');
        $score->execute([':found' => (int) $claim['report_id'], ':claimant' => (int) $claim['claimant_user_id']]);
        $value = $score->fetchColumn();
        $out['confidence'] = $value !== null && $value !== false ? (int) $value : null;
        if ($found && $found['case_number'] !== $report['case_number']) $caseNumbers[] = $found['case_number'];
    } elseif ($match) {
        $lost = (int) $match['lost_report_id'] === $id ? $report : $fetchReport($match['lost_report_id']);
        $out['confidence'] = (int) $match['confidence'];
        $out['reason'] = ($match['review_notes'] ?? null) ?: null;
        $out['approvedBy'] = $userName($match['reviewed_by_user_id']);
        $out['approvedAt'] = $match['reviewed_at'];
        $out['returnedTo'] = $reportContact($lost);
        if ($match['sighting_id']) {
            $out['how'] = 'sighting';
            $s = $pdo->prepare('SELECT case_number, contact_name, contact_phone, contact_email FROM lost_found_sightings WHERE id = :id');
            $s->execute([':id' => (int) $match['sighting_id']]);
            if ($sighting = $s->fetch()) {
                $out['foundBy'] = $person($sighting['contact_name'], $sighting['contact_phone'], $sighting['contact_email']);
                $out['counterpart'] = $sighting['case_number'];
            }
        } else {
            $out['how'] = 'match';
            $found = (int) $match['found_report_id'] === $id ? $report : $fetchReport($match['found_report_id']);
            $out['foundBy'] = $reportContact($found);
            $other = (int) $match['lost_report_id'] === $id ? $found : $lost;
            if ($other) {
                $out['counterpart'] = $other['case_number'];
                $caseNumbers[] = $other['case_number'];
            }
        }
    } elseif ($report['reviewed_by_user_id'] && $report['reviewed_at'] && $report['resolved_at']
        && abs(strtotime($report['reviewed_at']) - strtotime($report['resolved_at'])) <= 5) {
        // Staff's Resolve stamps reviewed_at and resolved_at together.
        $out['how'] = 'staff';
        $out['approvedBy'] = $userName($report['reviewed_by_user_id']);
        $out['approvedAt'] = $report['resolved_at'];
    }

    if ($pdo->query("SHOW TABLES LIKE 'support_tickets'")->fetch()) {
        $ticket = $pdo->prepare("
            SELECT ticket_number, status, created_at FROM support_tickets
            WHERE subject = :subject ORDER BY created_at DESC
        ");
        foreach (array_unique(array_filter($caseNumbers)) as $caseNumber) {
            $ticket->execute([':subject' => 'Claim dispute: ' . $caseNumber]);
            foreach ($ticket->fetchAll() as $row) {
                $out['disputes'][] = ['ticket' => $row['ticket_number'], 'status' => $row['status'], 'createdAt' => $row['created_at']];
            }
        }
    }

    respond(200, ['success' => true, 'data' => $out]);
}

function updateMatchStatus($pdo, $data, $status)
{
    if ($status !== 'dismissed') {
        respond(422, ['success' => false, 'message' => 'Suggested matches cannot resolve reports.']);
    }

    $id = (int) ($data['id'] ?? $data['match_id'] ?? 0);
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid match id.']);

    $stmt = $pdo->prepare('SELECT * FROM lost_found_matches WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $match = $stmt->fetch();
    if (!$match) respond(404, ['success' => false, 'message' => 'Match not found.']);

    $pdo->beginTransaction();
    try {
        $update = $pdo->prepare("UPDATE lost_found_matches SET status = 'dismissed', reviewed_by_user_id = :user_id, reviewed_at = NOW() WHERE id = :id");
        $update->execute([
            ':user_id' => (int) ($data['reviewed_by_user_id'] ?? $data['vet_id'] ?? 0) ?: null,
            ':id' => $id,
        ]);
        $reason = clean($data['review_notes'] ?? '');
        if ($reason !== '' && ensureMatchReviewNotes($pdo)) {
            $pdo->prepare('UPDATE lost_found_matches SET review_notes = :notes WHERE id = :id')
                ->execute([':notes' => $reason, ':id' => $id]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    respond(200, ['success' => true, 'message' => 'Match updated.']);
}

// Lets an owner or finder mark their own report resolved directly — a Lost
// report closes when the pet comes home on its own (no sighting or
// found-report match involved), and a Found report closes when the finder
// reunites the pet with its owner outside the app (direct contact, no claim
// ever filed) — without either case requiring the Claim/proof-of-ownership flow.
function resolveOwnReport($pdo, $data)
{
    $reportId = (int) ($data['report_id'] ?? $data['id'] ?? 0);
    $ownerId = (int) ($data['owner_id'] ?? $data['user_id'] ?? 0);
    if ($reportId <= 0 || $ownerId <= 0) {
        respond(422, ['success' => false, 'message' => 'Invalid request.']);
    }

    $pdo->beginTransaction();
    try {
        // Serialize direct reunions against claim submission and vet approval.
        $stmt = $pdo->prepare('SELECT * FROM lost_found_reports WHERE id = :id LIMIT 1 FOR UPDATE');
        $stmt->execute([':id' => $reportId]);
        $report = $stmt->fetch();
        if (!$report) respond(404, ['success' => false, 'message' => 'Report not found.']);

        if ((int) $report['owner_id'] !== $ownerId) {
            respond(403, ['success' => false, 'message' => 'You can only resolve your own reports.']);
        }
        if (!in_array($report['status'], ['active', 'expired'], true)) {
            respond(422, ['success' => false, 'message' => 'Only an active or expired report can be marked resolved.']);
        }

        if ($report['report_type'] === 'found') {
            $openClaim = $pdo->prepare("SELECT id FROM lost_found_claims WHERE report_id = :id AND status IN ('pending', 'awaiting_handoff', 'approved') LIMIT 1");
            $openClaim->execute([':id' => $reportId]);
            if ($openClaim->fetchColumn()) {
                respond(409, ['success' => false, 'message' => 'This report has an open claim. Use the claim and handoff steps to close it.']);
            }
        }

        $pdo->prepare("UPDATE lost_found_reports SET status = 'resolved', resolved_at = NOW() WHERE id = :id")
            ->execute([':id' => $reportId]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $message = $report['report_type'] === 'found'
        ? 'Marked as resolved. Thanks for helping reunite this pet!'
        : 'Marked as resolved. Glad you got your pet back!';
    respond(200, ['success' => true, 'message' => $message]);
}

function createSighting($pdo, $data)
{
    $submittedBy = (int) ($data['user_id'] ?? $data['owner_id'] ?? 0);
    if ($submittedBy <= 0) {
        respond(401, ['success' => false, 'message' => 'You must be logged in to submit a sighting.']);
    }

    [$photoPath, $absolutePhoto] = saveUpload('photo', 'lost_found_sightings', false);
    [$barangayId, $barangayName] = findBarangay($pdo, $data);
    if (!$barangayName && clean($data['location_text'] ?? '') === '') {
        respond(422, ['success' => false, 'message' => 'Sighting location is required.']);
    }

    $sightingNotes = nullableClean($data['notes'] ?? '');
    if ($sightingNotes && mb_strlen($sightingNotes) > 500) {
        respond(422, ['success' => false, 'message' => 'Additional details must be 500 characters or fewer.']);
    }
    $sightingDate = normalizeDate($data['sighting_date'] ?? $data['date'] ?? '');
    assertDateNotFuture($sightingDate, 'Sighting date');
    $accountContact = userContactFromAccount($pdo, $data);

    $insert = $pdo->prepare("
        INSERT INTO lost_found_sightings
            (case_number, report_id, submitted_by_user_id, status, barangay_id, barangay_name, location_text,
             latitude, longitude, sighting_date, sighting_time, notes, photo_path, image_features,
             contact_name, contact_phone, contact_email)
        VALUES
            (:case_number, :report_id, :submitted_by_user_id, 'pending', :barangay_id, :barangay_name, :location_text,
             :latitude, :longitude, :sighting_date, :sighting_time, :notes, :photo_path, :image_features,
             :contact_name, :contact_phone, :contact_email)
    ");
    $insert->execute([
        ':case_number' => generateCaseNumber('SGT'),
        ':report_id' => (int) ($data['report_id'] ?? 0) ?: null,
        ':submitted_by_user_id' => (int) ($data['user_id'] ?? $data['owner_id'] ?? 0) ?: null,
        ':barangay_id' => $barangayId,
        ':barangay_name' => $barangayName,
        ':location_text' => nullableClean($data['location_text'] ?? $data['location'] ?? ''),
        ':latitude' => clean($data['latitude'] ?? $data['lat'] ?? '') !== '' ? (float) ($data['latitude'] ?? $data['lat']) : null,
        ':longitude' => clean($data['longitude'] ?? $data['lng'] ?? '') !== '' ? (float) ($data['longitude'] ?? $data['lng']) : null,
        ':sighting_date' => $sightingDate,
        ':sighting_time' => normalizeTimeValue($data['sighting_time'] ?? $data['time'] ?? ''),
        ':notes' => $sightingNotes,
        ':photo_path' => $photoPath,
        ':image_features' => ($features = imageFeatures($absolutePhoto)) ? json_encode($features) : null,
        ':contact_name' => nullableClean($data['contact_name'] ?? $data['uploader'] ?? '') ?: ($accountContact['name'] ?? null),
        ':contact_phone' => nullableClean($data['contact_phone'] ?? $data['contact'] ?? '') ?: ($accountContact['phone'] ?? null),
        ':contact_email' => nullableClean($data['contact_email'] ?? $data['email'] ?? '') ?: ($accountContact['email'] ?? null),
    ]);

    $sightingId = (int) $pdo->lastInsertId();
    $lostReports = $pdo->query("SELECT id FROM lost_found_reports WHERE report_type = 'lost' AND status = 'active'")->fetchAll();
    foreach ($lostReports as $row) rebuildSightingMatches($pdo, (int) $row['id']);

    notifyStaff(
        $pdo,
        'both',
        'lost_found_new',
        'New Sighting Reported',
        'A new pet sighting is awaiting review.',
        $sightingId,
        true
    );

    respond(201, ['success' => true, 'message' => 'Sighting submitted for review.', 'sighting_id' => $sightingId]);
}

function listSightings($pdo, $data)
{
    $status = clean($data['status'] ?? '');
    $where = [];
    $params = [];
    if ($status !== '' && $status !== 'all') {
        $where[] = 'lost_found_sightings.status = :status';
        $params[':status'] = normalizeStatus($status, 'pending');
    }

    $sql = 'SELECT * FROM lost_found_sightings';
    if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
    $sql .= ' ORDER BY created_at DESC';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    respond(200, ['success' => true, 'data' => $stmt->fetchAll()]);
}

function updateSightingStatus($pdo, $data, $status)
{
    $id = (int) ($data['id'] ?? $data['sighting_id'] ?? 0);
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid sighting id.']);

    $sightingInfoStmt = $pdo->prepare('SELECT submitted_by_user_id, contact_email, contact_name, case_number FROM lost_found_sightings WHERE id = :id LIMIT 1');
    $sightingInfoStmt->execute([':id' => $id]);
    $sightingInfo = $sightingInfoStmt->fetch();

    $stmt = $pdo->prepare('UPDATE lost_found_sightings SET status = :status, reviewed_by_user_id = :user_id, reviewed_at = NOW(), review_notes = :notes WHERE id = :id');
    $stmt->execute([
        ':status' => $status,
        ':user_id' => (int) ($data['reviewed_by_user_id'] ?? $data['vet_id'] ?? 0) ?: null,
        ':notes' => clean($data['review_notes'] ?? ''),
        ':id' => $id,
    ]);

    if ($status === 'active') {
        $lostReports = $pdo->query("SELECT id FROM lost_found_reports WHERE report_type = 'lost' AND status = 'active'")->fetchAll();
        foreach ($lostReports as $row) rebuildSightingMatches($pdo, (int) $row['id']);
    }

    if ($sightingInfo && in_array($status, ['active', 'rejected'], true)) {
        $submitterId = (int) ($sightingInfo['submitted_by_user_id'] ?? 0);
        $submitterEmail = nullableClean($sightingInfo['contact_email'] ?? '');

        // Anonymous sightings carry no user id and so have no in-app feed to
        // write to — they stay email-only.
        if ($submitterId > 0) {
            notifyUser(
                $pdo,
                $submitterId,
                'lost_found_sighting_status',
                'Sighting ' . ($status === 'active' ? 'Approved' : 'Rejected'),
                "Your sighting report (case #{$sightingInfo['case_number']}) was "
                    . ($status === 'active' ? 'approved.' : 'rejected.'),
                $id
            );
        }

        if ($submitterEmail && userWantsNotification($pdo, $submitterId, 'lost_found_alerts')) {
            $verb = $status === 'active' ? 'approved' : 'rejected';
            $subject = 'BVetter – Your sighting report has been ' . $verb;
            $body = notificationEmailWrapper(
                'Sighting Update',
                "<p>Your sighting report (case #{$sightingInfo['case_number']}) has been <strong>{$verb}</strong>.</p>",
                null,
                ['label' => 'View', 'url' => APP_URL . '/public/pages/lost-found.html']
            );
            sendAppMail($submitterEmail, nullableClean($sightingInfo['contact_name'] ?? ''), $subject, $body);
        }
    }

    respond(200, ['success' => true, 'message' => 'Sighting status updated.']);
}

function createClaim($pdo, $data)
{
    $claimantId = (int) ($data['user_id'] ?? $data['owner_id'] ?? 0);
    if ($claimantId <= 0) {
        respond(401, ['success' => false, 'message' => 'You must be logged in to submit a claim.']);
    }

    $reportId = (int) ($data['report_id'] ?? 0);
    if ($reportId <= 0) respond(422, ['success' => false, 'message' => 'Report id is required for claims.']);
    $matchId = (int) ($data['match_id'] ?? 0);
    $pdo->beginTransaction();
    try {
        // Lock the report so a new ticket cannot race a vet approval and land
        // after another claimant has reserved the pet for handoff.
        $reportStmt = $pdo->prepare('SELECT id, report_type, status, owner_id, case_number, pet_name FROM lost_found_reports WHERE id = :id FOR UPDATE');
        $reportStmt->execute([':id' => $reportId]);
        $reportRow = $reportStmt->fetch();
        if (!$reportRow) respond(404, ['success' => false, 'message' => 'Found report not found.']);
        if ($reportRow['report_type'] !== 'found' || $reportRow['status'] !== 'active') {
            respond(409, ['success' => false, 'message' => 'This found report is no longer open for claims.']);
        }
        if ((int) ($reportRow['owner_id'] ?? 0) === $claimantId) {
            respond(403, ['success' => false, 'message' => 'You cannot claim your own found report.']);
        }

        $reserved = $pdo->prepare("SELECT id FROM lost_found_claims WHERE report_id = :report_id AND status IN ('awaiting_handoff', 'approved') LIMIT 1");
        $reserved->execute([':report_id' => $reportId]);
        if ($reserved->fetchColumn()) {
            respond(409, ['success' => false, 'message' => 'This pet is reserved while an approved claimant coordinates the handoff.']);
        }

        $duplicate = $pdo->prepare("SELECT id FROM lost_found_claims WHERE report_id = :report_id AND claimant_user_id = :claimant_id AND status IN ('pending', 'awaiting_handoff', 'approved') LIMIT 1");
        $duplicate->execute([':report_id' => $reportId, ':claimant_id' => $claimantId]);
        if ($duplicate->fetchColumn()) {
            respond(409, ['success' => false, 'message' => 'You already have an open claim for this pet.']);
        }

        if ($matchId > 0) {
            $matchStmt = $pdo->prepare("
                SELECT m.id, lr.breed AS lost_breed, found.breed AS found_breed
                FROM lost_found_matches m
                INNER JOIN lost_found_reports lr ON lr.id = m.lost_report_id
                INNER JOIN lost_found_reports found ON found.id = m.found_report_id
                WHERE m.id = :match_id AND m.found_report_id = :report_id
                  AND m.status = 'suggested' AND lr.owner_id = :claimant_id AND lr.status = 'active'
                LIMIT 1
            ");
            $matchStmt->execute([':match_id' => $matchId, ':report_id' => $reportId, ':claimant_id' => $claimantId]);
            $selectedMatch = $matchStmt->fetch();
            if (!$selectedMatch) respond(422, ['success' => false, 'message' => 'That match is no longer available for a claim.']);
            if (clearlyDifferentBreeds($selectedMatch['lost_breed'], $selectedMatch['found_breed'])) {
                respond(422, ['success' => false, 'message' => 'The breed details do not support this suggested match.']);
            }
        }

        [$proofPath] = saveUpload('proof_file', 'lost_found_claims', false);
        $accountContact = userContactFromAccount($pdo, $data);
        $stmt = $pdo->prepare("
            INSERT INTO lost_found_claims
                (case_number, report_id, match_id, claimant_user_id, claimant_name, claimant_phone, claimant_email, proof_type, proof_notes, proof_file_path)
            VALUES
                (:case_number, :report_id, :match_id, :claimant_user_id, :claimant_name, :claimant_phone, :claimant_email, :proof_type, :proof_notes, :proof_file_path)
        ");
        $stmt->execute([
            ':case_number' => generateCaseNumber('CLM'),
            ':report_id' => $reportId,
            ':match_id' => $matchId ?: null,
            ':claimant_user_id' => $claimantId,
            ':claimant_name' => nullableClean($data['claimant_name'] ?? $data['contact_name'] ?? '') ?: ($accountContact['name'] ?? null),
            ':claimant_phone' => nullableClean($data['claimant_phone'] ?? $data['contact_phone'] ?? '') ?: ($accountContact['phone'] ?? null),
            ':claimant_email' => nullableClean($data['claimant_email'] ?? $data['contact_email'] ?? '') ?: ($accountContact['email'] ?? null),
            ':proof_type' => nullableClean($data['proof_type'] ?? ''),
            ':proof_notes' => nullableClean($data['proof_notes'] ?? $data['notes'] ?? ''),
            ':proof_file_path' => $proofPath,
        ]);

        $claimId = (int) $pdo->lastInsertId();
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    notifyStaff(
        $pdo,
        'both',
        'lost_found_new',
        'New Ownership Claim',
        'A new ownership claim is awaiting review.',
        $claimId,
        true
    );

    // The person who posted the found report also needs to know somebody has
    // claimed their pet — previously only staff heard about it, and the owner
    // saw it only because the browser re-derived it from the claims list.
    if ($reportRow && (int) $reportRow['owner_id'] > 0 && (int) $reportRow['owner_id'] !== $claimantId) {
        notifyUser(
            $pdo,
            (int) $reportRow['owner_id'],
            'lost_found_claim_new',
            'New Claim on Your Report',
            'Someone submitted an ownership claim on your report'
                . ($reportRow['pet_name'] ? " for {$reportRow['pet_name']}" : '')
                . " (case #{$reportRow['case_number']}). It is awaiting vet review.",
            $claimId
        );
    }

    respond(201, ['success' => true, 'message' => 'Claim submitted for vet review.', 'claim_id' => $claimId]);
}

function listClaims($pdo, $data, $management = false)
{
    $where = [];
    $params = [];

    // report_owner_id ("claims on reports I posted") and the claimant filter
    // ("claims I submitted") are mutually exclusive query intents. lostFoundForm()
    // auto-appends owner_id/user_id from the session to every request, so both
    // would otherwise apply together and silently exclude any claim submitted by
    // someone other than the current user.
    $reportOwnerId = (int) ($data['report_owner_id'] ?? 0);
    if ($reportOwnerId > 0) {
        $where[] = 'lost_found_reports.owner_id = :report_owner_id';
        $params[':report_owner_id'] = $reportOwnerId;
    } else {
        $userId = (int) ($data['user_id'] ?? $data['owner_id'] ?? 0);
        if (!$management && $userId > 0) {
            $where[] = 'lost_found_claims.claimant_user_id = :user_id';
            $params[':user_id'] = $userId;
        }
    }

    $status = clean($data['status'] ?? '');
    if ($status !== '' && $status !== 'all') {
        $where[] = 'lost_found_claims.status = :status';
        $params[':status'] = normalizeStatus($status, 'pending');
    }

    $sql = "
        SELECT lost_found_claims.*, lost_found_reports.case_number AS report_case, lost_found_reports.pet_name,
               lost_found_reports.photo_path, lost_found_reports.barangay_name, lost_found_reports.owner_id AS report_owner_id,
               lost_found_reports.contact_name AS finder_name, lost_found_reports.contact_phone AS finder_phone,
               lost_found_reports.contact_email AS finder_email, lost_found_reports.species AS report_species,
               lost_found_reports.breed AS report_breed, lost_found_reports.sex AS report_sex,
               lost_found_reports.size AS report_size, lost_found_reports.color_markings AS report_markings
        FROM lost_found_claims
        INNER JOIN lost_found_reports ON lost_found_reports.id = lost_found_claims.report_id
    ";
    if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
    $sql .= ' ORDER BY lost_found_claims.created_at DESC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    respond(200, ['success' => true, 'data' => $stmt->fetchAll()]);
}

function updateClaimStatus($pdo, $data, $status)
{
    if (!in_array($status, ['approved', 'rejected'], true)) {
        respond(422, ['success' => false, 'message' => 'Unsupported staff claim decision.']);
    }
    $id = (int) ($data['id'] ?? $data['claim_id'] ?? 0);
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid claim id.']);

    $lookup = $pdo->prepare('SELECT report_id FROM lost_found_claims WHERE id = :id LIMIT 1');
    $lookup->execute([':id' => $id]);
    $reportId = (int) $lookup->fetchColumn();
    if ($reportId <= 0) respond(404, ['success' => false, 'message' => 'Claim not found.']);

    $comparison = $status === 'approved'
        ? assertReasonForLowerPick($pdo, 'claim', $id, clean($data['review_notes'] ?? ''))
        : null;

    $pdo->beginTransaction();
    try {
        $reportLock = $pdo->prepare('SELECT id, report_type, status FROM lost_found_reports WHERE id = :id FOR UPDATE');
        $reportLock->execute([':id' => $reportId]);
        $report = $reportLock->fetch();
        if (!$report || $report['report_type'] !== 'found') {
            respond(404, ['success' => false, 'message' => 'Found report not found.']);
        }

        $claimStmt = $pdo->prepare("
            SELECT c.*, r.case_number AS report_case, r.pet_name, r.status AS report_status, r.owner_id AS report_owner_id
            FROM lost_found_claims c
            INNER JOIN lost_found_reports r ON r.id = c.report_id
            WHERE c.id = :id
            FOR UPDATE
        ");
        $claimStmt->execute([':id' => $id]);
        $claimInfo = $claimStmt->fetch();
        if (!$claimInfo) respond(404, ['success' => false, 'message' => 'Claim not found.']);
        if ($claimInfo['status'] !== 'pending') {
            respond(409, ['success' => false, 'message' => 'This claim has already been reviewed.']);
        }
        if ($status === 'approved' && !in_array($report['status'], ['active', 'expired'], true)) {
            respond(409, ['success' => false, 'message' => 'This found report is no longer open for approval.']);
        }
        if ($status === 'approved') {
            $reservedClaim = $pdo->prepare("SELECT id FROM lost_found_claims WHERE report_id = :report_id AND id <> :claim_id AND status IN ('awaiting_handoff', 'approved') LIMIT 1 FOR UPDATE");
            $reservedClaim->execute([':report_id' => $reportId, ':claim_id' => $id]);
            if ($reservedClaim->fetchColumn()) {
                respond(409, ['success' => false, 'message' => 'Another approved claim is already awaiting handoff for this pet.']);
            }
        }

        $storedStatus = $status === 'approved' ? 'awaiting_handoff' : 'rejected';
        $update = $pdo->prepare("UPDATE lost_found_claims SET status = :status, reviewed_by_user_id = :user_id, reviewed_at = NOW(), review_notes = :notes WHERE id = :id AND status = 'pending'");
        $update->execute([
            ':status' => $storedStatus,
            ':user_id' => (int) ($data['reviewed_by_user_id'] ?? $data['vet_id'] ?? 0) ?: null,
            ':notes' => clean($data['review_notes'] ?? ''),
            ':id' => $id,
        ]);
        if ($update->rowCount() !== 1) {
            respond(409, ['success' => false, 'message' => 'This claim has already been reviewed.']);
        }

        $closedClaims = [];
        if ($status === 'approved' && $comparison) {
            $closedClaims = closeOtherCandidates(
                $pdo,
                $comparison['foundId'],
                'claim',
                $id,
                (int) $comparison['subject']['ownerId'],
                (int) ($claimInfo['match_id'] ?? 0)
            );
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    foreach ($closedClaims as $claimId) notifyClaimReturnedToOther($pdo, $claimId);

    $claimantId = (int) ($claimInfo['claimant_user_id'] ?? 0);
    $claimantEmail = nullableClean($claimInfo['claimant_email'] ?? '');
    $claimLabel = $status === 'approved' ? 'approved and is awaiting handoff' : 'rejected';
    if ($claimantId > 0) {
        notifyUser(
            $pdo,
            $claimantId,
            'lost_found_claim_status',
            $status === 'approved' ? 'Claim Approved - Awaiting Handoff' : 'Claim Rejected',
            'Your claim' . ($claimInfo['pet_name'] ? " for {$claimInfo['pet_name']}" : '')
                . " (case #{$claimInfo['case_number']}) was {$claimLabel}.",
            $id
        );
    }
    $reportOwnerId = (int) ($claimInfo['report_owner_id'] ?? 0);
    if ($status === 'approved' && $reportOwnerId > 0 && $reportOwnerId !== $claimantId) {
        notifyUser(
            $pdo,
            $reportOwnerId,
            'lost_found_claim_status',
            'Claim Verified - Handoff Pending',
            'The clinic verified a claim for this report. The pet is reserved while the claimant coordinates handoff.',
            $id
        );
    }

    if ($claimantEmail && userWantsNotification($pdo, $claimantId, 'lost_found_alerts')) {
        $petLabel = $claimInfo['pet_name'] ? " for <strong>" . htmlspecialchars($claimInfo['pet_name']) . "</strong>" : '';
        $bodyText = $status === 'approved'
            ? 'The vet has verified your claim. Coordinate with the finder, then confirm receipt after the handoff.'
            : 'The vet management team was unable to verify this claim.';
        $body = notificationEmailWrapper(
            'Claim Update',
            "<p>Your claim{$petLabel} (case #{$claimInfo['case_number']}) was <strong>{$status}</strong>.</p><p>{$bodyText}</p>",
            null,
            ['label' => 'View', 'url' => APP_URL . '/public/pages/my-claims.html']
        );
        sendAppMail($claimantEmail, nullableClean($claimInfo['claimant_name'] ?? ''), 'BVetter - Your claim has been ' . $status, $body);
    }

    respond(200, [
        'success' => true,
        'status' => $status === 'approved' ? 'awaiting_handoff' : 'rejected',
        'message' => $status === 'approved' ? 'Claim approved. Awaiting handoff confirmation from the claimant.' : 'Claim rejected.',
    ]);
}

function confirmClaimHandoff($pdo, $data)
{
    $claimId = (int) ($data['claim_id'] ?? $data['id'] ?? 0);
    $claimantId = (int) ($data['user_id'] ?? $data['owner_id'] ?? 0);
    if ($claimId <= 0 || $claimantId <= 0) respond(422, ['success' => false, 'message' => 'Invalid handoff confirmation.']);

    $lookup = $pdo->prepare('SELECT report_id FROM lost_found_claims WHERE id = :id LIMIT 1');
    $lookup->execute([':id' => $claimId]);
    $reportId = (int) $lookup->fetchColumn();
    if ($reportId <= 0) respond(404, ['success' => false, 'message' => 'Claim not found.']);

    $pdo->beginTransaction();
    try {
        $reportLock = $pdo->prepare('SELECT id, status, report_type, owner_id, case_number FROM lost_found_reports WHERE id = :id FOR UPDATE');
        $reportLock->execute([':id' => $reportId]);
        $report = $reportLock->fetch();
        if (!$report || $report['report_type'] !== 'found') {
            respond(404, ['success' => false, 'message' => 'Found report not found.']);
        }

        $claimStmt = $pdo->prepare('SELECT * FROM lost_found_claims WHERE id = :id FOR UPDATE');
        $claimStmt->execute([':id' => $claimId]);
        $claim = $claimStmt->fetch();
        if (!$claim) respond(404, ['success' => false, 'message' => 'Claim not found.']);
        if ((int) ($claim['claimant_user_id'] ?? 0) !== $claimantId) {
            respond(403, ['success' => false, 'message' => 'You can only confirm your own claim.']);
        }
        if (!in_array($claim['status'], ['awaiting_handoff', 'approved'], true)) {
            respond(409, ['success' => false, 'message' => 'This claim is not awaiting a handoff confirmation.']);
        }
        if (!in_array($report['status'], ['active', 'expired', 'resolved'], true)) {
            respond(409, ['success' => false, 'message' => 'This found report can no longer be resolved by this claim.']);
        }

        $pdo->prepare("UPDATE lost_found_claims SET status = 'resolved' WHERE id = :id AND status IN ('awaiting_handoff', 'approved')")
            ->execute([':id' => $claimId]);
        if (in_array($report['status'], ['active', 'expired'], true)) {
            $pdo->prepare("UPDATE lost_found_reports SET status = 'resolved', resolved_at = NOW() WHERE id = :id AND status IN ('active','expired')")
                ->execute([':id' => $reportId]);
        }

        $matchId = (int) ($claim['match_id'] ?? 0);
        if ($matchId > 0) {
            $matchStmt = $pdo->prepare("\n                SELECT m.id, m.lost_report_id
                FROM lost_found_matches m
                INNER JOIN lost_found_reports lr ON lr.id = m.lost_report_id
                WHERE m.id = :match_id AND m.found_report_id = :found_id AND lr.owner_id = :claimant_id
                LIMIT 1
            ");
            $matchStmt->execute([':match_id' => $matchId, ':found_id' => $reportId, ':claimant_id' => $claimantId]);
        } else {
            $matchStmt = $pdo->prepare("\n                SELECT m.id, m.lost_report_id
                FROM lost_found_matches m
                INNER JOIN lost_found_reports lr ON lr.id = m.lost_report_id
                WHERE m.found_report_id = :found_id AND lr.owner_id = :claimant_id AND lr.status IN ('active','expired')
                  AND m.status = 'suggested'
                ORDER BY m.confidence DESC, m.created_at DESC
                LIMIT 1
            ");
            $matchStmt->execute([':found_id' => $reportId, ':claimant_id' => $claimantId]);
        }
        $match = $matchStmt->fetch();
        if ($match) {
            $pdo->prepare("UPDATE lost_found_reports SET status = 'resolved', resolved_at = NOW() WHERE id = :id AND status IN ('active','expired')")
                ->execute([':id' => (int) $match['lost_report_id']]);
            $pdo->prepare("UPDATE lost_found_matches SET status = 'approved', reviewed_at = NOW() WHERE id = :id AND status IN ('suggested', 'approved')")
                ->execute([':id' => (int) $match['id']]);
        }

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    notifyUser(
        $pdo,
        $claimantId,
        'lost_found_claim_status',
        'Handoff Confirmed',
        'You confirmed that you received the pet for case #' . $claim['case_number'] . '. The case is now resolved.',
        $claimId
    );
    $reportOwnerId = (int) ($report['owner_id'] ?? 0);
    if ($reportOwnerId > 0 && $reportOwnerId !== $claimantId) {
        notifyUser(
            $pdo,
            $reportOwnerId,
            'lost_found_claim_status',
            'Pet Handoff Confirmed',
            'The claimant confirmed they received the pet for case #' . $report['case_number'] . '. The report is now resolved.',
            $claimId
        );
    }
    respond(200, ['success' => true, 'status' => 'resolved', 'message' => 'Handoff confirmed. The case is resolved.']);
}

function rebuildImageFeatures($pdo)
{
    $updatedReports = 0;
    $updatedSightings = 0;

    $reports = $pdo->query("SELECT id, photo_path FROM lost_found_reports WHERE photo_path IS NOT NULL AND photo_path <> ''")->fetchAll();
    $updateReport = $pdo->prepare('UPDATE lost_found_reports SET image_features = :features WHERE id = :id');
    foreach ($reports as $report) {
        $absolute = absoluteUploadPath($report['photo_path']);
        $features = imageFeatures($absolute);
        if (!$features) continue;
        $updateReport->execute([
            ':features' => json_encode($features),
            ':id' => (int) $report['id'],
        ]);
        $updatedReports++;
        rebuildMatchesForReport($pdo, (int) $report['id']);
    }

    $sightings = $pdo->query("SELECT id, photo_path FROM lost_found_sightings WHERE photo_path IS NOT NULL AND photo_path <> ''")->fetchAll();
    $updateSighting = $pdo->prepare('UPDATE lost_found_sightings SET image_features = :features WHERE id = :id');
    foreach ($sightings as $sighting) {
        $absolute = absoluteUploadPath($sighting['photo_path']);
        $features = imageFeatures($absolute);
        if (!$features) continue;
        $updateSighting->execute([
            ':features' => json_encode($features),
            ':id' => (int) $sighting['id'],
        ]);
        $updatedSightings++;
    }

    respond(200, [
        'success' => true,
        'message' => 'Image features rebuilt.',
        'reports_updated' => $updatedReports,
        'sightings_updated' => $updatedSightings,
    ]);
}
function getTotalReportCount($pdo)
{
    $stmt = $pdo->query('SELECT COUNT(*) FROM lost_found_reports WHERE status IN ("resolved")');
    return (int) $stmt->fetchColumn();
}
function getActiveReportCount($pdo)
{
    $stmt = $pdo->query('SELECT COUNT(*) FROM lost_found_reports WHERE status IN ("active")');
    return (int) $stmt->fetchColumn();
}

$input = inputData();
$action = clean($input['action'] ?? 'list');

// Management/moderation actions are staff-only. list_sightings belongs here too:
// it returns every sighting in every state -- pending and rejected included --
// with the reporter's name, phone, email and map pin, and only the vet portal's
// review queue calls it. It used to answer anyone, logged in or not.
$staffActions = [
    'management_list', 'management_claims', 'rebuild_image_features',
    'approve', 'approve_report', 'reject', 'reject_report',
    'dismiss_match',
    'list_sightings', 'approve_sighting', 'reject_sighting',
    'approve_claim', 'reject_claim',
    'mark_reviewed', 'approval_check', 'resolution',
];
$staffSession = null;
if (in_array($action, $staffActions, true)) {
    require_once __DIR__ . '/../config/auth_guard.php';
    $staffSession = requireRole($pdo, ['veterinarian', 'admin']);
    // "Approved by" must be the signed-in staff member, not whatever id the
    // request body carries.
    $input['reviewed_by_user_id'] = (int) $staffSession['user_id'];
    $input['vet_id'] = (int) $staffSession['user_id'];
}

// Matches pair two people's reports and carry both sides' contact details, so
// they need a login. listMatches() then narrows a pet owner to their own report.
$viewer = null;
if ($action === 'matches' || $action === 'list_matches') {
    require_once __DIR__ . '/../config/auth_guard.php';
    $viewer = requireRole($pdo, ['pet_owner', 'veterinarian', 'admin']);
}

// Browsing the board (list, get) stays open for the logged-out landing page, but
// what comes back depends on who is asking: logged-out visitors get no poster
// details, and only staff see reports that aren't active. A missing, unknown or
// expired token simply means "logged out" here rather than a 401.
if ($action === 'list' || $action === 'get') {
    require_once __DIR__ . '/../config/session.php';
    $token = bearerToken();
    $session = $token !== null ? findSessionByToken($pdo, $token) : null;
    $viewer = ($session !== null && $session['revoked_at'] === null) ? $session : null;
}

// Owner-side actions: anything that reads or writes one specific person's data.
//
// These previously took the identity straight from the request body and only
// checked it was a positive integer -- the "You must be logged in" responses in
// listMyReports()/createClaim()/createSighting() verified nothing at all. So an
// unauthenticated POST carrying someone else's owner_id could read their reports
// (full name, phone number, email address and map coordinates), file claims and
// sightings in their name, and close their reports. resolveOwnReport() compared
// the report's owner against that same body value, so its ownership check passed
// for an attacker who simply sent the victim's id.
//
// The bearer token is now the only source of identity here, matching
// api/users/profile.php and api/pets/my_pets.php.
$ownerActions = [
    'my_reports',
    'create', 'create_report',
    'create_claim', 'submit_claim', 'list_claims', 'confirm_claim_handoff',
    'create_sighting', 'submit_sighting',
    'resolve_own_report',
];
if (in_array($action, $ownerActions, true)) {
    require_once __DIR__ . '/../config/auth_guard.php';
    $ownerSession = requireRole($pdo, ['pet_owner', 'veterinarian', 'admin']);
    $authId = (int) $ownerSession['user_id'];

    if (in_array($action, ['create_claim', 'submit_claim', 'confirm_claim_handoff'], true)
        && $ownerSession['role_name'] !== 'pet_owner') {
        respond(403, ['success' => false, 'message' => 'Only a pet owner can file or confirm an ownership claim.']);
    }

    $input['user_id']  = $authId;
    $input['owner_id'] = $authId;

    // createReport() derives the new report's STATUS from this role: 'vet' or
    // 'admin' publishes immediately as 'active', anything else waits at
    // 'pending' for moderation. Taken from the body, that let any caller send
    // role=admin and push an unreviewed post straight onto the public feed.
    // The session decides the role now, so moderation cannot be self-granted.
    $input['role']        = $ownerSession['role_name'];
    $input['source_role'] = $ownerSession['role_name'];

    // report_owner_id means "claims filed against MY reports". listClaims()
    // branches on whether it was sent at all, so overwrite the value when it is
    // present rather than always adding it -- force-adding would change which
    // claims a caller sees instead of merely stopping them seeing someone else's.
    if ((int) ($input['report_owner_id'] ?? 0) > 0) {
        $input['report_owner_id'] = $authId;
    }
}

try {
    ensureLostFoundSchema($pdo);
    ensureClaimWorkflowSchema($pdo);
    ensureMatchReviewNotes($pdo);
    ensureReportLifespanSchema($pdo);
    expireOldReports($pdo);
    autoPublishDueReports($pdo);
    runTimedRules($pdo);

    if ($action === 'schema') respond(200, ['success' => true, 'message' => 'Lost and found schema is ready.']);
    if ($action === 'mark_reviewed') markReportReviewed($pdo, $input, $staffSession);
    if ($action === 'approval_check') approvalCheck($pdo, $input);
    if ($action === 'resolution') reportResolution($pdo, $input);
    if ($action === 'rebuild_image_features') rebuildImageFeatures($pdo);
    if ($action === 'list') listReports($pdo, $input, false, $viewer);
    if ($action === 'management_list') listReports($pdo, $input, true);
    if ($action === 'get') getReport($pdo, $input, $viewer);
    if ($action === 'my_reports') listMyReports($pdo, $input);
    if ($action === 'create' || $action === 'create_report') createReport($pdo, $input);
    if ($action === 'approve' || $action === 'approve_report') updateReportStatus($pdo, $input, 'active');
    if ($action === 'reject' || $action === 'reject_report') updateReportStatus($pdo, $input, 'rejected');
    if ($action === 'matches' || $action === 'list_matches') listMatches($pdo, $input, $viewer);
    if ($action === 'dismiss_match') updateMatchStatus($pdo, $input, 'dismissed');
    if ($action === 'resolve_own_report') resolveOwnReport($pdo, $input);
    if ($action === 'create_sighting' || $action === 'submit_sighting') createSighting($pdo, $input);
    if ($action === 'list_sightings') listSightings($pdo, $input);
    if ($action === 'approve_sighting') updateSightingStatus($pdo, $input, 'active');
    if ($action === 'reject_sighting') updateSightingStatus($pdo, $input, 'rejected');
    if ($action === 'create_claim' || $action === 'submit_claim') createClaim($pdo, $input);
    if ($action === 'list_claims') listClaims($pdo, $input, false);
    if ($action === 'management_claims') listClaims($pdo, $input, true);
    if ($action === 'approve_claim') updateClaimStatus($pdo, $input, 'approved');
    if ($action === 'reject_claim') updateClaimStatus($pdo, $input, 'rejected');
    if ($action === 'confirm_claim_handoff') confirmClaimHandoff($pdo, $input);
    if ($action === 'get_total_reports') {    echo json_encode([
        'success' => true,
        'count' => getTotalReportCount($pdo)
    ]);
    exit;   
    }
    if ($action === 'get_active_reports') { echo json_encode([
        'success' => true,
        'count' => getActiveReportCount($pdo)
    ]);
    exit;   
    }

    respond(400, ['success' => false, 'message' => 'Unknown lost and found action.']);
} catch (PDOException $e) {
    error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
    if ($pdo->inTransaction()) $pdo->rollBack();
    respond(500, [
        'success' => false,
        'message' => 'Lost and found request failed.'
    ]);
}

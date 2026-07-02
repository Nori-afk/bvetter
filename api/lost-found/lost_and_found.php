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
    $allowed = ['pending', 'active', 'resolved', 'rejected', 'dismissed', 'approved'];
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
            status ENUM('pending','active','resolved','rejected') NOT NULL DEFAULT 'pending',
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
            status ENUM('pending','approved','rejected','resolved') NOT NULL DEFAULT 'pending',
            claimant_name VARCHAR(150) NULL,
            claimant_phone VARCHAR(40) NULL,
            claimant_email VARCHAR(150) NULL,
            proof_type VARCHAR(80) NULL,
            proof_notes TEXT NULL,
            proof_file_path VARCHAR(255) NULL,
            reviewed_by_user_id INT NULL,
            reviewed_at DATETIME NULL,
            review_notes TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_lfc_report (report_id),
            INDEX idx_lfc_status (status),
            CONSTRAINT fk_lfc_report FOREIGN KEY (report_id) REFERENCES lost_found_reports(id) ON DELETE CASCADE,
            CONSTRAINT fk_lfc_user FOREIGN KEY (claimant_user_id) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
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

function publicUploadPath($fileName, $folder)
{
    return '/final-VBETTER/bvetter/storage/' . $folder . '/' . $fileName;
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

    if (!move_uploaded_file($file['tmp_name'], $absolute)) {
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

function tokenSet($text)
{
    $text = strtolower((string) $text);
    $text = preg_replace('/[^a-z0-9]+/', ' ', $text);
    $parts = preg_split('/\s+/', trim($text));
    $tokens = [];
    foreach ($parts as $part) {
        if (strlen($part) >= 2) $tokens[$part] = true;
    }
    return array_keys($tokens);
}

function jaccard($a, $b)
{
    $a = tokenSet($a);
    $b = tokenSet($b);
    if (!$a || !$b) return 0.0;
    $setA = array_fill_keys($a, true);
    $setB = array_fill_keys($b, true);
    $intersection = count(array_intersect_key($setA, $setB));
    $union = count($setA + $setB);
    return $union > 0 ? $intersection / $union : 0.0;
}

function hammingSimilarity($a, $b)
{
    if (!$a || !$b || strlen($a) !== strlen($b)) return null;
    $diff = 0;
    $len = strlen($a);
    for ($i = 0; $i < $len; $i++) {
        if ($a[$i] !== $b[$i]) $diff++;
    }
    return 1.0 - ($diff / $len);
}

function rgbSimilarity($a, $b)
{
    if (!is_array($a) || !is_array($b) || count($a) < 3 || count($b) < 3) return null;
    $distance = sqrt(pow($a[0] - $b[0], 2) + pow($a[1] - $b[1], 2) + pow($a[2] - $b[2], 2));
    return max(0.0, 1.0 - ($distance / 441.68));
}

function distanceKm($lat1, $lng1, $lat2, $lng2)
{
    if ($lat1 === null || $lng1 === null || $lat2 === null || $lng2 === null) return null;
    $earth = 6371;
    $dLat = deg2rad((float) $lat2 - (float) $lat1);
    $dLng = deg2rad((float) $lng2 - (float) $lng1);
    $a = sin($dLat / 2) * sin($dLat / 2) + cos(deg2rad((float) $lat1)) * cos(deg2rad((float) $lat2)) * sin($dLng / 2) * sin($dLng / 2);
    return $earth * (2 * atan2(sqrt($a), sqrt(1 - $a)));
}

function scoreMatch($lost, $candidate)
{
    $score = 0;
    $reasons = [];
    $lostSpecies = strtolower(clean($lost['species'] ?? ''));
    $candidateSpecies = strtolower(clean($candidate['species'] ?? ''));

    if ($lostSpecies !== '' && $candidateSpecies !== '' && $lostSpecies !== $candidateSpecies) {
        return [0, ['Different species']];
    }

    if ($lostSpecies !== '' && $candidateSpecies !== '' && $lostSpecies === $candidateSpecies) {
        $score += 12;
        $reasons[] = 'Same species';
    }

    $breed = jaccard($lost['breed'], $candidate['breed']);
    if ($breed >= 0.5) $reasons[] = 'Similar breed';
    $score += (int) round($breed * 14);

    if (clean($lost['sex']) !== '' && clean($candidate['sex']) !== '' && strtolower($lost['sex']) === strtolower($candidate['sex'])) {
        $score += 8;
        $reasons[] = 'Same sex';
    }

    if (clean($lost['size']) !== '' && clean($candidate['size']) !== '' && strtolower($lost['size']) === strtolower($candidate['size'])) {
        $score += 10;
        $reasons[] = 'Same size';
    }

    $markings = jaccard($lost['color_markings'] . ' ' . $lost['notes'], $candidate['color_markings'] . ' ' . $candidate['notes']);
    if ($markings >= 0.25) $reasons[] = 'Similar color or markings';
    $score += (int) round($markings * 18);

    if ($lost['barangay_id'] && $candidate['barangay_id'] && (int) $lost['barangay_id'] === (int) $candidate['barangay_id']) {
        $score += 18;
        $reasons[] = 'Same barangay';
    } else {
        $distance = distanceKm($lost['latitude'], $lost['longitude'], $candidate['latitude'], $candidate['longitude']);
        if ($distance !== null) {
            if ($distance <= 1) {
                $score += 18;
                $reasons[] = 'Within 1 km';
            } elseif ($distance <= 3) {
                $score += 12;
                $reasons[] = 'Nearby location';
            } elseif ($distance <= 7) {
                $score += 6;
                $reasons[] = 'Same city area';
            }
        }
    }

    $lostFeatures = json_decode((string) $lost['image_features'], true);
    $candidateFeatures = json_decode((string) $candidate['image_features'], true);
    if (is_array($lostFeatures) && is_array($candidateFeatures)) {
        $rgb = rgbSimilarity($lostFeatures['avg_rgb'] ?? null, $candidateFeatures['avg_rgb'] ?? null);
        if ($rgb !== null) {
            if ($rgb >= 0.78) $reasons[] = 'Similar photo color profile';
            $score += (int) round($rgb * 10);
        }

        $hash = hammingSimilarity($lostFeatures['brightness_hash'] ?? null, $candidateFeatures['brightness_hash'] ?? null);
        if ($hash !== null) {
            if ($hash >= 0.68) $reasons[] = 'Similar image pattern';
            $score += (int) round($hash * 10);
        } elseif (($lostFeatures['width'] ?? 0) && ($candidateFeatures['width'] ?? 0)) {
            $ratioA = ((float) $lostFeatures['width']) / max(1, (float) $lostFeatures['height']);
            $ratioB = ((float) $candidateFeatures['width']) / max(1, (float) $candidateFeatures['height']);
            $ratioScore = max(0, 1 - min(1, abs($ratioA - $ratioB)));
            $score += (int) round($ratioScore * 4);
        }
    }

    $score = min(100, max(0, $score));
    if (!$reasons) $reasons[] = 'Low-confidence candidate';

    return [$score, array_values(array_unique($reasons))];
}

function reportRowToArray($row)
{
    return [
        'id' => (int) $row['id'],
        'caseId' => $row['case_number'],
        'case_number' => $row['case_number'],
        'type' => ucfirst($row['report_type']),
        'status' => $row['status'],
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
        'notes' => $row['notes'],
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
    ];
}

function reportSelectSql()
{
    return "
        SELECT lost_found_reports.*, users.full_name AS owner_name
        FROM lost_found_reports
        LEFT JOIN users ON users.id = lost_found_reports.owner_id
    ";
}

function listReports($pdo, $data, $management = false)
{
    $where = [];
    $params = [];

    $status = clean($data['status'] ?? '');
    if ($status !== '' && $status !== 'all') {
        $where[] = 'lost_found_reports.status = :status';
        $params[':status'] = normalizeStatus($status, $management ? 'pending' : 'active');
    } elseif (!$management) {
        $where[] = "lost_found_reports.status = 'active'";
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

    $ownerId = (int) ($data['owner_id'] ?? $data['user_id'] ?? 0);
    if (!$management && $ownerId > 0) {
        $where[] = 'lost_found_reports.owner_id = :owner_id';
        $params[':owner_id'] = $ownerId;
    }
    
    $barangay = clean($data['barangay'] ?? $data['barangay_name'] ?? '');
    if ($barangay !== '' && strtolower($barangay) !== 'select barangay') {
        $where[] = 'lost_found_reports.barangay_name = :barangay';
        $params[':barangay'] = $barangay;
    }

    $search = clean($data['search'] ?? '');
    if ($search !== '') {
        $where[] = '(lost_found_reports.pet_name LIKE :search OR lost_found_reports.breed LIKE :search OR lost_found_reports.color_markings LIKE :search OR lost_found_reports.notes LIKE :search OR lost_found_reports.case_number LIKE :search)';
        $params[':search'] = '%' . $search . '%';
    }

    $sql = reportSelectSql();
    if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
    $sql .= ' ORDER BY lost_found_reports.created_at DESC';

    $limit = (int) ($data['limit'] ?? 0);
    if ($limit > 0 && $limit <= 100) {
        $sql .= ' LIMIT ' . $limit;
    }

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $reports = array_map('reportRowToArray', $stmt->fetchAll());

    respond(200, ['success' => true, 'data' => $reports]);
}

function getReport($pdo, $data)
{
    $id = (int) ($data['id'] ?? $data['report_id'] ?? 0);
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid report id.']);

    $stmt = $pdo->prepare(reportSelectSql() . ' WHERE lost_found_reports.id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    if (!$row) respond(404, ['success' => false, 'message' => 'Report not found.']);

    respond(200, ['success' => true, 'data' => reportRowToArray($row)]);
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

    if (!$species || !$breed) {
        respond(422, ['success' => false, 'message' => 'Species and breed are required.']);
    }
    if (!nullableClean($data['sex'] ?? '') || !nullableClean($data['size'] ?? '')) {
        respond(422, ['success' => false, 'message' => 'Sex and size are required.']);
    }
    if (!nullableClean($data['color_markings'] ?? $data['markings'] ?? '')) {
        respond(422, ['success' => false, 'message' => 'Color or markings are required.']);
    }
    if (!nullableClean($data['notes'] ?? '')) {
        respond(422, ['success' => false, 'message' => 'Additional notes are required.']);
    }
    if (!normalizeDate($data['incident_date'] ?? $data['dateLost'] ?? $data['date'] ?? '')) {
        respond(422, ['success' => false, 'message' => 'Incident date is required.']);
    }
    if ($type === 'lost' && !$petName) {
        respond(422, ['success' => false, 'message' => 'Pet name is required for lost pet reports.']);
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
        ':sex' => nullableClean($data['sex'] ?? ''),
        ':size' => nullableClean($data['size'] ?? ''),
        ':color_markings' => nullableClean($data['color_markings'] ?? $data['markings'] ?? ''),
        ':notes' => nullableClean($data['notes'] ?? ''),
        ':barangay_id' => $barangayId,
        ':barangay_name' => $barangayName,
        ':location_text' => nullableClean($data['location_text'] ?? $data['location'] ?? ''),
        ':latitude' => clean($data['latitude'] ?? $data['lat'] ?? '') !== '' ? (float) ($data['latitude'] ?? $data['lat']) : null,
        ':longitude' => clean($data['longitude'] ?? $data['lng'] ?? '') !== '' ? (float) ($data['longitude'] ?? $data['lng']) : null,
        ':incident_date' => normalizeDate($data['incident_date'] ?? $data['dateLost'] ?? $data['date'] ?? ''),
        ':incident_time' => normalizeTimeValue($data['incident_time'] ?? $data['timeLost'] ?? $data['time'] ?? ''),
        ':photo_path' => $photoPath,
        ':image_features' => $features ? json_encode($features) : null,
        ':contact_name' => $contactName,
        ':contact_phone' => $contactPhone,
        ':contact_email' => $contactEmail,
    ]);

    $reportId = (int) $pdo->lastInsertId();
    rebuildMatchesForReport($pdo, $reportId);

    respond(201, [
        'success' => true,
        'message' => $status === 'active' ? 'Report published.' : 'Report submitted for vet review.',
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

    if ($status === 'active') rebuildMatchesForReport($pdo, $id);

    respond(200, ['success' => true, 'message' => 'Report status updated.']);
}

function fetchReportForMatch($pdo, $id)
{
    $stmt = $pdo->prepare('SELECT * FROM lost_found_reports WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    return $stmt->fetch();
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
        if ($score < 45) continue;

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
        }
    }

    $lostId = $report['report_type'] === 'lost' ? (int) $report['id'] : 0;
    if ($lostId > 0) rebuildSightingMatches($pdo, $lostId);
}

function rebuildSightingMatches($pdo, $lostReportId)
{
    $lost = fetchReportForMatch($pdo, $lostReportId);
    if (!$lost || $lost['status'] !== 'active') return;

    $stmt = $pdo->query("SELECT * FROM lost_found_sightings WHERE status IN ('pending','active')");
    foreach ($stmt->fetchAll() as $sighting) {
        $candidate = [
            'species' => $lost['species'],
            'breed' => $lost['breed'],
            'sex' => $lost['sex'],
            'size' => $lost['size'],
            'color_markings' => '',
            'notes' => $sighting['notes'],
            'barangay_id' => $sighting['barangay_id'],
            'latitude' => $sighting['latitude'],
            'longitude' => $sighting['longitude'],
            'image_features' => $sighting['image_features'],
        ];
        [$score, $reasons] = scoreMatch($lost, $candidate);
        if ($score < 38) continue;

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
        }
    }
}

function listMatches($pdo, $data)
{
    $reportId = (int) ($data['report_id'] ?? $data['id'] ?? 0);
    $includeResolved = (int) ($data['include_resolved'] ?? 0) === 1;
    $where = [
        $includeResolved ? "lost_found_matches.status IN ('suggested','approved')" : "lost_found_matches.status = 'suggested'",
        "lost.status = 'active'",
        "(lost_found_matches.found_report_id IS NULL OR found.status = 'active')",
    ];
    $params = [];
    if ($reportId > 0) {
        $report = fetchReportForMatch($pdo, $reportId);
        if (!$report || $report['status'] !== 'active') {
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
            lost.case_number AS lost_case, lost.pet_name AS lost_name, lost.species AS lost_species, lost.breed AS lost_breed, lost.photo_path AS lost_photo, lost.barangay_name AS lost_barangay,
            found.case_number AS found_case, found.pet_name AS found_name, found.species AS found_species, found.breed AS found_breed, found.photo_path AS found_photo, found.barangay_name AS found_barangay,
            sightings.case_number AS sighting_case, sightings.photo_path AS sighting_photo, sightings.barangay_name AS sighting_barangay, sightings.notes AS sighting_notes
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
        $matches[] = [
            'id' => (int) $row['id'],
            'confidence' => (int) $row['confidence'],
            'reasons' => json_decode((string) $row['reasons_json'], true) ?: [],
            'status' => $row['status'],
            'lost' => [
                'reportId' => (int) $row['lost_report_id'],
                'caseId' => $row['lost_case'],
                'name' => $row['lost_name'] ?: 'Lost Pet Report',
                'species' => $row['lost_species'],
                'breed' => $row['lost_breed'],
                'location' => $row['lost_barangay'],
                'image' => $row['lost_photo'],
            ],
            'found' => [
                'reportId' => $row['found_report_id'] ? (int) $row['found_report_id'] : null,
                'sightingId' => $row['sighting_id'] ? (int) $row['sighting_id'] : null,
                'caseId' => $row['found_case'] ?: $row['sighting_case'],
                'name' => $row['found_report_id'] ? ($row['found_name'] ?: 'Found Pet Report') : 'Sighting Report',
                'species' => $row['found_species'],
                'breed' => $row['found_breed'],
                'location' => $row['found_barangay'] ?: $row['sighting_barangay'],
                'image' => $row['found_photo'] ?: $row['sighting_photo'],
                'notes' => $row['sighting_notes'],
            ],
        ];
    }

    respond(200, ['success' => true, 'data' => $matches]);
}

function updateMatchStatus($pdo, $data, $status)
{
    $id = (int) ($data['id'] ?? $data['match_id'] ?? 0);
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid match id.']);

    $stmt = $pdo->prepare('SELECT * FROM lost_found_matches WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $match = $stmt->fetch();
    if (!$match) respond(404, ['success' => false, 'message' => 'Match not found.']);

    $pdo->beginTransaction();
    $update = $pdo->prepare('UPDATE lost_found_matches SET status = :status, reviewed_by_user_id = :user_id, reviewed_at = NOW() WHERE id = :id');
    $update->execute([
        ':status' => $status,
        ':user_id' => (int) ($data['reviewed_by_user_id'] ?? $data['vet_id'] ?? 0) ?: null,
        ':id' => $id,
    ]);

    if ($status === 'approved') {
        $resolve = $pdo->prepare("UPDATE lost_found_reports SET status = 'resolved', resolved_at = NOW() WHERE id IN (:lost_id, :found_id)");
        if ($match['found_report_id']) {
            $resolve->execute([
                ':lost_id' => (int) $match['lost_report_id'],
                ':found_id' => (int) $match['found_report_id'],
            ]);
        } else {
            $one = $pdo->prepare("UPDATE lost_found_reports SET status = 'resolved', resolved_at = NOW() WHERE id = :id");
            $one->execute([':id' => (int) $match['lost_report_id']]);
            if ($match['sighting_id']) {
                $pdo->prepare("UPDATE lost_found_sightings SET status = 'resolved', reviewed_at = NOW() WHERE id = :id")->execute([':id' => (int) $match['sighting_id']]);
            }
        }
    }

    $pdo->commit();
    respond(200, ['success' => true, 'message' => 'Match updated.']);
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
        ':sighting_date' => normalizeDate($data['sighting_date'] ?? $data['date'] ?? ''),
        ':sighting_time' => normalizeTimeValue($data['sighting_time'] ?? $data['time'] ?? ''),
        ':notes' => nullableClean($data['notes'] ?? ''),
        ':photo_path' => $photoPath,
        ':image_features' => ($features = imageFeatures($absolutePhoto)) ? json_encode($features) : null,
        ':contact_name' => nullableClean($data['contact_name'] ?? $data['uploader'] ?? ''),
        ':contact_phone' => nullableClean($data['contact_phone'] ?? $data['contact'] ?? ''),
        ':contact_email' => nullableClean($data['contact_email'] ?? $data['email'] ?? ''),
    ]);

    $sightingId = (int) $pdo->lastInsertId();
    $lostReports = $pdo->query("SELECT id FROM lost_found_reports WHERE report_type = 'lost' AND status = 'active'")->fetchAll();
    foreach ($lostReports as $row) rebuildSightingMatches($pdo, (int) $row['id']);

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

    $stmt = $pdo->prepare('UPDATE lost_found_sightings SET status = :status, reviewed_by_user_id = :user_id, reviewed_at = NOW(), review_notes = :notes WHERE id = :id');
    $stmt->execute([
        ':status' => $status,
        ':user_id' => (int) ($data['reviewed_by_user_id'] ?? $data['vet_id'] ?? 0) ?: null,
        ':notes' => clean($data['review_notes'] ?? ''),
        ':id' => $id,
    ]);

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

    [$proofPath] = saveUpload('proof_file', 'lost_found_claims', false);
    $stmt = $pdo->prepare("
        INSERT INTO lost_found_claims
            (case_number, report_id, claimant_user_id, claimant_name, claimant_phone, claimant_email, proof_type, proof_notes, proof_file_path)
        VALUES
            (:case_number, :report_id, :claimant_user_id, :claimant_name, :claimant_phone, :claimant_email, :proof_type, :proof_notes, :proof_file_path)
    ");
    $stmt->execute([
        ':case_number' => generateCaseNumber('CLM'),
        ':report_id' => $reportId,
        ':claimant_user_id' => (int) ($data['user_id'] ?? $data['owner_id'] ?? 0) ?: null,
        ':claimant_name' => nullableClean($data['claimant_name'] ?? $data['contact_name'] ?? ''),
        ':claimant_phone' => nullableClean($data['claimant_phone'] ?? $data['contact_phone'] ?? ''),
        ':claimant_email' => nullableClean($data['claimant_email'] ?? $data['contact_email'] ?? ''),
        ':proof_type' => nullableClean($data['proof_type'] ?? ''),
        ':proof_notes' => nullableClean($data['proof_notes'] ?? $data['notes'] ?? ''),
        ':proof_file_path' => $proofPath,
    ]);

    respond(201, ['success' => true, 'message' => 'Claim submitted for vet review.', 'claim_id' => (int) $pdo->lastInsertId()]);
}

function listClaims($pdo, $data, $management = false)
{
    $where = [];
    $params = [];
    $userId = (int) ($data['user_id'] ?? $data['owner_id'] ?? 0);
    if (!$management && $userId > 0) {
        $where[] = 'lost_found_claims.claimant_user_id = :user_id';
        $params[':user_id'] = $userId;
    }

    $status = clean($data['status'] ?? '');
    if ($status !== '' && $status !== 'all') {
        $where[] = 'lost_found_claims.status = :status';
        $params[':status'] = normalizeStatus($status, 'pending');
    }

    $sql = "
        SELECT lost_found_claims.*, lost_found_reports.case_number AS report_case, lost_found_reports.pet_name,
               lost_found_reports.photo_path, lost_found_reports.barangay_name
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
    $id = (int) ($data['id'] ?? $data['claim_id'] ?? 0);
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid claim id.']);

    $pdo->beginTransaction();
    $stmt = $pdo->prepare('UPDATE lost_found_claims SET status = :status, reviewed_by_user_id = :user_id, reviewed_at = NOW(), review_notes = :notes WHERE id = :id');
    $stmt->execute([
        ':status' => $status,
        ':user_id' => (int) ($data['reviewed_by_user_id'] ?? $data['vet_id'] ?? 0) ?: null,
        ':notes' => clean($data['review_notes'] ?? ''),
        ':id' => $id,
    ]);

    if (in_array($status, ['approved', 'resolved'], true)) {
        $reportId = $pdo->prepare('SELECT report_id FROM lost_found_claims WHERE id = :id LIMIT 1');
        $reportId->execute([':id' => $id]);
        $row = $reportId->fetch();
        if ($row) {
            $pdo->prepare("UPDATE lost_found_reports SET status = 'resolved', resolved_at = NOW() WHERE id = :id")->execute([':id' => (int) $row['report_id']]);
        }
    }

    $pdo->commit();
    respond(200, ['success' => true, 'message' => 'Claim updated.']);
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

try {
    ensureLostFoundSchema($pdo);

    if ($action === 'schema') respond(200, ['success' => true, 'message' => 'Lost and found schema is ready.']);
    if ($action === 'rebuild_image_features') rebuildImageFeatures($pdo);
    if ($action === 'list') listReports($pdo, $input, false);
    if ($action === 'management_list') listReports($pdo, $input, true);
    if ($action === 'get') getReport($pdo, $input);
    if ($action === 'my_reports') listReports($pdo, $input, true);
    if ($action === 'create' || $action === 'create_report') createReport($pdo, $input);
    if ($action === 'approve' || $action === 'approve_report') updateReportStatus($pdo, $input, 'active');
    if ($action === 'reject' || $action === 'reject_report') updateReportStatus($pdo, $input, 'rejected');
    if ($action === 'resolve' || $action === 'resolve_report') updateReportStatus($pdo, $input, 'resolved');
    if ($action === 'matches' || $action === 'list_matches') listMatches($pdo, $input);
    if ($action === 'approve_match') updateMatchStatus($pdo, $input, 'approved');
    if ($action === 'dismiss_match') updateMatchStatus($pdo, $input, 'dismissed');
    if ($action === 'create_sighting' || $action === 'submit_sighting') createSighting($pdo, $input);
    if ($action === 'list_sightings') listSightings($pdo, $input);
    if ($action === 'approve_sighting') updateSightingStatus($pdo, $input, 'active');
    if ($action === 'reject_sighting') updateSightingStatus($pdo, $input, 'rejected');
    if ($action === 'resolve_sighting') updateSightingStatus($pdo, $input, 'resolved');
    if ($action === 'create_claim' || $action === 'submit_claim') createClaim($pdo, $input);
    if ($action === 'list_claims') listClaims($pdo, $input, false);
    if ($action === 'management_claims') listClaims($pdo, $input, true);
    if ($action === 'approve_claim') updateClaimStatus($pdo, $input, 'approved');
    if ($action === 'reject_claim') updateClaimStatus($pdo, $input, 'rejected');
    if ($action === 'resolve_claim') updateClaimStatus($pdo, $input, 'resolved');
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
    if ($pdo->inTransaction()) $pdo->rollBack();
    respond(500, [
        'success' => false,
        'message' => 'Lost and found request failed.',
        'error' => $e->getMessage()
    ]);
}

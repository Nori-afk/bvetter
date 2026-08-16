<?php

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

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
    return is_array($json)
        ? array_merge($_POST, $json)
        : $_POST;
}

function clean($value)
{
    return trim((string)($value ?? ''));
}

function nullableClean($value)
{
    $value = clean($value);
    return $value === '' ? null : $value;
}

function truthy($value)
{
    return in_array($value, [1, '1', true, 'true', 'on'], true);
}

/* How long a computed stat (visits, rating) is trusted before re-querying.
   Keeps the public landing page from running COUNT()/AVG() on every visit —
   appointments/reviews grow without bound, unlike the small users table
   activeSpecialistsCount() scans. */
const STATS_CACHE_TTL_SECONDS = 900;

function setupSiteSettings($pdo)
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS site_settings (
            id INT PRIMARY KEY,
            primary_color VARCHAR(7) NOT NULL DEFAULT '#002A58',
            logo_path VARCHAR(255) NULL,
            hero_banner_path VARCHAR(255) NULL,
            team_image_path VARCHAR(255) NULL,
            about_text TEXT NULL,
            contact_email VARCHAR(190) NULL,
            contact_phone VARCHAR(40) NULL,
            address VARCHAR(255) NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec("
        INSERT IGNORE INTO site_settings
            (id, primary_color, about_text, contact_email, contact_phone, address)
        VALUES
            (1, '#002A58', '', 'BaliwagtVC@gmail.com', '09959210640',
             'AgriCorp Building, Baliwag Government Complex, 247 Highway, Baliwag, Philippines, 3026')
    ");

    /* visits_override / rating_override: admin-typed text that, when non-blank,
       wins over the computed value. Renamed in place from the old
       clinic_capacity / surgery_recovery_rate columns so existing admin
       input is preserved as an override rather than lost. */
    $visitsOverrideCheck = $pdo->query("SHOW COLUMNS FROM site_settings LIKE 'visits_override'")->fetch();
    if (!$visitsOverrideCheck) {
        $oldColumn = $pdo->query("SHOW COLUMNS FROM site_settings LIKE 'clinic_capacity'")->fetch();
        if ($oldColumn) {
            $pdo->exec("ALTER TABLE site_settings CHANGE clinic_capacity visits_override VARCHAR(30) NOT NULL DEFAULT ''");
        } else {
            $pdo->exec("ALTER TABLE site_settings ADD COLUMN visits_override VARCHAR(30) NOT NULL DEFAULT '' AFTER address");
        }
    }

    $ratingOverrideCheck = $pdo->query("SHOW COLUMNS FROM site_settings LIKE 'rating_override'")->fetch();
    if (!$ratingOverrideCheck) {
        $oldColumn = $pdo->query("SHOW COLUMNS FROM site_settings LIKE 'surgery_recovery_rate'")->fetch();
        if ($oldColumn) {
            $pdo->exec("ALTER TABLE site_settings CHANGE surgery_recovery_rate rating_override VARCHAR(30) NOT NULL DEFAULT ''");
        } else {
            $pdo->exec("ALTER TABLE site_settings ADD COLUMN rating_override VARCHAR(30) NOT NULL DEFAULT '' AFTER visits_override");
        }
    }

    /* visits_cache / rating_cache (+ _at timestamps): last computed value and
       when it was computed, so the public page can reuse it until it goes
       stale instead of re-querying appointments/reviews on every load. */
    $visitsCacheCheck = $pdo->query("SHOW COLUMNS FROM site_settings LIKE 'visits_cache'")->fetch();
    if (!$visitsCacheCheck) {
        $pdo->exec("ALTER TABLE site_settings ADD COLUMN visits_cache INT NULL AFTER visits_override");
        $pdo->exec("ALTER TABLE site_settings ADD COLUMN visits_cached_at TIMESTAMP NULL AFTER visits_cache");
    }

    $ratingCacheCheck = $pdo->query("SHOW COLUMNS FROM site_settings LIKE 'rating_cache'")->fetch();
    if (!$ratingCacheCheck) {
        $pdo->exec("ALTER TABLE site_settings ADD COLUMN rating_cache DECIMAL(3,1) NULL AFTER rating_override");
        $pdo->exec("ALTER TABLE site_settings ADD COLUMN rating_cached_at TIMESTAMP NULL AFTER rating_cache");
    }
}

function activeSpecialistsCount($pdo)
{
    $stmt = $pdo->query("
        SELECT COUNT(*) FROM users u
        INNER JOIN roles r ON r.id = u.role_id
        WHERE r.name = 'veterinarian' AND u.account_status = 'active'
    ");
    return (int) $stmt->fetchColumn();
}

function computeVisitsCount($pdo)
{
    if (!$pdo->query("SHOW TABLES LIKE 'appointments'")->fetch()) {
        return 0;
    }
    $stmt = $pdo->query("SELECT COUNT(*) FROM appointments WHERE status = 'completed'");
    return (int) $stmt->fetchColumn();
}

function computeAverageRating($pdo)
{
    if (!$pdo->query("SHOW TABLES LIKE 'reviews'")->fetch()) {
        return null;
    }
    $stmt = $pdo->query("SELECT AVG(rating) FROM reviews");
    $value = $stmt->fetchColumn();
    return $value !== null ? round((float) $value, 1) : null;
}

/* Returns the fresh-enough cached value, or recomputes + persists it (and
   returns the new value) once it's older than STATS_CACHE_TTL_SECONDS. */
function cachedStat($pdo, $row, $cacheCol, $cachedAtCol, callable $compute)
{
    $cachedAt = $row[$cachedAtCol] ?? null;
    if ($cachedAt !== null && strtotime($cachedAt) > time() - STATS_CACHE_TTL_SECONDS) {
        return $row[$cacheCol];
    }

    $value = $compute($pdo);
    $stmt = $pdo->prepare("UPDATE site_settings SET {$cacheCol} = :value, {$cachedAtCol} = NOW() WHERE id = 1");
    $stmt->execute([':value' => $value]);
    return $value;
}

function formatSettings($row, $specialistsCount, $visitsComputed, $ratingComputed)
{
    $visitsOverride = trim((string) $row['visits_override']);
    $ratingOverride = trim((string) $row['rating_override']);

    return [
        'primaryColor'  => $row['primary_color'],
        'logo'          => $row['logo_path'],
        'heroBanner'    => $row['hero_banner_path'],
        'teamImage'     => $row['team_image_path'],
        'about'         => $row['about_text'],
        'email'         => $row['contact_email'],
        'phone'         => $row['contact_phone'],
        'address'       => $row['address'],

        /* Effective value shown on the public page: admin override wins,
           otherwise the live/cached computed value. */
        'visitsCount'            => $visitsOverride !== '' ? $visitsOverride : number_format($visitsComputed),
        'visitsCountOverride'    => $visitsOverride,
        'visitsCountComputed'    => $visitsComputed,

        'avgRatingPerVet'         => $ratingOverride !== '' ? $ratingOverride : ($ratingComputed !== null ? number_format($ratingComputed, 1) . '/5' : 'N/A'),
        'avgRatingPerVetOverride' => $ratingOverride,
        'avgRatingPerVetComputed' => $ratingComputed,

        'specialistsCount' => $specialistsCount,
        'updatedAt'         => $row['updated_at'],
    ];
}

function getSettings($pdo)
{
    $stmt = $pdo->query('SELECT * FROM site_settings WHERE id = 1');
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    $visitsComputed = cachedStat($pdo, $row, 'visits_cache', 'visits_cached_at', 'computeVisitsCount');
    $ratingComputed = cachedStat($pdo, $row, 'rating_cache', 'rating_cached_at', 'computeAverageRating');

    respond(200, [
        'success' => true,
        'data' => formatSettings($row, activeSpecialistsCount($pdo), $visitsComputed, $ratingComputed)
    ]);
}

function saveUploadedImage($fieldName, $prefix)
{
    if (
        !isset($_FILES[$fieldName]) ||
        $_FILES[$fieldName]['error'] !== UPLOAD_ERR_OK
    ) {
        return null;
    }

    $allowed = [
        'image/jpeg'    => 'jpg',
        'image/png'     => 'png',
        'image/webp'    => 'webp',
        'image/svg+xml' => 'svg',
    ];

    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file($_FILES[$fieldName]['tmp_name']);

    if (!isset($allowed[$mime])) {
        respond(422, [
            'success' => false,
            'message' => ucfirst(str_replace('_', ' ', $prefix)) . ' must be JPG, PNG, WEBP, or SVG.'
        ]);
    }

    $dir = __DIR__ . '/../../storage/site_settings';

    if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
        respond(500, [
            'success' => false,
            'message' => 'Could not create upload directory.'
        ]);
    }

    $fileName =
        $prefix .
        '_' .
        time() .
        '_' .
        bin2hex(random_bytes(6)) .
        '.' .
        $allowed[$mime];

    if (!move_uploaded_file(
        $_FILES[$fieldName]['tmp_name'],
        $dir . '/' . $fileName
    )) {
        respond(500, [
            'success' => false,
            'message' => 'Could not save uploaded image.'
        ]);
    }

    return '/storage/site_settings/' . $fileName;
}

function saveSettings($pdo, $data)
{
    $set = [
        'primary_color = :primary_color',
        'about_text = :about_text',
        'contact_email = :contact_email',
        'contact_phone = :contact_phone',
        'address = :address',
        'visits_override = :visits_override',
        'rating_override = :rating_override',
    ];

    $params = [
        ':primary_color'    => clean($data['primary_color'] ?? '') ?: '#002A58',
        ':about_text'       => clean($data['about'] ?? ''),
        ':contact_email'    => nullableClean($data['email'] ?? ''),
        ':contact_phone'    => nullableClean($data['phone'] ?? ''),
        ':address'          => nullableClean($data['address'] ?? ''),
        /* Blank means "no override" — the effective value falls back to the
           computed count/rating (see formatSettings()). */
        ':visits_override'  => clean($data['visitsCountOverride'] ?? ''),
        ':rating_override'  => clean($data['avgRatingPerVetOverride'] ?? ''),
    ];

    $imageFields = [
        'logo'         => ['upload' => 'logo_file',        'column' => 'logo_path',         'remove' => 'remove_logo'],
        'hero_banner'  => ['upload' => 'hero_banner_file',  'column' => 'hero_banner_path',  'remove' => 'remove_hero_banner'],
        'team_image'   => ['upload' => 'team_image_file',   'column' => 'team_image_path',   'remove' => 'remove_team_image'],
    ];

    foreach ($imageFields as $prefix => $field) {
        $uploadedPath = saveUploadedImage($field['upload'], $prefix);

        if ($uploadedPath) {
            $set[] = "{$field['column']} = :{$field['column']}";
            $params[":{$field['column']}"] = $uploadedPath;
        } elseif (truthy($data[$field['remove']] ?? null)) {
            $set[] = "{$field['column']} = NULL";
        }
    }

    try {

        $sql = 'UPDATE site_settings SET ' . implode(', ', $set) . ' WHERE id = 1';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        getSettings($pdo);

    } catch (PDOException $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());

        respond(500, [
            'success' => false,
            'message' => 'Could not save site settings.'
        ]);
    }
}

$input = inputData();

$action = clean($input['action'] ?? 'get');

// Reading site settings is public (landing page needs it); writing is admin-only.
if ($action !== 'get') {
    require_once __DIR__ . '/../config/auth_guard.php';
    requireRole($pdo, ['admin']);
}

try {

    setupSiteSettings($pdo);

    if ($action === 'get') {
        getSettings($pdo);
    }

    if ($action === 'save') {
        saveSettings($pdo, $input);
    }

    respond(400, [
        'success' => false,
        'message' => 'Unknown site settings action.'
    ]);

} catch (PDOException $e) {
    error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());

    respond(500, [
        'success' => false,
        'message' => 'Site settings request failed.'
    ]);
}

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

    $clinicCapacityCheck = $pdo->query("SHOW COLUMNS FROM site_settings LIKE 'clinic_capacity'")->fetch();
    if (!$clinicCapacityCheck) {
        $pdo->exec("ALTER TABLE site_settings ADD COLUMN clinic_capacity VARCHAR(20) NOT NULL DEFAULT '24/7' AFTER address");
    }

    $surgeryRecoveryCheck = $pdo->query("SHOW COLUMNS FROM site_settings LIKE 'surgery_recovery_rate'")->fetch();
    if (!$surgeryRecoveryCheck) {
        $pdo->exec("ALTER TABLE site_settings ADD COLUMN surgery_recovery_rate VARCHAR(20) NOT NULL DEFAULT '98.4%' AFTER clinic_capacity");
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

function formatSettings($row, $specialistsCount)
{
    return [
        'primaryColor'        => $row['primary_color'],
        'logo'                => $row['logo_path'],
        'heroBanner'          => $row['hero_banner_path'],
        'teamImage'           => $row['team_image_path'],
        'about'               => $row['about_text'],
        'email'               => $row['contact_email'],
        'phone'               => $row['contact_phone'],
        'address'             => $row['address'],
        'clinicCapacity'      => $row['clinic_capacity'],
        'surgeryRecoveryRate' => $row['surgery_recovery_rate'],
        'specialistsCount'    => $specialistsCount,
        'updatedAt'           => $row['updated_at'],
    ];
}

function getSettings($pdo)
{
    $stmt = $pdo->query('SELECT * FROM site_settings WHERE id = 1');
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    respond(200, [
        'success' => true,
        'data' => formatSettings($row, activeSpecialistsCount($pdo))
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

    return '/final-VBETTER/bvetter/storage/site_settings/' . $fileName;
}

function saveSettings($pdo, $data)
{
    $set = [
        'primary_color = :primary_color',
        'about_text = :about_text',
        'contact_email = :contact_email',
        'contact_phone = :contact_phone',
        'address = :address',
        'clinic_capacity = :clinic_capacity',
        'surgery_recovery_rate = :surgery_recovery_rate',
    ];

    $params = [
        ':primary_color'          => clean($data['primary_color'] ?? '') ?: '#002A58',
        ':about_text'             => clean($data['about'] ?? ''),
        ':contact_email'          => nullableClean($data['email'] ?? ''),
        ':contact_phone'          => nullableClean($data['phone'] ?? ''),
        ':address'                => nullableClean($data['address'] ?? ''),
        ':clinic_capacity'        => clean($data['clinicCapacity'] ?? '') ?: '24/7',
        ':surgery_recovery_rate'  => clean($data['surgeryRecoveryRate'] ?? '') ?: '98.4%',
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

        respond(500, [
            'success' => false,
            'message' => 'Could not save site settings.',
            'error' => $e->getMessage()
        ]);
    }
}

$input = inputData();

$action = clean($input['action'] ?? 'get');

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

    respond(500, [
        'success' => false,
        'message' => 'Site settings request failed.',
        'error' => $e->getMessage()
    ]);
}

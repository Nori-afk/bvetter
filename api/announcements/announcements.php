<?php

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

header('Content-Type: application/json');

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/input_validation.php';

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

function setupAnnouncements($pdo)
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS announcements (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(180) NOT NULL,
            description TEXT NOT NULL,
            category VARCHAR(80) NOT NULL DEFAULT 'Preventative Care',
            event_date DATE NULL,
            location VARCHAR(180) NULL,
            image_path VARCHAR(255) NULL,
            status ENUM('draft','published','archived') NOT NULL DEFAULT 'published',
            created_by_user_id INT NULL,
            created_by_role VARCHAR(40) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_announcements_status_date (status, event_date),
            INDEX idx_announcements_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function saveImage()
{
    if (
        !isset($_FILES['image']) ||
        $_FILES['image']['error'] !== UPLOAD_ERR_OK
    ) {
        return null;
    }

    $allowed = [
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/webp' => 'webp',
    ];

    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file($_FILES['image']['tmp_name']);

    if (!isset($allowed[$mime])) {
        respond(422, [
            'success' => false,
            'message' => 'Announcement image must be JPG, PNG, or WEBP.'
        ]);
    }

    $dir = __DIR__ . '/../../storage/announcements';

    if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
        respond(500, [
            'success' => false,
            'message' => 'Could not create upload directory.'
        ]);
    }

    $fileName =
        'announcement_' .
        time() .
        '_' .
        bin2hex(random_bytes(6)) .
        '.' .
        $allowed[$mime];

    if (!move_uploaded_file(
        $_FILES['image']['tmp_name'],
        $dir . '/' . $fileName
    )) {
        respond(500, [
            'success' => false,
            'message' => 'Could not save image.'
        ]);
    }

    return '/storage/announcements/' . $fileName;
}

function formatAnnouncement($row)
{
    if (!$row) {
        return null;
    }

    return [
        'id' => (int)$row['id'],
        // Defanged on output as well as validated on input. Rows written before
        // the input check existed are still in the table, and this is the
        // payload the public landing page renders.
        'title' => apiSafeText($row['title']),
        'description' => apiSafeText($row['description']),
        'category' => apiSafeText($row['category']),
        'date' => $row['event_date'],
        'location' => apiSafeText($row['location']),
        'image' => $row['image_path'],
        'status' => $row['status'],
        'createdByRole' => $row['created_by_role'],
        'createdAt' => $row['created_at'],
    ];
}

function listAnnouncements($pdo, $data)
{
    $status = clean($data['status'] ?? 'published');

    $limit = max(
        1,
        min(30, (int)($data['limit'] ?? 10))
    );

    $where = [];
    $params = [];

    if ($status !== 'all') {
        $where[] = 'status = :status';
        $params[':status'] = $status ?: 'published';
    }

    $sql = 'SELECT * FROM announcements';

    if ($where) {
        $sql .= ' WHERE ' . implode(' AND ', $where);
    }

    $sql .= '
        ORDER BY
            COALESCE(event_date, created_at) DESC,
            id DESC
        LIMIT ' . $limit;

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    respond(200, [
        'success' => true,
        'data' => array_map(
            'formatAnnouncement',
            $stmt->fetchAll(PDO::FETCH_ASSOC)
        )
    ]);
}

function saveAnnouncement($pdo, $data)
{
    $id = (int)($data['id'] ?? 0);

    $isUpdate = $id > 0;

    $title = clean($data['title'] ?? '');
    $description = clean($data['description'] ?? '');

    if ($title === '' || $description === '') {
        respond(422, [
            'success' => false,
            'message' => 'Title and description are required.'
        ]);
    }

    /* Announcements are the most public thing in this system: they render on
       the landing-page carousel for visitors who are not logged in at all
       (public/js/landing.js). clean() here is only trim(), so before this
       check a title was stored exactly as typed and the sole thing standing
       between markup in it and every guest's browser was escapeHtml() on the
       client -- one render site away from being an XSS.

       Title, category and location are identity-type fields (short labels,
       no legitimate angle brackets) so they are REJECTED here. Description is
       free text -- an advisory may legitimately read "temp > 39C" -- so it is
       defanged on the way out by apiSafeText() in formatAnnouncement()
       instead, per the split described in api/config/input_validation.php.
       Length caps match the column widths declared above. */
    $fieldError = firstIdentityFieldError([
        [$title,                        'Title',    180, 2],
        [clean($data['category'] ?? ''), 'Category', 80,  0],
        [clean($data['location'] ?? ''), 'Location', 180, 0],
    ]);
    if ($fieldError !== null) {
        respond(422, ['success' => false, 'message' => $fieldError]);
    }

    if (mb_strlen($description) > 5000) {
        respond(422, [
            'success' => false,
            'message' => 'Description must be 5000 characters or fewer.'
        ]);
    }

    $imagePath = saveImage();

    if (!$imagePath) {
        $imagePath = nullableClean(
            $data['image'] ??
            $data['image_path'] ??
            ''
        );
    }

    $payload = [
        ':title' => $title,
        ':description' => $description,
        ':category' => clean($data['category'] ?? '') ?: 'Preventative Care',
        ':event_date' => nullableClean(
            $data['date'] ??
            $data['event_date'] ??
            ''
        ),
        ':location' => nullableClean($data['location'] ?? ''),
        ':status' => clean($data['status'] ?? '') ?: 'published',
        ':created_by_user_id' =>
            (int)($data['created_by_user_id'] ?? $data['user_id'] ?? 0) ?: null,
        ':created_by_role' =>
            nullableClean($data['created_by_role'] ?? $data['role'] ?? ''),
    ];

    try {

        if ($isUpdate) {

            $sql = "
                UPDATE announcements
                SET
                    title = :title,
                    description = :description,
                    category = :category,
                    event_date = :event_date,
                    location = :location,
                    status = :status,
                    created_by_user_id = :created_by_user_id,
                    created_by_role = :created_by_role
            ";

            if ($imagePath) {
                $sql .= ", image_path = :image_path";
                $payload[':image_path'] = $imagePath;
            }

            $sql .= " WHERE id = :id";

            $payload[':id'] = $id;

            $stmt = $pdo->prepare($sql);
            $stmt->execute($payload);

        } else {

            $payload[':image_path'] = $imagePath;

            $stmt = $pdo->prepare("
                INSERT INTO announcements
                (
                    title,
                    description,
                    category,
                    event_date,
                    location,
                    image_path,
                    status,
                    created_by_user_id,
                    created_by_role
                )
                VALUES
                (
                    :title,
                    :description,
                    :category,
                    :event_date,
                    :location,
                    :image_path,
                    :status,
                    :created_by_user_id,
                    :created_by_role
                )
            ");

            $stmt->execute($payload);

            $id = (int)$pdo->lastInsertId();
        }

        $stmt = $pdo->prepare("
            SELECT *
            FROM announcements
            WHERE id = :id
        ");

        $stmt->execute([
            ':id' => $id
        ]);

        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            respond(500, [
                'success' => false,
                'message' => 'Announcement not found after save.'
            ]);
        }

        respond($isUpdate ? 200 : 201, [
            'success' => true,
            'data' => formatAnnouncement($row)
        ]);

    } catch (PDOException $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());

        respond(500, [
            'success' => false,
            'message' => 'Database error.'
        ]);
    }
}

function deleteAnnouncement($pdo, $data)
{
    $id = (int)($data['id'] ?? 0);

    if ($id <= 0) {
        respond(422, [
            'success' => false,
            'message' => 'Invalid announcement id.'
        ]);
    }

    $stmt = $pdo->prepare("
        DELETE FROM announcements
        WHERE id = :id
    ");

    $stmt->execute([
        ':id' => $id
    ]);

    respond(200, [
        'success' => true,
        'message' => 'Announcement deleted.'
    ]);
}

$input = inputData();

$action = clean($input['action'] ?? 'list');

// Only reading announcements is public; all writes are staff-only.
if ($action !== 'list') {
    require_once __DIR__ . '/../config/auth_guard.php';
    requireRole($pdo, ['veterinarian', 'admin']);
}

try {

    setupAnnouncements($pdo);

    if ($action === 'list') {
        listAnnouncements($pdo, $input);
    }

    if (
        $action === 'create' ||
        $action === 'update' ||
        $action === 'save'
    ) {
        saveAnnouncement($pdo, $input);
    }

    if ($action === 'delete') {
        deleteAnnouncement($pdo, $input);
    }

    respond(400, [
        'success' => false,
        'message' => 'Unknown announcement action.'
    ]);

} catch (PDOException $e) {
    error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());

    respond(500, [
        'success' => false,
        'message' => 'Announcement request failed.'
    ]);
}
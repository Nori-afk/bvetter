<?php

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

header('Content-Type: application/json');

require_once __DIR__ . '/../../config/connection.php';

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

    return '/bvetter/storage/announcements/' . $fileName;
}

function formatAnnouncement($row)
{
    if (!$row) {
        return null;
    }

    return [
        'id' => (int)$row['id'],
        'title' => $row['title'],
        'description' => $row['description'],
        'category' => $row['category'],
        'date' => $row['event_date'],
        'location' => $row['location'],
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

        respond(500, [
            'success' => false,
            'message' => 'Database error.',
            'error' => $e->getMessage()
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

    respond(500, [
        'success' => false,
        'message' => 'Announcement request failed.',
        'error' => $e->getMessage()
    ]);
}
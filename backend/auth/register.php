<?php
//LOCATION OR TYPE NG FILE NATO
header('Content-Type: application/json');

$requestMethod = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';

if ($requestMethod !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'message' => 'Method not allowed',
        'title' => 'Registration Failed'
    ]);
    exit;
}
// IMPORTANT TO KASI ITO UNG CONNECTIO NA GINAWA NATEN
require_once '../config/connection.php';

function respond($statusCode, $payload)
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

function clean($value)
{
    return trim((string) $value);
}

$fullName = clean(isset($_POST['full_name']) ? $_POST['full_name'] : '');
$email = clean(isset($_POST['email']) ? $_POST['email'] : '');
$password = (string) (isset($_POST['password']) ? $_POST['password'] : '');
$barangay = clean(isset($_POST['barangay']) ? $_POST['barangay'] : '');
$barangayId = (int) (isset($_POST['barangay_id']) ? $_POST['barangay_id'] : 0);
$phoneNumber = clean(isset($_POST['phone_number']) ? $_POST['phone_number'] : '');

if ($fullName === '' || $email === '' || $password === '' || $phoneNumber === '' || ($barangayId <= 0 && $barangay === '')) {
    respond(422, [
        'success' => false,
        'message' => 'Please fill in all required fields.'
    ]);
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(422, [
        'success' => false,
        'message' => 'Please enter a valid email address.'
    ]);
}

if (strlen($password) < 8) {
    respond(422, [
        'success' => false,
        'message' => 'Password must be at least 8 characters.'
    ]);
}

if (!isset($_FILES['proof_document']) || $_FILES['proof_document']['error'] !== UPLOAD_ERR_OK) {
    respond(422, [
        'success' => false,
        'message' => 'Please upload your proof of residence.'
    ]);
}

$proof = $_FILES['proof_document'];
$maxSize = 5 * 1024 * 1024;

if ($proof['size'] > $maxSize) {
    respond(422, [
        'success' => false,
        'message' => 'Proof of residence must not exceed 5MB.'
    ]);
}

$allowedMimeTypes = [
    'application/pdf' => 'pdf',
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
];

$finfo = new finfo(FILEINFO_MIME_TYPE);
$mimeType = $finfo->file($proof['tmp_name']);

if (!array_key_exists($mimeType, $allowedMimeTypes)) {
    respond(422, [
        'success' => false,
        'message' => 'Only PDF, JPG, JPEG, and PNG files are allowed.'
    ]);
}

$uploadDirectory = dirname(__DIR__) . '/uploads/verification';

if (!is_dir($uploadDirectory) && !mkdir($uploadDirectory, 0775, true)) {
    respond(500, [
        'success' => false,
        'message' => 'Could not create upload directory.'
    ]);
}

try {
    $checkEmail = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
    $checkEmail->execute([':email' => $email]);

    if ($checkEmail->fetch()) {
        respond(409, [
            'success' => false,
            'message' => 'Email is already registered.'
        ]);
    }

    $pdo->beginTransaction();

    $roleQuery = $pdo->prepare('SELECT id FROM roles WHERE name = :name LIMIT 1');
    $roleQuery->execute([':name' => 'pet_owner']);
    $role = $roleQuery->fetch();

    if (!$role) {
        $createRole = $pdo->prepare('INSERT INTO roles (name, description) VALUES (:name, :description)');
        $createRole->execute([
            ':name' => 'pet_owner',
            ':description' => 'Pet owner user',
        ]);
        $roleId = (int) $pdo->lastInsertId();
    } else {
        $roleId = (int) $role['id'];
    }

    if ($barangayId > 0) {
        $barangayQuery = $pdo->prepare('SELECT id, name FROM barangays WHERE id = :id LIMIT 1');
        $barangayQuery->execute([':id' => $barangayId]);
        $barangayRow = $barangayQuery->fetch();
    } else {
        $barangayQuery = $pdo->prepare('SELECT id, name FROM barangays WHERE name = :name LIMIT 1');
        $barangayQuery->execute([':name' => $barangay]);
        $barangayRow = $barangayQuery->fetch();
    }

    if (!$barangayRow) {
        $pdo->rollBack();
        respond(422, [
            'success' => false,
            'message' => 'Selected barangay is invalid.'
        ]);
    } else {
        $barangayId = (int) $barangayRow['id'];
        $barangay = $barangayRow['name'];
    }

    $insertUser = $pdo->prepare(
        'INSERT INTO users (role_id, full_name, email, password_hash, phone_number, account_status)
         VALUES (:role_id, :full_name, :email, :password_hash, :phone_number, :account_status)'
    );

    $insertUser->execute([
        ':role_id' => $roleId,
        ':full_name' => $fullName,
        ':email' => $email,
        ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
        ':phone_number' => $phoneNumber,
        ':account_status' => 'inactive',
    ]);

    $userId = (int) $pdo->lastInsertId();

    $insertOwnerProfile = $pdo->prepare(
        'INSERT INTO owner_profiles (user_id, barangay_id, complete_address, verification_status)
         VALUES (:user_id, :barangay_id, :complete_address, :verification_status)'
    );

    $insertOwnerProfile->execute([
        ':user_id' => $userId,
        ':barangay_id' => $barangayId,
        ':complete_address' => $barangay,
        ':verification_status' => 'pending',
    ]);

    $extension = $allowedMimeTypes[$mimeType];
    $safeFileName = 'proof_' . $userId . '_' . bin2hex(random_bytes(8)) . '.' . $extension;
    $absolutePath = $uploadDirectory . '/' . $safeFileName;
    $relativePath = 'backend/uploads/verification/' . $safeFileName;

    if (!move_uploaded_file($proof['tmp_name'], $absolutePath)) {
        $pdo->rollBack();
        respond(500, [
            'success' => false,
            'message' => 'Could not save uploaded document.'
        ]);
    }

    $insertDocument = $pdo->prepare(
        'INSERT INTO user_verification_documents
            (user_id, document_type, file_path, original_name, mime_type, file_size, status)
         VALUES
            (:user_id, :document_type, :file_path, :original_name, :mime_type, :file_size, :status)'
    );

    $insertDocument->execute([
        ':user_id' => $userId,
        ':document_type' => 'proof_of_residence',
        ':file_path' => $relativePath,
        ':original_name' => $proof['name'],
        ':mime_type' => $mimeType,
        ':file_size' => $proof['size'],
        ':status' => 'pending',
    ]);

    $pdo->commit();

    respond(201, [
        'success' => true,
        'message' => 'Account request submitted. Please wait for admin verification.',
        'user_id' => $userId,
        'reference_number' => '#ACC-' . date('Y') . '-' . str_pad((string) $userId, 4, '0', STR_PAD_LEFT),
        'proof_path' => $relativePath
    ]);
} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    respond(500, [
        'success' => false,
        'message' => 'Registration failed.',
        'error' => $e->getMessage()
    ]);
}

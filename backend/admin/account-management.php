<?php

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
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

function frontendRole($roleName)
{
    if ($roleName === 'pet_owner') return 'owner';
    if ($roleName === 'veterinarian') return 'vet';
    return $roleName;
}

function roleLabel($roleName)
{
    if ($roleName === 'pet_owner') return 'Pet Owner';
    if ($roleName === 'veterinarian') return 'Veterinarian';
    if ($roleName === 'admin') return 'Administrator';
    return ucfirst($roleName);
}

function listRoles($pdo)
{
    $stmt = $pdo->query("
        SELECT id, name, description
        FROM roles
        WHERE name IN ('veterinarian', 'admin')
        ORDER BY FIELD(name, 'veterinarian', 'admin'), name
    ");

    $roles = array_map(function ($row) {
        return [
            'id' => (int) $row['id'],
            'name' => $row['name'],
            'frontendRole' => frontendRole($row['name']),
            'label' => roleLabel($row['name']),
            'description' => $row['description'],
        ];
    }, $stmt->fetchAll());

    respond(200, [
        'success' => true,
        'data' => $roles
    ]);
}

function listUsers($pdo)
{
    $sql = '
        SELECT
            users.id,
            users.full_name,
            users.email,
            users.phone_number,
            users.profile_photo,
            users.account_status,
            users.created_at,
            roles.name AS role_name,
            owner_profiles.verification_status,
            barangays.name AS barangay_name,
            documents.file_path AS proof_path,
            documents.original_name AS proof_name
        FROM users
        INNER JOIN roles ON roles.id = users.role_id
        LEFT JOIN owner_profiles ON owner_profiles.user_id = users.id
        LEFT JOIN barangays ON barangays.id = owner_profiles.barangay_id
        LEFT JOIN (
            SELECT d1.*
            FROM user_verification_documents d1
            INNER JOIN (
                SELECT user_id, MAX(id) AS latest_id
                FROM user_verification_documents
                GROUP BY user_id
            ) d2 ON d2.latest_id = d1.id
        ) documents ON documents.user_id = users.id
        ORDER BY users.created_at DESC
    ';

    $stmt = $pdo->query($sql);
    $rows = $stmt->fetchAll();

    $data = array_map(function ($row) {
        $role = frontendRole($row['role_name']);
        $status = $row['account_status'];

        if ($row['role_name'] === 'pet_owner' && $row['verification_status'] === 'pending') {
            $status = 'pending';
        } elseif ($row['role_name'] === 'pet_owner' && $row['verification_status'] === 'rejected') {
            $status = 'rejected';
        }

        return [
            'id' => (string) $row['id'],
            'name' => $row['full_name'],
            'email' => $row['email'],
            'phone' => $row['phone_number'],
            'avatar' => $row['profile_photo'],
            'role' => $role,
            'roleLabel' => roleLabel($row['role_name']),
            'status' => $status,
            'accountStatus' => $row['account_status'],
            'verificationStatus' => $row['verification_status'],
            'barangay' => $row['barangay_name'],
            'created' => $row['created_at'],
            'idImage' => $row['proof_path'] ? '/Final-Backend/' . $row['proof_path'] : '',
            'proofName' => $row['proof_name'],
        ];
    }, $rows);

    respond(200, [
        'success' => true,
        'data' => $data
    ]);
}

function updateOwnerVerification($pdo, $userId, $decision, $notes)
{
    if ($userId <= 0) {
        respond(422, [
            'success' => false,
            'message' => 'Invalid user id.'
        ]);
    }

    $userQuery = $pdo->prepare('
        SELECT users.id, roles.name AS role_name
        FROM users
        INNER JOIN roles ON roles.id = users.role_id
        WHERE users.id = :id
        LIMIT 1
    ');
    $userQuery->execute([':id' => $userId]);
    $user = $userQuery->fetch();

    if (!$user) {
        respond(404, [
            'success' => false,
            'message' => 'User not found.'
        ]);
    }

    if ($user['role_name'] !== 'pet_owner') {
        respond(422, [
            'success' => false,
            'message' => 'Only pet owner accounts require residence verification.'
        ]);
    }

    $pdo->beginTransaction();

    if ($decision === 'approved') {
        $accountStatus = 'active';
        $documentStatus = 'approved';
    } else {
        $accountStatus = 'inactive';
        $documentStatus = 'rejected';
    }

    $updateUser = $pdo->prepare('UPDATE users SET account_status = :status WHERE id = :id');
    $updateUser->execute([
        ':status' => $accountStatus,
        ':id' => $userId,
    ]);

    $verifiedAtSql = $decision === 'approved' ? 'NOW()' : 'NULL';
    $updateProfile = $pdo->prepare("
        UPDATE owner_profiles
        SET verification_status = :verification_status,
            verified_at = $verifiedAtSql
        WHERE user_id = :user_id
    ");
    $updateProfile->execute([
        ':verification_status' => $decision,
        ':user_id' => $userId,
    ]);

    $updateDocument = $pdo->prepare('
        UPDATE user_verification_documents
        SET status = :status,
            review_notes = :review_notes,
            reviewed_at = NOW()
        WHERE user_id = :user_id
        ORDER BY id DESC
        LIMIT 1
    ');
    $updateDocument->execute([
        ':status' => $documentStatus,
        ':review_notes' => $notes,
        ':user_id' => $userId,
    ]);

    $pdo->commit();

    respond(200, [
        'success' => true,
        'message' => $decision === 'approved' ? 'Account approved.' : 'Account rejected.'
    ]);
}

function createUser($pdo)
{
    $fullName = trim(isset($_POST['full_name']) ? $_POST['full_name'] : '');
    $email = trim(isset($_POST['email']) ? $_POST['email'] : '');
    $password = isset($_POST['password']) ? $_POST['password'] : '';
    $phoneNumber = trim(isset($_POST['phone_number']) ? $_POST['phone_number'] : '');
    $roleId = (int) (isset($_POST['role_id']) ? $_POST['role_id'] : 0);
    $accountStatus = trim(isset($_POST['account_status']) ? $_POST['account_status'] : 'active');

    if ($fullName === '' || $email === '' || $password === '' || $roleId <= 0) {
        respond(422, [
            'success' => false,
            'message' => 'Full name, email, password, and role are required.'
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

    if (!in_array($accountStatus, ['active', 'inactive', 'blocked'], true)) {
        $accountStatus = 'active';
    }

    $roleQuery = $pdo->prepare("SELECT id, name FROM roles WHERE id = :id AND name IN ('veterinarian', 'admin') LIMIT 1");
    $roleQuery->execute([':id' => $roleId]);
    $role = $roleQuery->fetch();

    if (!$role) {
        respond(422, [
            'success' => false,
            'message' => 'Selected role is invalid for admin-created accounts.'
        ]);
    }

    $emailQuery = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
    $emailQuery->execute([':email' => $email]);
    if ($emailQuery->fetch()) {
        respond(409, [
            'success' => false,
            'message' => 'Email is already registered.'
        ]);
    }

    $profilePhoto = null;
    if (isset($_FILES['profile_photo']) && $_FILES['profile_photo']['error'] === UPLOAD_ERR_OK) {
        $allowedMimeTypes = [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
        ];

        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mimeType = $finfo->file($_FILES['profile_photo']['tmp_name']);

        if (!array_key_exists($mimeType, $allowedMimeTypes)) {
            respond(422, [
                'success' => false,
                'message' => 'Profile photo must be JPG, PNG, or WEBP.'
            ]);
        }

        $uploadDirectory = __DIR__ . '/../uploads/profile';
        if (!is_dir($uploadDirectory) && !mkdir($uploadDirectory, 0775, true)) {
            respond(500, [
                'success' => false,
                'message' => 'Could not create profile upload directory.'
            ]);
        }

        $fileName = 'profile_' . time() . '_' . bin2hex(random_bytes(6)) . '.' . $allowedMimeTypes[$mimeType];
        if (!move_uploaded_file($_FILES['profile_photo']['tmp_name'], $uploadDirectory . '/' . $fileName)) {
            respond(500, [
                'success' => false,
                'message' => 'Could not save profile photo.'
            ]);
        }

        $profilePhoto = '/Final-Backend/backend/uploads/profile/' . $fileName;
    }

    $pdo->beginTransaction();

    $insertUser = $pdo->prepare('
        INSERT INTO users (role_id, full_name, email, password_hash, phone_number, profile_photo, account_status)
        VALUES (:role_id, :full_name, :email, :password_hash, :phone_number, :profile_photo, :account_status)
    ');

    $insertUser->execute([
        ':role_id' => $roleId,
        ':full_name' => $fullName,
        ':email' => $email,
        ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
        ':phone_number' => $phoneNumber,
        ':profile_photo' => $profilePhoto,
        ':account_status' => $accountStatus,
    ]);

    $userId = (int) $pdo->lastInsertId();

    if ($role['name'] === 'veterinarian') {
        $licenseNumber = trim(isset($_POST['license_number']) ? $_POST['license_number'] : '');
        $education = trim(isset($_POST['education']) ? $_POST['education'] : '');
        $specialization = trim(isset($_POST['specialization']) ? $_POST['specialization'] : '');
        $clinicLocation = trim(isset($_POST['clinic_location']) ? $_POST['clinic_location'] : '');
        $positionTitle = trim(isset($_POST['position_title']) ? $_POST['position_title'] : 'Veterinarian');

        if ($licenseNumber === '' || $education === '' || $specialization === '' || $clinicLocation === '') {
            $pdo->rollBack();
            respond(422, [
                'success' => false,
                'message' => 'License number, education, specialization, and clinic location are required for veterinarians.'
            ]);
        }

        $insertVet = $pdo->prepare('
            INSERT INTO veterinarian_profiles
                (user_id, license_number, position_title, education, specialization, clinic_location, employment_status)
            VALUES
                (:user_id, :license_number, :position_title, :education, :specialization, :clinic_location, :employment_status)
        ');

        $insertVet->execute([
            ':user_id' => $userId,
            ':license_number' => $licenseNumber,
            ':position_title' => $positionTitle,
            ':education' => $education,
            ':specialization' => $specialization,
            ':clinic_location' => $clinicLocation,
            ':employment_status' => $accountStatus === 'active' ? 'active' : 'inactive',
        ]);
    }

    $pdo->commit();

    respond(201, [
        'success' => true,
        'message' => 'Account created successfully.',
        'user_id' => $userId
    ]);
}

function deleteUser($pdo)
{
    $userId = (int) (isset($_POST['user_id']) ? $_POST['user_id'] : 0);

    if ($userId <= 0) {
        respond(422, [
            'success' => false,
            'message' => 'Invalid user id.'
        ]);
    }

    $userQuery = $pdo->prepare('SELECT id, full_name FROM users WHERE id = :id LIMIT 1');
    $userQuery->execute([':id' => $userId]);
    $user = $userQuery->fetch();

    if (!$user) {
        respond(404, [
            'success' => false,
            'message' => 'User not found.'
        ]);
    }

    $pdo->beginTransaction();

    $clearReviewedDocs = $pdo->prepare('
        UPDATE user_verification_documents
        SET reviewed_by_user_id = NULL
        WHERE reviewed_by_user_id = :user_id
    ');
    $clearReviewedDocs->execute([':user_id' => $userId]);

    $deleteDocs = $pdo->prepare('DELETE FROM user_verification_documents WHERE user_id = :user_id');
    $deleteDocs->execute([':user_id' => $userId]);

    $deleteOwner = $pdo->prepare('DELETE FROM owner_profiles WHERE user_id = :user_id');
    $deleteOwner->execute([':user_id' => $userId]);

    $deleteVet = $pdo->prepare('DELETE FROM veterinarian_profiles WHERE user_id = :user_id');
    $deleteVet->execute([':user_id' => $userId]);

    $deleteUser = $pdo->prepare('DELETE FROM users WHERE id = :user_id');
    $deleteUser->execute([':user_id' => $userId]);

    $pdo->commit();

    respond(200, [
        'success' => true,
        'message' => 'Account deleted successfully.'
    ]);
}

$action = isset($_POST['action']) ? $_POST['action'] : 'list';

try {
    if ($action === 'list') {
        listUsers($pdo);
    }

    if ($action === 'roles') {
        listRoles($pdo);
    }

    if ($action === 'create') {
        createUser($pdo);
    }

    if ($action === 'delete') {
        deleteUser($pdo);
    }

    if ($action === 'approve') {
        $userId = (int) (isset($_POST['user_id']) ? $_POST['user_id'] : 0);
        updateOwnerVerification($pdo, $userId, 'approved', '');
    }

    if ($action === 'reject') {
        $userId = (int) (isset($_POST['user_id']) ? $_POST['user_id'] : 0);
        $notes = trim(isset($_POST['review_notes']) ? $_POST['review_notes'] : '');
        updateOwnerVerification($pdo, $userId, 'rejected', $notes);
    }

    respond(400, [
        'success' => false,
        'message' => 'Unknown action.'
    ]);
} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    if ($e->getCode() === '23000') {
        respond(409, [
            'success' => false,
            'message' => 'This account cannot be deleted because it is connected to existing records. Set it to inactive or blocked instead.',
            'error' => $e->getMessage()
        ]);
    }

    respond(500, [
        'success' => false,
        'message' => 'Account management request failed.',
        'error' => $e->getMessage()
    ]);
}

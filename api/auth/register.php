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
require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/security_settings.php';
require_once __DIR__ . '/../config/input_validation.php';
require_once __DIR__ . '/../config/notifications.php';
require_once __DIR__ . '/../config/walk_in_accounts.php';

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

// Server-side, so it also applies to a direct POST that skips the form. A
// full name containing markup is how a stored-XSS payload reaches the staff
// screens that list registered users.
$fieldError = firstIdentityFieldError([
    [$fullName, 'Full name', 150, 2],
    [$email,    'Email address', 190, 5],
    [$barangay, 'Barangay', 120, 0],
]);
if ($fieldError !== null) {
    respond(422, ['success' => false, 'message' => $fieldError]);
}

// Mirrors isValidPHPhone() in public/js/signup.js. The server previously only
// checked the number was non-empty, so any string got through a direct POST.
if (!preg_match('/^(?:\+63|63|0)9\d{9}$/', preg_replace('/[\s-]/', '', $phoneNumber))) {
    respond(422, [
        'success' => false,
        'message' => 'Please enter a valid Philippine mobile number (e.g. 09171234567).'
    ]);
}

// Deliberately ahead of the proof-of-residence upload below: someone the
// clinic already holds a record for is not going to finish this form, and
// making them upload an ID first only to be turned away is pointless.
//
// A walk-in row is a real person a vet entered at the counter -- see
// findOrCreateOwner() in api/patient-records/patient_records.php. They have
// never logged in and their password is a random string that was hashed and
// discarded, so the plain "Email is already registered." further down would be
// actively misleading: there is no password for them to have forgotten, and
// registering again would fork their pet history across two accounts.
//
// Forgot Password is the way in, and control of the mailbox is stronger
// evidence of identity than anything this form collects. The disclosure that
// an address belongs to a clinic walk-in is accepted for the same reason
// forgotPassword() in api/admin/verify-contact.php rejects unknown addresses
// outright: this form already reveals which addresses are registered.
ensureWalkInSchema($pdo);

$existing = $pdo->prepare('SELECT is_walk_in FROM users WHERE email = :email LIMIT 1');
$existing->execute([':email' => $email]);
$existingRow = $existing->fetch();

if ($existingRow && (int) $existingRow['is_walk_in'] === 1) {
    respond(409, [
        'success' => false,
        'claim' => true,
        'message' => 'The clinic already has a record under this email address from an earlier visit. You have not set a password yet, so use "Forgot Password" on the login page to create one. Your pet records will already be there.',
        'title' => 'Record Already Exists'
    ]);
}

// The Terms of Service checkbox was only ever enforced in the browser, so a
// direct POST could create an account that never agreed to them.
if (clean(isset($_POST['accepted_terms']) ? $_POST['accepted_terms'] : '') === '') {
    respond(422, [
        'success' => false,
        'message' => 'You must agree to the Terms of Service to create an account.'
    ]);
}

$policyError = passwordPolicyError($pdo, $password, ['name' => $fullName, 'email' => $email]);
if ($policyError !== null) {
    respond(422, [
        'success' => false,
        'message' => $policyError
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

$uploadDirectory = dirname(dirname(__DIR__)) . '/storage/verification';

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
    $relativePath = 'storage/verification/' . $safeFileName;

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

    // Alert the admins. Until this existed, an application arrived completely
    // silently — every other queue in the app (appointments, tickets, lost &
    // found, castration programs) calls notifyStaff, registration did not, so
    // the only way to discover a pending owner was to open the page and look.
    //
    // Audience is 'admin' because only admins can act on it: verification is
    // gated by requireRole($pdo, ['admin']) in api/admin/account-management.php.
    // The final `true` also emails every admin, which is the part that survives
    // an admin being offline — the mail waits in their inbox.
    //
    // AFTER the commit and in its own try/catch, both deliberately. The outer
    // handler answers "Registration failed." with a 500; letting an SMTP or
    // notification error reach it would tell an applicant whose account was
    // already written that their registration did not go through.
    try {
        notifyStaff(
            $pdo,
            'admin',
            'account_application',
            'New Account Application',
            $fullName . ' (' . $barangay . ') submitted a proof of residence and is waiting for verification.',
            $userId,
            true,
            // Relative to admin/pages/ — the login page's own directory,
            // since admin-login.js resolves `next` with a plain
            // window.location.href from there. Same path the notification
            // bell itself navigates to (admin/js/index.js), so both routes
            // land on the identical URL.
            'account-management.html?review=' . $userId,
            'Review Application'
        );
    } catch (Throwable $notifyError) {
        error_log('[BVetter] ' . __FILE__ . ': staff alert failed for user ' . $userId . ': ' . $notifyError->getMessage());
    }

    respond(201, [
        'success' => true,
        'message' => 'Account request submitted. Please wait for admin verification.',
        'user_id' => $userId,
        'reference_number' => '#ACC-' . date('Y') . '-' . str_pad((string) $userId, 4, '0', STR_PAD_LEFT),
        'proof_path' => $relativePath
    ]);
} catch (PDOException $e) {
    error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    respond(500, [
        'success' => false,
        'message' => 'Registration failed.'
    ]);
}

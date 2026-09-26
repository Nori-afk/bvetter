<?php
/**
 * BVetter – Admin account handover
 *
 * Admins are not created from Account Management any more. When a new person
 * takes over administration, the outgoing admin passes their existing account
 * on from its profile page. Editing the name, email and password by hand
 * would leave two problems behind:
 *
 *   - Every earlier approval would read as the new holder's work, because
 *     records point at the account (reviewed_by_user_id), not the person.
 *     The handover log below keeps "who held this account when", so history
 *     can still be read correctly. Old records are never rewritten.
 *   - The outgoing holder would stay signed in wherever they already were.
 *     Completing a handover revokes every session on the account.
 *
 * Actions (all require an admin bearer token, and act on the caller's own
 * account only):
 *   send_code – email a 6-digit code to the new holder's address, proving
 *               they control it before it becomes the sign-in address
 *   complete  – verify the code and the outgoing password, then hand over
 *   history   – the account's list of holders
 */

header('Content-Type: application/json');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit;
}

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/auth_guard.php';
require_once __DIR__ . '/../config/mailer.php';
require_once __DIR__ . '/../config/security_settings.php';
require_once __DIR__ . '/../config/input_validation.php';
require_once __DIR__ . '/../config/rate_limit.php';

function respond(int $code, array $payload): never
{
    http_response_code($code);
    echo json_encode($payload);
    exit;
}

function ensureHandoverSchema(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS admin_handover_codes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            new_email VARCHAR(190) NOT NULL,
            code_hash CHAR(64) NOT NULL,
            attempts INT NOT NULL DEFAULT 0,
            expires_at DATETIME NOT NULL,
            used_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_ahc_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS admin_handover_log (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            from_name VARCHAR(150) NOT NULL,
            from_email VARCHAR(190) NOT NULL,
            to_name VARCHAR(150) NOT NULL,
            to_email VARCHAR(190) NOT NULL,
            handed_over_at DATETIME NOT NULL,
            ip_address VARCHAR(64) NULL,
            INDEX idx_ahl_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function handoverAccount(PDO $pdo, int $userId): array
{
    $stmt = $pdo->prepare('SELECT id, full_name, email, password_hash, created_at FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $userId]);
    $row = $stmt->fetch();
    if (!$row) respond(404, ['success' => false, 'message' => 'Account not found.']);
    return $row;
}

function assertEmailFree(PDO $pdo, string $email, int $userId): void
{
    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = :email AND id <> :id LIMIT 1');
    $stmt->execute([':email' => $email, ':id' => $userId]);
    if ($stmt->fetch()) {
        respond(409, ['success' => false, 'message' => 'That email already belongs to another account. The new administrator needs an address no other account uses.']);
    }
}

function sendHandoverCode(PDO $pdo, int $userId, array $input): never
{
    $email = trim((string) ($input['new_email'] ?? ''));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(422, ['success' => false, 'message' => 'Enter the new administrator\'s email address.']);
    }
    assertEmailFree($pdo, $email, $userId);

    if (!rateLimitAllow($pdo, 'handover_code:' . $userId, 5, 900)) {
        respond(429, ['success' => false, 'message' => 'Too many codes requested. Please wait a few minutes and try again.']);
    }

    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);

    // One live code per account: a new request replaces the last one.
    $pdo->prepare('DELETE FROM admin_handover_codes WHERE user_id = :id AND used_at IS NULL')
        ->execute([':id' => $userId]);
    $pdo->prepare('
        INSERT INTO admin_handover_codes (user_id, new_email, code_hash, expires_at)
        VALUES (:id, :email, :hash, :expires)
    ')->execute([
        ':id' => $userId,
        ':email' => $email,
        ':hash' => hash('sha256', $code),
        ':expires' => date('Y-m-d H:i:s', time() + 900),
    ]);

    $body = notificationEmailWrapper(
        'Administrator Account Handover',
        '<p>The BVetter administrator account is being handed over to you. '
        . 'Give this code to the current administrator to confirm this is your email address. '
        . 'It expires in <strong>15 minutes</strong>.</p>'
        . emailCodeBox($code)
        . "<p style='color:#999;font-size:12px;'>If you are not taking over the BVetter administrator account, ignore this email.</p>"
    );

    if (!sendAppMail($email, $email, 'BVetter – Administrator handover code', $body)) {
        respond(500, ['success' => false, 'message' => 'The code could not be emailed. Check the address and try again.']);
    }

    respond(200, ['success' => true, 'message' => 'Code sent to ' . $email . '.']);
}

function completeHandover(PDO $pdo, int $userId, array $input): never
{
    $current  = (string) ($input['current_password'] ?? '');
    $name     = trim((string) ($input['new_full_name'] ?? ''));
    $email    = trim((string) ($input['new_email'] ?? ''));
    $phone    = trim((string) ($input['new_phone'] ?? ''));
    $code     = trim((string) ($input['code'] ?? ''));
    $password = (string) ($input['new_password'] ?? '');

    if ($current === '' || $name === '' || $email === '' || $code === '' || $password === '') {
        respond(422, ['success' => false, 'message' => 'Fill in every field, including the code sent to the new email.']);
    }

    $fieldError = firstIdentityFieldError([
        [$name,  'Full name', 150, 2],
        [$email, 'Email address', 190, 5],
        [$phone, 'Phone number', 30, 0],
    ]);
    if ($fieldError !== null) respond(422, ['success' => false, 'message' => $fieldError]);

    $account = handoverAccount($pdo, $userId);

    // The person at the keyboard must be the outgoing holder, not someone who
    // found an unlocked session.
    if (!password_verify($current, $account['password_hash'])) {
        respond(401, ['success' => false, 'message' => 'Your current password is incorrect.']);
    }

    $policyError = passwordPolicyError($pdo, $password, ['name' => $name, 'email' => $email]);
    if ($policyError !== null) respond(422, ['success' => false, 'message' => $policyError]);

    assertEmailFree($pdo, $email, $userId);

    $stmt = $pdo->prepare('
        SELECT id, new_email, code_hash, attempts, expires_at
        FROM admin_handover_codes
        WHERE user_id = :id AND used_at IS NULL
        ORDER BY id DESC LIMIT 1
    ');
    $stmt->execute([':id' => $userId]);
    $pending = $stmt->fetch();

    if (!$pending || strcasecmp($pending['new_email'], $email) !== 0) {
        respond(422, ['success' => false, 'message' => 'Send a code to this email address first.']);
    }
    if (strtotime($pending['expires_at']) < time()) {
        respond(422, ['success' => false, 'message' => 'That code has expired. Send a new one.']);
    }
    if ((int) $pending['attempts'] >= 5) {
        respond(429, ['success' => false, 'message' => 'Too many wrong codes. Send a new one.']);
    }
    if (!hash_equals($pending['code_hash'], hash('sha256', $code))) {
        $pdo->prepare('UPDATE admin_handover_codes SET attempts = attempts + 1 WHERE id = :id')
            ->execute([':id' => $pending['id']]);
        respond(422, ['success' => false, 'message' => 'That code is not correct.']);
    }

    $pdo->beginTransaction();

    $pdo->prepare('
        INSERT INTO admin_handover_log (user_id, from_name, from_email, to_name, to_email, handed_over_at, ip_address)
        VALUES (:id, :from_name, :from_email, :to_name, :to_email, NOW(), :ip)
    ')->execute([
        ':id' => $userId,
        ':from_name' => $account['full_name'],
        ':from_email' => $account['email'],
        ':to_name' => $name,
        ':to_email' => $email,
        ':ip' => clientIp(),
    ]);

    // Two-factor is switched off so the new holder sets up their own; the
    // photo goes because it is the previous holder's face.
    $pdo->prepare('
        UPDATE users
        SET full_name = :name,
            email = :email,
            phone_number = :phone,
            password_hash = :hash,
            password_changed_at = NOW(),
            email_verified_at = NOW(),
            two_factor_enabled = 0,
            failed_login_attempts = 0,
            profile_photo = NULL
        WHERE id = :id
    ')->execute([
        ':name' => $name,
        ':email' => $email,
        ':phone' => $phone,
        ':hash' => password_hash($password, PASSWORD_DEFAULT),
        ':id' => $userId,
    ]);

    // Everyone out, this browser included: the outgoing holder must not keep
    // a working session, and the new holder signs in fresh with their own
    // credentials.
    $pdo->prepare('UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = :id AND revoked_at IS NULL')
        ->execute([':id' => $userId]);

    $pdo->prepare('UPDATE admin_handover_codes SET used_at = NOW() WHERE id = :id')
        ->execute([':id' => $pending['id']]);

    $pdo->commit();

    // After the commit and never fatal: the handover has happened either way.
    if (strcasecmp($account['email'], $email) !== 0) {
        try {
            sendAppMail(
                $account['email'],
                $account['full_name'],
                'BVetter – Administrator account handed over',
                notificationEmailWrapper(
                    'Administrator Account Handed Over',
                    '<p>The BVetter administrator account you held has been handed over to <strong>'
                    . htmlspecialchars($name, ENT_QUOTES) . '</strong>. You have been signed out everywhere, '
                    . 'and this address can no longer sign in to it.</p>'
                    . "<p style='color:#999;font-size:12px;'>If you did not do this, contact the Baliwag City Veterinary Office immediately.</p>"
                )
            );
        } catch (Throwable $e) {
            error_log('[BVetter] ' . __FILE__ . ': handover notice failed: ' . $e->getMessage());
        }
    }

    respond(200, [
        'success' => true,
        'message' => 'The account now belongs to ' . $name . '. Everyone has been signed out; they can sign in with the new email and password.',
    ]);
}

function handoverHistory(PDO $pdo, int $userId): never
{
    $account = handoverAccount($pdo, $userId);

    $stmt = $pdo->prepare('
        SELECT from_name, to_name, handed_over_at
        FROM admin_handover_log
        WHERE user_id = :id
        ORDER BY handed_over_at ASC, id ASC
    ');
    $stmt->execute([':id' => $userId]);
    $log = $stmt->fetchAll();

    // Holders in order, each with the period they held the account. The first
    // holder's start is the account's creation; the current holder has no end.
    $holders = [];
    $since = $account['created_at'];
    foreach ($log as $entry) {
        $holders[] = ['name' => $entry['from_name'], 'from' => $since, 'until' => $entry['handed_over_at']];
        $since = $entry['handed_over_at'];
    }
    $holders[] = ['name' => $account['full_name'], 'from' => $since, 'until' => null];

    respond(200, ['success' => true, 'data' => $holders]);
}

$session = requireRole($pdo, ['admin']);
$userId = (int) $session['user_id'];

$raw = file_get_contents('php://input');
$input = json_decode($raw ?: '', true);
if (!is_array($input)) $input = $_POST;
$action = (string) ($input['action'] ?? '');

try {
    ensureHandoverSchema($pdo);

    if ($action === 'send_code') sendHandoverCode($pdo, $userId, $input);
    if ($action === 'complete') completeHandover($pdo, $userId, $input);
    if ($action === 'history') handoverHistory($pdo, $userId);

    respond(400, ['success' => false, 'message' => 'Unknown action.']);
} catch (PDOException $e) {
    error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
    if ($pdo->inTransaction()) $pdo->rollBack();
    respond(500, ['success' => false, 'message' => 'Handover failed. Nothing was changed.']);
}

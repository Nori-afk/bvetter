<?php
/**
 * VBetter – Email Verification Link Consumer
 * GET /api/auth/verify-email.php?token=...
 * Redirects to public/pages/email-verified.html?status=success|invalid|used|expired
 */

require_once __DIR__ . '/../../config/connection.php';
require_once __DIR__ . '/../config/email_verification.php';

ensureEmailVerificationSchema($pdo);

function redirectWithStatus(string $status): never
{
    header('Location: ' . APP_URL . '/public/pages/email-verified.html?status=' . urlencode($status));
    exit;
}

$token = isset($_GET['token']) ? trim($_GET['token']) : '';

if ($token === '') {
    redirectWithStatus('invalid');
}

$stmt = $pdo->prepare('
    SELECT id, user_id, expires_at, used_at
    FROM email_verification_tokens
    WHERE token = :token
    LIMIT 1
');
$stmt->execute([':token' => $token]);
$row = $stmt->fetch();

if (!$row) {
    redirectWithStatus('invalid');
}

if ($row['used_at'] !== null) {
    redirectWithStatus('used');
}

if (new DateTime() > new DateTime($row['expires_at'])) {
    redirectWithStatus('expired');
}

$pdo->beginTransaction();
$pdo->prepare('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = :id')
    ->execute([':id' => $row['id']]);
$pdo->prepare('UPDATE users SET email_verified_at = NOW() WHERE id = :id')
    ->execute([':id' => $row['user_id']]);
$pdo->commit();

redirectWithStatus('success');

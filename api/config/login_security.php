<?php
/**
 * BVetter – Login security (failed-attempt lockout)
 *
 * Three consecutive wrong-password attempts on an existing account set
 * account_status = 'blocked' and email the owner. The counter resets on
 * successful login, and when an admin sets the account back to 'active'
 * (see updateAccountStatus() in api/admin/account-management.php).
 *
 * Login responses stay a generic "Invalid email or password." on every
 * failed attempt — including the blocking one and non-existent emails —
 * so the endpoint never leaks which addresses have accounts.
 */

require_once __DIR__ . '/mailer.php';

const MAX_FAILED_LOGIN_ATTEMPTS = 3;

function ensureLoginSecuritySchema(PDO $pdo): void
{
    $columnCheck = $pdo->query("SHOW COLUMNS FROM users LIKE 'failed_login_attempts'")->fetch();
    if (!$columnCheck) {
        $pdo->exec("ALTER TABLE users ADD COLUMN failed_login_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER account_status");
    }
}

/**
 * Counts one wrong-password attempt and blocks the account when the
 * threshold is reached. Expects $user to include failed_login_attempts
 * as fetched before this attempt. Returns true when this attempt
 * triggered the block.
 */
function recordFailedLoginAttempt(PDO $pdo, array $user): bool
{
    $userId = (int) $user['id'];

    $pdo->prepare('UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE id = :id')
        ->execute([':id' => $userId]);

    $attempts = (int) $user['failed_login_attempts'] + 1;

    if ($attempts < MAX_FAILED_LOGIN_ATTEMPTS || $user['account_status'] === 'blocked') {
        return false;
    }

    $pdo->prepare("UPDATE users SET account_status = 'blocked' WHERE id = :id")
        ->execute([':id' => $userId]);

    sendAccountBlockedEmail($user['email'], $user['full_name']);
    return true;
}

function resetFailedLoginAttempts(PDO $pdo, int $userId): void
{
    $pdo->prepare('UPDATE users SET failed_login_attempts = 0 WHERE id = :id')
        ->execute([':id' => $userId]);
}

function sendAccountBlockedEmail(string $email, string $name): void
{
    $details = [
        'Account' => htmlspecialchars($email, ENT_QUOTES),
        'When'    => date('M j, Y g:i A'),
    ];
    $userAgent = trim($_SERVER['HTTP_USER_AGENT'] ?? '');
    if ($userAgent !== '') {
        $details['Device'] = htmlspecialchars(substr($userAgent, 0, 100), ENT_QUOTES);
    }

    $body = "
        <p style='font-weight:700;color:#1a1a1a;'>Please review this sign-in activity</p>
        <p>We detected <strong>" . MAX_FAILED_LOGIN_ATTEMPTS . " unsuccessful sign-in attempts</strong>
        on your BVetter account, so it has been blocked for your security:</p>
        " . emailDetailList($details) . "
        <p>To restore access, please contact the Baliwag City Veterinary Office.</p>
        " . emailSectionHeading("That wasn't me!") . "
        <p>If these attempts weren't made by you, someone may be trying to access your
        account &mdash; we recommend resetting your password once your account is restored.</p>
    ";

    sendAppMail(
        $email,
        $name,
        'Your BVetter Account Has Been Blocked',
        notificationEmailWrapper('Account Blocked', $body)
    );
}

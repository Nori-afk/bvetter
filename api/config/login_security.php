<?php
/**
 * BVetter – Login security (failed-attempt lockout + inactivity lockout)
 *
 * Three consecutive wrong-password attempts on an existing account set
 * account_status = 'blocked' and email the owner. The counter resets on
 * successful login, and when an admin sets the account back to 'active'
 * (see updateAccountStatus() in api/admin/account-management.php).
 *
 * Login responses stay a generic "Invalid email or password." on every
 * failed attempt — including the blocking one and non-existent emails —
 * so the endpoint never leaks which addresses have accounts.
 *
 * blocked_reason records *why* account_status became 'blocked' ('failed_login'
 * vs 'inactivity') so login_flow.php can show the right rejection message and
 * Account Management can show the right reason — both paths funnel through
 * this file. It's nullable because rows blocked before this column existed
 * (or blocked directly by an admin) simply have no reason on file.
 *
 * Inactivity lockout auto-blocks accounts that haven't logged in for longer
 * than security_settings.inactivity_lockout_days (admin-configurable, off by
 * default). It's enforced two ways, both funneling through
 * maybeBlockForInactivity()/sweepInactiveAccounts():
 *   - sweepInactiveAccounts() runs whenever an admin loads the Account
 *     Management list (see api/admin/account-management.php), catching every
 *     stale account system-wide — mirrors sweepIdleSessions() in
 *     api/config/session.php.
 *   - maybeBlockForInactivity() runs as a backstop inside attemptLogin() for
 *     the one account attempting to sign in, so login is denied in real time
 *     even if no admin has opened that page since the account went stale.
 * Accounts that have never logged in (last_login_at IS NULL) are exempt —
 * their clock hasn't started yet.
 */

require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/security_settings.php';

const MAX_FAILED_LOGIN_ATTEMPTS = 3;

function ensureLoginSecuritySchema(PDO $pdo): void
{
    $columnCheck = $pdo->query("SHOW COLUMNS FROM users LIKE 'failed_login_attempts'")->fetch();
    if (!$columnCheck) {
        $pdo->exec("ALTER TABLE users ADD COLUMN failed_login_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER account_status");
    }

    $reasonCheck = $pdo->query("SHOW COLUMNS FROM users LIKE 'blocked_reason'")->fetch();
    if (!$reasonCheck) {
        $pdo->exec("ALTER TABLE users ADD COLUMN blocked_reason ENUM('failed_login','inactivity') NULL DEFAULT NULL AFTER account_status");
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

    $pdo->prepare("UPDATE users SET account_status = 'blocked', blocked_reason = 'failed_login' WHERE id = :id")
        ->execute([':id' => $userId]);

    sendAccountBlockedEmail($user['email'], $user['full_name']);
    return true;
}

/**
 * Checks one already-fetched, currently-active $user row against the
 * inactivity lockout policy and blocks it in place if it's overdue. $user
 * must include id, email, full_name, account_status, and last_login_at
 * (login_flow.php's SELECT already carries all of these). Returns true when
 * this call just blocked the account, so the caller can react immediately
 * instead of waiting for the next sweep/request.
 */
function maybeBlockForInactivity(PDO $pdo, array $user): bool
{
    $settings = getSecuritySettings($pdo);
    if (!$settings['inactivity_lockout_enabled'] || $user['last_login_at'] === null) {
        return false;
    }

    $days = $settings['inactivity_lockout_days'];
    $cutoff = strtotime($user['last_login_at']) + $days * 86400;
    if (time() <= $cutoff) {
        return false;
    }

    $pdo->prepare("UPDATE users SET account_status = 'blocked', blocked_reason = 'inactivity' WHERE id = :id")
        ->execute([':id' => (int) $user['id']]);

    sendInactivityBlockedEmail($user['email'], $user['full_name'], $days);
    return true;
}

/**
 * Bulk counterpart to maybeBlockForInactivity() — blocks every active
 * account that's gone quiet past the configured threshold, system-wide.
 * Call this right before listing accounts (see listUsers() in
 * api/admin/account-management.php), the same request-driven-sweep style
 * as sweepIdleSessions() in api/config/session.php: nothing runs on a timer,
 * it just runs whenever an admin happens to look.
 */
function sweepInactiveAccounts(PDO $pdo): void
{
    $settings = getSecuritySettings($pdo);
    if (!$settings['inactivity_lockout_enabled']) {
        return;
    }

    $days = $settings['inactivity_lockout_days'];

    $stmt = $pdo->prepare("
        SELECT id, email, full_name
        FROM users
        WHERE account_status = 'active'
          AND last_login_at IS NOT NULL
          AND last_login_at < DATE_SUB(NOW(), INTERVAL :days DAY)
    ");
    $stmt->bindValue(':days', $days, PDO::PARAM_INT);
    $stmt->execute();
    $stale = $stmt->fetchAll();

    if (!$stale) {
        return;
    }

    $update = $pdo->prepare("UPDATE users SET account_status = 'blocked', blocked_reason = 'inactivity' WHERE id = :id");
    foreach ($stale as $row) {
        $update->execute([':id' => $row['id']]);
        sendInactivityBlockedEmail($row['email'], $row['full_name'], $days);
    }
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

function sendInactivityBlockedEmail(string $email, string $name, int $days): void
{
    $details = [
        'Account' => htmlspecialchars($email, ENT_QUOTES),
        'When'    => date('M j, Y g:i A'),
    ];

    $body = "
        <p style='font-weight:700;color:#1a1a1a;'>Your account was blocked for inactivity</p>
        <p>This BVetter account hasn't been signed into in over
        <strong>{$days} days</strong>, so it has been blocked as a security precaution:</p>
        " . emailDetailList($details) . "
        <p>To restore access, please contact the Baliwag City Veterinary Office.</p>
    ";

    sendAppMail(
        $email,
        $name,
        'Your BVetter Account Has Been Blocked for Inactivity',
        notificationEmailWrapper('Account Blocked', $body)
    );
}

<?php
/**
 * VBetter – Email Verification for admin-created vet/admin accounts
 *
 * A user created from Account Management (role veterinarian or admin)
 * cannot log in until they click the link emailed here. See:
 *   - ensureEmailVerificationSchema()  – idempotent table/column setup
 *   - sendEmailVerificationLink()      – issues a token and emails it
 *   - api/auth/verify-email.php        – consumes the token
 */

require_once __DIR__ . '/mailer.php';

function ensureEmailVerificationSchema(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
            id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id    INT UNSIGNED NOT NULL,
            token      CHAR(64)     NOT NULL UNIQUE,
            expires_at DATETIME     NOT NULL,
            used_at    DATETIME     NULL,
            created_at DATETIME     NOT NULL DEFAULT NOW(),
            INDEX idx_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $columnCheck = $pdo->query("SHOW COLUMNS FROM users LIKE 'email_verified_at'")->fetch();
    if (!$columnCheck) {
        $pdo->exec("ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL AFTER account_status");

        // Grandfather in accounts that were already active before this feature
        // existed, so existing vet/admin staff aren't locked out retroactively.
        $pdo->exec("
            UPDATE users
            INNER JOIN roles ON roles.id = users.role_id
            SET users.email_verified_at = users.created_at
            WHERE roles.name IN ('veterinarian', 'admin')
              AND users.account_status = 'active'
        ");
    }
}

/**
 * Issues a fresh 24-hour verification token for $userId and emails the link.
 * Best-effort: returns false (and logs) on mail failure, never throws.
 */
function sendEmailVerificationLink(PDO $pdo, int $userId, string $email, string $fullName): bool
{
    $pdo->prepare('
        DELETE FROM email_verification_tokens WHERE user_id = :user_id AND used_at IS NULL
    ')->execute([':user_id' => $userId]);

    $token     = bin2hex(random_bytes(32));
    $expiresAt = date('Y-m-d H:i:s', time() + 86400);

    $pdo->prepare('
        INSERT INTO email_verification_tokens (user_id, token, expires_at)
        VALUES (:user_id, :token, :expires_at)
    ')->execute([
        ':user_id'    => $userId,
        ':token'      => $token,
        ':expires_at' => $expiresAt,
    ]);

    $verifyUrl = APP_URL . '/api/auth/verify-email.php?token=' . urlencode($token);
    $name      = htmlspecialchars($fullName, ENT_QUOTES);

    $body = notificationEmailWrapper(
        'Verify Your Email',
        "<p>Hi <strong>{$name}</strong>,</p>
         <p>An account has been created for you on VBetter. Please verify your email address
            to activate your account &mdash; you won't be able to log in until you do.</p>
         <p style='color:#999;font-size:12px;'>This link expires in 24 hours. If you did not
            expect this account, you can safely ignore this email.</p>",
        null,
        ['label' => 'Verify Email', 'url' => $verifyUrl]
    );

    return sendAppMail($email, $fullName, 'VBetter – Verify Your Email Address', $body);
}

<?php
/**
 * BVetter - Selenium test DB helper  (tests/selenium/support/dbq.php)
 *
 * The Selenium suite occasionally needs to read or nudge state that the UI
 * deliberately does not expose:
 *
 *   - the emailed 6-digit admin login OTP        (TC-AD-F01 and friends)
 *   - the emailed password-reset token           (TC-PO-F03)
 *   - a session's last_seen_at, so the 10-minute idle timeout can fire in
 *     seconds instead of ten real minutes        (TC-**-S04)
 *
 * Reading those out of the database is the harness standing in for the
 * mailbox and for the clock. It is CLI-only and every query is whitelisted
 * below - this file is a test fixture, never a web endpoint.
 *
 * Called from Python via support/db.py:  php dbq.php <action> [args...]
 * Always prints a single JSON object on stdout.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../../../api/config/connection.php';

/** The tag every row the suite creates carries, so cleanup can find them. */
define('SEL_TAG', '[SELENIUM]');

function out(array $payload): void
{
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message): void
{
    out(['ok' => false, 'error' => $message]);
}

$action = $argv[1] ?? '';
$args   = array_slice($argv, 2);

try {
    switch ($action) {

        /* -- who am I talking to ------------------------------- */
        case 'ping':
            out(['ok' => true, 'db' => DB_NAME, 'host' => DB_HOST]);

        /* -- user lookups -------------------------------------- */
        case 'user':
            $stmt = $pdo->prepare(
                'SELECT users.id, users.email, users.full_name, users.account_status,
                        users.two_factor_enabled, users.failed_login_attempts,
                        users.email_verified_at, roles.name AS role,
                        owner_profiles.verification_status
                 FROM users
                 INNER JOIN roles ON roles.id = users.role_id
                 LEFT JOIN owner_profiles ON owner_profiles.user_id = users.id
                 WHERE users.email = :email LIMIT 1'
            );
            $stmt->execute([':email' => $args[0] ?? '']);
            out(['ok' => true, 'user' => $stmt->fetch() ?: null]);

        /* An account in exactly the state api/auth/register.php leaves a new
           registration in: account_status 'inactive', residency proof still
           'pending'. TC-PO-S02 needs one to try to log in as, without having
           to run the whole registration wizard first. Cleaned up by the
           'selenium.reg.%' rule in cleanup below. */
        case 'ensure_pending_owner':
            $email    = $args[0] ?? '';
            $password = $args[1] ?? '';
            if ($email === '' || $password === '') {
                fail('ensure_pending_owner needs an email and a password');
            }

            $roleId = $pdo->query("SELECT id FROM roles WHERE name = 'pet_owner' LIMIT 1")
                ->fetchColumn();
            $hash = password_hash($password, PASSWORD_DEFAULT);

            $stmt = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
            $stmt->execute([':email' => $email]);
            $userId = $stmt->fetchColumn();

            if ($userId) {
                $pdo->prepare(
                    "UPDATE users SET password_hash = :hash, account_status = 'inactive',
                                      blocked_reason = NULL, failed_login_attempts = 0
                     WHERE id = :id"
                )->execute([':hash' => $hash, ':id' => $userId]);
            } else {
                $pdo->prepare(
                    "INSERT INTO users (role_id, full_name, email, password_hash, phone_number, account_status)
                     VALUES (:role_id, 'Automation Pending Applicant', :email, :hash, '09170000009', 'inactive')"
                )->execute([':role_id' => $roleId, ':email' => $email, ':hash' => $hash]);
                $userId = (int) $pdo->lastInsertId();
            }

            $has = $pdo->prepare('SELECT id FROM owner_profiles WHERE user_id = :id LIMIT 1');
            $has->execute([':id' => $userId]);
            if ($has->fetchColumn()) {
                $pdo->prepare(
                    "UPDATE owner_profiles SET verification_status = 'pending', verified_at = NULL
                     WHERE user_id = :id"
                )->execute([':id' => $userId]);
            } else {
                $pdo->prepare(
                    "INSERT INTO owner_profiles (user_id, barangay_id, complete_address, verification_status)
                     VALUES (:id, (SELECT id FROM barangays ORDER BY id LIMIT 1),
                             '1 Automation St., Baliwag', 'pending')"
                )->execute([':id' => $userId]);
            }

            out(['ok' => true, 'user_id' => (int) $userId]);

        /* Undo a lockout caused by a deliberately-wrong-password test. */
        case 'reset_failed_attempts':
            $stmt = $pdo->prepare(
                "UPDATE users
                 SET failed_login_attempts = 0,
                     account_status = IF(account_status = 'blocked' AND blocked_reason = 'failed_login',
                                         'active', account_status),
                     blocked_reason = IF(blocked_reason = 'failed_login', NULL, blocked_reason)
                 WHERE email = :email"
            );
            $stmt->execute([':email' => $args[0] ?? '']);
            out(['ok' => true, 'rows' => $stmt->rowCount()]);

        /* -- the mailbox stand-ins ----------------------------- */
        case 'login_otp':
            $stmt = $pdo->prepare(
                'SELECT login_otp_codes.otp_code
                 FROM login_otp_codes
                 INNER JOIN users ON users.id = login_otp_codes.user_id
                 WHERE users.email = :email
                   AND login_otp_codes.consumed_at IS NULL
                   AND login_otp_codes.expires_at > NOW()
                 ORDER BY login_otp_codes.id DESC LIMIT 1'
            );
            $stmt->execute([':email' => $args[0] ?? '']);
            $row = $stmt->fetch();
            out(['ok' => true, 'otp' => $row ? $row['otp_code'] : null]);

        /* Registration's pre-account email OTP (api/admin/verify-contact.php).
           The row is written before the email is attempted, so this works even
           when the address is a throwaway that no mail server will accept.

           expires_at is compared against PHP's clock, not MySQL's NOW(),
           because that column is written with PHP date() while created_at
           defaults to MySQL NOW(). On this machine those two clocks are six
           hours apart (PHP is Europe/Berlin, MySQL is local), so an SQL-side
           NOW() comparison would call every fresh code expired. verifyOtp()
           in verify-contact.php compares with PHP's clock too, so mirroring it
           here is also the honest reproduction of what the app does. */
        case 'registration_otp':
            $stmt = $pdo->prepare(
                "SELECT otp_code FROM contact_verifications
                 WHERE contact_type = 'email' AND contact_value = :email
                   AND verified_at IS NULL AND expires_at > :now
                 ORDER BY id DESC LIMIT 1"
            );
            $stmt->execute([':email' => $args[0] ?? '', ':now' => date('Y-m-d H:i:s')]);
            $row = $stmt->fetch();
            out(['ok' => true, 'otp' => $row ? $row['otp_code'] : null]);

        /* Same clock caveat as registration_otp: password_reset_tokens.expires_at
           is PHP-generated and resetPassword() validates it with PHP DateTime. */
        case 'reset_token':
            $stmt = $pdo->prepare(
                'SELECT password_reset_tokens.token
                 FROM password_reset_tokens
                 INNER JOIN users ON users.id = password_reset_tokens.user_id
                 WHERE users.email = :email
                   AND password_reset_tokens.used_at IS NULL
                   AND password_reset_tokens.expires_at > :now
                 ORDER BY password_reset_tokens.id DESC LIMIT 1'
            );
            $stmt->execute([':email' => $args[0] ?? '', ':now' => date('Y-m-d H:i:s')]);
            $row = $stmt->fetch();
            out(['ok' => true, 'token' => $row ? $row['token'] : null]);

        /* -- the clock stand-in -------------------------------- */
        /* Pushes one live session's last_seen_at back N minutes so the
           server-side idle check treats it as abandoned on the next poll. */
        case 'age_session':
            $token   = $args[0] ?? '';
            $minutes = (int) ($args[1] ?? 30);
            if ($token === '') {
                fail('age_session needs a token');
            }
            $stmt = $pdo->prepare(
                'UPDATE user_sessions
                 SET last_seen_at = DATE_SUB(NOW(), INTERVAL :minutes MINUTE)
                 WHERE token_hash = :hash AND revoked_at IS NULL'
            );
            $stmt->execute([':minutes' => $minutes, ':hash' => hash('sha256', $token)]);
            out(['ok' => true, 'rows' => $stmt->rowCount()]);

        case 'idle_minutes':
            require_once __DIR__ . '/../../../api/config/security_settings.php';
            out(['ok' => true, 'minutes' => getSecuritySettings($pdo)['session_idle_minutes']]);

        /* -- assertions the UI cannot show --------------------- */
        case 'latest_appointment':
            $stmt = $pdo->prepare(
                'SELECT appointments.id, appointments.status, appointments.appointment_type,
                        appointments.preferred_date, appointments.time_slot
                 FROM appointments
                 INNER JOIN users ON users.id = appointments.owner_id
                 WHERE users.email = :email
                 ORDER BY appointments.id DESC LIMIT 1'
            );
            $stmt->execute([':email' => $args[0] ?? '']);
            out(['ok' => true, 'appointment' => $stmt->fetch() ?: null]);

        case 'latest_lf_report':
            $stmt = $pdo->prepare(
                'SELECT lost_found_reports.id, lost_found_reports.case_number,
                        lost_found_reports.status, lost_found_reports.pet_name,
                        lost_found_reports.report_type
                 FROM lost_found_reports
                 INNER JOIN users ON users.id = lost_found_reports.owner_id
                 WHERE users.email = :email
                 ORDER BY lost_found_reports.id DESC LIMIT 1'
            );
            $stmt->execute([':email' => $args[0] ?? '']);
            out(['ok' => true, 'report' => $stmt->fetch() ?: null]);

        /* A report owned by somebody OTHER than the given email - the target
           for the horizontal-access-control probe in TC-PO-S05. */
        case 'foreign_lf_owner':
            $stmt = $pdo->prepare(
                'SELECT lost_found_reports.id, lost_found_reports.owner_id
                 FROM lost_found_reports
                 WHERE lost_found_reports.owner_id IS NOT NULL
                   AND lost_found_reports.owner_id <> (SELECT id FROM users WHERE email = :email LIMIT 1)
                 ORDER BY lost_found_reports.id DESC LIMIT 1'
            );
            $stmt->execute([':email' => $args[0] ?? '']);
            out(['ok' => true, 'report' => $stmt->fetch() ?: null]);

        case 'any_vacc_event':
            $row = $pdo->query(
                'SELECT id, barangay, vaccine, status, event_date, total_vaccinated
                 FROM mass_vaccination_events
                 ORDER BY id DESC LIMIT 1'
            )->fetch();
            out(['ok' => true, 'event' => $row ?: null]);

        case 'barangay':
            $row = $pdo->query('SELECT id, name FROM barangays ORDER BY id LIMIT 1')->fetch();
            out(['ok' => true, 'barangay' => $row ?: null]);

        /* -- housekeeping -------------------------------------- */
        /* Deletes ONLY rows the suite tagged with SEL_TAG. Nothing else is
           touched, so this can never reach real beta data. */
        case 'cleanup':
            $tag = '%' . SEL_TAG . '%';
            $deleted = [];

            $stmt = $pdo->prepare(
                'DELETE FROM lost_found_reports
                 WHERE color_markings LIKE :tag OR notes LIKE :tag2'
            );
            $stmt->execute([':tag' => $tag, ':tag2' => $tag]);
            $deleted['lost_found_reports'] = $stmt->rowCount();

            $stmt = $pdo->prepare('DELETE FROM appointments WHERE notes LIKE :tag');
            $stmt->execute([':tag' => $tag]);
            $deleted['appointments'] = $stmt->rowCount();

            // Child rows first - users has incoming foreign keys from both
            // owner_profiles and user_verification_documents.
            $stmt = $pdo->prepare(
                "DELETE FROM user_verification_documents WHERE user_id IN
                 (SELECT id FROM users WHERE email LIKE 'selenium.%@bvetter.test')"
            );
            $stmt->execute();
            $deleted['verification_documents'] = $stmt->rowCount();

            $stmt = $pdo->prepare(
                "DELETE FROM owner_profiles WHERE user_id IN
                 (SELECT id FROM users WHERE email LIKE 'selenium.reg.%@bvetter.test')"
            );
            $stmt->execute();
            $deleted['owner_profiles'] = $stmt->rowCount();

            $stmt = $pdo->prepare("DELETE FROM users WHERE email LIKE 'selenium.reg.%@bvetter.test'");
            $stmt->execute();
            $deleted['registered_users'] = $stmt->rowCount();

            $stmt = $pdo->prepare(
                "DELETE FROM contact_verifications WHERE contact_value LIKE 'selenium.%@bvetter.test'"
            );
            $stmt->execute();
            $deleted['contact_verifications'] = $stmt->rowCount();

            // Accounts created through admin's "Create New User" form.
            $stmt = $pdo->prepare(
                "DELETE FROM veterinarian_profiles WHERE user_id IN
                 (SELECT id FROM users WHERE email LIKE 'selenium.acct.%@bvetter.test')"
            );
            $stmt->execute();
            $stmt = $pdo->prepare(
                "DELETE FROM owner_profiles WHERE user_id IN
                 (SELECT id FROM users WHERE email LIKE 'selenium.acct.%@bvetter.test')"
            );
            $stmt->execute();
            $stmt = $pdo->prepare("DELETE FROM users WHERE email LIKE 'selenium.acct.%@bvetter.test'");
            $stmt->execute();
            $deleted['admin_created_users'] = $stmt->rowCount();

            out(['ok' => true, 'deleted' => $deleted]);

        default:
            fail("unknown action '" . $action . "'");
    }
} catch (Throwable $e) {
    fail($e->getMessage());
}

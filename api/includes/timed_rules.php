<?php
/**
 * Review time limits: what happens when a request waits too long.
 *
 * Review stays manual by default. Each queue has a limit, and what happens
 * when it passes depends on what is safe for that queue:
 *
 *   Appointment requests -- expire after 1 working day, or at the slot's
 *     start if that comes first. A request nobody confirmed is meaningless
 *     once its time arrives, and a pending request holds its slot, so it
 *     must not hold it forever. The owner is told to book again. They are
 *     never auto-confirmed: nothing blocks clinic slots on field days, so an
 *     auto-confirm while the vets are out would tell residents to come to an
 *     empty clinic.
 *
 *   Account applications -- never decided automatically; checking an ID is
 *     the one step that needs a person. Admins are reminded after 1 working
 *     day, and the application shows as Overdue after 2.
 *
 *   Lost & Found reports -- auto-publish 2 hours after submission, around
 *     the clock, tagged for the vets to review later. Every poster is an
 *     ID-verified resident and a lost pet can't wait for a field day to end.
 *     That rule lives in api/lost-found/lost_and_found.php, next to the
 *     matching it has to trigger.
 *
 * Only requests made after this shipped carry deadlines (the *_at columns
 * below are NULL on older rows), and this sweep never touches the others.
 * Older pending appointments whose time has already passed are closed
 * quietly, with no email, by the migration -- run its dry run first:
 * database/migrations/2026-09-25-time-limits-dryrun.php.
 *
 * There is no scheduler on the server, so runTimedRules() is called from the
 * endpoints staff and owners hit anyway (the notification bell polls it), at
 * most once every 30 seconds. api/cron/timed-rules.php runs the same rules
 * from cron, so reminder emails also go out when nobody has the site open.
 */

require_once __DIR__ . '/../config/notifications.php';
require_once __DIR__ . '/../config/mailer.php';
require_once __DIR__ . '/working_hours.php';

const BV_LF_AUTO_PUBLISH_MINUTES = 120;

function ensureTimedRulesSchema(PDO $pdo): bool
{
    static $ready = null;
    if ($ready !== null) return $ready;

    // Attempted rather than assumed, like ensureRescheduleSchema(): a database
    // user without ALTER must not take the APIs down. The same statements are
    // in database/migrations/2026-09-25-time-limits.sql to run by hand.
    try {
        if (!$pdo->query("SHOW COLUMNS FROM appointments LIKE 'expires_at'")->fetch()) {
            $pdo->exec('ALTER TABLE appointments ADD COLUMN expires_at DATETIME NULL');
        }
        $status = $pdo->query("SHOW COLUMNS FROM appointments LIKE 'status'")->fetch();
        if ($status && strpos($status['Type'], "'expired'") === false) {
            $pdo->exec("
                ALTER TABLE appointments
                MODIFY COLUMN status
                ENUM('pending','confirmed','completed','cancelled','rejected','reschedule_pending','expired')
                DEFAULT 'pending'
            ");
        }

        if (!$pdo->query("SHOW COLUMNS FROM user_verification_documents LIKE 'review_remind_at'")->fetch()) {
            $pdo->exec('
                ALTER TABLE user_verification_documents
                    ADD COLUMN review_remind_at DATETIME NULL,
                    ADD COLUMN review_overdue_at DATETIME NULL,
                    ADD COLUMN review_reminded_at DATETIME NULL
            ');
        }

        $lf = $pdo->query("SHOW TABLES LIKE 'lost_found_reports'")->fetch();
        if ($lf && !$pdo->query("SHOW COLUMNS FROM lost_found_reports LIKE 'auto_publish_at'")->fetch()) {
            $pdo->exec('
                ALTER TABLE lost_found_reports
                    ADD COLUMN auto_publish_at DATETIME NULL,
                    ADD COLUMN auto_published_at DATETIME NULL
            ');
        }
    } catch (PDOException $e) {
        error_log('[BVetter] timed rules schema migration failed: ' . $e->getMessage());
        return $ready = false;
    }

    return $ready = true;
}

function bvNow(): DateTimeImmutable
{
    return new DateTimeImmutable('now');
}

/* ── Deadlines, stamped when a request is made ─────────────────────── */

/** 1 working day to confirm, but never past the slot itself. */
function setAppointmentExpiry(PDO $pdo, int $appointmentId, string $date, string $timeSlot): void
{
    if (!ensureTimedRulesSchema($pdo)) return;
    $deadline = addWorkingDays(bvNow(), 1);
    $slotStart = DateTimeImmutable::createFromFormat('Y-m-d H:i', $date . ' ' . $timeSlot);
    if ($slotStart && $slotStart < $deadline) $deadline = $slotStart;

    $pdo->prepare('UPDATE appointments SET expires_at = :at WHERE id = :id')
        ->execute([':at' => $deadline->format('Y-m-d H:i:s'), ':id' => $appointmentId]);
}

function setApplicationDeadlines(PDO $pdo, int $documentId): void
{
    if (!ensureTimedRulesSchema($pdo)) return;
    $now = bvNow();
    $pdo->prepare('
        UPDATE user_verification_documents
        SET review_remind_at = :remind, review_overdue_at = :overdue, review_reminded_at = NULL
        WHERE id = :id
    ')->execute([
        ':remind' => addWorkingDays($now, 1)->format('Y-m-d H:i:s'),
        ':overdue' => addWorkingDays($now, 2)->format('Y-m-d H:i:s'),
        ':id' => $documentId,
    ]);
}

function setReportAutoPublish(PDO $pdo, int $reportId): void
{
    if (!ensureTimedRulesSchema($pdo)) return;
    $pdo->prepare('UPDATE lost_found_reports SET auto_publish_at = :at WHERE id = :id')
        ->execute([
            ':at' => bvNow()->modify('+' . BV_LF_AUTO_PUBLISH_MINUTES . ' minutes')->format('Y-m-d H:i:s'),
            ':id' => $reportId,
        ]);
}

/* ── The sweep ──────────────────────────────────────────────────────── */

/**
 * Runs the appointment and account rules. Cheap to call on every request:
 * it does nothing unless 30 seconds have passed since the last run, and a
 * named lock keeps two requests from running it at once.
 */
function runTimedRules(PDO $pdo, bool $force = false): void
{
    try {
        if (!ensureTimedRulesSchema($pdo)) return;

        $stamp = dirname(__DIR__, 2) . '/storage/timed-rules.last';
        if (!$force && is_file($stamp) && time() - (int) @filemtime($stamp) < 30) return;
        @touch($stamp);

        $lock = $pdo->query("SELECT GET_LOCK('bv_timed_rules', 0)")->fetchColumn();
        if ((int) $lock !== 1) return;

        try {
            expireUnconfirmedAppointments($pdo);
            remindWaitingApplications($pdo);
        } finally {
            $pdo->query("SELECT RELEASE_LOCK('bv_timed_rules')");
        }
    } catch (Throwable $e) {
        // A failed sweep must never break the request that triggered it.
        error_log('[BVetter] timed rules: ' . $e->getMessage());
    }
}

function expireUnconfirmedAppointments(PDO $pdo): void
{
    // Rows with no expires_at predate the time limit: they are left to the
    // vets and the migration, never expired (or emailed about) from here.
    $stmt = $pdo->prepare("
        SELECT id
        FROM appointments
        WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= :now
    ");
    $stmt->execute([':now' => bvNow()->format('Y-m-d H:i:s')]);

    foreach ($stmt->fetchAll() as $row) {
        $update = $pdo->prepare("UPDATE appointments SET status = 'expired', cancelled_at = NOW() WHERE id = :id AND status = 'pending'");
        $update->execute([':id' => $row['id']]);
        if ($update->rowCount() === 1) {
            notifyOwnerAppointmentExpired($pdo, (int) $row['id']);
        }
    }
}

function notifyOwnerAppointmentExpired(PDO $pdo, int $appointmentId): void
{
    $stmt = $pdo->prepare('
        SELECT appointments.preferred_date, appointments.time_slot, appointments.contact_email,
               owners.id AS owner_id, owners.full_name AS owner_name, owners.email AS owner_email
        FROM appointments
        INNER JOIN users owners ON owners.id = appointments.owner_id
        WHERE appointments.id = :id
        LIMIT 1
    ');
    $stmt->execute([':id' => $appointmentId]);
    $row = $stmt->fetch();
    if (!$row) return;

    $when = "{$row['preferred_date']} at {$row['time_slot']}";
    $message = "The clinic couldn't confirm your appointment request for {$when} in time, so it expired and the slot was released. Please book again.";

    try {
        notifyUser($pdo, (int) $row['owner_id'], 'appointment_status', 'Appointment Request Expired', $message, $appointmentId);

        $email = $row['contact_email'] ?: $row['owner_email'];
        if ($email && userWantsNotification($pdo, (int) $row['owner_id'], 'appointment_reminders')) {
            sendAppMail(
                $email,
                (string) $row['owner_name'],
                'BVetter – Your appointment request expired',
                notificationEmailWrapper(
                    'Appointment Request Expired',
                    '<p>' . htmlspecialchars($message, ENT_QUOTES) . '</p>',
                    null,
                    ['label' => 'Book Again', 'url' => APP_URL . '/public/pages/book-appointment.html']
                )
            );
        }
    } catch (Throwable $e) {
        error_log('[BVetter] expiry notice failed for appointment ' . $appointmentId . ': ' . $e->getMessage());
    }
}

function remindWaitingApplications(PDO $pdo): void
{
    $stmt = $pdo->prepare("
        SELECT documents.id, documents.user_id, documents.review_overdue_at, users.full_name
        FROM user_verification_documents documents
        INNER JOIN users ON users.id = documents.user_id
        INNER JOIN owner_profiles ON owner_profiles.user_id = users.id
        WHERE documents.status = 'pending'
          AND owner_profiles.verification_status = 'pending'
          AND documents.review_remind_at IS NOT NULL
          AND documents.review_remind_at <= :now
          AND documents.review_reminded_at IS NULL
    ");
    $stmt->execute([':now' => bvNow()->format('Y-m-d H:i:s')]);

    foreach ($stmt->fetchAll() as $row) {
        $claim = $pdo->prepare('UPDATE user_verification_documents SET review_reminded_at = NOW() WHERE id = :id AND review_reminded_at IS NULL');
        $claim->execute([':id' => $row['id']]);
        if ($claim->rowCount() !== 1) continue;

        $overdue = $row['review_overdue_at']
            ? (new DateTimeImmutable($row['review_overdue_at']))->format('D, M j g:i A')
            : 'soon';
        try {
            notifyStaff(
                $pdo,
                'admin',
                'account_application',
                'Application Waiting for Review',
                $row['full_name'] . "'s application has waited 1 working day. It becomes overdue on {$overdue}.",
                (int) $row['user_id'],
                true,
                'account-management.html?review=' . (int) $row['user_id'],
                'Review Application'
            );
        } catch (Throwable $e) {
            error_log('[BVetter] application reminder failed for user ' . $row['user_id'] . ': ' . $e->getMessage());
        }
    }
}

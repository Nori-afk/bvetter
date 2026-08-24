<?php
/**
 * BVetter – shared definitions for the 2026-08-24 timezone correction.
 *
 * Required by BOTH 2026-08-24-timezone-dryrun.php and
 * 2026-08-24-timezone-apply.php so the two can never drift apart: the dry run
 * must describe exactly the rows the apply will touch, or reading it proves
 * nothing.
 *
 * ── Why only SOME columns are listed ──────────────────────────────────
 * MySQL stores `timestamp` columns as UTC and converts them to the session
 * zone on read, so all 61 of those follow api/config/connection.php's new
 * `SET time_zone = '+08:00'` automatically and need no data change.
 *
 * `datetime` columns store a literal wall-clock string and do NOT convert.
 * This schema has 31 of them, and they split in two:
 *
 *   - 20 hold a moment a human eventually reads back (when an appointment
 *     was confirmed, when an account last logged in). Those are shifted.
 *   - 11 are short-lived auth-token bookkeeping that expires in minutes.
 *     Rewriting live token windows is real risk for no visible benefit, so
 *     they are deliberately left alone and listed below as a record of that
 *     decision rather than as an oversight.
 */

/** Offset the whole app is being pinned to. Matches BV_TIMEZONE_OFFSET. */
const BV_TZ_TARGET_OFFSET_SECONDS = 8 * 3600;   // +08:00, Philippine time

/** Marker table, so a re-run cannot double-shift the data. */
const BV_TZ_MIGRATION_KEY = '2026-08-24-timezone';

/**
 * `datetime` columns that a user reads back, and so must be corrected.
 *
 * user_sessions.last_seen_at is NOT cosmetic and must stay in this list:
 * api/config/session.php enforces the idle timeout with
 * `last_seen_at < DATE_SUB(NOW(), INTERVAL :minutes MINUTE)`. NOW() moves
 * with the pin but a datetime literal does not, so leaving it behind would
 * either log every active user out at deploy or stop the timeout firing.
 */
function bv_tz_display_columns()
{
    return array(
        array('appointments',                'cancelled_at'),
        array('appointments',                'confirmed_at'),
        array('appointments',                'reschedule_requested_at'),
        array('contact_verifications',       'verified_at'),
        array('csp_registrations',           'assigned_at'),
        array('lost_found_claims',           'reviewed_at'),
        array('lost_found_matches',          'reviewed_at'),
        array('lost_found_reports',          'reviewed_at'),
        array('lost_found_reports',          'resolved_at'),
        array('lost_found_sightings',        'reviewed_at'),
        array('owner_profiles',              'verified_at'),
        array('security_settings',           'updated_at'),
        array('support_tickets',             'resolved_at'),
        array('user_sessions',               'created_at'),
        array('user_sessions',               'last_seen_at'),
        array('user_sessions',               'revoked_at'),
        array('user_verification_documents', 'reviewed_at'),
        array('users',                       'email_verified_at'),
        array('users',                       'last_login_at'),
        array('users',                       'password_changed_at'),
    );
}

/** Deliberately skipped: short-lived auth tokens. Listed for the record. */
function bv_tz_skipped_columns()
{
    return array(
        array('contact_verifications',    'created_at'),
        array('contact_verifications',    'expires_at'),
        array('email_verification_tokens', 'created_at'),
        array('email_verification_tokens', 'expires_at'),
        array('email_verification_tokens', 'used_at'),
        array('login_otp_codes',          'consumed_at'),
        array('login_otp_codes',          'created_at'),
        array('login_otp_codes',          'expires_at'),
        array('password_reset_tokens',    'created_at'),
        array('password_reset_tokens',    'expires_at'),
        array('password_reset_tokens',    'used_at'),
    );
}

/**
 * The server's OWN timezone offset, in seconds east of UTC.
 *
 * This is the crux of the whole migration. It deliberately asks for
 * `time_zone = 'SYSTEM'` first, so it reports the host's real offset even
 * after connection.php has pinned the session to +08:00. Reading
 * TIMEDIFF(NOW(), UTC_TIMESTAMP()) off the pinned session would return
 * +08:00 on any server on earth, the shift would compute as zero, and the
 * migration would silently do nothing while appearing to succeed.
 *
 * Restores the pinned session zone before returning.
 */
function bv_tz_system_offset_seconds(PDO $pdo)
{
    $restore = $pdo->query('SELECT @@session.time_zone')->fetchColumn();

    $pdo->exec("SET SESSION time_zone = 'SYSTEM'");
    $row = $pdo->query(
        'SELECT TIMEDIFF(NOW(), UTC_TIMESTAMP()) AS off, @@system_time_zone AS name'
    )->fetch();

    $pdo->exec('SET SESSION time_zone = ' . $pdo->quote($restore));

    // TIMEDIFF gives e.g. "08:00:00" or "-05:00:00".
    $sign = (strpos((string) $row['off'], '-') === 0) ? -1 : 1;
    $bits = explode(':', ltrim((string) $row['off'], '+-'));
    $secs = ((int) $bits[0]) * 3600 + ((int) $bits[1]) * 60 + (int) (isset($bits[2]) ? $bits[2] : 0);

    return array(
        'seconds' => $sign * $secs,
        'raw'     => (string) $row['off'],
        'name'    => (string) $row['name'],
    );
}

/** How far every `datetime` literal must move. Zero means nothing to do. */
function bv_tz_shift_seconds(PDO $pdo)
{
    $sys = bv_tz_system_offset_seconds($pdo);
    return BV_TZ_TARGET_OFFSET_SECONDS - $sys['seconds'];
}

function bv_tz_column_exists(PDO $pdo, $table, $column)
{
    $stmt = $pdo->prepare('
        SELECT DATA_TYPE
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = :t
          AND COLUMN_NAME  = :c
    ');
    $stmt->execute(array(':t' => $table, ':c' => $column));
    return $stmt->fetchColumn();
}

function bv_tz_format_shift($seconds)
{
    if ($seconds === 0) {
        return '0 (no change needed)';
    }
    $sign = $seconds < 0 ? '-' : '+';
    $abs  = abs($seconds);
    return sprintf('%s%02d:%02d:%02d (%s%d seconds)',
        $sign, intdiv($abs, 3600), intdiv($abs % 3600, 60), $abs % 60, $sign, $abs);
}

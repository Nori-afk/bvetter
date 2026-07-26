<?php

/**
 * Notification emails for a newly-booked appointment — extracted out of
 * appointment.php so both the request handler and notify_worker.php (the
 * detached background process that actually sends them) can share the
 * same logic. See notify_worker.php for why this runs out-of-process.
 */

function notifyNewAppointmentRequest($pdo, $appointmentId, $ownerId, $petId, $appointmentType, $preferredDate, $timeSlot)
{
    $ownerStmt = $pdo->prepare('SELECT full_name FROM users WHERE id = :id LIMIT 1');
    $ownerStmt->execute([':id' => $ownerId]);
    $ownerName = $ownerStmt->fetchColumn() ?: 'A pet owner';

    $petStmt = $pdo->prepare('SELECT pet_name FROM pets WHERE id = :id LIMIT 1');
    $petStmt->execute([':id' => $petId]);
    $petName = $petStmt->fetchColumn() ?: 'a pet';

    notifyStaff(
        $pdo,
        'both',
        'appointment_new',
        'New Appointment Request',
        "{$ownerName} requested a {$appointmentType} appointment for {$petName} on {$preferredDate} at {$timeSlot}.",
        $appointmentId,
        true
    );
}

function notifyOwnerAppointmentRequested($pdo, $appointmentId)
{
    $stmt = $pdo->prepare('
        SELECT appointments.preferred_date, appointments.time_slot,
               owners.id AS owner_id, owners.full_name AS owner_name, owners.email AS owner_email
        FROM appointments
        INNER JOIN users owners ON owners.id = appointments.owner_id
        WHERE appointments.id = :id
        LIMIT 1
    ');
    $stmt->execute([':id' => (int) $appointmentId]);
    $row = $stmt->fetch();
    if (!$row || !$row['owner_email']) return;

    $ownerId = (int) $row['owner_id'];
    if (!userWantsNotification($pdo, $ownerId, 'appointment_reminders')) return;

    $subject = 'VBetter – We received your appointment request';
    $body = notificationEmailWrapper(
        'Appointment Request Received',
        "<p>We've received your request for <strong>{$row['preferred_date']}</strong> at
           <strong>{$row['time_slot']}</strong>. We'll email you once it's been reviewed.</p>",
        null,
        ['label' => 'View', 'url' => APP_URL . '/public/pages/book-appointment.html']
    );

    sendAppMail($row['owner_email'], clean($row['owner_name'] ?? ''), $subject, $body);
}

/**
 * Looks up everything notifyNewAppointmentRequest() needs from just the
 * appointment ID, then sends both notifications. Used by notify_worker.php
 * (the normal, detached path) and as the synchronous fallback in
 * spawnAppointmentNotifications() if the server can't spawn processes.
 */
function runAppointmentNotifications(PDO $pdo, int $appointmentId): void
{
    $stmt = $pdo->prepare('
        SELECT owner_id, pet_id, appointment_type, preferred_date, time_slot
        FROM appointments WHERE id = :id LIMIT 1
    ');
    $stmt->execute([':id' => $appointmentId]);
    $row = $stmt->fetch();
    if (!$row) return;

    notifyNewAppointmentRequest(
        $pdo,
        $appointmentId,
        (int) $row['owner_id'],
        (int) $row['pet_id'],
        $row['appointment_type'],
        $row['preferred_date'],
        $row['time_slot']
    );
    notifyOwnerAppointmentRequested($pdo, $appointmentId);
}

/**
 * Hands the (slow — one HTTPS call per recipient) notification emails off
 * to a fully separate OS process instead of running them inline.
 *
 * Why: under mod_php (no PHP-FPM), an Apache worker stays occupied for a
 * PHP script's *entire* runtime — there's no fastcgi_finish_request()
 * equivalent to release it early. Running these emails inline, even after
 * the response was flushed, kept the worker (and the emails) blocking on
 * Brevo for the full duration; a couple of slow/queued bookings at once
 * was enough to exhaust Apache's worker pool and freeze the whole site.
 * Spawning a detached `php notify_worker.php <id> &` process instead means
 * this request's worker is freed the instant this function returns.
 */
function spawnAppointmentNotifications(PDO $pdo, int $appointmentId): void
{
    $script = __DIR__ . '/notify_worker.php';

    // NOTE: PHP_BINARY is NOT usable here — under any web SAPI (apache2handler,
    // php-fpm, etc.) it points at the *server's own* binary (httpd.exe,
    // apache2, php-fpm...), not a standalone `php` CLI executable. Always
    // locate the real CLI binary instead.
    $phpBinary = locatePhpCliBinary();
    if ($phpBinary === null || !function_exists('exec')) {
        // Couldn't find a CLI binary, or exec() is disabled on this host —
        // fall back to sending inline so the notification still goes out,
        // even though it reintroduces the wait.
        runAppointmentNotifications($pdo, $appointmentId);
        return;
    }

    if (stripos(PHP_OS, 'WIN') === 0) {
        // Local XAMPP/Windows dev — best-effort background via `start /B`.
        $cmd = 'start /B "" ' . escapeshellarg($phpBinary) . ' ' . escapeshellarg($script) . ' ' . $appointmentId;
        pclose(popen($cmd, 'r'));
        return;
    }

    exec(
        escapeshellarg($phpBinary) . ' ' . escapeshellarg($script) . ' ' . $appointmentId
        . ' > /dev/null 2>&1 &'
    );
}

/**
 * Finds a real `php` CLI executable, since PHP_BINARY can't be trusted from
 * a web request (see spawnAppointmentNotifications() above). Returns null if
 * none of the usual spots have it, so callers can fall back gracefully.
 */
function locatePhpCliBinary(): ?string
{
    if (stripos(PHP_OS, 'WIN') === 0) {
        foreach (['C:\\xampp\\php\\php.exe'] as $candidate) {
            if (file_exists($candidate)) return $candidate;
        }
        return null;
    }

    $found = trim((string) shell_exec('command -v php 2>/dev/null'));
    if ($found !== '') return $found;

    foreach (['/usr/bin/php', '/usr/local/bin/php'] as $candidate) {
        if (file_exists($candidate)) return $candidate;
    }
    return null;
}

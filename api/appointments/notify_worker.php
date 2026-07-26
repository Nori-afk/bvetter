<?php

/**
 * CLI-only. Spawned as a detached background process by
 * spawnAppointmentNotifications() in appointment.php — sends the "new
 * appointment" notification emails fully independently of the web request
 * that created the appointment, so a slow Brevo call never ties up an
 * Apache worker. Never invoke this over HTTP.
 */

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit;
}

$appointmentId = (int) ($argv[1] ?? 0);
if ($appointmentId <= 0) {
    exit(1);
}

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/mailer.php';
require_once __DIR__ . '/../config/notifications.php';
require_once __DIR__ . '/appointment_notifications.php';

runAppointmentNotifications($pdo, $appointmentId);

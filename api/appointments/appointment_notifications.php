<?php

/**
 * Notification emails for a newly-booked appointment — extracted out of
 * appointment.php only so the logic has one clear home; called
 * synchronously from createAppointment() via runAppointmentNotifications().
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
        SELECT appointments.preferred_date, appointments.time_slot, appointments.contact_email,
               owners.id AS owner_id, owners.full_name AS owner_name, owners.email AS owner_email
        FROM appointments
        INNER JOIN users owners ON owners.id = appointments.owner_id
        WHERE appointments.id = :id
        LIMIT 1
    ');
    $stmt->execute([':id' => (int) $appointmentId]);
    $row = $stmt->fetch();
    if (!$row) return;

    // The booking form always asks for a contact email (even for logged-in
    // owners), specifically so the confirmation goes wherever the user
    // typed rather than their account's login email. Fall back to the
    // account email only when nothing was submitted on the form.
    $recipientEmail = $row['contact_email'] ?: $row['owner_email'];
    if (!$recipientEmail) return;

    $ownerId = (int) $row['owner_id'];
    if (!userWantsNotification($pdo, $ownerId, 'appointment_reminders')) return;

    $subject = 'BVetter – We received your appointment request';
    $body = notificationEmailWrapper(
        'Appointment Request Received',
        "<p>We've received your request for <strong>{$row['preferred_date']}</strong> at
           <strong>{$row['time_slot']}</strong>. We'll email you once it's been reviewed.</p>",
        null,
        ['label' => 'View', 'url' => APP_URL . '/public/pages/book-appointment.html']
    );

    sendAppMail($recipientEmail, clean($row['owner_name'] ?? ''), $subject, $body);
}

/**
 * Looks up everything notifyNewAppointmentRequest() needs from just the
 * appointment ID, then sends both notifications.
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

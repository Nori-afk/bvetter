<?php
/**
 * Shared by the 2026-09-25 time-limit dry run and apply. SELECTs only.
 */

require_once __DIR__ . '/../../api/includes/timed_rules.php';

/**
 * Pending appointments from before the time limits (no expires_at) whose
 * date and time are already in the past.
 */
function bv_stale_pending_appointments($pdo)
{
    // Adds expires_at/'expired' if the app hasn't yet. DDL, so before any
    // transaction the caller opens.
    if (!ensureTimedRulesSchema($pdo)) {
        fwrite(STDERR, "Could not add the time-limit columns. Run 2026-09-25-time-limits.sql by hand first.\n");
        exit(1);
    }

    $stmt = $pdo->prepare("
        SELECT appointments.id, appointments.preferred_date, appointments.time_slot,
               pets.pet_name, owners.full_name AS owner_name
        FROM appointments
        LEFT JOIN pets ON pets.id = appointments.pet_id
        LEFT JOIN users owners ON owners.id = appointments.owner_id
        WHERE appointments.status = 'pending'
          AND appointments.expires_at IS NULL
          AND TIMESTAMP(appointments.preferred_date, appointments.time_slot) <= :now
        ORDER BY appointments.preferred_date, appointments.time_slot
    ");
    $stmt->execute([':now' => date('Y-m-d H:i:s')]);
    return $stmt->fetchAll();
}

<?php
/**
 * BVetter – Veterinarian profile schema helpers
 *
 * is_bookable controls whether a veterinarian appears in the pet-owner-facing
 * "Book Appointment" vet list (see listVeterinarians() in
 * api/appointments/appointment.php). Assistant vets are typically created
 * with this off — they still get full vet-dashboard access (same role,
 * same permission checks everywhere else), they're just not a pickable
 * option when an owner books an appointment.
 */

function ensureVeterinarianBookableColumn(PDO $pdo): void
{
    $columnCheck = $pdo->query("SHOW COLUMNS FROM veterinarian_profiles LIKE 'is_bookable'")->fetch();
    if (!$columnCheck) {
        $pdo->exec("ALTER TABLE veterinarian_profiles ADD COLUMN is_bookable TINYINT(1) NOT NULL DEFAULT 1 AFTER employment_status");
    }
}

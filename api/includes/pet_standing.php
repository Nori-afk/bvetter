<?php
/**
 * The health badge a pet shows its owner (My Pets, Account Profile) and the
 * vet (Patient Records' Health Status tile).
 *
 * It used to come from a health_status text no vet could edit: it defaulted
 * to "Good Standing" and confirming a booking wrote it again, so a pet whose
 * owner had only just booked showed a green "Good Standing" before anyone had
 * examined it. The badge is now derived from what a vet actually recorded:
 *
 *   - Until a consultation is on file: "Awaiting Consultation" (neutral).
 *   - After one: the vet's Record Status on the pet --
 *       Active Patient -> Good Standing, Monitoring -> Under Monitoring,
 *       Critical -> Critical.
 *
 * A consultation is a saved visit record. A booking marked Completed with no
 * record written doesn't count -- the badge shouldn't claim an assessment
 * that was never documented -- and neither does a Vaccination-category
 * visit, because a shot is not a checkup.
 *
 * @param string $patientStatus  patient_record_profiles.patient_status
 * @param array  $visitCategories the pet's visit records' category values
 * @return array{label: string, type: string, consulted: bool}
 */
function petStanding($patientStatus, array $visitCategories)
{
    $consulted = false;
    foreach ($visitCategories as $category) {
        if (strcasecmp(trim((string) $category), 'Vaccination') !== 0) {
            $consulted = true;
            break;
        }
    }

    if (!$consulted) {
        return ['label' => 'Awaiting Consultation', 'type' => 'neutral', 'consulted' => false];
    }
    if ($patientStatus === 'Critical') {
        return ['label' => 'Critical', 'type' => 'danger', 'consulted' => true];
    }
    if ($patientStatus === 'Monitoring') {
        return ['label' => 'Under Monitoring', 'type' => 'warning', 'consulted' => true];
    }
    return ['label' => 'Good Standing', 'type' => 'success', 'consulted' => true];
}

<?php
/**
 * BVetter – shared helpers for the 2026-08-25 archived-record purge.
 *
 * Included by both the dry run and the apply script so the two can never
 * disagree about what "archived" means or what a purge touches.
 *
 * BACKGROUND. Deleting a patient record used to set
 * patient_record_profiles.is_archived = 1 rather than removing anything. That
 * hid the record from the vet's Patient Records list and from the owner's My
 * Pets, so it looked deleted -- but the rows were still in the database, and
 * every query that did not know about the flag went on counting them. The
 * Reports page was one such query; so are the four visit queries in
 * api/dashboard/dashboard.php that feed Disease Analytics.
 *
 * Deleting a patient record now purges it outright (see purgePets() in
 * api/patient-records/patient_records.php). That fixes it going forward but
 * does nothing about records archived before the change -- they are still
 * sitting there, invisible in the UI and therefore impossible to select and
 * delete through it. This pair of scripts clears that backlog.
 */

/** Pets flagged archived by the old soft-delete. */
function bv_archived_pet_ids($pdo)
{
    return array_map('intval', $pdo->query("
        SELECT pet_id FROM patient_record_profiles WHERE is_archived = 1 ORDER BY pet_id
    ")->fetchAll(PDO::FETCH_COLUMN));
}

/**
 * What each archived record is, and -- the part that actually matters -- how
 * many of its visits carry a diagnosis from the active `diseases` catalog.
 * Those are the ones being counted as real cases in Disease Analytics right
 * now. A visit with scratch text for a diagnosis was never counted (see the
 * catalog filter in api/reports/reports.php), so it is noise, not impact.
 */
function bv_archived_detail($pdo, array $petIds)
{
    if (!$petIds) return [];
    $in = implode(',', array_map('intval', $petIds));

    return $pdo->query("
        SELECT
            p.id,
            p.pet_name,
            u.full_name AS owner_name,
            u.email     AS owner_email,
            (SELECT COUNT(*) FROM patient_visit_records v WHERE v.pet_id = p.id) AS visits,
            (SELECT COUNT(*) FROM patient_visit_records v
              WHERE v.pet_id = p.id
                AND v.diagnosis IN (SELECT name FROM diseases WHERE is_active = 1)) AS counted_cases,
            (SELECT COUNT(*) FROM appointments a WHERE a.pet_id = p.id) AS appointments
        FROM pets p
        LEFT JOIN users u ON u.id = p.owner_id
        WHERE p.id IN ($in)
        ORDER BY p.id
    ")->fetchAll(PDO::FETCH_ASSOC);
}

/**
 * Rows that a purge would remove, per table. Read-only -- this is what the
 * dry run reports and what the apply script checks its own work against.
 */
function bv_purge_footprint($pdo, array $petIds)
{
    if (!$petIds) return [];
    $in = implode(',', array_map('intval', $petIds));

    $counts = [];
    foreach (bv_purge_tables() as $table) {
        $counts[$table] = (int) $pdo->query("SELECT COUNT(*) FROM {$table} WHERE pet_id IN ($in)")->fetchColumn();
    }
    $counts['pets'] = (int) $pdo->query("SELECT COUNT(*) FROM pets WHERE id IN ($in)")->fetchColumn();
    return $counts;
}

/**
 * Owner reviews that this purge would destroy as a side effect.
 *
 * reviews.appointment_id is ON DELETE CASCADE, so deleting an appointment
 * silently takes its review with it. Nothing in the purge mentions the reviews
 * table, and knowing the delete ORDER is not the same as knowing what cascades
 * behind it -- which is exactly how a review can disappear without ever
 * appearing in a plan or a backup.
 *
 * A review is also the strongest evidence a record is NOT scratch data: it
 * means a real pet owner attended a real appointment and rated it. So this is
 * not merely something to report, it is a reason to stop.
 */
function bv_reviews_at_risk($pdo, array $petIds)
{
    if (!$petIds || !bv_purge_table_exists($pdo, 'reviews')) return [];
    $in = implode(',', array_map('intval', $petIds));

    return $pdo->query("
        SELECT
            r.reviews_id,
            r.appointment_id,
            r.rating,
            r.comment,
            r.created_at,
            a.pet_id,
            p.pet_name,
            u.full_name AS owner_name
        FROM reviews r
        INNER JOIN appointments a ON a.id = r.appointment_id
        LEFT JOIN pets p  ON p.id = a.pet_id
        LEFT JOIN users u ON u.id = r.owner_id
        WHERE a.pet_id IN ($in)
        ORDER BY r.reviews_id
    ")->fetchAll(PDO::FETCH_ASSOC);
}

function bv_purge_table_exists($pdo, $table)
{
    $stmt = $pdo->prepare('
        SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t
    ');
    $stmt->execute([':t' => $table]);
    return (int) $stmt->fetchColumn() > 0;
}

/**
 * Child tables, in delete order.
 *
 * appointments.pet_id and csp_registrations.pet_id are ON DELETE NO ACTION, so
 * the pets row cannot go until they are cleared. The three patient_* tables
 * carry no foreign key at all, so nothing cascades on their behalf and
 * skipping them would leave orphaned rows behind. Same order as purgePets()
 * in api/patient-records/patient_records.php -- keep them in step.
 *
 * NOTE: deleting from `appointments` cascades into `reviews`. See
 * bv_reviews_at_risk() -- anything calling this must account for that.
 */
function bv_purge_tables()
{
    return [
        'patient_vaccination_records',
        'patient_visit_records',
        'patient_record_profiles',
        'appointments',
        'csp_registrations',
    ];
}

/**
 * Tables that can be left holding a pet_id pointing at a pet that no longer
 * exists. deleteUserAccount() in api/admin/account-management.php deletes the
 * pets row but never touches these -- they have no foreign key, so nothing
 * stops or cleans up after it -- and they accumulate invisibly.
 */
function bv_orphan_tables()
{
    return [
        'patient_record_profiles',
        'patient_vaccination_records',
        'patient_visit_records',
    ];
}

/**
 * Rows in $table whose pet_id references a pet that is gone.
 *
 * `pet_id IS NOT NULL` is the load-bearing part. A visit with pet_id NULL is
 * NOT an orphan -- it is a de-identified case, deliberately detached from its
 * pet so it survives the owner's account deletion and keeps counting for
 * disease surveillance. Dropping those would silently delete real cases, which
 * is the opposite of what this migration is for.
 */
function bv_orphan_count($pdo, $table)
{
    return (int) $pdo->query("
        SELECT COUNT(*)
        FROM {$table} x
        LEFT JOIN pets p ON p.id = x.pet_id
        WHERE x.pet_id IS NOT NULL AND p.id IS NULL
    ")->fetchColumn();
}

/** Every orphan count, keyed by table. */
function bv_orphan_summary($pdo)
{
    $out = [];
    foreach (bv_orphan_tables() as $table) {
        $out[$table] = bv_orphan_count($pdo, $table);
    }
    return $out;
}

<?php
/**
 * BVetter – backfill owner notification history.
 *
 * Pet owners never had notification rows: their feed was rebuilt in the
 * browser on every open from appointments, claims and lost/found reports.
 * Cutting over to real rows would leave every owner with an empty bell, so
 * this recreates their past notifications from those same source tables,
 * using the real historical timestamps.
 *
 * Every row is written READ. This is history, not news — nobody should log
 * in to a dot and a wall of months-old notifications.
 *
 * Run AFTER 2026-08-18-per-user-notifications.sql.
 *
 * Usage (from the project root):
 *   php database/migrations/2026-08-18-backfill-owner-notifications.php --dry-run
 *   php database/migrations/2026-08-18-backfill-owner-notifications.php
 *
 * Re-runnable. Each source row maps to a deterministic (user_id, type,
 * reference_id) triple, and anything already present is skipped, so running
 * it twice does not duplicate history.
 *
 * Unlike the migration's fan-out, this does NOT filter on account_status,
 * and the difference is deliberate. The fan-out copies broadcast staff
 * notices, so writing them to an account nobody can log into is pure waste.
 * This writes a person's own history back to them — if the account is
 * reactivated later, that history should still be there. Deleting a user
 * removes it either way (notifications.user_id cascades).
 */

require_once __DIR__ . '/../../api/config/connection.php';

$dryRun = in_array('--dry-run', $argv, true);

$columns = $pdo->query("SHOW COLUMNS FROM notifications LIKE 'user_id'")->fetchAll();
if (!$columns) {
    fwrite(STDERR, "notifications.user_id is missing — run 2026-08-18-per-user-notifications.sql first.\n");
    exit(1);
}

echo $dryRun
    ? "DRY RUN — nothing will be written.\n\n"
    : "Writing owner notification history.\n\n";

/**
 * Already present? Keyed on the triple that identifies a backfilled row, so
 * a second run is a no-op rather than a duplicate.
 */
$existsStmt = $pdo->prepare('
    SELECT 1 FROM notifications
    WHERE user_id = :user_id AND type = :type AND reference_id = :reference_id
    LIMIT 1
');

$insertStmt = $pdo->prepare('
    INSERT INTO notifications (user_id, type, title, message, reference_id, is_read, created_at)
    VALUES (:user_id, :type, :title, :message, :reference_id, 1, :created_at)
');

$written = 0;
$skipped = 0;

function record($existsStmt, $insertStmt, bool $dryRun, array $row, int &$written, int &$skipped): void
{
    $existsStmt->execute([
        ':user_id' => $row['user_id'],
        ':type' => $row['type'],
        ':reference_id' => $row['reference_id'],
    ]);
    if ($existsStmt->fetchColumn()) {
        $skipped++;
        return;
    }

    if (!$dryRun) {
        $insertStmt->execute([
            ':user_id' => $row['user_id'],
            ':type' => $row['type'],
            ':title' => $row['title'],
            ':message' => $row['message'],
            ':reference_id' => $row['reference_id'],
            ':created_at' => $row['created_at'],
        ]);
    }
    $written++;
}

/* ── Appointments ──────────────────────────────────────────────
   Only settled outcomes. A still-pending appointment has not produced an
   event worth remembering, and the owner will get a real notification when
   it is acted on. */
$appointments = $pdo->query("
    SELECT id, owner_id, status, preferred_date, time_slot, created_at, updated_at
    FROM appointments
    WHERE owner_id IS NOT NULL AND status IN ('confirmed', 'cancelled', 'rejected', 'completed')
")->fetchAll();

foreach ($appointments as $appointment) {
    $status = $appointment['status'];
    $title = $status === 'confirmed' ? 'Appointment Confirmed'
        : ($status === 'completed' ? 'Appointment Completed' : 'Appointment ' . ucfirst($status));

    record($existsStmt, $insertStmt, $dryRun, [
        'user_id' => (int) $appointment['owner_id'],
        'type' => 'appointment_status',
        'title' => $title,
        'message' => "Your appointment on {$appointment['preferred_date']} at {$appointment['time_slot']} was {$status}.",
        'reference_id' => (int) $appointment['id'],
        'created_at' => $appointment['updated_at'] ?: $appointment['created_at'],
    ], $written, $skipped);
}
printf("appointments      %d source rows\n", count($appointments));

/* ── Lost & found reports ──────────────────────────────────── */
$reports = $pdo->query("
    SELECT id, owner_id, status, report_type, pet_name, case_number, created_at, updated_at
    FROM lost_found_reports
    WHERE owner_id IS NOT NULL AND status IN ('active', 'rejected', 'resolved')
")->fetchAll();

foreach ($reports as $report) {
    $status = $report['status'];
    $label = $report['report_type'] === 'lost' ? 'lost pet' : 'found pet';
    $title = $status === 'active' ? 'Report Published'
        : ($status === 'rejected' ? 'Report Rejected' : 'Report Resolved');

    record($existsStmt, $insertStmt, $dryRun, [
        'user_id' => (int) $report['owner_id'],
        'type' => 'lost_found_report_status',
        'title' => $title,
        'message' => "Your {$label} report" . ($report['pet_name'] ? " for {$report['pet_name']}" : '')
            . " (case #{$report['case_number']}) is {$status}.",
        'reference_id' => (int) $report['id'],
        'created_at' => $report['updated_at'] ?: $report['created_at'],
    ], $written, $skipped);
}
printf("lost/found reports %d source rows\n", count($reports));

/* ── Claims ────────────────────────────────────────────────────
   Reviewed claims only, and only where the claimant has an account —
   an anonymous claimant has no feed to write to. */
$claims = $pdo->query("
    SELECT lost_found_claims.id, lost_found_claims.claimant_user_id, lost_found_claims.status,
           lost_found_claims.created_at, lost_found_claims.reviewed_at,
           lost_found_reports.case_number, lost_found_reports.pet_name
    FROM lost_found_claims
    INNER JOIN lost_found_reports ON lost_found_reports.id = lost_found_claims.report_id
    WHERE lost_found_claims.claimant_user_id IS NOT NULL
      AND lost_found_claims.status IN ('approved', 'rejected')
")->fetchAll();

foreach ($claims as $claim) {
    record($existsStmt, $insertStmt, $dryRun, [
        'user_id' => (int) $claim['claimant_user_id'],
        'type' => 'lost_found_claim_status',
        'title' => 'Claim ' . ucfirst($claim['status']),
        'message' => 'Your claim' . ($claim['pet_name'] ? " for {$claim['pet_name']}" : '')
            . " (case #{$claim['case_number']}) was {$claim['status']}.",
        'reference_id' => (int) $claim['id'],
        'created_at' => $claim['reviewed_at'] ?: $claim['created_at'],
    ], $written, $skipped);
}
printf("claims            %d source rows\n", count($claims));

printf("\n%s %d row(s)%s\n",
    $dryRun ? 'WOULD WRITE' : 'WROTE',
    $written,
    $skipped ? sprintf(', skipped %d already present', $skipped) : ''
);

if ($dryRun) {
    echo "\nRe-run without --dry-run to apply.\n";
}

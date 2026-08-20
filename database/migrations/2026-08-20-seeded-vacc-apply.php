<?php
/**
 * BVetter – remove the seeded 2023-2024 mass vaccination events.
 *
 * See 2026-08-20-seeded-vacc-dryrun.php for the evidence. In short: 79 rows
 * dated 2023-2024 share one `created_at` to the second, have no creator, and
 * correlate with neither the workbook's monthly series (0.348) nor the
 * barangay dog-population allocation weights (0.041). They are invented, and
 * the Historical Baseline view was presenting them as real campaign records.
 *
 * This script is SAFE TO RUN TWICE. It re-runs every dry-run check and refuses
 * to touch anything unless the seeded batch is cleanly separable; if the rows
 * are already gone it reports that and exits 0.
 *
 * REVERSIBLE: every targeted row is written to
 * database/backups/seeded-vaccination-events-<timestamp>.sql as a full INSERT
 * before the DELETE runs, and the DELETE itself is wrapped in a transaction.
 * To undo: feed that file back into the database.
 *
 * Usage (from the project root):
 *   php database/migrations/2026-08-20-seeded-vacc-apply.php
 */

require_once __DIR__ . '/../../api/config/connection.php';

const SEEDED_CREATED_AT = '2026-07-12 20:49:17';

function fail($message)
{
    echo "\nABORTED: {$message}\n";
    exit(1);
}

echo "BVetter - removing seeded 2023-2024 vaccination events\n";
echo "=====================================================\n";

if (!$pdo->query("SHOW TABLES LIKE 'mass_vaccination_events'")->fetch()) {
    echo "\nTable mass_vaccination_events does not exist here. Nothing to do.\n";
    exit(0);
}

/* ── Idempotency ─────────────────────────────────────────────────────── */
$count = $pdo->prepare("SELECT COUNT(*) FROM mass_vaccination_events
                        WHERE created_at = :ts AND YEAR(event_date) IN (2023, 2024)");
$count->execute([':ts' => SEEDED_CREATED_AT]);
$targeted = (int) $count->fetchColumn();

if ($targeted === 0) {
    echo "\nAlready applied: no rows match the seeded batch. Nothing to do.\n";
    $remaining = (int) $pdo->query("SELECT COUNT(*) FROM mass_vaccination_events")->fetchColumn();
    echo "mass_vaccination_events currently holds {$remaining} row(s).\n";
    exit(0);
}

/* ── Safety checks, repeated here so --apply can never run blind ─────── */
$q = $pdo->prepare("SELECT COUNT(*) FROM mass_vaccination_events
                    WHERE YEAR(event_date) IN (2023,2024) AND created_at <> :ts");
$q->execute([':ts' => SEEDED_CREATED_AT]);
if ((int) $q->fetchColumn() !== 0) {
    fail("this database has 2023/24 events OUTSIDE the seeded batch. They may be real - "
       . "run the dry run and inspect them before deleting anything.");
}

$q = $pdo->prepare("SELECT COUNT(*) FROM mass_vaccination_events
                    WHERE created_at = :ts AND YEAR(event_date) NOT IN (2023,2024)");
$q->execute([':ts' => SEEDED_CREATED_AT]);
if ((int) $q->fetchColumn() !== 0) {
    fail("the seeded timestamp also covers rows outside 2023/24. Not cleanly separable.");
}

$q = $pdo->prepare("SELECT COUNT(*) FROM mass_vaccination_events
                    WHERE created_at = :ts AND created_by_user_id IS NOT NULL");
$q->execute([':ts' => SEEDED_CREATED_AT]);
if ((int) $q->fetchColumn() !== 0) {
    fail("some targeted rows have a real created_by_user_id - they may be human-encoded.");
}

echo "\nChecks passed. {$targeted} seeded row(s) targeted.\n";

/* ── Backup before deleting ──────────────────────────────────────────── */
$rowsStmt = $pdo->prepare("SELECT * FROM mass_vaccination_events
                           WHERE created_at = :ts AND YEAR(event_date) IN (2023, 2024)
                           ORDER BY id");
$rowsStmt->execute([':ts' => SEEDED_CREATED_AT]);
$rows = $rowsStmt->fetchAll();

$backupDir = __DIR__ . '/../backups';
if (!is_dir($backupDir) && !mkdir($backupDir, 0775, true) && !is_dir($backupDir)) {
    fail("could not create {$backupDir} - refusing to delete without a backup.");
}
$backupFile = $backupDir . '/seeded-vaccination-events-' . date('Ymd-His') . '.sql';

$sql  = "-- BVetter: seeded 2023-2024 mass_vaccination_events removed "
      . date('Y-m-d H:i:s') . "\n";
$sql .= "-- Restore with:  mysql -u USER -p DBNAME < " . basename($backupFile) . "\n\n";
foreach ($rows as $row) {
    $cols = array_map(fn($c) => "`{$c}`", array_keys($row));
    $vals = array_map(fn($v) => $v === null ? 'NULL' : $pdo->quote((string) $v), array_values($row));
    $sql .= "INSERT INTO `mass_vaccination_events` (" . implode(', ', $cols) . ") VALUES ("
          . implode(', ', $vals) . ");\n";
}
if (file_put_contents($backupFile, $sql) === false) {
    fail("could not write {$backupFile} - refusing to delete without a backup.");
}
echo "Backup written: {$backupFile} (" . count($rows) . " row(s))\n";

/* ── Delete, in a transaction ────────────────────────────────────────── */
try {
    $pdo->beginTransaction();
    $del = $pdo->prepare("DELETE FROM mass_vaccination_events
                          WHERE created_at = :ts AND YEAR(event_date) IN (2023, 2024)");
    $del->execute([':ts' => SEEDED_CREATED_AT]);
    $deleted = $del->rowCount();

    if ($deleted !== $targeted) {
        $pdo->rollBack();
        fail("expected to delete {$targeted} row(s) but the statement affected {$deleted}. Rolled back.");
    }
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fail("delete failed and was rolled back: " . $e->getMessage());
}

/* ── Report ──────────────────────────────────────────────────────────── */
echo "\nDeleted {$deleted} seeded row(s).\n";
$after = $pdo->query("
    SELECT YEAR(event_date) AS y, COUNT(*) AS n,
           GROUP_CONCAT(DISTINCT status ORDER BY status) AS statuses
    FROM mass_vaccination_events GROUP BY y ORDER BY y
")->fetchAll();
echo "Remaining rows:\n";
if (!$after) {
    echo "  (table is now empty)\n";
} else {
    foreach ($after as $r) {
        printf("  %s: %d row(s)   status: %s\n", $r['y'], $r['n'], $r['statuses']);
    }
}
echo "\nThe workbook remains the authoritative source for 2023-2025 history.\n";
echo "Restart the analytics service so it re-reads the table:\n";
echo "  systemctl restart bvetter-analytics\n";

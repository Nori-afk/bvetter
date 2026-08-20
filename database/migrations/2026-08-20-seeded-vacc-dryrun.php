<?php
/**
 * BVetter – dry run for removing the seeded 2023-2024 mass vaccination events.
 *
 * 79 rows in `mass_vaccination_events` dated 2023-2024 were bulk-inserted by a
 * script, not encoded by anyone: they all share a single `created_at` value to
 * the second, carry no `created_by_user_id`, and their ids run ABOVE the 2026
 * rows -- so they were written after the beta test events, not as the campaigns
 * happened. They also reconcile with nothing. Against the workbook they total
 * 13,730 vs 7,965 (1.72x) with a monthly correlation of only 0.348, and against
 * Barangay_Masterlist's dog-population allocation_weight the correlation is
 * 0.041 -- i.e. they are not an allocation of the real data, they are invented.
 *
 * The workbook (BaliwagVet_2023-2025.xlsx) stays the authoritative source for
 * 2023-2025 history. `mass_vaccination_events` keeps only genuinely encoded
 * events, which is what the forecast's live layer appends going forward.
 *
 * This script writes NOTHING. Every statement below is a SELECT. Run it on
 * production first and read the numbers back before applying anything.
 *
 * Usage (from the project root):
 *   php database/migrations/2026-08-20-seeded-vacc-dryrun.php
 */

require_once __DIR__ . '/../../api/config/connection.php';

const SEEDED_CREATED_AT = '2026-07-12 20:49:17';

function heading($text)
{
    echo "\n" . $text . "\n" . str_repeat('-', strlen($text)) . "\n";
}

echo "BVetter - seeded vaccination events, DRY RUN (read-only)\n";
echo "========================================================\n";

$stmt = $pdo->query("SHOW TABLES LIKE 'mass_vaccination_events'");
if (!$stmt->fetch()) {
    echo "\n  Table mass_vaccination_events does not exist here. Nothing to do.\n";
    exit(0);
}

heading('1. Every distinct insertion batch in the table');
$rows = $pdo->query("
    SELECT created_at,
           IFNULL(created_by_user_id, 'NULL') AS creator,
           COUNT(*) AS n,
           MIN(YEAR(event_date)) AS year_from,
           MAX(YEAR(event_date)) AS year_to
    FROM mass_vaccination_events
    GROUP BY created_at, created_by_user_id
    ORDER BY created_at
")->fetchAll();
foreach ($rows as $r) {
    $flag = ((int) $r['n'] > 1) ? '  <-- bulk insert' : '';
    printf("  %-21s creator=%-5s n=%-4d years=%s-%s%s\n",
        $r['created_at'], $r['creator'], $r['n'], $r['year_from'], $r['year_to'], $flag);
}

heading('2. Rows TARGETED for deletion');
$target = $pdo->prepare("
    SELECT COUNT(*) AS n,
           MIN(event_date) AS first_event,
           MAX(event_date) AS last_event,
           COUNT(DISTINCT barangay) AS barangays,
           SUM(COALESCE(total_vaccinated, dogs_count + cats_count + others_count)) AS animals
    FROM mass_vaccination_events
    WHERE created_at = :ts AND YEAR(event_date) IN (2023, 2024)
");
$target->execute([':ts' => SEEDED_CREATED_AT]);
$t = $target->fetch();
printf("  matching created_at = '%s' AND event year IN (2023, 2024)\n", SEEDED_CREATED_AT);
printf("  rows=%d  barangays=%d  events %s .. %s  animals=%s\n",
    $t['n'], $t['barangays'], $t['first_event'], $t['last_event'], $t['animals']);

heading('3. Safety checks (all must pass)');
$checks = [];

$q = $pdo->prepare("SELECT COUNT(*) FROM mass_vaccination_events
                    WHERE YEAR(event_date) IN (2023,2024) AND created_at <> :ts");
$q->execute([':ts' => SEEDED_CREATED_AT]);
$strays = (int) $q->fetchColumn();
$checks[] = ["no 2023/24 row outside the seeded batch", $strays === 0, "found {$strays}"];

$q = $pdo->prepare("SELECT COUNT(*) FROM mass_vaccination_events
                    WHERE created_at = :ts AND YEAR(event_date) NOT IN (2023,2024)");
$q->execute([':ts' => SEEDED_CREATED_AT]);
$outside = (int) $q->fetchColumn();
$checks[] = ["no seeded row outside 2023/24", $outside === 0, "found {$outside}"];

$q = $pdo->prepare("SELECT COUNT(*) FROM mass_vaccination_events WHERE created_at = :ts
                    AND created_by_user_id IS NOT NULL");
$q->execute([':ts' => SEEDED_CREATED_AT]);
$attributed = (int) $q->fetchColumn();
$checks[] = ["no targeted row has a real creator", $attributed === 0, "found {$attributed}"];

foreach ($checks as [$label, $ok, $detail]) {
    printf("  [%s] %s%s\n", $ok ? 'PASS' : 'FAIL', $label, $ok ? '' : "  ({$detail})");
}

heading('4. What REMAINS after deletion');
$remain = $pdo->prepare("
    SELECT YEAR(event_date) AS y, COUNT(*) AS n,
           GROUP_CONCAT(DISTINCT status ORDER BY status) AS statuses
    FROM mass_vaccination_events
    WHERE NOT (created_at = :ts AND YEAR(event_date) IN (2023, 2024))
    GROUP BY y ORDER BY y
");
$remain->execute([':ts' => SEEDED_CREATED_AT]);
$kept = $remain->fetchAll();
if (!$kept) {
    echo "  (no rows would remain)\n";
} else {
    foreach ($kept as $r) {
        printf("  %s: %d row(s)   status: %s\n", $r['y'], $r['n'], $r['statuses']);
    }
}

$allPassed = array_reduce($checks, fn($carry, $c) => $carry && $c[1], true);
echo "\n" . ($allPassed
    ? "All checks passed. Safe to run 2026-08-20-seeded-vacc-apply.php\n"
    : "CHECKS FAILED - do NOT apply. The seeded batch is not cleanly separable here.\n");

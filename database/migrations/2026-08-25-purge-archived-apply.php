<?php
/**
 * BVetter – applies the 2026-08-25 archived-record purge.
 *
 * Permanently deletes the patient records left behind by the old soft-delete,
 * along with their visits, vaccinations, profile rows and appointments.
 *
 * THIS CANNOT BE UNDONE. Run the dry run first and read its list:
 *   php database/migrations/2026-08-25-purge-archived-dryrun.php
 *
 * Usage (from the project root):
 *   php database/migrations/2026-08-25-purge-archived-apply.php --confirm
 *
 * Take a database backup before running this on production. Everything here
 * runs inside one transaction, so a failure rolls back cleanly -- but a
 * successful run that deleted something you wanted is not recoverable without
 * that backup.
 *
 * Owner accounts are deliberately NOT touched. Purging scratch clinical data
 * and deleting a person's account are different decisions; the dry run lists
 * which owners end up with no pets so they can be reviewed in Account
 * Management afterwards.
 */

require_once __DIR__ . '/../../api/config/connection.php';
require_once __DIR__ . '/2026-08-25-purge-archived-lib.php';

$confirm = in_array('--confirm', $argv, true);

if (!$confirm) {
    fwrite(STDERR, "Refusing to run without --confirm. This permanently deletes data.\n");
    fwrite(STDERR, "Read the dry run first:\n");
    fwrite(STDERR, "  php database/migrations/2026-08-25-purge-archived-dryrun.php\n");
    fwrite(STDERR, "Then:\n");
    fwrite(STDERR, "  php database/migrations/2026-08-25-purge-archived-apply.php --confirm\n");
    exit(1);
}

function heading($text)
{
    echo "\n" . $text . "\n" . str_repeat('-', strlen($text)) . "\n";
}

$petIds  = bv_archived_pet_ids($pdo);
$orphans = bv_orphan_summary($pdo);

if (!$petIds && array_sum($orphans) === 0) {
    echo "Nothing to purge. No archived records and no orphaned rows.\n";
    exit(0);
}

/* ── Refuse to cascade away owner reviews ──────────────────────────────
 *
 * reviews.appointment_id is ON DELETE CASCADE. Deleting an appointment takes
 * its review with it, permanently, without mentioning it anywhere. Worse, a
 * review is evidence the record is real: a pet owner attended an appointment
 * and rated it. Scratch data does not collect owner feedback.
 *
 * So this stops rather than warns. --i-know-this-deletes-reviews is deliberately
 * awkward to type: it should only ever be used after reading the dry run and
 * deciding those specific reviews are disposable.
 */
$reviewsAtRisk = bv_reviews_at_risk($pdo, $petIds);
$overrideReviews = in_array('--i-know-this-deletes-reviews', $argv, true);

if ($reviewsAtRisk && !$overrideReviews) {
    fwrite(STDERR, "\nREFUSING TO RUN.\n\n");
    fwrite(STDERR, sprintf("%d owner review(s) are attached to appointments this purge would delete.\n", count($reviewsAtRisk)));
    fwrite(STDERR, "reviews.appointment_id is ON DELETE CASCADE, so they would be destroyed with\n");
    fwrite(STDERR, "no way to get them back.\n\n");

    foreach ($reviewsAtRisk as $r) {
        fwrite(STDERR, sprintf(
            "  review #%s on appointment #%s (pet: %s) -- %s/5 \"%s\"\n",
            $r['reviews_id'],
            $r['appointment_id'],
            $r['pet_name'] ?: '(gone)',
            $r['rating'],
            substr((string) $r['comment'], 0, 60)
        ));
    }

    fwrite(STDERR, "\nA review means a real pet owner rated a real appointment, so these records\n");
    fwrite(STDERR, "are probably NOT scratch data. Check them before deleting anything.\n\n");
    fwrite(STDERR, "If they really are disposable, re-run with:\n");
    fwrite(STDERR, "  php database/migrations/2026-08-25-purge-archived-apply.php --confirm --i-know-this-deletes-reviews\n\n");
    exit(1);
}

heading('Before');
foreach (bv_purge_footprint($pdo, $petIds) as $table => $count) {
    printf("  %-32s %5d\n", $table, $count);
}
foreach ($orphans as $table => $count) {
    printf("  orphaned %-23s %5d\n", $table, $count);
}

// Recorded before the delete so the check afterwards can prove the purge did
// not touch them. These are real cases with no pet by design.
$deidentifiedBefore = (int) $pdo->query("SELECT COUNT(*) FROM patient_visit_records WHERE pet_id IS NULL")->fetchColumn();
printf("  %-32s %5d  (must not change)\n", 'de-identified visits', $deidentifiedBefore);

// Only reachable via the override. Printed in full so the run's own output is
// a record of what was destroyed -- the cascade leaves nothing behind to check
// afterwards, so if it is not written down here it is simply gone.
if ($reviewsAtRisk) {
    heading('Owner reviews being destroyed by cascade (--i-know-this-deletes-reviews)');
    foreach ($reviewsAtRisk as $r) {
        printf(
            "  review #%s | appointment #%s | pet %s | owner %s | %s/5 | %s | \"%s\"\n",
            $r['reviews_id'],
            $r['appointment_id'],
            $r['pet_name'] ?: '(gone)',
            $r['owner_name'] ?: '(gone)',
            $r['rating'],
            $r['created_at'],
            (string) $r['comment']
        );
    }
    echo "\n  Copy this block somewhere before continuing. It cannot be recovered.\n";
}

$pdo->beginTransaction();

try {
    if ($petIds) {
        $in = implode(',', array_map('intval', $petIds));

        // Children first: the two FK'd tables block the pets delete, and the
        // three patient_* tables have no FK to cascade on their behalf.
        foreach (bv_purge_tables() as $table) {
            $pdo->exec("DELETE FROM {$table} WHERE pet_id IN ($in)");
        }
        $pdo->exec("DELETE FROM pets WHERE id IN ($in)");
    }

    // Rows pointing at a pet that is already gone. The pet_id IS NOT NULL
    // guard keeps de-identified visits out of this -- they have no pet on
    // purpose and are real surveillance cases.
    foreach (bv_orphan_tables() as $table) {
        $pdo->exec("
            DELETE x FROM {$table} x
            LEFT JOIN pets p ON p.id = x.pet_id
            WHERE x.pet_id IS NOT NULL AND p.id IS NULL
        ");
    }

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "\nFAILED, rolled back. Nothing was deleted.\n");
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}

heading('After');

$remaining      = bv_archived_pet_ids($pdo);
$stillOrphaned  = array_sum(bv_orphan_summary($pdo));
$deidentifiedAfter = (int) $pdo->query("SELECT COUNT(*) FROM patient_visit_records WHERE pet_id IS NULL")->fetchColumn();

printf("  archived records remaining     %5d  (expect 0)\n", count($remaining));
printf("  orphaned rows remaining        %5d  (expect 0)\n", $stillOrphaned);
printf("  de-identified visits           %5d  (expect %d, unchanged)\n", $deidentifiedAfter, $deidentifiedBefore);

$leftovers = 0;
if ($petIds) {
    $in = implode(',', array_map('intval', $petIds));
    foreach (bv_purge_tables() as $table) {
        $n = (int) $pdo->query("SELECT COUNT(*) FROM {$table} WHERE pet_id IN ($in)")->fetchColumn();
        $leftovers += $n;
        printf("  %-30s %5d  (expect 0)\n", $table, $n);
    }
    $n = (int) $pdo->query("SELECT COUNT(*) FROM pets WHERE id IN ($in)")->fetchColumn();
    $leftovers += $n;
    printf("  %-30s %5d  (expect 0)\n", 'pets', $n);
}

echo "\n";

// Losing a de-identified visit would mean the purge ate a real case. That is
// the one failure worth shouting about even though everything else passed.
if ($deidentifiedAfter !== $deidentifiedBefore) {
    fwrite(STDERR, sprintf(
        "STOP: de-identified visits went from %d to %d. Real surveillance cases were deleted.\n"
        . "Restore from your backup before doing anything else.\n\n",
        $deidentifiedBefore,
        $deidentifiedAfter
    ));
    exit(1);
}

if (count($remaining) === 0 && $stillOrphaned === 0 && $leftovers === 0) {
    echo "Purge complete. Reports and Disease Analytics now see only live records.\n\n";
} else {
    fwrite(STDERR, "Purge ran but something remains -- investigate before assuming it worked.\n\n");
    exit(1);
}

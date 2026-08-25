<?php
/**
 * BVetter – dry run for the 2026-08-25 archived-record purge.
 *
 * Lists every patient record left behind by the old soft-delete, and shows
 * exactly what deleting them would remove. It writes nothing: every statement
 * in this file and in the shared lib is a SELECT.
 *
 * Usage (from the project root):
 *   php database/migrations/2026-08-25-purge-archived-dryrun.php
 *
 * RUN THIS ON PRODUCTION FIRST AND READ THE LIST. These records are invisible
 * in the app, so this report is the only way to see what is actually there
 * before anything is deleted -- and the delete is permanent. Check the
 * "counted" column in particular: those are visits currently being counted as
 * real disease cases. If a row in this list looks like a genuine patient
 * rather than scratch data, stop and sort that out before running the apply.
 */

require_once __DIR__ . '/../../api/config/connection.php';
require_once __DIR__ . '/2026-08-25-purge-archived-lib.php';

function heading($text)
{
    echo "\n" . $text . "\n" . str_repeat('-', strlen($text)) . "\n";
}

$petIds = bv_archived_pet_ids($pdo);

heading('Archived patient records');

if (!$petIds) {
    echo "  None. There is no backlog to purge on this database.\n";
} else {
    printf("  %-5s %-22s %-26s %6s %8s %6s\n", 'id', 'pet', 'owner', 'visits', 'counted', 'appts');
    printf("  %-5s %-22s %-26s %6s %8s %6s\n", '-----', str_repeat('-', 22), str_repeat('-', 26), '------', '--------', '------');

    $totalCounted = 0;
    foreach (bv_archived_detail($pdo, $petIds) as $row) {
        $totalCounted += (int) $row['counted_cases'];
        printf(
            "  %-5s %-22s %-26s %6s %8s %6s\n",
            $row['id'],
            substr((string) $row['pet_name'], 0, 22),
            substr((string) ($row['owner_name'] ?: '(no owner row)'), 0, 26),
            $row['visits'],
            $row['counted_cases'],
            $row['appointments']
        );
    }

    echo "\n  'counted' = visits with a diagnosis from the active diseases catalog.\n";
    echo "  Those are the ones Disease Analytics is counting as real cases today.\n";
    printf("  Total currently inflating the case counts: %d\n", $totalCounted);
}

heading('Rows the purge would delete');

$footprint = bv_purge_footprint($pdo, $petIds);
if (!$footprint) {
    echo "  Nothing.\n";
} else {
    foreach ($footprint as $table => $count) {
        printf("  %-32s %5d\n", $table, $count);
    }
}

heading('Owner reviews that would be DESTROYED');

$reviews = bv_reviews_at_risk($pdo, $petIds);
if (!$reviews) {
    echo "  None. No archived record has an owner review attached.\n";
} else {
    foreach ($reviews as $r) {
        printf(
            "  review #%-4s appointment #%-5s pet %-18s %s/5  \"%s\"\n",
            $r['reviews_id'],
            $r['appointment_id'],
            substr((string) ($r['pet_name'] ?: '(gone)'), 0, 18),
            $r['rating'],
            substr((string) $r['comment'], 0, 40)
        );
    }
    echo "\n  reviews.appointment_id is ON DELETE CASCADE, so deleting these\n";
    echo "  appointments deletes the reviews with them. They are NOT recoverable.\n";
    echo "\n  A review means a real pet owner attended and rated a real appointment.\n";
    echo "  That is strong evidence these records are NOT scratch data. The apply\n";
    echo "  script will refuse to run while any of them exist.\n";
}

heading('Orphaned rows (pet_id points at a pet that no longer exists)');

$orphanSummary = bv_orphan_summary($pdo);
foreach ($orphanSummary as $table => $count) {
    printf("  %-32s %5d\n", $table, $count);
}
if (array_sum($orphanSummary) > 0) {
    echo "\n  Left behind by account deletions, which remove the pets row but not these.\n";
    echo "  They reference nothing and would also be cleaned up.\n";
}

// Stated explicitly because it is the one thing in this area that must NOT be
// deleted, and the count makes it obvious if a run ever started eating them.
$deidentified = (int) $pdo->query("SELECT COUNT(*) FROM patient_visit_records WHERE pet_id IS NULL")->fetchColumn();
printf("\n  de-identified visits (pet_id NULL): %d  <- PRESERVED, these are real cases\n", $deidentified);

heading('Owner accounts left behind');

// Purging a pet does not remove its owner. Where the owner has no other pet,
// the account is left with nothing attached -- worth reviewing in Account
// Management afterwards, but deliberately NOT deleted here: an account is a
// person, and removing one is a different decision from removing scratch
// clinical data.
if ($petIds) {
    $in = implode(',', array_map('intval', $petIds));
    $rows = $pdo->query("
        SELECT u.id, u.full_name, u.email,
               (SELECT COUNT(*) FROM pets p2 WHERE p2.owner_id = u.id AND p2.id NOT IN ($in)) AS other_pets
        FROM users u
        WHERE u.id IN (SELECT owner_id FROM pets WHERE id IN ($in))
        ORDER BY u.id
    ")->fetchAll(PDO::FETCH_ASSOC);

    foreach ($rows as $row) {
        printf(
            "  id=%-5s %-28s %-34s %s\n",
            $row['id'],
            substr((string) $row['full_name'], 0, 28),
            substr((string) $row['email'], 0, 34),
            ((int) $row['other_pets'] === 0) ? '<- would have no pets left' : "keeps {$row['other_pets']} other pet(s)"
        );
    }
    if (!$rows) echo "  None.\n";
} else {
    echo "  None.\n";
}

echo "\nNothing was changed. To apply:\n";
echo "  php database/migrations/2026-08-25-purge-archived-apply.php --confirm\n\n";

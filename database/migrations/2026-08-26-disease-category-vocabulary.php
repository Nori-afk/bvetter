<?php
/**
 * BVetter — 2026-08-26: move patient_visit_records.disease_category from the
 * five-value bucket vocabulary to Consult_Diagnosis_3Y's ten-value vocabulary.
 *
 * WHY. deriveDiseaseCategory() used to write `diseases.bucket_category`, which
 * collapses 18 of the 42 catalogued diagnoses into 'General/Other' -- including
 * both reportable ones, Rabies (Suspected) and Leptospirosis. A live rabies case
 * was stored under the same label as a dental case, so the most action-worthy
 * signal in the system was invisible in live data.
 *
 * The buckets existed only to build skin_ratio/para_ratio/resp_ratio/gastro_ratio
 * for a classifier trained on Barangay_Disease_Monthly. That sheet is no longer
 * read, and load_db_disease_monthly() -- the only code that matched on the bucket
 * strings -- is dead. Nothing needs the narrow vocabulary any more.
 *
 * WHAT IT DOES. Re-derives disease_category from the diagnosis via
 * diseases.display_category. Rows whose diagnosis is not in the catalog (free
 * text entered through "Other / Not Listed") are left at 'General/Other', which
 * is the honest answer -- an unrecognised diagnosis has no known category.
 *
 * USAGE
 *   php database/migrations/2026-08-26-disease-category-vocabulary.php            # dry run
 *   php database/migrations/2026-08-26-disease-category-vocabulary.php --apply    # write
 */

$root = dirname(__DIR__, 2);
require $root . '/api/config/connection.php';

$apply = in_array('--apply', $argv, true);
echo $apply ? "APPLY MODE — changes will be written\n\n" : "DRY RUN — nothing will be written (pass --apply to commit)\n\n";

$rows = $pdo->query("
    SELECT pvr.id, pvr.diagnosis, pvr.disease_category AS current_category,
           d.display_category AS new_category
    FROM patient_visit_records pvr
    LEFT JOIN diseases d ON d.name = pvr.diagnosis AND d.is_active = 1
    ORDER BY pvr.id
")->fetchAll();

if (!$rows) {
    echo "No visit records found. Nothing to do.\n";
    exit(0);
}

$changes = [];
$uncatalogued = 0;
foreach ($rows as $row) {
    $target = trim((string) ($row['new_category'] ?? ''));
    if ($target === '') {
        // Diagnosis not in the catalog: leave it alone rather than guessing.
        $uncatalogued += 1;
        continue;
    }
    if ($target !== $row['current_category']) {
        $changes[] = ['id' => (int) $row['id'], 'diagnosis' => $row['diagnosis'],
                      'from' => $row['current_category'], 'to' => $target];
    }
}

printf("visit records scanned : %d\n", count($rows));
printf("diagnosis not in catalog (left as-is) : %d\n", $uncatalogued);
printf("records to re-categorise : %d\n\n", count($changes));

foreach ($changes as $c) {
    printf("  #%-5d %-28s %-18s -> %s\n", $c['id'], substr($c['diagnosis'], 0, 28), $c['from'], $c['to']);
}

if (!$changes) {
    echo "\nNothing to change.\n";
    exit(0);
}

if (!$apply) {
    echo "\nDry run complete. Re-run with --apply to write these changes.\n";
    exit(0);
}

$pdo->beginTransaction();
try {
    $stmt = $pdo->prepare("UPDATE patient_visit_records SET disease_category = :c WHERE id = :id");
    foreach ($changes as $c) {
        $stmt->execute([':c' => $c['to'], ':id' => $c['id']]);
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "FAILED, rolled back: " . $e->getMessage() . "\n");
    exit(1);
}

printf("\nApplied %d change(s).\n\n", count($changes));
echo "Resulting distribution:\n";
foreach ($pdo->query("SELECT disease_category, COUNT(*) n FROM patient_visit_records
                      GROUP BY disease_category ORDER BY n DESC")->fetchAll() as $r) {
    printf("  %-32s %d\n", $r['disease_category'], $r['n']);
}

<?php
/**
 * BVetter – applies 2026-08-19-barangay-required.sql.
 *
 * Uses the app's own database connection, so there are no credentials to type
 * and no chance of running it against the wrong database.
 *
 * Usage (from the project root):
 *   php database/migrations/2026-08-19-apply.php --part=1
 *   php database/migrations/2026-08-19-apply.php --part=2
 *
 * PART 1 (schema) is safe before or after the code deploy -- the new code
 * hard-requires a barangay and never writes NULL, so it runs correctly against
 * either schema. PART 2 (data cleanup) must run AFTER the deploy, or the old
 * code will keep stamping the default onto new rows behind you.
 *
 * Read 2026-08-19-barangay-dryrun.php first. PART 2 applies exactly the
 * verdicts that script prints; --dry re-prints them without writing.
 *
 * Safe to re-run: PART 1 checks the schema and skips what is already applied;
 * PART 2 only touches rows still sitting on the default.
 */

require_once __DIR__ . '/../../api/config/connection.php';

$part = null;
$dry  = false;
foreach ($argv as $arg) {
    if (strpos($arg, '--part=') === 0) $part = substr($arg, 7);
    if ($arg === '--dry') $dry = true;
}

if (!in_array($part, array('1', '2'), true)) {
    fwrite(STDERR, "Usage: php database/migrations/2026-08-19-apply.php --part=1|2 [--dry]\n");
    exit(1);
}

function hasColumn(PDO $pdo, $table, $column)
{
    return (bool) $pdo->query("SHOW COLUMNS FROM {$table} LIKE " . $pdo->quote($column))->fetch();
}

function isNullable(PDO $pdo, $table, $column)
{
    $row = $pdo->query("SHOW COLUMNS FROM {$table} LIKE " . $pdo->quote($column))->fetch();
    return $row && strtoupper($row['Null']) === 'YES';
}

/* ================================================================ PART 1 == */

if ($part === '1') {
    $did = false;

    if (isNullable($pdo, 'owner_profiles', 'barangay_id')) {
        echo "skip:  owner_profiles.barangay_id is already NULL-able\n";
    } else {
        $pdo->exec('ALTER TABLE owner_profiles MODIFY barangay_id INT NULL');
        echo "done:  owner_profiles.barangay_id is now NULL-able\n";
        $did = true;
    }

    if (hasColumn($pdo, 'owner_profiles', 'is_outside_baliwag')) {
        echo "skip:  owner_profiles.is_outside_baliwag already exists\n";
    } else {
        $pdo->exec('ALTER TABLE owner_profiles ADD COLUMN is_outside_baliwag TINYINT(1) NOT NULL DEFAULT 0 AFTER barangay_id');
        echo "done:  owner_profiles.is_outside_baliwag added\n";
        $did = true;
    }

    echo $did ? "\nPART 1 applied. Deploy the code, then run --part=2.\n"
              : "\nPART 1 was already applied. Nothing changed.\n";
    exit(0);
}

/* ================================================================ PART 2 == */

if (!isNullable($pdo, 'owner_profiles', 'barangay_id')) {
    fwrite(STDERR, "PART 1 has not been applied -- barangay_id is still NOT NULL.\n");
    fwrite(STDERR, "Run --part=1 first, or the cleanup cannot write NULL.\n");
    exit(1);
}

$defaultId   = (int) $pdo->query('SELECT id FROM barangays ORDER BY id ASC LIMIT 1')->fetchColumn();
$defaultRow  = $pdo->query('SELECT name FROM barangays ORDER BY id ASC LIMIT 1')->fetch();
$defaultName = $defaultRow ? (string) $defaultRow['name'] : '';

/* Longest name first so a short name cannot shadow a longer match. */
$names = $pdo->query('SELECT id, name FROM barangays ORDER BY CHAR_LENGTH(name) DESC')->fetchAll();

function matchBarangay($address, $names)
{
    $addr = strtolower(trim((string) $address));
    if ($addr === '') return null;
    foreach ($names as $n) {
        $lower = strtolower(trim($n['name']));
        if ($lower !== '' && strpos($addr, $lower) !== false) return $n;
    }
    return null;
}

$stmt = $pdo->prepare("
    SELECT u.id, u.full_name, op.complete_address
    FROM owner_profiles op
    JOIN users u ON u.id = op.user_id
    WHERE op.barangay_id = :id
    ORDER BY u.id
");
$stmt->execute(array(':id' => $defaultId));
$suspects = $stmt->fetchAll();

$plan = array();
foreach ($suspects as $s) {
    $match = matchBarangay($s['complete_address'], $names);
    if ($match && strcasecmp($match['name'], $defaultName) !== 0) {
        $plan[] = array('user_id' => (int) $s['id'], 'to' => (int) $match['id'], 'label' => $match['name'], 'name' => $s['full_name']);
    } elseif (!$match) {
        $plan[] = array('user_id' => (int) $s['id'], 'to' => null, 'label' => 'NULL (unknown)', 'name' => $s['full_name']);
    }
    /* A match equal to the default is left alone: probably genuinely there. */
}

echo "Owners on the default barangay ('{$defaultName}', id {$defaultId}): " . count($suspects) . "\n";
echo "Rows this run will change: " . count($plan) . "\n\n";
foreach ($plan as $p) {
    printf("  user %-5d %-26s -> %s\n", $p['user_id'], substr((string) $p['name'], 0, 26), $p['label']);
}

if ($dry) {
    echo "\n--dry: nothing was written.\n";
    exit(0);
}

if (!$plan) {
    echo "\nNothing to change.\n";
    exit(0);
}

$pdo->beginTransaction();

$updProfile = $pdo->prepare('UPDATE owner_profiles SET barangay_id = :b WHERE user_id = :u');

/*
 * Visits are corrected only where the owner's barangay was corrected, and only
 * where the visit still carries the default. barangay_at_visit is deliberately
 * a frozen snapshot -- it is not resynced wholesale, because a later profile
 * change is usually a house move, not a correction. Here we know it was a
 * correction, because the value being replaced is the one the code invented.
 */
$updVisits = $pdo->prepare("
    UPDATE patient_visit_records
    SET barangay_at_visit = :label
    WHERE owner_id = :u AND barangay_at_visit = :old
");
$nullVisits = $pdo->prepare("
    UPDATE patient_visit_records
    SET barangay_at_visit = NULL
    WHERE owner_id = :u AND barangay_at_visit = :old
");

$profilesChanged = 0;
$visitsChanged   = 0;

foreach ($plan as $p) {
    $updProfile->execute(array(':b' => $p['to'], ':u' => $p['user_id']));
    $profilesChanged += $updProfile->rowCount();

    if ($p['to'] === null) {
        $nullVisits->execute(array(':u' => $p['user_id'], ':old' => $defaultName));
        $visitsChanged += $nullVisits->rowCount();
    } else {
        $updVisits->execute(array(':label' => $p['label'], ':u' => $p['user_id'], ':old' => $defaultName));
        $visitsChanged += $updVisits->rowCount();
    }
}

$pdo->commit();

echo "\nowner_profiles rows updated:        {$profilesChanged}\n";
echo "patient_visit_records rows updated: {$visitsChanged}\n";
echo "\nPART 2 applied. Re-run the dry-run script to confirm the new distribution.\n";

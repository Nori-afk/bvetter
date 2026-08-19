<?php
/**
 * BVetter – dry run for the barangay-default fix.
 *
 * api/patient-records/patient_records.php was the only owner-creation path
 * that did not require a barangay: defaultBarangayId() returned the lowest id
 * in `barangays` and stamped it on every owner the vet portal created. That id
 * is 3 = Tiaong, so an owner whose address said "San Roque" was still filed
 * under Tiaong, and visitSnapshot() then froze Tiaong onto the visit row --
 * which is what the Disease Incidence Report and Disease Analytics read.
 *
 * This script reports how far that spread on THIS database. It writes nothing:
 * every statement is a SELECT.
 *
 * Usage (from the project root):
 *   php database/migrations/2026-08-19-barangay-dryrun.php
 *
 * Run it on production before applying anything, and read the numbers back.
 */

require_once __DIR__ . '/../../api/config/connection.php';

function heading($text)
{
    echo "\n" . $text . "\n" . str_repeat('-', strlen($text)) . "\n";
}

function tableOut($rows, $headers)
{
    if (!$rows) {
        echo "  (none)\n";
        return;
    }
    $widths = array();
    foreach ($headers as $i => $h) {
        $widths[$i] = strlen($h);
        foreach ($rows as $r) {
            $vals = array_values($r);
            $widths[$i] = max($widths[$i], strlen((string) $vals[$i]));
        }
    }
    $line = '  ';
    foreach ($headers as $i => $h) {
        $line .= str_pad($h, $widths[$i] + 2);
    }
    $line = rtrim($line);
    echo $line . "\n  " . str_repeat('-', max(1, strlen($line) - 2)) . "\n";
    foreach ($rows as $r) {
        $out = '  ';
        foreach (array_values($r) as $i => $v) {
            $out .= str_pad((string) $v, $widths[$i] + 2);
        }
        echo rtrim($out) . "\n";
    }
}

function shorten($value, $width)
{
    $value = (string) $value;
    return strlen($value) > $width ? substr($value, 0, $width - 2) . '..' : $value;
}

/* ------------------------------------------------------------- schema --- */

heading('Schema');

$col = $pdo->query("SHOW COLUMNS FROM owner_profiles LIKE 'barangay_id'")->fetch();
$nullable = $col && strtoupper($col['Null']) === 'YES';
printf(
    "owner_profiles.barangay_id:  %s  %s\n",
    isset($col['Type']) ? $col['Type'] : '?',
    $nullable ? 'NULL allowed' : 'NOT NULL  <-- part=1 relaxes this'
);

$defaultId  = (int) $pdo->query('SELECT id FROM barangays ORDER BY id ASC LIMIT 1')->fetchColumn();
$defaultRow = $pdo->query('SELECT name, city, province FROM barangays ORDER BY id ASC LIMIT 1')->fetch();
$brgyCount  = (int) $pdo->query('SELECT COUNT(*) FROM barangays')->fetchColumn();
$defaultName = $defaultRow ? (string) $defaultRow['name'] : '';

printf("barangays rows:              %d\n", $brgyCount);
printf(
    "defaultBarangayId() returns: id=%d  %s, %s, %s  <-- the value being stamped\n",
    $defaultId,
    $defaultName,
    $defaultRow ? $defaultRow['city'] : '?',
    $defaultRow ? $defaultRow['province'] : '?'
);

/* ------------------------------------------- owners on the default id --- */

heading("Owner profiles sitting on the default barangay (id {$defaultId})");

$stmt = $pdo->prepare("
    SELECT u.id, u.full_name, u.email, op.complete_address
    FROM owner_profiles op
    JOIN users u ON u.id = op.user_id
    WHERE op.barangay_id = :id
    ORDER BY u.id
");
$stmt->execute(array(':id' => $defaultId));
$suspects = $stmt->fetchAll();

/*
 * The free-text address is the only signal that survives -- it is exactly what
 * a human spots by eye when they compare the owner panel against the table.
 * Longest name first so "San Jose" cannot shadow a longer match.
 */
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

$recoverable = array();
$ambiguous   = array();
$agrees      = array();

foreach ($suspects as $s) {
    $match = matchBarangay($s['complete_address'], $names);
    $row = array(
        'user_id' => $s['id'],
        'name'    => shorten($s['full_name'], 24),
        'address' => trim((string) $s['complete_address']) === '' ? '(blank)' : shorten($s['complete_address'], 28),
        'verdict' => '',
    );
    if ($match && strcasecmp($match['name'], $defaultName) !== 0) {
        $row['verdict'] = 'FIX -> ' . $match['name'] . ' (id ' . $match['id'] . ')';
        $recoverable[] = $row;
    } elseif ($match) {
        $row['verdict'] = 'agrees with default';
        $agrees[] = $row;
    } else {
        $row['verdict'] = 'NULL (not recoverable)';
        $ambiguous[] = $row;
    }
}

printf("total on default:   %d\n\n", count($suspects));
echo "Address names a DIFFERENT barangay -- defaulted, and recoverable:\n";
tableOut($recoverable, array('user_id', 'name', 'address', 'verdict'));
echo "\nAddress is blank or unmatchable -- unknowable:\n";
tableOut($ambiguous, array('user_id', 'name', 'address', 'verdict'));
echo "\nAddress agrees with the default -- probably genuinely there, leave alone:\n";
tableOut($agrees, array('user_id', 'name', 'address', 'verdict'));

/* --------------------------------------------------------- visit rows --- */

heading("Visit rows stamped '{$defaultName}'");

$stmt = $pdo->prepare("
    SELECT pvr.id, pvr.visit_date, pvr.diagnosis,
           COALESCE(u.full_name, '(de-identified)') AS owner,
           COALESCE(op.complete_address, '') AS addr
    FROM patient_visit_records pvr
    LEFT JOIN users u ON u.id = pvr.owner_id
    LEFT JOIN owner_profiles op ON op.user_id = pvr.owner_id
    WHERE pvr.barangay_at_visit = :name
    ORDER BY pvr.visit_date
");
$stmt->execute(array(':name' => $defaultName));

$visitRows = array();
foreach ($stmt->fetchAll() as $r) {
    $match = matchBarangay($r['addr'], $names);
    $visitRows[] = array(
        'visit_id'  => $r['id'],
        'date'      => $r['visit_date'],
        'owner'     => shorten($r['owner'], 22),
        'address'   => trim((string) $r['addr']) === '' ? '(blank)' : shorten($r['addr'], 24),
        'diagnosis' => shorten($r['diagnosis'], 18),
        'verdict'   => ($match && strcasecmp($match['name'], $defaultName) !== 0)
            ? 'FIX -> ' . $match['name']
            : ($match ? 'agrees' : 'NULL'),
    );
}
tableOut($visitRows, array('visit_id', 'date', 'owner', 'address', 'diagnosis', 'verdict'));

/* ------------------------------- free text leaked into the snapshot ----- */

heading('barangay_at_visit values that are NOT real barangay names');
echo "(these came from the complete_address fallback; after the fix they read as Unspecified)\n\n";

/*
 * The set difference is done in PHP, not SQL. barangays.name is
 * utf8mb4_unicode_ci while barangay_at_visit is utf8mb4_0900_ai_ci, so
 * comparing them in SQL raises error 1267 (illegal mix of collations), and
 * naming a collation explicitly would not survive a MariaDB host.
 */
$catalog = array();
foreach ($names as $n) $catalog[strtolower(trim($n['name']))] = true;

$observed = $pdo->query("
    SELECT pvr.barangay_at_visit AS value, COUNT(*) AS rows_affected
    FROM patient_visit_records pvr
    WHERE pvr.barangay_at_visit IS NOT NULL
      AND pvr.barangay_at_visit <> ''
    GROUP BY pvr.barangay_at_visit
    ORDER BY rows_affected DESC
")->fetchAll();

$leak = array();
foreach ($observed as $o) {
    if (!isset($catalog[strtolower(trim($o['value']))])) {
        $leak[] = array('value' => shorten($o['value'], 40), 'rows_affected' => $o['rows_affected']);
    }
}
tableOut($leak, array('value', 'rows_affected'));

/* ---------------------------------------------------- surveillance ------ */

heading('Disease Incidence Report -- barangay distribution as it stands today');

$dist = $pdo->query("
    SELECT COALESCE(NULLIF(pvr.barangay_at_visit, ''), 'Unspecified') AS barangay,
           COUNT(*) AS cases
    FROM patient_visit_records pvr
    WHERE pvr.visit_date IS NOT NULL
      AND pvr.diagnosis IN (SELECT name FROM diseases WHERE is_active = 1)
    GROUP BY barangay
    ORDER BY cases DESC, barangay
")->fetchAll();
tableOut($dist, array('barangay', 'cases'));

$coverage = $pdo->query('SELECT complete_through_year, complete_through_month FROM disease_data_coverage WHERE id = 1')->fetch();
$declared = $coverage && $coverage['complete_through_year'];
printf(
    "\ncoverage declared:  %s\n",
    $declared
        ? sprintf(
            '%04d-%02d  <-- zero-fill IS active; empty barangay-months read as real zeros',
            $coverage['complete_through_year'],
            $coverage['complete_through_month']
        )
        : 'none  (zero-fill not active yet)'
);

/* ------------------------------------------------------------ summary --- */

heading('Summary');
printf("owners to re-point to a real barangay:  %d\n", count($recoverable));
printf("owners to set NULL (unknowable):        %d\n", count($ambiguous));
printf("owners to leave alone:                  %d\n", count($agrees));
printf("visit rows stamped '%s': %d\n", $defaultName, count($visitRows));
$leakTotal = 0;
foreach ($leak as $l) $leakTotal += (int) $l['rows_affected'];
printf("visit rows holding free-text junk:      %d\n", $leakTotal);
echo "\nNothing was written. Run --part=1 only after reading the above.\n";

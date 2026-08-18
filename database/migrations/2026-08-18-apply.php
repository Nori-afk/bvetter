<?php
/**
 * BVetter – applies 2026-08-18-per-user-notifications.sql.
 *
 * Uses the app's own database connection, so there are no credentials to
 * type and no chance of running it against the wrong database.
 *
 * Usage (from the project root):
 *   php database/migrations/2026-08-18-apply.php --part=1
 *   php database/migrations/2026-08-18-apply.php --part=2
 *   php database/migrations/2026-08-18-apply.php --part=all
 *
 * PART 1 goes before the code deploy, PART 2 after — see the header of the
 * .sql file for why. Use --part=all only when the new code is ALREADY
 * deployed, which collapses the window to nothing because no old code is
 * left running to write through the old schema.
 *
 * Safe to re-run: each part checks the schema first and refuses if it has
 * already been applied, rather than failing halfway through on a duplicate
 * column.
 */

require_once __DIR__ . '/../../api/config/connection.php';

$part = null;
foreach ($argv as $arg) {
    if (strpos($arg, '--part=') === 0) $part = substr($arg, 7);
}

if (!in_array($part, ['1', '2', 'all'], true)) {
    fwrite(STDERR, "Usage: php database/migrations/2026-08-18-apply.php --part=1|2|all\n");
    exit(1);
}

function hasColumn(PDO $pdo, string $column): bool
{
    return (bool) $pdo->query("SHOW COLUMNS FROM notifications LIKE " . $pdo->quote($column))->fetch();
}

/**
 * Splits the .sql file on the PART 2 banner and strips comment lines, so the
 * SQL itself stays the single source of truth rather than being duplicated
 * into this script.
 */
function statementsFor(string $sqlPath, string $part): array
{
    $sql = file_get_contents($sqlPath);
    $marker = '-- PART 2 -- run AFTER the code is deployed';
    $pos = strpos($sql, $marker);
    if ($pos === false) {
        fwrite(STDERR, "Could not find the PART 2 marker in the .sql file.\n");
        exit(1);
    }

    $section = $part === '1' ? substr($sql, 0, $pos) : substr($sql, $pos);
    $section = preg_replace('/^\s*--.*$/m', '', $section);

    return array_values(array_filter(array_map('trim', explode(';', $section))));
}

function runPart(PDO $pdo, string $sqlPath, string $part): void
{
    if ($part === '1' && hasColumn($pdo, 'user_id')) {
        echo "PART 1 already applied (notifications.user_id exists) — skipping.\n";
        return;
    }
    if ($part === '2' && !hasColumn($pdo, 'audience')) {
        echo "PART 2 already applied (notifications.audience is gone) — skipping.\n";
        return;
    }
    if ($part === '2' && !hasColumn($pdo, 'user_id')) {
        fwrite(STDERR, "PART 1 has not been applied yet — run --part=1 first.\n");
        exit(1);
    }

    echo "\n=== PART {$part} ===\n";
    foreach (statementsFor($sqlPath, $part) as $statement) {
        $label = substr(preg_replace('/\s+/', ' ', $statement), 0, 68);
        try {
            $affected = $pdo->exec($statement);
            printf("OK    %s%s\n", $label, is_int($affected) && $affected > 0 ? "  ({$affected} rows)" : '');
        } catch (PDOException $e) {
            printf("FAIL  %s\n      %s\n", $label, $e->getMessage());
            fwrite(STDERR, "\nStopped. The database is part-way through this part — restore from your backup before retrying.\n");
            exit(1);
        }
    }
}

$sqlPath = __DIR__ . '/2026-08-18-per-user-notifications.sql';

$before = (int) $pdo->query('SELECT COUNT(*) FROM notifications')->fetchColumn();
printf("notifications rows before: %d\n", $before);

foreach ($part === 'all' ? ['1', '2'] : [$part] as $each) {
    runPart($pdo, $sqlPath, $each);
}

printf("\nnotifications rows after:  %d\n", (int) $pdo->query('SELECT COUNT(*) FROM notifications')->fetchColumn());

$orphans = (int) $pdo->query('SELECT COUNT(*) FROM notifications WHERE user_id IS NULL')->fetchColumn();
printf("rows with no recipient:    %d%s\n", $orphans, $orphans ? '  <-- unexpected' : '');

echo "\nPer recipient:\n";
foreach ($pdo->query("
    SELECT roles.name AS role, COUNT(DISTINCT notifications.user_id) AS people, COUNT(*) AS total
    FROM notifications
    INNER JOIN users ON users.id = notifications.user_id
    INNER JOIN roles ON roles.id = users.role_id
    GROUP BY roles.name ORDER BY roles.name
") as $row) {
    printf("  %-14s %d people, %d rows\n", $row['role'], $row['people'], $row['total']);
}

if (!hasColumn($pdo, 'audience')) {
    echo "\nDone. Next: php database/migrations/2026-08-18-backfill-owner-notifications.php --dry-run\n";
} else {
    echo "\nPART 1 done. Deploy the code, then run --part=2.\n";
}

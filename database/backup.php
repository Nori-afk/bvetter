<?php
/**
 * BVetter -- local database backup (CLI only)
 *
 * Usage: php database/backup.php [--keep=14]
 *
 * Dumps every table via the app's own PDO connection (api/config/connection.php)
 * instead of shelling out to mysqldump.exe -- this XAMPP install's bundled
 * mysqldump is MariaDB 10.4's client, which doesn't ship the
 * caching_sha2_password auth plugin the server (or PHP's own mysqlnd
 * driver) negotiates by default, so the external binary can't connect even
 * though the app connects fine. Reusing $pdo sidesteps that entirely.
 *
 * Scope: this is a local/demo backup-restore pair for the XAMPP dev copy,
 * not the production deployment -- that instance needs its own backup
 * setup on its own host, with its own access, handled separately.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only.');
}

require_once __DIR__ . '/../api/config/connection.php';

$keep = 14;
foreach ($argv as $arg) {
    if (preg_match('/^--keep=(\d+)$/', $arg, $m)) {
        $keep = (int) $m[1];
    }
}

$backupDir = __DIR__ . '/backups';
if (!is_dir($backupDir)) {
    mkdir($backupDir, 0755, true);
}

$timestamp = date('Ymd_His');
$outFile   = $backupDir . "/bvetter_{$timestamp}.sql";

$tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);

$fh = fopen($outFile, 'w');
if ($fh === false) {
    fwrite(STDERR, "Could not open $outFile for writing.\n");
    exit(1);
}

fwrite($fh, "-- BVetter backup -- " . DB_NAME . " -- generated " . date('c') . "\n");
fwrite($fh, "SET NAMES utf8mb4;\n");
fwrite($fh, "SET FOREIGN_KEY_CHECKS=0;\n\n");

foreach ($tables as $table) {
    echo "Dumping $table ...\n";

    $createRow = $pdo->query('SHOW CREATE TABLE `' . $table . '`')->fetch(PDO::FETCH_ASSOC);
    $createSql = $createRow['Create Table'] ?? null;
    if ($createSql === null) {
        fwrite(STDERR, "  Skipped $table -- could not read its CREATE TABLE statement.\n");
        continue;
    }

    fwrite($fh, "--\n-- Table: $table\n--\n");
    fwrite($fh, "DROP TABLE IF EXISTS `$table`;\n");
    fwrite($fh, $createSql . ";\n\n");

    $rowCount = 0;
    $stmt = $pdo->query('SELECT * FROM `' . $table . '`');
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $columns = array_map(fn($col) => '`' . $col . '`', array_keys($row));
        $values = array_map(function ($value) use ($pdo) {
            return $value === null ? 'NULL' : $pdo->quote((string) $value);
        }, array_values($row));

        fwrite($fh, 'INSERT INTO `' . $table . '` (' . implode(', ', $columns) . ') VALUES ('
            . implode(', ', $values) . ");\n");
        $rowCount++;
    }

    fwrite($fh, "\n");
    echo "  $rowCount row(s)\n";
}

fwrite($fh, "SET FOREIGN_KEY_CHECKS=1;\n");
fclose($fh);

$sizeKb = round(filesize($outFile) / 1024, 1);
echo "Backup complete: $outFile ({$sizeKb} KB)\n";

// Prune old backups beyond --keep
$backups = glob($backupDir . '/bvetter_*.sql');
rsort($backups); // newest first (timestamp is lexically sortable)
foreach (array_slice($backups, $keep) as $old) {
    unlink($old);
    echo 'Pruned old backup: ' . basename($old) . "\n";
}

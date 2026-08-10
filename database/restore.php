<?php
/**
 * BVetter -- local database restore (CLI only)
 *
 * Usage: php database/restore.php --file=database/backups/bvetter_20260810_184219.sql
 *
 * Destructive: overwrites tables in the configured database (DB_NAME from
 * api/config/connection.php) with the contents of the given dump. Requires
 * typing the database name back as confirmation.
 *
 * Statements are split on ";\n" (every statement backup.php writes ends
 * that way). This is a plain-text split, not a real SQL parser -- a text
 * value containing the literal sequence ";\n" would break it. Acceptable
 * for this dev-copy backup/restore pair; not a general-purpose SQL loader.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only.');
}

require_once __DIR__ . '/../api/config/connection.php';

$file = null;
foreach ($argv as $arg) {
    if (preg_match('/^--file=(.+)$/', $arg, $m)) {
        $file = $m[1];
    }
}

if ($file === null) {
    fwrite(STDERR, "Usage: php database/restore.php --file=path/to/backup.sql\n");
    exit(1);
}
if (!is_file($file)) {
    fwrite(STDERR, "Backup file not found: $file\n");
    exit(1);
}

echo "This will OVERWRITE every table in database '" . DB_NAME . "' with:\n  $file\n\n";
echo 'Type the database name (' . DB_NAME . ") to confirm: ";
$answer = trim(fgets(STDIN));

if ($answer !== DB_NAME) {
    echo "Confirmation did not match -- aborted, nothing was changed.\n";
    exit(1);
}

$sql = file_get_contents($file);
$statements = array_filter(array_map('trim', explode(";\n", $sql)));

$count = 0;
foreach ($statements as $statement) {
    if ($statement === '' || str_starts_with($statement, '--')) {
        continue;
    }
    try {
        $pdo->exec($statement);
        $count++;
    } catch (PDOException $e) {
        fwrite(STDERR, "Failed on statement #$count:\n" . substr($statement, 0, 200) . "\n\n");
        fwrite(STDERR, 'Error: ' . $e->getMessage() . "\n");
        exit(1);
    }
}

echo "Restore complete: $count statement(s) executed.\n";

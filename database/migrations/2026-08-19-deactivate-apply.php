<?php
/**
 * BVetter – applies 2026-08-19-deactivate-reason.sql.
 *
 * Uses the app's own database connection, so there are no credentials to type
 * and no chance of running it against the wrong database.
 *
 * Usage (from the project root):
 *   php database/migrations/2026-08-19-deactivate-apply.php
 *   php database/migrations/2026-08-19-deactivate-apply.php --dry
 *
 * Safe to re-run: it inspects the column first and skips if 'user_request' is
 * already an allowed value, rather than failing on a redundant ALTER.
 */

require_once __DIR__ . '/../../api/config/connection.php';

$dry = in_array('--dry', array_slice($argv, 1), true);

$column = $pdo->query("SHOW COLUMNS FROM users LIKE 'blocked_reason'")->fetch();
if (!$column) {
    fwrite(STDERR, "users.blocked_reason does not exist -- wrong database?\n");
    exit(1);
}

echo "Current definition: {$column['Type']}\n";

if (strpos($column['Type'], 'user_request') !== false) {
    echo "Already applied -- 'user_request' is present. Nothing to do.\n";
    exit(0);
}

$sql = "ALTER TABLE users
        MODIFY blocked_reason ENUM('failed_login', 'inactivity', 'user_request') NULL DEFAULT NULL";

if ($dry) {
    echo "\n--dry: would run\n  " . preg_replace('/\s+/', ' ', $sql) . "\n";
    echo "\nNo rows are rewritten by this change -- widening an enum leaves every\n";
    echo "existing value untouched. Current distribution:\n";
} else {
    $pdo->exec($sql);
    echo "\nApplied. New definition: "
        . $pdo->query("SHOW COLUMNS FROM users LIKE 'blocked_reason'")->fetch()['Type'] . "\n";
    echo "\nExisting rows are unaffected. Distribution:\n";
}

$rows = $pdo->query("
    SELECT account_status, COALESCE(blocked_reason, '(none)') AS reason, COUNT(*) AS n
    FROM users
    GROUP BY account_status, blocked_reason
    ORDER BY account_status, reason
");
foreach ($rows as $r) {
    printf("  %-10s %-14s %s\n", $r['account_status'], $r['reason'], $r['n']);
}

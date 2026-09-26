<?php
/**
 * BVetter – applies the 2026-09-25 time-limit cleanup.
 *
 * Moves the stale pending requests listed by the dry run to Expired, quietly
 * (no email, no notification). Read the dry run first:
 *   php database/migrations/2026-09-25-time-limits-dryrun.php
 *
 * Usage (from the project root):
 *   php database/migrations/2026-09-25-time-limits-apply.php --confirm
 *
 * Reversible: an expired row can be set back to 'pending' by hand, since
 * nothing else about it changes.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only.');
}

require_once __DIR__ . '/../../api/config/connection.php';
require_once __DIR__ . '/2026-09-25-time-limits-lib.php';

if (!in_array('--confirm', $argv, true)) {
    fwrite(STDERR, "Refusing to run without --confirm. Read the dry run first:\n");
    fwrite(STDERR, "  php database/migrations/2026-09-25-time-limits-dryrun.php\n");
    exit(1);
}

$rows = bv_stale_pending_appointments($pdo);
if (!$rows) {
    echo "Nothing to clean up.\n";
    exit(0);
}

$pdo->beginTransaction();
$update = $pdo->prepare("
    UPDATE appointments
    SET status = 'expired'
    WHERE id = :id AND status = 'pending' AND expires_at IS NULL
");
$done = 0;
foreach ($rows as $row) {
    $update->execute([':id' => $row['id']]);
    $done += $update->rowCount();
}
$pdo->commit();

echo "Expired {$done} stale pending request(s). No one was emailed.\n";

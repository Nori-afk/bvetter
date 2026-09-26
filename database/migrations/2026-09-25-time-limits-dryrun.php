<?php
/**
 * BVetter – dry run for the 2026-09-25 time-limit cleanup.
 *
 * Lists the pending appointment requests made before the time limits existed
 * whose date and time have already passed. Nobody confirmed them, the time is
 * gone, and each still holds its slot now that pending requests do. The apply
 * script moves them to Expired -- quietly: no email, no notification, because
 * these owners were never told there was a limit, and many of these rows are
 * test bookings.
 *
 * It writes nothing.
 *
 * Usage (from the project root):
 *   php database/migrations/2026-09-25-time-limits-dryrun.php
 *
 * Pending requests from before the change whose time is still ahead are left
 * alone: they stay with the vets to confirm or decline, as before.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only.');
}

require_once __DIR__ . '/../../api/config/connection.php';
require_once __DIR__ . '/2026-09-25-time-limits-lib.php';

$rows = bv_stale_pending_appointments($pdo);

echo "\nPending requests whose time has passed (would become Expired, no email)\n";
echo str_repeat('-', 72) . "\n";

if (!$rows) {
    echo "  None. Nothing to clean up on this database.\n\n";
    exit(0);
}

printf("  %-5s %-11s %-6s %-20s %-20s\n", 'id', 'date', 'time', 'pet', 'owner');
foreach ($rows as $row) {
    printf(
        "  %-5s %-11s %-6s %-20s %-20s\n",
        $row['id'],
        $row['preferred_date'],
        $row['time_slot'],
        substr((string) $row['pet_name'], 0, 20),
        substr((string) $row['owner_name'], 0, 20)
    );
}

echo "\n  " . count($rows) . " request(s). To apply:\n";
echo "  php database/migrations/2026-09-25-time-limits-apply.php --confirm\n\n";

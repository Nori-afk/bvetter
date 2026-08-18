<?php
/**
 * BVetter – dry run for the per-user notifications migration.
 *
 * Reports exactly what 2026-08-18-per-user-notifications.sql would create and
 * delete, and what the owner backfill would add. Writes nothing: every
 * statement here is a SELECT.
 *
 * Usage (from the project root):
 *   php database/migrations/2026-08-18-notifications-dryrun.php
 *
 * Run this before the migration, and read the numbers back before applying it
 * to a live database.
 */

require_once __DIR__ . '/../../api/config/connection.php';

function heading(string $text): void
{
    echo "\n" . $text . "\n" . str_repeat('-', strlen($text)) . "\n";
}

function alreadyMigrated(PDO $pdo): bool
{
    $columns = $pdo->query("SHOW COLUMNS FROM notifications LIKE 'user_id'")->fetchAll();
    return count($columns) > 0;
}

$migrated = alreadyMigrated($pdo);

heading('Current state');
$total = (int) $pdo->query('SELECT COUNT(*) FROM notifications')->fetchColumn();
printf("notifications rows:        %d\n", $total);
printf("schema:                    %s\n", $migrated ? 'ALREADY per-user (user_id present)' : 'broadcast (audience-based)');

if ($migrated) {
    $orphans = (int) $pdo->query('SELECT COUNT(*) FROM notifications WHERE user_id IS NULL')->fetchColumn();
    printf("rows with no recipient:    %d%s\n", $orphans, $orphans ? '  <-- unexpected' : '');
    heading('Nothing to do');
    echo "The migration has already been applied. Run the owner backfill\n";
    echo "separately if owner history is still missing.\n";
    exit(0);
}

heading('Recipients the fan-out will target');
$recipients = $pdo->query("
    SELECT roles.name AS role_name, COUNT(*) AS total
    FROM users
    INNER JOIN roles ON roles.id = users.role_id
    WHERE users.account_status = 'active'
    GROUP BY roles.name
    ORDER BY roles.name
")->fetchAll();
foreach ($recipients as $row) {
    printf("%-16s %d active\n", $row['role_name'], $row['total']);
}

heading('Rows to be created (one per recipient per broadcast row)');
$fanout = $pdo->query("
    SELECT notifications.audience, COUNT(*) AS rows_created
    FROM notifications
    INNER JOIN users ON users.account_status = 'active'
    INNER JOIN roles ON roles.id = users.role_id
    WHERE (
            (notifications.audience = 'admin' AND roles.name = 'admin')
         OR (notifications.audience = 'vet'   AND roles.name = 'veterinarian')
         OR (notifications.audience = 'both'  AND roles.name IN ('admin', 'veterinarian'))
          )
    GROUP BY notifications.audience
")->fetchAll();

$created = 0;
foreach ($fanout as $row) {
    printf("audience=%-6s -> %d rows\n", $row['audience'], $row['rows_created']);
    $created += (int) $row['rows_created'];
}
printf("\nTOTAL created:             %d (all marked read)\n", $created);
printf("TOTAL deleted:             %d (the broadcast originals)\n", $total);
printf("Net table size after:      %d rows\n", $created);

$unreachable = (int) $pdo->query("
    SELECT COUNT(*) FROM notifications
    WHERE id NOT IN (
        SELECT notifications.id
        FROM notifications
        INNER JOIN users ON users.account_status = 'active'
        INNER JOIN roles ON roles.id = users.role_id
        WHERE (
                (notifications.audience = 'admin' AND roles.name = 'admin')
             OR (notifications.audience = 'vet'   AND roles.name = 'veterinarian')
             OR (notifications.audience = 'both'  AND roles.name IN ('admin', 'veterinarian'))
              )
    )
")->fetchColumn();
if ($unreachable > 0) {
    printf("\nNOTE: %d row(s) have an audience with no active user and will be\n", $unreachable);
    echo "dropped without a replacement. That is expected if a role currently\n";
    echo "has no active accounts -- check the recipient counts above.\n";
}

heading('Owner history the backfill would add');
$owner = [
    'appointments' => 'SELECT COUNT(*) FROM appointments WHERE owner_id IS NOT NULL',
    'lost/found reports' => 'SELECT COUNT(*) FROM lost_found_reports WHERE owner_id IS NOT NULL',
];
foreach ($owner as $label => $sql) {
    try {
        printf("%-22s %d source rows\n", $label, (int) $pdo->query($sql)->fetchColumn());
    } catch (PDOException $e) {
        printf("%-22s (could not count: %s)\n", $label, $e->getMessage());
    }
}
echo "\nThe backfill script reports its own exact totals and is re-runnable.\n";

heading('Reminder');
echo "Take a verified backup before applying the migration. It deletes the\n";
echo "broadcast rows and drops the `audience` column, so it cannot be undone\n";
echo "in place.\n";

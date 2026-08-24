<?php
/**
 * BVetter – dry run for the 2026-08-24 timezone correction.
 *
 * The admin dashboard's Recent Activity feed was showing wrong "N days ago"
 * values. The cause is not the feed: formatRelativeTime() in
 * admin/js/index.js compares a bare server timestamp string against the
 * BROWSER's clock, parsing it as browser-local time. Any gap between the
 * server's zone and the viewer's silently shifts every rendered date.
 *
 * api/config/connection.php now pins PHP and MySQL to Philippine time. That
 * fixes all 61 `timestamp` columns by itself. This script reports what is
 * left: the `datetime` columns, which store a literal string and do not
 * follow a session-zone change.
 *
 * It writes nothing. Every statement is a SELECT.
 *
 * Usage (from the project root):
 *   php database/migrations/2026-08-24-timezone-dryrun.php
 *
 * RUN THIS ON PRODUCTION FIRST AND READ THE SHIFT BACK. It is the only
 * evidence of what production's clock actually is. If it reports a shift of
 * zero, production was never skewed, the apply script has nothing to do, and
 * the wrong dates have a different cause worth investigating before changing
 * any data.
 */

require_once __DIR__ . '/../../api/config/connection.php';
require_once __DIR__ . '/2026-08-24-timezone-columns.php';

function heading($text)
{
    echo "\n" . $text . "\n" . str_repeat('-', strlen($text)) . "\n";
}

/* ── What clock is this server actually on? ─────────────────────────── */

$sys   = bv_tz_system_offset_seconds($pdo);
$shift = BV_TZ_TARGET_OFFSET_SECONDS - $sys['seconds'];

heading('Clocks');
printf("  PHP timezone         : %s\n", date_default_timezone_get());
printf("  PHP now              : %s\n", date('Y-m-d H:i:s'));
printf("  MySQL system zone    : %s (%s from UTC)\n", $sys['name'], $sys['raw']);
printf("  MySQL session zone   : %s\n", $pdo->query('SELECT @@session.time_zone')->fetchColumn());
printf("  MySQL now (session)  : %s\n", $pdo->query('SELECT NOW()')->fetchColumn());
printf("  Pinning everything to: %s\n", defined('BV_TIMEZONE') ? BV_TIMEZONE : 'Asia/Manila');

heading('Required shift for `datetime` columns');
printf("  %s\n", bv_tz_format_shift($shift));

if ($shift === 0) {
    echo "\n  This server's clock already matches the target offset, so every\n";
    echo "  datetime literal already reads correctly. The apply script will\n";
    echo "  refuse to run and there is nothing to change here.\n";
    echo "\n  If dates still look wrong to a real user after the code deploy,\n";
    echo "  the cause is NOT the database -- check the viewer's own device\n";
    echo "  clock and timezone before touching any data.\n";
}

/* ── Has it already been applied? ───────────────────────────────────── */

heading('Migration marker');
$hasLog = $pdo->query("
    SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bv_migration_log'
")->fetchColumn();

if (!$hasLog) {
    echo "  bv_migration_log does not exist yet -- this has never been applied.\n";
} else {
    $stmt = $pdo->prepare('SELECT applied_at, notes FROM bv_migration_log WHERE migration = :k');
    $stmt->execute(array(':k' => BV_TZ_MIGRATION_KEY));
    $row = $stmt->fetch();
    if ($row) {
        echo "  ALREADY APPLIED on {$row['applied_at']}\n";
        echo "  {$row['notes']}\n";
        echo "  The apply script will refuse to run again. Do not force it:\n";
        echo "  a second pass would shift every value a second time.\n";
    } else {
        echo "  bv_migration_log exists but holds no row for " . BV_TZ_MIGRATION_KEY . ".\n";
    }
}

/* ── What rows would move? ──────────────────────────────────────────── */

heading('Columns that WOULD be shifted (user-visible datetimes)');
printf("  %-32s %-26s %10s  %s\n", 'TABLE', 'COLUMN', 'ROWS', 'OLDEST -> NEWEST');
echo '  ' . str_repeat('-', 104) . "\n";

$totalRows = 0;
$missing   = array();

foreach (bv_tz_display_columns() as $col) {
    list($table, $column) = $col;

    $type = bv_tz_column_exists($pdo, $table, $column);
    if (!$type) {
        $missing[] = "{$table}.{$column}";
        continue;
    }
    if (strtolower($type) !== 'datetime') {
        // A `timestamp` here would already be handled by the session zone;
        // shifting it too would double-correct it.
        printf("  %-32s %-26s %10s  SKIPPED - is `%s`, not `datetime`\n", $table, $column, '-', $type);
        continue;
    }

    $row = $pdo->query("
        SELECT COUNT(`{$column}`) AS n, MIN(`{$column}`) AS lo, MAX(`{$column}`) AS hi
        FROM `{$table}`
    ")->fetch();

    $n = (int) $row['n'];
    $totalRows += $n;

    printf("  %-32s %-26s %10d  %s\n",
        $table, $column, $n,
        $n ? ($row['lo'] . ' -> ' . $row['hi']) : '(all NULL)');
}

printf("\n  %d non-NULL values across %d columns would move by %s\n",
    $totalRows, count(bv_tz_display_columns()), bv_tz_format_shift($shift));

if ($missing) {
    echo "\n  Not present on this database (skipped harmlessly):\n";
    foreach ($missing as $m) {
        echo "    - {$m}\n";
    }
}

/* ── A worked example, so the direction is checkable by eye ─────────── */

heading('Worked example');
$sample = $pdo->query("
    SELECT full_name, last_login_at
    FROM users
    WHERE last_login_at IS NOT NULL
    ORDER BY last_login_at DESC
    LIMIT 3
")->fetchAll();

if (!$sample) {
    echo "  (no users.last_login_at values to show)\n";
} else {
    printf("  %-30s %-21s %s\n", 'USER', 'STORED NOW', 'WOULD BECOME');
    echo '  ' . str_repeat('-', 76) . "\n";
    foreach ($sample as $s) {
        printf("  %-30s %-21s %s\n",
            substr((string) $s['full_name'], 0, 29),
            $s['last_login_at'],
            date('Y-m-d H:i:s', strtotime((string) $s['last_login_at']) + $shift));
    }
}

/* ── What is deliberately left alone ────────────────────────────────── */

heading('Columns deliberately NOT shifted (short-lived auth tokens)');
foreach (bv_tz_skipped_columns() as $col) {
    list($table, $column) = $col;
    echo "  - {$table}.{$column}\n";
}
echo "\n  These expire in minutes. Rewriting live token windows is risk for no\n";
echo "  visible gain, so they are left to expire on their own.\n";

heading('Next step');
if ($shift === 0) {
    echo "  Nothing to apply on this database.\n";
} else {
    echo "  1. Back up the database.\n";
    echo "  2. Deploy the code (api/config/connection.php and the JS changes).\n";
    echo "  3. php database/migrations/2026-08-24-timezone-apply.php --confirm\n";
    echo "\n  The apply script re-derives this same shift the same way, so it stays\n";
    echo "  correct whether it runs before or after the code deploy.\n";
}
echo "\n";

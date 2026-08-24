<?php
/**
 * BVetter – applies the 2026-08-24 timezone correction.
 *
 * Shifts the user-visible `datetime` columns so they read correctly once
 * api/config/connection.php has pinned PHP and MySQL to Philippine time.
 * `timestamp` columns are not touched: MySQL stores those as UTC and
 * converts them on read, so they follow the pin on their own, and shifting
 * them here would double-correct them.
 *
 * Read 2026-08-24-timezone-dryrun.php first and check the shift it reports.
 *
 * Usage (from the project root):
 *   php database/migrations/2026-08-24-timezone-apply.php --confirm
 *   php database/migrations/2026-08-24-timezone-apply.php --dry
 *
 * ── The one thing that must not go wrong ──────────────────────────────
 * The shift is derived by asking MySQL for `time_zone = 'SYSTEM'` and
 * measuring TIMEDIFF(NOW(), UTC_TIMESTAMP()) against it -- NOT off the
 * pinned session. Measuring the pinned session would return +08:00 on any
 * host, compute a shift of zero, and leave the data untouched while
 * printing success. Because it reads the host clock instead, this script is
 * correct whether it runs before or after the code deploy.
 *
 * ── Re-running ────────────────────────────────────────────────────────
 * It records itself in `bv_migration_log` and refuses to run twice. A second
 * pass would shift every value again. There is deliberately no --force.
 */

require_once __DIR__ . '/../../api/config/connection.php';
require_once __DIR__ . '/2026-08-24-timezone-columns.php';

$confirm = in_array('--confirm', $argv, true);
$dry     = in_array('--dry', $argv, true);

if (!$confirm && !$dry) {
    fwrite(STDERR, "Usage: php database/migrations/2026-08-24-timezone-apply.php --confirm | --dry\n");
    fwrite(STDERR, "Run 2026-08-24-timezone-dryrun.php first.\n");
    exit(1);
}

/* ── Work out the shift from the HOST clock ─────────────────────────── */

$sys   = bv_tz_system_offset_seconds($pdo);
$shift = BV_TZ_TARGET_OFFSET_SECONDS - $sys['seconds'];

echo "MySQL system zone : {$sys['name']} ({$sys['raw']} from UTC)\n";
echo "Shift to apply    : " . bv_tz_format_shift($shift) . "\n\n";

if ($shift === 0) {
    echo "This server's clock already matches the target offset. Nothing to do.\n";
    echo "No rows were changed and no marker was written, so this stays safe to\n";
    echo "re-run if the server's timezone is ever changed.\n";
    exit(0);
}

/* ── Refuse a second pass ───────────────────────────────────────────── */

$pdo->exec("
    CREATE TABLE IF NOT EXISTS `bv_migration_log` (
        `migration`  VARCHAR(190) NOT NULL,
        `applied_at` DATETIME     NOT NULL,
        `notes`      VARCHAR(500) NULL,
        PRIMARY KEY (`migration`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");

$stmt = $pdo->prepare('SELECT applied_at, notes FROM bv_migration_log WHERE migration = :k');
$stmt->execute(array(':k' => BV_TZ_MIGRATION_KEY));
if ($already = $stmt->fetch()) {
    fwrite(STDERR, "REFUSING: already applied on {$already['applied_at']}.\n");
    fwrite(STDERR, "{$already['notes']}\n");
    fwrite(STDERR, "Running again would shift every value a second time.\n");
    exit(1);
}

/* ── Apply ──────────────────────────────────────────────────────────── */

if ($dry) {
    echo "--dry: showing what would run, changing nothing.\n\n";
}

$touched = 0;
$skipped = array();

if (!$dry) {
    $pdo->beginTransaction();
}

try {
    foreach (bv_tz_display_columns() as $col) {
        list($table, $column) = $col;

        $type = bv_tz_column_exists($pdo, $table, $column);
        if (!$type) {
            $skipped[] = "{$table}.{$column} (not on this database)";
            continue;
        }
        if (strtolower($type) !== 'datetime') {
            // Already handled by the session zone -- shifting would double it.
            $skipped[] = "{$table}.{$column} (is `{$type}`, not `datetime`)";
            continue;
        }

        $sql = "UPDATE `{$table}`
                   SET `{$column}` = `{$column}` + INTERVAL {$shift} SECOND
                 WHERE `{$column}` IS NOT NULL";

        if ($dry) {
            $n = (int) $pdo->query("SELECT COUNT(`{$column}`) FROM `{$table}`")->fetchColumn();
            printf("  would update %6d rows  %s.%s\n", $n, $table, $column);
            $touched += $n;
            continue;
        }

        $n = $pdo->exec($sql);
        $touched += (int) $n;
        printf("  updated %6d rows  %s.%s\n", (int) $n, $table, $column);
    }

    if (!$dry) {
        $note = sprintf(
            'Shifted %d user-visible datetime values by %s (host zone %s) to match the %s pin.',
            $touched, bv_tz_format_shift($shift), $sys['name'], BV_TIMEZONE_OFFSET
        );
        $ins = $pdo->prepare('
            INSERT INTO bv_migration_log (migration, applied_at, notes)
            VALUES (:k, NOW(), :n)
        ');
        $ins->execute(array(':k' => BV_TZ_MIGRATION_KEY, ':n' => $note));

        $pdo->commit();
    }
} catch (Throwable $e) {
    if (!$dry && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, "\nFAILED: " . $e->getMessage() . "\nNo changes were kept.\n");
    exit(1);
}

echo "\n" . ($dry ? "Would have shifted" : "Shifted") . " {$touched} values by "
    . bv_tz_format_shift($shift) . ".\n";

if ($skipped) {
    echo "\nSkipped:\n";
    foreach ($skipped as $s) {
        echo "  - {$s}\n";
    }
}

if (!$dry) {
    echo "\nRecorded in bv_migration_log. This script will now refuse to re-run.\n";
    echo "Auth-token datetimes were deliberately left alone -- any OTP or\n";
    echo "password-reset link issued before this ran keeps its original window\n";
    echo "and will simply expire on its own.\n";
}
echo "\n";

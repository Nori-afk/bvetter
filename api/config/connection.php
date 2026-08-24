<?php

require_once __DIR__ . '/../../config/env.php';

/* ── Clock ────────────────────────────────────────────────────────────
   Every timestamp this app renders is a bare "Y-m-d H:i:s" string with no
   offset, and the browser parses those as ITS OWN local time (see
   formatRelativeTime in admin/js/index.js). So the only way "3 days ago"
   is correct is if PHP, MySQL, and the browser all agree on the clock.

   Both server clocks are pinned to Philippine time here rather than left
   on whatever the host OS happens to be. Before this, dev ran PHP on
   Europe/Berlin against MySQL on UTC+8 -- a six-hour split inside one
   request, which silently shifted every rendered date and made the two
   OTP-expiry checks in api/config/two_factor.php disagree with each other.

   '+08:00' rather than 'Asia/Manila' on the MySQL side on purpose: named
   zones need the mysql.time_zone_* tables populated, which they usually
   are not on a stock install. The Philippines has no DST, so the fixed
   offset is exact and permanent.

   NOTE for anyone changing this: MySQL `timestamp` columns are stored as
   UTC and converted to the session zone on read, so they follow this
   setting automatically. `datetime` columns store a literal string and do
   NOT -- this schema has both. See
   database/migrations/2026-08-24-timezone-dryrun.php. */
define('BV_TIMEZONE', 'Asia/Manila');
define('BV_TIMEZONE_OFFSET', '+08:00');
date_default_timezone_set(BV_TIMEZONE);

define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_PORT', getenv('DB_PORT') ?: '');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') ?: 'root');
define('DB_NAME', getenv('DB_NAME') ?: 'bvetter');

$dsn = 'mysql:host=' . DB_HOST . (DB_PORT !== '' ? ';port=' . DB_PORT : '') . ';dbname=' . DB_NAME . ';charset=utf8mb4';

try {
    $pdo = new PDO(
        $dsn,
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::MYSQL_ATTR_INIT_COMMAND => "SET time_zone = '" . BV_TIMEZONE_OFFSET . "'",
        ]
    );
} catch (PDOException $e) {
    error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'message' => 'Database connection failed'
    ]);
    exit;
}
<?php
/**
 * Runs the review time limits from cron (api/includes/timed_rules.php).
 *
 * The site already runs them whenever anyone uses it; this makes reminder
 * emails and expiry notices go out on time at night and over weekends too,
 * when nobody has a page open. On the droplet, every 5 minutes:
 *
 *   0-59/5 * * * * php /var/www/bvetter/api/cron/timed-rules.php >/dev/null 2>&1
 *
 * Lost & Found auto-publishing needs the report-matching code, which lives
 * in the Lost & Found endpoint, so that part is triggered by one request to
 * it (its "schema" action does nothing else).
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only.');
}

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../includes/timed_rules.php';

runTimedRules($pdo, true);

if (defined('APP_URL') && APP_URL !== '') {
    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => 'Content-Type: application/x-www-form-urlencoded',
            'content' => 'action=schema',
            'timeout' => 20,
        ],
    ]);
    $result = @file_get_contents(rtrim(APP_URL, '/') . '/api/lost-found/lost_and_found.php', false, $context);
    if ($result === false) {
        fwrite(STDERR, "Lost & Found auto-publish request failed.\n");
    }
}

echo "Timed rules ran at " . date('Y-m-d H:i:s') . "\n";

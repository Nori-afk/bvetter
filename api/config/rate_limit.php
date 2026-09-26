<?php
/**
 * A small sliding-window rate limit kept in MySQL.
 *
 * Built for the public endpoints that answer "is this email registered?" --
 * the sign-up form's live check and the step that emails a verification
 * code. Registration has always revealed that (see register.php), but one
 * answer per form submit is very different from a loop testing thousands of
 * addresses, so both share one per-IP bucket.
 *
 * Timestamps come from PHP rather than NOW() so the window is measured on
 * one clock even where MySQL and PHP disagree about the timezone.
 */

function ensureRateLimitSchema(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS rate_limit_hits (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            bucket VARCHAR(120) NOT NULL,
            hit_at DATETIME NOT NULL,
            INDEX idx_rlh_bucket_time (bucket, hit_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

/**
 * Records one hit against $bucket and says whether it is allowed: false once
 * $max hits already fall inside the last $windowSeconds. A refused hit is not
 * recorded, so a client that backs off gets its allowance back on time.
 */
function rateLimitAllow(PDO $pdo, string $bucket, int $max, int $windowSeconds): bool
{
    ensureRateLimitSchema($pdo);

    $now = time();
    $cutoff = date('Y-m-d H:i:s', $now - $windowSeconds);

    $pdo->prepare('DELETE FROM rate_limit_hits WHERE bucket = :bucket AND hit_at < :cutoff')
        ->execute([':bucket' => $bucket, ':cutoff' => $cutoff]);

    // Other buckets are never read again once their window passes; clearing
    // a day-old backlog now and then keeps the table from growing forever.
    if (random_int(1, 50) === 1) {
        $pdo->prepare('DELETE FROM rate_limit_hits WHERE hit_at < :old')
            ->execute([':old' => date('Y-m-d H:i:s', $now - 86400)]);
    }

    $count = $pdo->prepare('SELECT COUNT(*) FROM rate_limit_hits WHERE bucket = :bucket');
    $count->execute([':bucket' => $bucket]);
    if ((int) $count->fetchColumn() >= $max) {
        return false;
    }

    $pdo->prepare('INSERT INTO rate_limit_hits (bucket, hit_at) VALUES (:bucket, :hit_at)')
        ->execute([':bucket' => $bucket, ':hit_at' => date('Y-m-d H:i:s', $now)]);
    return true;
}

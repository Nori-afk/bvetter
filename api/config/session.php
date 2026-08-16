<?php
/**
 * BVetter – Server-side session tracking
 *
 * Every login writes a row here (IP, best-effort geolocated city/country,
 * a parsed device/browser label). This is what powers the "Manage Security"
 * active-sessions table and lets an admin actually end a session — enforced
 * by shared/js/auth.js polling api/auth/session.php?action=check on every
 * protected page.
 *
 * Idle sessions are auto-ended the same way: expiry is checked lazily, on the
 * next findSessionByToken() lookup for that token, rather than by a background
 * job — consistent with the request-driven style of the rest of this codebase.
 * Because that check runs on every authenticated request, it's enforced
 * everywhere a token is validated (requireRole() guards, session.php actions),
 * not just on the poll.
 *
 * IMPORTANT — what counts as activity. last_seen_at is only advanced by a
 * request the user actually caused. The 'check' poll from shared/js/auth.js
 * runs on a timer whether or not anyone is at the keyboard, so it advances
 * last_seen_at ONLY when the client reports real interaction since its last
 * ping. Before that distinction existed the poll renewed the session ~360
 * times an hour and the idle timeout could never fire while a tab stayed
 * open — it appeared to work only because closing the tab stopped the poll,
 * so the expiry surfaced on the next page load. That is what made the
 * timeout look like it needed a refresh.
 */

require_once __DIR__ . '/security_settings.php';

/**
 * Minutes of inactivity before a session is treated as expired and revoked.
 * Admin-set in Manage Security; falls back to the previous hardcoded 30 if
 * the settings row can't be read for any reason.
 */
function sessionIdleTimeoutMinutes(PDO $pdo): int
{
    try {
        return getSecuritySettings($pdo)['session_idle_minutes'];
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        return 30;
    }
}

function ensureSessionSchema(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS user_sessions (
            id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id      INT UNSIGNED NOT NULL,
            token_hash   CHAR(64)     NOT NULL UNIQUE,
            ip_address   VARCHAR(45)  NULL,
            city         VARCHAR(120) NULL,
            country      VARCHAR(120) NULL,
            device_label VARCHAR(150) NULL,
            user_agent   VARCHAR(255) NULL,
            created_at   DATETIME NOT NULL DEFAULT NOW(),
            last_seen_at DATETIME NOT NULL DEFAULT NOW(),
            revoked_at   DATETIME NULL,
            INDEX idx_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

/**
 * Reads the bearer token from the Authorization header, tolerant of the
 * couple of ways Apache/PHP configs mangle that header.
 */
function bearerToken(): ?string
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null;

    if (!$header && function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) {
                $header = $value;
                break;
            }
        }
    }

    if ($header && preg_match('/Bearer\s+(\S+)/i', $header, $m)) {
        return $m[1];
    }
    return null;
}

function clientIp(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '';
}

function isPrivateOrLocalIp(string $ip): bool
{
    if ($ip === '' || $ip === '::1') {
        return true;
    }
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false;
}

/**
 * Best-effort IP → city/country lookup. Never throws; returns nulls for
 * local/private IPs (dev environments) or on any lookup failure.
 */
function geolocateIp(string $ip): array
{
    if (isPrivateOrLocalIp($ip)) {
        return ['city' => null, 'country' => null];
    }

    $ch = curl_init("http://ip-api.com/json/{$ip}?fields=status,city,country");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 3,
        CURLOPT_CONNECTTIMEOUT => 2,
    ]);
    $response = curl_exec($ch);
    curl_close($ch);

    if (!$response) {
        return ['city' => null, 'country' => null];
    }

    $data = json_decode($response, true);
    if (!is_array($data) || ($data['status'] ?? '') !== 'success') {
        return ['city' => null, 'country' => null];
    }

    return ['city' => $data['city'] ?? null, 'country' => $data['country'] ?? null];
}

function parseDeviceLabel(string $userAgent): string
{
    $browser = 'Unknown Browser';
    if (preg_match('/Edg\//', $userAgent)) {
        $browser = 'Edge';
    } elseif (preg_match('/OPR\//', $userAgent)) {
        $browser = 'Opera';
    } elseif (preg_match('/Chrome\//', $userAgent) && !preg_match('/Chromium/', $userAgent)) {
        $browser = 'Chrome';
    } elseif (preg_match('/Firefox\//', $userAgent)) {
        $browser = 'Firefox';
    } elseif (preg_match('/Safari\//', $userAgent) && !preg_match('/Chrome/', $userAgent)) {
        $browser = 'Safari';
    }

    $os = 'Unknown OS';
    if (preg_match('/Windows/', $userAgent)) {
        $os = 'Windows';
    } elseif (preg_match('/iPhone|iPad/', $userAgent)) {
        $os = 'iOS';
    } elseif (preg_match('/Mac OS X/', $userAgent)) {
        $os = 'macOS';
    } elseif (preg_match('/Android/', $userAgent)) {
        $os = 'Android';
    } elseif (preg_match('/Linux/', $userAgent)) {
        $os = 'Linux';
    }

    return "{$browser} on {$os}";
}

function recordLoginSession(PDO $pdo, int $userId, string $token): void
{
    ensureSessionSchema($pdo);

    $ip  = clientIp();
    $ua  = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255);
    $geo = geolocateIp($ip);

    $pdo->prepare('
        INSERT INTO user_sessions (user_id, token_hash, ip_address, city, country, device_label, user_agent)
        VALUES (:user_id, :token_hash, :ip, :city, :country, :device_label, :user_agent)
    ')->execute([
        ':user_id'      => $userId,
        ':token_hash'   => hash('sha256', $token),
        ':ip'           => $ip,
        ':city'         => $geo['city'],
        ':country'      => $geo['country'],
        ':device_label' => parseDeviceLabel($ua),
        ':user_agent'   => $ua,
    ]);
}

/**
 * Proactively revokes every session idle past the configured window,
 * system-wide. findSessionByToken()'s lazy check only catches a stale
 * session when its own token is looked up again — a session nobody is
 * polling anymore (tab closed, device put away) would otherwise sit with
 * revoked_at NULL forever and keep showing as an active login in the
 * session-list views. Call this right before listing sessions; kept as a
 * sweep triggered by that read, not a background job, to match the
 * request-driven style described above.
 */
function sweepIdleSessions(PDO $pdo): void
{
    $stmt = $pdo->prepare('
        UPDATE user_sessions
        SET revoked_at = NOW()
        WHERE revoked_at IS NULL
          AND last_seen_at < DATE_SUB(NOW(), INTERVAL :minutes MINUTE)
    ');
    $stmt->execute([':minutes' => sessionIdleTimeoutMinutes($pdo)]);
}

/**
 * Marks a session as actively used, right now. Called only for requests a
 * user actually caused — never by the bare keep-alive poll.
 */
function touchSessionActivity(PDO $pdo, int $sessionId): void
{
    $pdo->prepare('UPDATE user_sessions SET last_seen_at = NOW() WHERE id = :id')
        ->execute([':id' => $sessionId]);
}

/**
 * Seconds left before this session expires from inactivity; 0 once past.
 *
 * Computed entirely in SQL so both sides of the subtraction come from the
 * same clock. Doing it in PHP would compare strtotime() of a MySQL DATETIME
 * against PHP's time(), which silently drifts by hours whenever PHP and
 * MySQL disagree about the timezone — a mismatch this deployment has already
 * hit once (see the epoch-seconds workaround in the session list).
 */
function sessionSecondsRemaining(PDO $pdo, int $sessionId): int
{
    $stmt = $pdo->prepare('
        SELECT GREATEST(0, TIMESTAMPDIFF(
            SECOND, NOW(), DATE_ADD(last_seen_at, INTERVAL :minutes MINUTE)
        ))
        FROM user_sessions WHERE id = :id
    ');
    $stmt->execute([
        ':minutes' => sessionIdleTimeoutMinutes($pdo),
        ':id'      => $sessionId,
    ]);
    return (int) $stmt->fetchColumn();
}

/**
 * Looks up a session by raw bearer token. Returns null for tokens that were
 * never issued; callers must separately check `revoked_at` — a revoked row
 * is still returned so the caller can tell "unknown" apart from "ended".
 *
 * A session idle past the configured window (judged from last_seen_at, which
 * user-driven requests keep fresh while the session is actually in use) is
 * revoked here, lazily, before being returned — so it comes back
 * indistinguishable from an explicitly-ended session to every existing caller.
 */
function findSessionByToken(PDO $pdo, string $token): ?array
{
    ensureSessionSchema($pdo);

    $stmt = $pdo->prepare('
        SELECT user_sessions.*, users.full_name, roles.name AS role_name
        FROM user_sessions
        INNER JOIN users ON users.id = user_sessions.user_id
        INNER JOIN roles ON roles.id = users.role_id
        WHERE user_sessions.token_hash = :token_hash
        LIMIT 1
    ');
    $stmt->execute([':token_hash' => hash('sha256', $token)]);
    $row = $stmt->fetch();

    if ($row && $row['revoked_at'] === null) {
        // Expiry decided by MySQL against its own NOW(), for the same
        // clock-consistency reason as sessionSecondsRemaining(). The UPDATE
        // is the test: it only matches if the row is genuinely past the
        // window, so no separate read is needed.
        $expire = $pdo->prepare('
            UPDATE user_sessions
            SET revoked_at = NOW()
            WHERE id = :id
              AND revoked_at IS NULL
              AND last_seen_at < DATE_SUB(NOW(), INTERVAL :minutes MINUTE)
        ');
        $expire->execute([
            ':id'      => $row['id'],
            ':minutes' => sessionIdleTimeoutMinutes($pdo),
        ]);

        if ($expire->rowCount() > 0) {
            $row['revoked_at'] = date('Y-m-d H:i:s');
        }
    }

    return $row ?: null;
}

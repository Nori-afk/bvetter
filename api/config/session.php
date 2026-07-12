<?php
/**
 * VBetter – Server-side session tracking
 *
 * Every login writes a row here (IP, best-effort geolocated city/country,
 * a parsed device/browser label). This is what powers the "Manage Security"
 * active-sessions table and lets an admin actually end a session — enforced
 * by shared/js/auth.js polling api/auth/session.php?action=check on every
 * protected page.
 */

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
 * Looks up a session by raw bearer token. Returns null for tokens that were
 * never issued; callers must separately check `revoked_at` — a revoked row
 * is still returned so the caller can tell "unknown" apart from "ended".
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

    return $row ?: null;
}

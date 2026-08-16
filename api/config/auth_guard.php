<?php
/**
 * BVetter – Endpoint auth guard
 *
 * requireRole($pdo, ['admin']) / requireRole($pdo, ['veterinarian', 'admin'])
 * validates the caller's bearer token against user_sessions (see
 * api/config/session.php) and stops the request with a JSON 401/403 when the
 * token is missing, unknown, revoked, or the user's role isn't allowed.
 *
 * Returns the session row (user_id, full_name, role_name, ...) so callers
 * can use the *authenticated* identity instead of trusting client-posted
 * user_id fields.
 *
 * 401 (not 403) is used for both "no token" and "bad token" so the frontend
 * wrappers can treat any 401 as "session ended → back to login".
 */

require_once __DIR__ . '/session.php';

function requireRole(PDO $pdo, array $allowedRoles): array
{
    $token = bearerToken();
    if ($token === null) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode([
            'success' => false,
            'message' => 'Authentication required.'
        ]);
        exit;
    }

    $session = findSessionByToken($pdo, $token);
    if ($session === null || $session['revoked_at'] !== null) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode([
            'success' => false,
            'message' => 'Your session has ended. Please log in again.'
        ]);
        exit;
    }

    if (!in_array($session['role_name'], $allowedRoles, true)) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode([
            'success' => false,
            'message' => 'You do not have permission to perform this action.'
        ]);
        exit;
    }

    // A successful authenticated API call is genuine user-driven activity, so
    // it renews the idle window. This is the reliable half of the signal: the
    // browser's interaction tracking can miss things, a real request can't.
    // The keep-alive poll deliberately does NOT come through here — it hits
    // api/auth/session.php directly, so it can't renew a session on its own.
    touchSessionActivity($pdo, (int) $session['id']);

    return $session;
}

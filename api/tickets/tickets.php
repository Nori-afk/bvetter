<?php

header('Content-Type: application/json');

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';
if ($method !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'message' => 'Method not allowed'
    ]);
    exit;
}

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/input_validation.php';
require_once __DIR__ . '/../config/notifications.php';

function respond($statusCode, $payload)
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

function inputData()
{
    $json = json_decode(file_get_contents('php://input'), true);
    if (is_array($json)) {
        return array_merge($_POST, $json);
    }
    return $_POST;
}

function clean($value)
{
    return trim((string) $value);
}

function nullableClean($value)
{
    $value = clean($value);
    return $value === '' ? null : $value;
}

function normalizeRole($role)
{
    $role = strtolower(clean($role));
    if ($role === 'veterinarian') return 'vet';
    if ($role === 'pet_owner') return 'owner';
    return in_array($role, ['owner', 'vet', 'admin'], true) ? $role : 'owner';
}

function normalizeTicketStatus($status, $fallback = 'open')
{
    $status = strtolower(str_replace(' ', '_', clean($status)));
    $allowed = ['open', 'in_progress', 'resolved'];
    return in_array($status, $allowed, true) ? $status : $fallback;
}

function generateTicketNumber()
{
    return 'TKT-' . date('Ymd') . '-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 6));
}

function ensureTicketSchema($pdo)
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS support_tickets (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ticket_number VARCHAR(40) NOT NULL UNIQUE,
            reporter_id INT NULL,
            reporter_role ENUM('owner','vet','admin') NOT NULL DEFAULT 'owner',
            reporter_name VARCHAR(150) NULL,
            reporter_email VARCHAR(150) NULL,
            subject VARCHAR(150) NOT NULL,
            description TEXT NOT NULL,
            status ENUM('open','in_progress','resolved') NOT NULL DEFAULT 'open',
            admin_notes TEXT NULL,
            resolved_by_user_id INT NULL,
            resolved_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_tickets_reporter (reporter_id),
            INDEX idx_tickets_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ");

    // Installs that already had this table from before attachments existed
    // won't get the new columns from CREATE TABLE IF NOT EXISTS above.
    $hasAttachment = $pdo->query("SHOW COLUMNS FROM support_tickets LIKE 'attachment_path'")->fetch();
    if (!$hasAttachment) {
        $pdo->exec("
            ALTER TABLE support_tickets
                ADD COLUMN attachment_path VARCHAR(255) NULL AFTER description,
                ADD COLUMN attachment_type ENUM('image','video') NULL AFTER attachment_path
        ");
    }
}

/**
 * Screenshot or short screen-recording attached to a bug report — proof of
 * what went wrong, alongside the free-text description. Optional: returns
 * [null, null] when the reporter didn't attach anything.
 */
function saveTicketAttachment()
{
    $field = 'attachment';
    if (!isset($_FILES[$field]) || $_FILES[$field]['error'] === UPLOAD_ERR_NO_FILE) {
        return [null, null];
    }
    if ($_FILES[$field]['error'] !== UPLOAD_ERR_OK) {
        respond(422, ['success' => false, 'message' => 'Attachment upload failed. Please try again.']);
    }

    $file = $_FILES[$field];
    $allowedImages = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    $allowedVideos = ['video/mp4' => 'mp4', 'video/webm' => 'webm', 'video/quicktime' => 'mov'];

    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file($file['tmp_name']);

    $kind = null;
    $ext = null;
    if (isset($allowedImages[$mime])) {
        $kind = 'image';
        $ext = $allowedImages[$mime];
        $maxSize = 8 * 1024 * 1024;
    } elseif (isset($allowedVideos[$mime])) {
        $kind = 'video';
        $ext = $allowedVideos[$mime];
        $maxSize = 30 * 1024 * 1024;
    } else {
        respond(422, ['success' => false, 'message' => 'Attachments must be a JPG/PNG/WEBP screenshot or an MP4/WEBM/MOV video.']);
    }

    if ($file['size'] > $maxSize) {
        respond(422, ['success' => false, 'message' => $kind === 'video' ? 'Video attachments must not exceed 30MB.' : 'Image attachments must not exceed 8MB.']);
    }

    $directory = dirname(dirname(__DIR__)) . '/storage/tickets';
    if (!is_dir($directory) && !mkdir($directory, 0775, true)) {
        respond(500, ['success' => false, 'message' => 'Could not create upload directory.']);
    }

    $name = 'ticket_' . time() . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
    $absolute = $directory . '/' . $name;

    if (!move_uploaded_file($file['tmp_name'], $absolute)) {
        respond(500, ['success' => false, 'message' => 'Could not save the attachment.']);
    }

    return ['/storage/tickets/' . $name, $kind];
}

function mapTicket($row)
{
    return [
        'id' => (int) $row['id'],
        'ticketNumber' => $row['ticket_number'],
        'reporterId' => $row['reporter_id'] !== null ? (int) $row['reporter_id'] : null,
        'reporterRole' => $row['reporter_role'],
        'reporterName' => $row['reporter_name'],
        'reporterEmail' => $row['reporter_email'],
        'subject' => apiSafeText($row['subject']),
        'description' => apiSafeText($row['description']),
        'attachmentUrl' => $row['attachment_path'],
        'attachmentType' => $row['attachment_type'],
        'status' => $row['status'],
        'adminNotes' => $row['admin_notes'],
        'resolvedAt' => $row['resolved_at'],
        'createdAt' => $row['created_at'],
        'updatedAt' => $row['updated_at'],
    ];
}

/**
 * Single ticket lookup by id. Bound rather than interpolated so the query is
 * safe on its own terms, instead of relying on every call site remembering to
 * cast $id to int first.
 */
function fetchTicketById($pdo, $id)
{
    $stmt = $pdo->prepare('SELECT * FROM support_tickets WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => (int) $id]);
    return $stmt->fetch();
}

function createTicket($pdo, $data)
{
    $subject = clean($data['subject'] ?? '');
    $description = clean($data['description'] ?? '');
    if ($subject === '' || $description === '') {
        respond(422, ['success' => false, 'message' => 'Subject and description are required.']);
    }

    /* Length caps only -- no angle-bracket rejection. A ticket is the one place
       a user is actively describing a problem, and "the page shows <blank>" or
       "temp reads > 39" are exactly the sorts of thing they will type. Both
       fields are already defanged on output by apiSafeText() in
       formatTicket(). What was missing was any bound at all: subject silently
       overflowed VARCHAR(150) and description was unbounded TEXT, which is a
       denial-of-service surface by the reasoning in
       api/config/input_validation.php. */
    if (mb_strlen($subject) > 150) {
        respond(422, ['success' => false, 'message' => 'Subject must be 150 characters or fewer.']);
    }
    if (mb_strlen($description) > 5000) {
        respond(422, ['success' => false, 'message' => 'Description must be 5000 characters or fewer.']);
    }

    [$attachmentPath, $attachmentType] = saveTicketAttachment();
    $reporterName = nullableClean($data['reporter_name'] ?? '');
    $reporterRole = normalizeRole($data['reporter_role'] ?? '');

    $stmt = $pdo->prepare("
        INSERT INTO support_tickets
            (ticket_number, reporter_id, reporter_role, reporter_name, reporter_email, subject, description, attachment_path, attachment_type, status)
        VALUES
            (:ticket_number, :reporter_id, :reporter_role, :reporter_name, :reporter_email, :subject, :description, :attachment_path, :attachment_type, 'open')
    ");
    $stmt->execute([
        ':ticket_number' => generateTicketNumber(),
        ':reporter_id' => (int) ($data['reporter_id'] ?? 0) ?: null,
        ':reporter_role' => $reporterRole,
        ':reporter_name' => $reporterName,
        ':reporter_email' => nullableClean($data['reporter_email'] ?? ''),
        ':subject' => $subject,
        ':description' => $description,
        ':attachment_path' => $attachmentPath,
        ':attachment_type' => $attachmentType,
    ]);

    $id = (int) $pdo->lastInsertId();
    $row = fetchTicketById($pdo, $id);

    notifyStaff(
        $pdo,
        'both',
        'new_ticket',
        'New Support Ticket',
        ($reporterName ?: 'Someone') . " ({$reporterRole}) submitted a new ticket: \"{$subject}\"",
        $id,
        true
    );

    respond(201, ['success' => true, 'data' => mapTicket($row)]);
}

function listTickets($pdo, $data)
{
    $role = normalizeRole($data['role'] ?? $data['reporter_role'] ?? '');
    $reporterId = (int) ($data['reporter_id'] ?? 0);
    $statusFilter = clean($data['status'] ?? '');

    $where = [];
    $params = [];

    // Admin sees every ticket; everyone else only sees their own submissions.
    if ($role !== 'admin') {
        $where[] = 'reporter_id = :reporter_id';
        $params[':reporter_id'] = $reporterId;
    }

    if ($statusFilter !== '' && $statusFilter !== 'all') {
        $where[] = 'status = :status';
        $params[':status'] = normalizeTicketStatus($statusFilter);
    }

    $sql = 'SELECT * FROM support_tickets';
    if ($where) {
        $sql .= ' WHERE ' . implode(' AND ', $where);
    }
    $sql .= ' ORDER BY created_at DESC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    respond(200, ['success' => true, 'data' => array_map('mapTicket', $rows)]);
}

function updateTicketStatus($pdo, $data)
{
    $id = (int) ($data['ticket_id'] ?? $data['id'] ?? 0);
    if ($id <= 0) {
        respond(422, ['success' => false, 'message' => 'A ticket_id is required.']);
    }

    $status = normalizeTicketStatus($data['status'] ?? '', '');
    if ($status === '') {
        respond(422, ['success' => false, 'message' => 'A valid status is required.']);
    }

    $resolvedByUserId = (int) ($data['resolved_by_user_id'] ?? 0) ?: null;

    $existing = fetchTicketById($pdo, $id);
    if (!$existing) {
        respond(404, ['success' => false, 'message' => 'Ticket not found.']);
    }
    $previousStatus = $existing['status'];

    $stmt = $pdo->prepare("
        UPDATE support_tickets
        SET status = :status,
            admin_notes = :admin_notes,
            resolved_by_user_id = CASE WHEN :status2 = 'resolved' THEN :resolved_by_user_id ELSE resolved_by_user_id END,
            resolved_at = CASE WHEN :status3 = 'resolved' THEN NOW() ELSE resolved_at END
        WHERE id = :id
    ");
    $stmt->execute([
        ':status' => $status,
        ':status2' => $status,
        ':status3' => $status,
        ':admin_notes' => nullableClean($data['admin_notes'] ?? ''),
        ':resolved_by_user_id' => $resolvedByUserId,
        ':id' => $id,
    ]);

    $row = fetchTicketById($pdo, $id);

    // Only fire the moment a ticket actually becomes resolved — not on every
    // "Save Changes" click while it's already sitting in that status (e.g.
    // an admin note edit shouldn't re-notify the reporter).
    if ($status === 'resolved' && $previousStatus !== 'resolved') {
        notifyTicketReporter($pdo, $row, 'resolved');
    }

    respond(200, ['success' => true, 'data' => mapTicket($row)]);
}

function deleteTicket($pdo, $data)
{
    $id = (int) ($data['ticket_id'] ?? $data['id'] ?? 0);
    if ($id <= 0) {
        respond(422, ['success' => false, 'message' => 'A ticket_id is required.']);
    }

    $row = fetchTicketById($pdo, $id);
    if (!$row) {
        respond(404, ['success' => false, 'message' => 'Ticket not found.']);
    }

    notifyTicketReporter($pdo, $row, 'deleted');

    $pdo->prepare('DELETE FROM support_tickets WHERE id = :id')->execute([':id' => $id]);

    respond(200, ['success' => true, 'message' => 'Ticket deleted.']);
}

/**
 * Emails the person who filed the ticket when staff resolve or delete it —
 * a direct reply to something they actively submitted and are waiting on,
 * so (like password-reset/security mail) it isn't gated behind the
 * lost_found/appointment/chatbot notification-preference toggles.
 */
function notifyTicketReporter($pdo, $ticket, $event)
{
    $name = $ticket['reporter_name'] ?: 'there';
    $subject = $ticket['subject'];

    // In-app row first, and independent of the email. A ticket can be filed
    // without an email address, and that reporter still deserves to see the
    // outcome in their feed.
    $reporterId = (int) ($ticket['reporter_id'] ?? 0);
    if ($reporterId > 0) {
        notifyUser(
            $pdo,
            $reporterId,
            'ticket_status',
            $event === 'resolved' ? 'Ticket Resolved' : 'Ticket Closed',
            "Your ticket {$ticket['ticket_number']} — \"{$subject}\" — was "
                . ($event === 'resolved' ? 'marked resolved.' : 'closed by our team.'),
            (int) ($ticket['id'] ?? 0) ?: null
        );
    }

    $email = nullableClean($ticket['reporter_email'] ?? '');
    if (!$email) return;

    if ($event === 'resolved') {
        $emailSubject = 'BVetter – Your ticket has been resolved';
        $notesHtml = nullableClean($ticket['admin_notes'] ?? '')
            ? '<p><strong>Notes from our team:</strong><br>' . nl2br(htmlspecialchars($ticket['admin_notes'], ENT_QUOTES)) . '</p>'
            : '';
        $bodyHtml = "<p>Hi <strong>" . htmlspecialchars($name, ENT_QUOTES) . "</strong>,</p>
            <p>Your ticket <strong>{$ticket['ticket_number']}</strong> — \"" . htmlspecialchars($subject, ENT_QUOTES) . "\" — has been marked as <strong>resolved</strong>.</p>
            {$notesHtml}";
        $heading = 'Ticket Resolved';
    } else {
        $emailSubject = 'BVetter – Your ticket has been closed';
        $bodyHtml = "<p>Hi <strong>" . htmlspecialchars($name, ENT_QUOTES) . "</strong>,</p>
            <p>Your ticket <strong>{$ticket['ticket_number']}</strong> — \"" . htmlspecialchars($subject, ENT_QUOTES) . "\" — has been closed by our team.</p>";
        $heading = 'Ticket Closed';
    }

    $body = notificationEmailWrapper($heading, $bodyHtml);
    sendAppMail($email, $name, $emailSubject, $body);
}

try {
    // $pdo comes from connection.php (required above)
    ensureTicketSchema($pdo);

    $data = inputData();
    $action = clean($data['action'] ?? 'list');

    // Changing/deleting a ticket is a staff action; users create and list their own.
    if (in_array($action, ['update_status', 'delete_ticket'], true)) {
        require_once __DIR__ . '/../config/auth_guard.php';
        requireRole($pdo, ['veterinarian', 'admin']);
    }

    // Creating and listing were unauthenticated, and listTickets() read the
    // caller's ROLE out of the request body: sending {"action":"list",
    // "role":"admin"} skipped the reporter_id filter entirely and returned every
    // ticket in the system -- reporter names, email addresses and the full
    // complaint text -- with no token at all. That is privilege escalation by
    // request parameter, not merely id-guessing: the client declared its own
    // rank. createTicket() likewise took reporter_id/reporter_role from the body,
    // so tickets could be filed in someone else's name.
    //
    // Role and identity now come from the session only. The body values are
    // overwritten so the existing helpers keep their signatures.
    if (in_array($action, ['create', 'list'], true)) {
        require_once __DIR__ . '/../config/auth_guard.php';
        $ticketSession = requireRole($pdo, ['pet_owner', 'veterinarian', 'admin']);

        $data['role']          = $ticketSession['role_name'];
        $data['reporter_role'] = $ticketSession['role_name'];
        $data['reporter_id']   = (int) $ticketSession['user_id'];
    }

    switch ($action) {
        case 'create':
            createTicket($pdo, $data);
            break;
        case 'update_status':
            updateTicketStatus($pdo, $data);
            break;
        case 'delete_ticket':
            deleteTicket($pdo, $data);
            break;
        case 'list':
        default:
            listTickets($pdo, $data);
            break;
    }
} catch (Throwable $e) {
    error_log('[BVetter Tickets] ' . $e->getMessage());
    respond(500, ['success' => false, 'message' => 'Server error while processing tickets.']);
}

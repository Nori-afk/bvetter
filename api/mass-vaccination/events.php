<?php

header('Content-Type: application/json');

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/input_validation.php';
// Lets a completed event evict the analytics service's cached vaccination
// forecast, instead of waiting out its 6-hour TTL.
require_once __DIR__ . '/../includes/analytics_client.php';

/* Matches the max the Create Event form puts on the date picker
   (vet/js/mass-vaccination.js). No drive is planned further out than this;
   past it, the date is a typo. */
define('MASS_VACC_HORIZON_YEARS', 1);

/* The earliest date an encoder may enter a drive by hand.

   Past dates are ALLOWED and expected: encoders backfill drives that have
   already run -- the Jan-Aug 2026 records are entered after the fact, not
   scheduled. So this is a floor, not a ban on backdating.

   It stops at 2026 because the uploaded vaccination workbook
   (Combined_Rabies_3Years) owns everything before that, and 2025 in it is an
   annual summary allocated across months rather than real per-drive rows.
   mass_vaccination_dataset_data() in api/dashboard/dashboard.php REPLACES a
   workbook month with the live DB sum as soon as any event exists for it, so
   a hand-entered 2025 drive would silently overwrite part of that allocation
   with a single barangay's numbers.

   NOT derived from bv_manual_entry_allowed_from(): that reads the consult
   dataset's coverage, which gates patient visit records. It returns the same
   2026-01-01 today by coincidence, and wiring vaccination entry to it would
   mean a future consult upload started rejecting vaccination dates for no
   reason the encoder could see. Related, but a different dataset.

   See also MASS_VACC_CURRENT_CUTOFF ('2025-01-01') in dashboard.php, which
   splits the Historical and Current views. This floor sits a year later on
   purpose: 2025 is readable, it just is not hand-editable. */
define('MASS_VACC_MANUAL_ENTRY_FROM', '2026-01-01');

function respond($statusCode, $payload)
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

function inputData()
{
    $json = json_decode(file_get_contents('php://input'), true);
    return is_array($json) ? array_merge($_POST, $json) : $_POST;
}

function clean($value)
{
    return trim((string) ($value ?? ''));
}

function setupTables($pdo)
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS mass_vaccination_events (
            id INT AUTO_INCREMENT PRIMARY KEY,
            event_date DATE NOT NULL,
            barangay VARCHAR(120) NOT NULL,
            vaccine VARCHAR(120) NOT NULL,
            status VARCHAR(40) NOT NULL DEFAULT 'Pending Report',
            total_vaccinated INT NULL,
            dogs_count INT NOT NULL DEFAULT 0,
            cats_count INT NOT NULL DEFAULT 0,
            others_count INT NOT NULL DEFAULT 0,
            created_by_user_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_mve_date (event_date),
            INDEX idx_mve_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function formatEvent($row)
{
    $date = $row['event_date'];
    $total = $row['total_vaccinated'] === null ? '' : (int) $row['total_vaccinated'];
    $eventTotal = $total === '' ? 0 : $total;
    $average = max(1, (int) round(($eventTotal + 65) / 2));
    $highest = max(100, $eventTotal, $average);

    return [
        'id' => 'evt-' . $row['id'],
        'rawId' => (int) $row['id'],
        'date' => $date,
        'dateLabel' => date('F j, Y', strtotime($date)),
        // Defanged on output too — rows predating the input check above are
        // still in the table, and this payload feeds the public landing page.
        'barangay' => apiSafeText($row['barangay']),
        'vaccine' => apiSafeText($row['vaccine']),
        'status' => apiSafeText($row['status']),
        'totalVaccinated' => $total,
        'breakdown' => [
            'dogs' => (int) $row['dogs_count'],
            'cats' => (int) $row['cats_count'],
            'others' => (int) $row['others_count'],
        ],
        'comparison' => [
            'event' => $eventTotal,
            'average' => $average,
            'highest' => $highest,
        ],
    ];
}

function listEvents($pdo)
{
    $rows = $pdo->query('SELECT * FROM mass_vaccination_events ORDER BY event_date DESC, id DESC')->fetchAll();
    respond(200, ['success' => true, 'data' => array_map('formatEvent', $rows)]);
}

function createEvent($pdo, $data)
{
    $date = clean($data['date'] ?? $data['event_date'] ?? '');
    $barangay = clean($data['barangay'] ?? '');
    $vaccine = clean($data['vaccine'] ?? '');
    if ($date === '' || $barangay === '' || $vaccine === '') {
        respond(422, ['success' => false, 'message' => 'Date, barangay, and vaccine are required.']);
    }

    /* Date rules, mirroring the ones the Create Event form already applies
       client-side (mass-vaccination.js sets the same floor and +1y ceiling on
       the picker, and re-checks on submit). Until now the server enforced NONE of
       them: this function validated barangay and vaccine but took $date on
       trust, so anything that skipped the form -- curl, Postman, a stale
       cached copy of the JS, a replayed request -- could write any string at
       all into event_date. Those rows feed the ARIMA vaccination forecast, so
       a bad date is not just a cosmetic bug in the list view.

       Deliberately NO weekend rule, unlike assertSchedulableDate() in
       api/appointments/appointment.php: the clinic is closed on Saturdays and
       Sundays, but barangay drives are not -- events already on the books fall
       on Saturdays, and blocking them would reject real campaigns.

       Backdating is allowed on purpose, down to MASS_VACC_MANUAL_ENTRY_FROM.
       This form is not only for scheduling: encoders enter drives that have
       already run, which is how the Jan-Aug 2026 records get in. A rule that
       simply refused every past date would have made that impossible. What it
       refuses is entry into the range the uploaded workbook already owns --
       see the constant for why that boundary is where it is.

       Existing rows are untouched either way: submit_report never rewrites
       event_date, so reporting on a drive that has already happened keeps
       working regardless of how old it is.

       The horizon is measured in Philippine time: api/config/connection.php
       pins PHP and MySQL to Asia/Manila, so "a year from today" means the same
       thing on the server as in the browser of the person filling in the form. */
    /* checkdate() as well as the regex, because strtotime() alone is too
       forgiving to validate with: it reads '2027-02-30' as 2 March and returns
       a perfectly good timestamp, so the shape check passes, the range checks
       pass, and MySQL is the one that finally rejects the impossible date --
       turning what should be a 422 into a 500. The picker cannot produce such
       a date, but the whole point of validating here is the callers that never
       touch the picker. */
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $ymd)
        || !checkdate((int) $ymd[2], (int) $ymd[3], (int) $ymd[1])
    ) {
        respond(422, ['success' => false, 'message' => 'A valid date is required.']);
    }
    if ($date < MASS_VACC_MANUAL_ENTRY_FROM) {
        respond(422, [
            'success' => false,
            'message' => 'Events dated before ' . date('F j, Y', strtotime(MASS_VACC_MANUAL_ENTRY_FROM))
                       . ' come from the uploaded vaccination workbook and cannot be entered by hand.',
            'allowedFrom' => MASS_VACC_MANUAL_ENTRY_FROM,
        ]);
    }
    $horizon = strtotime('+' . MASS_VACC_HORIZON_YEARS . ' year', strtotime(date('Y-m-d')));
    if (strtotime($date) > $horizon) {
        respond(422, [
            'success' => false,
            'message' => 'Events can only be scheduled up to ' . MASS_VACC_HORIZON_YEARS . ' year ahead.'
        ]);
    }

    /* Both of these render on the public landing page for logged-out visitors
       (public/js/landing.js builds a card titled "{vaccine} - {barangay}"), so
       they get the same identity-field treatment as every other short label.
       Caps match the VARCHAR(120) columns. */
    $fieldError = firstIdentityFieldError([
        [$barangay, 'Barangay', 120, 2],
        [$vaccine,  'Vaccine',  120, 2],
    ]);
    if ($fieldError !== null) {
        respond(422, ['success' => false, 'message' => $fieldError]);
    }

    $stmt = $pdo->prepare("
        INSERT INTO mass_vaccination_events (event_date, barangay, vaccine, created_by_user_id)
        VALUES (:event_date, :barangay, :vaccine, :created_by_user_id)
    ");
    $stmt->execute([
        ':event_date' => $date,
        ':barangay' => $barangay,
        ':vaccine' => $vaccine,
        ':created_by_user_id' => (int) ($data['user_id'] ?? $data['created_by_user_id'] ?? 0) ?: null,
    ]);

    $id = (int) $pdo->lastInsertId();
    $stmt = $pdo->prepare('SELECT * FROM mass_vaccination_events WHERE id = :id');
    $stmt->execute([':id' => $id]);
    respond(201, ['success' => true, 'data' => formatEvent($stmt->fetch())]);
}

function deleteEvent($pdo, $data)
{
    $id = (int) preg_replace('/^evt-/', '', (string) ($data['id'] ?? $data['event_id'] ?? 0));
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid event id.']);

    // Read the status BEFORE deleting: only a Completed event was ever part of
    // the forecast, so only its removal changes the model's inputs. Cancelling a
    // Pending Report event changes nothing and must not evict the cache.
    $lookup = $pdo->prepare('SELECT status FROM mass_vaccination_events WHERE id = :id');
    $lookup->execute([':id' => $id]);
    $wasCompleted = ($lookup->fetchColumn() === 'Completed');

    $stmt = $pdo->prepare('DELETE FROM mass_vaccination_events WHERE id = :id');
    $stmt->execute([':id' => $id]);

    if ($stmt->rowCount() === 0) {
        respond(404, ['success' => false, 'message' => 'Event not found.']);
    }

    if ($wasCompleted) {
        bv_analytics_invalidate_vaccination();
    }

    respond(200, ['success' => true, 'message' => 'Event deleted.']);
}

function submitReport($pdo, $data)
{
    $id = (int) preg_replace('/^evt-/', '', (string) ($data['id'] ?? $data['event_id'] ?? 0));
    if ($id <= 0) respond(422, ['success' => false, 'message' => 'Invalid event id.']);

    $total = (int) ($data['totalVaccinated'] ?? $data['total_vaccinated'] ?? 0);
    $breakdown = $data['breakdown'] ?? [];
    if (is_string($breakdown)) {
        $decoded = json_decode($breakdown, true);
        $breakdown = is_array($decoded) ? $decoded : [];
    }

    $stmt = $pdo->prepare("
        UPDATE mass_vaccination_events
        SET status = 'Completed',
            total_vaccinated = :total,
            dogs_count = :dogs,
            cats_count = :cats,
            others_count = :others
        WHERE id = :id
    ");
    $stmt->execute([
        ':total' => $total,
        ':dogs' => (int) ($breakdown['dogs'] ?? $data['dogs'] ?? 0),
        ':cats' => (int) ($breakdown['cats'] ?? $data['cats'] ?? 0),
        ':others' => (int) ($breakdown['others'] ?? $data['others'] ?? 0),
        ':id' => $id,
    ]);

    // This is the only path that sets status = 'Completed', so it covers both
    // the first completion and any later edit of an already-completed event --
    // either way the numbers the forecast reads have changed. Invalidation only
    // forces a recalculation; the plausibility gate still decides whether these
    // months actually reach the fit.
    bv_analytics_invalidate_vaccination();

    $stmt = $pdo->prepare('SELECT * FROM mass_vaccination_events WHERE id = :id');
    $stmt->execute([':id' => $id]);
    respond(200, ['success' => true, 'data' => formatEvent($stmt->fetch())]);
}

$input = inputData();
$action = clean($input['action'] ?? 'list');

// Event listing is public; creating events and submitting reports is staff-only.
if ($action !== 'list') {
    require_once __DIR__ . '/../config/auth_guard.php';
    requireRole($pdo, ['veterinarian', 'admin']);
}

try {
    setupTables($pdo);
    if ($action === 'list') listEvents($pdo);
    if ($action === 'create') createEvent($pdo, $input);
    if ($action === 'submit_report') submitReport($pdo, $input);
    if ($action === 'delete') deleteEvent($pdo, $input);
    respond(400, ['success' => false, 'message' => 'Unknown mass vaccination action.']);
} catch (PDOException $e) {
    error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
    respond(500, ['success' => false, 'message' => 'Mass vaccination request failed.']);
}

<?php
/**
 * BVetter — historical consultation dataset upload (HTTP layer).
 *
 * The clinic maintains its consultation records in a Consult_Diagnosis_3Y-shaped
 * workbook and uploads it here. PHP does the parsing on purpose: the analytics
 * service is a long-lived Flask process on a 2 GB droplet, and openpyxl's parse
 * spike inside it risks the whole service; a PHP request process spikes, inserts,
 * then dies and hands the memory straight back to the OS.
 *
 * This file is deliberately thin — parse, validate, ingest and versioning all
 * live in api/includes/dataset_versions.php so they can be exercised without an
 * HTTP session. Everything here is request/response plumbing.
 *
 * Actions
 *   upload   (multipart, field `file`) — parse, validate, merge, activate
 *   versions — list every upload, newest first
 *   activate — roll back / forward to a specific version id
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../config/auth_guard.php';
require_once __DIR__ . '/../includes/dataset.php';
require_once __DIR__ . '/../includes/dataset_versions.php';
require_once __DIR__ . '/../includes/analytics_client.php';

$session = requireRole($pdo, ['veterinarian', 'admin']);

/** Uploads above this are refused before parsing. The bundled 3-year file is 627 KB. */
const BV_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

function respond($statusCode, $payload)
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

function bv_upload_store_file(array $file)
{
    $directory = bv_project_root() . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'datasets';
    if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
        respond(500, ['success' => false, 'message' => 'Could not create the dataset storage folder.']);
    }
    // The original file is kept, not just its parsed rows: when a number on the
    // dashboard is questioned months from now, the answer is in the file that
    // produced it.
    $safe = preg_replace('/[^A-Za-z0-9._-]+/', '_', $file['name']);
    $stored = $directory . DIRECTORY_SEPARATOR . date('Ymd_His') . '_' . $safe;
    if (!move_uploaded_file($file['tmp_name'], $stored)) {
        respond(500, ['success' => false, 'message' => 'Could not save the uploaded file.']);
    }
    return $stored;
}

function actionUpload(PDO $pdo, array $session)
{
    if (!isset($_FILES['file']) || $_FILES['file']['error'] === UPLOAD_ERR_NO_FILE) {
        respond(422, ['success' => false, 'message' => 'No file was uploaded.']);
    }
    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK) {
        respond(422, ['success' => false,
                      'message' => 'The file did not upload correctly (error code ' . $file['error'] . ').']);
    }
    if ($file['size'] > BV_UPLOAD_MAX_BYTES) {
        respond(422, ['success' => false,
                      'message' => 'That file is larger than ' . (BV_UPLOAD_MAX_BYTES / 1024 / 1024) . ' MB.']);
    }
    if (strtolower(pathinfo($file['name'], PATHINFO_EXTENSION)) !== 'xlsx') {
        respond(422, ['success' => false, 'message' => 'Please upload an .xlsx workbook.']);
    }

    $stored = bv_upload_store_file($file);

    // Null header row = auto-detect, and the required columns also choose the
    // SHEET, so a workbook whose tab was renamed still imports. This is the same
    // parser the bundled workbook goes through, so the two cannot disagree about
    // what a column means.
    $rows = bv_xlsx_rows_from_path($stored, 'Consult_Diagnosis_3Y', null, bv_consult_required_columns());

    try {
        bv_consult_validate($rows);
        $result = bv_consult_ingest(
            $pdo, $rows, basename($stored),
            bv_clean($session['full_name'] ?? ''),
            bv_clean($_POST['note'] ?? '')
        );
    } catch (InvalidArgumentException $e) {
        respond(422, ['success' => false, 'message' => $e->getMessage()]);
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        respond(500, ['success' => false, 'message' => $e->getMessage()]);
    }

    // Belt-and-braces: arima_service.py re-checks the active version id before
    // serving, so this only makes the refresh immediate rather than making it
    // happen at all. A false here is not an error.
    $result['analyticsNotified'] = bv_analytics_invalidate_disease();

    respond(200, [
        'success' => true,
        'message' => 'Upload complete. ' . number_format($result['rowsTotal']) . ' consultations are now active.',
        'data'    => $result,
    ]);
}

function actionVersions(PDO $pdo)
{
    setupDatasetVersionTables($pdo);
    $rows = $pdo->query("SELECT id, filename, uploaded_by, uploaded_at, row_count, source_row_count,
                                covers_from_date, covers_through_date, note, is_active
                         FROM dataset_versions ORDER BY id DESC")->fetchAll();
    respond(200, ['success' => true, 'data' => $rows]);
}

/** Rollback and roll-forward are the same operation: point at a different version. */
function actionActivate(PDO $pdo, $versionId)
{
    setupDatasetVersionTables($pdo);
    $versionId = (int) $versionId;
    $stmt = $pdo->prepare("SELECT id FROM dataset_versions WHERE id = :v");
    $stmt->execute([':v' => $versionId]);
    if (!$stmt->fetchColumn()) {
        respond(404, ['success' => false, 'message' => 'That dataset version does not exist.']);
    }

    $pdo->beginTransaction();
    try {
        $pdo->exec("UPDATE dataset_versions SET is_active = 0 WHERE is_active = 1");
        $pdo->prepare("UPDATE dataset_versions SET is_active = 1 WHERE id = :v")->execute([':v' => $versionId]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        respond(500, ['success' => false, 'message' => 'Could not switch dataset version.']);
    }

    bv_analytics_invalidate_disease();
    respond(200, ['success' => true, 'message' => 'Dataset version ' . $versionId . ' is now active.']);
}

$action = bv_clean($_POST['action'] ?? $_GET['action'] ?? 'versions');

try {
    if ($action === 'upload')   actionUpload($pdo, $session);
    if ($action === 'versions') actionVersions($pdo);
    if ($action === 'activate') actionActivate($pdo, $_POST['versionId'] ?? $_GET['versionId'] ?? 0);
    respond(400, ['success' => false, 'message' => 'Unknown action: ' . $action]);
} catch (Throwable $e) {
    error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
    respond(500, ['success' => false, 'message' => 'Dataset request failed.']);
}

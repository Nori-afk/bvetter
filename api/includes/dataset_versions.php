<?php
/**
 * BVetter — uploaded consultation dataset: storage, versioning, activation.
 *
 * WHY THIS EXISTS
 * The disease pipeline used to read database/BaliwagVet_2023-2025.xlsx on every
 * request, in two runtimes (PHP's bv_xlsx_rows(), Python's read_excel_sheet()).
 * That froze the dataset at whatever shipped with the repo and put an XLSX parse
 * on the hot path. The clinic now uploads its own Consult_Diagnosis_3Y-shaped
 * workbook and it lands here instead.
 *
 * VERSIONING MODEL (decided 2026-08-25)
 * Every upload creates a NEW dataset_versions row and materialises a COMPLETE
 * snapshot of the data as of that upload. A snapshot is built as:
 *
 *     version N  =  (rows of the currently-active version)
 *                   UPSERT (rows of the uploaded file)   [key: consultation_id]
 *
 * so a monthly top-up file merges into what is already there, and re-uploading
 * an identical file is a no-op on row count. Only the row with is_active = 1 is
 * ever read by the app, so rollback is a pointer flip and never moves data.
 *
 * The unique key is (dataset_version_id, consultation_id), NOT consultation_id
 * alone. That distinction is load-bearing: with a global unique key an upload
 * would rewrite existing rows onto the new version, leaving the previous version
 * holding nothing, and "rollback" would silently restore an empty dataset.
 *
 * KNOWN CONSEQUENCE OF MERGING: deletions do not propagate. If a corrected file
 * drops five rows, those five survive in the merged snapshot, because a merge
 * cannot distinguish "removed on purpose" from "not included in this file".
 *
 * covers_from_date / covers_through_date are computed here at ingest time and
 * stored. Nothing consumes them yet — they exist for the manual-entry date
 * guard, which will read the active version's covered range rather than
 * recomputing it. Storing them now avoids a later migration.
 */

require_once __DIR__ . '/dataset.php';

/** Sheet columns, in the snake_case form bv_xlsx_rows() normalises headers to. */
function bv_consult_columns()
{
    return [
        'consultation_id', 'consultation_date', 'year', 'month_no', 'month',
        'barangay_id', 'barangay', 'animal_group', 'diagnosis', 'disease_category',
        'symptom_cluster', 'cases_reported', 'frequency_code', 'frequency_description',
        'season_pattern', 'risk_level', 'basis', 'system_use',
    ];
}

/**
 * Columns an upload MUST carry. Deliberately short: these are the ones the
 * forecasting pipeline and the reports actually read. Everything else is
 * carried through when present and stored NULL when absent, so a clinic export
 * missing an advisory column is still usable rather than rejected outright.
 */
function bv_consult_required_columns()
{
    return ['consultation_id', 'year', 'month_no', 'barangay', 'diagnosis'];
}

function setupDatasetVersionTables($pdo)
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS dataset_versions (
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            filename            VARCHAR(255) NOT NULL,
            uploaded_by         VARCHAR(160) NULL,
            uploaded_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
            row_count           INT          NOT NULL DEFAULT 0,
            source_row_count    INT          NOT NULL DEFAULT 0,
            covers_from_date    DATE         NULL,
            covers_through_date DATE         NULL,
            note                VARCHAR(255) NULL,
            is_active           TINYINT(1)   NOT NULL DEFAULT 0,
            KEY idx_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    // DATE, not TIMESTAMP, for the covers_* columns on purpose: connection.php
    // pins the MySQL session to +08:00, and TIMESTAMP columns are converted on
    // read, which could shift a coverage boundary across a month end.
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS historical_consultations (
            id                    INT AUTO_INCREMENT PRIMARY KEY,
            dataset_version_id    INT          NOT NULL,
            consultation_id       VARCHAR(64)  NOT NULL,
            consultation_date     DATE         NULL,
            year                  SMALLINT     NOT NULL,
            month_no              TINYINT      NOT NULL,
            month                 VARCHAR(20)  NULL,
            barangay_id           INT          NULL,
            barangay              VARCHAR(120) NOT NULL,
            animal_group          VARCHAR(60)  NULL,
            diagnosis             VARCHAR(160) NOT NULL,
            disease_category      VARCHAR(80)  NULL,
            symptom_cluster       VARCHAR(255) NULL,
            cases_reported        INT          NOT NULL DEFAULT 1,
            frequency_code        VARCHAR(10)  NULL,
            frequency_description VARCHAR(80)  NULL,
            season_pattern        VARCHAR(60)  NULL,
            risk_level            VARCHAR(20)  NULL,
            basis                 VARCHAR(255) NULL,
            system_use            VARCHAR(255) NULL,
            UNIQUE KEY uq_version_consult (dataset_version_id, consultation_id),
            KEY idx_version_period (dataset_version_id, year, month_no),
            KEY idx_version_diag (dataset_version_id, diagnosis),
            CONSTRAINT fk_hc_version FOREIGN KEY (dataset_version_id)
                REFERENCES dataset_versions(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

/**
 * The PDO handle, if this process has one. bv_sheet_rows() is called from
 * contexts that may not have included connection.php, so this never throws —
 * no handle simply means "fall back to the bundled Excel".
 */
function bv_dataset_pdo()
{
    global $pdo;
    return ($pdo instanceof PDO) ? $pdo : null;
}

/** The active version row, or null when nothing has been uploaded yet. */
function bv_active_dataset_version($pdo = null)
{
    $pdo = $pdo ?: bv_dataset_pdo();
    if (!$pdo) return null;
    try {
        $row = $pdo->query("SELECT id, filename, uploaded_by, uploaded_at, row_count,
                                   source_row_count, covers_from_date, covers_through_date, note
                            FROM dataset_versions WHERE is_active = 1 LIMIT 1")->fetch();
        return $row ?: null;
    } catch (Throwable $e) {
        // The table not existing yet (fresh install, migration not run) is a
        // normal state rather than an error: the Excel fallback covers it.
        return null;
    }
}

/**
 * The date range the active uploaded dataset OWNS, or null when nothing has
 * been uploaded.
 *
 * THIS IS THE SINGLE SOURCE OF TRUTH for the covered range. It reads the
 * covers_from_date / covers_through_date stored on the version at ingest time
 * rather than recomputing a MAX() somewhere else, so the forecasting pipeline,
 * the reports and the manual-entry guard can never disagree about where the
 * boundary is.
 *
 * WHY ANYTHING NEEDS THIS. Live visit records are only used for months AFTER
 * the uploaded data ends (see load_db_consult_rows in
 * api/analytics/arima_service.py) -- otherwise a month present in both sources
 * would be counted twice. While the bundled workbook ended in 2025-12 that
 * boundary sat far in the past and never mattered. Once a clinic uploads
 * through last month, it lands exactly where vets are working, and a visit
 * entered for a covered month would be silently dropped from every chart with
 * no error shown. Returning the range here lets entry be blocked up front with
 * a reason, instead of being ignored later without one.
 *
 * @return array{from:string,through:string,versionId:int}|null
 */
function bv_active_upload_coverage($pdo = null)
{
    $version = bv_active_dataset_version($pdo);
    if (!$version) return null;
    $through = trim((string) ($version['covers_through_date'] ?? ''));
    if ($through === '') return null;
    return [
        'from'      => trim((string) ($version['covers_from_date'] ?? '')),
        'through'   => $through,
        'versionId' => (int) $version['id'],
    ];
}

/**
 * The first date a vet may still enter manually: the day after the uploaded
 * data ends. Null when no upload exists, meaning no restriction applies.
 */
function bv_manual_entry_allowed_from($pdo = null)
{
    $coverage = bv_active_upload_coverage($pdo);
    if (!$coverage) return null;
    try {
        $date = new DateTime($coverage['through']);
    } catch (Throwable $e) {
        return null;
    }
    $date->modify('+1 day');
    return $date->format('Y-m-d');
}

/**
 * The active version's rows, shaped exactly like bv_sheet_rows() returns them
 * so the call sites cannot tell the difference. Returns null (not []) when
 * there is no active version, so the caller can distinguish "nothing uploaded
 * yet, use Excel" from "an upload exists and is legitimately empty".
 */
function bv_active_consult_rows($pdo = null)
{
    $pdo = $pdo ?: bv_dataset_pdo();
    if (!$pdo) return null;

    $version = bv_active_dataset_version($pdo);
    if (!$version) return null;

    try {
        $cols = implode(', ', bv_consult_columns());
        $stmt = $pdo->prepare("SELECT $cols FROM historical_consultations
                               WHERE dataset_version_id = :v
                               ORDER BY year, month_no, consultation_id");
        $stmt->execute([':v' => (int) $version['id']]);
        $rows = $stmt->fetchAll();
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        return null;
    }

    // Match the Excel reader's types: it yields numerics as PHP numbers, and
    // several call sites do (int) casts or numeric comparisons on these.
    foreach ($rows as &$row) {
        $row['year']           = (int) $row['year'];
        $row['month_no']       = (int) $row['month_no'];
        $row['cases_reported'] = (int) $row['cases_reported'];
        $row['barangay_id']    = $row['barangay_id'] === null ? '' : (int) $row['barangay_id'];
        foreach ($row as $key => $value) {
            if ($value === null) $row[$key] = '';
        }
    }
    unset($row);

    return $rows;
}

/**
 * Excel stores dates as day-serials, so an uploaded file yields 44934 where the
 * DB wants 2023-01-01. Anything unparseable becomes NULL rather than a guess —
 * year/month_no still carry the period, and those are what the pipeline groups on.
 */
function bv_consult_normalize_date($value)
{
    $value = bv_clean($value);
    if ($value === '') return null;
    if (is_numeric($value)) $value = bv_excel_serial_to_date($value);
    $value = substr((string) $value, 0, 10);
    $parts = date_parse($value);
    if ($parts['error_count'] > 0
        || !checkdate((int) $parts['month'], (int) $parts['day'], (int) $parts['year'])) {
        return null;
    }
    return $value;
}

/**
 * Rejects a file before any of it reaches the database. Every check here is
 * about the file being internally coherent; cross-file concerns (does this
 * overlap live records?) are deliberately not this function's business.
 *
 * Throws InvalidArgumentException so the library stays usable outside a request
 * — the HTTP endpoint catches and turns it into a 422.
 */
function bv_consult_validate(array $rows)
{
    if (!$rows) {
        throw new InvalidArgumentException(
            'No consultation rows found in that file. Expected a sheet with these columns: '
            . implode(', ', bv_consult_required_columns()));
    }

    $missing = array_diff(bv_consult_required_columns(), array_keys($rows[0]));
    if ($missing) {
        throw new InvalidArgumentException(
            'That file is missing required columns: ' . implode(', ', $missing)
            . '. Found instead: ' . implode(', ', array_keys($rows[0])));
    }

    $blank = 0;
    $seen = [];
    $duplicates = [];
    $badPeriod = 0;

    foreach ($rows as $row) {
        $id = bv_clean($row['consultation_id'] ?? '');
        if ($id === '') {
            $blank += 1;
        } elseif (isset($seen[$id])) {
            if (count($duplicates) < 5) $duplicates[] = $id;
        } else {
            $seen[$id] = true;
        }

        $year = (int) ($row['year'] ?? 0);
        $month = (int) ($row['month_no'] ?? 0);
        if ($year < 2000 || $year > 2100 || $month < 1 || $month > 12) $badPeriod += 1;
    }

    if ($blank > 0) {
        throw new InvalidArgumentException(
            "$blank row(s) have a blank consultation_id. Every consultation needs an id — "
            . 'it is the key that makes re-uploading the same file safe.');
    }
    if ($duplicates) {
        throw new InvalidArgumentException(
            'Duplicate consultation_id(s) inside the file. Examples: ' . implode(', ', $duplicates));
    }
    if ($badPeriod > 0) {
        throw new InvalidArgumentException("$badPeriod row(s) have an invalid year or month_no.");
    }
}

/** Rows per multi-row INSERT. 19 placeholders each, well inside MySQL's 65,535. */
if (!defined('BV_CONSULT_CHUNK')) define('BV_CONSULT_CHUNK', 400);

/**
 * Builds a new version as (previous active version) UPSERT (uploaded rows), then
 * makes it active.
 *
 * Everything runs in ONE transaction and activation is the LAST statement, so a
 * failure anywhere leaves the previously active version untouched: an upload
 * either fully lands or changes nothing at all. That is what makes this safe to
 * run against a live system.
 */
function bv_consult_ingest(PDO $pdo, array $rows, $filename, $uploadedBy = '', $note = '')
{
    setupDatasetVersionTables($pdo);

    $columns = bv_consult_columns();
    $columnList = implode(', ', $columns);
    $previous = bv_active_dataset_version($pdo);
    $previousId = $previous ? (int) $previous['id'] : null;

    $pdo->beginTransaction();
    try {
        $pdo->prepare("INSERT INTO dataset_versions (filename, uploaded_by, source_row_count, note, is_active)
                       VALUES (:filename, :by, :src, :note, 0)")
            ->execute([
                ':filename' => $filename,
                ':by'       => $uploadedBy !== '' ? $uploadedBy : null,
                ':src'      => count($rows),
                ':note'     => $note !== '' ? $note : null,
            ]);
        $versionId = (int) $pdo->lastInsertId();

        // Carry the current dataset forward in SQL rather than through PHP
        // memory: a monthly top-up file must not silently discard the other
        // ~4,900 rows, and copying 2.5 MB through PHP arrays would be wasteful.
        $carried = 0;
        if ($previousId) {
            $copy = $pdo->prepare("INSERT INTO historical_consultations (dataset_version_id, $columnList)
                                   SELECT :new, $columnList FROM historical_consultations
                                   WHERE dataset_version_id = :old");
            $copy->execute([':new' => $versionId, ':old' => $previousId]);
            $carried = $copy->rowCount();
        }

        // ON DUPLICATE KEY UPDATE is what makes a re-upload a no-op and a
        // correction an update: the key is (dataset_version_id, consultation_id),
        // so the file's rows overwrite the carried-forward copies in place.
        $updates = implode(', ', array_map(
            fn($column) => "$column = VALUES($column)",
            array_slice($columns, 1)   // consultation_id is the key; never updated
        ));
        $placeholders = '(' . implode(', ', array_fill(0, count($columns) + 1, '?')) . ')';

        foreach (array_chunk($rows, BV_CONSULT_CHUNK) as $chunk) {
            $values = [];
            $params = [];
            foreach ($chunk as $row) {
                $values[] = $placeholders;
                $params[] = $versionId;
                foreach ($columns as $column) {
                    $raw = $row[$column] ?? '';
                    if ($column === 'consultation_date') {
                        $params[] = bv_consult_normalize_date($raw);
                    } elseif ($column === 'year' || $column === 'month_no') {
                        $params[] = (int) $raw;
                    } elseif ($column === 'cases_reported') {
                        $params[] = max(0, (int) (bv_clean($raw) === '' ? 1 : $raw));
                    } elseif ($column === 'barangay_id') {
                        $params[] = bv_clean($raw) === '' ? null : (int) $raw;
                    } else {
                        $clean = bv_clean($raw);
                        $params[] = $clean === '' ? null : $clean;
                    }
                }
            }
            $pdo->prepare("INSERT INTO historical_consultations (dataset_version_id, $columnList)
                           VALUES " . implode(', ', $values) . "
                           ON DUPLICATE KEY UPDATE $updates")->execute($params);
        }

        // Coverage is derived from what actually LANDED, not from the file, so a
        // merged version reports the full span it now holds. LAST_DAY covers rows
        // whose consultation_date was unparseable: the month is still known.
        $stmt = $pdo->prepare("
            SELECT COUNT(*) AS n,
                   MIN(COALESCE(consultation_date,
                       STR_TO_DATE(CONCAT(year,'-',LPAD(month_no,2,'0'),'-01'), '%Y-%m-%d'))) AS from_date,
                   MAX(COALESCE(consultation_date,
                       LAST_DAY(STR_TO_DATE(CONCAT(year,'-',LPAD(month_no,2,'0'),'-01'), '%Y-%m-%d')))) AS through_date
            FROM historical_consultations WHERE dataset_version_id = :v");
        $stmt->execute([':v' => $versionId]);
        $summary = $stmt->fetch();

        $pdo->prepare("UPDATE dataset_versions
                       SET row_count = :n, covers_from_date = :from, covers_through_date = :through
                       WHERE id = :v")
            ->execute([
                ':n'       => (int) $summary['n'],
                ':from'    => $summary['from_date'],
                ':through' => $summary['through_date'],
                ':v'       => $versionId,
            ]);

        $pdo->exec("UPDATE dataset_versions SET is_active = 0 WHERE is_active = 1");
        $pdo->prepare("UPDATE dataset_versions SET is_active = 1 WHERE id = :v")
            ->execute([':v' => $versionId]);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw new RuntimeException('The upload could not be saved: ' . $e->getMessage(), 0, $e);
    }

    return [
        'versionId'     => $versionId,
        'rowsInFile'    => count($rows),
        'rowsCarried'   => $carried,
        'rowsTotal'     => (int) $summary['n'],
        'rowsAdded'     => (int) $summary['n'] - $carried,
        'coversFrom'    => $summary['from_date'],
        'coversThrough' => $summary['through_date'],
        'previousId'    => $previousId,
    ];
}

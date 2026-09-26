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
 * stored, and describe the file's actual first and last dates. The boundary the
 * rest of the system uses is the last MONTH instead -- see bv_upload_last_month().
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
 * no handle simply means "no uploaded dataset is reachable".
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
        // normal state rather than an error: it reads as "nothing uploaded".
        return null;
    }
}

/**
 * The last month the active upload holds, as 'Y-m', or null when nothing is
 * active.
 *
 * THIS IS THE BOUNDARY. The upload owns every month up to and including this
 * one, in full; typed visits count only after it (see
 * api/includes/case_timeline.php). Whole months rather than the last date,
 * because everything downstream -- the charts, the forecasts, the workbook's own
 * year/month_no columns -- works in months: a boundary on Aug 14 would leave
 * August half one source and half the other.
 *
 * Read from year/month_no rather than covers_through_date, because those are
 * the columns _latest_period() in api/analytics/arima_service.py reads. The two
 * runtimes therefore cannot place the boundary in different months even when a
 * row's consultation_date disagrees with its month columns.
 *
 * Cached per active version, not per request: an upload asks before and after
 * it changes the active version, and must get two different answers.
 */
function bv_upload_last_month($pdo = null)
{
    static $byVersion = [];

    $pdo = $pdo ?: bv_dataset_pdo();
    $version = bv_active_dataset_version($pdo);
    if (!$pdo || !$version) return null;

    $versionId = (int) $version['id'];
    if (!array_key_exists($versionId, $byVersion)) {
        try {
            $stmt = $pdo->prepare("SELECT MAX(year * 100 + month_no) FROM historical_consultations
                                   WHERE dataset_version_id = :v AND month_no BETWEEN 1 AND 12");
            $stmt->execute([':v' => $versionId]);
            $key = (int) $stmt->fetchColumn();
        } catch (Throwable $e) {
            error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
            return null;
        }
        $byVersion[$versionId] = $key > 0
            ? sprintf('%04d-%02d', intdiv($key, 100), $key % 100)
            : null;
    }
    return $byVersion[$versionId];
}

/**
 * The date range the active uploaded dataset OWNS, or null when nothing has
 * been uploaded.
 *
 * `through` is the last day of bv_upload_last_month(), not the last
 * consultation date in the file. An upload owns whole months, so a file whose
 * last consultation is Aug 14 owns August through the 31st. Using the raw date
 * let vets type Aug 15-31 visits that the forecaster then dropped without a
 * word, because it had already given August to the upload.
 *
 * WHY ANYTHING NEEDS THIS. Typed visits only count in months AFTER the upload
 * (see api/includes/case_timeline.php), so a visit entered for a covered month
 * would be saved and then left out of every chart with no error shown.
 * Returning the range here lets entry be blocked up front with a reason.
 *
 * @return array{from:string,through:string,versionId:int}|null
 */
function bv_active_upload_coverage($pdo = null)
{
    $version = bv_active_dataset_version($pdo);
    if (!$version) return null;
    $lastMonth = bv_upload_last_month($pdo);
    if ($lastMonth === null) return null;
    return [
        'from'      => trim((string) ($version['covers_from_date'] ?? '')),
        'through'   => date('Y-m-t', strtotime($lastMonth . '-01')),
        'versionId' => (int) $version['id'],
    ];
}

/**
 * The first date a vet may still enter manually: the first day of the month
 * after the upload's last month. Null when no upload exists, meaning no
 * restriction applies.
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
 * yet" from "an upload exists and is legitimately empty".
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

    /* Cases per consultation, on each side of the merge.
     *
     * WHY THIS IS MEASURED. cases_reported is not a required column, so a file
     * can omit it or fill it with a constant and still validate -- and every
     * blank silently becomes 1 in the loop below. That is not hypothetical: a
     * year's upload arrived with a flat 1 on all 2,638 rows against real
     * records averaging 1.53, which understated that year's case counts by
     * about a third and flattened the merged series exactly where it should
     * have continued. Nothing on screen said so, and it took two days to find.
     *
     * Reported rather than rejected. A clinic may legitimately change how it
     * encodes multiplicity, and refusing the upload would be wrong; the caller
     * shows the two figures so a person can tell which it is.
     */
    $fileCases = 0;
    foreach ($rows as $row) {
        $raw = bv_clean($row['cases_reported'] ?? '');
        $fileCases += max(0, (int) ($raw === '' ? 1 : $raw));
    }
    $fileRatio = $rows ? $fileCases / count($rows) : 0.0;

    $priorRatio = null;
    if ($previousId) {
        $prior = $pdo->prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cases_reported), 0) AS c
                                FROM historical_consultations WHERE dataset_version_id = :v");
        $prior->execute([':v' => $previousId]);
        $priorRow = $prior->fetch();
        if ((int) ($priorRow['n'] ?? 0) > 0) {
            $priorRatio = (float) $priorRow['c'] / (int) $priorRow['n'];
        }
    }
    // 15%: the real years sit within 1% of each other (1.53-1.54), so this
    // clears normal variation comfortably while catching the 1.00-vs-1.53 case.
    $ratioMismatch = $priorRatio !== null && $priorRatio > 0
        && abs($fileRatio - $priorRatio) / $priorRatio > 0.15;

    // Before the transaction, not inside it: CREATE TABLE commits implicitly in
    // MySQL, which would end the transaction below before anything was written.
    require_once __DIR__ . '/patient_tables.php';
    setupDiseaseCatalog($pdo);

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

        // Checked after the merge, on what actually landed: the new version now
        // holds the file's row wherever the two shared an id, so comparing it
        // with the version it was built from finds every id the file reused for
        // a different consultation. See bv_version_id_conflicts().
        if ($previousId) {
            $conflicts = bv_version_id_conflicts($pdo, $versionId, $previousId);
            if ($conflicts['count'] > 0) {
                throw new InvalidArgumentException(
                    'This file is a different dataset from the one in use: '
                    . number_format($conflicts['count']) . ' of its consultation ids already belong to other '
                    . 'consultations (for example, ' . implode('; ', $conflicts['examples']) . '). '
                    . 'Merging it would mix two datasets under the same ids, so nothing was changed.'
                );
            }
        }

        // A diagnosis the catalog has never seen would otherwise be counted in
        // Historical but missing from the vet's diagnosis list, and from every
        // count that filters typed visits by the catalog. Inside the transaction
        // so a rejected upload adds nothing.
        $newDiagnoses = bv_catalog_add_from_rows($pdo, $rows);

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
    } catch (InvalidArgumentException $e) {
        // A rejection written for the encoder; passed through as-is so the
        // endpoint answers 422 with it rather than a generic save failure.
        $pdo->rollBack();
        throw $e;
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
        'casesPerRowFile'  => round($fileRatio, 2),
        'casesPerRowPrior' => $priorRatio === null ? null : round($priorRatio, 2),
        'casesPerRowMismatch' => $ratioMismatch,
        'newDiagnoses'        => $newDiagnoses,
    ];
}

/**
 * Consultation ids that two versions use for DIFFERENT consultations.
 *
 * WHY THIS EXISTS. Uploads merge on consultation_id, which only works if an id
 * means the same consultation in every file. It does not have to: the bundled
 * BaliwagVet_2023-2025.xlsx and the clinic's own workbook both number from
 * CONS-2023-00001, and 825 ids appear in both without one of them describing
 * the same visit. Merged, the file's rows overwrite unrelated consultations and
 * the rest of the old dataset rides along, producing a mix of two datasets that
 * passes every other check.
 *
 * A row counts as a different consultation only when date, barangay AND
 * diagnosis all differ. A correction changes one or two of those; a reused id
 * changes all three.
 *
 * Used for both entry points, because both would put different records under
 * the same ids: bv_consult_ingest() compares the version it just built with the
 * one it merged onto, and actionActivate() compares the target with the active
 * version -- so an earlier version of the same dataset can still be switched
 * back to, and a different dataset cannot.
 *
 * @return array{count:int, examples:string[]}
 */
function bv_version_id_conflicts(PDO $pdo, $versionA, $versionB, $exampleLimit = 3)
{
    $where = "FROM historical_consultations a
              JOIN historical_consultations b
                ON b.consultation_id = a.consultation_id AND b.dataset_version_id = :b
              WHERE a.dataset_version_id = :a
                AND NOT (a.consultation_date <=> b.consultation_date)
                AND NOT (LOWER(TRIM(a.barangay))  <=> LOWER(TRIM(b.barangay)))
                AND NOT (LOWER(TRIM(a.diagnosis)) <=> LOWER(TRIM(b.diagnosis)))";
    $params = [':a' => (int) $versionA, ':b' => (int) $versionB];

    $count = $pdo->prepare("SELECT COUNT(*) $where");
    $count->execute($params);
    $total = (int) $count->fetchColumn();
    if ($total === 0) return ['count' => 0, 'examples' => []];

    $sample = $pdo->prepare("SELECT a.consultation_id,
                                    a.consultation_date AS a_date, a.barangay AS a_barangay, a.diagnosis AS a_diagnosis,
                                    b.consultation_date AS b_date, b.barangay AS b_barangay, b.diagnosis AS b_diagnosis
                             $where ORDER BY a.consultation_id LIMIT " . max(1, (int) $exampleLimit));
    $sample->execute($params);

    $describe = fn($date, $barangay, $diagnosis) =>
        ($date ? date('M j, Y', strtotime((string) $date)) : 'no date') . ' · ' . $barangay . ' · ' . $diagnosis;
    $examples = [];
    foreach ($sample->fetchAll() as $row) {
        $examples[] = $row['consultation_id'] . ' is '
            . $describe($row['b_date'], $row['b_barangay'], $row['b_diagnosis']) . ' in one and '
            . $describe($row['a_date'], $row['a_barangay'], $row['a_diagnosis']) . ' in the other';
    }
    return ['count' => $total, 'examples' => $examples];
}

/**
 * Removes a stored version and every consultation row belonging to it.
 *
 * SAFE ON ANY VERSION EXCEPT THE ACTIVE ONE. Each version owns a complete copy
 * of the data -- bv_consult_ingest() carries the previous version's rows forward
 * into the new one rather than referencing them -- so version 7 reads nothing
 * out of version 6, and deleting an old version can never leave a newer one
 * short of rows.
 *
 * The active version is refused rather than handled. Deleting it would leave
 * the whole system with no consultation dataset and no other signal, which is a
 * different operation from "tidy up an old upload" and deserves to be an
 * explicit switch first.
 *
 * The uploaded .xlsx is deliberately LEFT on disk. bv_upload_store_file() keeps
 * the original so a figure questioned months later can be traced to the file
 * that produced it, and dropping the parsed rows does not retire that argument.
 *
 * @return array{ok:bool,reason?:string,filename?:string,rows?:int}
 */
function bv_delete_dataset_version(PDO $pdo, $versionId)
{
    setupDatasetVersionTables($pdo);
    $versionId = (int) $versionId;

    $stmt = $pdo->prepare("SELECT id, filename, row_count, is_active
                           FROM dataset_versions WHERE id = :v");
    $stmt->execute([':v' => $versionId]);
    $version = $stmt->fetch();

    if (!$version)                        return ['ok' => false, 'reason' => 'missing'];
    if ((int) $version['is_active'] === 1) return ['ok' => false, 'reason' => 'active'];

    // One statement, not two: historical_consultations.dataset_version_id is
    // ON DELETE CASCADE, so the rows go with the version and there is no window
    // where the version is gone but its rows are not.
    $pdo->prepare("DELETE FROM dataset_versions WHERE id = :v")->execute([':v' => $versionId]);

    return [
        'ok'       => true,
        'filename' => (string) ($version['filename'] ?? ''),
        'rows'     => (int) ($version['row_count'] ?? 0),
    ];
}

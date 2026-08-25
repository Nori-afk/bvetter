<?php

function bv_json_response($statusCode, $payload)
{
    http_response_code($statusCode);
    header('Content-Type: application/json');
    echo json_encode($payload);
    exit;
}

function bv_clean($value)
{
    return trim((string) ($value ?? ''));
}

function bv_project_root()
{
    return dirname(__DIR__, 2);
}

function bv_dataset_path()
{
    return bv_project_root() . DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . 'BaliwagVet_2023-2025.xlsx';
}

function bv_col_letters_to_index($letters)
{
    $index = 0;
    $letters = strtoupper($letters);
    for ($i = 0; $i < strlen($letters); $i += 1) {
        $index = ($index * 26) + (ord($letters[$i]) - 64);
    }
    return $index - 1;
}

function bv_excel_serial_to_date($value)
{
    if (!is_numeric($value)) return $value;
    $base = new DateTime('1899-12-30');
    $base->modify('+' . (int) $value . ' days');
    return $base->format('Y-m-d');
}

function bv_xlsx_shared_strings($zip)
{
    $xml = $zip->getFromName('xl/sharedStrings.xml');
    if ($xml === false) return [];
    $doc = simplexml_load_string($xml);
    if (!$doc) return [];

    $strings = [];
    foreach ($doc->si as $si) {
        if (isset($si->t)) {
            $strings[] = (string) $si->t;
            continue;
        }

        $text = '';
        foreach ($si->r as $run) {
            $text .= (string) $run->t;
        }
        $strings[] = $text;
    }
    return $strings;
}

function bv_xlsx_sheet_path($zip, $sheetName)
{
    $workbookXml = $zip->getFromName('xl/workbook.xml');
    $relsXml = $zip->getFromName('xl/_rels/workbook.xml.rels');
    if ($workbookXml === false || $relsXml === false) return null;

    $workbook = simplexml_load_string($workbookXml);
    $rels = simplexml_load_string($relsXml);
    if (!$workbook || !$rels) return null;

    $workbook->registerXPathNamespace('main', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
    $workbook->registerXPathNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');
    $sheets = $workbook->xpath('//main:sheets/main:sheet');

    $relationshipId = null;
    foreach ($sheets as $sheet) {
        if ((string) $sheet['name'] === $sheetName) {
            $attrs = $sheet->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships');
            $relationshipId = (string) $attrs['id'];
            break;
        }
    }
    if (!$relationshipId) return null;

    foreach ($rels->Relationship as $rel) {
        if ((string) $rel['Id'] === $relationshipId) {
            $target = (string) $rel['Target'];
            return 'xl/' . ltrim($target, '/');
        }
    }
    return null;
}

/** Every sheet name in the workbook, in tab order. */
function bv_xlsx_sheet_names($zip)
{
    $workbookXml = $zip->getFromName('xl/workbook.xml');
    if ($workbookXml === false) return [];
    $workbook = simplexml_load_string($workbookXml);
    if (!$workbook) return [];

    $workbook->registerXPathNamespace('main', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
    $names = [];
    foreach ($workbook->xpath('//main:sheets/main:sheet') as $sheet) {
        $names[] = (string) $sheet['name'];
    }
    return $names;
}

function bv_xlsx_cell_value($cell, $sharedStrings)
{
    $type = (string) $cell['t'];
    if ($type === 'inlineStr') return isset($cell->is->t) ? (string) $cell->is->t : '';
    if (!isset($cell->v)) return '';

    $raw = (string) $cell->v;
    if ($type === 's') {
        $index = (int) $raw;
        return $sharedStrings[$index] ?? '';
    }
    if ($type === 'b') return $raw === '1';
    if (is_numeric($raw)) return $raw + 0;
    return $raw;
}

function bv_xlsx_rows($sheetName, $headerRowNumber)
{
    static $cache = [];
    $cacheKey = $sheetName . ':' . $headerRowNumber;
    if (isset($cache[$cacheKey])) return $cache[$cacheKey];

    $rows = bv_xlsx_rows_from_path(bv_dataset_path(), $sheetName, $headerRowNumber);
    $cache[$cacheKey] = $rows;
    return $rows;
}

/**
 * Header-normalising XLSX reader for an arbitrary file, so an uploaded workbook
 * is parsed by exactly the same code that reads the bundled one — one parser,
 * one set of quirks, no chance of the two disagreeing about what a column means.
 *
 * $headerRowNumber may be null to auto-detect the header row, which is what
 * uploads use: the bundled workbook happens to put headers on row 3, but a
 * clinic export need not, and failing over a blank spacer row would be a
 * miserable error message to debug.
 *
 * $requiredHeaders additionally lets the reader pick the right SHEET: when the
 * named sheet is absent, every sheet is tried and the first one carrying all
 * the required headers wins. That way a workbook whose tab was renamed still
 * imports.
 */
function bv_xlsx_rows_from_path($path, $sheetName, $headerRowNumber = null, $requiredHeaders = [])
{
    if (!file_exists($path) || !class_exists('ZipArchive')) return [];

    $zip = new ZipArchive();
    if ($zip->open($path) !== true) return [];

    $candidates = [];
    if ($sheetName !== null) {
        $named = bv_xlsx_sheet_path($zip, $sheetName);
        if ($named) $candidates[] = $named;
    }
    if (!$candidates) {
        foreach (bv_xlsx_sheet_names($zip) as $name) {
            $candidate = bv_xlsx_sheet_path($zip, $name);
            if ($candidate) $candidates[] = $candidate;
        }
    }
    if (!$candidates) {
        $zip->close();
        return [];
    }

    $sharedStrings = bv_xlsx_shared_strings($zip);
    $rows = [];

    foreach ($candidates as $candidate) {
        $sheetXml = $zip->getFromName($candidate);
        if ($sheetXml === false) continue;
        $sheet = simplexml_load_string($sheetXml);
        if (!$sheet) continue;
        $sheet->registerXPathNamespace('main', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');

        // TWO PASSES OVER THE SAME PARSED XML, not one pass into a PHP buffer.
        // Buffering every row's cell values so the header could be located
        // afterwards meant holding the raw values AND the built records at once:
        // measured 20 MB against the streaming original's 12 MB on
        // Consult_Diagnosis_3Y. SimpleXML already holds the document, so walking
        // sheetData twice is free, and only one row of cell values is ever live.
        $headerRow = null;
        $headers   = [];
        foreach ($sheet->sheetData->row as $row) {
            $rowNumber = (int) $row['r'];
            if ($headerRowNumber !== null && $rowNumber !== $headerRowNumber) continue;

            $values = bv_xlsx_row_values($row, $sharedStrings);
            ksort($values);
            $labels = array_map(fn($value) => bv_normalize_header($value), $values);

            if ($headerRowNumber !== null) {
                $headerRow = $rowNumber;
                $headers   = $labels;
                break;
            }
            // Auto-detect: the first row carrying the columns we need. Falls back
            // to 'year', matching read_excel_sheet()'s probe in
            // api/analytics/arima_service.py so both runtimes agree where data starts.
            $needles = $requiredHeaders ?: ['year'];
            if (!array_diff($needles, array_values($labels))) {
                $headerRow = $rowNumber;
                $headers   = $labels;
                break;
            }
        }
        if ($headerRow === null || !$headers) continue;

        // Wrong sheet for this data: keep looking rather than returning its rows.
        if ($requiredHeaders && array_diff($requiredHeaders, array_values($headers))) continue;

        foreach ($sheet->sheetData->row as $row) {
            $rowNumber = (int) $row['r'];
            if ($rowNumber <= $headerRow) continue;

            $values = bv_xlsx_row_values($row, $sharedStrings);
            $record = [];
            foreach ($headers as $index => $header) {
                if ($header === '') continue;
                $record[$header] = $values[$index] ?? '';
            }
            if (count(array_filter($record, fn($value) => bv_clean($value) !== '')) > 0) {
                $rows[] = $record;
            }
        }
        break;
    }

    $zip->close();
    return $rows;
}

/** One row's cells as [columnIndex => value]. */
function bv_xlsx_row_values($row, $sharedStrings)
{
    $values = [];
    foreach ($row->c as $cell) {
        $ref = (string) $cell['r'];
        preg_match('/^[A-Z]+/', $ref, $matches);
        $values[bv_col_letters_to_index($matches[0] ?? 'A')] = bv_xlsx_cell_value($cell, $sharedStrings);
    }
    return $values;
}

/** The column-name normalisation every reader here shares: "Month No." -> month_no. */
function bv_normalize_header($value)
{
    return strtolower(preg_replace('/[^a-zA-Z0-9]+/', '_', bv_clean($value)));
}

/**
 * Rows for a dataset sheet.
 *
 * Consult_Diagnosis_3Y is served from the DATABASE once the clinic has uploaded
 * a dataset version (see api/includes/dataset_versions.php); the bundled
 * workbook is the fallback until then. The switch lives here, inside the reader,
 * precisely so the five call sites that read this sheet — dashboard.php:234 and
 * :579, patient_tables.php:260, reports.php:110 and :255 — need no changes and
 * cannot drift apart.
 *
 * Every other sheet still comes from the workbook.
 */
function bv_sheet_rows($sheetName)
{
    if ($sheetName === 'Consult_Diagnosis_3Y') {
        // Resolved once per request. `false` means "not looked up yet"; `null`
        // means "looked up, no active version" — the Excel fallback case.
        static $activeRows = false;
        if ($activeRows === false) {
            // Required lazily rather than at file scope: dataset_versions.php
            // requires this file back, and at load time that cycle would leave
            // half of one of them undefined.
            require_once __DIR__ . '/dataset_versions.php';
            $activeRows = bv_active_consult_rows();
        }
        if (is_array($activeRows)) return $activeRows;
    }

    $headerRows = [
        'Dashboard' => 4,
        'Barangay_Disease_Monthly' => 3,
        'Prediction_Ready_Aggregated' => 3,
        'Consult_Diagnosis_3Y' => 3,
        'Disease_Monthly_2023_2025' => 3,
        'Combined_Rabies_3Years' => 3,
        'Combined_DogControl_3Years' => 3,
    ];
    return bv_xlsx_rows($sheetName, $headerRows[$sheetName] ?? 1);
}

function bv_date_from_parts($year, $monthNo, $day = 1)
{
    $year = (int) $year;
    $monthNo = max(1, min(12, (int) $monthNo));
    $day = max(1, min(28, (int) $day));
    if ($year <= 0) return null;
    return sprintf('%04d-%02d-%02d', $year, $monthNo, $day);
}

function bv_row_date($row)
{
    if (!empty($row['date'])) return substr((string) $row['date'], 0, 10);
    if (!empty($row['consultation_date'])) {
        return is_numeric($row['consultation_date'])
            ? bv_excel_serial_to_date($row['consultation_date'])
            : substr((string) $row['consultation_date'], 0, 10);
    }
    if (!empty($row['year']) && !empty($row['month_no'])) {
        return bv_date_from_parts($row['year'], $row['month_no']);
    }
    return null;
}

function bv_date_window($dateType, $startDate = '', $endDate = '')
{
    $today = new DateTime('today');
    $dateType = strtolower(bv_clean($dateType ?: 'month'));

    if ($startDate !== '' || $endDate !== '') {
        return [
            $startDate !== '' ? new DateTime($startDate) : null,
            $endDate !== '' ? new DateTime($endDate) : null,
        ];
    }

    if ($dateType === 'today') return [$today, clone $today];
    if ($dateType === 'week' || $dateType === 'weekly') {
        $start = clone $today;
        $start->modify('-6 days');
        return [$start, $today];
    }
    if ($dateType === 'annual' || $dateType === 'year') {
        return [new DateTime($today->format('Y') . '-01-01'), new DateTime($today->format('Y') . '-12-31')];
    }
    if ($dateType === 'all') return [null, null];

    return [new DateTime($today->format('Y-m-01')), new DateTime($today->format('Y-m-t'))];
}

function bv_filter_by_date($rows, $dateType, $startDate = '', $endDate = '')
{
    [$start, $end] = bv_date_window($dateType, $startDate, $endDate);
    if (!$start && !$end) return $rows;

    return array_values(array_filter($rows, function ($row) use ($start, $end) {
        $date = bv_row_date($row);
        if (!$date) return false;
        $value = new DateTime($date);
        if ($start && $value < $start) return false;
        if ($end && $value > $end) return false;
        return true;
    }));
}

function bv_first_non_empty($row, $keys, $fallback = '')
{
    foreach ($keys as $key) {
        if (isset($row[$key]) && bv_clean($row[$key]) !== '') return $row[$key];
    }
    return $fallback;
}

/**
 * "1 case" / "2 cases" -- KPI subsets are user-facing sentences, and a hard
 * "{$n} cases" reads as broken software the first time $n is 1.
 */
function bv_pluralize($count, $singular, $plural = null)
{
    $count = (int) $count;
    return $count . ' ' . ($count === 1 ? $singular : ($plural ?? $singular . 's'));
}

function bv_count_by($rows, $key)
{
    $counts = [];
    foreach ($rows as $row) {
        $value = bv_clean(is_callable($key) ? $key($row) : ($row[$key] ?? ''));
        if ($value === '') continue;
        $counts[$value] = ($counts[$value] ?? 0) + 1;
    }
    arsort($counts);
    return $counts;
}

function bv_sum_by($rows, $groupKey, $valueKey)
{
    $totals = [];
    foreach ($rows as $row) {
        $group = bv_clean($row[$groupKey] ?? '');
        if ($group === '') continue;
        $totals[$group] = ($totals[$group] ?? 0) + (float) ($row[$valueKey] ?? 0);
    }
    arsort($totals);
    return $totals;
}

function bv_table_exists($pdo, $table)
{
    try {
        $stmt = $pdo->prepare('
            SELECT COUNT(*)
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = :table_name
        ');
        $stmt->execute([':table_name' => $table]);
        return (bool) $stmt->fetchColumn();
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        return false;
    }
}

function bv_column_exists($pdo, $table, $column)
{
    try {
        $stmt = $pdo->prepare("SHOW COLUMNS FROM `$table` LIKE :column_name");
        $stmt->execute([':column_name' => $column]);
        return (bool) $stmt->fetchColumn();
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        return false;
    }
}

function bv_latest_dataset_year()
{
    $years = array_map(fn($row) => (int) ($row['year'] ?? 0), bv_sheet_rows('Dashboard'));
    return max($years ?: [(int) date('Y')]);
}

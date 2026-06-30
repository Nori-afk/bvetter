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
    return bv_project_root() . DIRECTORY_SEPARATOR . 'BaliwagVet_2023-2025.xlsx';
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

    $path = bv_dataset_path();
    if (!file_exists($path) || !class_exists('ZipArchive')) {
        $cache[$cacheKey] = [];
        return [];
    }

    $zip = new ZipArchive();
    if ($zip->open($path) !== true) return [];

    $sheetPath = bv_xlsx_sheet_path($zip, $sheetName);
    if (!$sheetPath) {
        $zip->close();
        return [];
    }

    $sheetXml = $zip->getFromName($sheetPath);
    $sharedStrings = bv_xlsx_shared_strings($zip);
    $zip->close();
    if ($sheetXml === false) return [];

    $sheet = simplexml_load_string($sheetXml);
    if (!$sheet) return [];
    $sheet->registerXPathNamespace('main', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');

    $headers = [];
    $rows = [];
    foreach ($sheet->sheetData->row as $row) {
        $rowNumber = (int) $row['r'];
        $values = [];
        foreach ($row->c as $cell) {
            $ref = (string) $cell['r'];
            preg_match('/^[A-Z]+/', $ref, $matches);
            $index = bv_col_letters_to_index($matches[0] ?? 'A');
            $values[$index] = bv_xlsx_cell_value($cell, $sharedStrings);
        }

        if ($rowNumber === $headerRowNumber) {
            ksort($values);
            $headers = array_map(function ($value) {
                return strtolower(preg_replace('/[^a-zA-Z0-9]+/', '_', bv_clean($value)));
            }, $values);
            continue;
        }

        if ($rowNumber <= $headerRowNumber || !$headers) continue;

        $record = [];
        foreach ($headers as $index => $header) {
            if ($header === '') continue;
            $record[$header] = $values[$index] ?? '';
        }
        if (count(array_filter($record, fn($value) => bv_clean($value) !== '')) > 0) {
            $rows[] = $record;
        }
    }

    $cache[$cacheKey] = $rows;
    return $rows;
}

function bv_sheet_rows($sheetName)
{
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
        return false;
    }
}

function bv_latest_dataset_year()
{
    $years = array_map(fn($row) => (int) ($row['year'] ?? 0), bv_sheet_rows('Dashboard'));
    return max($years ?: [(int) date('Y')]);
}

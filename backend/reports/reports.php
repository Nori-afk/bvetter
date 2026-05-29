<?php

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../includes/dataset.php';

function report_input()
{
    $json = json_decode(file_get_contents('php://input'), true);
    return is_array($json) ? array_merge($_GET, $_POST, $json) : array_merge($_GET, $_POST);
}

function report_category($value)
{
    $value = strtolower(str_replace([' ', '-'], '_', bv_clean($value ?: 'all_patient')));
    $aliases = [
        'all' => 'all_patient',
        'patients' => 'all_patient',
        'all_patients' => 'all_patient',
        'patient_summary' => 'consultation_summary',
        'consultation_and_patient_summary' => 'consultation_summary',
        'consultation' => 'consultation_summary',
        'disease' => 'disease_incidence',
        'disease_incidence_report' => 'disease_incidence',
        'mass_vaccination' => 'mass_vaccination',
        'mass_vaccination_report' => 'mass_vaccination',
        'lost_and_found' => 'lost_found',
        'lost_and_found_report' => 'lost_found',
    ];
    return $aliases[$value] ?? $value;
}

function report_columns($category)
{
    $columns = [
        'all_patient' => [
            ['key' => 'patientId', 'label' => 'Patient ID'],
            ['key' => 'ownerName', 'label' => 'Owner Name'],
            ['key' => 'contactNumber', 'label' => 'Contact Number'],
            ['key' => 'petName', 'label' => 'Pet Name'],
            ['key' => 'petType', 'label' => 'Pet Type'],
            ['key' => 'barangay', 'label' => 'Barangay'],
            ['key' => 'sex', 'label' => 'Sex'],
            ['key' => 'date', 'label' => 'Date'],
        ],
        'consultation_summary' => [
            ['key' => 'consultationId', 'label' => 'Consultation ID'],
            ['key' => 'date', 'label' => 'Date'],
            ['key' => 'barangay', 'label' => 'Barangay'],
            ['key' => 'animalGroup', 'label' => 'Animal Group'],
            ['key' => 'diagnosis', 'label' => 'Diagnosis'],
            ['key' => 'diseaseCategory', 'label' => 'Category'],
            ['key' => 'riskLevel', 'label' => 'Risk Level'],
            ['key' => 'cases', 'label' => 'Cases'],
        ],
        'disease_incidence' => [
            ['key' => 'date', 'label' => 'Month'],
            ['key' => 'barangay', 'label' => 'Barangay'],
            ['key' => 'skinRelatedCases', 'label' => 'Skin'],
            ['key' => 'parasiticCases', 'label' => 'Parasitic'],
            ['key' => 'respiratoryCases', 'label' => 'Respiratory'],
            ['key' => 'gastrointestinalCases', 'label' => 'Gastrointestinal'],
            ['key' => 'totalCases', 'label' => 'Total Cases'],
            ['key' => 'riskClass', 'label' => 'Risk Class'],
        ],
        'mass_vaccination' => [
            ['key' => 'date', 'label' => 'Month'],
            ['key' => 'dogsVaccinated', 'label' => 'Dogs Vaccinated'],
            ['key' => 'catsVaccinated', 'label' => 'Cats Vaccinated'],
            ['key' => 'totalVaccinated', 'label' => 'Total Vaccinated'],
            ['key' => 'clientsServed', 'label' => 'Clients Served'],
            ['key' => 'sourceBasis', 'label' => 'Source Basis'],
        ],
        'lost_found' => [
            ['key' => 'reportId', 'label' => 'Report ID'],
            ['key' => 'date', 'label' => 'Date'],
            ['key' => 'type', 'label' => 'Type'],
            ['key' => 'petName', 'label' => 'Pet Name'],
            ['key' => 'species', 'label' => 'Species'],
            ['key' => 'barangay', 'label' => 'Barangay'],
            ['key' => 'status', 'label' => 'Status'],
            ['key' => 'reporter', 'label' => 'Reporter'],
        ],
    ];
    return $columns[$category] ?? $columns['all_patient'];
}

function dataset_patient_rows()
{
    $rows = [];
    foreach (bv_sheet_rows('Consult_Diagnosis_3Y') as $index => $row) {
        $date = bv_row_date($row);
        $animal = bv_clean($row['animal_group'] ?? 'Patient');
        $diagnosis = bv_clean($row['diagnosis'] ?? '');
        $rows[] = [
            'patientId' => 'PAT-' . str_pad((string) ($index + 1), 5, '0', STR_PAD_LEFT),
            'ownerName' => 'Dataset Owner',
            'contactNumber' => '',
            'petName' => $animal . ' Case ' . ($index + 1),
            'petType' => $animal,
            'barangay' => bv_clean($row['barangay'] ?? ''),
            'sex' => '',
            'date' => $date,
            'disease' => $diagnosis,
            'category' => strtolower($animal),
        ];
    }
    return $rows;
}

function db_patient_rows($pdo)
{
    if (!bv_table_exists($pdo, 'pets')) return [];

    $barangayJoin = bv_table_exists($pdo, 'owner_profiles') && bv_table_exists($pdo, 'barangays')
        ? 'LEFT JOIN owner_profiles op ON op.user_id = pets.owner_id LEFT JOIN barangays b ON b.id = op.barangay_id'
        : '';
    $hasVisits = bv_table_exists($pdo, 'patient_visit_records');
    $visitJoin = $hasVisits ? 'LEFT JOIN patient_visit_records pvr ON pvr.pet_id = pets.id' : '';
    $lastVisitSelect = $hasVisits ? 'MAX(pvr.visit_date)' : 'NULL';
    $diagnosisSelect = $hasVisits ? 'MAX(pvr.diagnosis)' : "''";
    $orderDate = $hasVisits ? 'COALESCE(MAX(pvr.visit_date), pets.created_at)' : 'pets.created_at';

    $sql = "
        SELECT
            pets.id,
            pets.pet_name,
            pets.species,
            pets.breed,
            pets.sex,
            pets.created_at,
            owners.full_name AS owner_name,
            owners.phone_number AS owner_phone,
            " . ($barangayJoin ? "b.name" : "''") . " AS barangay,
            $lastVisitSelect AS last_visit,
            $diagnosisSelect AS diagnosis
        FROM pets
        LEFT JOIN users owners ON owners.id = pets.owner_id
        $barangayJoin
        $visitJoin
        GROUP BY pets.id, pets.pet_name, pets.species, pets.breed, pets.sex, pets.created_at, owners.full_name, owners.phone_number, barangay
        ORDER BY $orderDate DESC
    ";

    try {
        $rows = $pdo->query($sql)->fetchAll();
    } catch (Throwable $e) {
        return [];
    }

    return array_map(function ($row) {
        $type = trim(($row['species'] ?? '') . (($row['breed'] ?? '') ? ' (' . $row['breed'] . ')' : ''));
        return [
            'patientId' => 'PAT-' . str_pad((string) $row['id'], 5, '0', STR_PAD_LEFT),
            'ownerName' => $row['owner_name'] ?: 'N/A',
            'contactNumber' => $row['owner_phone'] ?: '',
            'petName' => $row['pet_name'] ?: 'N/A',
            'petType' => $type ?: 'N/A',
            'barangay' => $row['barangay'] ?: '',
            'sex' => strtoupper(substr((string) ($row['sex'] ?? ''), 0, 1)),
            'date' => $row['last_visit'] ?: substr((string) $row['created_at'], 0, 10),
            'disease' => $row['diagnosis'] ?: '',
            'category' => strtolower($row['species'] ?? ''),
        ];
    }, $rows);
}

function consultation_rows()
{
    $sourceRows = array_values(array_filter(bv_sheet_rows('Consult_Diagnosis_3Y'), fn($row) => !empty($row['consultation_id'])));
    return array_map(function ($row) {
        return [
            'consultationId' => $row['consultation_id'] ?? '',
            'date' => bv_row_date($row),
            'barangay' => $row['barangay'] ?? '',
            'animalGroup' => $row['animal_group'] ?? '',
            'diagnosis' => $row['diagnosis'] ?? '',
            'diseaseCategory' => $row['disease_category'] ?? '',
            'riskLevel' => $row['risk_level'] ?? '',
            'cases' => (int) ($row['cases_reported'] ?? 1),
        ];
    }, $sourceRows);
}

function disease_rows()
{
    $sourceRows = array_values(array_filter(bv_sheet_rows('Barangay_Disease_Monthly'), fn($row) => !empty($row['year']) && !empty($row['month_no']) && bv_clean($row['barangay'] ?? '') !== ''));
    return array_map(function ($row) {
        return [
            'date' => bv_date_from_parts($row['year'] ?? 0, $row['month_no'] ?? 1),
            'barangay' => $row['barangay'] ?? '',
            'skinRelatedCases' => (int) ($row['skin_related_cases'] ?? 0),
            'parasiticCases' => (int) ($row['parasitic_cases'] ?? 0),
            'respiratoryCases' => (int) ($row['respiratory_cases'] ?? 0),
            'gastrointestinalCases' => (int) ($row['gastrointestinal_cases'] ?? 0),
            'totalCases' => (int) ($row['total_cases'] ?? 0),
            'dominantCaseGroup' => $row['dominant_case_group'] ?? '',
            'riskClass' => $row['risk_class'] ?? '',
        ];
    }, $sourceRows);
}

function vaccination_rows()
{
    $sourceRows = array_values(array_filter(bv_sheet_rows('Combined_Rabies_3Years'), fn($row) => !empty($row['year']) && !empty($row['month_no'])));
    return array_map(function ($row) {
        return [
            'date' => bv_date_from_parts($row['year'] ?? 0, $row['month_no'] ?? 1),
            'dogsVaccinated' => (int) ($row['dogs_vaccinated'] ?? 0),
            'catsVaccinated' => (int) ($row['cats_vaccinated'] ?? 0),
            'totalVaccinated' => (int) ($row['total_vaccinated'] ?? 0),
            'clientsServed' => (int) ($row['clients_served'] ?? 0),
            'sourceBasis' => $row['source_basis'] ?? '',
        ];
    }, $sourceRows);
}

function lost_found_rows($pdo)
{
    if (!bv_table_exists($pdo, 'lost_found_reports')) return [];
    try {
        $rows = $pdo->query("
            SELECT
                lfr.id,
                lfr.report_type,
                lfr.pet_name,
                lfr.species,
                lfr.status,
                lfr.created_at,
                users.full_name AS reporter,
                lfr.barangay_name AS barangay
            FROM lost_found_reports lfr
            LEFT JOIN users ON users.id = lfr.owner_id
            ORDER BY lfr.created_at DESC
        ")->fetchAll();
    } catch (Throwable $e) {
        return [];
    }

    return array_map(function ($row) {
        return [
            'reportId' => 'LF-' . str_pad((string) $row['id'], 5, '0', STR_PAD_LEFT),
            'date' => substr((string) $row['created_at'], 0, 10),
            'type' => ucfirst($row['report_type'] ?? ''),
            'petName' => $row['pet_name'] ?? '',
            'species' => $row['species'] ?? '',
            'barangay' => $row['barangay'] ?? '',
            'status' => ucfirst($row['status'] ?? ''),
            'reporter' => $row['reporter'] ?? '',
        ];
    }, $rows);
}

function rows_for_category($pdo, $category)
{
    if ($category === 'consultation_summary') return consultation_rows();
    if ($category === 'disease_incidence') return disease_rows();
    if ($category === 'mass_vaccination') return vaccination_rows();
    if ($category === 'lost_found') return lost_found_rows($pdo);

    $dbRows = db_patient_rows($pdo);
    return $dbRows ?: dataset_patient_rows();
}

function report_metrics($pdo, $filteredRows)
{
    $patientRows = db_patient_rows($pdo) ?: dataset_patient_rows();
    $monthRows = bv_filter_by_date($patientRows, 'month');
    if (!$monthRows) $monthRows = $patientRows;

    $diseaseCounts = bv_count_by($monthRows, fn($row) => $row['disease'] ?? '');
    $barangayCounts = bv_count_by($monthRows, 'barangay');
    $topDisease = array_key_first($diseaseCounts) ?: 'N/A';
    $topBarangay = array_key_first($barangayCounts) ?: 'N/A';

    return [
        'totalPatientsThisMonth' => count($monthRows),
        'mostCommonDisease' => $topDisease,
        'mostActiveBarangay' => $topBarangay,
        'filteredRows' => count($filteredRows),
    ];
}

function sort_rows(&$rows, $direction)
{
    $direction = strtolower($direction) === 'desc' ? -1 : 1;
    usort($rows, function ($left, $right) use ($direction) {
        $leftDate = bv_row_date($left) ?: '';
        $rightDate = bv_row_date($right) ?: '';
        if ($leftDate === $rightDate) return 0;
        return strcmp($leftDate, $rightDate) * $direction;
    });
}

function csv_export($columns, $rows, $filename)
{
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    $out = fopen('php://output', 'w');
    fputcsv($out, array_column($columns, 'label'));
    foreach ($rows as $row) {
        fputcsv($out, array_map(fn($column) => $row[$column['key']] ?? '', $columns));
    }
    fclose($out);
    exit;
}

function pdf_escape($text)
{
    return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], (string) $text);
}

function pdf_export($columns, $rows, $title)
{
    $lines = [$title, 'Generated: ' . date('Y-m-d H:i'), 'Rows: ' . count($rows), ''];
    $lines[] = implode(' | ', array_column($columns, 'label'));
    foreach (array_slice($rows, 0, 32) as $row) {
        $lines[] = implode(' | ', array_map(fn($column) => $row[$column['key']] ?? '', $columns));
    }

    $content = '';
    foreach ($lines as $index => $line) {
        $fontSize = $index === 0 ? 14 : 8;
        $content .= 'BT /F1 ' . $fontSize . ' Tf 36 ' . (800 - ($index * 18)) . ' Td (' . pdf_escape(substr($line, 0, 140)) . ") Tj ET\n";
    }
    $stream = "<< /Length " . strlen($content) . " >>\nstream\n$content\nendstream\n";
    $objects = [
        "%PDF-1.4\n",
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
        "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
        "5 0 obj\n$stream" . "endobj\n",
    ];

    $body = '';
    $offsets = [0];
    foreach ($objects as $object) {
        $offsets[] = strlen($body);
        $body .= $object;
    }
    $xrefOffset = strlen($body);
    $xref = "xref\n0 6\n0000000000 65535 f \n";
    foreach (array_slice($offsets, 1) as $offset) {
        $xref .= str_pad((string) $offset, 10, '0', STR_PAD_LEFT) . " 00000 n \n";
    }
    $xref .= "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n$xrefOffset\n%%EOF";

    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="vbetter-report.pdf"');
    echo $body . $xref;
    exit;
}

$input = report_input();
$category = report_category($input['category'] ?? $input['report_category'] ?? 'all_patient');
$format = strtolower(bv_clean($input['format'] ?? 'json'));
$rows = rows_for_category($pdo, $category);
$rows = bv_filter_by_date($rows, $input['date_type'] ?? $input['dateType'] ?? 'month', $input['start_date'] ?? '', $input['end_date'] ?? '');
sort_rows($rows, $input['sort'] ?? 'asc');

$columns = report_columns($category);
if ($format === 'csv') csv_export($columns, $rows, 'vbetter-' . $category . '-report.csv');
if ($format === 'pdf') pdf_export($columns, $rows, 'VBetter ' . ucwords(str_replace('_', ' ', $category)) . ' Report');

$page = max(1, (int) ($input['page'] ?? 1));
$pageSize = max(1, min(100, (int) ($input['page_size'] ?? $input['pageSize'] ?? 10)));
$total = count($rows);
$pageRows = array_slice($rows, ($page - 1) * $pageSize, $pageSize);

bv_json_response(200, [
    'success' => true,
    'data' => [
        'category' => $category,
        'columns' => $columns,
        'rows' => $pageRows,
        'pagination' => [
            'page' => $page,
            'pageSize' => $pageSize,
            'total' => $total,
            'totalPages' => max(1, (int) ceil($total / $pageSize)),
        ],
        'metrics' => report_metrics($pdo, $rows),
    ],
]);

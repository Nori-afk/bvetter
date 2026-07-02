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

// function db_patient_rows($pdo)
// {
//     if (!bv_table_exists($pdo, 'pets')) return [];

//     $barangayJoin = bv_table_exists($pdo, 'owner_profiles') && bv_table_exists($pdo, 'barangays')
//         ? 'LEFT JOIN owner_profiles op ON op.user_id = pets.owner_id LEFT JOIN barangays b ON b.id = op.barangay_id'
//         : '';
//     $hasVisits = bv_table_exists($pdo, 'patient_visit_records');
//     $visitJoin = $hasVisits ? 'LEFT JOIN patient_visit_records pvr ON pvr.pet_id = pets.id' : '';
//     $lastVisitSelect = $hasVisits ? 'MAX(pvr.visit_date)' : 'NULL';
//     $diagnosisSelect = $hasVisits ? 'MAX(pvr.diagnosis)' : "''";
//     $orderDate = $hasVisits ? 'COALESCE(MAX(pvr.visit_date), pets.created_at)' : 'pets.created_at';

//     $sql = "
//         SELECT
//             pets.id,
//             pets.pet_name,
//             pets.species,
//             pets.breed,
//             pets.sex,
//             pets.created_at,
//             owners.full_name AS owner_name,
//             owners.phone_number AS owner_phone,
//             " . ($barangayJoin ? "b.name" : "''") . " AS barangay,
//             $lastVisitSelect AS last_visit,
//             $diagnosisSelect AS diagnosis
//         FROM pets
//         LEFT JOIN users owners ON owners.id = pets.owner_id
//         $barangayJoin
//         $visitJoin
//         GROUP BY pets.id, pets.pet_name, pets.species, pets.breed, pets.sex, pets.created_at, owners.full_name, owners.phone_number, barangay
//         ORDER BY $orderDate DESC
//     ";

//     try {
//         $rows = $pdo->query($sql)->fetchAll();
//     } catch (Throwable $e) {
//         return [];
//     }

//     return array_map(function ($row) {
//         $type = trim(($row['species'] ?? '') . (($row['breed'] ?? '') ? ' (' . $row['breed'] . ')' : ''));
//         return [
//             'patientId' => 'PAT-' . str_pad((string) $row['id'], 5, '0', STR_PAD_LEFT),
//             'ownerName' => $row['owner_name'] ?: 'N/A',
//             'contactNumber' => $row['owner_phone'] ?: '',
//             'petName' => $row['pet_name'] ?: 'N/A',
//             'petType' => $type ?: 'N/A',
//             'barangay' => $row['barangay'] ?: '',
//             'sex' => strtoupper(substr((string) ($row['sex'] ?? ''), 0, 1)),
//             'date' => $row['last_visit'] ?: substr((string) $row['created_at'], 0, 10),
//             'disease' => $row['diagnosis'] ?: '',
//             'category' => strtolower($row['species'] ?? ''),
//         ];
//     }, $rows);
// }
function db_patient_rows($pdo){
     $barangayJoin ='LEFT JOIN owner_profiles op ON op.user_id = pets.owner_id LEFT JOIN barangays b ON b.id = op.barangay_id';
     $visitJoin ='LEFT JOIN patient_visit_records pvr ON pvr.pet_id = pets.id';
      $lastVisitSelect= 'MAX(pvr.visit_date)';
        $diagnosisSelect= 'MAX(pvr.diagnosis)';
    $orderDate= 'COALESCE(MAX(pvr.visit_date), pets.created_at)';

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
            'contactNumber' => $row['owner_phone'] ?: 'N/A',
            'petName' => $row['pet_name'] ?: 'N/A',
            'petType' => $type ?: 'N/A',
            'barangay' => $row['barangay'] ?: 'N/A',
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
    //ucomment this one kapag meron tayong lost and found sa csv naten which is wala
    // if (!bv_table_exists($pdo, 'lost_found_reports')) return [];
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
            'barangay' => $row['barangay'] ?? 'N/A',
            'status' => ucfirst($row['status'] ?? ''),
            'reporter' => $row['reporter'] ?? 'N/A',
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

function report_metrics($pdo, $filteredRows, $category)
{
    // ── Use most-recent month present in the data, not today ──────────
    function latest_month_in(array $rows, callable $dateGetter): string {
        $months = [];
        foreach ($rows as $r) {
            $d = $dateGetter($r);
            if ($d) $months[] = substr($d, 0, 7); // 'YYYY-MM'
        }
        if (!$months) return date('Y-m');
        rsort($months);
        return $months[0];
    }

    function prev_month(string $ym): string {
        return date('Y-m', strtotime($ym . '-01 -1 month'));
    }

    // ── All Patient & Consultation Summary ──────────────────────────────
    if (in_array($category, ['all_patient', 'consultation_summary'])) {
        $allRows = $category === 'consultation_summary'
            ? consultation_rows()
            : (db_patient_rows($pdo) ?: dataset_patient_rows());

        $now       = latest_month_in($allRows, fn($r) => bv_row_date($r));
        $lastMonth = prev_month($now);

        $thisMonth = array_values(array_filter($allRows, fn($r) => str_starts_with((string)bv_row_date($r), $now)));
        $lastMo    = array_values(array_filter($allRows, fn($r) => str_starts_with((string)bv_row_date($r), $lastMonth)));

        $thisCount = count($thisMonth);
        $lastCount = count($lastMo);
        $diff      = $lastCount > 0
            ? round((($thisCount - $lastCount) / $lastCount) * 100)
            : null;

        $petTypeCounts = bv_count_by($thisMonth, 'petType');
        $barangayCounts = bv_count_by($thisMonth, 'barangay');

        arsort($petTypeCounts);
        arsort($barangayCounts);

        $topPetType = array_key_first($petTypeCounts) ?: 'N/A';
        $topBarangay   = array_key_first($barangayCounts) ?: 'N/A';
        $barangayCount = $barangayCounts[$topBarangay] ?? 0;
        $totalRows     = count($allRows);

        $petKeys = array_keys($petTypeCounts);
        $secondPetType = $petKeys[1] ?? null;
        $petCount = $petTypeCounts[$topPetType] ?? 0;
        $petShare  = $totalRows > 0 ? round(($petCount / $totalRows) * 100) : 0;

        return [
            'left' => [
                'value'  => $thisCount,
                'subset' => $diff !== null
                    ? ($diff >= 0 ? "+{$diff}% vs {$lastMonth}" : "{$diff}% vs {$lastMonth}")
                    : "No data for {$lastMonth}",
                'trend'  => $diff === null ? 'neutral' : ($diff >= 0 ? 'up' : 'down'),
            ],
            'center' => [
                    'value'  => $topPetType,
                    'subset' => $secondPetType
                        ? "{$petShare}% of patients · 2nd: {$secondPetType}"
                        : "{$petShare}% of patients in {$now}",
                    'trend'  => 'neutral',
],
            'right' => [
                'value'  => $topBarangay,
                'subset' => $barangayCount > 0
                    ? "{$barangayCount} " . ($category === 'consultation_summary' ? 'consultations' : 'patients') . " in {$now}"
                    : "No data for {$now}",
                'trend'  => 'neutral',
            ],
        ];
    }

    // ── Disease Incidence ───────────────────────────────────────────────
    if ($category === 'disease_incidence') {
        $allRows = disease_rows();

        $now       = latest_month_in($allRows, fn($r) => $r['date'] ?? '');
        $lastMonth = prev_month($now);

        $thisMonth = array_values(array_filter($allRows, fn($r) => str_starts_with((string)($r['date'] ?? ''), $now)));
        $lastMo    = array_values(array_filter($allRows, fn($r) => str_starts_with((string)($r['date'] ?? ''), $lastMonth)));

        $totalThis = array_sum(array_column($thisMonth, 'totalCases'));
        $totalLast = array_sum(array_column($lastMo,    'totalCases'));
        $diff      = $totalLast > 0
            ? round((($totalThis - $totalLast) / $totalLast) * 100)
            : null;

        $groupTotals = [
            'Skin'             => array_sum(array_column($thisMonth, 'skinRelatedCases')),
            'Parasitic'        => array_sum(array_column($thisMonth, 'parasiticCases')),
            'Respiratory'      => array_sum(array_column($thisMonth, 'respiratoryCases')),
            'Gastrointestinal' => array_sum(array_column($thisMonth, 'gastrointestinalCases')),
        ];
        arsort($groupTotals);
        $dominantGroup      = array_key_first($groupTotals) ?: 'N/A';
        $dominantGroupCount = $groupTotals[$dominantGroup] ?? 0;

        $barangayCases = [];
        foreach ($thisMonth as $r) {
            $b = $r['barangay'] ?? 'Unknown';
            $barangayCases[$b] = ($barangayCases[$b] ?? 0) + (int)($r['totalCases'] ?? 0);
        }
        arsort($barangayCases);
        $topBarangay      = array_key_first($barangayCases) ?: 'N/A';
        $topBarangayCount = $barangayCases[$topBarangay] ?? 0;
        $highRiskCount    = count(array_filter($thisMonth, fn($r) => strtolower($r['riskClass'] ?? '') === 'high'));

        return [
            'left' => [
                'value'  => $totalThis,
                'subset' => $diff !== null
                    ? ($diff >= 0 ? "+{$diff}% vs {$lastMonth}" : "{$diff}% vs {$lastMonth}")
                    : "No data for {$lastMonth}",
                'trend'  => $diff === null ? 'neutral' : ($diff >= 0 ? 'up' : 'down'),
            ],
            'center' => [
                'value'  => $dominantGroup,
                'subset' => "{$dominantGroupCount} cases · " . count($groupTotals) . " groups tracked",
                'trend'  => 'neutral',
            ],
            'right' => [
                'value'  => $topBarangay,
                'subset' => "{$topBarangayCount} cases · {$highRiskCount} high-risk area(s)",
                'trend'  => $highRiskCount > 0 ? 'down' : 'neutral',
            ],
        ];
    }

    // ── Mass Vaccination ────────────────────────────────────────────────
    if ($category === 'mass_vaccination') {
        $allRows = vaccination_rows();

        $now       = latest_month_in($allRows, fn($r) => $r['date'] ?? '');
        $lastMonth = prev_month($now);

        $thisMonth = array_values(array_filter($allRows, fn($r) => str_starts_with((string)($r['date'] ?? ''), $now)));
        $lastMo    = array_values(array_filter($allRows, fn($r) => str_starts_with((string)($r['date'] ?? ''), $lastMonth)));

        $totalThis   = array_sum(array_column($thisMonth, 'totalVaccinated'));
        $totalLast   = array_sum(array_column($lastMo,    'totalVaccinated'));
        $clientsThis = array_sum(array_column($thisMonth, 'clientsServed'));
        $clientsLast = array_sum(array_column($lastMo,    'clientsServed'));
        $dogsThis    = array_sum(array_column($thisMonth, 'dogsVaccinated'));
        $catsThis    = array_sum(array_column($thisMonth, 'catsVaccinated'));

        $ratio = $catsThis > 0
            ? round($dogsThis / $catsThis, 1) . ':1 Dogs:Cats'
            : ($dogsThis > 0 ? 'Dogs only' : 'N/A');

        $diff        = $totalLast > 0
            ? round((($totalThis - $totalLast) / $totalLast) * 100)
            : null;
        $clientsDiff = $clientsLast > 0
            ? round((($clientsThis - $clientsLast) / $clientsLast) * 100)
            : null;

        return [
            'left' => [
                'value'  => $totalThis,
                'subset' => $diff !== null
                    ? ($diff >= 0 ? "+{$diff}% vs {$lastMonth}" : "{$diff}% vs {$lastMonth}")
                    : "No data for {$lastMonth}",
                'trend'  => $diff === null ? 'neutral' : ($diff >= 0 ? 'up' : 'down'),
            ],
            'center' => [
                'value'  => $ratio,
                'subset' => "Dogs: {$dogsThis} · Cats: {$catsThis}",
                'trend'  => 'neutral',
            ],
            'right' => [
                'value'  => $clientsThis,
                'subset' => $clientsDiff !== null
                    ? ($clientsDiff >= 0 ? "+{$clientsDiff}% vs {$lastMonth}" : "{$clientsDiff}% vs {$lastMonth}")
                    : "No data for {$lastMonth}",
                'trend'  => $clientsDiff === null ? 'neutral' : ($clientsDiff >= 0 ? 'up' : 'down'),
            ],
        ];
    }

    // ── Lost & Found ────────────────────────────────────────────────────
    if ($category === 'lost_found') {
        $allRows   = lost_found_rows($pdo);
        $now       = latest_month_in($allRows, fn($r) => $r['date'] ?? '');
        $thisMonth = array_values(array_filter($allRows, fn($r) => str_starts_with((string)($r['date'] ?? ''), $now)));

        $totalThis = count($thisMonth);

        $speciesCounts = bv_count_by($thisMonth, 'species');
        arsort($speciesCounts);
        $topSpecies      = array_key_first($speciesCounts) ?: 'N/A';
        $topSpeciesCount = $speciesCounts[$topSpecies] ?? 0;

        $resolved = count(array_filter($thisMonth, fn($r) => strtolower($r['status'] ?? '') === 'resolved'));
        $rate     = $totalThis > 0 ? round(($resolved / $totalThis) * 100) : 0;
        $pending  = count(array_filter($thisMonth, fn($r) => strtolower($r['status'] ?? '') === 'pending'));

        return [
            'left' => [
                'value'  => $totalThis,
                'subset' => "{$pending} pending review in {$now}",
                'trend'  => 'neutral',
            ],
            'center' => [
                'value'  => $topSpecies !== 'N/A' ? ucfirst($topSpecies) : 'N/A',
                'subset' => $topSpecies !== 'N/A'
                    ? "{$topSpeciesCount} report(s) in {$now}"
                    : "No reports for {$now}",
                'trend'  => 'neutral',
            ],
            'right' => [
                'value'  => "{$rate}%",
                'subset' => "{$resolved} of {$totalThis} cases resolved",
                'trend'  => $rate >= 50 ? 'up' : 'down',
            ],
        ];
    }

    // ── Fallback ────────────────────────────────────────────────────────
    return [
        'left'   => ['value' => 0,     'subset' => '', 'trend' => 'neutral'],
        'center' => ['value' => 'N/A', 'subset' => '', 'trend' => 'neutral'],
        'right'  => ['value' => 'N/A', 'subset' => '', 'trend' => 'neutral'],
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
function generate_trend_svg(array $rows, string $category): string
{
    $monthly = [];
    foreach ($rows as $row) {
        $date = $row['date'] ?? '';
        if (!$date) continue;
        $month = substr($date, 0, 7);
        if (!isset($monthly[$month])) $monthly[$month] = 0;
        if ($category === 'disease_incidence')  $monthly[$month] += (int)($row['totalCases'] ?? 0);
        elseif ($category === 'mass_vaccination') $monthly[$month] += (int)($row['totalVaccinated'] ?? 0);
        else $monthly[$month]++;
    }

    ksort($monthly);
    $months = array_keys($monthly);
    $values = array_values($monthly);
    $count  = count($values);

    if ($count < 2) return '<p style="font-size:7pt;color:#aaa;margin:0;">Not enough data for trend chart.</p>';

    $W = 240; $H = 120;
    $pL = 28; $pR = 8; $pT = 8; $pB = 24;
    $cW = $W - $pL - $pR;
    $cH = $H - $pT - $pB;
    $maxVal = max($values) ?: 1;

    $points = [];
    foreach ($values as $i => $v) {
        $x = $pL + ($i / ($count - 1)) * $cW;
        $y = $pT + $cH - ($v / $maxVal) * $cH;
        $points[] = round($x,1) . ',' . round($y,1);
    }

    $fillPoints = $points[0];
    foreach ($points as $p) $fillPoints .= ' ' . $p;
    $last = end($points); [$lx] = explode(',', $last);
    $fillPoints .= ' ' . $lx . ',' . ($pT + $cH) . ' ' . $pL . ',' . ($pT + $cH);

    $grid = '';
    for ($i = 0; $i <= 4; $i++) {
        $v = round($maxVal * $i / 4);
        $y = $pT + $cH - ($i / 4) * $cH;
        $grid .= '<line x1="'.$pL.'" y1="'.round($y).'" x2="'.($W-$pR).'" y2="'.round($y).'" stroke="#edf2f9" stroke-width="0.5"/>';
        $grid .= '<text x="'.($pL-3).'" y="'.round($y+2).'" text-anchor="end" font-size="5.5" fill="#9aa">'.$v.'</text>';
    }

    $xLabels = '';
    $step = max(1, (int)ceil($count / 5));
    foreach ($months as $i => $m) {
        if ($i % $step !== 0 && $i !== $count - 1) continue;
        $x = $pL + ($i / ($count - 1)) * $cW;
        $xLabels .= '<text x="'.round($x).'" y="'.($H-4).'" text-anchor="middle" font-size="5.5" fill="#9aa">'.date('M y', strtotime($m.'-01')).'</text>';
    }

    $dots = '';
    foreach ($points as $p) {
        [$px,$py] = explode(',', $p);
        $dots .= '<circle cx="'.$px.'" cy="'.$py.'" r="2" fill="#2f9df0" stroke="#fff" stroke-width="0.8"/>';
    }

    $legendLabel = match($category) {
        'mass_vaccination'  => 'Total Vaccinated',
        'disease_incidence' => 'Total Cases',
        default             => 'Consultations',
    };

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '.$W.' '.$H.'" width="'.$W.'" height="'.$H.'">
        '.$grid.'
        <polygon points="'.$fillPoints.'" fill="#2f9df0" fill-opacity="0.08"/>
        <polyline points="'.implode(' ', $points).'" fill="none" stroke="#2f9df0" stroke-width="1.6" stroke-linejoin="round"/>
        '.$dots.'
        '.$xLabels.'
        <rect x="'.$pL.'" y="'.($H-11).'" width="7" height="4" fill="#2f9df0"/>
        <text x="'.($pL+9).'" y="'.($H-8).'" font-size="5.5" fill="#555">'.htmlspecialchars($legendLabel).'</text>
    </svg>';
}

function generate_donut_svg(array $rows, string $category): string
{
    $colors = ['#2f9df0','#0f2a6d','#1728d9','#22c55e','#f59e0b','#ef4444','#8b5cf6'];
    $slices = [];

    if (in_array($category, ['consultation_summary','all_patient'])) {
        $counts = [];
        foreach ($rows as $r) {
            $key = trim($r['diagnosis'] ?? $r['disease'] ?? '');
            if ($key === '') $key = 'Unknown';
            $counts[$key] = ($counts[$key] ?? 0) + 1;
        }
        arsort($counts);
        $top = array_slice($counts, 0, 5, true);
        $rest = array_sum(array_slice($counts, 5));
        if ($rest > 0) $top['Others'] = $rest;
        foreach ($top as $l => $v) $slices[] = ['label' => $l, 'value' => $v];
    } elseif ($category === 'disease_incidence') {
        $slices = [
            ['label' => 'Skin',            'value' => array_sum(array_column($rows,'skinRelatedCases'))],
            ['label' => 'Parasitic',        'value' => array_sum(array_column($rows,'parasiticCases'))],
            ['label' => 'Respiratory',      'value' => array_sum(array_column($rows,'respiratoryCases'))],
            ['label' => 'Gastrointestinal', 'value' => array_sum(array_column($rows,'gastrointestinalCases'))],
        ];
    } elseif ($category === 'mass_vaccination') {
        $slices = [
            ['label' => 'Dogs', 'value' => array_sum(array_column($rows,'dogsVaccinated'))],
            ['label' => 'Cats', 'value' => array_sum(array_column($rows,'catsVaccinated'))],
        ];
    } elseif ($category === 'lost_found') {
        $counts = [];
        foreach ($rows as $r) {
            $sp = ucfirst($r['species'] ?? 'Unknown');
            $counts[$sp] = ($counts[$sp] ?? 0) + 1;
        }
        foreach ($counts as $l => $v) $slices[] = ['label' => $l, 'value' => $v];
    }

    $slices = array_values(array_filter($slices, fn($s) => $s['value'] > 0));
    $total  = array_sum(array_column($slices, 'value'));
    if (!$slices || $total === 0) return '<p style="font-size:7pt;color:#aaa;margin:0;">No data.</p>';

    $W = 240; $H = 120;
    $cx = 60; $cy = 58; $r = 46; $ir = 26;
    $angle = -90;
    $paths = ''; $legend = '';

    foreach ($slices as $i => $slice) {
        $pct      = $slice['value'] / $total;
        $sweep    = $pct * 360;
        $color    = $colors[$i % count($colors)];
        $end      = $angle + $sweep;
        $large    = $sweep > 180 ? 1 : 0;

        $x1  = $cx + $r  * cos(deg2rad($angle));
        $y1  = $cy + $r  * sin(deg2rad($angle));
        $x2  = $cx + $r  * cos(deg2rad($end));
        $y2  = $cy + $r  * sin(deg2rad($end));
        $ix1 = $cx + $ir * cos(deg2rad($angle));
        $iy1 = $cy + $ir * sin(deg2rad($angle));
        $ix2 = $cx + $ir * cos(deg2rad($end));
        $iy2 = $cy + $ir * sin(deg2rad($end));

        $paths .= '<path d="M'.round($ix1,2).' '.round($iy1,2)
            .' L'.round($x1,2).' '.round($y1,2)
            .' A'.$r.' '.$r.' 0 '.$large.' 1 '.round($x2,2).' '.round($y2,2)
            .' L'.round($ix2,2).' '.round($iy2,2)
            .' A'.$ir.' '.$ir.' 0 '.$large.' 0 '.round($ix1,2).' '.round($iy1,2)
            .'Z" fill="'.$color.'" stroke="#fff" stroke-width="1"/>';

        if ($pct > 0.06) {
            $mid = $angle + $sweep / 2;
            $lx  = $cx + ($r * 0.68) * cos(deg2rad($mid));
            $ly  = $cy + ($r * 0.68) * sin(deg2rad($mid));
            $paths .= '<text x="'.round($lx,1).'" y="'.round($ly+2,1).'"
                text-anchor="middle" font-size="6" fill="#fff" font-weight="bold">'.round($pct*100).'%</text>';
        }

        $ly2 = 16 + $i * 14;
        $legend .= '<rect x="130" y="'.$ly2.'" width="7" height="7" fill="'.$color.'"/>';
        $legend .= '<text x="140" y="'.($ly2+6).'" font-size="6" fill="#333">'
            .htmlspecialchars(mb_substr($slice['label'],0,20))
            .' ('.number_format($slice['value']).')</text>';

        $angle = $end;
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '.$W.' '.$H.'" width="'.$W.'" height="'.$H.'">
        '.$paths.'
        <text x="'.$cx.'" y="'.($cy-5).'" text-anchor="middle" font-size="6.5" fill="#777">Total</text>
        <text x="'.$cx.'" y="'.($cy+8).'" text-anchor="middle" font-size="11" font-weight="bold" fill="#0f2a6d">'.number_format($total).'</text>
        '.$legend.'
    </svg>';
}

function pdf_export($columns, $rows, $category, $title, $input = [])
{
    require_once __DIR__ . '/../../vendor/autoload.php';

    $categoryLabels = [
        'all_patient'          => 'All Patient Report',
        'consultation_summary' => 'Consultation and Patient Summary',
        'disease_incidence'    => 'Disease Incidence Report',
        'mass_vaccination'     => 'Mass Vaccination Report',
        'lost_found'           => 'Lost And Found Report',
    ];
    $categoryLabel  = $categoryLabels[$category] ?? ucwords(str_replace('_',' ',$category));
    $dateGenerated  = date('F j, Y');
    $coveragePeriod = 'January - December ' . date('Y');
    $generatedBy    = bv_clean($input['generated_by'] ?? 'Baliuag City Veterinary Office');

    // ── Logo ─────────────────────────────────────────────────────────
    $logoPath = realpath(__DIR__ . '/../../vet/images/logo.png');
    $logoTag  = '';
    if ($logoPath && file_exists($logoPath)) {
        $logoData = base64_encode(file_get_contents($logoPath));
        $logoTag  = '<img src="data:image/png;base64,'.$logoData.'" width="70" height="70" style="width:70px;height:70px;" alt="Logo">';
    }

    // ── Charts ────────────────────────────────────────────────────────
    $trendSvg = generate_trend_svg($rows, $category);
    $donutSvg = generate_donut_svg($rows, $category);

    // ── Table ─────────────────────────────────────────────────────────
    $tableHeaders = implode('', array_map(
        fn($col) => '<th>'.htmlspecialchars($col['label']).'</th>',
        $columns
    ));
    $tableRows = '';
    foreach (array_slice($rows, 0, 500) as $i => $row) {
        $bg    = $i % 2 === 0 ? '#ffffff' : '#f7f9fc';
        $cells = implode('', array_map(
            fn($col) => '<td>'.htmlspecialchars((string)($row[$col['key']] ?? '')).'</td>',
            $columns
        ));
        $tableRows .= '<tr style="background:'.$bg.'">'.$cells.'</tr>';
    }

    // ── Summary ───────────────────────────────────────────────────────
    $summaryRows = '';
    if (in_array($category, ['consultation_summary','all_patient'])) {
        $t = count($rows);
        $summaryRows = '
            <tr><td>Total Consultation</td><td class="sv">'.$t.'</td></tr>
            <tr><td>Walk-in Patient</td><td class="sv">'.(int)round($t*0.4).'</td></tr>
            <tr><td>Scheduled Appointment</td><td class="sv">'.(int)round($t*0.08).'</td></tr>';
    } elseif ($category === 'mass_vaccination') {
        $summaryRows = '
            <tr><td>Total Vaccinated</td><td class="sv">'.array_sum(array_column($rows,'totalVaccinated')).'</td></tr>
            <tr><td>Dogs Vaccinated</td><td class="sv">'.array_sum(array_column($rows,'dogsVaccinated')).'</td></tr>
            <tr><td>Cats Vaccinated</td><td class="sv">'.array_sum(array_column($rows,'catsVaccinated')).'</td></tr>';
    } elseif ($category === 'disease_incidence') {
        $tc = array_sum(array_column($rows,'totalCases'));
        $hr = count(array_filter($rows, fn($r) => strtolower($r['riskClass']??'') === 'high'));
        $bc = count(array_unique(array_column($rows,'barangay')));
        $summaryRows = '
            <tr><td>Total Cases</td><td class="sv">'.$tc.'</td></tr>
            <tr><td>High Risk Areas</td><td class="sv">'.$hr.'</td></tr>
            <tr><td>Barangays Covered</td><td class="sv">'.$bc.'</td></tr>';
    } elseif ($category === 'lost_found') {
        $res = count(array_filter($rows, fn($r) => strtolower($r['status']??'') === 'resolved'));
        $pen = count(array_filter($rows, fn($r) => strtolower($r['status']??'') === 'pending'));
        $summaryRows = '
            <tr><td>Total Reports</td><td class="sv">'.count($rows).'</td></tr>
            <tr><td>Resolved</td><td class="sv">'.$res.'</td></tr>
            <tr><td>Pending</td><td class="sv">'.$pen.'</td></tr>';
    }

    // ── HTML ──────────────────────────────────────────────────────────
    $html = '<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:Arial,sans-serif; font-size:9pt; color:#1a1a2e; }

/* ── Header ── */
.hdr { text-align:center; padding-bottom:8px; border-bottom:3px solid #0f2a6d; margin-bottom:10px; }
.hdr h1 { font-size:20pt; font-weight:900; color:#0f2a6d; line-height:1.1; margin-top:4px; }
.hdr h2 { font-size:10pt; font-weight:400; color:#555; margin-top:2px; }
.hdr .addr { font-size:7pt; color:#999; margin-top:3px; text-decoration:underline; }

/* ── Meta box ── */
.meta { width:100%; border-collapse:collapse; border:1px solid #ccc; margin-bottom:12px; }
.meta td { padding:8px 12px; font-size:8.5pt; vertical-align:top; }
.meta .left { width:55%; border-right:1px solid #ccc; }
.meta b { font-weight:bold; }

/* ── Charts ── */
.charts{
    width:100%;
    border-collapse:collapse;
    margin-bottom:12px;
}

.charts td{
    width:50%;
    vertical-align:top;
    padding:4px;
}

.cbox{
    border:1px solid #e0e6f4;
    border-radius:3px;
    padding:8px;
}

.ctitle{
    font-size:7.5pt;
    font-weight:bold;
    color:#0f2a6d;
    margin-bottom:5px;
    text-decoration:underline;
}
.donut-box{
    padding-top:0;
}

.donut-box svg{
    display:block;
    margin-top:-28px;
}

/* ── Data table ── */
.dt { width:100%; border-collapse:collapse; margin-bottom:12px; font-size:7pt; }
.dt th { background:#0f2a6d; color:#fff; padding:5px 6px; text-align:left; font-weight:600; }
.dt td { padding:4px 6px; border-bottom:1px solid #e8ecf4; }

/* ── Summary ── */
.st { width:100%; border-collapse:collapse; font-size:9pt; }
.st td { padding:5px 8px; border-bottom:1px solid #e0e6f0; }
.sv { text-align:right; font-weight:bold; font-size:13pt; color:#0f2a6d; }

/* ── Signature ── */
.sig { margin-top:24px; font-size:8pt; color:#444; }
.sig p { margin-bottom:5px; }
.sl { display:inline-block; border-bottom:1px solid #333; width:150px; margin-left:4px; }
</style>
</head>
<body>

<!-- HEADER -->
<div class="hdr">
    <h1>Baliuag City Veterinary Office</h1>
    <h2>Veterinary Services System Report</h2>
    <div class="addr">AgriCoop Building, Baliwag Government Complex, DRT Highway, Baliwag, Philippines, 3006</div>
</div>

<!-- META -->
<table class="meta">
<tr>
    <td class="left">
        Generated By: <b>'.htmlspecialchars($generatedBy).'</b><br><br>
        Report Category: <b>'.htmlspecialchars($categoryLabel).'</b><br><br>
        Report Type: <b>Monthly Report</b>
    </td>
    <td>
        Coverage Period: <b>'.htmlspecialchars($coveragePeriod).'</b><br><br>
        Date Generated: <b>'.htmlspecialchars($dateGenerated).'</b>
    </td>
</tr>
</table>
<table class="charts">
<tr>
    <td class="chart-item">
        <div class="cbox">
            '.$trendSvg.'
            <div class="ctitle">
                Monthly '.htmlspecialchars($categoryLabel).' Trend
            </div>
        </div>
    </td>

    <td class="chart-item">
        <div class="cbox donut-box">
            '.$donutSvg.'
            <div class="ctitle">Distribution</div>
        </div>
    </td>
</tr>
</table>

<!-- DATA TABLE -->
<table class="dt">
    <thead><tr>'.$tableHeaders.'</tr></thead>
    <tbody>'.$tableRows.'</tbody>
</table>

<!-- SUMMARY (right-aligned) -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
<tr>
    <td width="55%">&nbsp;</td>
    <td width="45%">
        <table class="st">'.$summaryRows.'</table>
    </td>
</tr>
</table>

<!-- SIGNATURE -->
<div class="sig">
    <p>Prepared and Certified By City Veterinarian:</p>
    <p>Name: <span class="sl"></span></p>
    <p>Signature: <span class="sl"></span></p>
    <p>Date: <span class="sl"></span></p>
</div>

</body></html>';

    // ── mPDF ─────────────────────────────────────────────────────────
    $tmpDir = __DIR__ . '/../../tmp';
    if (!is_dir($tmpDir)) mkdir($tmpDir, 0775, true);

    $mpdf = new \Mpdf\Mpdf([
        'margin_left'   => 14,
        'margin_right'  => 14,
        'margin_top'    => 14,
        'margin_bottom' => 14,
        'format'        => 'A4',
        'tempDir'       => $tmpDir,
    ]);

    $mpdf->SetTitle('VBetter ' . $categoryLabel);
    $mpdf->WriteHTML($html);
    $mpdf->Output('vbetter-' . $category . '-report.pdf', 'D');
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
if ($format === 'pdf') pdf_export($columns, $rows, $category, 'VBetter ' . ucwords(str_replace('_', ' ', $category)) . ' Report', $input);

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
        'metrics' => report_metrics($pdo, $rows, $category),
    ],
]);

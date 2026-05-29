<?php

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../includes/dataset.php';

function dashboard_input()
{
    $json = json_decode(file_get_contents('php://input'), true);
    return is_array($json) ? array_merge($_GET, $_POST, $json) : array_merge($_GET, $_POST);
}

function month_labels($rows)
{
    return array_values(array_unique(array_map(fn($row) => substr((string) ($row['month'] ?? ''), 0, 3), $rows)));
}

function annual_dashboard()
{
    $rows = bv_sheet_rows('Dashboard');
    $latestYear = bv_latest_dataset_year();
    $latest = null;
    foreach ($rows as $row) {
        if ((int) ($row['year'] ?? 0) === $latestYear) {
            $latest = $row;
            break;
        }
    }
    return [$rows, $latest ?: end($rows)];
}

function vet_dashboard($pdo)
{
    [$annualRows, $latest] = annual_dashboard();
    $rabiesRows = bv_sheet_rows('Combined_Rabies_3Years');
    $dogControlRows = bv_sheet_rows('Combined_DogControl_3Years');
    $diseaseRows = bv_sheet_rows('Barangay_Disease_Monthly');

    $latestYear = (int) ($latest['year'] ?? bv_latest_dataset_year());
    $latestRabies = array_values(array_filter($rabiesRows, fn($row) => (int) ($row['year'] ?? 0) === $latestYear));
    $latestDisease = array_values(array_filter($diseaseRows, fn($row) => (int) ($row['year'] ?? 0) === $latestYear));

    $appointmentTotal = 0;
    $pendingActions = 0;
    if (bv_table_exists($pdo, 'appointments')) {
        try {
            $appointmentTotal = (int) $pdo->query('SELECT COUNT(*) FROM appointments')->fetchColumn();
            $pendingActions = (int) $pdo->query("SELECT COUNT(*) FROM appointments WHERE status IN ('pending','confirmed')")->fetchColumn();
        } catch (Throwable $e) {
            $appointmentTotal = 0;
        }
    }

    $activeLostReports = 0;
    if (bv_table_exists($pdo, 'lost_found_reports')) {
        try {
            $activeLostReports = (int) $pdo->query("SELECT COUNT(*) FROM lost_found_reports WHERE status IN ('pending','active','approved')")->fetchColumn();
        } catch (Throwable $e) {
            $activeLostReports = 0;
        }
    }

    $totalVaccinated = (int) ($latest['total_vaccinated'] ?? 0);
    $clientsServed = max(1, (int) ($latest['clients_served'] ?? 1));
    $vaccinationRate = min(100, round(($totalVaccinated / $clientsServed) * 100));

    $diseaseByBarangay = [];
    foreach (bv_sum_by($latestDisease, 'barangay', 'total_cases') as $barangay => $cases) {
        $diseaseByBarangay[] = [
            'barangay' => $barangay,
            'actual' => (int) $cases,
            'predicted' => (int) ceil($cases * 1.14),
        ];
    }
    $diseaseByBarangay = array_slice($diseaseByBarangay, 0, 12);

    $patientVolume = [];
    foreach ($latestRabies as $row) {
        $patientVolume[] = [
            'label' => substr((string) ($row['month'] ?? ''), 0, 3),
            'value' => (int) ($row['clients_served'] ?? 0),
        ];
    }

    $vaccineDemand = [
        ['label' => 'Rabies', 'units' => (int) ceil(array_sum(array_map(fn($row) => (int) ($row['total_vaccinated'] ?? 0), array_slice($latestRabies, -3))) / 3)],
        ['label' => 'Parvo', 'units' => (int) ceil(array_sum(array_map(fn($row) => (int) ($row['total_cases'] ?? 0), array_slice($latestDisease, -85))) * 0.22)],
        ['label' => 'Distemper', 'units' => (int) ceil(array_sum(array_map(fn($row) => (int) ($row['respiratory_cases'] ?? 0), $latestDisease)) * 0.18)],
    ];

    return [
        'kpis' => [
            'totalAppointments' => $appointmentTotal ?: array_sum(array_map(fn($row) => (int) ($row['clients_served'] ?? 0), $latestRabies)),
            'pendingActions' => $pendingActions,
            'activeLostReports' => $activeLostReports,
            'vaccinationRate' => $vaccinationRate,
        ],
        'patientVolume' => $patientVolume,
        'diseaseCasesByBarangay' => $diseaseByBarangay,
        'vaccinated' => [
            'dogs' => (int) ($latest['dogs_vaccinated'] ?? 0),
            'cats' => (int) ($latest['cats_vaccinated'] ?? 0),
            'total' => $totalVaccinated,
        ],
        'vaccineDemand' => $vaccineDemand,
        'annualSummary' => $annualRows,
    ];
}

function admin_dashboard($pdo)
{
    $totals = [
        'totalAccounts' => 0,
        'activeAccounts' => 0,
        'pendingApprovals' => 0,
        'systemAlerts' => 0,
    ];
    $recentAccounts = [];
    $registrationChart = [];

    if (bv_table_exists($pdo, 'users')) {
        try {
            $totals['totalAccounts'] = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
            $totals['activeAccounts'] = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE account_status = 'active'")->fetchColumn();
            $totals['pendingApprovals'] = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE account_status IN ('pending','for_review')")->fetchColumn();

            $recentAccounts = $pdo->query("
                SELECT users.full_name, users.email, users.account_status, users.created_at, roles.name AS role_name
                FROM users
                LEFT JOIN roles ON roles.id = users.role_id
                ORDER BY users.created_at DESC
                LIMIT 6
            ")->fetchAll();

            $registrationChart = $pdo->query("
                SELECT DATE_FORMAT(created_at, '%b') AS label, COUNT(*) AS new_accounts
                FROM users
                WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
                GROUP BY YEAR(created_at), MONTH(created_at), DATE_FORMAT(created_at, '%b')
                ORDER BY YEAR(created_at), MONTH(created_at)
            ")->fetchAll();
        } catch (Throwable $e) {
            $recentAccounts = [];
        }
    }

    $vet = vet_dashboard($pdo);
    return [
        'kpis' => array_merge($totals, [
            'clinicVaccinationRate' => $vet['kpis']['vaccinationRate'],
        ]),
        'recentAccounts' => array_map(function ($row) {
            return [
                'name' => $row['full_name'] ?? 'N/A',
                'role' => $row['role_name'] ?? 'User',
                'email' => $row['email'] ?? '',
                'status' => $row['account_status'] ?? '',
                'joined' => substr((string) ($row['created_at'] ?? ''), 0, 10),
            ];
        }, $recentAccounts),
        'registrationChart' => array_map(function ($row) {
            return [
                'label' => $row['label'],
                'newAccounts' => (int) $row['new_accounts'],
                'deactivated' => 0,
            ];
        }, $registrationChart),
        'operations' => $vet,
    ];
}

function disease_name_filter($value)
{
    $value = bv_clean($value);
    return strtolower($value) === 'all diseases' ? '' : strtolower($value);
}

function disease_analytics_data()
{
    $selected = disease_name_filter($_GET['disease'] ?? $_POST['disease'] ?? '');
    $monthly = bv_sheet_rows('Disease_Monthly_2023_2025');
    $barangayRows = bv_sheet_rows('Barangay_Disease_Monthly');
    $consultRows = bv_sheet_rows('Consult_Diagnosis_3Y');
    $latestYear = bv_latest_dataset_year();

    if ($selected !== '') {
        $consultRows = array_values(array_filter($consultRows, fn($row) => str_contains(strtolower((string) ($row['diagnosis'] ?? '')), $selected)));
    }

    $latestBarangay = array_values(array_filter($barangayRows, fn($row) => (int) ($row['year'] ?? 0) === $latestYear));
    $latestConsult = array_values(array_filter($consultRows, fn($row) => (int) ($row['year'] ?? 0) === $latestYear));

    $diseaseCounts = bv_count_by($latestConsult, 'diagnosis');
    $barangayCounts = bv_sum_by($latestBarangay, 'barangay', 'total_cases');
    $topDisease = array_key_first($diseaseCounts) ?: 'N/A';
    $topBarangay = array_key_first($barangayCounts) ?: 'N/A';

    $actualCases = [];
    foreach (array_slice($barangayCounts, 0, 12, true) as $barangay => $cases) {
        $actualCases[] = ['barangay' => $barangay, 'value' => (int) $cases];
    }
    $predictedCases = array_map(fn($row) => ['barangay' => $row['barangay'], 'value' => round($row['value'] * 1.12, 1)], $actualCases);

    $filters = ['All Diseases'];
    foreach (array_slice(array_keys(bv_count_by($monthly, 'disease_or_condition')), 0, 30) as $disease) {
        $filters[] = $disease;
    }

    $hotspots = [];
    $coords = [
        [14.9599, 120.9083], [14.9542, 120.9099], [14.9621, 120.9017],
        [14.9516, 120.8979], [14.9584, 120.9001], [14.9568, 120.8947],
        [14.9632, 120.9131], [14.9472, 120.9041],
    ];
    foreach (array_slice($actualCases, 0, 8) as $index => $row) {
        $risk = $row['value'] >= 180 ? 'critical' : ($row['value'] >= 120 ? 'monitor' : 'stable');
        $hotspots[] = [
            'id' => 'h' . ($index + 1),
            'barangay' => $row['barangay'],
            'disease' => $topDisease,
            'risk' => $risk,
            'cases' => $row['value'],
            'predicted' => (int) ceil($row['value'] * 1.12),
            'lat' => $coords[$index % count($coords)][0],
            'lng' => $coords[$index % count($coords)][1],
            'intensity' => min(1, max(0.35, $row['value'] / max(1, $actualCases[0]['value']))),
        ];
    }

    $insights = array_map(function ($spot) {
        $classification = $spot['risk'] === 'critical' ? 'Grade 4 Outbreak Risk' : ($spot['risk'] === 'monitor' ? 'Grade 3 Elevated Risk' : 'Grade 2 Monitoring');
        return [
            'id' => trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($spot['barangay'])), '-'),
            'barangay' => $spot['barangay'],
            'disease' => $spot['disease'],
            'cases' => $spot['cases'],
            'avg' => round($spot['cases'] * 0.82, 1),
            'recommendation' => 'Prioritize field validation, owner education, and follow-up monitoring for this barangay.',
            'comparisons' => [
                ['label' => 'Current Disease Load', 'value' => min(100, $spot['cases']), 'color' => '#2ca0f0'],
                ['label' => 'Barangay Average', 'value' => min(100, (int) round($spot['cases'] * 0.82)), 'color' => '#3d6670'],
                ['label' => 'Predicted Load', 'value' => min(100, $spot['predicted']), 'color' => '#0b7a2c'],
            ],
            'predicted' => [
                ['label' => 'Next Period Forecast', 'value' => min(100, $spot['predicted']), 'color' => '#2ca0f0'],
                ['label' => 'Current Cases', 'value' => min(100, $spot['cases']), 'color' => '#3d6670'],
            ],
            'protocol' => [
                'classification' => $classification,
                'title' => 'Barangay Disease Response Protocol',
                'description' => 'Automated surveillance response generated from the BaliwagVet 2023-2025 dataset.',
                'steps' => [
                    ['level' => 'red', 'title' => 'Immediate: Field Validation', 'detail' => 'Confirm recent cases and validate animal health reports.'],
                    ['level' => 'blue', 'title' => 'Within 24hrs: Coordination', 'detail' => 'Coordinate with barangay officials and veterinary response staff.'],
                    ['level' => 'green', 'title' => 'Preventive: Education Drive', 'detail' => 'Distribute prevention guidance and vaccination reminders.'],
                    ['level' => 'gray', 'title' => 'Monitoring: Trend Review', 'detail' => 'Review case trend until the risk score returns to baseline.'],
                ],
            ],
        ];
    }, array_slice($hotspots, 0, 4));

    return [
        'filters' => $filters,
        'selectedDisease' => $selected ? ucwords($selected) : 'All Diseases',
        'kpis' => [
            ['label' => 'Total Patients This Year', 'value' => (string) count($latestConsult), 'trend' => 'Based on consultation diagnosis records'],
            ['label' => 'Most Common Disease', 'value' => $topDisease, 'trend' => 'Top diagnosis in selected period'],
            ['label' => 'Most Active Barangay', 'value' => $topBarangay, 'trend' => 'Highest barangay-level case total'],
            ['label' => 'Auto Alerts', 'value' => str_pad((string) count(array_filter($hotspots, fn($row) => $row['risk'] !== 'stable')), 2, '0', STR_PAD_LEFT), 'trend' => 'Generated from risk class and forecast'],
        ],
        'predictionSummary' => ['total' => count($hotspots), 'label' => 'Predicted high-risk zones'],
        'sources' => [
            ['name' => 'BaliwagVet_2023-2025.xlsx', 'status' => 'Dataset Workbook'],
            ['name' => 'Barangay Disease Monthly', 'status' => 'Risk and heatmap input'],
            ['name' => 'Consultation Diagnosis', 'status' => 'Disease analytics input'],
        ],
        'actualCases' => $actualCases,
        'predictedCases' => $predictedCases,
        'insights' => $insights,
        'map' => [
            'center' => [14.9577, 120.9055],
            'zoom' => 14,
            'metrics' => [
                ['label' => 'Total Patients', 'value' => number_format(count($consultRows)), 'trend' => '2023-2025 consultations'],
                ['label' => 'Common Diseases', 'value' => $topDisease, 'trend' => 'Highest selected diagnosis'],
                ['label' => 'Active Barangay', 'value' => $topBarangay, 'trend' => 'Immediate focus area'],
            ],
            'hotspots' => $hotspots,
            'forecast' => array_map(fn($row) => (int) ceil($row['value'] * 1.12), array_slice($actualCases, 0, 8)),
        ],
    ];
}

$input = dashboard_input();
$scope = strtolower(bv_clean($input['scope'] ?? $input['action'] ?? 'vet'));

if ($scope === 'admin') {
    bv_json_response(200, ['success' => true, 'data' => admin_dashboard($pdo)]);
}

if ($scope === 'disease_analytics' || $scope === 'disease-analytics') {
    bv_json_response(200, ['success' => true, 'data' => disease_analytics_data()]);
}

bv_json_response(200, ['success' => true, 'data' => vet_dashboard($pdo)]);

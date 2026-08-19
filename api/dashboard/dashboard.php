<?php
/**
 * BVetter dashboard.php — v3 (Disease-Specific Forecasting)
 * ─────────────────────────────────────────────────────────
 * Changes from v2:
 *   • disease_analytics_data() routes disease-specific requests to the
 *     new disease-specific pipeline (/disease-predict with `disease` field)
 *   • disease_case_series() reads Consult_Diagnosis_3Y for BOTH views, so
 *     "All Diseases" is the sum of the individual diseases rather than a
 *     second, larger tally from Barangay_Disease_Monthly
 *   • analytics_post() helper unchanged
 *   • disease_risk_prediction scope now forwards `disease` and `period`
 *     so Python can route correctly
 */

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../includes/dataset.php';
require_once __DIR__ . '/../config/auth_guard.php';

requireRole($pdo, ['veterinarian', 'admin']);

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
    $rows       = bv_sheet_rows('Dashboard');
    $latestYear = bv_latest_dataset_year();
    $latest     = null;
    foreach ($rows as $row) {
        if ((int) ($row['year'] ?? 0) === $latestYear) {
            $latest = $row;
            break;
        }
    }
    return [$rows, $latest ?: end($rows)];
}

function analytics_service_urls(): array
{
    $configured = bv_clean(getenv('VBETTER_ANALYTICS_URL') ?: '');
    $urls   = $configured !== '' ? [$configured] : [];
    $urls[] = 'http://127.0.0.1:5001';
    $urls[] = 'http://localhost:5001';
    $urls[] = 'http://192.168.1.25:5001';
    return array_values(array_unique(array_map(fn($url) => rtrim($url, '/'), $urls)));
}

function analytics_post(string $path, array $payload, int $timeout = 60): array
{
    $body      = json_encode($payload);
    $lastError = 'Analytics service unavailable.';

    foreach (analytics_service_urls() as $baseUrl) {
        $ch = curl_init($baseUrl . $path);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);

        $raw     = curl_exec($ch);
        $curlOk  = curl_errno($ch) === 0;
        $status  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if (!$curlOk) { $lastError = $curlErr ?: $lastError; continue; }
        $decoded = json_decode((string) $raw, true);
        if (!is_array($decoded)) { $lastError = 'Analytics service returned invalid JSON.'; continue; }
        if ($status >= 400) { $lastError = $decoded['error'] ?? $decoded['message'] ?? 'Request failed.'; continue; }

        return [
            'success' => (bool) ($decoded['success'] ?? true),
            'error'   => $decoded['error'] ?? null,
            'data'    => $decoded['data'] ?? [],
            'cached'  => $decoded['cached'] ?? false,
        ];
    }
    return ['success' => false, 'error' => $lastError, 'data' => []];
}

function analytics_get(string $path, int $timeout = 15): array
{
    $lastError = 'Analytics service unavailable.';

    foreach (analytics_service_urls() as $baseUrl) {
        $ch = curl_init($baseUrl . $path);
        curl_setopt($ch, CURLOPT_HTTPGET, true);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);

        $raw    = curl_exec($ch);
        $curlOk = curl_errno($ch) === 0;
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if (!$curlOk) { $lastError = $curlErr ?: $lastError; continue; }
        $decoded = json_decode((string) $raw, true);
        if (!is_array($decoded)) { $lastError = 'Analytics service returned invalid JSON.'; continue; }
        if ($status >= 400) { $lastError = $decoded['error'] ?? $decoded['message'] ?? 'Request failed.'; continue; }

        return [
            'success' => (bool) ($decoded['success'] ?? true),
            'error'   => $decoded['error'] ?? null,
            'data'    => $decoded['data'] ?? $decoded,
        ];
    }
    return ['success' => false, 'error' => $lastError, 'data' => []];
}

/* ──────────────────────────────────────────────────────────────────────────
 * DISEASE PREDICTION HELPERS
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Call the Python /disease-predict endpoint.
 *
 * For All Diseases: omit `disease` field → Python uses all-disease ARIMA+RF.
 * For a specific disease: pass `disease` → Python uses disease-specific
 *   SARIMA/ARIMA/WMA pipeline from Consult_Diagnosis_3Y.
 */
function get_disease_predictions(
    array $barangayNames,
    array $currentCasesByBarangay = [],
    string $disease = '',
    string $period  = 'year',
    int    $steps   = 1
): array {
    $payload = [
        'barangays'                 => array_values(array_unique($barangayNames)),
        'current_cases_by_barangay' => (object) $currentCasesByBarangay,
        'period'                    => $period,
        'steps'                     => $steps,
    ];

    // Only send `disease` when not "all" — Python routes on its presence
    $diseaseClean = strtolower(trim($disease));
    if ($diseaseClean !== '' && $diseaseClean !== 'all diseases' && $diseaseClean !== 'all') {
        $payload['disease'] = $disease;
    }

    return analytics_post('/disease-predict', $payload, 60);
}

function disease_name_filter($value): string
{
    $value = bv_clean($value);
    return strtolower($value) === 'all diseases' ? '' : strtolower($value);
}

/**
 * Build per-barangay actual case counts for the selected period.
 *
 * Both views read Consult_Diagnosis_3Y. "All Diseases" is the sum over every
 * diagnosis, so it always equals the sum of the individual diseases.
 *
 * It used to read Barangay_Disease_Monthly instead, whose barangay-month
 * totals are a separate tally of the same population: 4,927 against 2,551 for
 * 2025. The two views therefore disagreed by roughly 2x, and a recorded case
 * could never feed both -- selecting "All Diseases" and adding up the 42
 * individual diseases gave different answers.
 *
 * Barangay_Disease_Monthly still backs the risk classifier (it carries the
 * risk_class labels, which Consult_Diagnosis_3Y does not) and the vaccination
 * chart. It is simply no longer a second answer to "how many cases".
 */
function disease_case_series($pdo, string $selected, string $period = 'year', string $dataView = 'historical', string $currentMonth = ''): array
{
    $counts = [];

    if ($dataView === 'current') {
        // Current mode reads the clinic's own live records only -- the Excel
        // 2023-2025 snapshot is training data here, not a second answer to
        // "how many cases", so it plays no part in this branch at all.
        foreach (db_disease_barangay_counts($pdo, $selected, 'all', null, $currentMonth) as $b => $cases) {
            if ($b === '' || $b === 'Unspecified') continue;
            $counts[$b] = ($counts[$b] ?? 0) + $cases;
        }
    } else {
        $latestYear  = bv_latest_dataset_year();
        $consultRows = bv_sheet_rows('Consult_Diagnosis_3Y');
        $latestMonth = 12;

        if ($period === 'month') {
            foreach ($consultRows as $r) {
                if ((int)($r['year'] ?? 0) === $latestYear) {
                    $m = (int)($r['month_no'] ?? 0);
                    if ($m > $latestMonth) $latestMonth = $m;
                }
            }
        }

        foreach ($consultRows as $r) {
            // An empty $selected means "All Diseases", which is every row rather
            // than a different source.
            //
            // Matched exactly, not by substring: "Respiratory Infection" is a
            // substring of "Upper Respiratory Infection", so a contains-match put
            // that disease's 102 cases under both names and the per-disease totals
            // summed to 102 more than All Diseases. The filter list and the
            // diagnosis column share one 42-name vocabulary, so there is nothing
            // for a looser match to catch.
            if ($selected !== '') {
                $diagnosis = strtolower(trim((string)($r['diagnosis'] ?? '')));
                if ($diagnosis !== $selected) continue;
            }

            $rowYear  = (int)($r['year']     ?? 0);
            $rowMonth = (int)($r['month_no'] ?? 0);

            // 'all' pins neither, so every year falls through.
            if ($period === 'year' && $rowYear !== $latestYear) continue;
            if ($period === 'month'
                && ($rowYear !== $latestYear || $rowMonth !== $latestMonth)) continue;

            $b = trim((string)($r['barangay'] ?? ''));
            if ($b === '') continue;

            $counts[$b] = ($counts[$b] ?? 0) + (float)($r['cases_reported'] ?? 1);
        }

        // Historical mode is the frozen 2023-2025 snapshot only -- no live DB
        // merge. Splitting Historical/Current apart is the whole point of this
        // view; merging them back here would recreate the "which number is
        // real" confusion the toggle exists to remove.
    }

    unset($counts[''], $counts['Unspecified']);
    arsort($counts);

    /* ── Build actual + predicted arrays (predicted uses +12 % fallback;
     *    the real predictions come from Python via /disease-predict)    ── */
    $actualCases    = [];
    $predictedCases = [];

    foreach ($counts as $barangay => $cases) {
        $actualCases[]    = ['barangay' => $barangay, 'value' => (int) round($cases)];
        $predictedCases[] = [
            'barangay' => $barangay,
            'value'    => (int) ceil($cases * 1.12),
            'source'   => 'fallback',
        ];
    }

    return [$actualCases, $predictedCases];
}

function db_disease_barangay_counts($pdo, string $selected, string $dateType = 'all', ?int $year = null, ?string $exactMonth = null): array
{
    if (!bv_table_exists($pdo, 'patient_visit_records') || !bv_table_exists($pdo, 'pets')) {
        return [];
    }

    $barangayJoin = bv_table_exists($pdo, 'owner_profiles') && bv_table_exists($pdo, 'barangays')
        ? 'LEFT JOIN owner_profiles op ON op.user_id = pets.owner_id LEFT JOIN barangays b ON b.id = op.barangay_id'
        : '';
    // The visit's own barangay_at_visit wins over the owner's current profile:
    // it is what was true when the case was recorded, and it is the only
    // barangay left on a de-identified visit (see deleteUserAccount in
    // api/admin/account-management.php).
    $liveBarangay = $barangayJoin ? "NULLIF(b.name, ''), NULLIF(op.complete_address, ''), " : '';
    $barangayExpr = "COALESCE(NULLIF(patient_visit_records.barangay_at_visit, ''), {$liveBarangay}'Unspecified')";

    // $exactMonth pins the window to one specific calendar month ('Y-m'), for
    // the Current-mode month picker on Disease Analytics -- browsing to e.g.
    // June 2026 must show only June, not "today minus N days".
    // $year pins the window to a specific dataset year (e.g. the latest Excel
    // year) instead of today's real calendar year -- without it, merging live
    // DB rows into an Excel-year bucket via bv_date_window($dateType) silently
    // pulls in whatever year "today" happens to be, which drifts once the
    // Excel snapshot's latest year and the real calendar year diverge.
    if ($exactMonth !== null && preg_match('/^\d{4}-\d{2}$/', $exactMonth)) {
        $start = new DateTime("$exactMonth-01");
        $end   = (clone $start)->modify('last day of this month');
    } else {
        [$start, $end] = $year !== null
            ? [new DateTime("$year-01-01"), new DateTime("$year-12-31")]
            : bv_date_window($dateType);
    }
    // A visit counts as a disease case only when its diagnosis is a real entry
    // in the `diseases` catalog. The old rule -- any non-empty diagnosis, or
    // failing that any category -- counted whatever text happened to be in the
    // field, so scratch entries like 'asdadadad' landed in the case counts and
    // the forecasts built on them. It also let a visit type ('Vaccination',
    // 'Routine Checkup') stand in for a diagnosis whenever diagnosis was NULL,
    // which the Excel baseline has no equivalent for.
    //
    // Off-catalog text is still stored and still shows on the patient's record;
    // it is excluded from epidemiological aggregation, not from the chart. That
    // is also what keeps the vet's "Other / Not Listed" free-text option safe to
    // offer -- see the diagnosis <select> in vet/js/patient-records.js.
    $where  = bv_table_exists($pdo, 'diseases')
        ? ['patient_visit_records.diagnosis IN (SELECT name FROM diseases WHERE is_active = 1)']
        : ['COALESCE(patient_visit_records.diagnosis, patient_visit_records.category, "") <> ""'];
    $params = [];

    // Exact, for the same reason as disease_case_series(): a LIKE '%...%' here
    // counted "Upper Respiratory Infection" under "Respiratory Infection" too.
    if ($selected !== '') {
        $where[]            = 'LOWER(COALESCE(patient_visit_records.diagnosis, "")) = :disease';
        $params[':disease'] = $selected;
    }
    if ($start) {
        $where[]               = 'COALESCE(patient_visit_records.visit_date, patient_visit_records.created_at) >= :start_date';
        $params[':start_date'] = $start->format('Y-m-d');
    }
    if ($end) {
        $where[]             = 'COALESCE(patient_visit_records.visit_date, patient_visit_records.created_at) <= :end_date';
        $params[':end_date'] = $end->format('Y-m-d') . ' 23:59:59';
    }

    try {
        $stmt = $pdo->prepare("
            SELECT {$barangayExpr} AS barangay, COUNT(*) AS cases
            FROM patient_visit_records
            LEFT JOIN pets ON pets.id = patient_visit_records.pet_id
            {$barangayJoin}
            WHERE " . implode(' AND ', $where) . "
            GROUP BY barangay
        ");
        $stmt->execute($params);
        $counts = [];
        foreach ($stmt->fetchAll() as $row) {
            $barangay = bv_clean($row['barangay'] ?? '');
            if ($barangay !== '') {
                $counts[$barangay] = ($counts[$barangay] ?? 0) + (float) ($row['cases'] ?? 0);
            }
        }
        return $counts;
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        return [];
    }
}

/**
 * How much of a given live month is actually usable for case counting, so
 * Current mode can say "3 consultations recorded, 1 with a listed diagnosis"
 * instead of drawing a normal-looking chart off a single bar. Coverage, not
 * disease counting, so it deliberately ignores the diseases-catalog filter
 * that db_disease_barangay_counts applies -- a visit with an off-catalog or
 * blank diagnosis still counts as "recorded", it just isn't a case yet.
 */
function db_live_coverage_stats($pdo, string $exactMonth): array
{
    if (!bv_table_exists($pdo, 'patient_visit_records') || !preg_match('/^\d{4}-\d{2}$/', $exactMonth)) {
        return ['total_visits' => 0, 'with_diagnosis' => 0];
    }

    $catalogOnly = bv_table_exists($pdo, 'diseases')
        ? 'diagnosis IN (SELECT name FROM diseases WHERE is_active = 1)'
        : 'COALESCE(diagnosis, "") <> ""';

    try {
        $stmt = $pdo->prepare("
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN {$catalogOnly} THEN 1 ELSE 0 END) AS with_diagnosis
            FROM patient_visit_records
            WHERE DATE_FORMAT(COALESCE(visit_date, created_at), '%Y-%m') = :ym
        ");
        $stmt->execute([':ym' => $exactMonth]);
        $row = $stmt->fetch() ?: [];
        return [
            'total_visits'   => (int) ($row['total'] ?? 0),
            'with_diagnosis' => (int) ($row['with_diagnosis'] ?? 0),
        ];
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        return ['total_visits' => 0, 'with_diagnosis' => 0];
    }
}

/**
 * Top diagnosis for a live month, mirroring the Excel-era "Most Common
 * Disease" KPI but sourced from patient_visit_records instead of
 * Consult_Diagnosis_3Y. Same catalog rule as db_disease_barangay_counts.
 */
function db_top_diagnosis($pdo, string $exactMonth, string $selected): string
{
    if (!bv_table_exists($pdo, 'patient_visit_records') || !preg_match('/^\d{4}-\d{2}$/', $exactMonth)) {
        return '';
    }

    $where = bv_table_exists($pdo, 'diseases')
        ? ['diagnosis IN (SELECT name FROM diseases WHERE is_active = 1)']
        : ['COALESCE(diagnosis, "") <> ""'];
    $where[]  = "DATE_FORMAT(COALESCE(visit_date, created_at), '%Y-%m') = :ym";
    $params   = [':ym' => $exactMonth];
    if ($selected !== '') {
        $where[]            = 'LOWER(COALESCE(diagnosis, "")) = :disease';
        $params[':disease'] = $selected;
    }

    try {
        $stmt = $pdo->prepare("
            SELECT diagnosis, COUNT(*) AS n
            FROM patient_visit_records
            WHERE " . implode(' AND ', $where) . "
            GROUP BY diagnosis
            ORDER BY n DESC
            LIMIT 1
        ");
        $stmt->execute($params);
        return bv_clean($stmt->fetchColumn() ?: '');
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        return '';
    }
}

/**
 * Date of the most recent live case, for the live layer's "latest entry" line.
 * Applies the same catalog rule as db_disease_barangay_counts so the date can
 * never point at a record the counts above exclude.
 */
function db_latest_case_date($pdo): string
{
    if (!bv_table_exists($pdo, 'patient_visit_records')) return '';

    $catalogOnly = bv_table_exists($pdo, 'diseases')
        ? 'AND diagnosis IN (SELECT name FROM diseases WHERE is_active = 1)'
        : 'AND COALESCE(diagnosis, "") <> ""';

    try {
        $date = $pdo->query("
            SELECT MAX(COALESCE(visit_date, created_at))
            FROM patient_visit_records
            WHERE YEAR(COALESCE(visit_date, created_at)) = YEAR(CURDATE())
            {$catalogOnly}
        ")->fetchColumn();
        return $date ? date('j M Y', strtotime((string) $date)) : '';
    } catch (Throwable $e) {
        return '';
    }
}

/**
 * One sentence for the live layer.
 *
 * With a disease selected the filtered count is reported against the clinic
 * total ("Ear Mites: 0 of 3 cases recorded") rather than on its own. A live
 * layer this young reads 0 for nearly every disease, and a bare 0 looks like a
 * broken panel; shown against the total it reads as what it is -- the layer
 * works, that disease simply has not been seen yet.
 */
function live_layer_summary(int $filtered, int $total, bool $isAllDiseases, string $diseaseName): string
{
    $unit = fn(int $n) => $n === 1 ? 'case' : 'cases';

    if ($isAllDiseases) {
        return $total === 0
            ? 'No cases recorded yet this year'
            : number_format($total) . ' ' . $unit($total) . ' recorded';
    }

    return $diseaseName . ': ' . number_format($filtered) . ' of '
         . number_format($total) . ' ' . $unit($total) . ' recorded';
}

/* ──────────────────────────────────────────────────────────────────────────
 * DISEASE ANALYTICS — main handler
 * ─────────────────────────────────────────────────────────────────────────
 */
function disease_analytics_data($pdo)
{
    $input    = dashboard_input();
    $selected = disease_name_filter($input['disease'] ?? $_GET['disease'] ?? '');
    $period   = strtolower(bv_clean($input['period'] ?? $_GET['period'] ?? 'year'));

    // Historical = the frozen 2023-2025 municipal snapshot (training data).
    // Current    = only what this clinic has actually recorded in the live DB.
    // The two are never merged into one number -- see disease_case_series().
    $dataView = strtolower(bv_clean($input['data_view'] ?? $_GET['data_view'] ?? 'historical'));
    if (!in_array($dataView, ['historical', 'current'], true)) $dataView = 'historical';
    $isCurrent = $dataView === 'current';

    // The Current-mode month picker. Defaults to the real current month
    // ("assuming August" when today is August) rather than the Excel
    // snapshot's latest year, since Current has nothing to do with the Excel
    // dataset's period.
    $currentMonth = bv_clean($input['current_month'] ?? $_GET['current_month'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}$/', $currentMonth)) $currentMonth = date('Y-m');

    $latestYear    = bv_latest_dataset_year();
    $isAllDiseases = $selected === '';

    /* ── Actual case counts from the correct source per disease ──────── */
    [$actualCases, $predictedCases] = disease_case_series($pdo, $selected, $period, $dataView, $currentMonth);

    $totalCases     = array_sum(array_column($actualCases, 'value'));
    $barangayCounts = [];
    foreach ($actualCases as $row) {
        $barangayCounts[$row['barangay']] = $row['value'];
    }
    $topBarangay = array_key_first($barangayCounts) ?: 'N/A';

    /* ── The live layer ────────────────────────────────────────────────
     * The page shows two layers, and they answer different questions:
     *
     *   baseline  the frozen 2023-2025 municipal snapshot, which is what the
     *             charts plot and what the forecasts are built on
     *   live      what this clinic has recorded since, which starts empty and
     *             grows as visits are logged
     *
     * Mixing them silently is what produced the "Total Cases This Year" card
     * reading a 2025 figure. Both are reported, each labelled with its own
     * period, and neither is relabelled as the other.
     *
     * The live figures are always calendar-year-to-date regardless of the
     * Yearly/Monthly toggle: "what has this clinic recorded" is not a question
     * about the snapshot's period.
     */
    $currentCalendarYear = (int) date('Y');
    $liveFiltered = (int) round(array_sum(db_disease_barangay_counts($pdo, $selected, 'year')));
    $liveTotal    = $isAllDiseases
        ? $liveFiltered
        : (int) round(array_sum(db_disease_barangay_counts($pdo, '', 'year')));
    $liveLatest   = db_latest_case_date($pdo);

    /* ── Top disease label ───────────────────────────────────────────── */
    if ($isCurrent) {
        $topDisease = db_top_diagnosis($pdo, $currentMonth, $selected)
            ?: ($selected !== '' ? ucwords($selected) : 'N/A');
        if ($topDisease !== 'N/A') $topDisease = ucwords(strtolower($topDisease));
    } else {
        $consultRows   = bv_sheet_rows('Consult_Diagnosis_3Y');
        $latestConsult = [];
        $latestMonth   = 12;

        if ($period === 'month') {
            foreach ($consultRows as $r) {
                if ((int)($r['year'] ?? 0) === $latestYear) {
                    $m = (int)($r['month_no'] ?? 0);
                    if ($m > $latestMonth) $latestMonth = $m;
                }
            }
        }

        foreach ($consultRows as $r) {
            $rowYear = (int)($r['year'] ?? 0);
            if ($rowYear !== $latestYear) continue;
            if ($period === 'month' && (int)($r['month_no'] ?? 0) !== $latestMonth) continue;
            if ($selected !== '' && strtolower(trim((string)($r['diagnosis'] ?? ''))) !== $selected) continue;
            $latestConsult[] = $r;
        }

        $diseaseCounts = bv_count_by($latestConsult, 'diagnosis');
        $topDisease    = array_key_first($diseaseCounts)
            ?: ($selected !== '' ? ucwords($selected) : 'N/A');
    }

    /* ── Filter dropdown ─────────────────────────────────────────────── */
    $monthly = bv_sheet_rows('Disease_Monthly_2023_2025');
    $filters = ['All Diseases'];
    foreach (array_keys(bv_count_by($monthly, 'disease_or_condition')) as $d) {
        $filters[] = $d;
    }

    /* ── Barangay coordinates ────────────────────────────────────────── */
    $barangayCoords = [
        'Tiaong'              => [14.942488, 120.896141],
        'Poblacion'           => [14.952325, 120.902748],
        'San Jose'            => [14.949194, 120.897469],
        'Tangos'              => [14.97498,  120.897369],
        'Bagong Nayon'        => [14.96041,  120.898087],
        'Sulivan'             => [14.979081, 120.885002],
        'Pagala'              => [14.962781, 120.889984],
        'Virgen Delas Flores' => [14.946227, 120.88604],
        'Matangtubig'         => [14.954293, 120.861511],
        'Makinabang'          => [14.919284, 120.883728],
        'Tilapayong'          => [14.977394, 120.873024],
        'Tibag'               => [14.956218, 120.904831],
        'Hinukay'             => [15.001118, 120.891594],
        'Pinagbarilan'        => [14.952386, 120.878044],
        'Concepcion'          => [14.952222, 120.888626],
        'Tarcan'              => [14.935418, 120.866425],
        'San Roque'           => [15.000359, 120.889992],
        'Calantipay'          => [14.970637, 120.863106],
        'Subic'               => [14.96235,  120.902748],
        'Barangca'            => [14.986587, 120.900276],
        'Paitan'              => [15.01128,  120.894753],
        'Sabang'              => [14.968414, 120.908592],
        'Piel'                => [14.986943, 120.88723],
        'Sta. Barbara'        => [14.938139, 120.889046],
        'Sto. Nino'           => [14.983848, 120.893478],
        'Sto. Niño'           => [14.983848, 120.893478],
        'Sto. Cristo'         => [14.956154, 120.893936],
        'Catulinan'           => [14.968497, 120.877312],
    ];

    $maxCasesVal = count($actualCases) > 0 ? max(array_column($actualCases, 'value')) : 1;
    $avgCasesVal = count($actualCases) > 0
        ? round(array_sum(array_column($actualCases, 'value')) / count($actualCases), 1)
        : 0;

    /* ── Hotspots (with fallback predicted values; Python will override) */
    $hotspots = [];
    foreach ($actualCases as $index => $row) {
        $barangay = $row['barangay'];
        if (isset($barangayCoords[$barangay])) {
            [$lat, $lng] = $barangayCoords[$barangay];
        } else {
            $hash = crc32($barangay);
            $lat  = 14.9577 + (($hash % 200) - 100) * 0.0001;
            $lng  = 120.9055 + ((($hash >> 8) % 200) - 100) * 0.0001;
        }

        $predicted  = (int) ceil($row['value'] * 1.12);
        $risk       = $row['value'] >= ($maxCasesVal * 0.7) ? 'critical'
                    : ($row['value'] >= ($maxCasesVal * 0.4) ? 'monitor' : 'stable');

        $hotspots[] = [
            'id'          => 'h' . ($index + 1),
            'barangay'    => $barangay,
            'disease'     => $isAllDiseases ? $topDisease : ucwords($selected),
            'risk'        => $risk,
            'cases'       => $row['value'],
            'predicted'   => $predicted,
            'pred_source' => 'fallback',
            'lat'         => $lat,
            'lng'         => $lng,
            'intensity'   => round(min(1.0, max(0.2, $row['value'] / max(1, $maxCasesVal))), 2),
        ];
    }

    /* ── Build placeholder insights (real ones merged by JS after Python call) */
    $insights = array_map(function ($spot) use ($avgCasesVal, $maxCasesVal, $selected, $isAllDiseases) {
        $loadPct = min(100, (int) round(($spot['cases']     / max(1, $maxCasesVal)) * 100));
        $avgPct  = min(100, (int) round(($avgCasesVal       / max(1, $maxCasesVal)) * 100));
        $predPct = min(100, (int) round(($spot['predicted'] / max(1, $maxCasesVal)) * 100));

        return [
            'id'             => trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($spot['barangay'])), '-'),
            'barangay'       => $spot['barangay'],
            'disease'        => $spot['disease'],
            'cases'          => $spot['cases'],
            'avg'            => $avgCasesVal,
            'recommendation' => 'Loading prediction…',
            'comparisons'    => [
                ['label' => 'This Barangay',    'value' => $loadPct, 'color' => '#2ca0f0'],
                ['label' => 'Barangay Average', 'value' => $avgPct,  'color' => '#3d6670'],
                ['label' => 'Peak Barangay',    'value' => 100,      'color' => '#0b7a2c'],
            ],
            'predicted'      => [
                ['label' => 'Predicted Load', 'value' => $predPct, 'color' => '#2ca0f0'],
                ['label' => 'Current Load',   'value' => $loadPct, 'color' => '#3d6670'],
            ],
            'protocol'       => [
                'classification' => $spot['risk'] === 'critical' ? 'Grade 4 — High Risk'
                                 : ($spot['risk'] === 'monitor'  ? 'Grade 3 — Medium Risk'
                                                                 : 'Grade 2 — Low Risk'),
                'title'       => 'Response Protocol: ' . $spot['barangay'],
                'description' => 'Awaiting prediction from analytics service.',
                'steps'       => [],
            ],
        ];
    }, $hotspots);

    $alertCount = count(array_filter($hotspots, fn($r) => $r['risk'] !== 'stable'));

    if ($isCurrent) {
        $periodLabel = date('F Y', strtotime("$currentMonth-01"));
    } else {
        $periodLabel = $period === 'month' ? 'Latest Month' : 'Full Year ' . $latestYear;
    }

    /* ── Source labels ───────────────────────────────────────────────────
     * Historical and Current never share a counting source (see
     * disease_case_series), so their source lists say so plainly instead of
     * describing one blended pipeline.
     */
    if ($isCurrent) {
        $sources = [
            ['name' => 'patient_visit_records', 'status' => 'Case counts · live clinic entries (used)'],
            ['name' => 'diseases catalog',      'status' => 'Validates diagnosis before it counts as a case (used)'],
            ['name' => 'Consult_Diagnosis_3Y',  'status' => 'Historical training data · not used in Current view'],
        ];
    } else {
        $sources = [
            ['name' => 'Consult_Diagnosis_3Y',      'status' => 'Case counts · Excel 2023-2025 municipal records (used)'],
            ['name' => 'Barangay_Disease_Monthly',  'status' => 'Trains the risk model · not used for case counts'],
            ['name' => 'Disease_Monthly_2023_2025', 'status' => 'Disease list for the filter (used)'],
        ];
    }

    $liveCoverage = $isCurrent ? db_live_coverage_stats($pdo, $currentMonth) : null;

    return [
        'filters'         => $filters,
        'selectedDisease' => $selected !== '' ? ucwords($selected) : 'All Diseases',
        'period'          => $period,
        'periodLabel'     => $periodLabel,
        'isAllDiseases'   => $isAllDiseases,
        'dataView'        => $dataView,
        'currentMonth'    => $currentMonth,
        // Every card here reads one single source per view, so the section
        // carries one period label and no card restates the year on its own.
        'baselineLabel'   => $isCurrent
            ? 'Live Clinic Records · ' . $periodLabel
            : 'Historical Baseline · 2023-' . $latestYear . ' municipal records (training data)',
        'liveCoverage'    => $liveCoverage,
        'kpis'            => [
            [
                'label' => 'Total Cases',
                'value' => number_format($totalCases),
                'trend' => ($isAllDiseases ? 'All diseases' : ucwords($selected))
                           . ' · all barangays · ' . $periodLabel,
            ],
            [
                'label' => 'Most Common Disease',
                'value' => $topDisease,
                'trend' => 'Top diagnosis · ' . $periodLabel,
            ],
            [
                'label' => 'Most Active Barangay',
                'value' => $topBarangay,
                'trend' => 'Highest case total · ' . $periodLabel,
            ],
            [
                'label' => 'Auto Alerts',
                'value' => str_pad((string) $alertCount, 2, '0', STR_PAD_LEFT),
                'trend' => $isAllDiseases
                    ? 'Generated from automatic risk detection'
                    : 'Generated from automatic risk rules',
            ],
        ],
        // The live-layer teaser strip only makes sense in Historical mode --
        // it exists to point at data that isn't on screen. In Current mode
        // the whole page already is that live data, so showing it again here
        // would be redundant; renderLiveLayer() hides the strip on null.
        'liveLayer'       => $isCurrent ? null : [
            'label'   => 'Live Clinic Records · ' . $currentCalendarYear . ' to date',
            'summary' => live_layer_summary($liveFiltered, $liveTotal, $isAllDiseases,
                                            $isAllDiseases ? '' : ucwords($selected)),
            'latest'  => $liveLatest !== '' ? 'Latest entry ' . $liveLatest : '',
            'note'    => 'Grows as visits are logged; excluded from the baseline figures above. Switch to Current to view them.',
            'total'   => $liveTotal,
        ],
        'predictionSummary' => [
            'total' => count($hotspots),
            'label' => 'Barangays monitored',
        ],
        'sources'      => $sources,
        'actualCases'  => $actualCases,
        'predictedCases' => $predictedCases,
        'insights'     => $insights,
        'map'          => [
            'center'   => [14.9577, 120.9055],
            'zoom'     => 14,
            'metrics'  => [
                ['label' => 'Total Cases',    'value' => number_format($totalCases),
                 'trend' => ($isAllDiseases ? 'All diseases' : ucwords($selected)) . ' · ' . $periodLabel],
                ['label' => 'Disease Filter', 'value' => $isAllDiseases ? 'All Diseases' : ucwords($selected),
                 'trend' => 'Currently selected'],
                ['label' => 'Active Barangay','value' => $topBarangay, 'trend' => 'Highest case count'],
            ],
            'hotspots' => $hotspots,
            'forecast' => array_map(fn($r) => (int) ceil($r['value'] * 1.12), array_slice($actualCases, 0, 8)),
        ],
    ];
}

/* ──────────────────────────────────────────────────────────────────────────
 * VET + ADMIN DASHBOARD  (unchanged from v2 except uses updated helpers)
 * ─────────────────────────────────────────────────────────────────────────
 */

function patient_volume_monthly_rows($pdo): array
{
    $rabiesRows = bv_sheet_rows('Combined_Rabies_3Years');
    $monthly    = [];
    foreach ($rabiesRows as $row) {
        $year    = (int) ($row['year']     ?? 0);
        $monthNo = (int) ($row['month_no'] ?? 0);
        if (!$year || !$monthNo) continue;
        $key = sprintf('%04d-%02d', $year, $monthNo);
        $monthly[$key] = ($monthly[$key] ?? 0) + (int) ($row['clients_served'] ?? 0);
    }

    if (bv_table_exists($pdo, 'appointments')) {
        try {
            $rows = $pdo->query("
                SELECT DATE_FORMAT(preferred_date,'%Y-%m') AS period,
                       COUNT(*) AS value
                FROM appointments
                WHERE preferred_date IS NOT NULL
                GROUP BY YEAR(preferred_date), MONTH(preferred_date), period
            ")->fetchAll();
            foreach ($rows as $row) {
                $monthly[$row['period']] = ($monthly[$row['period']] ?? 0) + (int) ($row['value'] ?? 0);
            }
        } catch (Throwable $e) {}
    }

    /* Build a continuous run of calendar months ending at the current month,
     * filling any month with no data as 0. Slicing straight off $monthly
     * would silently skip months that have no rows (e.g. the historical
     * dataset ends in Dec 2025 and live appointments only start again in
     * May 2026), making the chart's x-axis jump straight from "Dec 25" to
     * "May 26" as if they were adjacent — a misleading, wrong-looking date
     * sequence. */
    $windowSize = 12;
    $rows = [];
    $cursor = new DateTime('first day of this month');
    $cursor->modify('-' . ($windowSize - 1) . ' months');
    for ($i = 0; $i < $windowSize; $i++) {
        $key = $cursor->format('Y-m');
        $rows[] = [
            'period' => $key,
            'label'  => $cursor->format('M'),
            'value'  => $monthly[$key] ?? 0,
        ];
        $cursor->modify('+1 month');
    }
    return $rows;
}

function patient_volume_weekly_rows($pdo): array
{
    /* The historical dataset (Combined_Rabies_3Years) only has month-level
     * granularity, so it can't honestly contribute to a week-by-week view —
     * weekly volume comes from live appointments only. Bucket by real
     * calendar week (Mon–Sun) rather than reusing the monthly buckets, so
     * "Weekly" actually shows weeks instead of the same months as
     * "Monthly" under a shorter slice. */
    $daily = [];
    if (bv_table_exists($pdo, 'appointments')) {
        try {
            $stmt = $pdo->query("
                SELECT DATE(preferred_date) AS d, COUNT(*) AS value
                FROM appointments
                WHERE preferred_date IS NOT NULL
                GROUP BY DATE(preferred_date)
            ");
            foreach ($stmt->fetchAll() as $row) {
                $daily[$row['d']] = (int) $row['value'];
            }
        } catch (Throwable $e) {}
    }

    $weeks     = 8;
    $weekStart = new DateTime('monday this week');
    $weekStart->modify('-' . ($weeks - 1) . ' weeks');

    $rows = [];
    for ($i = 0; $i < $weeks; $i++) {
        $sum    = 0;
        $cursor = clone $weekStart;
        for ($d = 0; $d < 7; $d++) {
            $sum += $daily[$cursor->format('Y-m-d')] ?? 0;
            $cursor->modify('+1 day');
        }
        $rows[] = [
            'period' => $weekStart->format('Y-m-d'),
            'label'  => $weekStart->format('M j'),
            'value'  => $sum,
        ];
        $weekStart->modify('+1 week');
    }
    return $rows;
}

/* Descriptive only: the chart shows real historical visit counts. The old
   per-period prediction overlay (RandomForest call + trend fallback) was
   removed — it hindcast months that had already happened and could stall
   dashboard loading on the analytics service timeout. */
function patient_volume_series($pdo, string $range = 'monthly'): array
{
    return strtolower($range) === 'weekly'
        ? patient_volume_weekly_rows($pdo)
        : patient_volume_monthly_rows($pdo);
}

function vet_dashboard($pdo, string $patientRange = 'monthly', string $disease = '')
{
    [$annualRows, $latest] = annual_dashboard();
    $rabiesRows  = bv_sheet_rows('Combined_Rabies_3Years');
    $latestYear  = (int) ($latest['year'] ?? bv_latest_dataset_year());
    $latestRabies = array_values(array_filter($rabiesRows, fn($row) => (int) ($row['year'] ?? 0) === $latestYear));

    $selected = disease_name_filter($disease);
    [$actualDiseaseCases, $predictedDiseaseCases] = disease_case_series($pdo, $selected, 'year');

    // `predicted` here is the +12% arithmetic fallback from disease_case_series(),
    // NOT a model output. The vet dashboard no longer plots it: it renders the
    // actuals immediately and then fetches the real SARIMA/RF forecast from the
    // analytics service client-side (see vet/js/index.js), hiding the forecast
    // line entirely when that service is unreachable. The field stays in the
    // payload for other consumers of this shape — don't wire it back into a
    // chart, it disagrees with the Disease Analytics page by construction.
    $diseaseByBarangay = [];
    foreach ($actualDiseaseCases as $index => $row) {
        $diseaseByBarangay[] = [
            'barangay'  => $row['barangay'],
            'actual'    => (int) $row['value'],
            'predicted' => $predictedDiseaseCases[$index]['value'] ?? round(((float) $row['value']) * 1.12, 1),
        ];
    }

    $appointmentTotal  = 0;
    $pendingActions    = 0;
    $appointmentsToday = 0;
    if (bv_table_exists($pdo, 'appointments')) {
        try {
            $appointmentTotal  = (int) $pdo->query('SELECT COUNT(*) FROM appointments')->fetchColumn();
            $pendingActions    = (int) $pdo->query("SELECT COUNT(*) FROM appointments WHERE status IN ('pending','confirmed')")->fetchColumn();
            $appointmentsToday = (int) $pdo->query('SELECT COUNT(*) FROM appointments WHERE preferred_date = CURDATE()')->fetchColumn();
        } catch (Throwable $e) { $appointmentTotal = 0; }
    }

    $activeLostReports = 0;
    if (bv_table_exists($pdo, 'lost_found_reports')) {
        try {
            $activeLostReports = (int) $pdo->query("SELECT COUNT(*) FROM lost_found_reports WHERE status IN ('pending','active','approved')")->fetchColumn();
        } catch (Throwable $e) { $activeLostReports = 0; }
    }

    $totalVaccinated = (int) ($latest['total_vaccinated'] ?? 0);
    $clientsServed   = max(1, (int) ($latest['clients_served'] ?? 1));
    $vaccinationRate = min(100, round(($totalVaccinated / $clientsServed) * 100));
    $patientVolume   = patient_volume_series($pdo, $patientRange);

    $vaccineDemand = [
        ['label' => 'Rabies',    'units' => (int) ceil(array_sum(array_map(fn($r) => (int) ($r['total_vaccinated'] ?? 0), array_slice($latestRabies, -3))) / 3)],
        ['label' => 'Parvo',     'units' => (int) ceil(array_sum(array_map(fn($r) => (int) ($r['actual'] ?? 0), $diseaseByBarangay)) * 0.22)],
        ['label' => 'Distemper', 'units' => (int) ceil(array_sum(array_map(fn($r) => (int) ($r['actual'] ?? 0), $diseaseByBarangay)) * 0.18)],
    ];

    $chatbotQueries = 0;
    foreach (['chatbot_consultation_logs', 'chatbot_inquiry_logs'] as $tbl) {
        if (bv_table_exists($pdo, $tbl)) {
            try { $chatbotQueries += (int) $pdo->query("SELECT COUNT(*) FROM $tbl")->fetchColumn(); }
            catch (Throwable $e) {}
        }
    }

    // Last 12 months of real vaccination totals (historical dataset merged
    // with live mass_vaccination_events) — purely historical, no forecast.
    //
    // Built as a continuous run of calendar months ending at the current month,
    // filling any month with no records as 0. Slicing the last 6 rows straight
    // off monthly_vaccination_series() returned the last 6 months that happen
    // to *have* data, which is a different question: with the Excel snapshot
    // ending Dec 2025 and live events resuming Jun 2026, it drew Dec adjacent
    // to Jun as if they were consecutive months, under a card labelled "Last 6
    // Months". Same problem and same fix as patient_volume_monthly_rows().
    $vaccinationByPeriod = [];
    foreach (monthly_vaccination_series($pdo) as $row) {
        $vaccinationByPeriod[$row['period']] = (int) $row['total_vaccinated'];
    }

    $vaccinationTrend = [];
    $trendCursor      = new DateTime('first day of this month');
    $trendCursor->modify('-11 months');
    for ($i = 0; $i < 12; $i++) {
        $trendKey           = $trendCursor->format('Y-m');
        $vaccinationTrend[] = [
            'period' => $trendKey,
            'label'  => $trendCursor->format('M'),
            'value'  => $vaccinationByPeriod[$trendKey] ?? 0,
        ];
        $trendCursor->modify('+1 month');
    }

    return [
        'kpis' => [
            'totalAppointments' => $appointmentTotal ?: array_sum(array_map(fn($r) => (int) ($r['clients_served'] ?? 0), $latestRabies)),
            'pendingActions'    => $pendingActions,
            'activeLostReports' => $activeLostReports,
            'vaccinationRate'   => $vaccinationRate,
            'appointmentsToday' => $appointmentsToday,
        ],
        'chatbotQueries'         => $chatbotQueries,
        'patientVolume'          => $patientVolume,
        'diseaseCasesByBarangay' => $diseaseByBarangay,
        'vaccinated'             => [
            'dogs'  => (int) ($latest['dogs_vaccinated'] ?? 0),
            'cats'  => (int) ($latest['cats_vaccinated'] ?? 0),
            'total' => $totalVaccinated,
            // The ring's caption was the hardcoded string 'Total FY24' in
            // vet/js/index.js while the figure inside it was the latest dataset
            // year's — 2025. The year travels with the number now so the label
            // can't drift from what it describes.
            //
            // This is the frozen municipal baseline (the Dashboard sheet), not
            // live mass_vaccination_events; logging an event moves the trend
            // chart beside it, not this. Same baseline/live split the disease
            // analytics live layer draws above.
            'year'  => $latestYear,
        ],
        'vaccineDemand'     => $vaccineDemand,
        'vaccinationTrend'  => $vaccinationTrend,
        'annualSummary'     => $annualRows,
    ];
}

function admin_module_activity(array $vet): array
{
    $items = [
        ['name' => 'Appointment Management', 'value' => (int) ($vet['kpis']['totalAppointments'] ?? 0)],
        ['name' => 'Patient Records',        'value' => (int) array_sum(array_column($vet['patientVolume'] ?? [], 'value'))],
        ['name' => 'Disease Analytics',      'value' => (int) array_sum(array_column($vet['diseaseCasesByBarangay'] ?? [], 'actual'))],
        ['name' => 'Mass Vaccination',       'value' => (int) ($vet['vaccinated']['total'] ?? 0)],
        ['name' => 'Lost and Found',         'value' => (int) ($vet['kpis']['activeLostReports'] ?? 0)],
        ['name' => 'Chatbot Management',     'value' => (int) ($vet['chatbotQueries'] ?? 0)],
    ];

    $max = max(1, ...array_column($items, 'value'));
    foreach ($items as &$item) {
        $item['pct'] = (int) round(($item['value'] / $max) * 100);
    }
    unset($item);

    return $items;
}

function admin_recent_activity($pdo): array
{
    $roleLabels = ['admin' => 'administrator', 'veterinarian' => 'veterinarian', 'pet_owner' => 'pet owner'];
    $events = [];

    if (bv_table_exists($pdo, 'users')) {
        try {
            $rows = $pdo->query("
                SELECT u.full_name, u.created_at, r.name AS role_name
                FROM users u LEFT JOIN roles r ON r.id = u.role_id
                ORDER BY u.created_at DESC LIMIT 5
            ")->fetchAll();
            foreach ($rows as $r) {
                $roleLabel = $roleLabels[$r['role_name'] ?? ''] ?? 'user';
                $events[] = [
                    'text' => '<strong>' . htmlspecialchars((string) ($r['full_name'] ?? 'Someone')) . '</strong> registered as a new ' . $roleLabel . ' account.',
                    'time' => $r['created_at'],
                    'type' => 'green',
                ];
            }
        } catch (Throwable $e) {}
    }

    if (bv_table_exists($pdo, 'announcements')) {
        try {
            $rows = $pdo->query('SELECT title, created_at FROM announcements ORDER BY created_at DESC LIMIT 5')->fetchAll();
            foreach ($rows as $r) {
                $events[] = [
                    'text' => 'New announcement posted: <strong>' . htmlspecialchars((string) ($r['title'] ?? '')) . '</strong>.',
                    'time' => $r['created_at'],
                    'type' => 'blue',
                ];
            }
        } catch (Throwable $e) {}
    }

    if (bv_table_exists($pdo, 'lost_found_reports')) {
        try {
            $rows = $pdo->query("
                SELECT pet_name, report_type, status, COALESCE(reviewed_at, updated_at, created_at) AS ts
                FROM lost_found_reports ORDER BY ts DESC LIMIT 5
            ")->fetchAll();
            foreach ($rows as $r) {
                $label = $r['pet_name'] !== null && $r['pet_name'] !== '' ? $r['pet_name'] : ucfirst((string) $r['report_type']) . ' report';
                $events[] = [
                    'text' => '<strong>' . htmlspecialchars((string) $label) . '</strong> ' . $r['report_type'] . ' report is now <strong>' . $r['status'] . '</strong>.',
                    'time' => $r['ts'],
                    'type' => $r['status'] === 'rejected' ? 'red' : ($r['status'] === 'resolved' ? 'green' : 'blue'),
                ];
            }
        } catch (Throwable $e) {}
    }

    usort($events, fn($a, $b) => strtotime((string) $b['time']) <=> strtotime((string) $a['time']));

    return array_slice($events, 0, 6);
}

function admin_dashboard($pdo)
{
    $totals = ['totalAccounts' => 0, 'activeAccounts' => 0, 'pendingApprovals' => 0, 'systemAlerts' => 0];
    $recentAccounts = $registrationChart = [];

    if (bv_table_exists($pdo, 'users')) {
        try {
            $totals['totalAccounts']    = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
            $totals['activeAccounts']   = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE account_status='active'")->fetchColumn();
            // Pending pet-owner verifications live in owner_profiles.verification_status,
            // not users.account_status (new registrations get account_status='inactive'
            // until reviewed — see api/auth/register.php).
            $totals['pendingApprovals'] = bv_table_exists($pdo, 'owner_profiles')
                ? (int) $pdo->query("
                    SELECT COUNT(*) FROM users u
                    INNER JOIN roles r ON r.id = u.role_id
                    INNER JOIN owner_profiles op ON op.user_id = u.id
                    WHERE r.name = 'pet_owner' AND op.verification_status = 'pending'
                ")->fetchColumn()
                : 0;
            $recentAccounts = $pdo->query("
                SELECT u.full_name, u.email, u.account_status, u.created_at, r.name AS role_name
                FROM users u LEFT JOIN roles r ON r.id = u.role_id
                ORDER BY u.created_at DESC LIMIT 6
            ")->fetchAll();
            $registrationChart = $pdo->query("
                SELECT DATE_FORMAT(created_at,'%b') AS label, COUNT(*) AS new_accounts
                FROM users WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
                GROUP BY YEAR(created_at), MONTH(created_at), DATE_FORMAT(created_at,'%b')
                ORDER BY YEAR(created_at), MONTH(created_at)
            ")->fetchAll();
        } catch (Throwable $e) { $recentAccounts = []; }
    }

    if (bv_table_exists($pdo, 'lost_found_reports')) {
        try {
            $totals['systemAlerts'] = (int) $pdo->query("SELECT COUNT(*) FROM lost_found_reports WHERE status='pending'")->fetchColumn();
        } catch (Throwable $e) {}
    }

    $vet = vet_dashboard($pdo);
    return [
        'kpis' => array_merge($totals, ['clinicVaccinationRate' => $vet['kpis']['vaccinationRate']]),
        'recentAccounts' => array_map(fn($r) => [
            'name'   => $r['full_name']      ?? 'N/A',
            'role'   => $r['role_name']      ?? 'User',
            'email'  => $r['email']          ?? '',
            'status' => $r['account_status'] ?? '',
            'joined' => substr((string) ($r['created_at'] ?? ''), 0, 10),
        ], $recentAccounts),
        'registrationChart' => array_map(fn($r) => [
            'label'       => $r['label'],
            'newAccounts' => (int) $r['new_accounts'],
        ], $registrationChart),
        'moduleActivity' => admin_module_activity($vet),
        'recentActivity' => admin_recent_activity($pdo),
        'operations' => $vet,
    ];
}

/**
 * Monthly vaccination totals — historical dataset (Combined_Rabies_3Years)
 * with any month that has live mass_vaccination_events coverage replaced
 * by the real DB sum (Excel's monthly totals are a citywide rollup of the
 * same barangay records now in the DB — verified identical for overlapping
 * months — so this avoids double-counting both).
 */
/**
 * The 2025-01-01 cutoff between Historical and Current for Mass Vaccination.
 * mass_vaccination_events itself holds rows from both eras (79 rows dated
 * 2023-2024 alongside live 2025+ entries), so unlike Disease Analytics "is it
 * in the DB" doesn't answer "is it current" here -- the split has to be by
 * event_date, not by table.
 */
const MASS_VACC_CURRENT_CUTOFF = '2025-01-01';

function monthly_vaccination_series($pdo, string $dataView = 'historical'): array
{
    $isCurrent  = $dataView === 'current';
    $rabiesRows = $isCurrent ? [] : bv_sheet_rows('Combined_Rabies_3Years');
    $byMonth    = [];

    foreach ($rabiesRows as $row) {
        $year    = (int) ($row['year']     ?? 0);
        $monthNo = (int) ($row['month_no'] ?? 0);
        if (!$year || !$monthNo) continue;
        $key = sprintf('%04d-%02d', $year, $monthNo);
        if (!isset($byMonth[$key])) {
            $byMonth[$key] = [
                'year' => $year, 'month_no' => $monthNo, 'month' => $row['month'] ?? '',
                'period' => $key, 'dogs_vaccinated' => 0, 'cats_vaccinated' => 0,
                'total_vaccinated' => 0, 'clients_served' => 0, 'source_basis' => $row['source_basis'] ?? '',
            ];
        }
        $byMonth[$key]['dogs_vaccinated']  += (int) ($row['dogs_vaccinated']  ?? 0);
        $byMonth[$key]['cats_vaccinated']  += (int) ($row['cats_vaccinated']  ?? 0);
        $byMonth[$key]['total_vaccinated'] += (int) ($row['total_vaccinated'] ?? 0);
        $byMonth[$key]['clients_served']   += (int) ($row['clients_served']   ?? 0);
    }

    $dbMonthly = [];
    if (bv_table_exists($pdo, 'mass_vaccination_events')) {
        try {
            $dateWhere = $isCurrent
                ? 'AND event_date >= :cutoff'
                : 'AND event_date < :cutoff';
            $monthlyRows = $pdo->prepare("
                SELECT DATE_FORMAT(event_date, '%Y-%m') AS ym,
                       SUM(dogs_count) AS dogs_vaccinated,
                       SUM(cats_count) AS cats_vaccinated,
                       SUM(COALESCE(total_vaccinated, dogs_count + cats_count + others_count)) AS total_vaccinated
                FROM mass_vaccination_events
                WHERE status = 'Completed' {$dateWhere}
                GROUP BY ym
            ");
            $monthlyRows->execute([':cutoff' => MASS_VACC_CURRENT_CUTOFF]);
            foreach ($monthlyRows->fetchAll() as $row) {
                $dbMonthly[$row['ym']] = $row;
            }
        } catch (Throwable $e) { $dbMonthly = []; }
    }

    foreach ($dbMonthly as $ym => $sums) {
        [$year, $monthNo] = array_map('intval', explode('-', $ym));
        $byMonth[$ym] = [
            'year' => $year, 'month_no' => $monthNo,
            'month' => $byMonth[$ym]['month'] ?? date('F', mktime(0, 0, 0, $monthNo, 1)),
            'period' => $ym,
            'dogs_vaccinated'  => (int) $sums['dogs_vaccinated'],
            'cats_vaccinated'  => (int) $sums['cats_vaccinated'],
            'total_vaccinated' => (int) $sums['total_vaccinated'],
            'clients_served'   => (int) $sums['total_vaccinated'],
            'source_basis'     => 'mass_vaccination_events (live records)',
        ];
    }

    ksort($byMonth);
    return array_values($byMonth);
}

function mass_vaccination_dataset_data($pdo, string $dataView = 'historical')
{
    if (!in_array($dataView, ['historical', 'current'], true)) $dataView = 'historical';
    $isCurrent  = $dataView === 'current';
    $latestYear = bv_latest_dataset_year();
    $byMonth    = monthly_vaccination_series($pdo, $dataView);

    $barangayVacc = [];
    if (bv_table_exists($pdo, 'mass_vaccination_events')) {
        try {
            $dateWhere = $isCurrent
                ? 'AND event_date >= :cutoff'
                : 'AND event_date < :cutoff';
            $stmt = $pdo->prepare("
                SELECT barangay,
                       SUM(dogs_count) AS dogs_vaccinated,
                       SUM(cats_count) AS cats_vaccinated,
                       SUM(others_count) AS others_vaccinated,
                       SUM(COALESCE(total_vaccinated, dogs_count + cats_count + others_count)) AS total_vaccinated
                FROM mass_vaccination_events
                WHERE status = 'Completed' {$dateWhere}
                GROUP BY barangay
                ORDER BY total_vaccinated DESC
            ");
            $stmt->execute([':cutoff' => MASS_VACC_CURRENT_CUTOFF]);
            foreach ($stmt->fetchAll() as $row) {
                $barangayVacc[] = [
                    'barangay'          => $row['barangay'],
                    'dogs_vaccinated'   => (int) $row['dogs_vaccinated'],
                    'cats_vaccinated'   => (int) $row['cats_vaccinated'],
                    'others_vaccinated' => (int) $row['others_vaccinated'],
                    'total_vaccinated'  => (int) $row['total_vaccinated'],
                ];
            }
        } catch (Throwable $e) { $barangayVacc = []; }
    }

    $latestYearRows = array_values(array_filter($byMonth, fn($r) => $r['year'] === $latestYear));
    return [
        'data_view'   => $dataView,
        'by_month'    => $byMonth,
        'by_barangay' => $barangayVacc,
        'latest_year' => $latestYearRows,
        'summary'     => [
            'total_dogs'       => array_sum(array_column($byMonth, 'dogs_vaccinated')),
            'total_cats'       => array_sum(array_column($byMonth, 'cats_vaccinated')),
            'total_vaccinated' => array_sum(array_column($byMonth, 'total_vaccinated')),
            'total_clients'    => array_sum(array_column($byMonth, 'clients_served')),
            'years_covered'    => array_values(array_unique(array_column($byMonth, 'year'))),
        ],
    ];
}

/* ──────────────────────────────────────────────────────────────────────────
 * ROUTER
 * ─────────────────────────────────────────────────────────────────────────
 */
$input = dashboard_input();
$scope = strtolower(bv_clean($input['scope'] ?? $input['action'] ?? 'vet'));

if ($scope === 'admin') {
    bv_json_response(200, ['success' => true, 'data' => admin_dashboard($pdo)]);
}

if ($scope === 'disease_analytics' || $scope === 'disease-analytics') {
    bv_json_response(200, ['success' => true, 'data' => disease_analytics_data($pdo)]);
}

if ($scope === 'disease_risk_prediction' || $scope === 'disease-risk-prediction') {
    $barangays              = $input['barangays']                 ?? [];
    $currentCasesByBarangay = $input['current_cases_by_barangay'] ?? [];
    // NEW: forward disease and period so Python routes correctly
    $disease                = bv_clean($input['disease'] ?? '');
    $period                 = bv_clean($input['period']  ?? 'year');
    $steps                  = (int) ($input['steps']    ?? 1);

    if (!is_array($barangays))              $barangays = [];
    if (!is_array($currentCasesByBarangay)) $currentCasesByBarangay = [];

    $barangays = array_values(array_filter(array_map('bv_clean', $barangays), fn($n) => $n !== ''));
    $cleanCases = [];
    foreach ($currentCasesByBarangay as $b => $cases) {
        $b = bv_clean($b);
        if ($b !== '') $cleanCases[$b] = (float) $cases;
    }

    $rf = get_disease_predictions($barangays, $cleanCases, $disease, $period, $steps);
    bv_json_response($rf['success'] ? 200 : 502, $rf);
}

if ($scope === 'mass_vaccination_dataset') {
    $mvDataView = strtolower(bv_clean($input['data_view'] ?? $_GET['data_view'] ?? 'historical'));
    bv_json_response(200, ['success' => true, 'data' => mass_vaccination_dataset_data($pdo, $mvDataView)]);
}

if ($scope === 'vaccination_forecast' || $scope === 'vaccination-forecast') {
    $steps  = max(1, min(12, (int) ($input['steps'] ?? 3)));
    $result = analytics_post('/vaccination-forecast', ['steps' => $steps]);
    bv_json_response($result['success'] ? 200 : 502, $result);
}

if ($scope === 'rf_model_info' || $scope === 'rf-model-info') {
    $result = analytics_get('/rf-model-info');
    bv_json_response($result['success'] ? 200 : 502, $result);
}

bv_json_response(200, ['success' => true, 'data' => vet_dashboard(
    $pdo,
    strtolower(bv_clean($input['patient_range'] ?? $input['range'] ?? 'monthly')),
    bv_clean($input['disease'] ?? '')
)]);

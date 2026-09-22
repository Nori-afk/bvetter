<?php
/**
 * BVetter — one timeline of disease cases: the uploaded dataset, then typed visits.
 *
 * WHY THIS EXISTS (decided 2026-09-22)
 * Cases live in two tables. An uploaded workbook lands in
 * historical_consultations; a visit a vet types in lands in
 * patient_visit_records. The forecaster already read them as one timeline split
 * by month (_load_consult_diagnosis_raw in api/analytics/arima_service.py), but
 * the screens did not. Disease Analytics' Current view read typed visits only,
 * so January 2026 said "no records" beside 65 uploaded consultations; the
 * Disease report read a retired sheet and stopped at December 2025; the
 * Consultation report added both sources together whole. Four screens, three
 * answers for one month. Every screen that counts cases goes through here now.
 *
 * THE RULE
 *   - The active upload owns every month up to and including its last month
 *     (bv_upload_last_month), in full.
 *   - Typed visits count only in the months after that.
 *   - A typed visit in an owned month stays on the patient's record. It is not
 *     counted, and the upload that took its month over says so.
 *
 * Nothing is copied between the two tables. Switching dataset versions moves
 * the boundary with it, and rollback stays a pointer flip.
 *
 * Both sources count the same unit: affected animals. An uploaded row carries
 * cases_reported (the animals that consultation covered); a typed visit is one
 * pet, and a multi-pet consultation is saved as one visit per pet (saveBatch in
 * api/patient-records/patient_records.php). So a sum on one side and a count on
 * the other need no conversion.
 */

require_once __DIR__ . '/dataset_versions.php';
require_once __DIR__ . '/patient_tables.php';

/**
 * THE OVERLAP RULE: typed visits count only in months strictly after the 'Y-m'
 * this returns, and in every month when it returns null.
 *
 * It lives here and nowhere else. Every consumer takes the upload's rows for
 * the months it holds PLUS typed visits after this answer, never "one or the
 * other", so counting both in the same month (should the clinic want that
 * later) means changing this function -- and the matching after_year/after_month
 * cut in _load_consult_diagnosis_raw() on the Python side. Doing that safely
 * needs a way to tell a typed visit and an uploaded row apart as the same
 * consultation first; nothing links the two today.
 */
function bv_live_visits_count_after($pdo = null)
{
    return bv_upload_last_month($pdo);
}

/** Whether typed visits count in month $ym ('Y-m'). */
function bv_live_counts_in_month($ym, $pdo = null)
{
    $after = bv_live_visits_count_after($pdo);
    return $after === null || $ym > $after;
}

/**
 * Where month $ym's cases come from: any of 'upload' and 'live'. Months before
 * the upload's first row still read 'upload' -- the upload owns them and simply
 * holds nothing for them.
 *
 * @return string[]
 */
function bv_month_sources($ym, $pdo = null)
{
    $sources = [];
    $last = bv_upload_last_month($pdo);
    if ($last !== null && $ym <= $last) $sources[] = 'upload';
    if (bv_live_counts_in_month($ym, $pdo)) $sources[] = 'live';
    return $sources;
}

/**
 * The rule as a SQL condition on patient_visit_records, for queries that count
 * typed visits. $dateExpr is the caller's visit-date expression.
 *
 * @return array{0:string,1:array} [condition, params]; condition is '' when every month counts
 */
function bv_live_month_condition($dateExpr, $pdo = null)
{
    $after = bv_live_visits_count_after($pdo);
    if ($after === null) return ['', []];
    return ["DATE_FORMAT({$dateExpr}, '%Y-%m') > :bv_live_after", [':bv_live_after' => $after]];
}

/**
 * Typed visits an upload has just stopped counting: case visits in months that
 * counted under the old boundary and fall inside the new one.
 *
 * Reported rather than prevented. The upload is the clinic's master record for
 * those months, so it wins; but a vet who logged those visits deserves to learn
 * they no longer count, not to discover it from a chart.
 *
 * @return array{count:int, months:string[]}
 */
function bv_upload_shadowed_visits(PDO $pdo, $countedAfterBefore, $countedAfterNow)
{
    $none = ['count' => 0, 'months' => []];
    if ($countedAfterNow === null || $countedAfterNow === $countedAfterBefore) return $none;
    if (!bv_table_exists($pdo, 'patient_visit_records')) return $none;

    $month  = "DATE_FORMAT(COALESCE(visit_date, created_at), '%Y-%m')";
    $where  = ["{$month} <= :now"];
    $params = [':now' => $countedAfterNow];
    if ($countedAfterBefore !== null) {
        $where[] = "{$month} > :before";
        $params[':before'] = $countedAfterBefore;
    }
    // Only visits that were cases: one with no listed diagnosis never counted,
    // so the upload took nothing from it.
    if (bv_table_exists($pdo, 'diseases')) {
        $where[] = 'diagnosis IN (SELECT name FROM diseases WHERE is_active = 1)';
    }

    try {
        $stmt = $pdo->prepare("SELECT {$month} AS ym, COUNT(*) AS n FROM patient_visit_records
                               WHERE " . implode(' AND ', $where) . " GROUP BY ym ORDER BY ym");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        return $none;
    }

    return [
        'count'  => (int) array_sum(array_column($rows, 'n')),
        'months' => array_map(fn($r) => date('F Y', strtotime($r['ym'] . '-01')), $rows),
    ];
}

/**
 * Whether the upload's last month is only partly covered: the month has not
 * finished yet, or its last consultation falls more than a week before the
 * month ends. The upload owns that month in full either way (see
 * bv_upload_last_month), so the rest of it has to come from the next upload --
 * manual entry stays closed until the month after.
 *
 * A week of slack because a clinic closed at the weekend or over a holiday
 * legitimately has nothing on the last few days.
 *
 * @return array{lastDate:string, month:string, entryOpens:string}|null
 */
function bv_upload_partial_last_month(PDO $pdo, $versionId, $lastMonth)
{
    if ($lastMonth === null) return null;
    [$year, $monthNo] = array_map('intval', explode('-', $lastMonth));
    try {
        $stmt = $pdo->prepare("SELECT MAX(consultation_date) FROM historical_consultations
                               WHERE dataset_version_id = :v AND year = :y AND month_no = :m");
        $stmt->execute([':v' => (int) $versionId, ':y' => $year, ':m' => $monthNo]);
        $lastDate = (string) $stmt->fetchColumn();
    } catch (Throwable $e) {
        error_log('[BVetter] ' . __FILE__ . ': ' . $e->getMessage());
        return null;
    }
    if ($lastDate === '') return null;

    $monthEnd   = date('Y-m-t', strtotime($lastMonth . '-01'));
    $unfinished = date('Y-m-d') <= $monthEnd;
    $endsEarly  = $lastDate < date('Y-m-d', strtotime($monthEnd . ' -7 days'));
    if (!$unfinished && !$endsEarly) return null;

    return [
        'lastDate'   => date('F j, Y', strtotime($lastDate)),
        'month'      => date('F Y', strtotime($lastMonth . '-01')),
        'entryOpens' => date('F j, Y', strtotime($monthEnd . ' +1 day')),
    ];
}

/** 'Y-m' of an uploaded row, from its year/month_no columns; '' when they are unusable. */
function bv_row_month($row)
{
    $year  = (int) ($row['year'] ?? 0);
    $month = (int) ($row['month_no'] ?? 0);
    return ($year > 0 && $month >= 1 && $month <= 12) ? sprintf('%04d-%02d', $year, $month) : '';
}

/** Uploaded rows for the months from $fromYm to $toYm inclusive; '' leaves that end open. */
function bv_upload_rows_between($fromYm = '', $toYm = '')
{
    $rows = [];
    foreach (bv_sheet_rows('Consult_Diagnosis_3Y') as $row) {
        $ym = bv_row_month($row);
        if ($ym === '') continue;
        if ($fromYm !== '' && $ym < $fromYm) continue;
        if ($toYm !== '' && $ym > $toYm) continue;
        $rows[] = $row;
    }
    return $rows;
}

/**
 * Cases per barangay from the upload, counted exactly the way Historical counts
 * them (disease_case_series): exact diagnosis match, blank barangays skipped,
 * cases_reported summed. The same month must never show two totals.
 */
function bv_upload_barangay_counts($selected, $fromYm = '', $toYm = '')
{
    $counts = [];
    foreach (bv_upload_rows_between($fromYm, $toYm) as $row) {
        if ($selected !== '' && strtolower(trim((string) ($row['diagnosis'] ?? ''))) !== $selected) continue;
        $barangay = trim((string) ($row['barangay'] ?? ''));
        if ($barangay === '') continue;
        $counts[$barangay] = ($counts[$barangay] ?? 0) + (float) ($row['cases_reported'] ?? 1);
    }
    return $counts;
}

/**
 * Per month of the upload: how many consultations it holds and the cases they
 * report, keyed 'Y-m'.
 *
 * @return array<string, array{consultations:int, cases:int}>
 */
function bv_upload_month_summary()
{
    $months = [];
    foreach (bv_sheet_rows('Consult_Diagnosis_3Y') as $row) {
        $ym = bv_row_month($row);
        if ($ym === '') continue;
        $months[$ym] ??= ['consultations' => 0, 'cases' => 0];
        $months[$ym]['consultations']++;
        $months[$ym]['cases'] += (int) ($row['cases_reported'] ?? 1);
    }
    return $months;
}

/**
 * The report bucket for a disease category, from either vocabulary: the
 * ten-value display category (what uploads and, since 2026-08-26, typed visits
 * store) or the older four-bucket value a visit saved before then may still
 * hold. Matching only the old values put every newer typed visit in
 * General/Other.
 */
function bv_case_bucket($category)
{
    $category = trim((string) $category);
    if (in_array($category, ['Skin', 'Parasitic', 'Respiratory', 'Gastrointestinal'], true)) return $category;
    return diseaseBucketForCategory($category);
}

/** Rabies-type and leptospirosis cases: notifiable, so one is enough to act on. */
function bv_is_zoonotic_category($category)
{
    return strtolower(trim((string) $category)) === 'zoonotic / reportable';
}

/**
 * Needs Action / Watch / Normal for every barangay-month in $rows.
 *
 * The same rule the analytics service serves on Disease Analytics (see "The
 * action tier: a RULE over what has been OBSERVED" in
 * api/analytics/arima_service.py), so the report and the page cannot flag the
 * same month differently:
 *
 *   Needs Action  any reportable case in the barangay's last 3 months, or cases
 *                 above its own 90th percentile
 *   Watch         cases above its own 75th percentile
 *   Normal        otherwise
 *
 * Each barangay is measured against its own history, not a fixed cut-off. The
 * fixed 9/15 bands this replaced were fitted to a retired sheet running 9-30
 * cases a month; on the uploaded data (1-15) they called 95.6% of months Low
 * and none High, and marked every suspected-rabies month Low.
 *
 * Mirrors the service's arithmetic: percentiles are pandas' expanding quantiles
 * (linear interpolation, up to and including the month), taken over a history in
 * which months the upload holds no consultations for count as zero -- the same
 * zero-filled span _densify_history() builds. Months of typed visits are not
 * zero-filled, for the reason that function gives: an empty month there more
 * likely means "not entered yet" than "no cases".
 *
 * @param array $rows each: barangay, ym ('Y-m'), total, zoonotic, fromUpload (bool).
 *                    Rows sharing a barangay and month are added together.
 * @return array<string, string> keyed "barangay|ym"
 */
function bv_action_tiers(array $rows)
{
    $cells = [];
    $uploadBarangays = [];
    $uploadFirst = $uploadLast = '';
    foreach ($rows as $row) {
        $barangay = (string) ($row['barangay'] ?? '');
        $ym = (string) ($row['ym'] ?? '');
        if ($barangay === '' || $ym === '') continue;
        $key = $barangay . '|' . $ym;
        $cells[$key] ??= ['barangay' => $barangay, 'ym' => $ym, 'total' => 0.0, 'zoonotic' => 0.0];
        $cells[$key]['total']    += (float) ($row['total'] ?? 0);
        $cells[$key]['zoonotic'] += (float) ($row['zoonotic'] ?? 0);
        if (!empty($row['fromUpload'])) {
            $uploadBarangays[$barangay] = true;
            if ($uploadFirst === '' || $ym < $uploadFirst) $uploadFirst = $ym;
            if ($ym > $uploadLast) $uploadLast = $ym;
        }
    }

    // Zero-fill the upload's span for every barangay it names, from January of
    // its first year (as _densify_history does) through its last month.
    if ($uploadFirst !== '') {
        $month = new DateTime(substr($uploadFirst, 0, 4) . '-01-01');
        $end   = new DateTime($uploadLast . '-01');
        for (; $month <= $end; $month->modify('+1 month')) {
            $ym = $month->format('Y-m');
            foreach (array_keys($uploadBarangays) as $barangay) {
                $cells[$barangay . '|' . $ym] ??= ['barangay' => $barangay, 'ym' => $ym, 'total' => 0.0, 'zoonotic' => 0.0];
            }
        }
    }

    $byBarangay = [];
    foreach ($cells as $key => $cell) $byBarangay[$cell['barangay']][$cell['ym']] = $key;

    $tiers = [];
    foreach ($byBarangay as $months) {
        ksort($months);
        $history = [];
        $zoonoticWindow = [];
        foreach ($months as $key) {
            $cell = $cells[$key];
            $history[] = $cell['total'];
            $zoonoticWindow[] = $cell['zoonotic'];
            if (count($zoonoticWindow) > 3) array_shift($zoonoticWindow);

            $sorted = $history;
            sort($sorted);
            $p75 = bv_quantile_linear($sorted, 0.75);
            $p90 = bv_quantile_linear($sorted, 0.90);

            if (array_sum($zoonoticWindow) > 0 || $cell['total'] > $p90) $tiers[$key] = 'Needs Action';
            elseif ($cell['total'] > $p75)                               $tiers[$key] = 'Watch';
            else                                                         $tiers[$key] = 'Normal';
        }
    }
    return $tiers;
}

/** Quantile of already-sorted values, interpolated linearly -- pandas' default. */
function bv_quantile_linear(array $sorted, $q)
{
    $n = count($sorted);
    if ($n === 0) return 0.0;
    $position = ($n - 1) * $q;
    $low  = (int) floor($position);
    $high = (int) ceil($position);
    return $sorted[$low] + ($sorted[$high] - $sorted[$low]) * ($position - $low);
}

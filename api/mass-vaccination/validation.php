<?php

/** Shared validation for saved vaccination reports and their comparisons. */
function mv_whole_count($value, string $label): int
{
    if (is_bool($value) || (!is_int($value) && !is_float($value) && !is_string($value))
        || (is_string($value) && !preg_match('/^\d+$/D', trim($value)))
        || !is_numeric($value) || !is_finite((float) $value)
        || (float) $value < 0 || (float) $value > 2147483647
        || floor((float) $value) !== (float) $value) {
        throw new InvalidArgumentException($label . ' must be a whole number of zero or more.');
    }
    return (int) $value;
}

function mv_report_counts(array $data): array
{
    $total = mv_whole_count($data['totalVaccinated'] ?? $data['total_vaccinated'] ?? null, 'Total vaccinated');
    $breakdown = $data['breakdown'] ?? [];
    if (is_string($breakdown)) $breakdown = json_decode($breakdown, true);
    if (!is_array($breakdown)) {
        throw new InvalidArgumentException('The species breakdown must contain valid counts.');
    }
    $counts = [];
    foreach (['dogs', 'cats', 'others'] as $species) {
        $counts[$species] = mv_whole_count($breakdown[$species] ?? $data[$species] ?? 0, ucfirst($species));
    }
    $sum = array_sum($counts);
    if ($sum !== 0 && $sum !== $total) {
        throw new InvalidArgumentException('The species counts must add up to the total vaccinated. Leave them at zero when no breakdown was recorded.');
    }
    return ['total' => $total] + $counts;
}

function mv_event_id(array $data): int
{
    $value = $data['id'] ?? $data['event_id'] ?? null;
    if (is_string($value) && str_starts_with($value, 'evt-')) $value = substr($value, 4);
    $id = mv_whole_count($value, 'Event ID');
    if ($id < 1) throw new InvalidArgumentException('Invalid event ID.');
    return $id;
}

function mv_name_key(string $name): string
{
    // iconv's transliteration varies by Windows/Linux locale; keep local names
    // such as Sto. Niño consistent on both deployments.
    $name = strtr($name, ['ñ' => 'n', 'Ñ' => 'N', 'á' => 'a', 'Á' => 'A',
        'é' => 'e', 'É' => 'E', 'í' => 'i', 'Í' => 'I', 'ó' => 'o', 'Ó' => 'O',
        'ú' => 'u', 'Ú' => 'U', 'ü' => 'u', 'Ü' => 'U']);
    $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $name);
    return preg_replace('/\s+/', ' ', strtolower(trim(str_replace('.', '', $ascii === false ? $name : $ascii))));
}

function mv_is_anti_rabies(string $vaccine): bool
{
    return in_array(preg_replace('/[\s-]+/', '', strtolower(trim($vaccine))), ['antirabies', 'rabies'], true);
}

function mv_event_comparison(array $event, array $rows): array
{
    $values = [];
    foreach ($rows as $row) {
        if ((int) $row['id'] === (int) $event['id'] || $row['status'] !== 'Completed'
            || $row['event_date'] > date('Y-m-d')
            || mv_name_key($row['barangay']) !== mv_name_key($event['barangay'])) continue;
        $sameVaccine = mv_is_anti_rabies($row['vaccine']) && mv_is_anti_rabies($event['vaccine']);
        if (!$sameVaccine && mv_name_key($row['vaccine']) !== mv_name_key($event['vaccine'])) continue;
        try {
            $values[] = mv_whole_count($row['total_vaccinated'], 'Total vaccinated');
        } catch (InvalidArgumentException $e) {
            continue;
        }
    }
    return [
        'event' => $event['status'] === 'Completed' && $event['total_vaccinated'] !== null
            ? (int) $event['total_vaccinated'] : null,
        'average' => $values ? round(array_sum($values) / count($values), 1) : null,
        'highest' => $values ? max($values) : null,
        'sampleCount' => count($values),
    ];
}

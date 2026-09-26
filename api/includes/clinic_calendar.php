<?php
/**
 * Days the clinic is closed on a weekday: Philippine holidays, plus any date
 * an admin adds under Website Management -> Clinic Closed Dates.
 *
 * Used by the booking calendar and the server's date check (no appointments
 * on a closed day) and by the review time limits (api/includes/
 * working_hours.php), so a Friday request before a long weekend isn't
 * expired, and an application isn't flagged Overdue, while nobody could have
 * been at work.
 *
 * Built in: the regular holidays and the special non-working days the law
 * fixes to a date (or to a rule, like Holy Week and National Heroes Day).
 * Not built in, because they move by proclamation or by the lunar calendar:
 * Eid'l Fitr, Eid'l Adha, Chinese New Year, one-off special days and the
 * town fiesta. The office adds those itself.
 */

/** Easter Sunday for a Gregorian year (anonymous Gregorian algorithm). */
function easterSunday(int $year): DateTimeImmutable
{
    $a = $year % 19;
    $b = intdiv($year, 100);
    $c = $year % 100;
    $d = intdiv($b, 4);
    $e = $b % 4;
    $f = intdiv($b + 8, 25);
    $g = intdiv($b - $f + 1, 3);
    $h = (19 * $a + $b - $d - $g + 15) % 30;
    $i = intdiv($c, 4);
    $k = $c % 4;
    $l = (32 + 2 * $e + 2 * $i - $h - $k) % 7;
    $m = intdiv($a + 11 * $h + 22 * $l, 451);
    $month = intdiv($h + $l - 7 * $m + 114, 31);
    $day = (($h + $l - 7 * $m + 114) % 31) + 1;
    return new DateTimeImmutable(sprintf('%04d-%02d-%02d', $year, $month, $day));
}

/** ['Y-m-d' => name] for one year's built-in holidays. */
function philippineHolidays(int $year): array
{
    $fixed = [
        '01-01' => "New Year's Day",
        '04-09' => 'Araw ng Kagitingan',
        '05-01' => 'Labor Day',
        '06-12' => 'Independence Day',
        '08-21' => 'Ninoy Aquino Day',
        '11-01' => "All Saints' Day",
        '11-30' => 'Bonifacio Day',
        '12-08' => 'Feast of the Immaculate Conception',
        '12-25' => 'Christmas Day',
        '12-30' => 'Rizal Day',
        '12-31' => 'Last Day of the Year',
    ];

    $days = [];
    foreach ($fixed as $md => $name) {
        $days[$year . '-' . $md] = $name;
    }

    $easter = easterSunday($year);
    $days[$easter->modify('-3 days')->format('Y-m-d')] = 'Maundy Thursday';
    $days[$easter->modify('-2 days')->format('Y-m-d')] = 'Good Friday';

    // Last Monday of August.
    $heroes = new DateTimeImmutable("last monday of august {$year}");
    $days[$heroes->format('Y-m-d')] = 'National Heroes Day';

    return $days;
}

/**
 * Parses the admin's Clinic Closed Dates text: one date per line, as
 * YYYY-MM-DD, optionally followed by a name ("2026-03-20 Eid'l Fitr").
 * Anything else on a line is ignored rather than rejected, so a typo can't
 * lock the settings page.
 */
function parseClosedDates(?string $text): array
{
    $days = [];
    foreach (preg_split('/\R/', (string) $text) as $line) {
        if (!preg_match('/^\s*(\d{4}-\d{2}-\d{2})\s*(.*)$/', $line, $m)) continue;
        [$y, $mo, $d] = array_map('intval', explode('-', $m[1]));
        if (!checkdate($mo, $d, $y)) continue;
        $days[$m[1]] = trim($m[2]) !== '' ? mb_substr(trim($m[2]), 0, 80) : 'Clinic closed';
    }
    return $days;
}

/**
 * The admin-added dates, read once per request. Loaded by
 * loadClinicCalendar(); until then only the built-in holidays apply, which
 * keeps the office-hours arithmetic usable without a database handle.
 */
function clinicExtraClosedDates(?array $set = null): array
{
    static $extra = [];
    if ($set !== null) $extra = $set;
    return $extra;
}

function loadClinicCalendar(PDO $pdo): void
{
    static $loaded = false;
    if ($loaded) return;
    $loaded = true;
    try {
        $column = $pdo->query("SHOW COLUMNS FROM site_settings LIKE 'closed_dates'")->fetch();
        if (!$column) return;
        $text = $pdo->query('SELECT closed_dates FROM site_settings WHERE id = 1')->fetchColumn();
        clinicExtraClosedDates(parseClosedDates($text ?: ''));
    } catch (Throwable $e) {
        // No site_settings table yet: built-in holidays only.
    }
}

/** The holiday's name if the clinic is closed on this weekday, else null. */
function clinicClosedReason(string $ymd): ?string
{
    static $byYear = [];
    $year = (int) substr($ymd, 0, 4);
    $byYear[$year] ??= philippineHolidays($year);
    return clinicExtraClosedDates()[$ymd] ?? $byYear[$year][$ymd] ?? null;
}

/** ['Y-m-d' => name] for every closed weekday from $from to $to inclusive. */
function clinicClosedDatesBetween(string $from, string $to): array
{
    $days = [];
    $t = new DateTimeImmutable($from);
    $end = new DateTimeImmutable($to);
    for ($i = 0; $t <= $end && $i < 800; $i++, $t = $t->modify('+1 day')) {
        if ((int) $t->format('N') >= 6) continue;
        $reason = clinicClosedReason($t->format('Y-m-d'));
        if ($reason !== null) $days[$t->format('Y-m-d')] = $reason;
    }
    return $days;
}

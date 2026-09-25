<?php
/**
 * Office-hours arithmetic for the review time limits.
 *
 * The clinic works Monday to Friday, 8:00 AM to 5:00 PM (the same days and
 * hours the booking page offers -- see public/js/book-appointment.js). A time
 * limit counted on the wall clock would let a Friday-evening request expire,
 * or an application turn Overdue, over a weekend nobody was at work. These
 * count office time only: "1 working day" is 9 office hours, so a request
 * made Monday at 10:00 is due Tuesday at 10:00, and one made Friday at 18:00
 * is due Monday at 17:00.
 *
 * Holidays are not modelled -- there is no holiday calendar in the system --
 * so a holiday on a weekday counts as a working day.
 */

const BV_OFFICE_OPEN_HOUR  = 8;
const BV_OFFICE_CLOSE_HOUR = 17;
const BV_OFFICE_MINUTES_PER_DAY = (BV_OFFICE_CLOSE_HOUR - BV_OFFICE_OPEN_HOUR) * 60;

/** The first moment at or after $t when the office is open. */
function nextOfficeMoment(DateTimeImmutable $t): DateTimeImmutable
{
    for ($i = 0; $i < 14; $i++) {
        $isWeekday = (int) $t->format('N') <= 5;
        $open  = $t->setTime(BV_OFFICE_OPEN_HOUR, 0);
        $close = $t->setTime(BV_OFFICE_CLOSE_HOUR, 0);

        if ($isWeekday && $t < $close) {
            return $t < $open ? $open : $t;
        }
        $t = $t->modify('+1 day')->setTime(BV_OFFICE_OPEN_HOUR, 0);
    }
    return $t;
}

/** $start plus $minutes of office time. */
function addOfficeMinutes(DateTimeImmutable $start, int $minutes): DateTimeImmutable
{
    $t = nextOfficeMoment($start);
    while ($minutes > 0) {
        $close = $t->setTime(BV_OFFICE_CLOSE_HOUR, 0);
        $left = intdiv($close->getTimestamp() - $t->getTimestamp(), 60);
        if ($minutes <= $left) {
            return $t->modify('+' . $minutes . ' minutes');
        }
        $minutes -= $left;
        $t = nextOfficeMoment($close->modify('+1 day')->setTime(0, 0));
    }
    return $t;
}

function addWorkingDays(DateTimeImmutable $start, int $days): DateTimeImmutable
{
    return addOfficeMinutes($start, $days * BV_OFFICE_MINUTES_PER_DAY);
}

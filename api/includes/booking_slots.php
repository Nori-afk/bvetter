<?php
/**
 * Free appointment times to offer an owner whose request didn't go through
 * -- the time went to another owner's request, or the clinic didn't confirm
 * it in time -- so the notice can say "Free that day: 11:00 AM, 1:00 PM"
 * instead of sending them back to an empty form.
 *
 * Only fully free times count: no confirmed booking, no held reschedule and
 * no other pending request, so the owner isn't sent to another time they
 * could lose again. The slots mirror ALL_TIME_SLOTS on the booking page
 * (public/js/book-appointment.js).
 */

require_once __DIR__ . '/clinic_calendar.php';

const BV_BOOKING_SLOTS = ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];

/** '3:00 PM' or '15:00' -> '15:00', so old 12-hour rows compare correctly. */
function canonicalBookingSlot($value): string
{
    $text = trim((string) $value);
    if (preg_match('/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i', $text, $m)) {
        $hour = (int) $m[1] % 12;
        if (strtoupper($m[3]) === 'PM') $hour += 12;
        return sprintf('%02d:%s', $hour, $m[2]);
    }
    if (preg_match('/^(\d{1,2}):(\d{2})$/', $text, $m)) {
        return sprintf('%02d:%s', (int) $m[1], $m[2]);
    }
    return $text;
}

function bookingSlotLabel(string $slot): string
{
    $time = DateTimeImmutable::createFromFormat('H:i', canonicalBookingSlot($slot));
    return $time ? $time->format('g:i A') : $slot;
}

/** Times already spoken for on a date, for this vet (or any, when none). */
function busyBookingTimes(PDO $pdo, int $vetId, string $date): array
{
    $vetClause = $vetId > 0 ? 'AND (veterinarian_id = :vet OR veterinarian_id IS NULL)' : '';
    $params = [':date' => $date];
    if ($vetId > 0) $params[':vet'] = $vetId;

    $stmt = $pdo->prepare("
        SELECT time_slot FROM appointments
        WHERE preferred_date = :date
          AND status IN ('pending', 'confirmed', 'completed', 'reschedule_pending')
          {$vetClause}
    ");
    $stmt->execute($params);
    $busy = $stmt->fetchAll(PDO::FETCH_COLUMN);

    try {
        $held = $pdo->prepare("
            SELECT proposed_time_slot FROM appointments
            WHERE proposed_date = :date AND status = 'reschedule_pending'
              {$vetClause}
        ");
        $held->execute($params);
        $busy = array_merge($busy, $held->fetchAll(PDO::FETCH_COLUMN));
    } catch (PDOException $e) {
        // No reschedule columns yet: nothing is held.
    }

    return array_map('canonicalBookingSlot', array_filter($busy));
}

/**
 * Up to $limit fully free times on $date, or -- when that day is full,
 * past or closed -- on the next open weekday, looking two weeks ahead.
 * Returns ['date' => 'Y-m-d', 'times' => ['11:00 AM', ...]] or null.
 */
function freeBookingTimes(PDO $pdo, int $vetId, string $date, int $limit = 3): ?array
{
    // Only a hint in a notice: if the lookup fails, the notice goes out
    // without it rather than failing the confirm or expiry that sent it.
    try {
        loadClinicCalendar($pdo);
        $today = new DateTimeImmutable('today');
        $day = new DateTimeImmutable($date);
        if ($day < $today) $day = $today;

        for ($i = 0; $i < 14; $i++, $day = $day->modify('+1 day')) {
            $ymd = $day->format('Y-m-d');
            if ((int) $day->format('N') >= 6 || clinicClosedReason($ymd) !== null) continue;

            $busy = busyBookingTimes($pdo, $vetId, $ymd);
            $free = [];
            foreach (BV_BOOKING_SLOTS as $slot) {
                if (in_array($slot, $busy, true)) continue;
                if (strtotime("{$ymd} {$slot}") <= time()) continue;
                $free[] = bookingSlotLabel($slot);
                if (count($free) >= $limit) break;
            }
            if ($free) return ['date' => $ymd, 'times' => $free];
        }
    } catch (Throwable $e) {
        error_log('[BVetter] free times lookup failed: ' . $e->getMessage());
    }
    return null;
}

/** "Free that day: 11:00 AM, 1:00 PM." or "Free on Oct 8: 8:00 AM, 9:00 AM." */
function freeTimesSentence(?array $free, string $requestedDate): string
{
    if (!$free) return '';
    $label = $free['date'] === $requestedDate
        ? 'Free that day'
        : 'Free on ' . (new DateTimeImmutable($free['date']))->format('M j');
    return $label . ': ' . implode(', ', $free['times']) . '.';
}

/**
 * Opens the booking form filled with this request's pet and visit type, on
 * the day the free times were found (public/js/book-appointment.js).
 */
function rebookUrl(int $appointmentId, ?array $free = null): string
{
    $url = APP_URL . '/public/pages/book-appointment.html?rebook=' . $appointmentId;
    return $free ? $url . '&date=' . $free['date'] : $url;
}

-- Normalise appointment time slots to 24-hour 'HH:MM'.
--
-- Slots were written in two shapes: '3:00 PM' from the owner booking form and
-- '15:00' from the vet's reschedule picker. They are compared as plain strings,
-- so a 12-hour row was invisible to a 24-hour conflict check -- its slot stayed
-- selectable in the reschedule modal and could be double-booked. Sorting and
-- `new Date(date + 'T' + time_slot)` in the vet dashboard were broken too.
--
-- Safe to run on a live database: only the format changes, never the actual
-- time. Re-running it is a no-op, since normalised rows no longer match either
-- WHERE clause.
--
-- Run this AFTER pulling the code that writes canonical slots
-- (canonicalTimeSlot in api/appointments/appointment.php), so nothing writes a
-- 12-hour value in behind you.

-- '3:00 PM' -> '15:00', '8:00 AM' -> '08:00'
UPDATE appointments
SET time_slot = DATE_FORMAT(STR_TO_DATE(time_slot, '%l:%i %p'), '%H:%i')
WHERE time_slot REGEXP '(AM|PM)$';

UPDATE appointments
SET proposed_time_slot = DATE_FORMAT(STR_TO_DATE(proposed_time_slot, '%l:%i %p'), '%H:%i')
WHERE proposed_time_slot REGEXP '(AM|PM)$';

-- '9:00' -> '09:00', so string comparison and sorting line up.
UPDATE appointments
SET time_slot = LPAD(time_slot, 5, '0')
WHERE time_slot REGEXP '^[0-9]:[0-9]{2}$';

UPDATE appointments
SET proposed_time_slot = LPAD(proposed_time_slot, 5, '0')
WHERE proposed_time_slot REGEXP '^[0-9]:[0-9]{2}$';

-- Verify -- every row should read HH:MM and nothing should remain 12-hour:
--   SELECT DISTINCT time_slot FROM appointments ORDER BY time_slot;
--   SELECT COUNT(*) FROM appointments WHERE time_slot REGEXP '(AM|PM)$';

-- Reschedule handshake: a vet-proposed time now waits for the pet owner to
-- accept or decline it, so the proposed date/time is stored separately from
-- the booking the owner already agreed to.
--
-- The app applies this automatically on the first appointment request after
-- deploy (ensureRescheduleSchema in api/appointments/appointment.php). Run it
-- here instead if you would rather change the live schema deliberately, or if
-- the database user has no ALTER privilege and the automatic attempt failed.
--
-- Safe to run on a live database: every column is nullable and added, nothing
-- is dropped or rewritten, and existing rows keep their current status.
-- Running it twice will error on the duplicate columns -- that is harmless and
-- means it was already applied.

ALTER TABLE appointments
    ADD COLUMN proposed_date DATE NULL AFTER time_slot,
    ADD COLUMN proposed_time_slot VARCHAR(50) NULL AFTER proposed_date,
    ADD COLUMN reschedule_reason VARCHAR(255) NULL AFTER proposed_time_slot,
    ADD COLUMN reschedule_requested_by INT NULL AFTER reschedule_reason,
    ADD COLUMN reschedule_requested_at DATETIME NULL AFTER reschedule_requested_by,
    ADD COLUMN reschedule_prev_status VARCHAR(20) NULL AFTER reschedule_requested_at;

-- Adds the awaiting-owner state. The five existing values keep their meaning
-- and their order, so stored rows are unaffected.
ALTER TABLE appointments
    MODIFY COLUMN status
    ENUM('pending','confirmed','completed','cancelled','rejected','reschedule_pending')
    COLLATE utf8mb4_unicode_ci DEFAULT 'pending';

-- Verify:
--   SHOW COLUMNS FROM appointments LIKE 'proposed%';
--   SHOW COLUMNS FROM appointments LIKE 'status';

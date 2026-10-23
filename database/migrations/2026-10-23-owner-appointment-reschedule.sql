-- Allow pet owners to request a new date/time for a confirmed appointment.
-- The current appointment stays active while staff reviews the request.
ALTER TABLE appointments
    MODIFY COLUMN status
    ENUM('pending','confirmed','completed','cancelled','rejected','reschedule_pending','owner_reschedule_pending','expired')
    DEFAULT 'pending';

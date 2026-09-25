-- BVetter – review time limits (2026-09-25)
--
-- api/includes/timed_rules.php applies these itself on first use
-- (ensureTimedRulesSchema). They are here to run by hand if the database user
-- has no ALTER privilege. Every column is NULL on existing rows, which is how
-- the code tells a request made before the time limits apart from one made
-- after: only the latter ever expires, auto-publishes or triggers a reminder.
--
-- Old pending appointments whose time has already passed are closed by
-- 2026-09-25-time-limits-apply.php -- read the dry run first.

-- Appointment requests expire after 1 working day, or at the slot's start.
ALTER TABLE appointments ADD COLUMN expires_at DATETIME NULL;

ALTER TABLE appointments
    MODIFY COLUMN status
    ENUM('pending','confirmed','completed','cancelled','rejected','reschedule_pending','expired')
    DEFAULT 'pending';

-- Account applications: admins reminded after 1 working day, Overdue after 2.
ALTER TABLE user_verification_documents
    ADD COLUMN review_remind_at DATETIME NULL,
    ADD COLUMN review_overdue_at DATETIME NULL,
    ADD COLUMN review_reminded_at DATETIME NULL;

-- Lost & Found owner reports go live on their own 2 hours after submission.
ALTER TABLE lost_found_reports
    ADD COLUMN auto_publish_at DATETIME NULL,
    ADD COLUMN auto_published_at DATETIME NULL;

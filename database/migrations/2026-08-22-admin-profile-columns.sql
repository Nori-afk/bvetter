-- BVetter - Admin profile page: real notification prefs + password age
-- 2026-08-22
--
-- The admin profile page shipped with five notification toggles
-- (New Account Registrations, System Alerts, Website Content Updates,
-- Weekly Summary, Security Alerts) that had no columns behind them and no
-- code that would ever have honoured them -- every notifyStaff() call in the
-- codebase fans out unconditionally. They are replaced by toggles for the
-- four staff notification streams that genuinely fire, and those are gated in
-- api/config/notifications.php.
--
-- Named with a staff_ prefix on purpose: lost_found_alerts already exists on
-- this table and means "the OWNER of this report wants updates about it",
-- which is a different thing from "staff want to hear about new reports".
--
-- Default 1 so existing admins keep receiving what they receive today; opting
-- out is an explicit action.
--
-- NOTE: api/users/profile.php setupProfileTables() applies these same changes
-- defensively at runtime, so deploying the PHP before running this file
-- cannot break the page. Running this is still preferred -- it keeps a fresh
-- install from database/bvetter.sql in step with production.

ALTER TABLE user_notification_preferences
    ADD COLUMN staff_appointment_alerts TINYINT(1) NOT NULL DEFAULT 1,
    ADD COLUMN staff_lost_found_alerts  TINYINT(1) NOT NULL DEFAULT 1,
    ADD COLUMN staff_ticket_alerts      TINYINT(1) NOT NULL DEFAULT 1,
    ADD COLUMN staff_csp_alerts         TINYINT(1) NOT NULL DEFAULT 1;

-- Backs the "Password - Last changed ..." line on the profile Security card.
-- Deliberately left NULL for existing rows rather than backfilled from
-- users.created_at: claiming a password was changed on the day the account was
-- created would be inventing history. The UI renders NULL as "Never changed".
ALTER TABLE users
    ADD COLUMN password_changed_at DATETIME NULL DEFAULT NULL;

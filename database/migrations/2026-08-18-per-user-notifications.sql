-- Per-user notifications: a notification row now belongs to one recipient
-- instead of being broadcast to a whole role.
--
-- WHY
-- ---
-- `notifications.is_read` was a single column on a row shared by everyone in
-- an `audience`. One admin marking a notification read marked it read for
-- every admin, and rows with audience='both' leaked read state across the
-- admin and vet dashboards. There was no way to express "Marky has read this
-- but Kizea has not", so read state could never be correct for a person.
--
-- Pet owners had no rows at all -- their notifications were synthesized in
-- the browser from appointments/claims/reports and their read state lived in
-- localStorage, so it was per-device and vanished when storage was cleared.
--
-- After this migration every row has exactly one `user_id`. An event that
-- concerns several people writes several rows (fan-out on write), which is
-- cheap at this scale and makes `is_read` finally mean what it says.
--
-- WHAT IT DOES TO EXISTING DATA
-- -----------------------------
-- Every existing row is copied once per active user in its audience, and all
-- copies are marked READ. History is preserved, but nobody logs in to a wall
-- of resurfaced beta-era notifications. The original broadcast rows are then
-- removed, since they no longer belong to anyone.
--
-- Owner history is NOT created here -- that is a separate, re-runnable script
-- (2026-08-18-backfill-owner-notifications.php) because it derives rows from
-- appointments/claims/reports rather than copying them.
--
-- BEFORE RUNNING
-- --------------
-- Take a verified backup. This deletes rows and later drops a column, so it
-- is not reversible in place.
--
-- Run database/migrations/2026-08-18-notifications-dryrun.php first -- it
-- reports exactly how many rows this will create and delete, and writes
-- nothing.
--
-- NOT ATOMIC. MySQL commits implicitly on every DDL statement, so wrapping
-- this in a transaction would only look safe -- an ALTER cannot be rolled
-- back by a ROLLBACK. If it fails partway, the restore path is the backup,
-- which is why the backup is a hard prerequisite rather than advice.
--
-- ============================================================
-- ORDER OF OPERATIONS -- read this before running anything
-- ============================================================
--
--   1. Run PART 1 below.
--   2. Deploy the application code.
--   3. Run PART 2 below.
--   4. Run the owner backfill script.
--
-- The split exists so no write can fail while the database and the code are
-- out of step. PART 1 only adds things; `audience` stays, and stays nullable,
-- so the currently-deployed code can still INSERT through notifyStaff()
-- during the deploy. That matters because notifyStaff() runs inside
-- appointment booking, ticket creation and lost/found submission -- if its
-- INSERT threw, those user-facing actions would fail, not just the bell.
--
-- Between step 1 and step 2 the staff feed reads empty (the broadcast rows
-- it used to read are gone). That is cosmetic and lasts only as long as the
-- deploy. Nothing errors.


-- ============================================================
-- PART 1 -- run BEFORE deploying the code
-- ============================================================

-- 1a. New shape, added alongside the old one. user_id is nullable for now:
--     the currently-deployed code does not set it, and PART 2 tightens it
--     once nothing is writing the old way any more.
ALTER TABLE notifications
    ADD COLUMN user_id INT NULL AFTER id,
    ADD COLUMN dismissed_at TIMESTAMP NULL DEFAULT NULL AFTER is_read,
    ADD KEY idx_user_created (user_id, created_at);

-- 1b. `audience` becomes nullable so the new code can INSERT without it
--     while the old code can still INSERT with it. Dropped in PART 2.
ALTER TABLE notifications
    MODIFY COLUMN audience ENUM('admin','vet','both') NULL DEFAULT 'both';

-- 1c. Fan out each broadcast row to every active user it was meant for.
--
--     Staged through a temporary table rather than INSERT ... SELECT on
--     `notifications` itself: reading and writing the same table in one
--     statement is fragile, and this way the source rows are still intact
--     if the result needs inspecting before 1d.
--
--     is_read is forced to 1. The old global flag described nobody in
--     particular, so carrying it over would resurface anything currently
--     unread as unread for every staff member simultaneously.
CREATE TEMPORARY TABLE notifications_fanout AS
SELECT
    users.id            AS user_id,
    notifications.type,
    notifications.title,
    notifications.message,
    notifications.reference_id,
    notifications.created_at
FROM notifications
INNER JOIN users ON users.account_status = 'active'
INNER JOIN roles ON roles.id = users.role_id
WHERE notifications.user_id IS NULL
  AND (
        (notifications.audience = 'admin' AND roles.name = 'admin')
     OR (notifications.audience = 'vet'   AND roles.name = 'veterinarian')
     OR (notifications.audience = 'both'  AND roles.name IN ('admin', 'veterinarian'))
      );

INSERT INTO notifications (user_id, type, title, message, reference_id, is_read, created_at)
SELECT user_id, type, title, message, reference_id, 1, created_at
FROM notifications_fanout;

DROP TEMPORARY TABLE notifications_fanout;

-- 1d. Drop the broadcast originals. They belong to no one now.
DELETE FROM notifications WHERE user_id IS NULL;

-- Verify PART 1:
--   SELECT COUNT(*) FROM notifications WHERE user_id IS NULL;   -- expect 0
--   SELECT user_id, COUNT(*) FROM notifications GROUP BY user_id;
--
-- >>> NOW DEPLOY THE CODE, THEN CONTINUE. <<<


-- ============================================================
-- PART 2 -- run AFTER the code is deployed
-- ============================================================

-- 2a. Anything the old code inserted during the deploy window landed with a
--     NULL user_id and an audience. Fan those out the same way, then clear
--     them, so no notification written mid-deploy is lost.
CREATE TEMPORARY TABLE notifications_fanout_late AS
SELECT
    users.id            AS user_id,
    notifications.type,
    notifications.title,
    notifications.message,
    notifications.reference_id,
    notifications.created_at
FROM notifications
INNER JOIN users ON users.account_status = 'active'
INNER JOIN roles ON roles.id = users.role_id
WHERE notifications.user_id IS NULL
  AND (
        (notifications.audience = 'admin' AND roles.name = 'admin')
     OR (notifications.audience = 'vet'   AND roles.name = 'veterinarian')
     OR (notifications.audience = 'both'  AND roles.name IN ('admin', 'veterinarian'))
      );

INSERT INTO notifications (user_id, type, title, message, reference_id, is_read, created_at)
SELECT user_id, type, title, message, reference_id, 0, created_at
FROM notifications_fanout_late;

DROP TEMPORARY TABLE notifications_fanout_late;

DELETE FROM notifications WHERE user_id IS NULL;

-- 2b. Lock in the new shape.
--
--     `audience` is dropped rather than kept as provenance. A column that no
--     longer decides anything is exactly how this bug started -- is_read
--     outlived its meaning and kept being trusted. `type` already carries the
--     category, and the recipient now carries the rest.
ALTER TABLE notifications
    DROP INDEX idx_audience_created,
    DROP COLUMN audience,
    MODIFY COLUMN user_id INT NOT NULL,
    ADD CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    ADD KEY idx_user_unread (user_id, is_read, dismissed_at);

-- Verify PART 2:
--   SHOW COLUMNS FROM notifications;
--   SELECT COUNT(*) FROM notifications WHERE user_id IS NULL;        -- expect 0
--   SELECT user_id, COUNT(*), SUM(is_read = 0) AS unread
--     FROM notifications GROUP BY user_id;
--
-- Then run:
--   php database/migrations/2026-08-18-backfill-owner-notifications.php --dry-run

-- BVetter -- barangay is captured, never guessed.
--
-- WHY
-- api/patient-records/patient_records.php was the only owner-creation path
-- that did not require a barangay. defaultBarangayId() returned the lowest id
-- in `barangays` -- id 3, Tiaong -- and stamped it on every owner the vet
-- portal created, whatever address was typed. visitSnapshot() then froze that
-- onto patient_visit_records.barangay_at_visit, which is what the Disease
-- Incidence Report, Disease Analytics and the per-barangay forecast read. One
-- barangay was inflated and every other one deflated, invisibly, because
-- Tiaong is a real Baliwag barangay and the wrong answer looked like an answer.
--
-- barangay_id was NOT NULL, which is *why* the code guessed: "unknown" was not
-- representable, so it invented a value instead. PART 1 makes it
-- representable. The application still hard-requires a barangay on every
-- create path -- nullability exists for cleanup and for the deliberate
-- "Outside Baliwag" case, not as a way for the form to skip the field.
--
-- ORDER
-- PART 1 is safe to run at any time, before or after the code deploy: the new
-- code hard-requires a barangay and therefore never writes NULL, so it runs
-- correctly against either version of the schema. PART 2 rewrites data and
-- must run AFTER the deploy.
--
-- Apply with the runner, not by hand:
--   php database/migrations/2026-08-19-apply.php --part=1
--   php database/migrations/2026-08-19-apply.php --part=2

-- =====================================================================
-- PART 1 -- schema. Safe before or after the code deploy.
-- =====================================================================

-- "We do not know this owner's barangay" becomes expressible. Without this the
-- only cleanup options for a wrongly-defaulted row are to keep the wrong
-- barangay or invent a different one.
ALTER TABLE owner_profiles MODIFY barangay_id INT NULL;

-- Distinguishes the two reasons barangay_id can be NULL. Without it, a case
-- from a neighbouring town and a case whose barangay was lost both collapse
-- into the same "Unspecified" bucket -- but for surveillance they are
-- opposites: one is legitimately not a Baliwag case, the other is a Baliwag
-- case with missing data.
ALTER TABLE owner_profiles
    ADD COLUMN is_outside_baliwag TINYINT(1) NOT NULL DEFAULT 0 AFTER barangay_id;

-- PART 2 -- run AFTER the code is deployed
-- =====================================================================
-- Data cleanup. Handled in PHP by the runner rather than as SQL here: matching
-- a free-text address against the barangay catalog cannot be done in SQL on
-- this database (barangays.name is utf8mb4_unicode_ci while
-- barangay_at_visit is utf8mb4_0900_ai_ci -- comparing them raises error 1267,
-- and naming a collation explicitly would not survive a MariaDB host).
--
-- The runner applies exactly the verdicts that
-- 2026-08-19-barangay-dryrun.php prints, so read that output first.

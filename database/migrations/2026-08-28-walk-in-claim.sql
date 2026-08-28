-- BVetter - Walk-in accounts: claim + link flow
-- 2026-08-28
--
-- Vets recording a patient for someone with no email address get a users row
-- carrying a synthetic 'owner_<sha1>@vbetter.local' address (findOrCreateOwner()
-- in api/patient-records/patient_records.php). Those are real people with real
-- clinical history who have never logged in and cannot: the password is
-- random_bytes(8), hashed and discarded, and the address bounces.
--
-- These two columns let such a person reach their own records without the
-- history forking into a second account.
--
-- NOTE: api/config/walk_in_accounts.php ensureWalkInSchema() applies both
-- ALTERs defensively at runtime, so deploying the PHP before running this file
-- cannot break registration or Account Management. Running this is still
-- preferred -- it keeps a fresh install from database/bvetter.sql in step with
-- production, and the backfill below is expressed once, here.

-- Replaces LIKE '%@vbetter.local' as the answer to "is this a walk-in?".
-- The email suffix was a formatting convention doing a fact's job: the vet
-- edit modal can overwrite the address at any time, and doing so silently
-- removed the row from the flow built to find it.
ALTER TABLE users
    ADD COLUMN is_walk_in TINYINT(1) NOT NULL DEFAULT 0 AFTER account_status;

UPDATE users SET is_walk_in = 1 WHERE email LIKE '%@vbetter.local';

-- Deliberately NOT backfilled by any looser rule. "Pet owner with no
-- verification document" looks like the obvious heuristic for walk-in rows a
-- vet has already given a real email to, but createUser() in
-- api/admin/account-management.php does not insert a document either, so that
-- rule silently flags every admin-created account as a walk-in. Rows in that
-- state are not reliably identifiable after the fact and need a human to
-- review them:
--
--   SELECT u.id, u.full_name, u.email
--   FROM users u
--   INNER JOIN roles r ON r.id = u.role_id
--   LEFT JOIN user_verification_documents d ON d.user_id = u.id
--   WHERE r.name = 'pet_owner' AND u.is_walk_in = 0 AND d.id IS NULL
--     AND u.last_login_at IS NULL
--     AND EXISTS (SELECT 1 FROM pets WHERE pets.owner_id = u.id);

-- Records which registration row was absorbed when an admin links a claim.
-- Lives on the document rather than in a separate merge log on purpose: the
-- admin's decision and the ID document that justified it are then the same
-- row, which is a far stronger answer to "how do you know you merged the right
-- person" than two rows joined by a timestamp. The document is moved onto the
-- surviving walk-in row during the link, so this survives the merge.
ALTER TABLE user_verification_documents
    ADD COLUMN merged_from_user_id INT NULL DEFAULT NULL AFTER reviewed_by_user_id;

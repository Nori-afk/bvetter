<?php
/**
 * BVetter – Walk-in accounts and the claim/link flow.
 *
 * A vet saving a patient record for someone who has no email address still
 * needs a users row to hang the pet and its visit history on, and users.email
 * is UNIQUE. findOrCreateOwner() in api/patient-records/patient_records.php
 * therefore mints a synthetic 'owner_<sha1>@vbetter.local' address. Those rows
 * are real people with real clinical history who have never logged in: the
 * password is bin2hex(random_bytes(8)), hashed and discarded, so nobody alive
 * knows it, and the placeholder address bounces.
 *
 * That left them unable to ever reach their own records. Registering afresh
 * produced a SECOND users row and split their history in two; Forgot Password
 * 404s on their real address and bounces on the placeholder; and there is no
 * admin action that edits an email.
 *
 * ── Why a column and not the email suffix ─────────────────────────────
 * "Is this a walk-in?" used to be answerable only by LIKE '%@vbetter.local'.
 * That is a formatting convention standing in for a fact, and the vet edit
 * modal (EMAIL ADDRESS, marked optional) can overwrite it at any time — at
 * which point the row silently stops being findable by the very flow built to
 * find it. users.is_walk_in records the fact directly, so a vet filling in an
 * email no longer removes the row from the claim flow.
 *
 * ── Why matching may be generous ──────────────────────────────────────
 * findWalkInCandidates() only ever SUGGESTS. The decision is made by an admin
 * in the verification modal with the registrant's uploaded ID document open in
 * front of them, so recall matters far more than precision here: a false
 * positive costs one glance, a miss is invisible and permanent. Matching is
 * deliberately looser than exact name+phone, which this database already
 * proves is too strict — 'Kizea igaya' and 'Kizea Bien Igaya' are one person
 * under two spellings and two phone numbers.
 *
 * Nothing in this file merges anything on its own. See linkWalkInAccount() in
 * api/admin/account-management.php for the operation itself.
 */

/**
 * Adds the two columns this flow needs, if they are not there yet.
 *
 * Applied defensively at runtime for the same reason setupProfileTables() is
 * (see database/migrations/2026-08-22-admin-profile-columns.sql): deploying
 * the PHP before running the .sql must not be able to break registration or
 * Account Management. Running 2026-08-28-walk-in-claim.sql is still preferred
 * — it also performs the backfill, which this cannot safely repeat.
 */
function ensureWalkInSchema(PDO $pdo): void
{
    $flag = $pdo->query("SHOW COLUMNS FROM users LIKE 'is_walk_in'")->fetch();
    if (!$flag) {
        $pdo->exec("ALTER TABLE users ADD COLUMN is_walk_in TINYINT(1) NOT NULL DEFAULT 0 AFTER account_status");
        // Backfill from the old convention. Safe to run here because it is
        // scoped to the suffix no self-registration can produce, and it only
        // ever runs on the request that creates the column.
        $pdo->exec("UPDATE users SET is_walk_in = 1 WHERE email LIKE '%@vbetter.local'");
    }

    $merged = $pdo->query("SHOW COLUMNS FROM user_verification_documents LIKE 'merged_from_user_id'")->fetch();
    if (!$merged) {
        $pdo->exec("ALTER TABLE user_verification_documents ADD COLUMN merged_from_user_id INT NULL DEFAULT NULL AFTER reviewed_by_user_id");
    }
}

/**
 * Last ten digits of a phone number, or '' when there aren't ten.
 *
 * The two sides of this comparison are validated completely differently.
 * api/auth/register.php:69 enforces /^(?:\+63|63|0)9\d{9}$/, while the vet
 * patient-record form enforces nothing at all — the field is not even marked
 * required — so walk-in rows carry whatever was typed at the counter. Reducing
 * both to the last ten digits makes '09171234567', '+639171234567' and
 * '639171234567' compare equal without pretending the vet-side data is clean.
 */
function walkInNormalizePhone($phone): string
{
    $digits = preg_replace('/\D+/', '', (string) $phone);
    return strlen($digits) >= 10 ? substr($digits, -10) : '';
}

/**
 * Lowercased word tokens of a name, punctuation and duplicates removed.
 *
 * Token sets rather than whole strings, so 'Kizea igaya' and
 * 'Kizea Bien Igaya' still share two tokens. Tokens of one character are
 * dropped: a middle initial matching is not evidence of anything.
 */
function walkInNameTokens($name): array
{
    $clean = preg_replace('/[^\p{L}\p{N}\s]+/u', ' ', (string) $name);
    $clean = mb_strtolower(trim(preg_replace('/\s+/', ' ', $clean)));
    if ($clean === '') {
        return [];
    }

    $tokens = array_filter(explode(' ', $clean), static function ($t) {
        return mb_strlen($t) > 1;
    });

    return array_values(array_unique($tokens));
}

/**
 * Ranked walk-in rows that might be the same person as the given registrant.
 *
 * Scoring, highest first:
 *   100  normalized phone is identical
 *    60  two or more shared name tokens
 *    30  exactly one shared name token AND a shared surname SOUNDEX
 *    20  surname SOUNDEX matches alone
 * Signals add, so a phone match plus a name match ranks above either alone.
 * Rows scoring 0 are dropped — those are not candidates, just other people.
 *
 * SOUNDEX is computed in PHP rather than SQL so the whole rule lives in one
 * readable place; the candidate pool is every is_walk_in row in the database
 * (44 in production at the time of writing), so there is nothing to optimise.
 */
function findWalkInCandidates(PDO $pdo, $fullName, $phone, int $excludeUserId = 0, int $limit = 5): array
{
    ensureWalkInSchema($pdo);

    $tokens = walkInNameTokens($fullName);
    $normPhone = walkInNormalizePhone($phone);

    if (!$tokens && $normPhone === '') {
        return [];
    }

    $stmt = $pdo->prepare('
        SELECT
            users.id,
            users.full_name,
            users.email,
            users.phone_number,
            users.created_at,
            barangays.name AS barangay_name
        FROM users
        LEFT JOIN owner_profiles ON owner_profiles.user_id = users.id
        LEFT JOIN barangays ON barangays.id = owner_profiles.barangay_id
        WHERE users.is_walk_in = 1
          AND users.id <> :exclude_id
    ');
    $stmt->execute([':exclude_id' => $excludeUserId]);
    $rows = $stmt->fetchAll();

    $surname = $tokens ? end($tokens) : '';
    $surnameCode = $surname !== '' ? soundex($surname) : '';

    $scored = [];
    foreach ($rows as $row) {
        $rowTokens = walkInNameTokens($row['full_name']);
        $shared = array_values(array_intersect($tokens, $rowTokens));
        $rowPhone = walkInNormalizePhone($row['phone_number']);
        $rowSurname = $rowTokens ? end($rowTokens) : '';

        $score = 0;
        $matchedOn = [];

        if ($normPhone !== '' && $normPhone === $rowPhone) {
            $score += 100;
            $matchedOn[] = 'phone';
        }

        $soundsAlike = $surnameCode !== '' && $rowSurname !== '' && soundex($rowSurname) === $surnameCode;

        if (count($shared) >= 2) {
            $score += 60;
            $matchedOn[] = count($shared) . ' name parts (' . implode(', ', $shared) . ')';
        } elseif (count($shared) === 1 && $soundsAlike) {
            $score += 30;
            $matchedOn[] = 'name part (' . $shared[0] . ') + similar surname';
        } elseif ($soundsAlike) {
            $score += 20;
            $matchedOn[] = 'similar surname';
        }

        if ($score === 0) {
            continue;
        }

        $row['score'] = $score;
        $row['matched_on'] = implode(', ', $matchedOn);
        $scored[] = $row;
    }

    if (!$scored) {
        return [];
    }

    usort($scored, static function ($a, $b) {
        return $b['score'] <=> $a['score'];
    });
    $scored = array_slice($scored, 0, $limit);

    return array_map(static function ($row) use ($pdo) {
        $consequence = walkInConsequence($pdo, (int) $row['id']);

        return [
            'id' => (string) $row['id'],
            'name' => $row['full_name'],
            'email' => $row['email'],
            'phone' => $row['phone_number'],
            'barangay' => $row['barangay_name'],
            'created' => $row['created_at'],
            'score' => (int) $row['score'],
            'matchedOn' => $row['matched_on'],
            'pets' => $consequence['pets'],
            'visitCount' => $consequence['visitCount'],
            'lastVisit' => $consequence['lastVisit'],
        ];
    }, $scored);
}

/**
 * What linking to this walk-in row would actually hand the registrant.
 *
 * Shown to the admin before they commit, because a mis-link attaches a
 * stranger's pet medical history to the wrong person and the audit trail then
 * records it as deliberate. Catching it at the confirm step is the whole
 * defence — there is no unlink.
 *
 * patient_visit_records is created lazily by setupPatientTables(), so its
 * absence is normal on a fresh install and must not be an error here.
 */
function walkInConsequence(PDO $pdo, int $userId): array
{
    $pets = [];
    $stmt = $pdo->prepare('SELECT pet_name FROM pets WHERE owner_id = :id ORDER BY pet_name');
    $stmt->execute([':id' => $userId]);
    foreach ($stmt->fetchAll() as $row) {
        $pets[] = $row['pet_name'];
    }

    $visitCount = 0;
    $lastVisit = null;

    if ($pdo->query("SHOW TABLES LIKE 'patient_visit_records'")->fetch()) {
        $visits = $pdo->prepare('
            SELECT COUNT(*) AS c, MAX(visit_date) AS last_visit
            FROM patient_visit_records
            WHERE owner_id = :id
        ');
        $visits->execute([':id' => $userId]);
        $row = $visits->fetch();
        $visitCount = (int) ($row['c'] ?? 0);
        $lastVisit = $row['last_visit'] ?? null;
    }

    return [
        'pets' => $pets,
        'visitCount' => $visitCount,
        'lastVisit' => $lastVisit,
    ];
}

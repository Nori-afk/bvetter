<?php
/**
 * BVetter - Selenium test-account seeder  (tests/selenium/support/seed.php)
 *
 * Creates (or refreshes) three dedicated accounts the Selenium suite logs in
 * as. Run it once before the first test run:
 *
 *     php tests/selenium/support/seed.php
 *     php tests/selenium/support/seed.php --remove     (delete them again)
 *
 * WHY dedicated accounts rather than real ones:
 *
 *   1. login_security.php blocks an account after 3 wrong passwords. The
 *      security suite deliberately submits wrong credentials, and a typo in a
 *      config file should never be able to lock a real vet or admin out.
 *   2. No real password ever has to be written into a config file or a repo.
 *   3. The functional suite creates appointments, reports and profile edits.
 *      Those belong to an obviously-fake owner, not to a beta tester.
 *
 * The chosen password is validated against the app's own live password policy
 * (api/config/security_settings.php) before anything is written, so this can
 * never seed an account that the policy would then force to change on login.
 *
 * CLI-only, local-only. Do not deploy this file to the server.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../../../api/config/connection.php';
require_once __DIR__ . '/../../../api/config/security_settings.php';
require_once __DIR__ . '/../../../api/config/two_factor.php';

const SEL_PASSWORD = 'Qz7#mVr9Tb2!';

$ACCOUNTS = [
    [
        'email' => 'selenium.owner@bvetter.test',
        'name'  => 'Automation Petowner',
        'role'  => 'pet_owner',
        'phone' => '09170000001',
    ],
    [
        'email' => 'selenium.vet@bvetter.test',
        'name'  => 'Automation Clinician',
        'role'  => 'veterinarian',
        'phone' => '09170000002',
    ],
    [
        'email' => 'selenium.admin@bvetter.test',
        'name'  => 'Automation Operator',
        'role'  => 'admin',
        'phone' => '09170000003',
    ],
];

$remove = in_array('--remove', $argv, true);

if ($remove) {
    foreach ($ACCOUNTS as $account) {
        $stmt = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
        $stmt->execute([':email' => $account['email']]);
        $id = $stmt->fetchColumn();
        if (!$id) {
            echo "  -  {$account['email']} (not present)\n";
            continue;
        }
        $pdo->prepare('DELETE FROM owner_profiles WHERE user_id = :id')->execute([':id' => $id]);
        $pdo->prepare('DELETE FROM veterinarian_profiles WHERE user_id = :id')->execute([':id' => $id]);
        $pdo->prepare('DELETE FROM user_sessions WHERE user_id = :id')->execute([':id' => $id]);
        $pdo->prepare('DELETE FROM login_otp_codes WHERE user_id = :id')->execute([':id' => $id]);
        $pdo->prepare('DELETE FROM users WHERE id = :id')->execute([':id' => $id]);
        echo "  x  removed {$account['email']}\n";
    }
    echo "Done.\n";
    exit;
}

/* Refuse to seed a password the app itself would reject - otherwise every
   login would be bounced to the forced-password-change page instead of the
   dashboard, and every test would fail for a reason that has nothing to do
   with the feature under test. */
foreach ($ACCOUNTS as $account) {
    $policyError = passwordPolicyError($pdo, SEL_PASSWORD, [
        'name'  => $account['name'],
        'email' => $account['email'],
    ]);
    if ($policyError !== null) {
        fwrite(STDERR, "SEL_PASSWORD fails the current policy for {$account['email']}: {$policyError}\n");
        exit(1);
    }
}

ensureUserTwoFactorColumn($pdo);

$hash = password_hash(SEL_PASSWORD, PASSWORD_DEFAULT);

$barangayId = $pdo->query('SELECT id FROM barangays ORDER BY id LIMIT 1')->fetchColumn() ?: null;

foreach ($ACCOUNTS as $account) {
    $roleId = $pdo->prepare('SELECT id FROM roles WHERE name = :name LIMIT 1');
    $roleId->execute([':name' => $account['role']]);
    $roleId = $roleId->fetchColumn();
    if (!$roleId) {
        fwrite(STDERR, "Role {$account['role']} is missing from the roles table.\n");
        exit(1);
    }

    $existing = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
    $existing->execute([':email' => $account['email']]);
    $userId = $existing->fetchColumn();

    if ($userId) {
        /* Refresh rather than recreate: keeps any appointments/reports these
           accounts already own, and un-blocks the account if an earlier
           security run tripped the 3-strike lockout. */
        $pdo->prepare(
            "UPDATE users
             SET password_hash = :hash, full_name = :name, phone_number = :phone,
                 role_id = :role_id, account_status = 'active', blocked_reason = NULL,
                 failed_login_attempts = 0, two_factor_enabled = 0,
                 email_verified_at = NOW()
             WHERE id = :id"
        )->execute([
            ':hash'    => $hash,
            ':name'    => $account['name'],
            ':phone'   => $account['phone'],
            ':role_id' => $roleId,
            ':id'      => $userId,
        ]);
        $verb = 'refreshed';
    } else {
        $pdo->prepare(
            "INSERT INTO users (role_id, full_name, email, password_hash, phone_number,
                                account_status, two_factor_enabled, email_verified_at)
             VALUES (:role_id, :name, :email, :hash, :phone, 'active', 0, NOW())"
        )->execute([
            ':role_id' => $roleId,
            ':name'    => $account['name'],
            ':email'   => $account['email'],
            ':hash'    => $hash,
            ':phone'   => $account['phone'],
        ]);
        $userId = (int) $pdo->lastInsertId();
        $verb = 'created';
    }

    if ($account['role'] === 'pet_owner') {
        /* verification_status must be 'approved' or login_flow.php rejects the
           login with "still pending residence verification". */
        $has = $pdo->prepare('SELECT id FROM owner_profiles WHERE user_id = :id LIMIT 1');
        $has->execute([':id' => $userId]);
        if ($has->fetchColumn()) {
            $pdo->prepare(
                "UPDATE owner_profiles
                 SET verification_status = 'approved', verified_at = NOW(),
                     barangay_id = :barangay
                 WHERE user_id = :id"
            )->execute([':barangay' => $barangayId, ':id' => $userId]);
        } else {
            $pdo->prepare(
                "INSERT INTO owner_profiles (user_id, barangay_id, complete_address,
                                             verification_status, verified_at)
                 VALUES (:id, :barangay, :address, 'approved', NOW())"
            )->execute([
                ':id'       => $userId,
                ':barangay' => $barangayId,
                ':address'  => '1 Automation St., Baliwag, Bulacan',
            ]);
        }
    }

    if ($account['role'] === 'veterinarian') {
        $has = $pdo->prepare('SELECT id FROM veterinarian_profiles WHERE user_id = :id LIMIT 1');
        $has->execute([':id' => $userId]);
        if (!$has->fetchColumn()) {
            $pdo->prepare(
                "INSERT INTO veterinarian_profiles (user_id, position_title, specialization,
                                                    education, clinic_location, employment_status, is_bookable)
                 VALUES (:id, 'Veterinarian', 'General Practice',
                         'DVM', 'Baliwag City Veterinary Office', 'active', 1)"
            )->execute([':id' => $userId]);
        }
    }

    printf("  ok %-30s %-14s id=%-4d (%s)\n", $account['email'], $account['role'], $userId, $verb);
}

echo "\nPassword for all three: " . SEL_PASSWORD . "\n";
echo "Remove them again with: php tests/selenium/support/seed.php --remove\n";

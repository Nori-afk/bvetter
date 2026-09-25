<?php
/**
 * What a new registration may do with an email address.
 *
 * Decided in one place so the three points that ask -- the live check when
 * the applicant leaves the Email field, the step that emails the
 * verification code, and the final submit in register.php -- always agree.
 * Before this, only the final submit checked, so someone whose address was
 * taken found out after confirming a code and uploading their ID.
 *
 * States:
 *   available  - nobody has it
 *   registered - an account (any role, active or blocked) holds it
 *   pending    - a pet owner application with it is waiting for review
 *   rejected   - a pet owner application with it was not approved; the
 *                applicant may apply again and register.php reuses that row
 *   walk_in    - a vet entered this person at the counter; they claim the
 *                record through Forgot Password instead of registering
 */

require_once __DIR__ . '/walk_in_accounts.php';

function registrationEmailState(PDO $pdo, string $email): array
{
    ensureWalkInSchema($pdo);

    $stmt = $pdo->prepare('
        SELECT users.id, users.is_walk_in, roles.name AS role_name,
               owner_profiles.verification_status
        FROM users
        INNER JOIN roles ON roles.id = users.role_id
        LEFT JOIN owner_profiles ON owner_profiles.user_id = users.id
        WHERE users.email = :email
        LIMIT 1
    ');
    $stmt->execute([':email' => $email]);
    $row = $stmt->fetch();

    if (!$row) {
        $state = 'available';
    } elseif ((int) $row['is_walk_in'] === 1) {
        $state = 'walk_in';
    } elseif ($row['role_name'] === 'pet_owner' && $row['verification_status'] === 'pending') {
        $state = 'pending';
    } elseif ($row['role_name'] === 'pet_owner' && $row['verification_status'] === 'rejected') {
        $state = 'rejected';
    } else {
        $state = 'registered';
    }

    return [
        'state'   => $state,
        'userId'  => $row ? (int) $row['id'] : 0,
        // Whether this form may carry on with the address.
        'allowed' => in_array($state, ['available', 'rejected'], true),
        'message' => registrationEmailMessage($state),
    ];
}

function registrationEmailMessage(string $state): string
{
    switch ($state) {
        case 'registered':
            return 'This email is already registered. Log in, or use Forgot Password if you can\'t remember your password.';
        case 'pending':
            return 'An application with this email is already waiting for review. You will get an email once it is decided.';
        case 'rejected':
            return 'Your previous application with this email was not approved. You can submit a new one below.';
        case 'walk_in':
            return 'The clinic already has a record under this email address from an earlier visit. You have not set a password yet, so use "Forgot Password" on the login page to create one. Your pet records will already be there.';
        default:
            return '';
    }
}

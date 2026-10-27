<?php

require_once __DIR__ . '/../config/input_validation.php';
require_once __DIR__ . '/animal_visit_schema.php';

/** Accept the legacy single-pet form as well as an explicit list of pets. */
function bookingPetEntries(array $data, bool $ageRequired = false): array
{
    $entries = array_key_exists('pets', $data) ? $data['pets'] : [$data];
    if (!is_array($entries) || !$entries || array_keys($entries) !== range(0, count($entries) - 1)) {
        throw new InvalidArgumentException('Please add at least one pet.');
    }

    $seen = [];
    foreach ($entries as $index => $entry) {
        $label = 'Pet ' . ($index + 1);
        if (!is_array($entry)) throw new InvalidArgumentException("{$label}: Invalid pet details.");
        $id = $entry['pet_id'] ?? null;
        if ($id !== null && $id !== '') {
            if (filter_var($id, FILTER_VALIDATE_INT) === false || (int) $id <= 0) {
                throw new InvalidArgumentException("{$label}: Invalid pet ID.");
            }
            $key = 'id:' . (int) $id;
        } else {
            $fields = [
                'name' => $entry['pet_name'] ?? '',
                'type' => $entry['species'] ?? $entry['pet_type'] ?? '',
                'breed' => $entry['breed'] ?? $entry['pet_breed'] ?? '',
                'sex' => $entry['sex'] ?? $entry['pet_sex'] ?? '',
                'age' => $entry['age'] ?? $entry['pet_age'] ?? '',
                'vaccination date' => $entry['last_vaccination_date'] ?? $entry['pet_vaccination_date'] ?? '',
            ];
            foreach ($fields as $field => $value) {
                if (!is_scalar($value) && $value !== null) {
                    throw new InvalidArgumentException("{$label}: Invalid {$field}.");
                }
                $fields[$field] = trim((string) $value);
            }
            $group = ($entry['record_kind'] ?? 'individual') === 'group';
            foreach (['name', 'type'] as $field) {
                if ($fields[$field] === '') throw new InvalidArgumentException("{$label}: Please provide the pet's {$field}.");
            }
            $error = firstIdentityFieldError([
                [$fields['name'], 'Pet name', 120, 0],
                [$fields['type'], 'Pet type', 60, 0],
                [$fields['breed'], 'Breed', 80, 0],
            ]);
            if ($error !== null) throw new InvalidArgumentException("{$label}: {$error}");
            if ($fields['sex'] !== '' && !in_array(strtolower($fields['sex']), $group ? ['male', 'female', 'mixed', 'unknown'] : ['male', 'female', 'unknown'], true)) {
                throw new InvalidArgumentException("{$label}: Please select a valid sex.");
            }
            if ($ageRequired && $fields['age'] === '') {
                throw new InvalidArgumentException("{$label}: Age is required for Castration & Spay.");
            }
            if ($fields['age'] !== '' && (strlen($fields['age']) > 50 || !preg_match('/^\d+(?:\s+(?:years?|months?))?$/i', $fields['age']))) {
                throw new InvalidArgumentException("{$label}: Age must be a whole number that is zero or greater.");
            }
            $vaccinationDate = $fields['vaccination date'];
            if ($vaccinationDate !== '') {
                $date = DateTimeImmutable::createFromFormat('!Y-m-d', $vaccinationDate);
                if (!$date || $date->format('Y-m-d') !== $vaccinationDate) {
                    throw new InvalidArgumentException("{$label}: Please enter a valid vaccination date.");
                }
            }
            $key = 'name:' . mb_strtolower($fields['name'], 'UTF-8');
        }
        if (isset($seen[$key])) throw new InvalidArgumentException("{$label}: This pet is already included. Add each pet only once.");
        $seen[$key] = true;
    }
    return $entries;
}

/** Resolve all pets inside the caller's transaction, enforcing ownership. */
function resolveBookingPetIds(PDO $pdo, int $ownerId, array $entries): array
{
    $ids = [];
    $check = $pdo->prepare('SELECT id, species, animal_category, record_kind, estimated_count FROM pets WHERE id = :id AND owner_id = :owner_id');
    $updateAnimal = $pdo->prepare('UPDATE pets SET animal_category = :category, record_kind = :kind, estimated_count = :count WHERE id = :id AND owner_id = :owner');
    foreach ($entries as $index => $entry) {
        $stored = [];
        $id = (int) ($entry['pet_id'] ?? 0);
        if ($id > 0) {
            $check->execute([':id' => $id, ':owner_id' => $ownerId]);
            $stored = $check->fetch(PDO::FETCH_ASSOC);
            if (!$stored) {
                throw new InvalidArgumentException('Pet ' . ($index + 1) . ': This pet does not belong to the selected owner.');
            }
            $submittedSpecies = trim((string) ($entry['species'] ?? $entry['pet_type'] ?? ''));
            if ($submittedSpecies !== '' && animalGroupFromSpecies($submittedSpecies) !== animalGroupFromSpecies((string) $stored['species'])) {
                throw new InvalidArgumentException('Pet ' . ($index + 1) . ': Species does not match the animal record.');
            }
            if (isset($entry['record_kind']) && $entry['record_kind'] !== $stored['record_kind']) {
                throw new InvalidArgumentException('Pet ' . ($index + 1) . ': Record type does not match the animal record.');
            }
        } else {
            $id = findOrCreatePet($pdo, $ownerId, $entry);
        }
        if (in_array($id, $ids, true)) {
            throw new InvalidArgumentException('This pet is already included. Add each pet only once.');
        }
        $species = trim((string) ($entry['species'] ?? $entry['pet_type'] ?? $stored['species'] ?? ''));
        $category = animalCategory($species, trim((string) ($entry['animal_category'] ?? $stored['animal_category'] ?? '')));
        $kind = trim((string) ($entry['record_kind'] ?? $stored['record_kind'] ?? 'individual'));
        $count = filter_var($entry['estimated_count'] ?? $stored['estimated_count'] ?? 1, FILTER_VALIDATE_INT);
        if (!$category || !in_array($kind, ['individual', 'group'], true) || $count === false || $count < 1 || $count > 100000 || ($kind === 'individual' && $count !== 1)) {
            throw new InvalidArgumentException('Pet ' . ($index + 1) . ': Select a supported animal, record type, and valid estimated count.');
        }
        $updateAnimal->execute([':category' => $category, ':kind' => $kind, ':count' => $count, ':id' => $id, ':owner' => $ownerId]);
        $ids[] = $id;
    }
    return $ids;
}

/** Run before any transaction: MySQL DDL implicitly commits. */
function ensureAppointmentPetsSchema(PDO $pdo): void
{
    static $ready = false;
    if ($ready) return;
    $pdo->exec('CREATE TABLE IF NOT EXISTS appointment_pets (
        appointment_id INT NOT NULL,
        pet_id INT NOT NULL,
        position INT NOT NULL DEFAULT 0,
        PRIMARY KEY (appointment_id, pet_id),
        INDEX idx_appointment_pets_pet (pet_id),
        CONSTRAINT fk_appointment_pets_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
        CONSTRAINT fk_appointment_pets_pet FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    $ready = true;
}

/** Older appointments have no link rows and continue to use their pet_id. */
function appointmentPetsById(PDO $pdo, array $appointmentIds): array
{
    if (!$appointmentIds) return [];
    ensureAppointmentPetsSchema($pdo);
    $placeholders = implode(',', array_fill(0, count($appointmentIds), '?'));
    $stmt = $pdo->prepare("SELECT a.id AS appointment_id, p.id, p.pet_name AS name,
            p.species, p.breed, p.sex, p.age, p.last_vaccination_date,
            p.animal_category, p.record_kind, p.estimated_count
        FROM appointments a
        LEFT JOIN appointment_pets ap ON ap.appointment_id = a.id
        INNER JOIN pets p ON p.id = COALESCE(ap.pet_id, a.pet_id) AND p.owner_id = a.owner_id
        WHERE a.id IN ({$placeholders})
        ORDER BY a.id, ap.position, p.id");
    $stmt->execute(array_values($appointmentIds));
    $result = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $appointmentId = (int) $row['appointment_id'];
        unset($row['appointment_id']);
        $row['id'] = (int) $row['id'];
        $result[$appointmentId][] = $row;
    }
    return $result;
}

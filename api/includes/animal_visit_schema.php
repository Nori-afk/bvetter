<?php

/** The uploaded consultation dataset's supported animal groups. */
function bookingAnimalCatalog(): array
{
    return [
        'Dog' => ['group' => 'Dogs', 'category' => 'companion'],
        'Cat' => ['group' => 'Cats', 'category' => 'companion'],
        'Chicken' => ['group' => 'Chickens', 'category' => 'livestock'],
        'Carabao / Water Buffalo' => ['group' => 'Carabaos / Water Buffalo', 'category' => 'livestock'],
        'Goat / Sheep' => ['group' => 'Goats / Sheep', 'category' => 'livestock'],
        'Pig' => ['group' => 'Pigs', 'category' => 'livestock'],
        'Rabbit' => ['group' => 'Rabbits', 'category' => 'either'],
        'Other livestock' => ['group' => 'Other livestock', 'category' => 'livestock'],
    ];
}

function animalCategory(string $species, string $requested = ''): string
{
    $catalog = bookingAnimalCatalog();
    $legacyAliases = ['Canine' => 'Dog', 'Feline' => 'Cat', 'Avian' => 'Chicken'];
    $species = $legacyAliases[$species] ?? $species;
    if (!isset($catalog[$species])) return '';
    if ($catalog[$species]['category'] === 'either') {
        return in_array($requested, ['companion', 'livestock'], true) ? $requested : '';
    }
    return $catalog[$species]['category'];
}

/** Map a saved booking species to the chatbot rule's species key. */
function chatbotSpeciesForBookedAnimal(string $species): string
{
    $aliases = ['Canine' => 'Dog', 'Feline' => 'Cat', 'Avian' => 'Chicken', 'Other livestock' => 'Other'];
    $species = trim($species);
    if ($species === '') return '';
    return $aliases[$species] ?? (isset(bookingAnimalCatalog()[$species]) ? $species : 'Other');
}

function ensureAnimalVisitSchema(PDO $pdo): void
{
    static $ready = false;
    if ($ready) return;
    $columns = [
        'pets' => [
            'animal_category' => "VARCHAR(20) NULL",
            'record_kind' => "VARCHAR(20) NOT NULL DEFAULT 'individual'",
            'estimated_count' => 'INT NOT NULL DEFAULT 1',
        ],
        'appointments' => [
            'visit_mode' => "VARCHAR(20) NOT NULL DEFAULT 'clinic'",
            'field_address' => 'VARCHAR(255) NULL',
            'field_concern' => 'TEXT NULL',
            'field_schedule_scope' => "VARCHAR(20) NOT NULL DEFAULT 'slot'",
            'owner_assessment_json' => 'JSON NULL',
        ],
        'patient_visit_records' => [
            'affected_count' => 'INT NOT NULL DEFAULT 1',
            'case_count_basis' => "VARCHAR(20) NOT NULL DEFAULT 'individual'",
        ],
    ];
    foreach ($columns as $table => $definitions) {
        if (!$pdo->query("SHOW TABLES LIKE " . $pdo->quote($table))->fetchColumn()) continue;
        foreach ($definitions as $name => $definition) {
            $check = $pdo->query("SHOW COLUMNS FROM {$table} LIKE " . $pdo->quote($name))->fetch();
            if (!$check) $pdo->exec("ALTER TABLE {$table} ADD COLUMN {$name} {$definition}");
        }
    }
    $sexColumn = $pdo->query("SHOW COLUMNS FROM pets LIKE 'sex'")->fetch();
    if ($sexColumn && stripos((string) $sexColumn['Type'], "'mixed'") === false) {
        $pdo->exec("ALTER TABLE pets MODIFY COLUMN sex ENUM('male','female','mixed','unknown') NOT NULL");
    }
    $ready = true;
}

function animalGroupFromSpecies(string $species): ?string
{
    $aliases = ['Canine' => 'Dog', 'Feline' => 'Cat', 'Avian' => 'Chicken'];
    return bookingAnimalCatalog()[$aliases[$species] ?? $species]['group'] ?? null;
}

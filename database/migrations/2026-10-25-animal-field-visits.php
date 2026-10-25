<?php
/** Idempotent animal, field visit, and booking guidance migration. */
if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Run this migration from the command line.\n");
    exit(1);
}

require_once __DIR__ . '/../../api/config/connection.php';
require_once __DIR__ . '/../../api/includes/animal_visit_schema.php';

ensureAnimalVisitSchema($pdo);
foreach ([
    'chatbot_consultation_rules' => ['clinic_approved' => 'TINYINT(1) NOT NULL DEFAULT 0'],
    'chatbot_consultation_logs' => ['booking_context' => 'TINYINT(1) NOT NULL DEFAULT 0'],
] as $table => $columns) {
    if (!$pdo->query("SHOW TABLES LIKE " . $pdo->quote($table))->fetchColumn()) continue;
    foreach ($columns as $column => $definition) {
        if (!$pdo->query("SHOW COLUMNS FROM {$table} LIKE " . $pdo->quote($column))->fetch()) {
            $pdo->exec("ALTER TABLE {$table} ADD COLUMN {$column} {$definition}");
        }
    }
}

echo "Animal and field visit schema is ready.\n";

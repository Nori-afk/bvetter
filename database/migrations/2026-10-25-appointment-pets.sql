-- Also applied automatically by ensureAppointmentPetsSchema().
-- Existing appointments fall back to appointments.pet_id; no backfill is needed.
CREATE TABLE IF NOT EXISTS appointment_pets (
    appointment_id INT NOT NULL,
    pet_id INT NOT NULL,
    position INT NOT NULL DEFAULT 0,
    PRIMARY KEY (appointment_id, pet_id),
    INDEX idx_appointment_pets_pet (pet_id),
    CONSTRAINT fk_appointment_pets_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    CONSTRAINT fk_appointment_pets_pet FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

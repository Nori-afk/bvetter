-- Keep unresolved Lost & Found reports public for three calendar months.
-- Reports with an open claim or handoff remain active until that workflow closes.
-- Expired rows remain in owner and staff history; this does not delete records.
ALTER TABLE lost_found_reports
    MODIFY status ENUM('pending','active','resolved','rejected','expired') NOT NULL DEFAULT 'pending',
    ADD COLUMN expires_at DATETIME NULL AFTER resolved_at,
    ADD INDEX idx_lfr_status_expiry (status, expires_at);

UPDATE lost_found_reports
SET expires_at = DATE_ADD(COALESCE(created_at, NOW()), INTERVAL 3 MONTH)
WHERE expires_at IS NULL;

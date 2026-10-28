ALTER TABLE workspace ADD COLUMN last_seen_at TEXT;

UPDATE workspace SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now');

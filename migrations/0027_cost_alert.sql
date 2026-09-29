-- 0027_cost_alert.sql — #4432: operator alert sink for the nightly cost guard,
-- one row per (day, line) over the per-brand threshold. Expand-only: new table,
-- no ALTER, no DROP, never customer-facing.
CREATE TABLE cost_alert (id TEXT PRIMARY KEY NOT NULL, day TEXT NOT NULL, line TEXT NOT NULL, measured_per_brand REAL NOT NULL, expected_per_brand REAL NOT NULL, on_brands INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE (day, line));

-- 0509#7068: per-watch Hacker News cursor (unix seconds, newest created_at_i already swept) and the instant the watch was created. Expand-only; existing watches keep a NULL created_at and so are never filtered by it.
ALTER TABLE watch ADD COLUMN hn_cursor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE watch ADD COLUMN created_at TEXT;

-- 0062_page_last_failure.sql: a page that could not be read keeps the reason
-- and the time of its latest failed read, and both are cleared by the next
-- successful read. Before this a failed fetch wrote no row, so a rival whose
-- site blocks us was indistinguishable from a rival with nothing new
-- (docs/incidents/2026-10-14-blocked-rivals-invisible.md). Two additive ALTERs,
-- no DROP, nothing backfilled; the writer ships in the same change.
ALTER TABLE page ADD COLUMN last_failure_reason TEXT;
ALTER TABLE page ADD COLUMN last_failure_at TEXT;

-- 0509#7191: the site sweep recorded only counts, so a night with ~15% failing
-- pages said "40 pages, 6 failed" and never said which pages or why. The step
-- label and the error text were in the log line and nowhere else, so nobody
-- could tell a browser timeout from a 403 from a DNS failure without the log.
-- This column carries that text on the run row itself.
--
-- Expand-only phase 1 (nullable add). Existing rows keep a NULL reason, which
-- reads as "no recorded failure", and the previous Worker version ignores the
-- column entirely, so a rollback is a code rollback and D1 has no down step.
-- No DROP, no rename, no NOT NULL without a DEFAULT, per the expand/contract
-- order: a later issue reads the column for the cap decision, and only then
-- backfills.

ALTER TABLE sweep_run ADD COLUMN reason TEXT;

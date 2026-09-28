-- 0024_page_transport.sql — Site change P2c, issue #5297: the `page` row stores
-- its learned transport, the escalation reason, when the transport was tested,
-- and when the page was deferred. Four additive ALTERs, no DROP, no NOT NULL
-- without a DEFAULT, no rename. Phase 1 of the expand/contract plan in
-- AGENTS.md (D1 schema rule): the writer that flips `transport` and clears
-- `deferred_at` in the same UPDATE ships in the same PR, but no reader is
-- gated on the new columns and no `page` row is migrated.
ALTER TABLE page ADD COLUMN transport TEXT CHECK (transport IS NULL OR transport IN ('fetch','browser'));
ALTER TABLE page ADD COLUMN transport_reason TEXT;
ALTER TABLE page ADD COLUMN transport_tested_at TEXT;
ALTER TABLE page ADD COLUMN deferred_at TEXT;

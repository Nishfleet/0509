-- ---------------------------------------------------------------------------
-- 0004_takedown.sql — the global takedown list (engine 10 P10.2, 0509#3982).
--
-- Additive and one phase. The table is new, so nothing the previously-running
-- version of the code reads changes and the fleet's auto-revert stays possible.
-- No DROP, no rename, no NOT NULL without a DEFAULT.
--
-- A takedown is global: any workspace, present or future. The data model is
-- tenant-scoped, so the two are bridged by the row here plus the fan-out
-- Workflow (workers/workflows/takedown.ts) that routes the guarantee through
-- `entity.state`. `UNIQUE (subject_kind, subject_value)` is what makes the
-- onboarding and discovery lookups reads rather than scans, and what makes a
-- duplicate request idempotent.
--
-- The row is permanent. `fanned_out_at` is set last, so an interrupted fan-out
-- is detectable: fanned_out_at IS NULL is exactly the reconciliation query
-- workers/standing/nightly.ts runs.
--
-- `fan_out_attempts` is the only other mutable column, and it is written by
-- the reconciliation before it creates a Workflow instance. Cloudflare
-- Workflows require a unique instance id, so a crashed instance holding the
-- takedown's id cannot be re-created with the same id — the row would sit
-- unfanned forever while the reconciler's create() was rejected every night.
-- A per-attempt counter in the row is what mints a fresh id
-- (`<takedown-id>-<attempt>`) that the interrupted run never held.
-- ---------------------------------------------------------------------------

CREATE TABLE takedown (
  id TEXT PRIMARY KEY NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('domain','handle')),
  subject_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  actioned_at TEXT,
  actioned_by TEXT,
  fanned_out_at TEXT,
  fan_out_attempts INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  UNIQUE (subject_kind, subject_value)
);

-- The reconciler's query: every granted takedown whose fan-out has not
-- completed. Partial, so it stays small no matter how many rows the list
-- accumulates over the years.
CREATE INDEX idx_takedown_unfanned ON takedown(actioned_at) WHERE fanned_out_at IS NULL;

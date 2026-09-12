-- Onboarding epic slice 2 (Nishfleet/0509#3175): a removed competitor
-- suggestion must never come back.
--
-- Suggested competitors are DERIVED on every panel load (auto-competitor-seed
-- re-runs the keyword probes and re-ranks), so "remove" had nowhere to be
-- recorded and the next load simply re-derived the same row. This table is the
-- one durable bit of state the derivation consults: (user, candidate key) is
-- dismissed, and the seed filters it out before ranking.
--
-- Expense/contract: this is phase 1 of the dismissal feature — ADD ONLY. One
-- nullable-free, DEFAULTed table, no column drops, no renames, no NOT NULL
-- added to an existing table. The previous Worker version knows nothing about
-- this table, which is exactly why it is safe: it neither reads nor writes it,
-- and the D1 rollback (code only, never data) leaves it in place harmlessly.
--
-- `candidate_key` is the SAME key the panel already builds for a suggestion
-- (`buildCandidateId`: lowercased advertiser | registrable domain | page id),
-- so a dismissal stays valid across re-derivations and across the two
-- discovery seed sources (Meta ads / landing-page fallback).
--
-- Retention: one row per explicit user removal. Rows are only ever written on
-- a human action, so this table grows with real dismissals, not with sweeps.
CREATE TABLE IF NOT EXISTS competitor_suggestion_dismissal (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  -- The panel's candidate id for the dismissed suggestion. See buildCandidateId.
  candidate_key TEXT NOT NULL,
  -- Registrable domain of the dismissed candidate when one was resolvable, so
  -- a later sweep can still match a candidate whose display name changed.
  candidate_domain TEXT,
  -- Display name at dismissal time, kept for support/debug only. Never used
  -- for matching.
  candidate_label TEXT,
  dismissed_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

-- The load path is "given this user, which candidates are dismissed" — one
-- point lookup per page load. UNIQUE also makes the write path idempotent:
-- dismissing the same suggestion twice is a no-op, not a duplicate row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_competitor_suggestion_dismissal_user_key
  ON competitor_suggestion_dismissal (user_id, candidate_key);

CREATE INDEX IF NOT EXISTS idx_competitor_suggestion_dismissal_user
  ON competitor_suggestion_dismissal (user_id);

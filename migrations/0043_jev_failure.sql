-- One row per failed AI judgement call, so the exact reason of a blip is readable from D1 afterwards. No workspace column and no prompt or state: only the question id, a kind, the provider's four-digit code and the first 160 characters of its error.
CREATE TABLE jev_failure (
  id TEXT PRIMARY KEY NOT NULL,
  question TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rate_limited', 'billing', 'timeout', 'bad_shape', 'other')),
  code TEXT,
  message TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX idx_jev_failure_at ON jev_failure(occurred_at);

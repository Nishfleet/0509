-- Email delivery canary (measures the outbound send → receive loop end to end).
--
-- Before this table the product sent mail through the Cloudflare Email Service
-- binding but never learned whether any of it arrived: suppression
-- (0096_email_suppression) was the only signal, and it only speaks when a send
-- FAILS at the provider. This table closes the loop: a cron sends a canary with
-- a unique token in the subject, the Worker's `email()` handler receives the
-- routed reply, and the round trip is measured (sent_at -> received_at).
--
-- Shape: one row per canary attempt, keyed by the unique token carried in the
-- subject line.
--   - 'sent'     — provider accepted the send; awaiting receipt.
--   - 'received' — the email() handler parsed the token and matched this row.
--   - 'failed'   — terminal failure: provider send error, a late receipt
--                  (latency over the 10-minute deadline), or an unmatched
--                  receipt (token with no sent row). `error` says which.
--
-- Additive and one-way (D1 has no down migrations): no existing table, column
-- or read path changes. Rollback of the writer leaves rows unread.

CREATE TABLE IF NOT EXISTS email_delivery_canary (
  token TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('sent', 'received', 'failed')),
  sent_at TEXT,
  received_at TEXT,
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_delivery_canary_created_at
  ON email_delivery_canary(created_at);
CREATE INDEX IF NOT EXISTS idx_email_delivery_canary_status_sent
  ON email_delivery_canary(status, sent_at);

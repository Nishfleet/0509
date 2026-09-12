-- Issue #2983: bounce/complaint suppression for outbound 0509.io email.
--
-- Before this table the only suppression truth was delivery_target.opted_out_at
-- (human unsubscribe/pause). A recipient whose provider acceptance keeps
-- failing (hard bounce) stayed opted-in forever, so every digest/alert/billing
-- cron retried the same dead address against the provider, and there was no
-- place to record a complaint even if one were ever relayed.
--
-- Shape: one row per (address, reason). Two reasons, deliberately:
--   - 'bounce'     — written by the send core on a definite provider failure;
--                    consecutive_failures counts failures since the last
--                    successful acceptance; a later success deletes the row
--                    (transient blips self-heal, 3+ consecutive failures stick).
--   - 'complaint'  — written by an explicit complaint writer (relay/ops); never
--                    cleared by a later successful send.
-- The consult lives in the one provider chokepoint every sender shares
-- (delivery-email-core.sendCloudflareEmail), so "consulted before every send"
-- holds for digests, alerts, billing, account and operator mail at once.
--
-- Additive and one-way (D1 has no down migrations): no existing table, column
-- or read path changes. Readers that predate this table simply see the same
-- behavior (an unreadable/missing suppression row reads as "not suppressed").

CREATE TABLE IF NOT EXISTS email_suppression (
  address TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('bounce', 'complaint')),
  source TEXT NOT NULL,
  detail TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (address, reason)
);

-- 0059_support_autoreply.sql — one auto-reply per sender per 24 hours.
-- Expand-only. The key is the sha256 of the lower-cased sender address, so no
-- address is stored. A row is the claim to send; the support inbox deletes it
-- again if the reply fails, and the daily sweep deletes rows older than a day.
CREATE TABLE support_autoreply (
  sender_sha256 TEXT PRIMARY KEY NOT NULL,
  sent_at TEXT NOT NULL
);

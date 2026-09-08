-- Expand phase (issue 1200): persist allowlisted signup attribution on the
-- user row so locale SEO and MagicBrief signups can later be scored on
-- 7-day watchlist retention. Dual-write only; nothing is dropped or renamed.
-- Existing rows stay NULL. The pending table bridges signup-start (no user
-- yet) to user-create, including magic-link clicks on another device.

ALTER TABLE user ADD COLUMN signup_source TEXT
  CHECK (
    signup_source IS NULL
    OR signup_source IN (
      'magicbrief-migration',
      'locale-en-sneaker-resale',
      'locale-de-sneaker-resale',
      'locale-ja-sneaker-resale',
      'locale-pt-br-sneaker-resale'
    )
  );

CREATE TABLE IF NOT EXISTS signup_source_pending (
  email TEXT PRIMARY KEY NOT NULL,
  signup_source TEXT NOT NULL CHECK (
    signup_source IN (
      'magicbrief-migration',
      'locale-en-sneaker-resale',
      'locale-de-sneaker-resale',
      'locale-ja-sneaker-resale',
      'locale-pt-br-sneaker-resale'
    )
  ),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_signup_source_pending_expires
  ON signup_source_pending(expires_at);

-- Generalize signup attribution (issue #2108): signup_source moves from six
-- hardcoded literals to an open, shape-checked allowlist — NULL, the existing
-- literals (now including 'pricing-free', which the code allowlist already
-- accepted but the 0080 CHECK rejected), lowercase slugs, and `ref:<eTLD+1>`
-- referer markers. The open rule mirrors the code rule in
-- app/lib/signup-source.ts: 1-44 chars, only [a-z0-9:.-] — no whitespace, no
-- uppercase, no query strings, no full URLs. SQLite cannot ALTER a CHECK in
-- place, so both tables are rebuilt: create the replacement, copy, drop the
-- old table, rename, recreate indexes. `user` is referenced by many child
-- tables (session, account, passkey, watchlist, ...), so the rename-first
-- order is deliberately NOT used: renaming `user` rewrites every child
-- table's REFERENCES clause to the rename target and strands them on the
-- dropped table. Creating `user_new` and renaming it INTO place leaves child
-- references on `user` untouched. Expand-only: every value the old CHECKs
-- accepted is still accepted, so existing rows copy through unchanged.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- user: rebuild with the expanded signup_source CHECK. Column list mirrors
-- 0000_auth.sql + 0005_onboarding.sql (onboardedAt) + 0080 (signup_source).
-- ---------------------------------------------------------------------------

CREATE TABLE user_new (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  onboardedAt TEXT,
  signup_source TEXT CHECK (
    signup_source IS NULL
    OR signup_source IN (
      'magicbrief-migration',
      'locale-en-sneaker-resale',
      'locale-de-sneaker-resale',
      'locale-ja-sneaker-resale',
      'locale-pt-br-sneaker-resale',
      'pricing-free'
    )
    OR (
      length(signup_source) BETWEEN 1 AND 44
      AND signup_source NOT GLOB '*[^a-z0-9:.-]*'
    )
  )
);

INSERT INTO user_new (
  id,
  name,
  email,
  emailVerified,
  image,
  createdAt,
  updatedAt,
  onboardedAt,
  signup_source
)
SELECT
  id,
  name,
  email,
  emailVerified,
  image,
  createdAt,
  updatedAt,
  onboardedAt,
  signup_source
FROM user;

DROP TABLE user;

ALTER TABLE user_new RENAME TO user;

-- 0022_hot_path_indexes.sql: the Dodo webhook email lookup index rides along
-- with the rebuild.
CREATE INDEX IF NOT EXISTS idx_user_email_nocase
  ON user(email COLLATE NOCASE);

-- ---------------------------------------------------------------------------
-- signup_source_pending: rebuild with the same expanded CHECK (NOT NULL kept).
-- ---------------------------------------------------------------------------

CREATE TABLE signup_source_pending_new (
  email TEXT PRIMARY KEY NOT NULL,
  signup_source TEXT NOT NULL CHECK (
    signup_source IN (
      'magicbrief-migration',
      'locale-en-sneaker-resale',
      'locale-de-sneaker-resale',
      'locale-ja-sneaker-resale',
      'locale-pt-br-sneaker-resale',
      'pricing-free'
    )
    OR (
      length(signup_source) BETWEEN 1 AND 44
      AND signup_source NOT GLOB '*[^a-z0-9:.-]*'
    )
  ),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

INSERT INTO signup_source_pending_new (
  email,
  signup_source,
  created_at,
  expires_at
)
SELECT
  email,
  signup_source,
  created_at,
  expires_at
FROM signup_source_pending;

DROP TABLE signup_source_pending;

ALTER TABLE signup_source_pending_new RENAME TO signup_source_pending;

CREATE INDEX IF NOT EXISTS idx_signup_source_pending_expires
  ON signup_source_pending(expires_at);

PRAGMA foreign_keys = ON;

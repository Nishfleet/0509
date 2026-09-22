-- 0003_card_publish.sql — the public standing card's publish state.
-- Issue #3969 (engine 9, P9.1), contract docs/REBUILD-STANDING-CARD.md.
--
-- Expand-only: two additive columns on `workspace`, one nullable and one with a
-- DEFAULT, so the version of the code running before this file applies keeps
-- working. D1 has no down-migrations, so this is one-way; there is no DROP here
-- and there must not be one.
--
-- Why on `workspace` and not a new table: the card is one per workspace, the
-- toggle is one switch in Settings, and a `card` table would be a table with one
-- row per workspace whose lifecycle is the workspace's. The columns are named
-- with the `card_` prefix because they are card state that happens to live on
-- the tenant root, not general workspace facts.

-- Off by default. The card is a publishing act and the product never publishes
-- a customer without them turning it on. 0 rather than NULL so the serve path
-- reads a flag, not a tri-state.
ALTER TABLE workspace ADD COLUMN card_is_published INTEGER NOT NULL DEFAULT 0;

-- Opaque and rotatable: a random token in a column, never derived and never
-- signed. Rotating it is an UPDATE, and the old value 404s immediately because
-- the lookup misses — a row lookup, not a signature check. The same pattern as
-- engine 7's unsubscribe token, deliberately, so the codebase has one answer for
-- "a public URL that must be revocable".
--
-- NULL is the unpublished-and-never-published state. SQLite allows many NULLs
-- in a UNIQUE index, so every unpublished workspace shares the empty state
-- without colliding.
ALTER TABLE workspace ADD COLUMN card_slug TEXT;

-- The serve path's only lookup: slug -> workspace. A UNIQUE index makes it a
-- single indexed read with no scan, and it makes two workspaces holding the same
-- slug a write error rather than a public URL that resolves to the wrong brand.
CREATE UNIQUE INDEX idx_workspace_card_slug ON workspace(card_slug);

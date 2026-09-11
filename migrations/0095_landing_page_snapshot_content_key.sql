-- Issue #2442 (review finding M8): landing-page snapshot dedup was
-- check-then-insert in `createLandingPageSnapshot` with no unique constraint
-- covering the dedup tuple, so concurrent identical captures double-inserted.
-- Monitoring fan-out runs up to 8 checks in flight, so this is a live path.
--
-- The dedup key cannot be a plain unique index on the raw columns: SQLite
-- treats NULLs as distinct, and `cta_text` / `price_text` / `form_present` are
-- nullable, which is exactly why the reader used `IS` comparisons. A generated
-- column folds the nullable signals down to a written value ('' / -1) so a
-- UNIQUE index over it makes the dedup atomic via
-- `INSERT ... ON CONFLICT(content_key) DO NOTHING`.
--
-- Prod may already hold duplicate rows from the race this fixes, and a unique
-- index over existing duplicates fails the migration, so the DELETE runs first.
--
-- One-way by design (D1 has no down migrations): the column and index are
-- additive, the DELETE only removes rows that violate the dedup contract the
-- module already promised.

-- Step 1: collapse pre-existing duplicates, keeping the newest capture per
-- dedup tuple. Ties on `captured_at` are broken by `created_at`, then `id`, so
-- the survivor is deterministic.
DELETE FROM landing_page_snapshot
WHERE id NOT IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          canonical_url,
          normalized_headline_hash,
          COALESCE(cta_text, ''),
          COALESCE(price_text, ''),
          COALESCE(form_present, -1)
        ORDER BY captured_at DESC, created_at DESC, id DESC
      ) AS rn
    FROM landing_page_snapshot
  )
  WHERE rn = 1
);

-- Step 2: the content key. `form_present` is stored as 0/1 and NULL, so
-- COALESCE(...,-1) keeps NULL distinct from both booleans.
--
-- VIRTUAL, not STORED, and that is forced: SQLite refuses
-- `ALTER TABLE ... ADD COLUMN ... GENERATED ALWAYS AS (...) STORED` once the
-- table has any row ("cannot add a STORED column"), and prod has rows. VIRTUAL
-- is legal on a populated table, is indexable (the UNIQUE index below is what
-- makes the dedup atomic), and computes the same value. STORED would only be
-- available on an empty table, i.e. a fresh database, which is not prod.
ALTER TABLE landing_page_snapshot ADD COLUMN content_key TEXT
  GENERATED ALWAYS AS (
    canonical_url || '|' ||
    normalized_headline_hash || '|' ||
    COALESCE(cta_text, '') || '|' ||
    COALESCE(price_text, '') || '|' ||
    COALESCE(form_present, -1)
  ) VIRTUAL;

-- Step 3: the constraint that makes the insert atomic.
CREATE UNIQUE INDEX IF NOT EXISTS idx_landing_page_snapshot_content_key
  ON landing_page_snapshot(content_key);

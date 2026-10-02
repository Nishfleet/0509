-- 0037_feed_source.sql — the blog and changelog feed source row, seeded disabled.
--
-- Issue #6377. A source is a row plus a plugin (docs/REBUILD-SCHEMA.md), so this
-- file only inserts a row. The reader is app/lib/feeds/read-feed.server.ts and the
-- nightly Workflow is workers/workflows/feed-sweep.ts (docs/engines/content.md).
--
-- kind 'site' because source.kind carries a CHECK (ads, mentions, site, hiring)
-- and widening it is a table rebuild; platform 'feed' is what tells the two
-- apart. Every query that selects the site kind either selects by key, joins
-- the page table, or filters platform <> 'feed', so a feed watch is never swept
-- or counted as a web page.
--
-- is_enabled = 0 is the mechanism, not a label, as in 0020_hiring_sources.sql:
-- app/lib/coverage.ts keeps the Content entry at live: false until the reader
-- is proven on a real brand, and tests/integration/coverage.integration.test.ts
-- matches the file against `SELECT key FROM source WHERE is_enabled = 1`.
-- Switching it on is one UPDATE plus a live entry, in the PR that proves it.
--
-- reliability 'rss': the reader parses a public RSS or Atom feed and needs no
-- browser transport or API key. Additive only: one INSERT statement with one
-- row; nothing altered or deleted.

INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES
  ('src_site_feed', 'feed.rss', 'site', 'feed', 'feed.rss', 'rss', 0, '{}')
ON CONFLICT (key) DO NOTHING;

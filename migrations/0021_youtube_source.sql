-- 0021_youtube_source.sql — the enabled YouTube channel-feed mentions source.
--
-- Issue #5167 (parent #5082). A source is a row plus a plugin
-- (docs/REBUILD-SCHEMA.md), so this file only inserts a row. The adapter is
-- `youtube.channel_rss` in workers/sources/registry.ts.
--
-- is_enabled = 1 is the mechanism, not a label, as in 0017_news_sources.sql.
-- app/lib/coverage.ts marks `mentions.youtube` live in this same PR, because
-- tests/integration/coverage.integration.test.ts matches the file against
-- `SELECT key FROM source WHERE is_enabled = 1` in both directions: an enabled
-- row needs a live entry naming its key, and a live entry needs an enabled row.
-- LIVE_COVERAGE is what the homepage, /llms.txt, the JSON-LD featureList and
-- the FAQ tell customers, search engines and answer engines.
--
-- The id is `src_mentions_youtube`, the same id
-- tests/integration/mentions/youtube-stale.integration.test.ts inserts a watch
-- against; its own source insert becomes a no-op once this row exists. No watch
-- code is needed: app/lib/data/watch.server.ts ENSURE_WATCHES creates a watch
-- per `on` entity for every enabled source of a kind.
--
-- reliability 'rss': the adapter reads the public Atom channel feed, so a read
-- needs no browser transport and no API key. Additive only: one INSERT
-- statement with one row; nothing altered or deleted.

INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES
  ('src_mentions_youtube', 'youtube.channel_rss', 'mentions', 'youtube', 'youtube.channel_rss', 'rss', 1, '{}')
ON CONFLICT (key) DO NOTHING;

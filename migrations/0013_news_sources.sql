-- 0013_news_sources.sql — the source rows the nightly mentions sweep reads.
--
-- A source is a row plus a plugin (docs/REBUILD-SCHEMA.md), so this file only
-- inserts rows; the plugins are workers/sources/registry.ts. Nothing here
-- changes a table.
--
-- gdelt.doc replaces Google News RSS as the news source. The Google News feed's
-- own <copyright> element limits it to "personal, non-commercial use", which a
-- paid product is not. GDELT's DOC 2.0 API is free for commercial use, returns
-- the publisher's real article URL (docs/engines/mentions.md 0.1 could not get
-- one from Google News), and asks for one request every five seconds, which the
-- sweep Workflow keeps with step.sleep between GDELT calls.
--
-- hn.algolia is the Hacker News search API (docs/engines/mentions.md probe 1).

INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES
  ('src_mentions_gdelt', 'gdelt.doc', 'mentions', 'gdelt', 'gdelt.doc', 'official_api', 1,
   '{"endpoint":"https://api.gdeltproject.org/api/v2/doc/doc","min_interval_seconds":5,"terms":"https://www.gdeltproject.org/about.html#termsofuse"}'),
  ('src_mentions_hn', 'hn.algolia', 'mentions', 'hn', 'hn.algolia', 'official_api', 1,
   '{"endpoint":"https://hn.algolia.com/api/v1/search_by_date"}')
ON CONFLICT (key) DO NOTHING;

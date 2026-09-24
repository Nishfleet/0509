-- 0011_site_source.sql — the website source row the nightly site sweep files under.
--
-- docs/engines/site-change.md. Every watch, snapshot and signal names a
-- source row, so the site-change engine needs exactly one: kind 'site',
-- platform 'web'. The key is the key it keeps; enabling or pausing the whole
-- engine later is one UPDATE of is_enabled, never a migration.
--
-- reliability 'scraped_page': the page is read with a plain fetch and, when
-- that is refused, a real browser (app/lib/fetch/transport.server.ts). There
-- is no official API behind a marketing site.
--
-- Additive only: one INSERT, nothing altered or deleted.

INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES
  ('src_site_web', 'site.web', 'site', 'web', 'site.page', 'scraped_page', 1, '{}');

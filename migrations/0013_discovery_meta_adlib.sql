-- 0013_discovery_meta_adlib.sql — the Meta Ad Library keyword source.
--
-- Competitor discovery's one browser generator (0509#4161). It searches the
-- ad library by category and market and writes one snapshot per run. This is
-- not the creative-tracking source: plugin_key discovery.meta_adlib is the
-- discriminator a later ads sweep uses to leave these watches alone.
--
-- Additive only: one INSERT, nothing altered or deleted.

INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES
  ('src_discovery_meta_adlib',
   'discovery.meta_adlib',
   'ads',
   'meta',
   'discovery.meta_adlib',
   'scraped_page',
   1,
   '{"role":"discovery-keyword","transport":"browser","library":"https://www.facebook.com/ads/library/"}');

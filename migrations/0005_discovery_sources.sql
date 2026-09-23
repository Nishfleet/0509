-- Discovery engine (#3884): one source row per generator so a run can write
-- its snapshot row against a watch on the self entity. plugin_key is the
-- generator name used in code; reliability feeds the Jev context pack.
-- These rows are not sweep targets: watches on competitor entities are only
-- seeded from sources whose key does not start with 'discovery.'.

INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES
  ('src_discovery_gnews', 'discovery.google-news', 'mentions', 'google',
   'google-news-roundup', 'rss', 1, '{"role":"discovery-generator"}'),
  ('src_discovery_hn', 'discovery.hn-algolia', 'mentions', 'hn',
   'hn-algolia-comentions', 'best_effort', 1, '{"role":"discovery-generator"}');

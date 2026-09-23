-- 0007_meta_ads_source.sql — the Meta ads source row (#3974).
--
-- One INSERT. 0001_rebuild.sql is already applied, so a platform is a new
-- file, same rule as 0002_parked_ads_sources.sql. 0006 is
-- 0006_scoring_weight_seed.sql on origin/main, so this file is 0007.
--
-- config_json is an AdsSourceDescriptor (app/lib/ads/descriptor.ts):
-- transport browser, the Ad Library page, {target} for the brand query,
-- reliability scraped_page. The Graph ads_archive URL is not this endpoint
-- (docs/engines/ads.md probe 1).

INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES
  ('src_ads_meta',
   'ads.meta', 'ads', 'meta', 'ads.meta', 'scraped_page', 1,
   '{
     "transport": "browser",
     "endpoint": "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=GB&q={target}&search_type=keyword_unordered&media_type=all",
     "method": "GET",
     "auth": { "kind": "none" },
     "waitForSelector": "script[type=\"application/json\"]",
     "rateLimitPerMinute": 1,
     "reliability": "scraped_page"
   }');

-- 0006_meta_ads_source.sql — the Meta ads source row (#3974).
--
-- Issue #3974 / engine issue #3891, packet P2 of docs/engines/ads.md.
-- One source row. Not a schema change: a platform is an INSERT, and
-- 0001_rebuild.sql is already applied in production so this row has to live
-- in its own file (same rule as 0002_parked_ads_sources.sql).
--
-- reliability = scraped_page because the row describes the Ad Library page
-- the browser transport returns, not the Graph ads_archive endpoint.
-- docs/engines/ads.md probe 1: that endpoint answers a permanent
-- OAuthException when called without a token, so this descriptor does not
-- point at it. Probe 3: a plain fetch of the Ad Library page returns 403.
--
-- is_enabled = 1. Unlike the parked rows in 0002, this platform has a field
-- map (app/lib/ads/platforms/meta.ts). The sweep that will select it does
-- not exist yet; the row is the registry entry that sweep will read.

INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES
  ('src_ads_meta',
   'ads.meta', 'ads', 'meta', 'ads.meta', 'scraped_page', 1,
   '{
     "endpoint_template": "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country={country}&q={query}&search_type=keyword_unordered&media_type=all",
     "method": "GET",
     "params": {
       "active_status": "all",
       "ad_type": "all",
       "country": "GB",
       "search_type": "keyword_unordered",
       "media_type": "all"
     },
     "auth": "none",
     "wait_for": "script[type=\"application/json\"]",
     "pagination_cursor_path": "search_results_connection.page_info.end_cursor",
     "rate_limit": { "pulls_per_brand_per_day": 1 },
     "reliability": "scraped_page",
     "plain_fetch": {
       "url": "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=GB&q=gymshark&search_type=keyword_unordered&media_type=all",
       "status": 403,
       "probed_at": "2026-09-21T12:13:08Z",
       "source_doc": "docs/engines/ads.md probe 3"
     },
     "graph_ads_archive": {
       "call": false,
       "reason": "OAuthException without a token is permanent",
       "source_doc": "docs/engines/ads.md probe 1"
     }
   }');

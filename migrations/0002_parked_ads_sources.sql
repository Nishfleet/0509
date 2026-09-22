-- 0002_parked_ads_sources.sql — the five parked ad platforms (#4039).
--
-- Issue #4039 / engine issue #3891. Records the platforms `docs/engines/ads.md`
-- ranked build order 6–10 as parked: Snap, X, Pinterest, Amazon and Apple have
-- no reachable ad-transparency search surface at the obvious URLs today
-- (404 / NXDOMAIN), and finding the real URL is a research task, not an
-- engineering one. Packets P1–P6 of that doc build the transports, the sweep and
-- the adapters; this file is the registry state for the platforms that sit
-- outside all of it, so nobody probes them blind again.
--
-- A SEPARATE FILE, NOT AN APPEND TO 0001_rebuild.sql. `wrangler d1 migrations
-- apply` tracks by filename (docs/REBUILD-SCHEMA.md §103): an edit to a file the
-- migrations table already records is dead SQL that never runs again. The deploy
-- run of 2026-09-21T12:44:35Z applied 0001_rebuild.sql to production D1 and
-- every deploy since has logged "No migrations to apply", so appending these
-- rows there would have delivered them to the test database only while
-- production silently kept none of them. This is also the numbering rule Nish
-- wrote on #4039 2026-09-22T12:32:53Z: 0001 is the highest number on
-- origin/main at branch time, so this file is 0002, and a conflicting
-- #3977/#3969/#3905 file lands as 0002 also — renumber this one if the merge
-- conflicts, the SQL inside does not change.
--
-- WHAT EACH ROW SAYS
--
-- is_enabled = 0 is the mechanism, not a label. The sweep's eligibility
-- predicate requires source.is_enabled = 1 (docs/engines/ads.md P3 and
-- docs/engines/mentions.md P5.2 use the same predicate), so a disabled row
-- cannot be selected, cannot be turned into a queue message, and cannot produce
-- a snapshot. A parked platform producing nothing is the intended state, which
-- is also why it must never be reported as degraded: degraded means an eligible
-- source that returned nothing, and this row was never eligible.
--
-- reliability = 'best_effort' because the row describes a probe, not a working
-- adapter. official_api and scraped_page both claim an adapter that earns them.
--
-- config_json carries the evidence the decision rests on: the exact URL tried,
-- the status returned and the UTC date of the probe, from
-- docs/engines/ads.md probes 12–16, all probed from this VPS on 2026-09-21.
--
-- No adapter, no descriptor transport, no credential ships here, and
-- plugin_key names the parked row rather than a plugin that exists — the
-- ids and keys are deliberately suffixed `_parked` so a later packet cannot
-- mistake one for a working source.

INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES
  ('src_ads_snap_parked',
   'ads.snap_parked', 'ads', 'snap', 'ads.snap_parked', 'best_effort', 0,
   '{
     "state": "parked",
     "reason": "No reachable ad-transparency search surface at the obvious URLs",
     "evidence": {
       "probed_at": "2026-09-21T12:14:29Z",
       "probes": [
         {
           "url": "https://snap.com/political-ads",
           "status": 200,
           "note": "603920 bytes; a political-ads page, not an advertiser search surface"
         },
         {
           "url": "https://transparency.snap.com",
           "status": "NXDOMAIN",
           "note": "No DNS record for the subdomain"
         }
       ]
     },
     "next_step": "Find the real search URL. That is research, not engineering.",
     "source_doc": "docs/engines/ads.md probes 12-16 and the build-order table, rank 6"
   }'),

  ('src_ads_x_parked',
   'ads.x_parked', 'ads', 'x', 'ads.x_parked', 'best_effort', 0,
   '{
     "state": "parked",
     "reason": "No reachable ad-transparency search surface at the obvious URLs",
     "evidence": {
       "probed_at": "2026-09-21T12:14:29Z",
       "probes": [
         {
           "url": "https://ads.x.com/ad-repository/search?q=gymshark",
           "status": 404,
           "note": "404 at the ad-repository path"
         }
       ]
     },
     "next_step": "Find the real search URL. That is research, not engineering.",
     "source_doc": "docs/engines/ads.md probes 12-16 and the build-order table, rank 7"
   }'),

  ('src_ads_pinterest_parked',
   'ads.pinterest_parked', 'ads', 'pinterest', 'ads.pinterest_parked', 'best_effort', 0,
   '{
     "state": "parked",
     "reason": "No reachable ad-transparency search surface at the obvious URLs",
     "evidence": {
       "probed_at": "2026-09-21T12:14:29Z",
       "probes": [
         {
           "url": "https://ads.pinterest.com/ad-library/?q=gymshark",
           "status": 404,
           "note": "404 at the ad-library path"
         }
       ]
     },
     "next_step": "Find the real search URL. That is research, not engineering.",
     "source_doc": "docs/engines/ads.md probes 12-16 and the build-order table, rank 8"
   }'),

  ('src_ads_amazon_parked',
   'ads.amazon_parked', 'ads', 'amazon', 'ads.amazon_parked', 'best_effort', 0,
   '{
     "state": "parked",
     "reason": "No reachable ad-transparency search surface at the obvious URLs",
     "evidence": {
       "probed_at": "2026-09-21T12:14:29Z",
       "probes": [
         {
           "url": "https://amazon.com/adlib",
           "status": 404,
           "note": "404 at the ad-library path"
         }
       ]
     },
     "next_step": "Find the real search URL. That is research, not engineering.",
     "source_doc": "docs/engines/ads.md probes 12-16 and the build-order table, rank 9"
   }'),

  ('src_ads_apple_parked',
   'ads.apple_parked', 'ads', 'apple', 'ads.apple_parked', 'best_effort', 0,
   '{
     "state": "parked",
     "reason": "No reachable ad-transparency search surface at the obvious URLs",
     "evidence": {
       "probed_at": "2026-09-21T12:14:29Z",
       "probes": [
         {
           "url": "https://ads.apple.com/transparency",
           "status": 404,
           "note": "404 at the transparency path"
         }
       ]
     },
     "next_step": "Find the real search URL. That is research, not engineering.",
     "source_doc": "docs/engines/ads.md probes 12-16 and the build-order table, rank 10"
   }');

-- 0007_x_mentions_disabled.sql — X as a disabled mentions source row (#3977, engine 5).
--
-- Issue #3977 / packet P5.6 (docs/engines/mentions.md § P5.6). A source we have
-- decided not to pay for is invisible to the product — not polled, not counted,
-- not rendered — so enabling it later is one `UPDATE source SET is_enabled = 1`
-- and never a migration.
--
-- A SEPARATE FILE, NOT AN APPEND to 0001_rebuild.sql. `wrangler d1 migrations
-- apply` tracks by filename (docs/REBUILD-SCHEMA.md): an edit to a file the
-- migrations table already records is dead SQL that never runs again. The
-- numbering rule on #3977 (2026-09-22) says this packet seeds at the highest
-- number in migrations/ plus one; this landed as 0007 because 0006 filled while
-- the packet waited (#4454), and the SQL inside did not change.
--
-- is_enabled = 0 is the mechanism, not a label. The mentions engine's
-- eligibility select in P5.2 requires `source.is_enabled = 1`, so this row
-- cannot be selected, cannot become a queue message, and cannot produce a
-- snapshot. Disabled is not degraded: the UI hides this row as disabled, never
-- renders it as a degraded pill.
--
-- config_json is deliberately a single line with no `state` key:
-- app/components/source-pill.tsx hides any row whose config_json.state is
-- "disabled" or "parked", so a state key would make enabling take two edits
-- instead of one UPDATE. The key is `x.search` with no `_parked` suffix —
-- this row's key is the key it will keep once enabled.
--
-- No adapter, no credential, no Apify call, no spend. The row carries the
-- cheapest known route and leaves approved_cost null until Nish says yes:
-- Nish's decision of 2026-09-22 is no paid X provider until revenue.

INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES
  ('src_mentions_x',
   'x.search', 'mentions', 'x', 'x.search', 'best_effort', 0,
   '{"disabled_reason":"No paid X provider until revenue","decided_by":"Nish","decided_at":"2026-09-22","cheapest_route":{"provider":"Apify","usd_per_1000_tweets":0.40},"approved_cost":null,"source_doc":"docs/engines/mentions.md P5.6"}');

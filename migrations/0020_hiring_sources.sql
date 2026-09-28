-- 0020_hiring_sources.sql — the five job-board source rows the hiring engine
-- files every watch, snapshot and signal under, seeded disabled.
--
-- Issue #4714. Every watch, snapshot and signal names a source row, and none
-- existed for hiring. One row per job-board platform, with the key the hiring
-- engine keeps: the row ids are already named by the open hiring issues
-- (#4837-#4851), so the ids are stable whether or not a platform is switched
-- on.
--
-- is_enabled = 0 is the mechanism, not a label, as in 0007_x_mentions_disabled.sql.
-- tests/integration/coverage.integration.test.ts matches app/lib/coverage.ts
-- against `SELECT key FROM source WHERE is_enabled = 1` in both directions: an
-- enabled row needs a live entry naming its key, and a live entry needs an
-- enabled row. LIVE_COVERAGE is what the homepage, /llms.txt, the JSON-LD
-- featureList and the FAQ tell customers, search engines and answer engines.
-- Nothing polls a job board yet (no adapter in workers/sources/hiring/, no
-- hiring-sweep workflow, no caller of the hiring signal writer), so an enabled
-- row today would put "Greenhouse, Lever, Ashby, Workable, SmartRecruiters
-- job posts" on the public site as a claim nothing backs. app/lib/coverage.ts
-- keeps the Hiring group at live: false, and these rows match it.
--
-- Nish chose this shape on 2026-09-25 (#4714, option A): seed disabled rather
-- than ship a public claim the engine does not deliver.
--
-- Switching a platform on is one `UPDATE source SET is_enabled = 1 WHERE id =
-- 'src_hiring_<platform>'` plus a live entry in app/lib/coverage.ts, in the PR
-- that wires the hiring sweep. Never a migration: wrangler d1 migrations apply
-- tracks by filename, so an edit to a recorded file is dead SQL that never runs
-- again.
--
-- reliability 'official_api': each board publishes a documented jobs API, so a
-- read is not a scrape and needs no browser transport.
--
-- Additive only: one INSERT statement with five rows; nothing altered or
-- deleted. config_json is '{}' as in 0011_site_source.sql, because no platform
-- carries platform-specific configuration yet and a state key would make
-- enabling take two edits instead of one UPDATE.

INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES
  ('src_hiring_greenhouse', 'hiring.greenhouse', 'hiring', 'greenhouse', 'hiring.board', 'official_api', 0, '{}'),
  ('src_hiring_lever', 'hiring.lever', 'hiring', 'lever', 'hiring.board', 'official_api', 0, '{}'),
  ('src_hiring_ashby', 'hiring.ashby', 'hiring', 'ashby', 'hiring.board', 'official_api', 0, '{}'),
  ('src_hiring_workable', 'hiring.workable', 'hiring', 'workable', 'hiring.board', 'official_api', 0, '{}'),
  ('src_hiring_smartrecruiters', 'hiring.smartrecruiters', 'hiring', 'smartrecruiters', 'hiring.board', 'official_api', 0, '{}');

-- 0015_hiring_sources.sql — the five official job-board source rows hiring watches under.
--
-- Every watch, snapshot and signal names a source row, and none existed for
-- hiring. Each row is one of the five job-board platforms that expose a public
-- official API, and the key is the key the hiring engine keeps. Enabling or
-- pausing a platform later is one UPDATE of is_enabled, never a migration
-- (migrations/0001_rebuild.sql's source comment: adding a platform is an INSERT
-- plus a plugin).
--
-- reliability 'official_api': each board publishes a documented jobs API, so a
-- read is not a scrape and needs no browser transport.
--
-- Additive only: one INSERT statement with five rows; nothing altered or
-- deleted. config_json is left '{}' because no platform carries
-- platform-specific configuration yet.

INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES
  ('src_hiring_greenhouse', 'hiring.greenhouse', 'hiring', 'greenhouse', 'hiring.board', 'official_api', 1, '{}'),
  ('src_hiring_lever', 'hiring.lever', 'hiring', 'lever', 'hiring.board', 'official_api', 1, '{}'),
  ('src_hiring_ashby', 'hiring.ashby', 'hiring', 'ashby', 'hiring.board', 'official_api', 1, '{}'),
  ('src_hiring_workable', 'hiring.workable', 'hiring', 'workable', 'hiring.board', 'official_api', 1, '{}'),
  ('src_hiring_smartrecruiters', 'hiring.smartrecruiters', 'hiring', 'smartrecruiters', 'hiring.board', 'official_api', 1, '{}');

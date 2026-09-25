-- 0023_source_conduct.sql — P10.5a, #5147: record rate and robots policy on every
-- source registry row. Two UPDATE statements, exactly as the issue specifies.
-- Renumbered 0022 -> 0023 because #5167 shipped 0022_youtube_source.sql first.
UPDATE source SET config_json = json_set(config_json, '$.min_interval_seconds', 6) WHERE key = 'gdelt.doc';
UPDATE source SET config_json = json_set(config_json, '$.robots',
  CASE
    WHEN kind = 'site' THEN json('{"self":"honoured","competitor":"logged_out_browser"}')
    WHEN plugin_key IN ('youtube.channel_rss', 'medium.tag_rss') THEN 'honoured'
    ELSE 'api_terms'
  END);

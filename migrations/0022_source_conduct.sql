UPDATE source SET config_json = json_set(config_json, '$.min_interval_seconds', 6) WHERE key = 'gdelt.doc';
UPDATE source SET config_json = json_set(config_json, '$.robots',
  CASE
    WHEN kind = 'site' THEN json('{"self":"honoured","competitor":"logged_out_browser"}')
    WHEN plugin_key IN ('youtube.channel_rss', 'medium.tag_rss') THEN 'honoured'
    ELSE 'api_terms'
  END);

-- The Slack channel row. A workspace's webhook is one send_target on it.
INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-slack', 'slack', 1, '{}')
ON CONFLICT(key) DO NOTHING;

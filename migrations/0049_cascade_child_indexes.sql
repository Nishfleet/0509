-- 0509#7080: index FK child columns that account-delete and competitor-forget
-- still full-scan. 0029 indexed the five hot cascade children; the rest stayed
-- on an allowlist that pointed at closed #5938. CREATE INDEX only, so the
-- previous Worker version keeps working and a rollback is a code rollback.

CREATE INDEX IF NOT EXISTS idx_alert_entity ON alert(entity_id);
CREATE INDEX IF NOT EXISTS idx_alert_incident ON alert(incident_id);
CREATE INDEX IF NOT EXISTS idx_alert_page ON alert(page_id);
CREATE INDEX IF NOT EXISTS idx_alert_signal ON alert(signal_id);
CREATE INDEX IF NOT EXISTS idx_incident_entity ON incident(entity_id);
CREATE INDEX IF NOT EXISTS idx_incident_notice_incident ON incident_notice(incident_id);
CREATE INDEX IF NOT EXISTS idx_jev_verdict_entity ON jev_verdict(entity_id);
CREATE INDEX IF NOT EXISTS idx_jev_verdict_signal ON jev_verdict(signal_id);
CREATE INDEX IF NOT EXISTS idx_plan_provider_customer ON plan(provider_customer_id);
CREATE INDEX IF NOT EXISTS idx_plan_provider_subscription ON plan(provider_subscription_id);
CREATE INDEX IF NOT EXISTS idx_send_attempt_target ON send_attempt(send_target_id);
CREATE INDEX IF NOT EXISTS idx_send_target_channel ON send_target(channel_id);
CREATE INDEX IF NOT EXISTS idx_signal_snapshot ON signal(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_signal_delivery_channel ON signal_delivery(channel_id);
CREATE INDEX IF NOT EXISTS idx_signal_delivery_attempt ON signal_delivery(send_attempt_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_page ON snapshot(page_id);
CREATE INDEX IF NOT EXISTS idx_standing_entity ON standing(entity_id);
CREATE INDEX IF NOT EXISTS idx_suggestion_entity ON suggestion(entity_id);
CREATE INDEX IF NOT EXISTS idx_user_decision_entity ON user_decision(entity_id);
CREATE INDEX IF NOT EXISTS idx_user_decision_signal ON user_decision(signal_id);
CREATE INDEX IF NOT EXISTS idx_watch_source ON watch(source_id);

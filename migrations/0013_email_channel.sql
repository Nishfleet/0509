-- 0013_email_channel.sql — the email channel row, and one email send_target per workspace.
--
-- The send lane (workers/delivery/consumer.ts) only sends to a send_target
-- joined to an enabled channel with key 'email'. No migration seeded that
-- channel and no code wrote a send_target, so every brief and every incident
-- email acked as no_target and nobody was ever emailed.
--
-- The channel is reference data, so it is seeded here like scoring_weight in
-- 0006. The backfill gives every existing workspace its owner's sign-in
-- address; new workspaces get theirs at sign-in (app/lib/data/send_target.server.ts).
-- One target per workspace and channel, matching the recipient tripwire.

INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-email', 'email', 1, '{}')
ON CONFLICT(key) DO NOTHING;

INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
SELECT 'st-email-' || w.id, w.id, c.id, u.email, u.emailVerified, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM workspace w
  JOIN "user" u ON u.id = w.owner_user_id
  JOIN channel c ON c.key = 'email'
 WHERE NOT EXISTS (
   SELECT 1 FROM send_target st WHERE st.workspace_id = w.id AND st.channel_id = c.id
 );

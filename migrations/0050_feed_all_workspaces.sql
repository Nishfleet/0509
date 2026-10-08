-- 0050_feed_all_workspaces.sql — sweep every workspace's brands for blog and changelog feeds.
--
-- Issue #6377. 0038 limited the feed.rss source to the soak account with config_json.pilot.
-- The soak report on #4730 after the 2026-10-08 02:45Z sweep reads "vercel.com feed read, 1
-- snapshots", the proof 0038 waited for. This removes "pilot" and nothing else: every other key
-- stays, and is_enabled is not touched, so the off-switch (a data-only migration setting
-- is_enabled = 0 with content.feed back to live: false in app/lib/coverage.ts) keeps working
-- whatever its number. With no pilot key the readers in app/lib/data/watch.server.ts (IN_PILOT) see every workspace; setting pilot again in a data-only migration narrows the sweep back to one account without a code change.
-- Additive: one UPDATE of one row; nothing dropped.

UPDATE source
SET config_json = json_remove(config_json, '$.pilot')
WHERE key = 'feed.rss' AND json_valid(config_json);

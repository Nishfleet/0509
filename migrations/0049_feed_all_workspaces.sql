-- 0049_feed_all_workspaces.sql — sweep every workspace's brands for blog and changelog feeds.
--
-- Issue #6377. 0038 limited the feed.rss source to the soak account with config_json.pilot.
-- The soak report on #4730 after the 2026-10-08 02:45Z sweep reads "vercel.com feed read, 1
-- snapshots", the proof 0038 waited for. This removes "pilot" and keeps every other key, and
-- sets is_enabled = 1 so the row state does not depend on what ran before. The readers in
-- app/lib/data/watch.server.ts no longer filter on it. The off-switch is a data-only
-- migration setting is_enabled = 0 with content.feed back to live: false in app/lib/coverage.ts.
-- Additive: one UPDATE of one row; nothing dropped.

UPDATE source
SET is_enabled = 1,
    config_json = json_remove(
      CASE WHEN json_valid(config_json) THEN config_json ELSE '{"robots":"honoured"}' END,
      '$.pilot'
    )
WHERE key = 'feed.rss';

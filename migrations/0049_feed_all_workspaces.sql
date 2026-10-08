-- 0049_feed_all_workspaces.sql — sweep every workspace's brands for blog and changelog feeds.
--
-- Issue #6377. 0038 limited the feed.rss source to the soak account with config_json.pilot.
-- The soak report of 2026-10-08 shows vercel.com read ("feed read, 1 snapshots") after the
-- 02:45Z sweep, so the pilot scope has done its job. This removes "pilot"; the readers in
-- app/lib/data/watch.server.ts no longer filter on it. The off-switch is a data-only
-- migration setting is_enabled = 0 with content.feed back to live: false in app/lib/coverage.ts.
-- Additive: one UPDATE of one row; nothing dropped.

UPDATE source
SET config_json = '{"robots":"honoured"}'
WHERE key = 'feed.rss';

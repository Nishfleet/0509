-- 0038_feed_pilot.sql — switch the blog and changelog feed source on for one workspace.
--
-- Issue #6377. The reader and the nightly Workflow shipped with 0037 and the row
-- seeded disabled. This turns the row on with config_json.pilot set to the soak
-- account, so planFeedSweep and readFeedTargets (app/lib/data/watch.server.ts)
-- only see entities of the workspace that account owns. The next migration drops
-- "pilot" once tonight's soak report shows the feeds reading cleanly.
--
-- app/lib/coverage.ts flips content.feed to live: true in the same PR, because
-- tests/integration/coverage.integration.test.ts requires a live entry for every
-- enabled source. Additive: one UPDATE of one row; nothing dropped.

UPDATE source
SET is_enabled = 1,
    config_json = '{"robots":"honoured","pilot":"e2e+soak@0509.io"}'
WHERE key = 'feed.rss';

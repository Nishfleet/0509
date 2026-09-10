-- Ads domain publisher resume cursor (issue #2361).
--
-- runAdsDomainPublisher loops serially over every seed-list domain, each a
-- live browser scrape riding the 04:00 cron. A wall-clock kill mid-run left
-- no record of progress, so the next night restarted at domain #1 and tail
-- domains silently never published. This table persists a single
-- (last_list, last_offset) cursor so each nightly run resumes where the last
-- one stopped, and the run emits ads_domain_publisher_run with truncated:true
-- when its internal deadline bites before the queue is covered.
--
-- One row, fixed id = 1 (singleton state). last_offset is the index into the
-- flattened all-lists work queue where the next run should start; 0 means
-- "start from the beginning". The cursor spans ALL SEED_LISTS, not just one
-- list. last_list is the human-readable list name at that offset.
--
-- Additive only: a brand-new table with no FKs and no NOT NULL-without-default
-- columns. The previous Worker version never reads this table, so landing it
-- cannot break the prior code (expand/contract: this is the "add" phase). The
-- seed row guarantees every read returns a cursor instead of an empty set.
CREATE TABLE IF NOT EXISTS ads_domain_publisher_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_list TEXT NOT NULL DEFAULT '',
  last_offset INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
);

INSERT OR IGNORE INTO ads_domain_publisher_state (id, last_list, last_offset, updated_at)
VALUES (1, '', 0, '1970-01-01T00:00:00.000Z');

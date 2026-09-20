-- Expand phase for an honest crawl-discovered page count (#2771).
--
-- The coverage label dropped its "crawl reached N" clause in #2440 because no
-- honest count existed: crawl-discovered pages persist with
-- discovery_source = 'sitemap_content' (indistinguishable from sitemap hits
-- post-write), and none of discovered_page_count / sitemap_document_count /
-- fetched_page_count is a crawl count.
--
-- This migration is the expand phase only: a nullable column that the
-- dual-write, backfill and read-switch phases populate in their own PRs (one
-- phase per PR). NULL means "no crawl count recorded" — never zero.
ALTER TABLE website_site_scan
  ADD COLUMN crawl_discovered_count INTEGER
  CHECK (crawl_discovered_count IS NULL OR crawl_discovered_count >= 0);

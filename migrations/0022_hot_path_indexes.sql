-- Hot-path indexes from the 2026-06-11 launch audit (DB findings H1/H2).
-- Every query below previously full-scanned tables that grow per-send,
-- per-scan, or per-fetch. Additive only.

-- delivery_attempt: WhatsApp status webhook reconciliation, per-user and
-- per-watchlist list views, failure dashboards, digest-run lookups.
CREATE INDEX IF NOT EXISTS idx_delivery_attempt_provider_message
  ON delivery_attempt(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_attempt_user_created
  ON delivery_attempt(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_attempt_watchlist_created
  ON delivery_attempt(watchlist_id, created_at DESC)
  WHERE watchlist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_attempt_digest_run
  ON delivery_attempt(digest_run_id)
  WHERE digest_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_attempt_status_created
  ON delivery_attempt(status, created_at DESC);

-- Operator snapshot / canary queries.
CREATE INDEX IF NOT EXISTS idx_watchlist_run_status_started
  ON watchlist_run(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_fetch_log_status_created
  ON discovery_fetch_log(status, created_at DESC);

-- Dodo webhook user lookup compares email COLLATE NOCASE, which cannot use
-- the BINARY unique index on user.email.
CREATE INDEX IF NOT EXISTS idx_user_email_nocase
  ON user(email COLLATE NOCASE);

-- FK-support indexes: without these, deleting a watchlist_run (retention)
-- scans every child table per row.
CREATE INDEX IF NOT EXISTS idx_watch_event_run ON watch_event(run_id);
CREATE INDEX IF NOT EXISTS idx_watch_event_baseline_run
  ON watch_event(baseline_from_run_id) WHERE baseline_from_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_candidate_run ON event_candidate(run_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_run_baseline
  ON watchlist_run(baseline_from_run_id) WHERE baseline_from_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ad_observation_snapshot
  ON ad_observation(landing_page_snapshot_id) WHERE landing_page_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_digest_item_watchlist ON digest_item(watchlist_id);
CREATE INDEX IF NOT EXISTS idx_delivery_target_watchlist
  ON delivery_target(watchlist_id) WHERE watchlist_id IS NOT NULL;

-- Retention sweep support.
CREATE INDEX IF NOT EXISTS idx_discovery_cache_expires
  ON discovery_cache_entry(expires_at);

-- Bind evidence quota reservations to the durable watchlist-run lease that
-- owns the provider capture. Nullable ownership keeps historical/manual rows
-- compatible; reconciliation must never infer an owner from an idempotency key.
ALTER TABLE evidence_usage_reservation ADD COLUMN owner_run_id TEXT;
ALTER TABLE evidence_usage_reservation ADD COLUMN owner_processing_token TEXT;
ALTER TABLE evidence_usage_reservation ADD COLUMN owner_lease_seen_at TEXT;

CREATE INDEX IF NOT EXISTS idx_evidence_usage_reservation_stale_owner
  ON evidence_usage_reservation(status, expires_at, owner_run_id);

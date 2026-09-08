import type { DatabaseSync } from "node:sqlite";

export function seedPendingOrchestratedRun(
  sqlite: DatabaseSync,
  runId: string,
  options: {
    watchlistId?: string;
    userId?: string;
    plan?: string;
    queuePriority?: number;
    queuedAt?: string;
  } = {},
) {
  const watchlistId = options.watchlistId ?? "watch-1";
  const userId = options.userId ?? "user-1";
  const queuedAt = options.queuedAt ?? "2026-06-23T04:00:00.000Z";
  const queuePriority = options.queuePriority ?? 0;
  const plan = options.plan ?? "agency";
  const idempotencyKey = `watchlist-run:scheduled:${watchlistId}:test:${queuedAt.replace(/[^0-9a-z]/gi, "-")}`;

  sqlite.exec(`
    INSERT OR IGNORE INTO watchlist (
      id, user_id, name, target_type, target_id, target_fingerprint, target_label,
      is_active, created_at, updated_at
    ) VALUES (
      '${watchlistId}', '${userId}', 'Test watch', 'advertiser', 'target-1', 'fp-1', 'Target',
      1, '${queuedAt}', '${queuedAt}'
    );
    INSERT OR IGNORE INTO user_plan (user_id, plan) VALUES ('${userId}', '${plan}');
    INSERT OR REPLACE INTO watchlist_run (
      id, watchlist_id, trigger_type, status, page_budget, pages_scanned, summary_json,
      started_at, created_at, updated_at, idempotency_key, queued_at, attempt_count, queue_priority
    ) VALUES (
      '${runId}', '${watchlistId}', 'scheduled', 'pending', 2, 0, '{}',
      '${queuedAt}', '${queuedAt}', '${queuedAt}', '${idempotencyKey}', '${queuedAt}', 0, ${queuePriority}
    );
  `);
}

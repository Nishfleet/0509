import { ensureDb } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";

const ledgerSupport = new WeakMap<object, Promise<boolean>>();
const SAFE_SQL_REFERENCE = /^[a-z_][a-z0-9_.]*$/iu;

async function hasWebhookLedger(env: AppEnv) {
  const db = ensureDb(env);
  const key = db as object;
  const cached = ledgerSupport.get(key);
  if (cached) return cached;
  const check = db.prepare(`
      SELECT 1 AS present
      FROM sqlite_master
      WHERE type = 'table' AND name = 'dodo_webhook_event'
      LIMIT 1
    `).bind().all<{ present: number }>()
    .then((result) => result.results?.[0]?.present === 1);
  ledgerSupport.set(key, check);
  // A transient D1 failure must not pin the isolate: without this eviction
  // the rejected promise stays in the WeakMap for the binding's lifetime, so
  // every later canary-guarded billing write in this isolate throws. Delete
  // the cached entry on rejection so the next call re-probes; the rejection
  // still propagates to the caller (the guard does not fail open).
  check.catch(() => {
    ledgerSupport.delete(key);
  });
  return check;
}

/**
 * Returns an atomic SQL predicate only on databases that have the webhook
 * ledger migration. Pre-migration/local fixture databases remain usable; a
 * migrated database never performs the protected write outside this guard.
 */
export async function billingCanaryMutationGuardSql(
  env: AppEnv,
  userIdSqlReference: string,
) {
  if (userIdSqlReference !== "?" && !SAFE_SQL_REFERENCE.test(userIdSqlReference)) {
    throw new Error("Unsafe billing canary SQL reference.");
  }
  if (!(await hasWebhookLedger(env))) return "";
  return `
    AND NOT EXISTS (
      SELECT 1 FROM dodo_webhook_event AS canary_lock
      WHERE canary_lock.event_type = 'billing.canary.lock'
        AND canary_lock.user_id = ${userIdSqlReference}
        AND (
          json_extract(canary_lock.metadata_json, '$.action') = 'billing_canary_active'
          OR (
            canary_lock.outcome = 'processing'
            AND canary_lock.processing_started_at IS NOT NULL
            AND julianday('now') <= julianday(canary_lock.processing_started_at) + (5.0 / 1440.0)
          )
        )
    )
  `;
}

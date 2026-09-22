import type { TakedownParams } from "../workflows/takedown";

export const RECONCILIATION_UTC_HOUR = 3;

interface UnfannedTakedown {
  id: string;
}

interface ReconcileEnv {
  DB: D1Database;
  TAKEDOWN_WORKFLOW: Workflow<TakedownParams>;
}

const SELECT_UNFANNED = `SELECT id FROM takedown WHERE fanned_out_at IS NULL AND actioned_at IS NOT NULL ORDER BY actioned_at ASC`;

const CLAIM_NEXT_ATTEMPT = `UPDATE takedown
SET fan_out_attempts = fan_out_attempts + 1
WHERE id = ? AND fanned_out_at IS NULL
RETURNING fan_out_attempts AS attempt`;

function instanceId(takedownId: string, attempt: number): string {
  return `${takedownId}-${String(attempt)}`;
}

function atReconciliationHour(scheduledFor: Date): boolean {
  if (scheduledFor.getUTCHours() !== RECONCILIATION_UTC_HOUR) return false;
  return scheduledFor.getUTCMinutes() < 5;
}

async function claimNextAttempt(env: ReconcileEnv, takedownId: string): Promise<number | null> {
  const row = await env.DB.prepare(CLAIM_NEXT_ATTEMPT).bind(takedownId).first<{ attempt: number }>();
  return row?.attempt ?? null;
}

export async function reconcileUnfannedTakedowns(env: ReconcileEnv): Promise<string[]> {
  const rows = await env.DB.prepare(SELECT_UNFANNED).all<UnfannedTakedown>();
  const ids = (rows.results ?? []).map((row) => row.id);
  const reran: string[] = [];
  const failures: string[] = [];

  for (const takedownId of ids) {
    try {
      const attempt = await claimNextAttempt(env, takedownId);
      if (attempt === null) continue;
      await env.TAKEDOWN_WORKFLOW.create({
        id: instanceId(takedownId, attempt),
        params: { takedownId },
      });
      reran.push(takedownId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${takedownId}: ${reason}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`takedown reconciliation failed: ${failures.join("; ")}`);
  }

  return reran;
}

export async function runNightlyReconciliation(
  env: ReconcileEnv,
  scheduledFor: Date,
): Promise<boolean> {
  if (!atReconciliationHour(scheduledFor)) return false;
  await reconcileUnfannedTakedowns(env);
  return true;
}

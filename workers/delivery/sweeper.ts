export const NIGHTLY_CRON = "0 3 * * *";

export interface SweepResult {
  digests: number;
  attempts: number;
  enqueued: number;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const BATCH_LIMIT = 100;

export async function sweepPending(env: Env, now: Date): Promise<SweepResult> {
  const digestCutoff = new Date(now.getTime() - SIX_HOURS_MS).toISOString();
  const attemptCutoff = new Date(now.getTime() - ONE_HOUR_MS).toISOString();
  const staleAfter = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString();

  const digestRows = await env.DB.prepare(
    `SELECT id FROM digest WHERE status = 'pending' AND period_end < ? AND period_end >= ?`,
  )
    .bind(digestCutoff, staleAfter)
    .all<{ id: string }>();
  const digestIds = digestRows.results.map((row) => row.id);

  const attemptRows = await env.DB.prepare(
    `SELECT DISTINCT a.digest_id FROM send_attempt a
     JOIN digest d ON d.id = a.digest_id
     WHERE a.status = 'pending' AND a.attempted_at < ? AND d.status <> 'failed' AND d.period_end >= ?`,
  )
    .bind(attemptCutoff, staleAfter)
    .all<{ digest_id: string }>();
  const attemptIds = attemptRows.results.map((row) => row.digest_id);

  const merged = [...new Set([...digestIds, ...attemptIds])];

  for (let start = 0; start < merged.length; start += BATCH_LIMIT) {
    const chunk = merged.slice(start, start + BATCH_LIMIT);
    await env.SEND_EMAIL.sendBatch(chunk.map((digest_id) => ({ body: { digest_id } })));
  }

  const result: SweepResult = {
    digests: digestIds.length,
    attempts: attemptIds.length,
    enqueued: merged.length,
  };
  console.log(JSON.stringify({ event: "delivery.sweep", ...result }));
  return result;
}

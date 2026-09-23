export const NIGHTLY_CRON = "0 3 * * *";

export interface SweepResult {
  digests: number;
  attempts: number;
  enqueued: number;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const BATCH_LIMIT = 100;

export async function sweepPending(env: Env, now: Date): Promise<SweepResult> {
  const digestCutoff = new Date(now.getTime() - SIX_HOURS_MS).toISOString();
  const attemptCutoff = new Date(now.getTime() - ONE_HOUR_MS).toISOString();

  const digestRows = await env.DB.prepare(
    `SELECT id FROM digest WHERE status = 'pending' AND period_end < ?`,
  )
    .bind(digestCutoff)
    .all<{ id: string }>();
  const digestIds = (digestRows.results ?? []).map((row) => row.id);

  const attemptRows = await env.DB.prepare(
    `SELECT DISTINCT digest_id FROM send_attempt WHERE status = 'pending' AND attempted_at < ? AND digest_id IS NOT NULL`,
  )
    .bind(attemptCutoff)
    .all<{ digest_id: string }>();
  const attemptIds = (attemptRows.results ?? []).map((row) => row.digest_id);

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

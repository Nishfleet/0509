import type { AppEnv } from "~/lib/env.server";

/**
 * Decodo monthly budget helper (seam #2218, wired by #2181).
 *
 * Decodo's free tier has two monthly quotas:
 *   - standard scraper: 1,800 requests/month
 *   - JS renderer:       800 requests/month
 *
 * Counters live in the DECODO_BUDGET KV namespace with UTC-month keys:
 *   decodo:std:YYYY-MM
 *   decodo:js:YYYY-MM
 *
 * `reserve` does a check-then-increment. KV is eventually consistent for
 * reads, so this is a best-effort gate against the free quota — it is not a
 * hard transactional limit. The issue explicitly asks for no paid upgrades
 * or payments; this is a free-quota mechanism only.
 *
 * When DECODO_BUDGET is absent (the binding is not wired yet), `reserve`
 * returns `{ ok: true }` — the helper does not block until #2181 wires KV.
 */

export type DecodoBucket = "std" | "js";

export const DECODO_LIMITS: Record<DecodoBucket, number> = {
  std: 1_800,
  js: 800,
};

export interface DecodoReservationResult {
  ok: boolean;
  reason?: "quota" | "no_kv";
  used?: number;
  limit?: number;
}

function utcMonthKey(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function kvKey(bucket: DecodoBucket, date: Date = new Date()): string {
  return `decodo:${bucket}:${utcMonthKey(date)}`;
}

export async function reserveDecodoBudget(
  env: AppEnv,
  bucket: DecodoBucket,
  date: Date = new Date(),
): Promise<DecodoReservationResult> {
  const kv = env.DECODO_BUDGET;
  if (!kv) {
    return { ok: true, reason: "no_kv" };
  }

  const key = kvKey(bucket, date);
  const limit = DECODO_LIMITS[bucket];
  const current = Number((await kv.get(key)) ?? 0);

  if (current >= limit) {
    return { ok: false, reason: "quota", used: current, limit };
  }

  const next = current + 1;
  // KV put with a 35-day TTL so stale counters expire after the month ends.
  await kv.put(key, String(next), { expirationTtl: 35 * 24 * 60 * 60 });
  return { ok: true, used: next, limit };
}

export async function getDecodoBudgetUsage(
  env: AppEnv,
  bucket: DecodoBucket,
  date: Date = new Date(),
): Promise<{ used: number; limit: number }> {
  const kv = env.DECODO_BUDGET;
  if (!kv) {
    return { used: 0, limit: DECODO_LIMITS[bucket] };
  }
  const used = Number((await kv.get(kvKey(bucket, date))) ?? 0);
  return { used, limit: DECODO_LIMITS[bucket] };
}

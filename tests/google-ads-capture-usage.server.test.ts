import { describe, expect, it } from "vitest";

import {
  getGoogleAdsCaptureStats24h,
  recordGoogleAdsCaptureAttempt,
} from "~/lib/sources/google-ads/google-ads-usage.server";
import type { AppEnv } from "~/lib/env.server";

/**
 * Google Ads (Transparency Center) capture counters — issue #3197.
 *
 * Mirrors tests/decodo-budget.server.test.ts: the #2181 KV-budget pattern,
 * counted best-effort, one day key per UTC day. These counters are the /status
 * capture-failure rate's denominator, so the rate must come from REAL recorded
 * attempts (never fabricated) and read 0/0 (not 0%) when nothing was
 * attempted.
 */

/** Minimal in-memory KVNamespace stub — same shape as the #2181 test's. */
function makeKv() {
  const store = new Map<string, { value: string; expirationTtl?: number }>();
  return {
    store,
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      store.set(key, { value, expirationTtl: options?.expirationTtl });
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function envWithKv(kv: KVNamespace): AppEnv {
  return { DECODO_BUDGET: kv } satisfies Partial<AppEnv> as AppEnv;
}

function nowIso10(now: Date = new Date()): string {
  return `google_ads:captures:${now.toISOString().slice(0, 10)}`;
}

describe("Google Ads capture counters (issue #3197)", () => {
  it("records one attempt per call and counts failures, never blocking", async () => {
    const kv = makeKv();
    const env = envWithKv(kv);
    const now = new Date("2026-09-13T10:00:00.000Z"); // fixed-date: #3215 sweep convention

    await recordGoogleAdsCaptureAttempt(env, { failed: false }, now);
    await recordGoogleAdsCaptureAttempt(env, { failed: true }, now);
    await recordGoogleAdsCaptureAttempt(env, { failed: true }, now);

    const stored = JSON.parse(
      (await kv.get(nowIso10(now)) as string) ?? "{}",
    ) as { attempted: number; failed: number };
    expect(stored.attempted).toBe(3);
    expect(stored.failed).toBe(2);

    // TTL: the day counter expires after 35 days, like the #2181 month keys.
    expect((kv.store.get(nowIso10(now))?.expirationTtl) ?? 0).toBe(35 * 24 * 60 * 60);
  });

  it("reports the 24h rate across today's and yesterday's UTC day counters", async () => {
    const kv = makeKv();
    const env = envWithKv(kv);
    const now = new Date("2026-09-13T10:00:00.000Z"); // fixed-date: #3215 sweep convention
    const yesterday = new Date("2026-09-12T10:00:00.000Z"); // fixed-date: #3215 sweep convention

    await recordGoogleAdsCaptureAttempt(env, { failed: true }, yesterday);
    await recordGoogleAdsCaptureAttempt(env, { failed: false }, now);
    await recordGoogleAdsCaptureAttempt(env, { failed: false }, now);
    await recordGoogleAdsCaptureAttempt(env, { failed: true }, now);

    const stats = await getGoogleAdsCaptureStats24h(env, now);
    expect(stats.counted).toBe(true);
    expect(stats.attempted).toBe(4);
    expect(stats.failed).toBe(2);
    expect(stats.rate).toBeCloseTo(0.5);
  });

  it("reports rate null when nothing was attempted — no fabricated 0%", async () => {
    const env = envWithKv(makeKv());
    const stats = await getGoogleAdsCaptureStats24h(env, new Date("2026-09-13T10:00:00.000Z"));
    expect(stats.counted).toBe(true);
    expect(stats.attempted).toBe(0);
    expect(stats.rate).toBeNull();
  });

  it("is not counted when the DECODO_BUDGET binding is absent (nothing written, nothing read)", async () => {
    const env = {} satisfies Partial<AppEnv> as AppEnv;
    await recordGoogleAdsCaptureAttempt(env, { failed: true });
    const stats = await getGoogleAdsCaptureStats24h(env, new Date("2026-09-13T10:00:00.000Z"));
    expect(stats.counted).toBe(false);
    expect(stats.attempted).toBe(0);
    expect(stats.rate).toBeNull();
  });

  it("keeps working when a stored day counter is unreadable (best-effort)", async () => {
    const kv = makeKv();
    const env = envWithKv(kv);
    const now = new Date("2026-09-13T10:00:00.000Z"); // fixed-date: #3215 sweep convention
    await kv.put(nowIso10(now), "{not json", {});
    await recordGoogleAdsCaptureAttempt(env, { failed: true }, now);

    const stored = JSON.parse((await kv.get(nowIso10(now)) ?? "{}") as string) as {
      attempted: number;
      failed: number;
    };
    expect(stored).toEqual({ attempted: 1, failed: 1 });
    expect((await getGoogleAdsCaptureStats24h(env, now)).attempted).toBe(1);
  });
});

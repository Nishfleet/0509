import { describe, expect, it } from "vitest";

import {
  getLinkedInAdsCaptureStats24h,
  recordLinkedInAdsCaptureAttempt,
} from "~/lib/sources/linkedin-ads/linkedin-ads-usage.server";
import type { AppEnv } from "~/lib/env.server";

/**
 * LinkedIn Ads (Ad Library) capture counters — issue #3196.
 *
 * Mirrors the #3197 google-ads-capture-usage test: the #2181 KV-budget
 * pattern, counted best-effort, one day key per UTC day. These counters are
 * the /status capture-failure rate's denominator, so the rate must come from
 * REAL recorded attempts (never fabricated) and read 0/0 (not 0%) when
 * nothing was attempted.
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

function linkedinDayKey(now: Date = new Date()): string {
  return `linkedin_ads:captures:${now.toISOString().slice(0, 10)}`;
}

describe("LinkedIn Ads capture counters (issue #3196)", () => {
  it("records one attempt per Library read and counts failures, never blocking", async () => {
    const kv = makeKv();
    const env = envWithKv(kv);
    const now = new Date("2026-09-13T10:00:00.000Z"); // fixed-date: #3215 sweep convention

    await recordLinkedInAdsCaptureAttempt(env, { failed: false }, now);
    await recordLinkedInAdsCaptureAttempt(env, { failed: true }, now);
    await recordLinkedInAdsCaptureAttempt(env, { failed: true }, now);

    const stored = JSON.parse(
      (await kv.get(linkedinDayKey(now)) as string) ?? "{}",
    ) as { attempted: number; failed: number };
    expect(stored.attempted).toBe(3);
    expect(stored.failed).toBe(2);

    // TTL: the day counter expires after 35 days, like the #2181 month keys.
    expect((kv.store.get(linkedinDayKey(now))?.expirationTtl) ?? 0).toBe(35 * 24 * 60 * 60);
  });

  it("reports the 24h rate across today's and yesterday's UTC day counters", async () => {
    const kv = makeKv();
    const env = envWithKv(kv);
    const now = new Date("2026-09-13T10:00:00.000Z"); // fixed-date: #3215 sweep convention
    const yesterday = new Date("2026-09-12T10:00:00.000Z"); // fixed-date: #3215 sweep convention

    await recordLinkedInAdsCaptureAttempt(env, { failed: true }, yesterday);
    await recordLinkedInAdsCaptureAttempt(env, { failed: false }, now);
    await recordLinkedInAdsCaptureAttempt(env, { failed: false }, now);
    await recordLinkedInAdsCaptureAttempt(env, { failed: true }, now);

    const stats = await getLinkedInAdsCaptureStats24h(env, now);
    expect(stats.counted).toBe(true);
    expect(stats.attempted).toBe(4);
    expect(stats.failed).toBe(2);
    expect(stats.rate).toBeCloseTo(0.5);
  });

  it("reports rate null when nothing was attempted — no fabricated 0%", async () => {
    const env = envWithKv(makeKv());
    const stats = await getLinkedInAdsCaptureStats24h(env, new Date("2026-09-13T10:00:00.000Z")); // fixed-date: #3215 sweep convention
    expect(stats.counted).toBe(true);
    expect(stats.attempted).toBe(0);
    expect(stats.rate).toBeNull();
  });

  it("is not counted when the DECODO_BUDGET binding is absent (nothing written, nothing read)", async () => {
    const env = {} satisfies Partial<AppEnv> as AppEnv;
    await recordLinkedInAdsCaptureAttempt(env, { failed: true });
    const stats = await getLinkedInAdsCaptureStats24h(env, new Date("2026-09-13T10:00:00.000Z")); // fixed-date: #3215 sweep convention
    expect(stats.counted).toBe(false);
    expect(stats.attempted).toBe(0);
    expect(stats.rate).toBeNull();
  });

  it("keeps working when a stored day counter is unreadable (best-effort)", async () => {
    const kv = makeKv();
    const env = envWithKv(kv);
    const now = new Date("2026-09-13T10:00:00.000Z"); // fixed-date: #3215 sweep convention
    await kv.put(linkedinDayKey(now), "{not json", {});
    await recordLinkedInAdsCaptureAttempt(env, { failed: true }, now);

    const stored = JSON.parse((await kv.get(linkedinDayKey(now)) ?? "{}") as string) as {
      attempted: number;
      failed: number;
    };
    expect(stored).toEqual({ attempted: 1, failed: 1 });
    expect((await getLinkedInAdsCaptureStats24h(env, now)).attempted).toBe(1);
  });
});

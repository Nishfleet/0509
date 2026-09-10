import { describe, expect, it } from "vitest";

import {
  DECODO_LIMITS,
  getDecodoBudgetUsage,
  reserveDecodoBudget,
} from "~/lib/decodo-budget.server";
import type { AppEnv } from "~/lib/env.server";

/** Minimal in-memory KVNamespace stub for the budget helper. */
function makeKv() {
  const store = new Map<string, { value: string; expirationTtl?: number }>();
  return {
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
  return {
    META_TOKEN_ENCRYPTION_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "https://0509.io",
    DECODO_BUDGET: kv,
  } satisfies Partial<AppEnv> as AppEnv;
}

function envWithoutKv(): AppEnv {
  return {
    META_TOKEN_ENCRYPTION_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "https://0509.io",
  } satisfies Partial<AppEnv> as AppEnv;
}

describe("decodo budget", () => {
  it("exposes the free-tier limits", () => {
    expect(DECODO_LIMITS.std).toBe(1_800);
    expect(DECODO_LIMITS.js).toBe(800);
  });

  it("returns ok when no KV binding is present (no_kv)", async () => {
    const result = await reserveDecodoBudget(envWithoutKv(), "std");
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("no_kv");
  });

  it("increments the counter on each reserve", async () => {
    const kv = makeKv();
    const env = envWithKv(kv);
    const r1 = await reserveDecodoBudget(env, "std");
    const r2 = await reserveDecodoBudget(env, "std");
    expect(r1.ok).toBe(true);
    expect(r1.used).toBe(1);
    expect(r2.ok).toBe(true);
    expect(r2.used).toBe(2);
  });

  it("denies with reason quota when the limit is reached", async () => {
    const kv = makeKv();
    const env = envWithKv(kv);
    // Pre-fill the counter at the limit.
    await kv.put("decodo:std:2026-09", String(DECODO_LIMITS.std));
    const result = await reserveDecodoBudget(env, "std", new Date("2026-09-15T00:00:00Z"));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("quota");
    expect(result.used).toBe(DECODO_LIMITS.std);
    expect(result.limit).toBe(DECODO_LIMITS.std);
  });

  it("uses separate counters for std and js buckets", async () => {
    const kv = makeKv();
    const env = envWithKv(kv);
    await reserveDecodoBudget(env, "std");
    await reserveDecodoBudget(env, "js");
    const stdUsage = await getDecodoBudgetUsage(env, "std");
    const jsUsage = await getDecodoBudgetUsage(env, "js");
    expect(stdUsage.used).toBe(1);
    expect(jsUsage.used).toBe(1);
    expect(stdUsage.limit).toBe(DECODO_LIMITS.std);
    expect(jsUsage.limit).toBe(DECODO_LIMITS.js);
  });

  it("getDecodoBudgetUsage returns zero when no KV binding", async () => {
    const usage = await getDecodoBudgetUsage(envWithoutKv(), "js");
    expect(usage.used).toBe(0);
    expect(usage.limit).toBe(DECODO_LIMITS.js);
  });
});

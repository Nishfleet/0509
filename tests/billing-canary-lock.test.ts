import { describe, expect, it } from "vitest";

import {
  billingCanaryLockBelongsToUser,
  billingCanaryLockPrefixForUser,
  buildBillingCanaryLockId,
} from "~/lib/billing-canary-lock";
import { billingCanaryMutationGuardSql } from "~/lib/data/billing-canary-lock.server";
import type { AppEnv } from "~/lib/env.server";

describe("billing canary lock identity", () => {
  it("normalizes one shared user-scoped lock contract", () => {
    expect(billingCanaryLockPrefixForUser(" User_1 ")).toBe("billing-canary-lock:user-1:");
    expect(buildBillingCanaryLockId(" User_1 ", "ABC/123")).toBe(
      "billing-canary-lock:user-1:abc-123",
    );
    expect(buildBillingCanaryLockId("", "")).toBe("billing-canary-lock:unknown:unknown");
  });

  it("rejects missing and foreign-user lock identities", () => {
    expect(billingCanaryLockBelongsToUser("billing-canary-lock:user-1:nonce", "user-1"))
      .toBe(true);
    expect(billingCanaryLockBelongsToUser("billing-canary-lock:user-10:nonce", "user-1"))
      .toBe(false);
    expect(billingCanaryLockBelongsToUser(null, "user-1")).toBe(false);
  });
});

describe("billing canary probe cache eviction on rejection", () => {
  // The probe promise is cached in a module-level WeakMap keyed by the D1
  // binding object. A transient D1 failure must not pin the isolate: the
  // cached rejection has to be evicted so the next call re-probes. This
  // test fails on main (the second call rethrows the cached rejection) and
  // passes once the probe evicts on rejection.
  it("re-probes after a rejected probe instead of caching the rejection", async () => {
    let probeCalls = 0;
    const transient = new Error("transient D1 failure");
    const db = {
      prepare(_sql: string) {
        return {
          bind(..._bindings: unknown[]) {
            return {
              all<T>() {
                probeCalls += 1;
                if (probeCalls === 1) {
                  return Promise.reject(transient);
                }
                return Promise.resolve({
                  results: [{ present: 1 }],
                }) as Promise<{ results: T[] }>;
              },
            };
          },
        };
      },
    };
    const env = { DB: db } as unknown as AppEnv;

    // First call: the probe rejects, and the guard propagates the failure
    // (it does not fail open).
    await expect(billingCanaryMutationGuardSql(env, "?")).rejects.toBe(transient);

    // Second call: the cached rejection was evicted, so the probe re-runs
    // and succeeds. The guard returns its SQL predicate because the ledger
    // table is present.
    const guard = await billingCanaryMutationGuardSql(env, "?");
    expect(probeCalls).toBe(2);
    expect(guard).toContain("dodo_webhook_event");
  });

  it("caches a successful probe so concurrent calls share one probe", async () => {
    let probeCalls = 0;
    const db = {
      prepare(_sql: string) {
        return {
          bind(..._bindings: unknown[]) {
            return {
              all<T>() {
                probeCalls += 1;
                return Promise.resolve({
                  results: [{ present: 0 }],
                }) as Promise<{ results: T[] }>;
              },
            };
          },
        };
      },
    };
    const env = { DB: db } as unknown as AppEnv;

    // Table absent -> guard short-circuits to "" (no ledger support).
    expect(await billingCanaryMutationGuardSql(env, "?")).toBe("");
    // A second call reuses the cached successful probe (no re-probe).
    expect(await billingCanaryMutationGuardSql(env, "?")).toBe("");
    expect(probeCalls).toBe(1);
  });
});

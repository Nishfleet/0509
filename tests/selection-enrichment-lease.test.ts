import { describe, expect, it, vi } from "vitest";

/**
 * Issue #3782 — the per-ad enrichment lease as a Durable Object. Driven with
 * a fake DurableObjectState so the claim/release semantics run under plain
 * node; `transaction` executes synchronously like workerd's storage txn, and
 * the `cloudflare:workers` base class is a stub (the same module mock the
 * ad-source tests use).
 */
vi.doMock("cloudflare:workers", () => ({
  DurableObject: class DurableObject {
    ctx: { storage: unknown };
    env: unknown;
    constructor(ctx: { storage: unknown }, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

async function makeLease() {
  const { SelectionEnrichmentLease } = await import("../workers/selection-enrichment-lease");
  const data = new Map<string, unknown>();
  const storage = {
    get: vi.fn(async (key: string) => data.get(key)),
    put: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
      return true;
    }),
    transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };
  const lease = new SelectionEnrichmentLease({ storage } as never, {} as never);
  return { lease, storage, data };
}

function acquire(lease: { fetch: (r: Request) => Promise<Response> }, ttlMs = 90_000) {
  return lease.fetch(
    new Request("https://selection-lease.0509.internal/acquire", {
      method: "POST",
      body: JSON.stringify({ ttlMs }),
    }),
  );
}

describe("SelectionEnrichmentLease", () => {
  it("grants the first acquire and refuses a second inside the TTL", async () => {
    const { lease } = await makeLease();
    expect(await (await acquire(lease)).json()).toEqual({ claimed: true });
    expect(await (await acquire(lease)).json()).toEqual({ claimed: false });
  });

  it("lets the next claimant in after the lease expires", async () => {
    vi.useFakeTimers();
    try {
      const { lease } = await makeLease();
      expect(await (await acquire(lease, 1_000)).json()).toEqual({ claimed: true });
      vi.advanceTimersByTime(1_001);
      expect(await (await acquire(lease, 1_000)).json()).toEqual({ claimed: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases early so the next acquire wins immediately", async () => {
    const { lease } = await makeLease();
    expect(await (await acquire(lease)).json()).toEqual({ claimed: true });
    await lease.fetch(
      new Request("https://selection-lease.0509.internal/release", { method: "POST" }),
    );
    expect(await (await acquire(lease)).json()).toEqual({ claimed: true });
  });

  it("clamps an oversized ttlMs and rejects unknown routes", async () => {
    const { lease, data } = await makeLease();
    expect(await (await acquire(lease, 60 * 60 * 1000)).json()).toEqual({ claimed: true });
    // ttlMs was clamped to the 10-minute ceiling, not the hour requested.
    expect((data.get("lockedUntil") as number) - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    const missing = await lease.fetch(
      new Request("https://selection-lease.0509.internal/nope"),
    );
    expect(missing.status).toBe(404);
  });
});

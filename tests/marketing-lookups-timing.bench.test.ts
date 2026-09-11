import { describe, expect, it, vi } from "vitest";

// Timing probe for issue #2951 (not a gate): measures loader SSR wait with
// synthetic D1 latencies swapped into the loader's two lookups.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DELAY_A = 120; // change mark read
const DELAY_B = 180; // ads links read

vi.mock("~/lib/public-change-mark.server", () => ({
  loadPublicChangeMark: async () => {
    await sleep(DELAY_A);
    return null;
  },
}));
vi.mock("~/lib/ads-internal-links.server", () => ({
  loadIndexableAdsInternalLinks: async () => {
    await sleep(DELAY_B);
    return [];
  },
}));
vi.mock("~/lib/context.server", () => ({ getEnv: () => ({}) }));
vi.mock("~/lib/commercial-launch-gate.server", () => ({
  publicCommercialLaunchSummary: () => ({
    scoutSaleOpen: false,
    starterSaleOpen: false,
    agencySaleOpen: false,
  }),
}));
vi.mock("~/lib/funnel-measurement.server", () => ({
  emitFunnelHomeView: () => {},
}));

describe("loader timings (synthetic D1 latencies)", () => {
  it("reports", async () => {
    const marketing = await import("~/routes/marketing");
    const call = () =>
      marketing.loader({
        context: { cloudflare: { env: {} } },
        request: new Request("https://0509.io/"),
      } as never);
    // warm the module tree
    await call();
    const t0 = performance.now();
    await call();
    const t1 = performance.now();
    const duration = t1 - t0;
    expect(duration).toBeGreaterThan(DELAY_B);
    expect(duration).toBeLessThan(DELAY_A + DELAY_B + 100); // parallel: not the sum
    // Also assert explicitly so the timing evidence shows in the test name.
    expect(duration).toBeLessThan(DELAY_A + DELAY_B);
    process.stdout.write(
      `#2951 timing: loader lookup wall-clock = ${duration.toFixed(0)}ms (sequential bound ${(DELAY_A + DELAY_B).toFixed(0)}ms, parallel bound ${DELAY_B}ms)\n`,
    );
  });
});

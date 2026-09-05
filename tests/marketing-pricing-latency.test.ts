import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("marketing pricing latency", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns the homepage loader without waiting for a Dodo preview", async () => {
    const previewDodo0509PlanPrices = vi.fn(
      () => new Promise<never>(() => {}),
    );
    const commercialLaunch = {
      scoutSaleOpen: true,
      starterSaleOpen: true,
      agencySaleOpen: false,
    };
    const publicCommercialLaunchSummary = vi.fn(() => commercialLaunch);

    vi.doMock("~/lib/dodo-pricing.server", () => ({ previewDodo0509PlanPrices }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_API_KEY: "provider-key" })),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({ publicCommercialLaunchSummary }));

    const { loader } = await import("~/routes/marketing");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("marketing loader waited for pricing preview")),
        250,
      );
    });

    try {
      const result = await Promise.race([
        loader({
          context: { cloudflare: { env: {} } },
          request: new Request("http://localhost/"),
        } as never),
        timeoutPromise,
      ]);

      expect(result).toEqual({
        pricingPreview: { available: false },
        commercialLaunch,
      });
      expect(previewDodo0509PlanPrices).not.toHaveBeenCalled();
      expect(publicCommercialLaunchSummary).toHaveBeenCalledWith({
        DODO_0509_API_KEY: "provider-key",
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  });
});

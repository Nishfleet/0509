import { afterEach, describe, expect, it, vi } from "vitest";

describe("playwright failOnFlakyTests", () => {
  afterEach(() => {
    delete process.env.CI;
    vi.resetModules();
  });

  const loadConfig = async (ci: string | undefined) => {
    vi.resetModules();
    if (ci === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = ci;
    }
    return (await import("../playwright.config")).default;
  };

  it("fails a pass that only came after a retry in CI", { timeout: 60_000 }, async () => {
    const config = await loadConfig("true");
    expect(config.failOnFlakyTests).toBe(true);
  });

  it("does not fail a retry on a developer machine", { timeout: 60_000 }, async () => {
    const config = await loadConfig(undefined);
    expect(config.failOnFlakyTests).toBe(false);
  });

  it("keeps the retries that capture the trace and the artifacts", { timeout: 60_000 }, async () => {
    const config = await loadConfig("true");
    expect(config.retries).toBe(2);
    expect(config.use?.trace).toBe("on-first-retry");
  });
});

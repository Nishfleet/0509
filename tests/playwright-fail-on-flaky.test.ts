import { afterEach, describe, expect, it, vi } from "vitest";

// #7012: `retries: process.env.CI ? 2 : 0` counted a spec that failed once and
// passed on the retry as green in the required preview-assert job, and nothing
// in .github/ or the config failed on that. The flake then stayed hidden until
// it failed three times in a row in the queue.
//
// Playwright has shipped the stock answer the whole time: --fail-on-flaky-tests
// on the CLI since 1.45 and TestConfig.failOnFlakyTests since 1.52, and this
// repo pins @playwright/test ^1.63.0. The option is set next to `retries`, so
// the retries stay: their job is to capture the trace and the artifacts, and
// only then does the run fail.
//
// The real playwright.config.ts is imported rather than a restated copy,
// because a copy would pass forever against a file that moved on. It is loaded
// once per CI value, because the setting has to follow process.env.CI: locally
// a retry is a convenience, in CI it is a hidden flake.
//
// The explicit timeout is the cost of loading this repo's real config, the same
// one the eslint-rule tests carry: a cold import of @playwright/test took 5.8 s
// on a checkout sharing a host with other workers and blew the 5 s default. The
// import is the assertion, so its cost belongs to the test, not to a retry.

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

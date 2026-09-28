import { readdirSync } from "node:fs";

import { experimental_readRawConfig } from "wrangler";
import { describe, expect, it } from "vitest";

import { SITE_SWEEP_UTC_HOUR } from "../app/lib/home-standing";

// #4631, and 225c3eb before it: the production CLOUDFLARE_API_TOKEN cannot reach
// the KV namespaces endpoint, so a KV binding without an id sends wrangler to
// deploy-time provisioning and the deploy fails with auth error 10000. Pin the
// id of an existing namespace instead.
const CONFIGS = [
  "wrangler.jsonc",
  ...readdirSync("workers")
    .filter((name) => name.endsWith(".wrangler.jsonc"))
    .map((name) => `workers/${name}`),
];

describe("deployed wrangler configs", () => {
  it.each(CONFIGS)("%s pins an id on every KV namespace", (config) => {
    const { rawConfig } = experimental_readRawConfig({ config });
    const unpinned = (rawConfig.kv_namespaces ?? [])
      .filter((namespace) => !namespace.id)
      .map((namespace) => namespace.binding);
    expect(unpinned).toEqual([]);
  });

  it("schedules the site-sweep Workflow on the hour Home names for the first snapshots", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    const siteSweep = (rawConfig.workflows ?? []).find((workflow) => workflow.name === "site-sweep");
    expect(siteSweep).toBeDefined();
    expect(siteSweep?.schedules).toEqual(["0 " + String(SITE_SWEEP_UTC_HOUR) + " * * *"]);
  });

  // 0509#5758. Without these the paid defaults apply: 30,000 ms of CPU and
  // 10,000 subrequests per invocation, so a runaway path runs to a full
  // core-second. The caps are sized from workersInvocationsAdaptive for script
  // 0509 over 2026-09-21..28 (cpuTime p50 11.4 ms, p99 86.9 ms, p99.9
  // 1,085.6 ms, 0.15 subrequests per invocation). Asserted, not just declared:
  // a rename or a deletion of the block turns this red.
  it("caps CPU and subrequests below the paid defaults (0509#5758)", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    const limits = rawConfig.limits;
    expect(limits).toBeDefined();
    // Above the measured p99.9 (1,085.6 ms) so the tail stays watchable
    // rather than becoming a 5xx, and below the 30,000 ms paid default.
    expect(limits?.cpu_ms).toBeGreaterThan(1_086);
    expect(limits?.cpu_ms).toBeLessThan(30_000);
    expect(limits?.subrequests).toBe(10_000);
  });

  // 0509#5758. The whole logs policy has to be in wrangler.jsonc: an
  // undeclared head_sampling_rate means the log bill is whatever the platform
  // default is today, and docs/REBUILD-DONE.md's p95-per-route performance
  // gate is measured from these logs. 1.0 is a deliberate choice here, not a
  // default, because the invocation log is what the per-route measurement
  // reads.
  it("declares the Workers Logs policy (0509#5758)", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    expect(rawConfig.observability?.enabled).toBe(true);
    expect(rawConfig.observability?.logs?.head_sampling_rate).toBe(1);
    expect(rawConfig.observability?.logs?.invocation_logs).toBe(true);
    expect(rawConfig.observability?.logs?.persist).toBe(true);
  });
});

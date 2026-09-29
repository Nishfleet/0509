import { readdirSync } from "node:fs";

import { experimental_readRawConfig } from "wrangler";
import { describe, expect, it } from "vitest";

import {
  D1_DATABASE_ID,
  SNAPSHOT_BUCKET,
} from "../app/lib/observability/cost-analytics.server";

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

  it("schedules the snapshot-backup Workflow every night at 05:00 UTC", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    const snapshotBackup = (rawConfig.workflows ?? []).find((workflow) => workflow.name === "snapshot-backup");
    expect(snapshotBackup).toBeDefined();
    expect(snapshotBackup?.schedules).toEqual(["0 5 * * *"]);
  });

  // The cost guard queries Cloudflare analytics for the same database and bucket
  // wrangler deploys; the constants in cost-analytics.server.ts must not drift
  // from the config or the guard silently reads a different resource.
  it("keeps the cost-guard constants equal to the deployed DB and bucket", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    const db = (rawConfig.d1_databases ?? []).find((database) => database.binding === "DB");
    const bucket = (rawConfig.r2_buckets ?? []).find((b) => b.binding === "SNAPSHOTS");
    expect(db?.database_id).toBe(D1_DATABASE_ID);
    expect(bucket?.bucket_name).toBe(SNAPSHOT_BUCKET);
  });

  // 0509#5758. Without these the paid defaults apply: 30,000 ms of CPU and
  // 10,000 subrequests per invocation, so a runaway path runs to a full
  // core-second. The cap is sized from workersInvocationsAdaptive for script
  // 0509 over 2026-09-21T00:00Z..2026-09-28T12:00Z (238,690 invocations,
  // cpuTime p50 11.4 ms, p99 86.5 ms, p99.9 1,075.6 ms, and a 3,637 ms
  // slowest invocation). Asserted, not just declared: a rename or a deletion of
  // the block turns this red, and the floor is the slowest observation, so a
  // cap below any invocation seen here cannot pass.
  it("caps CPU and subrequests below the paid defaults (0509#5758)", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    const limits = rawConfig.limits;
    expect(limits).toBeDefined();
    // Above the measured p99.9 and above the slowest invocation in the window
    // (3,637 ms), so the observed tail stays inside the cap while the paid
    // default of 30,000 ms does not apply. Both constants come from the
    // `workersInvocationsAdaptive` read quoted in wrangler.jsonc: pinning the
    // slowest one keeps an edit to `cpu_ms: 2000` red, where a p99.9-only floor
    // would let it through.
    const MEASURED_CPU_SLOWEST_MS = 3_637;
    const MEASURED_CPU_P99_9_MS = 1_076;
    const PAID_DEFAULT_CPU_MS = 30_000;
    expect(limits?.cpu_ms).toBeGreaterThan(MEASURED_CPU_P99_9_MS);
    expect(limits?.cpu_ms).toBeGreaterThan(MEASURED_CPU_SLOWEST_MS);
    expect(limits?.cpu_ms).toBeLessThan(PAID_DEFAULT_CPU_MS);
    expect(limits?.subrequests).toBe(10_000);
  });

  // 0509#5758. The whole logs policy has to be in wrangler.jsonc: an
  // undeclared head_sampling_rate means the log bill is whatever the platform
  // default is today, and docs/REBUILD-DONE.md's p95-per-route performance
  // gate is measured from these logs. 1.0 is a deliberate choice here, not a
  // default, because the invocation log is what the per-route measurement
  // reads. Both levels are declared: the Workers Logs docs put the sampling
  // rate at the top of `observability`, and wrangler normalises
  // `logs.head_sampling_rate` to the same 1, so a change to either alone is
  // visible in this assertion.
  it("declares the Workers Logs policy (0509#5758)", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    expect(rawConfig.observability?.enabled).toBe(true);
    expect(rawConfig.observability?.head_sampling_rate).toBe(1);
    expect(rawConfig.observability?.logs?.head_sampling_rate).toBe(1);
    expect(rawConfig.observability?.logs?.invocation_logs).toBe(true);
    expect(rawConfig.observability?.logs?.persist).toBe(true);
  });

  // 0509#5261. The identity tail produces onto fetch-sweep; without a consumer
  // a confirmed card's first collection sits until it expires, and without a
  // dead_letter_queue a message that exhausts its retries is deleted rather
  // than parked. Both shapes are pinned here so removing either turns red.
  it("consumes fetch-sweep and dead-letters it (0509#5261)", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    const consumer = (rawConfig.queues?.consumers ?? []).find((queue) => queue.queue === "fetch-sweep");
    expect(consumer).toBeDefined();
    expect(consumer?.dead_letter_queue).toBe("fetch-sweep-dlq");
    // docs/engines/README.md "What the four share": no browser on this lane.
    expect(consumer?.max_concurrency).toBe(20);
    expect(consumer?.max_retries).toBe(3);
    const dlq = (rawConfig.queues?.consumers ?? []).find((queue) => queue.queue === "fetch-sweep-dlq");
    expect(dlq).toBeDefined();
  });
});

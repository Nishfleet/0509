import { readdirSync, readFileSync } from "node:fs";

import { experimental_readRawConfig } from "wrangler";
import { describe, expect, it } from "vitest";

import { SNAPSHOT_BUCKET } from "../app/lib/observability/cost-analytics.server";
import { SITE_URL } from "../app/lib/site-url";

interface KvNamespace {
  binding: string;
  id?: string;
}

interface WorkflowBinding {
  name: string;
  schedules?: unknown;
}

interface D1Database {
  binding: string;
  database_id?: string;
}

interface R2Bucket {
  binding: string;
  bucket_name?: string;
}

interface QueueConsumer {
  queue: string;
  dead_letter_queue?: string;
  max_concurrency?: number;
  max_retries?: number;
  retry_delay?: number;
}

interface DeployedConfig {
  kv_namespaces?: KvNamespace[];
  workflows?: WorkflowBinding[];
  d1_databases?: D1Database[];
  r2_buckets?: R2Bucket[];
  queues?: { consumers?: QueueConsumer[] };
  triggers?: { crons?: string[] };
  vars?: Record<string, string>;
  limits?: { cpu_ms?: number; subrequests?: number };
  version_metadata?: unknown;
  upload_source_maps?: boolean;
  observability?: {
    enabled?: boolean;
    head_sampling_rate?: number;
    logs?: { head_sampling_rate?: number; invocation_logs?: boolean; persist?: boolean };
  };
  compatibility_flags?: string[];
}

const readConfig = (config: string): { rawConfig: DeployedConfig } =>
  experimental_readRawConfig({ config }) as unknown as { rawConfig: DeployedConfig };

const CONFIGS = [
  "wrangler.jsonc",
  ...readdirSync("workers")
    .filter((name) => name.endsWith(".wrangler.jsonc"))
    .map((name) => `workers/${name}`),
];

const KV_BINDINGS: Record<string, string[]> = {
  "wrangler.jsonc": ["IDENTITY_CACHE", "OAUTH_KV"],
};

it("keeps every KV_BINDINGS entry governing a config the gate runs on (0509#7232)", () => {
  expect(Object.keys(KV_BINDINGS)).not.toHaveLength(0);
  expect(CONFIGS).toEqual(expect.arrayContaining(Object.keys(KV_BINDINGS)));
});

describe("deployed wrangler configs", () => {
  it.each(CONFIGS)("%s pins an id on every KV namespace", (config) => {
    const { rawConfig } = readConfig(config);
    const namespaces = rawConfig.kv_namespaces ?? [];
    const expectedBindings = KV_BINDINGS[config];
    if (expectedBindings) {
      expect(
        namespaces.map((namespace) => namespace.binding).sort(),
        `${config} must deploy exactly the KV namespaces the app reads: the kv_namespaces key is missing, emptied or its entries drifted, and the per-namespace id check below would pass vacuously (0509#7232)`,
      ).toEqual([...expectedBindings].sort());
    }
    const unpinned = namespaces.filter((namespace) => !namespace.id).map((namespace) => namespace.binding);
    expect(unpinned).toEqual([]);
  });

  it("starts the snapshot-backup Workflow every night at 05:00 UTC from a Worker cron", () => {
    const { rawConfig } = readConfig("wrangler.jsonc");
    const snapshotBackup = (rawConfig.workflows ?? []).find((workflow) => workflow.name === "snapshot-backup");
    expect(snapshotBackup).toBeDefined();
    expect(snapshotBackup?.schedules).toBeUndefined();
    expect(rawConfig.triggers?.crons).toContain("0 5 * * *");
  });

  it("ships the fixture reaper dry-run and starts nothing else on its own schedule", () => {
    const { rawConfig } = readConfig("wrangler.jsonc");
    const reaper = (rawConfig.workflows ?? []).find((workflow) => workflow.name === "fixture-reaper");
    expect(reaper).toMatchObject({ binding: "FIXTURE_REAPER_WORKFLOW", class_name: "FixtureReaperWorkflow" });
    expect(reaper?.schedules).toBeUndefined();
    expect(rawConfig.vars?.FIXTURE_REAPER, "going live is a reviewed one-line change to this var").toBe("dry-run");
  });

  it("keeps the cost-guard bucket constant equal to the deployed bucket", () => {
    const { rawConfig } = readConfig("wrangler.jsonc");
    const bucket = (rawConfig.r2_buckets ?? []).find((b) => b.binding === "SNAPSHOTS");
    expect(bucket?.bucket_name).toBe(SNAPSHOT_BUCKET);
  });

  it("pins the deployed BETTER_AUTH_URL to the site origin every node builds on", () => {
    const { rawConfig } = readConfig("wrangler.jsonc");
    expect(rawConfig.vars?.BETTER_AUTH_URL, "wrangler.jsonc no longer deploys BETTER_AUTH_URL to SITE_URL").toBe(
      SITE_URL,
    );
    expect(readFileSync("app/lib/env.server.ts", "utf8")).toContain('import { SITE_URL } from "./site-url"');
  });

  it("caps CPU and subrequests below the paid defaults (0509#5758)", () => {
    const limits = readConfig("wrangler.jsonc").rawConfig.limits;
    expect(limits).toBeDefined();

    const MEASURED_CPU_SLOWEST_MS = 3_637;
    const MEASURED_CPU_P99_9_MS = 1_076;
    const PAID_DEFAULT_CPU_MS = 30_000;
    expect(limits?.cpu_ms).toBeGreaterThan(MEASURED_CPU_P99_9_MS);
    expect(limits?.cpu_ms).toBeGreaterThan(MEASURED_CPU_SLOWEST_MS);
    expect(limits?.cpu_ms).toBeLessThan(PAID_DEFAULT_CPU_MS);
    expect(limits?.subrequests).toBe(10_000);
  });

  it("binds Worker version metadata so Sentry events carry a release (0509#7079)", () => {
    const { rawConfig } = readConfig("wrangler.jsonc");
    expect(rawConfig.version_metadata).toEqual({ binding: "CF_VERSION_METADATA" });
    expect(rawConfig.upload_source_maps).toBe(true);
  });

  it("declares the Workers Logs policy (0509#5758)", () => {
    const { rawConfig } = readConfig("wrangler.jsonc");
    expect(rawConfig.observability?.enabled).toBe(true);
    expect(rawConfig.observability?.head_sampling_rate).toBe(1);
    expect(rawConfig.observability?.logs?.head_sampling_rate).toBe(1);
    expect(rawConfig.observability?.logs?.invocation_logs).toBe(true);
    expect(rawConfig.observability?.logs?.persist).toBe(true);
  });

  it("consumes fetch-sweep and dead-letters it (0509#5261)", () => {
    const { rawConfig } = readConfig("wrangler.jsonc");
    const consumer = (rawConfig.queues?.consumers ?? []).find((queue) => queue.queue === "fetch-sweep");
    expect(consumer).toBeDefined();
    expect(consumer?.dead_letter_queue).toBe("fetch-sweep-dlq");

    expect(consumer?.max_concurrency).toBe(20);
    expect(consumer?.max_retries).toBe(3);
    expect(consumer?.retry_delay).toBe(60);
    const sendEmail = (rawConfig.queues?.consumers ?? []).find((queue) => queue.queue === "send-email");
    expect(sendEmail?.retry_delay).toBe(60);
    const dlq = (rawConfig.queues?.consumers ?? []).find((queue) => queue.queue === "fetch-sweep-dlq");
    expect(dlq).toBeDefined();
  });

  it("sets nodejs_compat explicitly so tests cannot hide a missing production flag (0509#7078)", () => {
    for (const config of ["wrangler.jsonc", "tests/integration/wrangler.test.jsonc"]) {
      const { rawConfig } = readConfig(config);
      expect(rawConfig.compatibility_flags, config).toContain("nodejs_compat");
      expect(rawConfig.compatibility_flags, config).toContain("global_fetch_strictly_public");
    }
  });

  it("routes every consumer queue in wrangler.jsonc to its own branch in queue()", () => {
    const { rawConfig } = readConfig("wrangler.jsonc");
    const consumers = (rawConfig.queues?.consumers ?? []).map((queue) => queue.queue);
    const constants = Object.fromEntries(
      [
        ...readFileSync("workers/sources/fetch-sweep-consumer.ts", "utf8").matchAll(/export const (\w+) = "([^"]+)"/g),
      ].map((match) => [match[1], match[2]]),
    );
    const source = readFileSync("workers/app.ts", "utf8");
    const branched = [...source.matchAll(/batch\.queue === (?:"([^"]+)"|(\w+))/g)].map(
      (match) => match[1] ?? constants[match[2] ?? ""],
    );
    const fallthrough = "send-email";
    expect(consumers).toContain(fallthrough);
    expect(consumers.filter((queue) => queue !== fallthrough).sort()).toEqual([...branched].sort());
  });
});

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
  queues?: { consumers?: QueueConsumer[]; producers?: { queue: string; binding: string }[] };
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
  ratelimits?: { name: string; namespace_id?: string }[];
  env?: Record<string, PreviewEnvironment>;
}

// 0509#7336: `env.preview` is what `CLOUDFLARE_ENV=preview npm run build`
// writes into build/server/wrangler.json, and what pr-preview.yml uploads as a
// version of the `0509-preview` Worker. Every field here is either a twin of a
// production resource or an empty override: a preview must not read or write a
// production resource, must not run a production Workflow, and must not publish
// to a route.
interface PreviewEnvironment {
  routes?: unknown[];
  triggers?: { crons?: string[] };
  workers_dev?: boolean;
  preview_urls?: boolean;
  migrations?: unknown[];
  durable_objects?: { bindings?: unknown[] };
  secrets?: { required?: string[] };
  d1_databases?: D1Database[];
  kv_namespaces?: KvNamespace[];
  r2_buckets?: R2Bucket[];
  queues?: { consumers?: unknown[]; producers?: { queue: string; binding: string }[] };
  workflows?: unknown[];
  analytics_engine_datasets?: unknown[];
  ratelimits?: { name: string; namespace_id?: string }[];
  send_email?: { name: string }[];
  browser?: { binding: string };
  ai?: { binding: string };
  version_metadata?: unknown;
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

  it("starts the fixture reaper live from the nightly cron and starts nothing else on its own schedule", () => {
    const { rawConfig } = readConfig("wrangler.jsonc");
    const reaper = (rawConfig.workflows ?? []).find((workflow) => workflow.name === "fixture-reaper");
    expect(reaper).toMatchObject({ binding: "FIXTURE_REAPER_WORKFLOW", class_name: "FixtureReaperWorkflow" });
    expect(reaper?.schedules).toBeUndefined();
    expect(rawConfig.vars?.FIXTURE_REAPER, "going live is a reviewed one-line change to this var").toBe("live");
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

// 0509#7336. `env.preview` is the environment pr-preview.yml builds and uploads
// as a version of the `0509-preview` Worker. Every assertion below has a failure
// mode that a reviewer would only see from a phone: a preview bound to a
// production resource reads or writes production rows, a preview that runs a
// production Workflow starts a production instance, and a preview with a route
// publishes to a hostname the Cloudflare Access app does not cover.
//
// The environment is compared against the top-level config rather than against
// hardcoded production ids, so it stays isolated when a production id changes.
describe("the preview environment binds preview resources only (0509#7336)", () => {
  const { rawConfig } = readConfig("wrangler.jsonc");
  const preview = rawConfig.env?.preview;

  it("exists, because the upload builds this environment", () => {
    expect(preview, "wrangler.jsonc no longer declares env.preview").toBeDefined();
  });

  it("binds a D1 database that is not the production one", () => {
    const production = (rawConfig.d1_databases ?? []).find((database) => database.binding === "DB");
    const db = (preview?.d1_databases ?? []).find((database) => database.binding === "DB");
    expect(db?.database_id).toBe("d6643a38-0666-470e-8e08-1953918dfd8a");
    expect(db?.database_id).not.toBe(production?.database_id);
  });

  it("binds KV namespaces that are not the production ones", () => {
    const production = new Map((rawConfig.kv_namespaces ?? []).map((ns) => [ns.binding, ns.id]));
    const namespaces = preview?.kv_namespaces ?? [];
    expect(namespaces.map((ns) => ns.binding).sort()).toEqual(["IDENTITY_CACHE", "OAUTH_KV"]);
    for (const namespace of namespaces) {
      expect(namespace.id, `${namespace.binding} shares the production namespace`).not.toBe(
        production.get(namespace.binding),
      );
    }
    // #4631: a KV binding without an id sends wrangler to deploy-time
    // provisioning, and the token in CI cannot reach that endpoint.
    expect(namespaces.filter((ns) => !ns.id)).toEqual([]);
  });

  it("binds an R2 bucket that is not the production one", () => {
    const production = (rawConfig.r2_buckets ?? []).find((bucket) => bucket.binding === "SNAPSHOTS");
    const bucket = (preview?.r2_buckets ?? []).find((candidate) => candidate.binding === "SNAPSHOTS");
    expect(bucket?.bucket_name).toBe("0509-preview-snapshots");
    expect(bucket?.bucket_name).not.toBe(production?.bucket_name);
  });

  it("produces mail onto the preview queue and consumes nothing", () => {
    // A consumer is set by a deploy, and a preview is never deployed: mail that
    // reaches the preview queue waits there, which is the intended stop for a
    // sign-in link nobody should act on.
    expect(preview?.queues?.producers).toEqual([{ queue: "send-email-preview", binding: "SEND_EMAIL" }]);
    expect(preview?.queues?.consumers).toBeUndefined();
  });

  it("binds no Workflow and writes no analytics rows", () => {
    // Cloudflare binds a preview to a Workflow that already exists, and the
    // binding calls that Workflow's deployed code and instances: binding the
    // production ones here would run production sweeps from a preview. The
    // analytics dataset is where the cost guard reads from.
    expect(preview?.workflows).toEqual([]);
    expect(preview?.analytics_engine_datasets).toEqual([]);
  });

  it("publishes to no route and to no hostname", () => {
    // The Access app covers `*-0509-preview.<subdomain>.workers.dev`, which is
    // the shape of a preview URL. `workers_dev: false` means even a stray
    // `wrangler deploy --env preview` has nowhere to publish; `preview_urls` is
    // what serves the alias URL pr-preview.yml uploads to.
    expect(preview?.routes).toEqual([]);
    expect(preview?.workers_dev).toBe(false);
    expect(preview?.preview_urls).toBe(true);
    expect(preview?.triggers?.crons).toEqual([]);
  });

  it("declares no Durable Object migration", () => {
    // Cloudflare rejects `wrangler versions upload` for a Worker with a pending
    // Durable Object migration, and applying one needs a `wrangler deploy`. A
    // preview is never deployed, so the binding is left unbound: the paths that
    // take an AI budget call are sign-in-only, and a preview cannot sign in
    // (its mail queue has no consumer).
    expect(preview?.migrations).toEqual([]);
    expect(preview?.durable_objects?.bindings ?? []).toEqual([]);
  });

  it("requires only the three secrets the preview Worker holds", () => {
    // Requiring a billing or Slack secret here would demand a preview key for a
    // provider a preview never calls.
    expect(preview?.secrets?.required).toEqual(["BETTER_AUTH_SECRET", "TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY"]);
  });

  it("declares the bindings the Vite plugin does not inherit", () => {
    // `CLOUDFLARE_ENV=preview npm run build` writes build/server/wrangler.json
    // from this environment alone: it does not carry send_email, browser, ai or
    // version_metadata down from the top level. A preview built without them
    // answered /login with `misconfigured: EMAIL (magic links and briefs cannot
    // send); BROWSER (bot-gated page reads cannot escalate)` and a 503.
    expect(preview?.send_email).toEqual([{ name: "EMAIL" }]);
    expect(preview?.browser).toEqual({ binding: "BROWSER" });
    expect(preview?.ai).toEqual({ binding: "AI" });
    expect(preview?.version_metadata).toEqual({ binding: "CF_VERSION_METADATA" });
  });

  it("gives every rate limit its own namespace, distinct from production", () => {
    const production = new Map((rawConfig.ratelimits ?? []).map((limit) => [limit.name, limit.namespace_id]));
    const limits = preview?.ratelimits ?? [];
    expect(limits.map((limit) => limit.name).sort()).toEqual([...production.keys()].sort());
    const ids = limits.map((limit) => limit.namespace_id);
    // The API rejects a namespace_id that is not a number ("binding AGENT_LIMIT
    // of type ratelimit must have valid namespace_id", code 10021), so a
    // `-preview` suffix is not a way to isolate one.
    for (const id of ids) {
      expect(id, `rate limit namespace ${id} must be numeric`).toMatch(/^[0-9]+$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
    for (const limit of limits) {
      expect(limit.namespace_id).not.toBe(production.get(limit.name));
    }
  });

  it("declares no vars, so a preview fails closed instead of pointing at production", () => {
    // BETTER_AUTH_URL is the one the preview needs, and pr-preview.yml passes it
    // per upload because the URL carries the pull request number. Everything
    // else fails closed unset: AI_SPEND stops spend, and the Access audience
    // check refuses a token it cannot verify.
    expect(preview && "vars" in preview).toBe(false);
  });
});

import { experimental_readRawConfig } from "wrangler";
import { afterEach, describe, expect, it, vi } from "vitest";

import cloudflareConfig from "../cloudflare.config";

interface Binding {
  type: string;
  name?: string;
  id?: string;
  value?: string;
  namespace?: string;
  worker?: string;
  exportName?: string;
  simple?: { limit: number; period: number };
}

interface QueueTrigger {
  type: string;
  name?: string;
  schedule?: string;
  deadLetterQueue?: string;
  maxBatchSize?: number;
  maxBatchTimeout?: number;
  maxConcurrency?: number;
  maxRetries?: number;
  retryDelay?: number;
}

interface WorkerDefinition {
  name: string;
  compatibilityDate: string;
  compatibilityFlags: string[];
  entrypoint: string;
  placement: { mode: string };
  limits: { cpuMs: number; subrequests: number };
  observability: {
    enabled: boolean;
    headSamplingRate: number;
    logs: { headSamplingRate: number; invocationLogs: boolean; persist: boolean };
  };
  assets: { runWorkerFirst: string[] };
  domains: string[];
  triggers: QueueTrigger[];
  env: Record<string, Binding>;
  exports: Record<string, { type: string; name?: string; storage?: string; state?: string }>;
}

interface WranglerConfig {
  name: string;
  main: string;
  compatibility_date: string;
  compatibility_flags: string[];
  placement: { mode: string };
  limits: { cpu_ms: number; subrequests: number };
  observability: {
    enabled: boolean;
    head_sampling_rate: number;
    logs: { head_sampling_rate: number; invocation_logs: boolean; persist: boolean };
  };
  assets: { run_worker_first: string[] };
  routes: { pattern: string; custom_domain: boolean }[];
  triggers: { crons: string[] };
  vars: Record<string, string>;
  secrets: { required: string[] };
  d1_databases: { binding: string; database_name: string; database_id: string }[];
  analytics_engine_datasets: { binding: string; dataset: string }[];
  r2_buckets: { binding: string; bucket_name: string }[];
  kv_namespaces: { binding: string; id: string }[];
  ratelimits: { name: string; namespace_id: string; simple: { limit: number; period: number } }[];
  queues: {
    producers: { queue: string; binding: string }[];
    consumers: {
      queue: string;
      dead_letter_queue?: string;
      max_batch_size: number;
      max_batch_timeout: number;
      max_concurrency?: number;
      max_retries: number;
      retry_delay?: number;
    }[];
  };
  workflows: { name: string; binding: string; class_name: string }[];
  durable_objects: { bindings: { name: string; class_name: string }[] };
  version_metadata: { binding: string };
  ai: { binding: string };
  browser: { binding: string };
  send_email: { name: string }[];
  migrations: { tag: string; new_sqlite_classes?: string[]; deleted_classes?: string[] }[];
}

const evaluate = (mode: string): WorkerDefinition =>
  (cloudflareConfig as unknown as (context: { isPreview: boolean; mode: string }) => { worker: WorkerDefinition })({
    isPreview: false,
    mode,
  }).worker;

const wrangler = (): WranglerConfig =>
  (experimental_readRawConfig({ config: "wrangler.jsonc" }) as unknown as { rawConfig: WranglerConfig }).rawConfig;

const bindingsOfType = (worker: WorkerDefinition, type: string): [string, Binding][] =>
  Object.entries(worker.env).filter(([, binding]) => binding.type === type);

const queueTriggers = (worker: WorkerDefinition): QueueTrigger[] =>
  worker.triggers.filter((trigger) => trigger.type === "queue");

const wranglerBindingNames = (config: WranglerConfig): string[] => [
  ...Object.keys(config.vars),
  ...config.secrets.required,
  ...config.d1_databases.map((binding) => binding.binding),
  ...config.analytics_engine_datasets.map((binding) => binding.binding),
  ...config.r2_buckets.map((binding) => binding.binding),
  ...config.kv_namespaces.map((binding) => binding.binding),
  ...config.ratelimits.map((binding) => binding.name),
  ...config.queues.producers.map((binding) => binding.binding),
  ...config.workflows.map((binding) => binding.binding),
  ...config.durable_objects.bindings.map((binding) => binding.name),
  ...config.send_email.map((binding) => binding.name),
  config.ai.binding,
  config.browser.binding,
  config.version_metadata.binding,
];

describe("cloudflare.config.ts production mode matches wrangler.jsonc", () => {
  const prod = evaluate("production");
  const config = wrangler();

  it("declares the same Worker, entry point, runtime and limits", () => {
    expect(prod.name).toBe(config.name);
    expect(prod.entrypoint).toBe(config.main);
    expect(prod.compatibilityDate).toBe(config.compatibility_date);
    expect(prod.compatibilityFlags).toEqual(config.compatibility_flags);
    expect(prod.placement).toEqual(config.placement);
    expect(prod.limits).toEqual({ cpuMs: config.limits.cpu_ms, subrequests: config.limits.subrequests });
    expect(prod.assets.runWorkerFirst).toEqual(config.assets.run_worker_first);
    expect(prod.observability).toEqual({
      enabled: config.observability.enabled,
      headSamplingRate: config.observability.head_sampling_rate,
      logs: {
        headSamplingRate: config.observability.logs.head_sampling_rate,
        invocationLogs: config.observability.logs.invocation_logs,
        persist: config.observability.logs.persist,
      },
    });
  });

  it("serves the same custom domains", () => {
    expect(config.routes.every((route) => route.custom_domain)).toBe(true);
    expect(prod.domains).toEqual(config.routes.map((route) => route.pattern));
  });

  it("runs the same crons in the same order", () => {
    const schedules = prod.triggers
      .filter((trigger) => trigger.type === "scheduled")
      .map((trigger) => trigger.schedule);
    expect(schedules).toEqual(config.triggers.crons);
  });

  it("consumes the same queues with the same settings", () => {
    expect(queueTriggers(prod)).toEqual(
      config.queues.consumers.map((consumer) => ({
        type: "queue",
        name: consumer.queue,
        ...(consumer.dead_letter_queue ? { deadLetterQueue: consumer.dead_letter_queue } : {}),
        maxBatchSize: consumer.max_batch_size,
        maxBatchTimeout: consumer.max_batch_timeout,
        ...(consumer.max_concurrency === undefined ? {} : { maxConcurrency: consumer.max_concurrency }),
        maxRetries: consumer.max_retries,
        ...(consumer.retry_delay === undefined ? {} : { retryDelay: consumer.retry_delay }),
      })),
    );
    expect(bindingsOfType(prod, "queue").map(([name, binding]) => [name, binding.name])).toEqual(
      config.queues.producers.map((producer) => [producer.binding, producer.queue]),
    );
  });

  it("declares exactly the bindings, vars and secrets wrangler.jsonc declares", () => {
    expect(Object.keys(prod.env).sort()).toEqual(wranglerBindingNames(config).sort());
  });

  it("holds the same var values and the same secret names", () => {
    const text = Object.fromEntries(bindingsOfType(prod, "text").map(([name, binding]) => [name, binding.value]));
    expect(text).toEqual(config.vars);
    expect(
      bindingsOfType(prod, "secret")
        .map(([name]) => name)
        .sort(),
    ).toEqual([...config.secrets.required].sort());
  });

  it("points every storage binding at the same resource", () => {
    expect(
      Object.fromEntries(bindingsOfType(prod, "d1").map(([name, binding]) => [name, [binding.name, binding.id]])),
    ).toEqual(Object.fromEntries(config.d1_databases.map((db) => [db.binding, [db.database_name, db.database_id]])));
    expect(Object.fromEntries(bindingsOfType(prod, "kv").map(([name, binding]) => [name, binding.id]))).toEqual(
      Object.fromEntries(config.kv_namespaces.map((kv) => [kv.binding, kv.id])),
    );
    expect(Object.fromEntries(bindingsOfType(prod, "r2").map(([name, binding]) => [name, binding.name]))).toEqual(
      Object.fromEntries(config.r2_buckets.map((bucket) => [bucket.binding, bucket.bucket_name])),
    );
    expect(
      Object.fromEntries(
        bindingsOfType(prod, "analytics-engine-dataset").map(([name, binding]) => [name, binding.name]),
      ),
    ).toEqual(Object.fromEntries(config.analytics_engine_datasets.map((set) => [set.binding, set.dataset])));
  });

  it("keeps the same rate limits", () => {
    expect(
      Object.fromEntries(
        bindingsOfType(prod, "rate-limit").map(([name, binding]) => [name, [binding.namespace, binding.simple]]),
      ),
    ).toEqual(Object.fromEntries(config.ratelimits.map((limit) => [limit.name, [limit.namespace_id, limit.simple]])));
  });

  it("keeps the same workflows and exports them from this Worker", () => {
    expect(
      Object.fromEntries(
        bindingsOfType(prod, "workflow").map(([name, binding]) => [
          name,
          [binding.name, binding.worker, binding.exportName],
        ]),
      ),
    ).toEqual(
      Object.fromEntries(config.workflows.map((flow) => [flow.binding, [flow.name, config.name, flow.class_name]])),
    );
    for (const flow of config.workflows) {
      expect(prod.exports[flow.class_name]).toEqual({ type: "workflow", name: flow.name });
    }
  });

  it("keeps the same Durable Object and the same one-time class history", () => {
    expect(
      Object.fromEntries(
        bindingsOfType(prod, "durable-object").map(([name, binding]) => [name, [binding.worker, binding.exportName]]),
      ),
    ).toEqual(
      Object.fromEntries(
        config.durable_objects.bindings.map((object) => [object.name, [config.name, object.class_name]]),
      ),
    );
    const created = new Set(config.migrations.flatMap((migration) => migration.new_sqlite_classes ?? []));
    const deleted = new Set(config.migrations.flatMap((migration) => migration.deleted_classes ?? []));
    for (const name of created) {
      expect(prod.exports[name]).toEqual(
        deleted.has(name)
          ? { type: "durable-object", state: "deleted" }
          : { type: "durable-object", storage: "sqlite" },
      );
    }
  });

  it("has the same AI, browser, email and version metadata bindings", () => {
    expect(bindingsOfType(prod, "ai").map(([name]) => name)).toEqual([config.ai.binding]);
    expect(bindingsOfType(prod, "browser").map(([name]) => name)).toEqual([config.browser.binding]);
    expect(bindingsOfType(prod, "send-email").map(([name]) => name)).toEqual(
      config.send_email.map((email) => email.name),
    );
    expect(bindingsOfType(prod, "version-metadata").map(([name]) => name)).toEqual([config.version_metadata.binding]);
  });
});

describe("cloudflare.config.ts staging mode", () => {
  const prod = evaluate("production");
  const staging = evaluate("staging");

  it("serves staging.0509.io and nothing else", () => {
    expect(staging.domains).toEqual(["staging.0509.io"]);
  });

  it("is its own Worker", () => {
    expect(staging.name).toBe("0509-staging");
    expect(staging.name).not.toBe(prod.name);
  });

  it("keeps runtime, limits, crons and consumer settings identical to production", () => {
    expect(staging.entrypoint).toBe(prod.entrypoint);
    expect(staging.compatibilityDate).toBe(prod.compatibilityDate);
    expect(staging.compatibilityFlags).toEqual(prod.compatibilityFlags);
    expect(staging.limits).toEqual(prod.limits);
    expect(staging.observability).toEqual(prod.observability);
    expect(staging.triggers.filter((trigger) => trigger.type === "scheduled")).toEqual(
      prod.triggers.filter((trigger) => trigger.type === "scheduled"),
    );
    const strip = (trigger: QueueTrigger) => ({ ...trigger, name: undefined, deadLetterQueue: undefined });
    expect(queueTriggers(staging).map(strip)).toEqual(queueTriggers(prod).map(strip));
  });

  it("gives every queue, queue binding and dead letter queue a -staging name that production does not use", () => {
    const prodQueues = new Set(queueTriggers(prod).map((trigger) => trigger.name));
    const names = [
      ...queueTriggers(staging).flatMap((trigger) => [trigger.name, trigger.deadLetterQueue]),
      ...bindingsOfType(staging, "queue").map(([, binding]) => binding.name),
    ].filter((name): name is string => name !== undefined);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name.endsWith("-staging"), name).toBe(true);
      expect(prodQueues.has(name), name).toBe(false);
    }
    expect(new Set(queueTriggers(staging).map((trigger) => trigger.name))).toEqual(
      new Set([...prodQueues].map((name) => `${name}-staging`)),
    );
  });

  it("gives every workflow a -staging name, on its own Worker, that production does not use", () => {
    const prodNames = new Set(bindingsOfType(prod, "workflow").map(([, binding]) => binding.name));
    const flows = bindingsOfType(staging, "workflow");
    expect(flows).toHaveLength(prodNames.size);
    for (const [binding, flow] of flows) {
      expect(flow.name?.endsWith("-staging"), binding).toBe(true);
      expect(prodNames.has(flow.name ?? ""), binding).toBe(false);
      expect(flow.worker, binding).toBe(staging.name);
      expect(staging.exports[flow.exportName ?? ""], binding).toEqual({ type: "workflow", name: flow.name });
    }
  });

  it("has a counterpart for every production binding, so a new one cannot ship without it", () => {
    expect(Object.keys(staging.env)).toEqual(expect.arrayContaining(Object.keys(prod.env)));
    for (const [name, binding] of Object.entries(prod.env)) {
      expect(staging.env[name]?.type, name).toBe(binding.type);
    }
    expect(Object.keys(staging.exports).sort()).toEqual(Object.keys(prod.exports).sort());
  });

  it("holds the same six secret names", () => {
    const secrets = (worker: WorkerDefinition) =>
      bindingsOfType(worker, "secret")
        .map(([name]) => name)
        .sort();
    expect(secrets(staging)).toEqual(secrets(prod));
  });

  it("uses its own D1 database, buckets, KV namespaces, dataset and rate limit namespaces", () => {
    const pick = (worker: WorkerDefinition, type: string, field: "name" | "id" | "namespace") =>
      bindingsOfType(worker, type).map(([, binding]) => binding[field]);
    for (const [type, field] of [
      ["d1", "name"],
      ["d1", "id"],
      ["r2", "name"],
      ["kv", "id"],
      ["analytics-engine-dataset", "name"],
      ["rate-limit", "namespace"],
    ] as const) {
      const prodValues = pick(prod, type, field);
      const stagingValues = pick(staging, type, field);
      expect(stagingValues, `${type}.${field}`).toHaveLength(prodValues.length);
      for (const value of stagingValues) expect(prodValues, `${type}.${field}`).not.toContain(value);
      expect(new Set(stagingValues).size, `${type}.${field}`).toBe(stagingValues.length);
    }
    expect(staging.env.DB).toEqual({ type: "d1", name: "0509-staging", id: "627cffe8-675b-47f9-a20e-c73a0907b4c3" });
    expect(staging.env.IDENTITY_CACHE).toEqual({ type: "kv", id: "b67443be2cc44dd5b388d32eb8d96c86" });
    expect(staging.env.OAUTH_KV).toEqual({ type: "kv", id: "19653fed500a45609b7af16484c1d291" });
    expect(staging.env.SNAPSHOTS).toEqual({ type: "r2", name: "0509-staging-snapshots" });
    expect(staging.env.SNAPSHOTS_BACKUP).toEqual({ type: "r2", name: "0509-staging-snapshots-backup" });
    expect(staging.env.MENTIONS_SOURCES).toEqual({
      type: "analytics-engine-dataset",
      name: "mentions_sources_staging",
    });
    expect(bindingsOfType(staging, "rate-limit").map(([, binding]) => binding.namespace)).toEqual([
      "6091",
      "6092",
      "6093",
      "6094",
      "6095",
      "6096",
    ]);
  });

  it("keeps every rate limit's ceiling equal to production's", () => {
    for (const [name, binding] of bindingsOfType(prod, "rate-limit")) {
      expect(staging.env[name]?.simple, name).toEqual(binding.simple);
    }
  });

  it("holds no monitor, ping, analytics-read or crawler-signing variable", () => {
    for (const name of [
      "HEALTHCHECKS_PING_KEY",
      "LIVENESS_PING_URL",
      "SITE_SWEEP_PING_URL",
      "SENTRY_DSN",
      "CLOUDFLARE_API_TOKEN",
      "WEB_BOT_AUTH_KEY",
    ]) {
      const binding = staging.env[name];
      expect(binding === undefined || (binding.type === "text" && binding.value === ""), name).toBe(true);
    }
  });

  it("is a sandbox: test-mode billing, AI spend on at a fraction of production's caps, reaper not live", () => {
    const text = (name: string) => staging.env[name]?.value;
    expect(text("DODO_ENVIRONMENT")).toBe("test_mode");
    for (const name of ["DODO_PRODUCT_SCOUT", "DODO_PRODUCT_STARTER", "DODO_PRODUCT_AGENCY"]) {
      expect(text(name), name).toBe("");
    }
    expect(text("AI_SPEND")).toBe("on");
    const scale = Number(text("AI_DAILY_CAP_SCALE"));
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThanOrEqual(0.1);
    expect(text("FIXTURE_REAPER")).not.toBe("live");
    expect(prod.env.AI_DAILY_CAP_SCALE).toBeUndefined();
  });

  it("points sign-in and Access at staging", () => {
    expect(staging.env.BETTER_AUTH_URL?.value).toBe("https://staging.0509.io");
    expect(staging.env.ACCESS_TEAM_DOMAIN?.value).toBe(prod.env.ACCESS_TEAM_DOMAIN?.value);
    expect(staging.env.ACCESS_AUD?.value).toBe("4d713d09a17fe8acfcbee861f29b743a0158892737e95ec52c0b659f7362dd7f");
    expect(staging.env.ACCESS_AUD?.value).not.toBe(prod.env.ACCESS_AUD?.value);
    expect(staging.env.LANDING_WORKSPACE_ID?.value).toBe("");
  });
});

describe("cloudflare.config.ts GIT_SHA", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("names the commit being built in staging mode and is empty without one", () => {
    vi.stubEnv("GITHUB_SHA", "a".repeat(40));
    expect(evaluate("staging").env.GIT_SHA?.value).toBe("a".repeat(40));
    vi.stubEnv("GITHUB_SHA", "");
    expect(evaluate("staging").env.GIT_SHA?.value).toBe("");
  });

  it("stays empty in production mode, which wrangler deploy stamps with --var", () => {
    vi.stubEnv("GITHUB_SHA", "a".repeat(40));
    expect(evaluate("production").env.GIT_SHA?.value).toBe("");
  });
});

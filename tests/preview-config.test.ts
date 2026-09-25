import { unstable_readConfig } from "wrangler";
import { describe, expect, it } from "vitest";

// #4262's hard line: nothing a Worker Preview binds may be a production
// resource. Read the way wrangler itself reads wrangler.jsonc, so a binding
// added to production without a preview twin, or pointed at a production
// resource, fails here before any upload.
const production = unstable_readConfig({ config: "wrangler.jsonc" });
const environment = unstable_readConfig({ config: "wrangler.jsonc", env: "preview" });
const previews = environment.previews ?? {};

function storage(config: {
  d1_databases?: unknown;
  r2_buckets?: unknown;
  kv_namespaces?: unknown;
  ratelimits?: unknown;
  workflows?: unknown;
  analytics_engine_datasets?: unknown;
  ai?: unknown;
  queues?: { producers?: unknown };
}) {
  return {
    d1_databases: config.d1_databases,
    r2_buckets: config.r2_buckets,
    kv_namespaces: config.kv_namespaces,
    ratelimits: config.ratelimits,
    workflows: config.workflows,
    analytics_engine_datasets: config.analytics_engine_datasets,
    ai: config.ai,
    queue_producers: config.queues?.producers,
  };
}

describe("the preview environment", () => {
  it("is a Worker of its own", () => {
    expect(environment.name).toBe("0509-preview");
    expect(environment.name).not.toBe(production.name);
  });

  it("binds no production database, bucket, namespace, dataset, queue or Workflow", () => {
    const productionIds = new Set<string>([
      ...production.d1_databases.flatMap((db) => [db.database_id ?? "", db.database_name ?? ""]),
      ...production.r2_buckets.map((bucket) => bucket.bucket_name ?? ""),
      ...production.kv_namespaces.map((namespace) => namespace.id ?? ""),
      ...production.ratelimits.map((limit) => `ratelimit:${limit.namespace_id}`),
      ...production.workflows.map((workflow) => workflow.name),
      ...production.analytics_engine_datasets.map((dataset) => `dataset:${dataset.dataset ?? dataset.binding}`),
      ...(production.queues.producers ?? []).map((producer) => producer.queue),
    ].filter(Boolean));
    const previewIds = [
      ...(previews.d1_databases ?? []).flatMap((db) => [db.database_id ?? "", db.database_name ?? ""]),
      ...(previews.r2_buckets ?? []).map((bucket) => bucket.bucket_name ?? ""),
      ...(previews.kv_namespaces ?? []).map((namespace) => namespace.id ?? ""),
      ...(previews.ratelimits ?? []).map((limit) => `ratelimit:${limit.namespace_id}`),
      ...(previews.workflows ?? []).map((workflow) => workflow.name),
      ...(previews.analytics_engine_datasets ?? []).map((dataset) => `dataset:${dataset.dataset ?? dataset.binding}`),
      ...environment.workflows.map((workflow) => workflow.name),
      ...(previews.queues?.producers ?? []).map((producer) => producer.queue),
    ];
    expect(previewIds.length).toBeGreaterThan(0);
    expect(previewIds.filter((id) => productionIds.has(id))).toEqual([]);
  });

  it("gives every storage binding production has a preview twin", () => {
    const names = (list: readonly { binding: string }[] | undefined) => (list ?? []).map((entry) => entry.binding).sort();
    expect(names(previews.d1_databases)).toEqual(names(production.d1_databases));
    expect(names(previews.r2_buckets)).toEqual(names(production.r2_buckets));
    expect(names(previews.kv_namespaces)).toEqual(names(production.kv_namespaces));
    expect(names(previews.queues?.producers)).toEqual(names(production.queues.producers));
    expect(names(previews.workflows)).toEqual(names(production.workflows));
    expect(names(previews.analytics_engine_datasets)).toEqual(names(production.analytics_engine_datasets));
    expect((previews.ratelimits ?? []).map((limit) => limit.name).sort()).toEqual(
      production.ratelimits.map((limit) => limit.name).sort(),
    );
    expect(previews.ai?.binding).toBe(production.ai?.binding);
  });

  it("types and migrates against the same resources the previews bind", () => {
    expect(storage(environment)).toEqual(storage(previews));
    expect(environment.vars).toEqual(previews.vars);
  });

  it("runs no crons, no scheduled Workflows and claims no routes", () => {
    expect(environment.triggers.crons).toEqual([]);
    expect(environment.workflows.flatMap((workflow) => workflow.schedules ?? [])).toEqual([]);
    expect(environment.routes).toEqual([]);
  });
});

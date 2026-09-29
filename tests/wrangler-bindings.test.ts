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
});

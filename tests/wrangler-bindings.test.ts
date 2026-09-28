import { readdirSync } from "node:fs";

import { experimental_readRawConfig } from "wrangler";
import { describe, expect, it } from "vitest";

import { FIXTURE_HOSTS } from "../workers/fixture-site-hosts";

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

  it("serves exactly the hosts the fixture-site wrangler routes announce", () => {
    // 0509#5833: the Worker's host gate and its `routes` block are two lists in
    // two files. A host in the config but not the gate 404s forever on a
    // hostname the deploy announced; a host in the gate but not the config can
    // never be reached. Reading the real config ties them here, at the one place
    // both a deploy and a test see.
    const { rawConfig } = experimental_readRawConfig({
      config: "workers/fixture-site.wrangler.jsonc",
    });
    const patterns = (rawConfig.routes ?? []).map((route) =>
      typeof route === "string" ? route : route.pattern,
    );
    expect(patterns).toEqual([...FIXTURE_HOSTS]);
  });

  it("schedules the snapshot-backup Workflow every night at 05:00 UTC", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    const snapshotBackup = (rawConfig.workflows ?? []).find((workflow) => workflow.name === "snapshot-backup");
    expect(snapshotBackup).toBeDefined();
    expect(snapshotBackup?.schedules).toEqual(["0 5 * * *"]);
  });
});

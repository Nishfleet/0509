import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readCustomerSiteUsage } from "../../../app/lib/data/watch.server";

const NOW = "2026-09-24T00:00:00Z";
const AT_EARLIER = "2026-09-20T10:00:00.000Z";
const AT_LATER = "2026-09-22T10:00:00.000Z";

async function seedWorkspace(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)`,
  )
    .bind(`user-${id}`, "Owner", `${id}@0509.io`, NOW, NOW)
    .run();
  await env.DB.prepare(`INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)`)
    .bind(id, "Owner", `user-${id}`, NOW)
    .run();
}

function insertCustomerWatch(id: string, entityId: string, sourceId: string, url: string, configJson: string) {
  return env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key, config_json) VALUES (?, ?, ?, ?, ?)`,
  ).bind(id, entityId, sourceId, url, configJson);
}

beforeEach(async () => {
  for (const table of ["watch", "source", "entity", "workspace", '"user"']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await seedWorkspace("ws-a");
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, state, created_at) VALUES ('e-a', 'ws-a', 'competitor', 'comp.example', 'on', ?)`,
  )
    .bind(NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key) VALUES ('src-a', 'probe.site', 'site', 'web', 'site')`,
  ).run();
});

describe("readCustomerSiteUsage", () => {
  it("counts the entity's customer-site watches and reads the newest attempt", async () => {
    await insertCustomerWatch(
      "w-1",
      "e-a",
      "src-a",
      "https://comp.example",
      JSON.stringify({ alternateHome: 1, customer: 1, at: AT_EARLIER }),
    ).run();
    await insertCustomerWatch(
      "w-2",
      "e-a",
      "src-a",
      "https://comp.example/pricing",
      JSON.stringify({ alternateHome: 1, customer: 1, at: AT_LATER }),
    ).run();

    expect(await readCustomerSiteUsage("ws-a", "e-a")).toEqual({ rows: 2, lastAt: AT_LATER });
  });

  it("returns no rows and no timestamp when no watch is marked as a customer site", async () => {
    await insertCustomerWatch(
      "w-3",
      "e-a",
      "src-a",
      "https://comp.example",
      JSON.stringify({ alternateHome: 1 }),
    ).run();

    expect(await readCustomerSiteUsage("ws-a", "e-a")).toEqual({ rows: 0, lastAt: null });
  });
});

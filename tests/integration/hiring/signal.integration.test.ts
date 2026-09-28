import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  insertHiringSignals,
  type NewHiringSignal,
} from "../../../app/lib/data/signal.server";

const NOW = "2026-09-24T12:00:00.000Z";
const USER = "user-hiring-signal";
const SOURCE_ID = "test-sig-hiring";
const TARGET_KEY = "https://boards.greenhouse.io/brand";

const hiringSignal = (overrides: Partial<NewHiringSignal> = {}): NewHiringSignal => ({
  id: "sig-1",
  workspaceId: "ws-1",
  entityId: "ent-1",
  sourceId: SOURCE_ID,
  watchId: "w-1",
  snapshotId: null,
  roleId: "role-1",
  platform: "greenhouse",
  title: "Senior Backend Engineer",
  location: "Berlin",
  team: "Platform",
  url: "https://boards.greenhouse.io/brand/jobs/role-1",
  publishedAt: "2026-09-20T09:00:00.000Z",
  observedAt: NOW,
  ...overrides,
});

const readHiringSignals = async () => {
  const result = await env.DB.prepare(
    `SELECT id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, title, summary,
            url, evidence_url, payload_json, dedup_key, published_at, observed_at, last_seen_at
       FROM signal
      WHERE kind = 'hiring'
      ORDER BY id`,
  ).all<{
    id: string;
    workspace_id: string;
    entity_id: string;
    source_id: string;
    watch_id: string | null;
    snapshot_id: string | null;
    kind: string;
    title: string | null;
    summary: string | null;
    url: string | null;
    evidence_url: string | null;
    payload_json: string;
    dedup_key: string;
    published_at: string | null;
    observed_at: string;
    last_seen_at: string | null;
  }>();
  return result.results;
};

describe("hiring signals", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM signal");
    await env.DB.exec("DELETE FROM watch");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.exec("DELETE FROM source WHERE id LIKE 'test-sig-%'");

    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', 'hiring-signal@0509.io', 1, ?, ?)`,
    )
      .bind(USER, NOW, NOW)
      .run();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
         VALUES (?, 'Brand One', ?, 'UTC', 1, 8, ?)`,
      ).bind("ws-1", USER, NOW),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
         VALUES (?, 'Brand Two', ?, 'UTC', 1, 8, ?)`,
      ).bind("ws-2", USER, NOW),
    ]);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
         VALUES ('ent-1', 'ws-1', 'competitor', 'brand.com', '{}', 'manual', 'on', ?)`,
      ).bind(NOW),
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
         VALUES ('ent-2', 'ws-2', 'competitor', 'brand.com', '{}', 'manual', 'on', ?)`,
      ).bind(NOW),
    ]);
    await env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key)
       VALUES (?, 'test.sig.hiring', 'hiring', 'greenhouse', ?)`,
    )
      .bind(SOURCE_ID, SOURCE_ID)
      .run();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO watch (id, entity_id, source_id, target_key) VALUES ('w-1', 'ent-1', ?, ?)",
      ).bind(SOURCE_ID, TARGET_KEY),
      env.DB.prepare(
        "INSERT INTO watch (id, entity_id, source_id, target_key) VALUES ('w-2', 'ent-2', ?, ?)",
      ).bind(SOURCE_ID, TARGET_KEY),
    ]);
  });

  it("deduplicates repeated observations by watch and role", async () => {
    const rows = [
      hiringSignal(),
      hiringSignal({
        id: "sig-2",
        roleId: "role-2",
        title: "Product Designer",
        location: null,
        team: "Design",
        url: "https://boards.greenhouse.io/brand/jobs/role-2",
      }),
    ];

    await insertHiringSignals(rows);
    await insertHiringSignals(rows.map((row) => ({ ...row, id: `${row.id}-second` })));

    const stored = await readHiringSignals();
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.id).sort()).toEqual(["sig-1", "sig-2"]);
    expect(stored[0]).toMatchObject({
      kind: "hiring",
      url: rows[0]?.url,
      evidence_url: rows[0]?.url,
      dedup_key: "w-1:role-1",
      observed_at: NOW,
      last_seen_at: NOW,
    });
    expect(JSON.parse(stored[0]?.payload_json ?? "null")).toEqual({
      platform: "greenhouse",
      location: "Berlin",
      team: "Platform",
    });
  });

  it("summarizes the available location and team", async () => {
    await insertHiringSignals([
      hiringSignal({ id: "sig-both", roleId: "role-both" }),
      hiringSignal({
        id: "sig-location",
        roleId: "role-location",
        team: null,
        url: "https://boards.greenhouse.io/brand/jobs/role-location",
      }),
      hiringSignal({
        id: "sig-neither",
        roleId: "role-neither",
        location: null,
        team: null,
        url: "https://boards.greenhouse.io/brand/jobs/role-neither",
      }),
    ]);

    const summaries = new Map(
      (await readHiringSignals()).map((row) => [row.dedup_key, row.summary]),
    );
    expect(summaries).toEqual(
      new Map([
        ["w-1:role-both", "Berlin · Platform"],
        ["w-1:role-location", "Berlin"],
        ["w-1:role-neither", null],
      ]),
    );
  });

  it("keeps the same role separate for each workspace", async () => {
    await insertHiringSignals([
      hiringSignal({ id: "sig-ws-1" }),
      hiringSignal({
        id: "sig-ws-2",
        workspaceId: "ws-2",
        entityId: "ent-2",
        watchId: "w-2",
      }),
    ]);

    const stored = await readHiringSignals();
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => [row.workspace_id, row.watch_id, row.dedup_key])).toEqual([
      ["ws-1", "w-1", "w-1:role-1"],
      ["ws-2", "w-2", "w-2:role-1"],
    ]);
  });

  it("inserts every row across more than one batch", async () => {
    const rows = Array.from({ length: 120 }, (_, index) =>
      hiringSignal({
        id: `sig-${index + 1}`,
        roleId: `role-${index + 1}`,
        url: `https://boards.greenhouse.io/brand/jobs/role-${index + 1}`,
      }),
    );

    await insertHiringSignals(rows);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM signal WHERE kind = 'hiring'",
    ).first<{ n: number }>();
    expect(count?.n).toBe(120);
  });
});

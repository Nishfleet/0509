import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { readEntitySources } from "../../../app/lib/data/source.server";
import { readLastStillCompetitor } from "../../../app/lib/data/jev_verdict.server";

const WS_A = "ws-a";
const WS_B = "ws-b";
const COMP_A = "comp-a";
const COMP_B = "comp-b";
const USER_A = "user-rail-a";
const USER_B = "user-rail-b";
const SITE_SRC = "site-src";
const HIRING_SRC = "hiring-src";
const OTHER_SRC = "other-src";
const SITE_KIND = "site";
const HIRING_KIND = "hiring";
const MENTIONS_KIND = "mentions";
const NOW = "2026-09-24T12:00:00.000Z";

async function seedUser(id: string, email: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Owner', ?, 1, ?, ?)`,
  )
    .bind(id, email, NOW, NOW)
    .run();
}

async function seedWorkspace(id: string, ownerUserId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Owner', ?, 'UTC', 1, 8, ?)`,
  )
    .bind(id, ownerUserId, NOW)
    .run();
}

async function seedEntity(id: string, workspaceId: string, role: "self" | "competitor", domain: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
     VALUES (?, ?, ?, ?, 'Brand', 'on', ?)`,
  )
    .bind(id, workspaceId, role, domain, NOW)
    .run();
}

async function seedSource(id: string, key: string, kind: "ads" | "mentions" | "site" | "hiring", platform: string, configJson = "{}"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
     VALUES (?, ?, ?, ?, ?, 'official_api', 1, ?)`,
  )
    .bind(id, key, kind, platform, key, configJson)
    .run();
}

async function seedWatch(id: string, entityId: string, sourceId: string, targetKey: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key, is_active, config_json)
     VALUES (?, ?, ?, ?, 1, '{}')`,
  )
    .bind(id, entityId, sourceId, targetKey)
    .run();
}

async function seedSnapshot(id: string, watchId: string, fetchedAt: string, itemCount: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash, item_count)
     VALUES (?, ?, NULL, ?, ?, 'hash', ?)`,
  )
    .bind(id, watchId, fetchedAt, `snapshot/${watchId}/${id}.html`, itemCount)
    .run();
}

async function seedVerdict(row: {
  id: string;
  workspaceId: string;
  questionId: string;
  inputHash: string;
  entityId: string | null;
  p: number | null;
  choice: string | null;
  decidedAt: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, choice, reason, decided_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?)`,
  )
    .bind(row.id, row.workspaceId, row.questionId, row.inputHash, row.entityId, row.p, row.choice, row.decidedAt)
    .run();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM jev_verdict").run();
  await env.DB.prepare("DELETE FROM snapshot").run();
  await env.DB.prepare("DELETE FROM watch").run();
  await env.DB.prepare("DELETE FROM entity").run();
  await env.DB.prepare("DELETE FROM source").run();
  await env.DB.prepare("DELETE FROM workspace").run();
  await env.DB.prepare('DELETE FROM "user"').run();

  await seedUser(USER_A, "owner-a@example.test");
  await seedUser(USER_B, "owner-b@example.test");
  await seedWorkspace(WS_A, USER_A);
  await seedWorkspace(WS_B, USER_B);

  await seedEntity(COMP_A, WS_A, "competitor", "alpha.example");
  await seedEntity(COMP_B, WS_B, "competitor", "beta.example");

  await seedSource(SITE_SRC, SITE_SRC, SITE_KIND, "web");
  await seedSource(
    HIRING_SRC,
    HIRING_SRC,
    HIRING_KIND,
    "greenhouse",
    JSON.stringify({
      state: "degraded",
      reason: "rate-limited",
      last_good_at: "2026-09-19T06:02:00.000Z",
    }),
  );
  await seedSource(OTHER_SRC, OTHER_SRC, MENTIONS_KIND, "mentions");

  await seedWatch("watch-site-a-1", COMP_A, SITE_SRC, "/");
  await seedWatch("watch-site-a-2", COMP_A, SITE_SRC, "/pricing");
  await seedWatch("watch-hiring-a", COMP_A, HIRING_SRC, "greenhouse:alpha");
  await seedWatch("watch-mentions-b", COMP_B, OTHER_SRC, "mentions:beta");

  await seedSnapshot("snap-site-a-1", "watch-site-a-1", "2026-09-20T02:00:00.000Z", 1);
  await seedSnapshot("snap-site-a-2", "watch-site-a-2", "2026-09-22T02:00:00.000Z", 3);

  await seedVerdict({
    id: "verdict-still-competitor",
    workspaceId: WS_A,
    questionId: "still_competitor",
    inputHash: "hash-still-competitor",
    entityId: COMP_A,
    p: 0.95,
    choice: null,
    decidedAt: "2026-09-09T00:00:00.000Z",
  });
  await seedVerdict({
    id: "verdict-still-reason-active",
    workspaceId: WS_A,
    questionId: "still_competitor_reason",
    inputHash: "hash-still-reason-active",
    entityId: COMP_A,
    p: null,
    choice: "active",
    decidedAt: "2026-09-10T00:00:00.000Z",
  });
  await seedVerdict({
    id: "verdict-still-reason-dormant",
    workspaceId: WS_A,
    questionId: "still_competitor_reason",
    inputHash: "hash-still-reason-dormant",
    entityId: COMP_A,
    p: null,
    choice: "dormant",
    decidedAt: "2026-09-17T00:00:00.000Z",
  });
  await seedVerdict({
    id: "verdict-still-reason-comp-b",
    workspaceId: WS_B,
    questionId: "still_competitor_reason",
    inputHash: "hash-still-reason-comp-b",
    entityId: COMP_B,
    p: null,
    choice: "active",
    decidedAt: "2026-09-12T00:00:00.000Z",
  });
});

describe("rail readEntitySources", () => {
  it("returns one entry per source watching the competitor, with the latest snapshot joined structurally", async () => {
    const rows = await readEntitySources(WS_A, COMP_A);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.source.kind)).toEqual(["hiring", "site"]);

    const hiring = rows[0];
    expect(hiring.snapshot).toBeNull();
    expect(hiring.source.config_json).toBe(
      JSON.stringify({
        state: "degraded",
        reason: "rate-limited",
        last_good_at: "2026-09-19T06:02:00.000Z",
      }),
    );

    const site = rows[1];
    expect(site.snapshot).toEqual({
      item_count: 3,
      fetched_at: "2026-09-22T02:00:00.000Z",
    });
    expect(rows.find((r) => r.source.key === OTHER_SRC)).toBeUndefined();
  });

  it("scopes by workspace and returns empty when the entity belongs to another workspace", async () => {
    expect(await readEntitySources(WS_B, COMP_A)).toEqual([]);
  });
});

describe("rail readLastStillCompetitor", () => {
  it("returns the most recent verdict for the workspace+entity, never a probability or question id", async () => {
    const verdict = await readLastStillCompetitor(WS_A, COMP_A);
    expect(verdict).toEqual({
      choice: "dormant",
      decidedAt: "2026-09-17T00:00:00.000Z",
    });
    expect(Object.keys(verdict ?? {}).sort()).toEqual(["choice", "decidedAt"]);
  });

  it("is null when the entity has no still_competitor_reason row in this workspace", async () => {
    expect(await readLastStillCompetitor(WS_A, COMP_B)).toBeNull();
  });
});

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { publishCard, unpublishCard } from "../../../app/lib/data/workspace.server";
import { listPublishedCardSlugs } from "../../../app/lib/card/serve.server";

const USER_ID = "user-1";
const WORKSPACE_ID = "ws-1";
const USER_ID_2 = "user-2";
const WORKSPACE_ID_2 = "ws-2";

async function seedWorkspace(workspaceId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, ?, ?)`,
  )
    .bind(userId, "Owner", `${userId}@0509.io`, "2026-09-22T00:00:00Z", "2026-09-22T00:00:00Z")
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, ?, ?, 'UTC', 1, 8, ?)`,
  )
    .bind(workspaceId, "Owner", userId, "2026-09-22T00:00:00Z")
    .run();
}

async function seedTakenDownSubject(workspaceId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, state, state_changed_at, state_reason, state_changed_by, created_at)
     VALUES (?, ?, 'competitor', ?, 'dismissed', ?, 'takedown', 'auto', ?)`,
  )
    .bind("ent-takedown", workspaceId, "removed.example", "2026-09-22T00:00:00Z", "2026-09-22T00:00:00Z")
    .run();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM signal").run();
  await env.DB.prepare("DELETE FROM entity").run();
  await env.DB.prepare("DELETE FROM source").run();
  await env.DB.prepare("DELETE FROM workspace").run();
  await env.DB.prepare('DELETE FROM "user"').run();
  await seedWorkspace(WORKSPACE_ID, USER_ID);
  await seedWorkspace(WORKSPACE_ID_2, USER_ID_2);
});

describe("listPublishedCardSlugs (0509#4405)", () => {
  it("lists nothing while no card is published", async () => {
    expect(await listPublishedCardSlugs()).toEqual([]);
  });

  it("lists exactly the published card's slug", async () => {
    const published = await publishCard(WORKSPACE_ID);
    expect(await listPublishedCardSlugs()).toEqual([published?.slug]);
  });

  it("drops a workspace whose card was unpublished again", async () => {
    const published = await publishCard(WORKSPACE_ID);
    await publishCard(WORKSPACE_ID_2);
    await unpublishCard(WORKSPACE_ID_2);
    expect(await listPublishedCardSlugs()).toEqual([published?.slug]);
  });

  it("lists nothing once the published workspace holds a taken-down subject", async () => {
    const published = await publishCard(WORKSPACE_ID);
    expect(await listPublishedCardSlugs()).toEqual([published?.slug]);

    await seedTakenDownSubject(WORKSPACE_ID);
    expect(await listPublishedCardSlugs()).toEqual([]);
  });
});

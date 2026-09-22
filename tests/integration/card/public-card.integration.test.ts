import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  publishCard,
  readCardSettings,
  readWorkspaceIdForOwner,
  rotateCardSlug,
  unpublishCard,
} from "../../../app/lib/data/workspace.server";
import { serveCard } from "../../../app/lib/card/serve.server";

// Engine 9 P9.1 (#3969) against real workerd and real local D1 with the real
// migrations applied (tests/integration/apply-migrations.ts). The unit under
// test is the one unauthenticated surface in the product, so what these assert
// is mostly refusals: every one of them is a 404 and none is a 403.

const USER_ID = "user-1";
const WORKSPACE_ID = "ws-1";

async function seedWorkspace(workspaceId = WORKSPACE_ID, userId = USER_ID): Promise<void> {
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

async function seedArtifact(workspaceId: string, weekStartAt: string, html: string): Promise<string> {
  const key = `card/${workspaceId}/${weekStartAt}/index.html`;
  await env.CARD_ARTIFACTS.put(key, html, { httpMetadata: { contentType: "text/html" } });
  return key;
}

async function seedSubjectWithPrivateMention(workspaceId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, state, created_at)
     VALUES (?, ?, 'competitor', ?, '{}', 'on', ?)`,
  )
    .bind("ent-private", workspaceId, "competitor.example", "2026-09-22T00:00:00Z")
    .run();
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
     VALUES ('src-private', 'mentions:private', 'mentions', 'reddit', 'private', 'scraped_page')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, summary, canonical_url, url_hash, payload_json, dedup_key, observed_at)
     VALUES ('sig-private', ?, 'ent-private', 'src-private', 'mention', ?, ?, ?, 'hash-private', '{}', 'dedup-private', ?)`,
  )
    .bind(workspaceId, "private headline", "LEAK-MARKER-Private-Mention-Body", "https://competitor.example/post", "2026-09-22T00:00:00Z")
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
  const listed = await env.CARD_ARTIFACTS.list();
  for (const object of listed.objects) await env.CARD_ARTIFACTS.delete(object.key);
  await seedWorkspace();
});

describe("card publish state (0003_card_publish.sql)", () => {
  it("starts unpublished with no slug", async () => {
    const settings = await readCardSettings(WORKSPACE_ID);
    expect(settings).toEqual({ published: false, slug: null });
  });

  it("mints an opaque url-safe slug on publish and keeps it on a second publish", async () => {
    const first = await publishCard(WORKSPACE_ID);
    expect(first?.published).toBe(true);
    expect(first?.slug).toMatch(/^[a-z0-9]{22}$/);

    const second = await publishCard(WORKSPACE_ID);
    expect(second?.slug).toBe(first?.slug);
  });

  it("rotates to a new slug and unpublishes without losing it", async () => {
    const first = await publishCard(WORKSPACE_ID);
    const rotated = await rotateCardSlug(WORKSPACE_ID);
    expect(rotated).not.toBe(first?.slug);
    expect(rotated).toMatch(/^[a-z0-9]{22}$/);

    await unpublishCard(WORKSPACE_ID);
    const settings = await readCardSettings(WORKSPACE_ID);
    expect(settings).toEqual({ published: false, slug: rotated });

    const republished = await publishCard(WORKSPACE_ID);
    expect(republished?.slug).toBe(rotated);
  });

  it("never gives two workspaces the same slug (the UNIQUE index is the guarantee)", async () => {
    await seedWorkspace("ws-2", "user-2");
    const a = await publishCard(WORKSPACE_ID);
    const b = await publishCard("ws-2");
    expect(a?.slug).not.toBe(b?.slug);

    await expect(
      env.DB.prepare("UPDATE workspace SET card_slug = ? WHERE id = ?").bind(a?.slug, "ws-2").run(),
    ).rejects.toThrow(/UNIQUE/);
  });

  it("resolves the owner's workspace read-only", async () => {
    expect(await readWorkspaceIdForOwner(USER_ID)).toBe(WORKSPACE_ID);
    expect(await readWorkspaceIdForOwner("nobody")).toBeNull();
  });
});

describe("the public serve path", () => {
  it("404s an unknown slug", async () => {
    const response = await serveCard("does-not-exist");
    expect(response.status).toBe(404);
  });

  it("404s a known slug while the card is off, and never 403s", async () => {
    const settings = await publishCard(WORKSPACE_ID);
    await seedArtifact(WORKSPACE_ID, "2026-09-21T00:00:00Z", "<html>card</html>");
    await unpublishCard(WORKSPACE_ID);

    const response = await serveCard(settings?.slug ?? "");
    expect(response.status).toBe(404);
  });

  it("serves the artifact with s-maxage=60 when published", async () => {
    const settings = await publishCard(WORKSPACE_ID);
    await seedArtifact(WORKSPACE_ID, "2026-09-21T00:00:00Z", "<html>card</html>");

    const response = await serveCard(settings?.slug ?? "");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=60");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe("<html>card</html>");
  });

  it("serves the newest week when more than one render exists", async () => {
    const settings = await publishCard(WORKSPACE_ID);
    await seedArtifact(WORKSPACE_ID, "2026-09-14T00:00:00Z", "<html>last week</html>");
    await seedArtifact(WORKSPACE_ID, "2026-09-21T00:00:00Z", "<html>this week</html>");

    const response = await serveCard(settings?.slug ?? "");
    expect(await response.text()).toBe("<html>this week</html>");
  });

  it("serves the newest week across more R2 keys than one list page", async () => {
    const settings = await publishCard(WORKSPACE_ID);
    for (let day = 1; day <= 120; day += 1) {
      const stamp = `2026-09-${String((day % 28) + 1).padStart(2, "0")}T00:00:00Z`;
      await seedArtifact(WORKSPACE_ID, `${stamp}-${String(day).padStart(3, "0")}`, `<html>week ${day}</html>`);
    }
    await seedArtifact(WORKSPACE_ID, "2026-09-30T00:00:00Z-latest", "<html>newest</html>");

    const response = await serveCard(settings?.slug ?? "");
    expect(await response.text()).toBe("<html>newest</html>");
  });

  it("404s a published slug whose render has not happened", async () => {
    const settings = await publishCard(WORKSPACE_ID);
    const response = await serveCard(settings?.slug ?? "");
    expect(response.status).toBe(404);
  });

  it("404s the old slug immediately after a rotation, and the new one still serves", async () => {
    const first = await publishCard(WORKSPACE_ID);
    await seedArtifact(WORKSPACE_ID, "2026-09-21T00:00:00Z", "<html>card</html>");
    const rotated = await rotateCardSlug(WORKSPACE_ID);

    expect((await serveCard(first?.slug ?? "")).status).toBe(404);
    expect((await serveCard(rotated ?? "")).status).toBe(200);
  });

  it("404s at serve time for a workspace holding a taken-down subject", async () => {
    const settings = await publishCard(WORKSPACE_ID);
    await seedArtifact(WORKSPACE_ID, "2026-09-21T00:00:00Z", "<html>card</html>");
    expect((await serveCard(settings?.slug ?? "")).status).toBe(200);

    await seedTakenDownSubject(WORKSPACE_ID);
    expect((await serveCard(settings?.slug ?? "")).status).toBe(404);
  });

  it("streams the artifact verbatim: DB content never reaches the response body", async () => {
    const settings = await publishCard(WORKSPACE_ID);
    await seedSubjectWithPrivateMention(WORKSPACE_ID);
    await seedArtifact(WORKSPACE_ID, "2026-09-21T00:00:00Z", "<html>card without the private mention</html>");

    // The private row is really there: without this the absence assertion below
    // would pass on an empty database and prove nothing.
    const stored = await env.DB.prepare("SELECT summary FROM signal WHERE id = 'sig-private'").first<{ summary: string }>();
    expect(stored?.summary).toContain("LEAK-MARKER");

    const response = await serveCard(settings?.slug ?? "");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>card without the private mention</html>");
  });
});

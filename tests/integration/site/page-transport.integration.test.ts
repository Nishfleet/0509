import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  markPageDeferred,
  recordPageTransport,
} from "../../../app/lib/data/page.server";
import { readSiteSweepTargets } from "../../../app/lib/data/watch.server";

const USER = "user-page-transport";
const WS = "ws-page-transport";
const NOW = "2026-09-25T02:00:00Z";

const seed = async () => {
  await env.DB.exec("DELETE FROM signal");
  await env.DB.exec("DELETE FROM snapshot");
  await env.DB.exec("DELETE FROM watch");
  await env.DB.exec("DELETE FROM page");
  await env.DB.exec("DELETE FROM entity");
  await env.DB.exec("DELETE FROM workspace");
  await env.DB.exec('DELETE FROM "user"');

  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Reader', 'page-transport@0509.io', 1, ?, ?)`,
  )
    .bind(USER, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Page transport', ?, 'UTC', 1, 8, ?)`,
  )
    .bind(WS, USER, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, 'competitor', 'rival.com', '{}', 'manual', 'on', ?)`,
  )
    .bind("ent-rival", WS, NOW)
    .run();
};

const insertPageAndWatch = async () => {
  const pageId = "page-rival-home";
  const watchId = "watch-rival-home";
  const sourceId = await env.DB.prepare(
    "SELECT id AS id FROM source WHERE key = 'site.web'",
  ).first<{ id: string }>();
  if (sourceId === null) throw new Error("site.web source missing");
  await env.DB.prepare(
    `INSERT INTO page (id, entity_id, url, role, discovered_at)
     VALUES (?, 'ent-rival', 'https://rival.com/', 'home', ?)`,
  )
    .bind(pageId, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key)
     VALUES (?, 'ent-rival', ?, 'https://rival.com/')`,
  )
    .bind(watchId, sourceId.id)
    .run();
  return { pageId, watchId };
};

describe("page row stores its learned transport and deferred-at (0509#5297)", () => {
  beforeEach(async () => {
    await seed();
  });

  it("round-trips a learned transport through SITE_SWEEP_TARGETS and the page row", async () => {
    const { pageId } = await insertPageAndWatch();

    const before = await readSiteSweepTargets("site.web");
    const target = before.find((t) => t.pageId === pageId);
    if (target === undefined) throw new Error("expected the rival's homepage target");
    expect(target.transport).toBeNull();
    expect(target.transportTestedAt).toBeNull();

    await markPageDeferred(pageId, "2026-09-25T02:00:00Z");

    const deferredRow = await env.DB.prepare(
      "SELECT transport_reason, deferred_at FROM page WHERE id = ?",
    )
      .bind(pageId)
      .first<{ transport_reason: string | null; deferred_at: string | null }>();
    expect(deferredRow).toEqual({ transport_reason: null, deferred_at: "2026-09-25T02:00:00Z" });

    await recordPageTransport({
      pageId,
      transport: "browser",
      reason: "thin-text",
      testedAt: "2026-09-25T02:00:00Z",
    });

    const after = await readSiteSweepTargets("site.web");
    const updated = after.find((t) => t.pageId === pageId);
    if (updated === undefined) throw new Error("expected the rival's homepage target");
    expect(updated.transport).toBe("browser");
    expect(updated.transportTestedAt).toBe("2026-09-25T02:00:00Z");

    const writtenRow = await env.DB.prepare(
      "SELECT transport_reason, deferred_at FROM page WHERE id = ?",
    )
      .bind(pageId)
      .first<{ transport_reason: string | null; deferred_at: string | null }>();
    expect(writtenRow).toEqual({ transport_reason: "thin-text", deferred_at: null });
  });
});

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkPage } from "../../../app/lib/site/check-page.server";

const readHolder = vi.hoisted(() => {
  type HeldRead =
    | {
        ok: true;
        html: string;
        transport: "fetch";
        status: number;
        ms: number;
        escalated: boolean;
      }
    | { ok: false; reason: "escalation-failed"; detail: string };

  const fresh = (): HeldRead => ({
    ok: true,
    html: "",
    transport: "fetch",
    status: 200,
    ms: 1,
    escalated: false,
  });

  return { current: fresh(), fresh };
});

vi.mock("../../../app/lib/fetch/transport.server", () => ({
  readUrl: () => Promise.resolve(readHolder.current),
}));

const USER = "user-check-page";
const WS = "ws-check-page";
const ENTITY = "ent-check-page";
const SOURCE = "src-check-page";
const PAGE = "page-check-page";
const WATCH = "watch-check-page";
const URL = "https://competitor.example/pricing";
const NOW = "2026-09-23T00:00:00Z";

const FIRST_HTML = `<!doctype html><html><body><h1>Pricing</h1><p>Plan costs ten dollars.</p></body></html>`;
const CHANGED_HTML = `<!doctype html><html><body><h1>Pricing</h1><p>Plan costs twenty dollars.</p></body></html>`;

const seed = async () => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Reader', 'check-page@0509.io', 1, ?, ?)`,
  )
    .bind(USER, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Check page', ?, 'UTC', 1, 8, ?)`,
  )
    .bind(WS, USER, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, 'competitor', 'competitor.example', '{}', 'manual', 'on', ?)`,
  )
    .bind(ENTITY, WS, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key)
     VALUES (?, 'site-test', 'site', 'web', 'site')`,
  )
    .bind(SOURCE)
    .run();
  await env.DB.prepare(
    `INSERT INTO page (id, entity_id, url, discovered_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(PAGE, ENTITY, URL, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(WATCH, ENTITY, SOURCE, URL)
    .run();
};

const snapshotCount = async () => {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM snapshot WHERE watch_id = ?",
  )
    .bind(WATCH)
    .first<{ n: number }>();
  return row?.n ?? 0;
};

const distinctKeys = async () => {
  const rows = await env.DB.prepare(
    "SELECT DISTINCT payload_r2_key AS key FROM snapshot WHERE watch_id = ?",
  )
    .bind(WATCH)
    .all<{ key: string | null }>();
  return rows.results;
};

const objectCount = async () => {
  const listed = await env.SNAPSHOTS.list({ prefix: "snapshot/site/" });
  return listed.objects.length;
};

describe("checkPage (0509#4433)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM snapshot");
    await env.DB.exec("DELETE FROM watch");
    await env.DB.exec("DELETE FROM page");
    await env.DB.exec("DELETE FROM source");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    const listed = await env.SNAPSHOTS.list({ prefix: "snapshot/site/" });
    for (const object of listed.objects) await env.SNAPSHOTS.delete(object.key);
    await seed();
    readHolder.current = { ...readHolder.fresh(), html: FIRST_HTML };
  });

  it("records a first snapshot, then an unchanged reuse, then a change, then a failed read, and never names a before screenshot that was not stored (0509#4569)", async () => {
    const first = await checkPage({ watchId: WATCH, pageId: PAGE, url: URL });
    expect(first.outcome).toBe("first");
    if (first.outcome !== "first") throw new Error("expected first");
    expect(first.screenshotKey).toBeNull();
    expect(await snapshotCount()).toBe(1);
    const stored = await env.SNAPSHOTS.get(first.textKey);
    expect(await stored?.text()).toBe("Pricing Plan costs ten dollars.");

    const same = await checkPage({ watchId: WATCH, pageId: PAGE, url: URL });
    expect(same.outcome).toBe("unchanged");
    if (same.outcome !== "unchanged") throw new Error("expected unchanged");
    expect(same.snapshotId).not.toBe(first.snapshotId);
    expect(await snapshotCount()).toBe(2);
    const keys = await distinctKeys();
    expect(keys).toEqual([{ key: first.textKey }]);
    expect(await objectCount()).toBe(1);

    readHolder.current = { ...readHolder.fresh(), html: CHANGED_HTML };
    const changed = await checkPage({ watchId: WATCH, pageId: PAGE, url: URL });
    expect(changed.outcome).toBe("changed");
    if (changed.outcome !== "changed") throw new Error("expected changed");
    expect(changed.previousTextKey).toBe(first.textKey);
    expect(changed.previousScreenshotKey).toBeNull();
    expect(changed.screenshotKey).toBeNull();
    expect(changed.status).toBe(200);
    expect(changed.transport).toBe("fetch");
    expect(await snapshotCount()).toBe(3);
    expect(await objectCount()).toBe(2);

    const beforePng = changed.textKey.replace(/\.txt$/, ".png");
    await env.SNAPSHOTS.put(beforePng, new Uint8Array([137, 80, 78, 71]));
    readHolder.current = { ...readHolder.fresh(), html: FIRST_HTML };
    const back = await checkPage({ watchId: WATCH, pageId: PAGE, url: URL });
    if (back.outcome !== "changed") throw new Error("expected changed");
    expect(back.previousScreenshotKey).toBe(beforePng);
    expect(await snapshotCount()).toBe(4);

    readHolder.current = { ok: false, reason: "escalation-failed", detail: "x" };
    const failed = await checkPage({ watchId: WATCH, pageId: PAGE, url: URL });
    expect(failed).toEqual({ outcome: "failed", reason: "escalation-failed", detail: "x" });
    expect(await snapshotCount()).toBe(4);
  });
});

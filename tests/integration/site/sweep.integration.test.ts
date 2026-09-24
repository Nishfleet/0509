import { env, introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkSitePage, planSiteSweep, publishSiteChange } from "../../../app/lib/site/sweep.server";

const readHolder = { html: "" };
const calls: string[] = [];

const PAD =
  "Every plan includes unlimited projects, priority support, single sign-on, audit logs, and a named account manager who answers within one business day, with onboarding help for your whole team.";

const USER = "user-site-sweep";
const WS = "ws-site-sweep";
const NOW = "2026-09-24T02:00:00Z";

const BEFORE_HTML = `<!doctype html><html><body><h1>Rival</h1><p>Plans start at ten dollars a month.</p><p>${PAD}</p></body></html>`;
const AFTER_HTML = `<!doctype html><html><body><h1>Rival</h1><p>Plans start at twelve dollars a month. New: team seats.</p><p>${PAD}</p></body></html>`;

const nextTick = async (name: string) => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return { instanceId: name, plannedAt: new Date().toISOString() };
};

const seedEntity = (id: string, role: "self" | "competitor", domain: string, state: "on" | "off") =>
  env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, ?, ?, '{}', 'manual', ?, ?)`,
  )
    .bind(id, WS, role, domain, state, NOW)
    .run();

const signals = async () => {
  const rows = await env.DB.prepare(
    "SELECT entity_id, source_id, kind, aspect, url, evidence_url, snapshot_id, payload_json FROM signal WHERE workspace_id = ?",
  )
    .bind(WS)
    .all<{
      entity_id: string;
      source_id: string;
      kind: string;
      aspect: string;
      url: string;
      evidence_url: string;
      snapshot_id: string;
      payload_json: string;
    }>();
  return rows.results;
};

describe("nightly site sweep", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM signal");
    await env.DB.exec("DELETE FROM snapshot");
    await env.DB.exec("DELETE FROM watch");
    await env.DB.exec("DELETE FROM page");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    const listed = await env.SNAPSHOTS.list({ prefix: "snapshot/site/" });
    await Promise.all(listed.objects.map((object) => env.SNAPSHOTS.delete(object.key)));

    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', 'site-sweep@0509.io', 1, ?, ?)`,
    )
      .bind(USER, NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Sweep', ?, 'UTC', 1, 8, ?)`,
    )
      .bind(WS, USER, NOW)
      .run();
    await seedEntity("ent-self", "self", "mybrand.com", "on");
    await seedEntity("ent-rival", "competitor", "rival.com", "on");
    await seedEntity("ent-paused", "competitor", "paused.com", "off");
    await seedEntity("ent-handle", "competitor", "somecreator", "on");
    readHolder.html = BEFORE_HTML;
    calls.length = 0;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push([init?.method ?? "GET", url].join(" "));
      return Promise.resolve(new Response(readHolder.html, { status: 200 }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("files under the website source row that migration 0011 seeds", async () => {
    const row = await env.DB.prepare("SELECT key, kind, is_enabled FROM source WHERE id = 'src_site_web'").first();
    expect(row).toEqual({ key: "site.web", kind: "site", is_enabled: 1 });
  });

  it("plans the homepage of every tracked brand with a website, once", async () => {
    const targets = await planSiteSweep(NOW);
    expect(targets.map((t) => [t.entityId, t.url, t.pageRole])).toEqual([
      ["ent-rival", "https://rival.com/", "home"],
      ["ent-self", "https://mybrand.com/", "home"],
    ]);

    const again = await planSiteSweep(NOW);
    expect(again).toEqual(targets);
    const pages = await env.DB.prepare("SELECT COUNT(*) AS n FROM page").first<{ n: number }>();
    const watches = await env.DB.prepare("SELECT COUNT(*) AS n FROM watch").first<{ n: number }>();
    expect(pages?.n).toBe(2);
    expect(watches?.n).toBe(2);
  });

  it("keeps the first read as the baseline, files nothing for an unchanged night, and files one change with its before and after", async () => {
    const [rival] = (await planSiteSweep(NOW)).filter((t) => t.entityId === "ent-rival");
    if (rival === undefined) throw new Error("expected the rival's homepage");

    const first = await checkSitePage(rival, await nextTick("night-1"));
    expect(first.outcome).toBe("first");
    const same = await checkSitePage(rival, await nextTick("night-2"));
    expect(same.outcome).toBe("unchanged");
    expect(await signals()).toEqual([]);

    readHolder.html = AFTER_HTML;
    const night3 = await nextTick("night-3");
    const changed = await checkSitePage(rival, night3);
    const retried = await checkSitePage(rival, night3);
    expect(retried).toEqual(changed);
    if (changed.outcome !== "changed" || first.outcome !== "first" || same.outcome !== "unchanged") throw new Error("expected a change");
    await publishSiteChange(rival, changed);
    await publishSiteChange(rival, changed);

    const filed = await signals();
    expect(filed).toHaveLength(1);
    const [signal] = filed;
    expect(signal).toMatchObject({
      entity_id: "ent-rival",
      source_id: "src_site_web",
      kind: "change",
      aspect: "home",
      url: "https://rival.com/",
      evidence_url: "https://rival.com/",
      snapshot_id: changed.snapshotId,
    });
    const payload: unknown = JSON.parse(signal?.payload_json ?? "null");
    expect(payload).toMatchObject({
      page: { role: "home", url: "https://rival.com/" },
      before: { snapshotId: same.snapshotId, textKey: first.textKey, screenshotKey: null },
      after: { snapshotId: changed.snapshotId, textKey: changed.textKey, screenshotKey: null },
      wordsAdded: 4,
      wordsRemoved: 1,
      status: 200,
      transport: "fetch",
    });

    const diffKey = `snapshot/site/${rival.watchId}/${changed.snapshotId}.diff.json`;
    expect(payload).toMatchObject({ diffKey });
    const stored = await env.SNAPSHOTS.get(diffKey);
    const diff: unknown = JSON.parse((await stored?.text()) ?? "null");
    expect(diff).toMatchObject({ hunks: [expect.objectContaining({ lines: expect.any(Array) })] });

    const polled = await env.DB.prepare("SELECT last_polled_at FROM watch WHERE id = ?")
      .bind(rival.watchId)
      .first<{ last_polled_at: string | null }>();
    expect(polled?.last_polled_at).not.toBeNull();
  });

  it("counts one snapshot per page per night even when the check step is retried", async () => {
    const [rival] = (await planSiteSweep(NOW)).filter((t) => t.entityId === "ent-rival");
    if (rival === undefined) throw new Error("expected the rival's homepage");
    const night = await nextTick("night-retry");
    await checkSitePage(rival, night);
    await checkSitePage(rival, night);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM snapshot WHERE watch_id = ?")
      .bind(rival.watchId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("stops planning a brand once it is turned off", async () => {
    await planSiteSweep(NOW);
    await env.DB.prepare("UPDATE entity SET state = 'off' WHERE id = 'ent-rival'").run();
    const targets = await planSiteSweep(NOW);
    expect(targets.map((t) => t.entityId)).toEqual(["ent-self"]);
  });

  it("pings the sweep's own monitor once, from its last step, when the run completes", async () => {
    const id = "sweep-ping";
    await using introspector = await introspectWorkflowInstance(env.SITE_SWEEP, id);
    await env.SITE_SWEEP.create({ id });
    await introspector.waitForStatus("complete");

    expect(calls.filter((call) => call === "POST https://hc-ping.example/site-sweep")).toHaveLength(1);
    expect(await introspector.getOutput()).toMatchObject({ pages: 2 });
  });
});

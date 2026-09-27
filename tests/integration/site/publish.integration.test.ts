import { env } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publishChange } from "../../../app/lib/site/publish.server";
import type { ChangeJudgment } from "../../../app/lib/site/judge.server";
import {
  acknowledgeIncidentAlert,
  readOpenIncidentBlock,
} from "../../../app/lib/data/alert.server";

const NOW = "2026-09-23T00:00:00.000Z";
const USER = "user-publish";
const SELF_WS = "ws-publish-self";
const COMP_WS = "ws-publish-comp";
const SOURCE = "src-publish";
const SELF_ENTITY = "ent-publish-self";
const COMP_ENTITY = "ent-publish-comp";
const SELF_PAGE = "page-publish-self";
const COMP_PAGE = "page-publish-comp";
const SELF_WATCH = "watch-publish-self";
const COMP_WATCH = "watch-publish-comp";
const SELF_URL = "https://publish-self.example.com/";
const COMP_URL = "https://publish-comp.example.com/pricing";

async function seedUser(id: string, email: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Reader', ?, 1, ?, ?)`,
  )
    .bind(id, email, NOW, NOW)
    .run();
}

async function seedWorkspace(id: string, owner: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, ?, ?, 'UTC', 1, 8, ?)`,
  )
    .bind(id, id, owner, NOW)
    .run();
}

async function seedEntity(id: string, ws: string, role: "self" | "competitor"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, ?, ?, '{}', 'manual', 'on', ?)`,
  )
    .bind(id, ws, role, `${id}.example`, NOW)
    .run();
}

async function seedSource(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key)
     VALUES (?, 'site-publish', 'site', 'web', 'site')`,
  )
    .bind(id)
    .run();
}

async function seedPage(id: string, entity: string, url: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO page (id, entity_id, url, discovered_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, entity, url, NOW)
    .run();
}

async function seedWatch(id: string, entity: string, source: string, url: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, entity, source, url)
    .run();
}

async function seedSnapshot(id: string, watch: string, page: string, r2Key: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash)
     VALUES (?, ?, ?, ?, ?, 'h-pre')`,
  )
    .bind(id, watch, page, NOW, r2Key)
    .run();
}

const baseInput = (
  judgment: ChangeJudgment,
  overrides: {
    workspaceId: string;
    entityId: string;
    watchId: string;
    pageId: string;
    url: string;
    snapshotId: string;
  },
) => ({
  workspaceId: overrides.workspaceId,
  entityId: overrides.entityId,
  sourceId: SOURCE,
  watchId: overrides.watchId,
  pageId: overrides.pageId,
  snapshotId: overrides.snapshotId,
  url: overrides.url,
  judgment,
  textKey: `snapshot/site/${overrides.watchId}/new.txt`,
  previousTextKey: `snapshot/site/${overrides.watchId}/old.txt`,
  screenshotKey: `snapshot/site/${overrides.watchId}/new.png`,
  previousScreenshotKey: `snapshot/site/${overrides.watchId}/old.png`,
});

let send: ReturnType<typeof vi.spyOn>;

describe("publishChange (0509#4435)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    send = vi.spyOn(workerEnv.SEND_EMAIL, "send").mockResolvedValue(undefined);
    await env.DB.exec("DELETE FROM alert");
    await env.DB.exec("DELETE FROM incident");
    await env.DB.exec("DELETE FROM snapshot");
    await env.DB.exec("DELETE FROM signal");
    await env.DB.exec("DELETE FROM watch");
    await env.DB.exec("DELETE FROM page");
    await env.DB.exec("DELETE FROM source");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await seedUser(USER, "publish@0509.io");
    await seedWorkspace(SELF_WS, USER);
    await seedWorkspace(COMP_WS, USER);
    await seedEntity(SELF_ENTITY, SELF_WS, "self");
    await seedEntity(COMP_ENTITY, COMP_WS, "competitor");
    await seedSource(SOURCE);
    await seedPage(SELF_PAGE, SELF_ENTITY, SELF_URL);
    await seedPage(COMP_PAGE, COMP_ENTITY, COMP_URL);
    await seedWatch(SELF_WATCH, SELF_ENTITY, SOURCE, SELF_URL);
    await seedWatch(COMP_WATCH, COMP_ENTITY, SOURCE, COMP_URL);
    await seedSnapshot("snap-publish-a", COMP_WATCH, COMP_PAGE, "snapshot/site/comp-watch/snap-publish-a.txt");
    await seedSnapshot("snap-publish-b", COMP_WATCH, COMP_PAGE, "snapshot/site/comp-watch/snap-publish-b.txt");
    await seedSnapshot("snap-publish-c", COMP_WATCH, COMP_PAGE, "snapshot/site/comp-watch/snap-publish-c.txt");
    await seedSnapshot("snap-publish-d", COMP_WATCH, COMP_PAGE, "snapshot/site/comp-watch/snap-publish-d.txt");
    await seedSnapshot("snap-publish-e", SELF_WATCH, SELF_PAGE, "snapshot/site/self-watch/snap-publish-e.txt");
    await seedSnapshot("snap-publish-f-1", SELF_WATCH, SELF_PAGE, "snapshot/site/self-watch/snap-publish-f-1.txt");
    await seedSnapshot("snap-publish-f-2", SELF_WATCH, SELF_PAGE, "snapshot/site/self-watch/snap-publish-f-2.txt");
    await seedSnapshot("snap-publish-g", SELF_WATCH, SELF_PAGE, "snapshot/site/self-watch/snap-publish-g.txt");
    await seedSnapshot("snap-publish-h", SELF_WATCH, SELF_PAGE, "snapshot/site/self-watch/snap-publish-h.txt");
  });

  it("(a) competitor noteworthy publish kind pricing → one change signal with aspect pricing and the four keys in payload_json", async () => {
    const snapshotId = "snap-publish-a";
    const result = await publishChange(
      baseInput(
        {
          deferred: false,
          selfBreakage: null,
          noteworthy: { p: 0.92, kind: "pricing", band: "publish", reason: "big plans moved" },
        },
        {
          workspaceId: COMP_WS,
          entityId: COMP_ENTITY,
          watchId: COMP_WATCH,
          pageId: COMP_PAGE,
          url: COMP_URL,
          snapshotId,
        },
      ),
    );
    expect(result).toEqual({ signalId: expect.any(String), incidentId: null, alertId: null });
    const signals = await env.DB.prepare(
      "SELECT id, kind, aspect, payload_json, dedup_key FROM signal",
    ).all<{ id: string; kind: string; aspect: string; payload_json: string; dedup_key: string }>();
    expect(signals.results).toEqual([
      {
        id: result.signalId,
        kind: "change",
        aspect: "pricing",
        payload_json: expect.stringMatching(/"textKey":".+\/new\.txt"/),
        dedup_key: snapshotId,
      },
    ]);
    expect(JSON.parse(signals.results[0].payload_json)).toMatchObject({
      textKey: expect.stringContaining("new.txt"),
      previousTextKey: expect.stringContaining("old.txt"),
      screenshotKey: expect.stringContaining("new.png"),
      previousScreenshotKey: expect.stringContaining("old.png"),
      p: 0.92,
      band: "publish",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("(b) competitor noteworthy uncertain → one signal whose payload_json band is uncertain", async () => {
    const snapshotId = "snap-publish-b";
    const result = await publishChange(
      baseInput(
        {
          deferred: false,
          selfBreakage: null,
          noteworthy: { p: 0.4, kind: "copy", band: "uncertain", reason: "headline softened" },
        },
        {
          workspaceId: COMP_WS,
          entityId: COMP_ENTITY,
          watchId: COMP_WATCH,
          pageId: COMP_PAGE,
          url: COMP_URL,
          snapshotId,
        },
      ),
    );
    expect(result.signalId).toEqual(expect.any(String));
    const signals = await env.DB.prepare(
      "SELECT aspect, payload_json FROM signal",
    ).all<{ aspect: string; payload_json: string }>();
    expect(signals.results).toHaveLength(1);
    expect(signals.results[0].aspect).toBe("copy");
    expect(JSON.parse(signals.results[0].payload_json).band).toBe("uncertain");
  });

  it("(c) competitor discard → no rows in signal, incident, alert", async () => {
    const result = await publishChange(
      baseInput(
        {
          deferred: false,
          selfBreakage: null,
          noteworthy: { p: 0.05, kind: "noise", band: "discard", reason: "css jitter" },
        },
        {
          workspaceId: COMP_WS,
          entityId: COMP_ENTITY,
          watchId: COMP_WATCH,
          pageId: COMP_PAGE,
          url: COMP_URL,
          snapshotId: "snap-publish-c",
        },
      ),
    );
    expect(result).toEqual({ signalId: null, incidentId: null, alertId: null });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM signal").first<{ n: number }>()).toMatchObject({ n: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM incident").first<{ n: number }>()).toMatchObject({ n: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM alert").first<{ n: number }>()).toMatchObject({ n: 0 });
  });

  it("(d) deferred: true → no rows", async () => {
    const result = await publishChange(
      baseInput(
        {
          deferred: true,
          selfBreakage: null,
          noteworthy: null,
        },
        {
          workspaceId: COMP_WS,
          entityId: COMP_ENTITY,
          watchId: COMP_WATCH,
          pageId: COMP_PAGE,
          url: COMP_URL,
          snapshotId: "snap-publish-d",
        },
      ),
    );
    expect(result).toEqual({ signalId: null, incidentId: null, alertId: null });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM signal").first<{ n: number }>()).toMatchObject({ n: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM incident").first<{ n: number }>()).toMatchObject({ n: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM alert").first<{ n: number }>()).toMatchObject({ n: 0 });
  });

  it("(e) self selfBreakage alert → signal breakage, one open incident, one alert high linked to both", async () => {
    const snapshotId = "snap-publish-e";
    const result = await publishChange(
      baseInput(
        {
          deferred: false,
          selfBreakage: { p: 0.81, band: "alert", reason: "checkout button gone" },
          noteworthy: null,
        },
        {
          workspaceId: SELF_WS,
          entityId: SELF_ENTITY,
          watchId: SELF_WATCH,
          pageId: SELF_PAGE,
          url: SELF_URL,
          snapshotId,
        },
      ),
    );
    expect(result.signalId).toEqual(expect.any(String));
    expect(result.incidentId).toEqual(expect.any(String));
    expect(result.alertId).toEqual(expect.any(String));
    const signals = await env.DB.prepare("SELECT id, aspect, payload_json FROM signal").all<{
      id: string;
      aspect: string;
      payload_json: string;
    }>();
    expect(signals.results.map((row) => ({ id: row.id, aspect: row.aspect }))).toEqual([
      { id: result.signalId, aspect: "breakage" },
    ]);
    const incident = await env.DB.prepare("SELECT id, kind, opened_at, closed_at FROM incident").first<{
      id: string;
      kind: string;
      opened_at: string;
      closed_at: string | null;
    }>();
    expect(incident).toEqual({
      id: result.incidentId,
      kind: "breakage",
      opened_at: expect.any(String),
      closed_at: null,
    });
    const alerts = await env.DB.prepare(
      "SELECT id, kind, severity, incident_id, signal_id FROM alert",
    ).all<{
      id: string;
      kind: string;
      severity: string;
      incident_id: string | null;
      signal_id: string | null;
    }>();
    expect(alerts.results).toEqual([
      {
        id: result.alertId,
        kind: "own_site_broken",
        severity: "high",
        incident_id: result.incidentId,
        signal_id: result.signalId,
      },
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ incident_id: incident?.id });
    const payload = JSON.parse(signals.results[0].payload_json) as {
      seenAt: string;
      recheckAt: string;
    };
    expect(payload.seenAt).toBe(incident?.opened_at);
    expect(Date.parse(payload.recheckAt)).toBeGreaterThan(Date.parse(payload.seenAt));
  });

  it("(f) own-site break on the same page with a fresh snapshot still leaves one open incident and one alert", async () => {
    const first = await publishChange(
      baseInput(
        {
          deferred: false,
          selfBreakage: { p: 0.81, band: "alert", reason: "checkout button gone" },
          noteworthy: null,
        },
        {
          workspaceId: SELF_WS,
          entityId: SELF_ENTITY,
          watchId: SELF_WATCH,
          pageId: SELF_PAGE,
          url: SELF_URL,
          snapshotId: "snap-publish-f-1",
        },
      ),
    );
    const second = await publishChange(
      baseInput(
        {
          deferred: false,
          selfBreakage: { p: 0.71, band: "alert", reason: "still down" },
          noteworthy: null,
        },
        {
          workspaceId: SELF_WS,
          entityId: SELF_ENTITY,
          watchId: SELF_WATCH,
          pageId: SELF_PAGE,
          url: SELF_URL,
          snapshotId: "snap-publish-f-2",
        },
      ),
    );
    expect(first.incidentId).toBeTruthy();
    expect(second.incidentId).toBeNull();
    expect(second.alertId).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ incident_id: first.incidentId });
    const incidents = await env.DB.prepare(
      "SELECT id, closed_at FROM incident",
    ).all<{ id: string; closed_at: string | null }>();
    expect(incidents.results).toEqual([{ id: first.incidentId, closed_at: null }]);
    const alerts = await env.DB.prepare("SELECT id FROM alert WHERE kind = 'own_site_broken'").all<{ id: string }>();
    expect(alerts.results).toHaveLength(1);
    expect(alerts.results[0].id).toBe(first.alertId);
    const signals = await env.DB.prepare("SELECT COUNT(*) AS n FROM signal").first<{ n: number }>();
    expect(signals).toMatchObject({ n: 2 });
  });

  it("(g) self selfBreakage check p 0.3 on a fresh page → one open incident, one normal alert, no email", async () => {
    const result = await publishChange(
      baseInput(
        {
          deferred: false,
          selfBreakage: { p: 0.3, band: "check", reason: "nav shifted" },
          noteworthy: null,
        },
        {
          workspaceId: SELF_WS,
          entityId: SELF_ENTITY,
          watchId: SELF_WATCH,
          pageId: SELF_PAGE,
          url: SELF_URL,
          snapshotId: "snap-publish-g",
        },
      ),
    );
    expect(result.incidentId).toEqual(expect.any(String));
    expect(result.alertId).toEqual(expect.any(String));
    const incidents = await env.DB.prepare(
      "SELECT id, kind, closed_at FROM incident",
    ).all<{ id: string; kind: string; closed_at: string | null }>();
    expect(incidents.results).toEqual([
      { id: result.incidentId, kind: "breakage", closed_at: null },
    ]);
    const alerts = await env.DB.prepare(
      "SELECT id, kind, severity FROM alert",
    ).all<{ id: string; kind: string; severity: string }>();
    expect(alerts.results).toEqual([
      { id: result.alertId, kind: "own_site_broken", severity: "normal" },
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it("(h) the own-site alert publishChange writes is the one readOpenIncidentBlock returns, and acknowledging it is readable", async () => {
    const result = await publishChange(
      baseInput(
        {
          deferred: false,
          selfBreakage: { p: 0.81, band: "alert", reason: "checkout button gone" },
          noteworthy: null,
        },
        {
          workspaceId: SELF_WS,
          entityId: SELF_ENTITY,
          watchId: SELF_WATCH,
          pageId: SELF_PAGE,
          url: SELF_URL,
          snapshotId: "snap-publish-h",
        },
      ),
    );
    const alertId = result.alertId;
    if (alertId === null) throw new Error("publishChange wrote no own-site alert");
    const open = await readOpenIncidentBlock(env.DB, SELF_WS);
    expect(open?.alert_id).toBe(alertId);
    await acknowledgeIncidentAlert(env.DB, SELF_WS, alertId, new Date().toISOString());
    const acknowledged = await env.DB.prepare("SELECT status FROM alert WHERE id = ?")
      .bind(alertId)
      .first<{ status: string }>();
    expect(acknowledged?.status).toBe("acknowledged");
  });
});

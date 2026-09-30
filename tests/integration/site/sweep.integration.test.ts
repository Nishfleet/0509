import { env, introspectWorkflowInstance } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as JudgeModule from "../../../app/lib/site/judge.server";

const judgeFault = vi.hoisted(() => ({ next: false }));

vi.mock("../../../app/lib/site/judge.server", async (importOriginal) => {
  const original = await importOriginal<JudgeModule>();
  return {
    ...original,
    judgeChange: async (input: Parameters<typeof original.judgeChange>[0]) => {
      if (judgeFault.next) {
        judgeFault.next = false;
        throw new Error("judge blew up");
      }
      return original.judgeChange(input);
    },
  };
});

import {
  checkSitePage,
  ensureHomePages,
  planSiteSweep,
  publishSiteChange,
  uncoveredItems,
} from "../../../app/lib/site/sweep.server";

const readHolder = { html: "" };
const calls: string[] = [];

const PAD =
  "Every plan includes unlimited projects, priority support, single sign-on, audit logs, and a named account manager who answers within one business day, with onboarding help for your whole team.";

const USER = "user-site-sweep";
const WS = "ws-site-sweep";
const NOW = "2026-09-24T02:00:00Z";

const BEFORE_HTML = `<!doctype html><html><body><h1>Rival</h1><p>Plans start at ten dollars a month.</p><p>${PAD}</p></body></html>`;
const SELF_BEFORE_HTML = `<!doctype html><html><body><h1>MyBrand</h1><p>Plans start at $29 a month and $99 a month for growth teams.</p><p>${PAD}</p></body></html>`;
const SELF_BROKEN_HTML = `<!doctype html><html><body><h1>MyBrand</h1><p>Something went wrong, please try again later.</p><p>${PAD}</p></body></html>`;
const SELF_BROKEN_AGAIN_HTML = `<!doctype html><html><body><h1>MyBrand</h1><p>Still nothing to see here, please try again later.</p><p>${PAD}</p></body></html>`;
const AFTER_HTML = `<!doctype html><html><body><h1>Rival</h1><p>Plans start at twelve dollars a month. New: team seats.</p><p>${PAD}</p></body></html>`;

const nextTick = async (name: string) => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return { instanceId: name, plannedAt: new Date().toISOString() };
};

const seedEntity = (
  id: string,
  role: "self" | "competitor",
  domain: string,
  state: "on" | "off",
  identityJson = "{}",
) =>
  env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)`,
  )
    .bind(id, WS, role, domain, identityJson, state, NOW)
    .run();

const homePageUrls = async () => {
  const rows = await env.DB.prepare("SELECT entity_id, url FROM page WHERE role = 'home' ORDER BY entity_id").all<{
    entity_id: string;
    url: string;
  }>();
  return new Map(rows.results.map((row) => [row.entity_id, row.url]));
};

const watchTargets = async () => {
  const rows = await env.DB.prepare("SELECT entity_id, target_key FROM watch ORDER BY entity_id").all<{
    entity_id: string;
    target_key: string;
  }>();
  return new Map(rows.results.map((row) => [row.entity_id, row.target_key]));
};

const rowCount = async (table: "page" | "watch") => {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n;
};

const signals = async () => {
  const rows = await env.DB.prepare(
    "SELECT entity_id, source_id, kind, title, aspect, url, evidence_url, snapshot_id, payload_json, observed_at, last_seen_at FROM signal WHERE workspace_id = ?",
  )
    .bind(WS)
    .all<{
      entity_id: string;
      source_id: string;
      kind: string;
      title: string | null;
      aspect: string;
      url: string;
      evidence_url: string;
      snapshot_id: string;
      payload_json: string;
      observed_at: string;
      last_seen_at: string | null;
    }>();
  return rows.results;
};

const resetTenant = async () => {
  await env.DB.exec("DELETE FROM sweep_run");
  await env.DB.exec("DELETE FROM alert");
  await env.DB.exec("DELETE FROM incident");
  await env.DB.exec("DELETE FROM signal");
  await env.DB.exec("DELETE FROM snapshot");
  await env.DB.exec("DELETE FROM watch");
  await env.DB.exec("DELETE FROM page");
  await env.DB.exec("DELETE FROM entity");
  await env.DB.exec("DELETE FROM workspace");
  await env.DB.exec('DELETE FROM "user"');

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
};

const seedSweep = async () => {
  await resetTenant();
  await seedEntity("ent-self", "self", "mybrand.com", "on");
  await seedEntity("ent-rival", "competitor", "rival.com", "on");
  await seedEntity("ent-paused", "competitor", "paused.com", "off");
  await seedEntity("ent-handle", "competitor", "somecreator", "on");
};

describe("nightly site sweep", () => {
  beforeEach(async () => {
    await seedSweep();
    const listed = await env.SNAPSHOTS.list({ prefix: "snapshot/site/" });
    await Promise.all(listed.objects.map((object) => env.SNAPSHOTS.delete(object.key)));

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
    expect(await rowCount("page")).toBe(2);
    expect(await rowCount("watch")).toBe(2);
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
    if (changed.outcome !== "changed" || first.outcome !== "first" || same.outcome !== "unchanged")
      throw new Error("expected a change");
    await publishSiteChange(rival, changed);
    await publishSiteChange(rival, changed);

    const filed = await signals();
    expect(filed).toHaveLength(1);
    const [signal] = filed;
    if (signal === undefined) throw new Error("expected a change signal");
    expect(signal).toMatchObject({
      entity_id: "ent-rival",
      source_id: "src_site_web",
      kind: "change",
      aspect: "home",
      url: "https://rival.com/",
      evidence_url: "https://rival.com/",
      snapshot_id: changed.snapshotId,
    });
    expect(signal.title).toBeNull();
    expect(signal.last_seen_at).toBe(signal.observed_at);
    const payload: unknown = JSON.parse(signal.payload_json);
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

  it("judges the filed change signal, and a retried publish judges the same signal", async () => {
    Reflect.set(env, "AI", {
      async run(_model: string, request: { questions: Record<string, { type: string }> }) {
        const answers: Record<string, { type: "noul"; noul: number } | { type: "choice"; choice: string }> = {};
        for (const [id, question] of Object.entries(request.questions)) {
          answers[id] = question.type === "noul" ? { type: "noul", noul: 0.95 } : { type: "choice", choice: "pricing" };
        }
        return { answers };
      },
    });
    try {
      await env.DB.exec("DELETE FROM jev_verdict");
      const [rival] = (await planSiteSweep(NOW)).filter((t) => t.entityId === "ent-rival");
      if (rival === undefined) throw new Error("expected the rival's homepage");
      await checkSitePage(rival, await nextTick("night-1"));
      readHolder.html = AFTER_HTML;
      const changed = await checkSitePage(rival, await nextTick("night-2"));
      if (changed.outcome !== "changed") throw new Error("expected a change");
      await publishSiteChange(rival, changed);
      await publishSiteChange(rival, changed);

      const [signal] = await signals();
      const filedId = await env.DB.prepare("SELECT id FROM signal WHERE workspace_id = ?")
        .bind(WS)
        .first<{ id: string }>();
      const verdicts = await env.DB.prepare(
        "SELECT DISTINCT signal_id FROM jev_verdict WHERE entity_id = 'ent-rival'",
      ).all<{
        signal_id: string | null;
      }>();
      expect(signal).toBeDefined();
      expect(verdicts.results).toEqual([{ signal_id: filedId?.id }]);
    } finally {
      Reflect.deleteProperty(env, "AI");
    }
  });

  it("files the change unjudged when judging throws, and never fails the sweep", async () => {
    await env.DB.exec("DELETE FROM jev_verdict");
    judgeFault.next = true;
    const [rival] = (await planSiteSweep(NOW)).filter((t) => t.entityId === "ent-rival");
    if (rival === undefined) throw new Error("expected the rival's homepage");
    await checkSitePage(rival, await nextTick("fault-1"));
    readHolder.html = AFTER_HTML;
    const changed = await checkSitePage(rival, await nextTick("fault-2"));
    if (changed.outcome !== "changed") throw new Error("expected a change");

    expect(await publishSiteChange(rival, changed)).toBe(changed.snapshotId);

    const filed = await signals();
    expect(filed).toHaveLength(1);
    expect(filed[0]?.aspect).toBe("home");
    const verdicts = await env.DB.prepare("SELECT COUNT(*) AS n FROM jev_verdict WHERE entity_id = 'ent-rival'").first<{
      n: number;
    }>();
    expect(verdicts?.n).toBe(0);
  });

  it("files the customer's own change unjudged when judging throws, and the sweep carries on to the next page", async () => {
    await env.DB.exec("DELETE FROM jev_verdict");
    const targets = await planSiteSweep(NOW);
    const self = targets.find((target) => target.entityId === "ent-self");
    const rival = targets.find((target) => target.entityId === "ent-rival");
    if (self === undefined || rival === undefined) throw new Error("expected the self and rival homepages");
    await checkSitePage(self, await nextTick("self-fault-1"));
    await checkSitePage(rival, await nextTick("self-fault-1"));
    readHolder.html = AFTER_HTML;
    const selfChanged = await checkSitePage(self, await nextTick("self-fault-2"));
    const rivalChanged = await checkSitePage(rival, await nextTick("self-fault-2"));
    if (selfChanged.outcome !== "changed" || rivalChanged.outcome !== "changed") throw new Error("expected a change");
    judgeFault.next = true;

    expect(await publishSiteChange(self, selfChanged)).toBe(selfChanged.snapshotId);
    expect(await publishSiteChange(rival, rivalChanged)).toBe(rivalChanged.snapshotId);

    const filed = await signals();
    expect(filed.map((row) => row.entity_id).sort()).toEqual(["ent-rival", "ent-self"]);
    const verdicts = await env.DB.prepare("SELECT COUNT(*) AS n FROM jev_verdict WHERE entity_id = 'ent-self'").first<{
      n: number;
    }>();
    expect(verdicts?.n).toBe(0);
  });

  it("links each same-entity page's verdicts to its own signal when two pages are judged at once", async () => {
    Reflect.set(env, "AI", {
      async run(
        _model: string,
        request: {
          state: { page: { url: string } };
          questions: Record<string, { type: string }>;
        },
      ) {
        const kind = request.state.page.url.endsWith("/pricing") ? "launch" : "copy";
        const answers: Record<string, { type: "noul"; noul: number } | { type: "choice"; choice: string }> = {};
        for (const [id, question] of Object.entries(request.questions)) {
          answers[id] = question.type === "noul" ? { type: "noul", noul: 0.95 } : { type: "choice", choice: kind };
        }
        return { answers };
      },
    });
    try {
      await env.DB.exec("DELETE FROM jev_verdict");
      await planSiteSweep(NOW);
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES ('page-rival-pricing', 'ent-rival', 'https://rival.com/pricing', 'pricing', ?)",
        ).bind(NOW),
        env.DB.prepare(
          "INSERT INTO watch (id, entity_id, source_id, target_key) VALUES ('watch-rival-pricing', 'ent-rival', 'src_site_web', 'https://rival.com/pricing')",
        ),
      ]);
      const targets = (await planSiteSweep(NOW)).filter((t) => t.entityId === "ent-rival");
      expect(targets.map((t) => t.url)).toEqual(["https://rival.com/", "https://rival.com/pricing"]);
      const firsts = await Promise.all(targets.map(async (t, i) => checkSitePage(t, await nextTick(`pair-1-${i}`))));
      expect(firsts.map((r) => r.outcome)).toEqual(["first", "first"]);
      readHolder.html = AFTER_HTML;
      const changes = await Promise.all(targets.map(async (t, i) => checkSitePage(t, await nextTick(`pair-2-${i}`))));
      const pairs = targets.map((target, i) => {
        const changed = changes[i];
        if (changed === undefined || changed.outcome !== "changed") throw new Error("expected a change");
        return { target, changed };
      });
      await Promise.all(pairs.map(({ target, changed }) => publishSiteChange(target, changed)));

      const rows = await env.DB.prepare(
        `SELECT s.url AS url, s.aspect AS aspect, v.question_id AS question_id, v.choice AS choice
         FROM signal s JOIN jev_verdict v ON v.signal_id = s.id
         WHERE s.workspace_id = ? ORDER BY s.url, v.question_id`,
      )
        .bind(WS)
        .all<{ url: string; aspect: string; question_id: string; choice: string | null }>();
      expect(rows.results).toEqual([
        { url: "https://rival.com/", aspect: "copy", question_id: "change_kind", choice: "copy" },
        { url: "https://rival.com/", aspect: "copy", question_id: "noteworthy_change", choice: null },
        { url: "https://rival.com/pricing", aspect: "launch", question_id: "change_kind", choice: "launch" },
        { url: "https://rival.com/pricing", aspect: "launch", question_id: "noteworthy_change", choice: null },
      ]);
      const unlinked = await env.DB.prepare("SELECT COUNT(*) AS n FROM jev_verdict WHERE signal_id IS NULL").first<{
        n: number;
      }>();
      expect(unlinked?.n).toBe(0);
    } finally {
      Reflect.deleteProperty(env, "AI");
    }
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

  it("skips the customer's own page when its robots.txt disallows FiveToNineBot, and still reads competitors", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      fetched.push(url);
      return Promise.resolve(
        url === "https://mybrand.com/robots.txt"
          ? new Response("User-agent: FiveToNineBot\nDisallow: /\n", { status: 200 })
          : new Response(readHolder.html, { status: 200 }),
      );
    });

    const targets = await planSiteSweep(NOW);
    const self = targets.find((target) => target.entityId === "ent-self");
    const rival = targets.find((target) => target.entityId === "ent-rival");
    if (self === undefined || rival === undefined) {
      throw new Error("expected the self and rival homepages");
    }

    expect((await checkSitePage(self, await nextTick("robots-self"))).outcome).toBe("failed");
    expect(fetched).not.toContain("https://mybrand.com/");
    expect((await checkSitePage(rival, await nextTick("robots-rival"))).outcome).toBe("first");
    expect(fetched).not.toContain("https://rival.com/robots.txt");
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

    expect(calls.filter((call) => call === "POST https://hc-ping.example.com/site-sweep")).toHaveLength(1);
    expect(await introspector.getOutput()).toMatchObject({ pages: 2, recorded: true });

    const run = await env.DB.prepare(
      "SELECT kind, pages, failed, wall_ms, planned_at, finished_at FROM sweep_run WHERE id = ?",
    )
      .bind(id)
      .first<{
        kind: string;
        pages: number;
        failed: number;
        wall_ms: number;
        planned_at: string;
        finished_at: string;
      }>();
    if (run === null) throw new Error("finished sweep wrote no sweep_run row");
    expect(run).toMatchObject({ kind: "site", pages: 2, failed: 0 });
    expect(run.wall_ms).toBe(Date.parse(run.finished_at) - Date.parse(run.planned_at));
  });

  describe("the customer's own page", () => {
    const installJev = (breakageP: number) => {
      const asked: string[] = [];
      Reflect.set(env, "AI", {
        async run(_model: string, request: { questions: Record<string, { type: string }> }) {
          const answers: Record<string, { type: "noul"; noul: number } | { type: "choice"; choice: string }> = {};
          for (const [id, question] of Object.entries(request.questions)) {
            asked.push(id);
            if (id === "own_site_breakage") answers[id] = { type: "noul", noul: breakageP };
            else
              answers[id] =
                question.type === "noul" ? { type: "noul", noul: 0.95 } : { type: "choice", choice: "copy" };
          }
          return { answers };
        },
      });
      return asked;
    };

    const changeOnce = async (entityId: string, html: string, name: string) => {
      const target = (await planSiteSweep(NOW)).find((t) => t.entityId === entityId);
      if (target === undefined) throw new Error(`expected the ${entityId} homepage`);
      readHolder.html = html;
      const changed = await checkSitePage(target, await nextTick(name));
      if (changed.outcome !== "changed") throw new Error("expected a change");
      await publishSiteChange(target, changed);
      return target;
    };

    const baseline = async (entityId: string, html: string) => {
      const target = (await planSiteSweep(NOW)).find((t) => t.entityId === entityId);
      if (target === undefined) throw new Error(`expected the ${entityId} homepage`);
      readHolder.html = html;
      await checkSitePage(target, await nextTick(`base-${entityId}`));
    };

    const rows = async () => {
      const [signalRows, incidents, alerts] = await Promise.all([
        env.DB.prepare("SELECT aspect, summary FROM signal WHERE entity_id = 'ent-self' ORDER BY observed_at").all<{
          aspect: string;
          summary: string | null;
        }>(),
        env.DB.prepare("SELECT id, kind, closed_at FROM incident").all<{
          id: string;
          kind: string;
          closed_at: string | null;
        }>(),
        env.DB.prepare("SELECT incident_id, severity, body FROM alert").all<{
          incident_id: string | null;
          severity: string;
          body: string | null;
        }>(),
      ]);
      return { signals: signalRows.results, incidents: incidents.results, alerts: alerts.results };
    };

    let send: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      await env.DB.exec("DELETE FROM jev_verdict");
      send = vi.spyOn(workerEnv.SEND_EMAIL, "send").mockResolvedValue(undefined);
    });

    afterEach(() => {
      Reflect.deleteProperty(env, "AI");
      vi.restoreAllMocks();
    });

    it("opens a breakage incident, a pinned high alert and one queued email when D3s says alert", async () => {
      installJev(0.8);
      await baseline("ent-self", SELF_BEFORE_HTML);
      await changeOnce("ent-self", SELF_BROKEN_HTML, "self-broken");

      const filed = await rows();
      expect(filed.signals).toEqual([{ aspect: "breakage", summary: null }]);
      expect(filed.incidents).toEqual([{ id: expect.any(String), kind: "breakage", closed_at: null }]);
      const incidentId = filed.incidents[0]?.id;
      expect(filed.alerts).toEqual([{ incident_id: incidentId, severity: "high", body: null }]);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({ incident_id: incidentId });
      const unlinked = await env.DB.prepare("SELECT COUNT(*) AS n FROM jev_verdict WHERE signal_id IS NULL").first<{
        n: number;
      }>();
      expect(unlinked?.n).toBe(0);
    });

    it("opens the incident and a normal alert, and sends nothing, when D3s says check", async () => {
      installJev(0.3);
      await baseline("ent-self", SELF_BEFORE_HTML);
      await changeOnce("ent-self", SELF_BROKEN_HTML, "self-check");

      const filed = await rows();
      expect(filed.incidents).toHaveLength(1);
      expect(filed.alerts).toEqual([{ incident_id: filed.incidents[0]?.id, severity: "normal", body: null }]);
      expect(send).not.toHaveBeenCalled();
    });

    it("opens no incident when D3s says clear, and files the signal as any other change", async () => {
      installJev(0.05);
      await baseline("ent-self", SELF_BEFORE_HTML);
      await changeOnce("ent-self", SELF_BROKEN_HTML, "self-clear");

      const filed = await rows();
      expect(filed.incidents).toEqual([]);
      expect(filed.alerts).toEqual([]);
      expect(filed.signals).toHaveLength(1);
      expect(filed.signals[0]?.aspect).toBe("copy");
      expect(send).not.toHaveBeenCalled();
    });

    it("never asks D3s about a competitor page", async () => {
      const asked = installJev(0.8);
      await baseline("ent-rival", BEFORE_HTML);
      await changeOnce("ent-rival", AFTER_HTML, "rival-change");

      expect(asked).not.toContain("own_site_breakage");
      expect((await rows()).incidents).toEqual([]);
      expect(send).not.toHaveBeenCalled();
    });

    it("opens no second incident and sends nothing on a second run while the incident is open", async () => {
      installJev(0.8);
      await baseline("ent-self", SELF_BEFORE_HTML);
      await changeOnce("ent-self", SELF_BROKEN_HTML, "self-first");
      await changeOnce("ent-self", SELF_BROKEN_AGAIN_HTML, "self-second");

      const filed = await rows();
      expect(filed.incidents).toHaveLength(1);
      expect(filed.alerts).toHaveLength(1);
      expect(send).toHaveBeenCalledTimes(1);
    });
  });
});

const insertSiteSnapshot = (watchId: string, pageId: string, fetchedAt: string) =>
  env.DB.prepare(
    `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), watchId, pageId, fetchedAt, `snapshot/site/${watchId}/body.txt`, crypto.randomUUID())
    .run();

const rivalTarget = async () => {
  const targets = await planSiteSweep(NOW);
  const rival = targets.find((target) => target.entityId === "ent-rival");
  if (rival === undefined) throw new Error("expected the rival's homepage target");
  return { targets, rival };
};

describe("uncoveredItems", () => {
  const oneMinuteAgo = () => new Date(Date.now() - 60_000).toISOString();

  beforeEach(seedSweep);

  it("returns every planned item when the tick wrote no snapshot rows", async () => {
    const { targets } = await rivalTarget();
    expect(targets).toHaveLength(2);
    expect(await uncoveredItems(targets, oneMinuteAgo())).toHaveLength(2);
  });

  it("drops the competitor home watch once this tick's snapshot row exists", async () => {
    const { targets, rival } = await rivalTarget();
    await insertSiteSnapshot(rival.watchId, rival.pageId, new Date().toISOString());
    const missing = await uncoveredItems(targets, oneMinuteAgo());
    expect(missing).toHaveLength(1);
    expect(missing.some((target) => target.watchId === rival.watchId)).toBe(false);
  });

  it("keeps a page whose only snapshot row predates the tick", async () => {
    const { targets, rival } = await rivalTarget();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await insertSiteSnapshot(rival.watchId, rival.pageId, twoHoursAgo);
    const missing = await uncoveredItems(targets, oneMinuteAgo());
    expect(missing).toHaveLength(2);
    expect(missing.some((target) => target.watchId === rival.watchId)).toBe(true);
  });

  it("returns an empty list for an empty plan", async () => {
    expect(await uncoveredItems([], oneMinuteAgo())).toEqual([]);
  });
});

const seedHomeEntities = async (
  rows: readonly {
    id: string;
    role: "self" | "competitor";
    domain: string;
    identityJson: string;
  }[],
) => {
  await resetTenant();
  for (const row of rows) {
    await seedEntity(row.id, row.role, row.domain, "on", row.identityJson);
  }
};

describe("home url resolution", () => {
  afterEach(async () => {
    await env.DB.exec("UPDATE source SET is_enabled = 1 WHERE id = 'src_site_web'");
  });

  it("uses the entered host when it shares the entity's registrable domain", async () => {
    await seedHomeEntities([
      {
        id: "ent-fixture",
        role: "self",
        domain: "0509.in",
        identityJson: '{"kind":"domain","url":"https://fixture.0509.in/"}',
      },
    ]);

    await ensureHomePages(NOW);

    expect((await homePageUrls()).get("ent-fixture")).toBe("https://fixture.0509.in/");
    expect(await rowCount("page")).toBe(1);
  });

  it("uses the entered www host when it shares the entity's registrable domain", async () => {
    await seedHomeEntities([
      {
        id: "ent-www",
        role: "self",
        domain: "nike.com",
        identityJson: '{"url":"https://www.nike.com/"}',
      },
    ]);

    await ensureHomePages(NOW);

    expect((await homePageUrls()).get("ent-www")).toBe("https://www.nike.com/");
  });

  it("keeps the registrable domain home when the identity has no url", async () => {
    await seedHomeEntities([{ id: "ent-plain", role: "self", domain: "nike.com", identityJson: "{}" }]);

    await ensureHomePages(NOW);

    expect((await homePageUrls()).get("ent-plain")).toBe("https://nike.com/");
  });

  it("creates no home page when the entered url resolves to a social channel", async () => {
    await seedHomeEntities([
      {
        id: "ent-channel",
        role: "competitor",
        domain: "mkbhd",
        identityJson: '{"kind":"channel","url":"https://www.youtube.com/@mkbhd"}',
      },
    ]);

    await ensureHomePages(NOW);

    expect((await homePageUrls()).has("ent-channel")).toBe(false);
    expect(await rowCount("page")).toBe(0);
  });

  it("falls back to the registrable domain when the entered host is a different site", async () => {
    await seedHomeEntities([
      {
        id: "ent-other",
        role: "self",
        domain: "nike.com",
        identityJson: '{"kind":"domain","url":"https://adidas.com/"}',
      },
    ]);

    await ensureHomePages(NOW);

    expect((await homePageUrls()).get("ent-other")).toBe("https://nike.com/");
  });

  it("watches the entered host for the site.web source", async () => {
    await seedHomeEntities([
      {
        id: "ent-fixture",
        role: "self",
        domain: "0509.in",
        identityJson: '{"kind":"domain","url":"https://fixture.0509.in/"}',
      },
    ]);

    await planSiteSweep(NOW);

    expect((await watchTargets()).get("ent-fixture")).toBe("https://fixture.0509.in/");
    expect(await rowCount("watch")).toBe(1);
  });

  it("still watches the entered host when its page row is already judged as another role", async () => {
    await seedHomeEntities([
      {
        id: "ent-taken",
        role: "self",
        domain: "0509.in",
        identityJson: '{"kind":"domain","url":"https://fixture.0509.in/"}',
      },
    ]);
    await env.DB.prepare(`INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES (?, ?, ?, 'product', ?)`)
      .bind("page-taken", "ent-taken", "https://fixture.0509.in/", NOW)
      .run();

    const targets = await planSiteSweep(NOW);

    expect((await homePageUrls()).has("ent-taken")).toBe(false);
    expect(targets.map((target) => [target.entityId, target.url, target.pageRole])).toEqual([
      ["ent-taken", "https://fixture.0509.in/", "product"],
    ]);
  });

  it("watches one page per entity when the entity already has two home rows", async () => {
    await seedHomeEntities([{ id: "ent-two", role: "self", domain: "nike.com", identityJson: "{}" }]);
    await env.DB.prepare(`INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES (?, ?, ?, 'home', ?)`)
      .bind("page-two-early", "ent-two", "https://nike.com/", new Date(Date.parse(NOW) - 7_200_000).toISOString())
      .run();
    await env.DB.prepare(`INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES (?, ?, ?, 'home', ?)`)
      .bind("page-two-late", "ent-two", "https://shop.nike.com/", new Date(Date.parse(NOW) - 3_600_000).toISOString())
      .run();

    const targets = await planSiteSweep(NOW);

    expect(targets.map((target) => [target.entityId, target.url])).toEqual([["ent-two", "https://nike.com/"]]);
    expect(await rowCount("watch")).toBe(1);
  });

  it("still creates the home pages when the site source is paused", async () => {
    await env.DB.exec("UPDATE source SET is_enabled = 0 WHERE id = 'src_site_web'");
    await seedHomeEntities([
      {
        id: "ent-fixture",
        role: "self",
        domain: "0509.in",
        identityJson: '{"kind":"domain","url":"https://fixture.0509.in/"}',
      },
    ]);

    expect(await planSiteSweep(NOW)).toEqual([]);
    expect((await homePageUrls()).get("ent-fixture")).toBe("https://fixture.0509.in/");
  });
});

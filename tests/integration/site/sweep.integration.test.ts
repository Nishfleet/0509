import { env, introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jevAnswers = vi.hoisted(() => ({
  noul: new Map<string, number>(),
  choice: new Map<string, string>(),
  calls: 0,
  states: [] as unknown[],
}));

const jevFailures = vi.hoisted(() => ({ next: 0 }));

vi.mock("../../../app/lib/jev/client.server", () => {
  class JevUnavailableError extends Error {
    constructor(cause: unknown) {
      super(`jev unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
      this.name = "JevUnavailableError";
    }
  }
  return {
    JevUnavailableError,
    askNoul: async (workspaceId: string, question: { id: string }, state: unknown) => {
      jevAnswers.states.push(state);
      jevAnswers.calls += 1;
      if (jevFailures.next > 0) {
        jevFailures.next -= 1;
        throw new JevUnavailableError(new Error("gateway down"));
      }
      const p = jevAnswers.noul.get(question.id);
      if (p === undefined) throw new JevUnavailableError(new Error(`no answer for ${question.id}`));
      return { questionId: question.id, inputHash: `noul-${workspaceId}-${question.id}`, p, cached: false };
    },
    askChoice: async (workspaceId: string, question: { id: string }, state: unknown) => {
      jevAnswers.states.push(state);
      jevAnswers.calls += 1;
      const choice = jevAnswers.choice.get(question.id);
      if (choice === undefined) throw new JevUnavailableError(new Error(`no answer for ${question.id}`));
      return { questionId: question.id, inputHash: `choice-${workspaceId}-${question.id}`, choice, cached: false };
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
const AFTER_HTML = `<!doctype html><html><body><h1>Rival</h1><p>Plans start at twelve dollars a month. New: team seats.</p><p>${PAD}</p></body></html>`;

const nextTick = async (name: string) => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return { instanceId: name, plannedAt: new Date().toISOString() };
};

const seedEntity = (id: string, role: "self" | "competitor", domain: string, state: "on" | "off", identityJson = "{}", ws = WS) =>
  env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)`,
  )
    .bind(id, ws, role, domain, identityJson, state, NOW)
    .run();

const homePageUrls = async () => {
  const rows = await env.DB.prepare("SELECT entity_id, url FROM page WHERE role = 'home' ORDER BY entity_id")
    .all<{ entity_id: string; url: string }>();
  return new Map(rows.results.map((row) => [row.entity_id, row.url]));
};

const watchTargets = async () => {
  const rows = await env.DB.prepare("SELECT entity_id, target_key FROM watch ORDER BY entity_id")
    .all<{ entity_id: string; target_key: string }>();
  return new Map(rows.results.map((row) => [row.entity_id, row.target_key]));
};

const rowCount = async (table: "page" | "watch") => {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n;
};

const signals = async (ws = WS) => {
  const rows = await env.DB.prepare(
    "SELECT id, entity_id, source_id, kind, title, aspect, url, evidence_url, snapshot_id, payload_json, observed_at, last_seen_at FROM signal WHERE workspace_id = ?",
  )
    .bind(ws)
    .all<{
      id: string;
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

const verdictsFor = async (ws: string) => {
  const rows = await env.DB.prepare(
    "SELECT question_id, signal_id, p, choice FROM jev_verdict WHERE workspace_id = ? ORDER BY question_id",
  )
    .bind(ws)
    .all<{ question_id: string; signal_id: string | null; p: number | null; choice: string | null }>();
  return rows.results;
};

const resetTenant = async (ws = WS) => {
  await env.DB.exec("DELETE FROM signal");
  await env.DB.exec("DELETE FROM jev_verdict");
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
    .bind(ws, USER, NOW)
    .run();
};

const seedSweep = async (ws = WS) => {
  await resetTenant(ws);
  await seedEntity("ent-self", "self", "mybrand.com", "on", "{}", ws);
  await seedEntity("ent-rival", "competitor", "rival.com", "on", "{}", ws);
  await seedEntity("ent-paused", "competitor", "paused.com", "off", "{}", ws);
  await seedEntity("ent-handle", "competitor", "somecreator", "on", "{}", ws);
};

describe("nightly site sweep", () => {
  beforeEach(async () => {
    await seedSweep();
    const listed = await env.SNAPSHOTS.list({ prefix: "snapshot/site/" });
    await Promise.all(listed.objects.map((object) => env.SNAPSHOTS.delete(object.key)));

    jevAnswers.noul.clear();
    jevAnswers.choice.clear();
    jevAnswers.states.length = 0;
    jevAnswers.calls = 0;
    jevFailures.next = 0;
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "pricing");

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
    if (changed.outcome !== "changed" || first.outcome !== "first" || same.outcome !== "unchanged") throw new Error("expected a change");
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
      aspect: "pricing",
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

  it("files a judged competitor change under the D3 kind and links both D3 verdict rows to its signal", async () => {
    const ws = "ws-sweep-judged";
    await seedSweep(ws);
    const [rival] = (await planSiteSweep(NOW)).filter((t) => t.entityId === "ent-rival");
    if (rival === undefined) throw new Error("expected the rival's homepage");

    expect((await checkSitePage(rival, await nextTick("judged-1"))).outcome).toBe("first");
    readHolder.html = AFTER_HTML;
    const changed = await checkSitePage(rival, await nextTick("judged-2"));
    if (changed.outcome !== "changed") throw new Error("expected a change");
    await publishSiteChange(rival, changed);

    const filed = await signals(ws);
    expect(filed).toHaveLength(1);
    const [signal] = filed;
    if (signal === undefined) throw new Error("expected a change signal");
    expect(signal.aspect).toBe("pricing");
    expect(await verdictsFor(ws)).toEqual([
      { question_id: "change_kind", signal_id: signal.id, p: null, choice: "pricing" },
      { question_id: "noteworthy_change", signal_id: signal.id, p: 0.95, choice: null },
    ]);
  });

  it("files nothing for a competitor change D3 discards, and leaves both verdict rows unlinked", async () => {
    const ws = "ws-sweep-discarded";
    await seedSweep(ws);
    jevAnswers.noul.set("noteworthy_change", 0.05);
    const [rival] = (await planSiteSweep(NOW)).filter((t) => t.entityId === "ent-rival");
    if (rival === undefined) throw new Error("expected the rival's homepage");

    expect((await checkSitePage(rival, await nextTick("discard-1"))).outcome).toBe("first");
    readHolder.html = AFTER_HTML;
    const changed = await checkSitePage(rival, await nextTick("discard-2"));
    if (changed.outcome !== "changed") throw new Error("expected a change");
    expect(await publishSiteChange(rival, changed)).toBe(changed.snapshotId);

    expect(await signals(ws)).toEqual([]);
    expect(await verdictsFor(ws)).toEqual([
      { question_id: "change_kind", signal_id: null, p: null, choice: "pricing" },
      { question_id: "noteworthy_change", signal_id: null, p: 0.05, choice: null },
    ]);
  });

  it("files the change unjudged with its page role when Jev is unavailable", async () => {
    const ws = "ws-sweep-unjudged";
    await seedSweep(ws);
    jevFailures.next = 2;
    const [rival] = (await planSiteSweep(NOW)).filter((t) => t.entityId === "ent-rival");
    if (rival === undefined) throw new Error("expected the rival's homepage");

    expect((await checkSitePage(rival, await nextTick("unjudged-1"))).outcome).toBe("first");
    readHolder.html = AFTER_HTML;
    const changed = await checkSitePage(rival, await nextTick("unjudged-2"));
    if (changed.outcome !== "changed") throw new Error("expected a change");
    await publishSiteChange(rival, changed);

    const filed = await signals(ws);
    expect(filed).toHaveLength(1);
    expect(filed[0]?.aspect).toBe("home");
    expect(await verdictsFor(ws)).toEqual([]);
  });

  it("never asks Jev about the customer's own page change", async () => {
    const ws = "ws-sweep-self";
    await seedSweep(ws);
    const [self] = (await planSiteSweep(NOW)).filter((t) => t.entityId === "ent-self");
    if (self === undefined) throw new Error("expected the self homepage");

    expect((await checkSitePage(self, await nextTick("self-1"))).outcome).toBe("first");
    readHolder.html = AFTER_HTML;
    const changed = await checkSitePage(self, await nextTick("self-2"));
    if (changed.outcome !== "changed") throw new Error("expected a change");
    await publishSiteChange(self, changed);

    const filed = await signals(ws);
    expect(filed).toHaveLength(1);
    expect(filed[0]?.aspect).toBe("home");
    expect(jevAnswers.calls).toBe(0);
    expect(await verdictsFor(ws)).toEqual([]);
  });

  it("keeps one signal and its linked verdicts when the publish step is retried", async () => {
    const ws = "ws-sweep-retry";
    await seedSweep(ws);
    const [rival] = (await planSiteSweep(NOW)).filter((t) => t.entityId === "ent-rival");
    if (rival === undefined) throw new Error("expected the rival's homepage");

    expect((await checkSitePage(rival, await nextTick("retry-1"))).outcome).toBe("first");
    readHolder.html = AFTER_HTML;
    const changed = await checkSitePage(rival, await nextTick("retry-2"));
    if (changed.outcome !== "changed") throw new Error("expected a change");
    await publishSiteChange(rival, changed);
    await publishSiteChange(rival, changed);

    const filed = await signals(ws);
    expect(filed).toHaveLength(1);
    const [signal] = filed;
    if (signal === undefined) throw new Error("expected a change signal");
    expect(await verdictsFor(ws)).toEqual([
      { question_id: "change_kind", signal_id: signal.id, p: null, choice: "pricing" },
      { question_id: "noteworthy_change", signal_id: signal.id, p: 0.95, choice: null },
    ]);
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

    expect(calls.filter((call) => call === "POST https://hc-ping.example/site-sweep")).toHaveLength(1);
    expect(await introspector.getOutput()).toMatchObject({ pages: 2 });
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

  beforeEach(async () => {
    await seedSweep();
  });

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
    await seedHomeEntities([
      { id: "ent-plain", role: "self", domain: "nike.com", identityJson: "{}" },
    ]);

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
    await env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES (?, ?, ?, 'product', ?)`,
    )
      .bind("page-taken", "ent-taken", "https://fixture.0509.in/", NOW)
      .run();

    const targets = await planSiteSweep(NOW);

    expect((await homePageUrls()).has("ent-taken")).toBe(false);
    expect(targets.map((target) => [target.entityId, target.url, target.pageRole])).toEqual([
      ["ent-taken", "https://fixture.0509.in/", "product"],
    ]);
  });

  it("watches one page per entity when the entity already has two home rows", async () => {
    await seedHomeEntities([
      { id: "ent-two", role: "self", domain: "nike.com", identityJson: "{}" },
    ]);
    await env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES (?, ?, ?, 'home', ?)`,
    )
      .bind("page-two-early", "ent-two", "https://nike.com/", new Date(Date.parse(NOW) - 7_200_000).toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES (?, ?, ?, 'home', ?)`,
    )
      .bind("page-two-late", "ent-two", "https://shop.nike.com/", new Date(Date.parse(NOW) - 3_600_000).toISOString())
      .run();

    const targets = await planSiteSweep(NOW);

    expect(targets.map((target) => [target.entityId, target.url])).toEqual([
      ["ent-two", "https://nike.com/"],
    ]);
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

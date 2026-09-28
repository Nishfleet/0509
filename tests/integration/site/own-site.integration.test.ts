import { env, introspectWorkflowInstance } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openIncident } from "../../../app/lib/data/incident.server";

const USER = "user-own-site";
const WS = "ws-own-site";
const NOW = "2026-09-24T02:00:00Z";

const HEALTHY_HTML = `<!doctype html><html><body><h1>My brand</h1><p>Every plan includes unlimited projects, priority support, single sign-on, audit logs, and a named account manager who answers within one business day, with onboarding help for your whole team.</p></body></html>`;

const BEFORE_TEXT =
  "My brand Every plan includes unlimited projects, priority support, single sign-on, audit logs, and a named account manager who answers within one business day, with onboarding help for your whole team. Plans start at ₹499 a month for the starter tier and ₹1,299 a month for the growth tier, both billed yearly or monthly, with every seat covered by the same uptime promise.";
const PRICED_HTML = `<!doctype html><html><body><h1>My brand</h1><p>Every plan includes unlimited projects, priority support, single sign-on, audit logs, and a named account manager who answers within one business day, with onboarding help for your whole team.</p><p>Plans start at ₹499 a month for the starter tier and ₹1,299 a month for the growth tier, both billed yearly or monthly, with every seat covered by the same uptime promise.</p></body></html>`;
const SOFT_BROKEN_HTML = `<!doctype html><html><body><h1>My brand</h1><p>Every plan includes unlimited projects, priority support, single sign-on, audit logs, and a named account manager who answers within one business day, with onboarding help for your whole team.</p></body></html>`;

const site: { status: number; apexDown: boolean; wwwDown: boolean; challenge: boolean; robots: string | null; html: string | null } = {
  status: 200,
  apexDown: false,
  wwwDown: false,
  challenge: false,
  robots: null,
  html: null,
};

const fetched: string[] = [];

const respond = (input: RequestInfo | URL): Promise<Response> => {
  const requestUrl = new URL(input instanceof Request ? input.url : String(input));
  fetched.push(requestUrl.toString());
  if (site.apexDown && !requestUrl.hostname.startsWith("www."))
    return Promise.reject(new Error("DNS lookup failed"));
  if (site.wwwDown && requestUrl.hostname.startsWith("www."))
    return Promise.reject(new Error("DNS lookup failed"));
  if (requestUrl.pathname === "/robots.txt") {
    return Promise.resolve(new Response(site.robots ?? "", { status: site.robots === null ? 404 : 200 }));
  }
  const headers = site.challenge ? { "cf-mitigated": "challenge" } : undefined;
  return Promise.resolve(
    new Response(site.status < 400 ? (site.html ?? HEALTHY_HTML) : "", { status: site.status, headers }),
  );
};

const seedEntity = (id: string, role: "self" | "competitor", domain: string) =>
  env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, ?, ?, '{}', 'manual', 'on', ?)`,
  )
    .bind(id, WS, role, domain, NOW)
    .run();

const runCheck = async (id: string) => {
  await using introspector = await introspectWorkflowInstance(env.OWN_SITE_CHECK, id);
  await introspector.modify(async (m) => {
    await m.disableSleeps();
  });
  await env.OWN_SITE_CHECK.create({ id });
  await introspector.waitForStatus("complete");
  return introspector.getOutput();
};

const incidents = async () => {
  const rows = await env.DB.prepare(
    "SELECT entity_id, kind, closed_at FROM incident WHERE workspace_id = ? ORDER BY opened_at",
  )
    .bind(WS)
    .all<{ entity_id: string; kind: string; closed_at: string | null }>();
  return rows.results;
};

const alerts = async () => {
  const rows = await env.DB.prepare(
    "SELECT kind, severity, title, incident_id FROM alert WHERE workspace_id = ?",
  )
    .bind(WS)
    .all<{ kind: string; severity: string; title: string; incident_id: string | null }>();
  return rows.results;
};

describe("own-site check", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM alert");
    await env.DB.exec("DELETE FROM incident");
    await env.DB.exec("DELETE FROM signal");
    await env.DB.exec("DELETE FROM snapshot");
    await env.DB.exec("DELETE FROM watch");
    await env.DB.exec("DELETE FROM page");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    const stored = await env.SNAPSHOTS.list({ prefix: "snapshot/site/" });
    await Promise.all(stored.objects.map((object) => env.SNAPSHOTS.delete(object.key)));
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', 'own-site@0509.io', 1, ?, ?)`,
    )
      .bind(USER, NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Own site', ?, 'UTC', 1, 8, ?)`,
    )
      .bind(WS, USER, NOW)
      .run();
    await seedEntity("ent-self", "self", "mybrand.com");
    await seedEntity("ent-rival", "competitor", "rival.com");
    site.status = 200;
    site.apexDown = false;
    site.wwwDown = false;
    site.challenge = false;
    site.robots = null;
    site.html = null;
    fetched.length = 0;
    await env.DB.exec("UPDATE source SET is_enabled = 1 WHERE id = 'src_site_web'");
    vi.stubGlobal("fetch", respond);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens nothing while the customer's own site loads", async () => {
    expect(await runCheck("own-healthy")).toEqual({ pages: 1, opened: 0, closed: 0, failed: 0 });
    expect(await incidents()).toEqual([]);
    expect(await alerts()).toEqual([]);
  });

  it("retries the apex when the home page is the www host", async () => {
    await env.DB.prepare("UPDATE entity SET identity_json = ? WHERE id = 'ent-self'")
      .bind('{"kind":"domain","url":"https://www.mybrand.com/"}')
      .run();
    site.wwwDown = true;

    expect(await runCheck("own-www-home")).toEqual({ pages: 1, opened: 0, closed: 0, failed: 0 });
    expect(await incidents()).toEqual([]);
    expect(fetched).toContain("https://mybrand.com/");
    expect(fetched).not.toContain("https://www.www.mybrand.com/");
  });

  it("opens one incident with a pinned alert when the site still fails on the confirming read, and closes it on the next clean hour", async () => {
    site.status = 503;
    await env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES ('page-own-broken', 'ent-self', 'https://shop.mybrand.com/', 'home', ?)`,
    )
      .bind(NOW)
      .run();
    expect(await runCheck("own-broken")).toEqual({ pages: 1, opened: 1, closed: 0, failed: 0 });
    const [open] = await incidents();
    expect(open).toMatchObject({ entity_id: "ent-self", kind: "error 503", closed_at: null });
    const [alert] = await alerts();
    expect(alert).toMatchObject({
      kind: "own_site_broken",
      severity: "high",
      title: `shop.mybrand.com looks broken: ${open?.kind ?? ""}`,
    });

    expect(await runCheck("own-still-broken")).toEqual({ pages: 1, opened: 0, closed: 0, failed: 0 });
    expect(await incidents()).toHaveLength(1);
    expect(await alerts()).toHaveLength(1);

    site.status = 200;
    expect(await runCheck("own-fixed")).toEqual({ pages: 1, opened: 0, closed: 1, failed: 0 });
    const [closed] = await incidents();
    expect(closed?.closed_at).not.toBeNull();
  });

  it("holds a soft-break incident open on a 200 that lost the pricing text, and closes it once the text is back", async () => {
    await env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES ('page-self-home', 'ent-self', 'https://mybrand.com/', 'home', ?)`,
    )
      .bind(NOW)
      .run();
    await env.SNAPSHOTS.put("snapshot/site/own-site/before.txt", BEFORE_TEXT);
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, url, aspect, payload_json, dedup_key, observed_at)
       VALUES ('sig-break', ?, 'ent-self', 'src_site_web', 'change', 'https://mybrand.com/', 'breakage', ?, 'sig-break', ?)`,
    )
      .bind(WS, JSON.stringify({ before: { textKey: "snapshot/site/own-site/before.txt" } }), NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO incident (id, workspace_id, entity_id, page_id, kind, opened_at)
       VALUES ('inc-break', ?, 'ent-self', 'page-self-home', 'breakage', ?)`,
    )
      .bind(WS, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO alert (id, workspace_id, entity_id, signal_id, page_id, incident_id, kind, severity, title, created_at)
       VALUES ('alert-break', ?, 'ent-self', 'sig-break', 'page-self-home', 'inc-break', 'own_site_broken', 'high', 'mybrand.com looks broken: breakage', ?)`,
    )
      .bind(WS, NOW)
      .run();
    const send = vi.spyOn(workerEnv.SEND_EMAIL, "send").mockResolvedValue(undefined);

    site.html = SOFT_BROKEN_HTML;
    expect(await runCheck("own-soft-broken")).toEqual({ pages: 1, opened: 0, closed: 0, failed: 0 });
    const [open] = await incidents();
    expect(open).toMatchObject({ kind: "breakage", closed_at: null });
    expect(send).not.toHaveBeenCalled();

    site.html = PRICED_HTML;
    expect(await runCheck("own-soft-fixed")).toEqual({ pages: 1, opened: 0, closed: 1, failed: 0 });
    const [closed] = await incidents();
    expect(closed?.closed_at).not.toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ incident_id: "inc-break" });
  });

  it("never calls a bot wall or a refusal a break", async () => {
    site.status = 403;
    expect(await runCheck("own-forbidden")).toEqual({ pages: 1, opened: 0, closed: 0, failed: 0 });
    site.status = 503;
    site.challenge = true;
    expect(await runCheck("own-challenge")).toEqual({ pages: 1, opened: 0, closed: 0, failed: 0 });
    expect(await incidents()).toEqual([]);
  });

  it("reads a site that lives only on www as healthy", async () => {
    site.apexDown = true;
    expect(await runCheck("own-www")).toEqual({ pages: 1, opened: 0, closed: 0, failed: 0 });
    expect(await incidents()).toEqual([]);
  });

  it("keeps guarding the customer's own site when the nightly sweep's source is paused", async () => {
    await env.DB.exec("UPDATE source SET is_enabled = 0 WHERE id = 'src_site_web'");
    site.status = 500;
    expect(await runCheck("own-paused")).toEqual({ pages: 1, opened: 1, closed: 0, failed: 0 });
  });

  it("never opens an incident for a competitor's site", async () => {
    site.status = 503;
    await runCheck("own-competitor");
    expect((await incidents()).map((i) => i.entity_id)).toEqual(["ent-self"]);
  });

  it("never fetches the customer's page when robots.txt disallows FiveToNineBot", async () => {
    site.robots = "User-agent: FiveToNineBot\nDisallow: /\n";
    site.status = 503;
    expect(await runCheck("own-robots")).toEqual({ pages: 1, opened: 0, closed: 0, failed: 0 });
    expect(await incidents()).toEqual([]);
    expect(fetched.filter((u) => !u.endsWith("/robots.txt"))).toEqual([]);
  });

  it("opens one incident when openIncident is called twice for the same page (0509#5401)", async () => {
    await env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, discovered_at) VALUES ('page-open-twice', 'ent-self', 'https://mybrand.com/', ?)`,
    )
      .bind(NOW)
      .run();
    const first = await openIncident({
      id: "inc-open-twice-1",
      workspaceId: WS,
      entityId: "ent-self",
      pageId: "page-open-twice",
      kind: "error 503",
      openedAt: NOW,
    });
    const second = await openIncident({
      id: "inc-open-twice-2",
      workspaceId: WS,
      entityId: "ent-self",
      pageId: "page-open-twice",
      kind: "error 503",
      openedAt: NOW,
    });
    expect(first).toBe("inc-open-twice-1");
    expect(second).toBe("inc-open-twice-1");
    const count = await env.DB.prepare("SELECT count(*) AS n FROM incident WHERE page_id = ?")
      .bind("page-open-twice")
      .first<{ n: number }>();
    expect(count).toEqual({ n: 1 });
  });
});

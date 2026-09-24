import { env, introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER = "user-own-site";
const WS = "ws-own-site";
const NOW = "2026-09-24T02:00:00Z";

const HEALTHY_HTML = `<!doctype html><html><body><h1>My brand</h1><p>Every plan includes unlimited projects, priority support, single sign-on, audit logs, and a named account manager who answers within one business day, with onboarding help for your whole team.</p></body></html>`;

const site: { status: number; apexDown: boolean; challenge: boolean; robots: string | null } = {
  status: 200,
  apexDown: false,
  challenge: false,
  robots: null,
};

const fetched: string[] = [];

const respond = (input: RequestInfo | URL): Promise<Response> => {
  const requestUrl = new URL(input instanceof Request ? input.url : String(input));
  fetched.push(requestUrl.toString());
  if (site.apexDown && !requestUrl.hostname.startsWith("www."))
    return Promise.reject(new Error("DNS lookup failed"));
  if (requestUrl.pathname === "/robots.txt") {
    return Promise.resolve(new Response(site.robots ?? "", { status: site.robots === null ? 404 : 200 }));
  }
  const headers = site.challenge ? { "cf-mitigated": "challenge" } : undefined;
  return Promise.resolve(new Response(site.status < 400 ? HEALTHY_HTML : "", { status: site.status, headers }));
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
    await env.DB.exec("DELETE FROM snapshot");
    await env.DB.exec("DELETE FROM watch");
    await env.DB.exec("DELETE FROM page");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
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
    site.challenge = false;
    site.robots = null;
    fetched.length = 0;
    await env.DB.exec("UPDATE source SET is_enabled = 1 WHERE id = 'src_site_web'");
    vi.stubGlobal("fetch", respond);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens nothing while the customer's own site loads", async () => {
    expect(await runCheck("own-healthy")).toEqual({ pages: 1, opened: 0, closed: 0, failed: 0 });
    expect(await incidents()).toEqual([]);
    expect(await alerts()).toEqual([]);
  });

  it("opens one incident with a pinned alert when the site still fails on the confirming read, and closes it on the next clean hour", async () => {
    site.status = 503;
    expect(await runCheck("own-broken")).toEqual({ pages: 1, opened: 1, closed: 0, failed: 0 });
    const [open] = await incidents();
    expect(open).toMatchObject({ entity_id: "ent-self", kind: "error 503", closed_at: null });
    const [alert] = await alerts();
    expect(alert).toMatchObject({
      kind: "own_site_broken",
      severity: "high",
      title: `mybrand.com looks broken: ${open?.kind ?? ""}`,
    });

    expect(await runCheck("own-still-broken")).toEqual({ pages: 1, opened: 0, closed: 0, failed: 0 });
    expect(await incidents()).toHaveLength(1);
    expect(await alerts()).toHaveLength(1);

    site.status = 200;
    expect(await runCheck("own-fixed")).toEqual({ pages: 1, opened: 0, closed: 1, failed: 0 });
    const [closed] = await incidents();
    expect(closed?.closed_at).not.toBeNull();
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
});

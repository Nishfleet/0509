import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SITE_ROBOTS_ERROR,
  SITE_SAME_ERROR,
  SITE_TOO_MANY_ERROR,
  SITE_UNREADABLE_ERROR,
  SITE_WAIT_ERROR,
} from "../../../app/lib/competitor-site";
import { saveCompetitorSite } from "../../../app/lib/competitor-site.server";
import { readSiteWatchSummary, retireCustomerSites } from "../../../app/lib/data/watch.server";

const NOW = "2026-10-02T02:00:00Z";
const USER = "user-comp-site";
const WS = "ws-comp-site";
const OTHER_WS = "ws-comp-site-other";
const RIVAL = "ent-comp-site-rival";
const GROUP = "https://rival-group.com/";
const PRESS = "https://press.rival-group.org/";
const HTML = `<html><head><title>Rival group</title></head><body><main><p>${"Rival group publishes its results and opens new stores across the region. ".repeat(6)}</p></main></body></html>`;

interface Answer {
  status: number;
  body: string;
  location?: string;
}

function stubWeb(answers: Record<string, Answer>): string[] {
  const seen: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    seen.push(url);
    const answer = answers[url];
    const headers = answer?.location === undefined ? undefined : { location: answer.location };
    const res = new Response(answer?.body ?? "", { status: answer?.status ?? 404, headers });
    Object.defineProperty(res, "url", { value: url });
    return Promise.resolve(res);
  });
  return seen;
}

function later(ms: number): void {
  const real = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(real + ms);
}

async function customerWatches(): Promise<{ url: string; active: number }[]> {
  const rows = await env.DB.prepare(
    "SELECT target_key, is_active FROM watch WHERE entity_id = ?1 AND json_extract(config_json, '$.customer') = 1 ORDER BY target_key",
  )
    .bind(RIVAL)
    .all<{ target_key: string; is_active: number }>();
  return rows.results.map((row) => ({ url: row.target_key, active: row.is_active }));
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM watch WHERE entity_id = ?1").bind(RIVAL),
    env.DB.prepare("DELETE FROM page WHERE entity_id = ?1").bind(RIVAL),
    env.DB.prepare("DELETE FROM entity WHERE workspace_id IN (?1, ?2)").bind(WS, OTHER_WS),
    env.DB.prepare("DELETE FROM workspace WHERE id IN (?1, ?2)").bind(WS, OTHER_WS),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(USER),
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 0, ?4, ?4)',
    ).bind(USER, "Owner", `${USER}@0509.io`, NOW),
    env.DB.prepare("INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)").bind(
      WS,
      USER,
      NOW,
    ),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at) VALUES (?1, ?2, 'competitor', 'rival.com', 'Rival', '{}', 'auto', 'on', ?3)",
    ).bind(RIVAL, WS, NOW),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("saveCompetitorSite", () => {
  it("watches a readable site as the rival's website and shows it on the page", async () => {
    stubWeb({ [GROUP]: { status: 200, body: HTML } });
    expect(await saveCompetitorSite(WS, RIVAL, "rival-group.com")).toEqual({ ok: true });

    expect(await customerWatches()).toEqual([{ url: GROUP, active: 1 }]);
    const page = await env.DB.prepare("SELECT role FROM page WHERE entity_id = ?1 AND url = ?2")
      .bind(RIVAL, GROUP)
      .first();
    expect(page).toEqual({ role: "other" });
    expect(await readSiteWatchSummary(WS, RIVAL)).toMatchObject({ customerSite: GROUP, unreadable: false });
  });

  it("replaces the earlier site: only the newest stays watched", async () => {
    stubWeb({ [GROUP]: { status: 200, body: HTML }, [PRESS]: { status: 200, body: HTML } });
    await saveCompetitorSite(WS, RIVAL, "rival-group.com");
    later(120_000);
    await saveCompetitorSite(WS, RIVAL, "press.rival-group.org");

    expect(await customerWatches()).toEqual([
      { url: PRESS, active: 1 },
      { url: GROUP, active: 0 },
    ]);
    expect((await readSiteWatchSummary(WS, RIVAL)).customerSite).toBe(PRESS);
  });

  it("refuses a site we cannot read and saves nothing", async () => {
    stubWeb({ [GROUP]: { status: 403, body: "denied" } });
    expect(await saveCompetitorSite(WS, RIVAL, "rival-group.com")).toEqual({
      ok: false,
      message: SITE_UNREADABLE_ERROR,
    });
    expect(await customerWatches()).toEqual([]);
  });

  it("refuses a site whose robots.txt keeps bots out, without fetching the page", async () => {
    const seen = stubWeb({
      "https://rival-group.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /" },
      [GROUP]: { status: 200, body: HTML },
    });
    expect(await saveCompetitorSite(WS, RIVAL, "rival-group.com")).toEqual({ ok: false, message: SITE_ROBOTS_ERROR });
    expect(seen).not.toContain(GROUP);
  });

  it("refuses the brand's own domain", async () => {
    const seen = stubWeb({});
    expect(await saveCompetitorSite(WS, RIVAL, "news.rival.com")).toEqual({ ok: false, message: SITE_SAME_ERROR });
    expect(seen).toEqual([]);
  });

  it("will not touch another workspace's competitor", async () => {
    stubWeb({ [GROUP]: { status: 200, body: HTML } });
    const outcome = await saveCompetitorSite(OTHER_WS, RIVAL, "rival-group.com");
    expect(outcome).toEqual({ ok: false, message: "We don't track that competitor." });
    expect(await customerWatches()).toEqual([]);
  });

  it("does not leak another workspace's site through the summary, and retiring is scoped to the workspace", async () => {
    stubWeb({ [GROUP]: { status: 200, body: HTML } });
    await saveCompetitorSite(WS, RIVAL, "rival-group.com");
    expect(await readSiteWatchSummary(OTHER_WS, RIVAL)).toEqual({
      pages: 0,
      lastPolledAt: null,
      unreadable: false,
      customerSite: null,
    });
    await retireCustomerSites(OTHER_WS, RIVAL, "https://elsewhere.example/");
    expect(await customerWatches()).toEqual([{ url: GROUP, active: 1 }]);
    await retireCustomerSites(WS, "ent-comp-site-other", "https://elsewhere.example/");
    expect(await customerWatches()).toEqual([{ url: GROUP, active: 1 }]);
  });

  it("makes the customer wait a minute between changes", async () => {
    stubWeb({ [GROUP]: { status: 200, body: HTML }, [PRESS]: { status: 200, body: HTML } });
    await saveCompetitorSite(WS, RIVAL, "rival-group.com");
    const seen = stubWeb({ [PRESS]: { status: 200, body: HTML } });
    expect(await saveCompetitorSite(WS, RIVAL, "press.rival-group.org")).toEqual({
      ok: false,
      message: SITE_WAIT_ERROR,
    });
    expect(seen).toEqual([]);
  });

  it("stops at five websites per competitor", async () => {
    const answers: Record<string, Answer> = {};
    for (let n = 0; n < 6; n += 1) answers[`https://site${String(n)}.example.org/`] = { status: 200, body: HTML };
    stubWeb(answers);
    for (let n = 0; n < 5; n += 1) {
      later(120_000 * (n + 1));
      expect(await saveCompetitorSite(WS, RIVAL, `site${String(n)}.example.org`)).toEqual({ ok: true });
    }
    later(120_000 * 7);
    expect(await saveCompetitorSite(WS, RIVAL, "site5.example.org")).toEqual({
      ok: false,
      message: SITE_TOO_MANY_ERROR,
    });
  });

  it("refuses a site that redirects into the brand's own domain", async () => {
    stubWeb({
      [GROUP]: { status: 301, body: "", location: "https://www.rival.com/" },
      "https://www.rival.com/": { status: 200, body: HTML },
    });
    expect(await saveCompetitorSite(WS, RIVAL, "rival-group.com")).toEqual({ ok: false, message: SITE_SAME_ERROR });
    expect(await customerWatches()).toEqual([]);
  });

  it("checks robots.txt again on the page a redirect lands on", async () => {
    stubWeb({
      [GROUP]: { status: 302, body: "", location: "https://other-group.net/" },
      "https://other-group.net/": { status: 200, body: HTML },
      "https://other-group.net/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /" },
    });
    expect(await saveCompetitorSite(WS, RIVAL, "rival-group.com")).toEqual({ ok: false, message: SITE_ROBOTS_ERROR });
  });
});

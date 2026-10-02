import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classifyCompetitorSites } from "../../../app/lib/site/classify-competitors.server";
import { planSiteSweep } from "../../../app/lib/site/sweep.server";

const NOW = "2026-10-02T02:00:00Z";
const USER = "user-comp-pricing";
const WS = "ws-comp-pricing";
const SELF = "ent-comp-pricing-self";
const RIVAL = "ent-comp-pricing-rival";
const HOME = "https://rival-shop.com/";
const PLANS = "https://rival-shop.com/plans";

const HOME_HTML = `<html><head><title>Rival</title></head><body>
<nav><a href="/plans">Plans</a><a href="/about">About us</a></nav>
<main><p>${"We make training clothes for people who train hard and rest harder. ".repeat(6)}</p></main></body></html>`;

function installJev(): void {
  Reflect.set(env, "AI", {
    run(_model: string, request: { questions: Record<string, { type: string }> }) {
      const asked = request.questions["page_role"] as { type: string; instructions?: string } | undefined;
      const text = JSON.stringify(request);
      const choice = text.includes("/plans") ? "pricing" : "other";
      return Promise.resolve({ answers: { page_role: { type: asked?.type ?? "choice", choice } } });
    },
  });
}

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 0, ?4, ?4)',
    ).bind(USER, "Owner", `${USER}@0509.io`, NOW),
    env.DB.prepare("INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)").bind(
      WS,
      USER,
      NOW,
    ),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at) VALUES (?1, ?2, 'self', 'owner-shop.com', 'Owner', '{}', 'manual', 'on', ?3)",
    ).bind(SELF, WS, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at) VALUES (?1, ?2, 'competitor', 'rival-shop.com', 'Rival', '{}', 'auto', 'on', ?3)",
    ).bind(RIVAL, WS, NOW),
  ]);
}

async function pricingWatches(): Promise<string[]> {
  const rows = await env.DB.prepare("SELECT target_key FROM watch WHERE entity_id = ?1 ORDER BY target_key")
    .bind(RIVAL)
    .all<{ target_key: string }>();
  return rows.results.map((row) => row.target_key);
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM watch WHERE entity_id IN (?1, ?2)").bind(SELF, RIVAL),
    env.DB.prepare("DELETE FROM page WHERE entity_id IN (?1, ?2)").bind(SELF, RIVAL),
    env.DB.prepare("DELETE FROM jev_verdict WHERE workspace_id = ?1").bind(WS),
    env.DB.prepare("DELETE FROM entity WHERE workspace_id = ?1").bind(WS),
    env.DB.prepare("DELETE FROM workspace WHERE id = ?1").bind(WS),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(USER),
  ]);
  await seed();
  installJev();
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === HOME) {
      return Promise.resolve(new Response(HOME_HTML, { status: 200, headers: { "content-type": "text/html" } }));
    }
    return Promise.resolve(new Response("", { status: 404 }));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(env, "AI");
});

describe("a competitor's pricing page", () => {
  it("is judged from its home navigation and watched on the next plan", async () => {
    expect(await classifyCompetitorSites(NOW)).toBeGreaterThanOrEqual(1);

    const targets = await planSiteSweep(NOW);
    const rival = targets.filter((target) => target.entityId === RIVAL);

    expect(rival.map((target) => [target.url, target.pageRole])).toEqual([
      [HOME, "home"],
      [PLANS, "pricing"],
    ]);
    expect(await pricingWatches()).toEqual([HOME, PLANS]);
  });

  it("is not judged twice once the brand has judged pages", async () => {
    await classifyCompetitorSites(NOW);
    const run = vi.fn(() => Promise.resolve({ answers: {} }));
    Reflect.set(env, "AI", { run });

    expect(await classifyCompetitorSites("2026-10-03T02:00:00Z")).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it("is not fetched again for three days when its home page cannot be read", async () => {
    const homeFetches = vi.fn();
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === HOME) homeFetches();
      return Promise.resolve(new Response("", { status: 503 }));
    });

    await classifyCompetitorSites(NOW);
    const first = homeFetches.mock.calls.length;
    expect(first).toBeGreaterThanOrEqual(1);

    await classifyCompetitorSites("2026-10-03T02:00:00Z");
    expect(homeFetches.mock.calls.length).toBe(first);

    await classifyCompetitorSites("2026-10-06T02:00:00Z");
    expect(homeFetches.mock.calls.length).toBeGreaterThan(first);
  });

  it("judges at most 40 navigation links and watches at most 3 pricing pages for one brand", async () => {
    const links = Array.from(
      { length: 60 },
      (_, index) => `<a href="/plans-${String(index)}">Plan ${String(index)}</a>`,
    );
    const html = `<html><head><title>Rival</title></head><body><nav>${links.join("")}</nav>
<main><p>${"We make training clothes for people who train hard and rest harder. ".repeat(6)}</p></main></body></html>`;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === HOME)
        return Promise.resolve(new Response(html, { status: 200, headers: { "content-type": "text/html" } }));
      return Promise.resolve(new Response("", { status: 404 }));
    });
    const run = vi.fn((_model: string, request: { questions: Record<string, { type: string }> }) =>
      Promise.resolve({
        answers: { page_role: { type: request.questions["page_role"]?.type ?? "choice", choice: "pricing" } },
      }),
    );
    Reflect.set(env, "AI", { run });

    await classifyCompetitorSites(NOW);
    await planSiteSweep(NOW);

    expect(run.mock.calls).toHaveLength(40);
    expect((await pricingWatches()).filter((target) => target !== HOME)).toHaveLength(3);
  });

  it("judges a pricing-looking link first even when it is the last of 60", async () => {
    const links = Array.from({ length: 59 }, (_, index) => `<a href="/p${String(index)}">Page ${String(index)}</a>`);
    const html = `<html><head><title>Rival</title></head><body><nav>${links.join("")}<a href="/pricing">Pricing</a></nav>
<main><p>${"We make training clothes for people who train hard and rest harder. ".repeat(6)}</p></main></body></html>`;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === HOME)
        return Promise.resolve(new Response(html, { status: 200, headers: { "content-type": "text/html" } }));
      return Promise.resolve(new Response("", { status: 404 }));
    });
    Reflect.set(env, "AI", {
      run: (_model: string, request: { questions: Record<string, { type: string }> }) =>
        Promise.resolve({
          answers: {
            page_role: {
              type: request.questions["page_role"]?.type ?? "choice",
              choice: JSON.stringify(request).includes("/pricing") ? "pricing" : "other",
            },
          },
        }),
    });

    await classifyCompetitorSites(NOW);
    await planSiteSweep(NOW);

    expect(await pricingWatches()).toContain("https://rival-shop.com/pricing");
  });

  async function seedWatchedPages(prefix: string, count: number, watched: number): Promise<string[]> {
    await planSiteSweep(NOW);
    const source = await env.DB.prepare("SELECT id FROM source WHERE key = 'site.web'").first<{ id: string }>();
    const urls = Array.from({ length: count }, (_, index) => `https://rival-shop.com/${prefix}-${String(index)}`);
    await env.DB.batch(
      urls.flatMap((url, index) => [
        env.DB.prepare(
          "INSERT INTO page (id, entity_id, url, role, role_decided_for_hash, discovered_at) VALUES (?1, ?2, ?3, 'pricing', 'h', ?4)",
        ).bind(`pg-${prefix}-${String(index)}`, RIVAL, url, NOW),
        ...(index < watched
          ? [
              env.DB.prepare("INSERT INTO watch (id, entity_id, source_id, target_key) VALUES (?1, ?2, ?3, ?4)").bind(
                `w-${prefix}-${String(index)}`,
                RIVAL,
                source?.id,
                url,
              ),
            ]
          : []),
      ]),
    );
    return urls;
  }

  async function watchStates(prefix: string): Promise<Record<string, number>> {
    const rows = await env.DB.prepare(
      "SELECT target_key, is_active FROM watch WHERE entity_id = ?1 AND target_key LIKE ?2 ORDER BY target_key",
    )
      .bind(RIVAL, `%/${prefix}-%`)
      .all<{ target_key: string; is_active: number }>();
    return Object.fromEntries(rows.results.map((row) => [row.target_key.split("/").pop() ?? "", row.is_active]));
  }

  it("trims a rival's existing pricing watches to the first 3, keeps the rows, and keeps them off", async () => {
    await seedWatchedPages("trim", 6, 6);

    await planSiteSweep(NOW);
    await planSiteSweep(NOW);

    expect(await watchStates("trim")).toEqual({
      "trim-0": 1,
      "trim-1": 1,
      "trim-2": 1,
      "trim-3": 0,
      "trim-4": 0,
      "trim-5": 0,
    });
  });

  it("stops watching a page re-judged as something else and gives its slot to the next pricing page", async () => {
    await seedWatchedPages("slot", 4, 3);
    await env.DB.prepare("UPDATE page SET role = 'other' WHERE id = 'pg-slot-0'").run();

    await planSiteSweep(NOW);

    expect(await watchStates("slot")).toEqual({ "slot-0": 0, "slot-1": 1, "slot-2": 1, "slot-3": 1 });
  });

  it("watches a new pricing page in a freed slot and turns a switched-off watch back on", async () => {
    await seedWatchedPages("free", 3, 3);
    await env.DB.prepare("UPDATE page SET role = 'other' WHERE id = 'pg-free-0'").run();
    await planSiteSweep(NOW);
    await env.DB.prepare(
      "INSERT INTO page (id, entity_id, url, role, role_decided_for_hash, discovered_at) VALUES ('pg-free-new', ?1, 'https://rival-shop.com/free-new', 'pricing', 'h', ?2)",
    )
      .bind(RIVAL, NOW)
      .run();
    await planSiteSweep(NOW);
    expect(await watchStates("free")).toEqual({ "free-0": 0, "free-1": 1, "free-2": 1, "free-new": 1 });

    await env.DB.prepare("UPDATE page SET role = 'pricing' WHERE id = 'pg-free-0'").run();
    await env.DB.prepare("UPDATE page SET role = 'other' WHERE id = 'pg-free-new'").run();
    await planSiteSweep(NOW);
    expect(await watchStates("free")).toEqual({ "free-0": 1, "free-1": 1, "free-2": 1, "free-new": 0 });
  });

  it("never switches off the owner's own page watches, home watches, or watches from other sources", async () => {
    const urls = await seedWatchedPages("keep", 5, 5);
    const source = await env.DB.prepare("SELECT id FROM source WHERE key = 'site.web'").first<{ id: string }>();
    const other = await env.DB.prepare("SELECT id FROM source WHERE key <> 'site.web' LIMIT 1").first<{ id: string }>();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO page (id, entity_id, url, role, role_decided_for_hash, discovered_at) VALUES ('pg-own-0', ?1, 'https://owner-shop.com/pricing', 'pricing', 'h', ?2)",
      ).bind(SELF, NOW),
      env.DB.prepare(
        "INSERT INTO page (id, entity_id, url, role, role_decided_for_hash, discovered_at) VALUES ('pg-own-1', ?1, 'https://owner-shop.com/about', 'other', 'h', ?2)",
      ).bind(SELF, NOW),
      env.DB.prepare(
        "INSERT INTO watch (id, entity_id, source_id, target_key) VALUES ('w-own-0', ?1, ?2, 'https://owner-shop.com/pricing')",
      ).bind(SELF, source?.id),
      env.DB.prepare(
        "INSERT INTO watch (id, entity_id, source_id, target_key) VALUES ('w-own-1', ?1, ?2, 'https://owner-shop.com/about')",
      ).bind(SELF, source?.id),
      env.DB.prepare("INSERT INTO watch (id, entity_id, source_id, target_key) VALUES ('w-other', ?1, ?2, ?3)").bind(
        RIVAL,
        other?.id,
        urls[4],
      ),
    ]);

    await planSiteSweep(NOW);
    await planSiteSweep(NOW);

    const state = await env.DB.prepare("SELECT id, is_active FROM watch WHERE id IN ('w-own-0','w-own-1','w-other')")
      .all<{ id: string; is_active: number }>()
      .then((rows) => Object.fromEntries(rows.results.map((row) => [row.id, row.is_active])));
    expect(state).toEqual({ "w-own-0": 1, "w-own-1": 1, "w-other": 1 });
    const home = await env.DB.prepare(
      "SELECT is_active FROM watch WHERE entity_id IN (?1, ?2) AND target_key IN (?3, ?4)",
    )
      .bind(SELF, RIVAL, "https://owner-shop.com/", HOME)
      .all<{ is_active: number }>();
    expect(home.results.length).toBeGreaterThan(0);
    expect(home.results.every((row) => row.is_active === 1)).toBe(true);
  });
});

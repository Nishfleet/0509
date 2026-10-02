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

  it("trims a rival's existing pricing watches to the first 3 and keeps the rest from coming back", async () => {
    await planSiteSweep(NOW);
    const source = await env.DB.prepare("SELECT id FROM source WHERE key = 'site.web'").first<{ id: string }>();
    const urls = Array.from({ length: 6 }, (_, index) => `https://rival-shop.com/plans-${String(index)}`);
    await env.DB.batch(
      urls.flatMap((url, index) => [
        env.DB.prepare(
          "INSERT INTO page (id, entity_id, url, role, role_decided_for_hash, discovered_at) VALUES (?1, ?2, ?3, 'pricing', 'h', ?4)",
        ).bind(`pg-trim-${String(index)}`, RIVAL, url, NOW),
        env.DB.prepare("INSERT INTO watch (id, entity_id, source_id, target_key) VALUES (?1, ?2, ?3, ?4)").bind(
          `w-trim-${String(index)}`,
          RIVAL,
          source?.id,
          url,
        ),
      ]),
    );

    await planSiteSweep(NOW);
    await planSiteSweep(NOW);

    const active = await env.DB.prepare(
      "SELECT target_key FROM watch WHERE entity_id = ?1 AND is_active = 1 AND target_key LIKE '%/plans-%' ORDER BY target_key",
    )
      .bind(RIVAL)
      .all<{ target_key: string }>();
    expect(active.results.map((row) => row.target_key)).toEqual(urls.slice(0, 3));
  });

  it("does not watch a fourth pricing page when one of the three is judged something else", async () => {
    await planSiteSweep(NOW);
    const source = await env.DB.prepare("SELECT id FROM source WHERE key = 'site.web'").first<{ id: string }>();
    const urls = Array.from({ length: 4 }, (_, index) => `https://rival-shop.com/plans-${String(index)}`);
    await env.DB.batch(
      urls.flatMap((url, index) => [
        env.DB.prepare(
          "INSERT INTO page (id, entity_id, url, role, role_decided_for_hash, discovered_at) VALUES (?1, ?2, ?3, 'pricing', 'h', ?4)",
        ).bind(`pg-drift-${String(index)}`, RIVAL, url, NOW),
        ...(index < 3
          ? [
              env.DB.prepare("INSERT INTO watch (id, entity_id, source_id, target_key) VALUES (?1, ?2, ?3, ?4)").bind(
                `w-drift-${String(index)}`,
                RIVAL,
                source?.id,
                url,
              ),
            ]
          : []),
      ]),
    );
    await env.DB.prepare("UPDATE page SET role = 'other' WHERE id = 'pg-drift-0'").run();

    await planSiteSweep(NOW);

    const active = await env.DB.prepare(
      "SELECT target_key FROM watch WHERE entity_id = ?1 AND is_active = 1 AND target_key LIKE '%/plans-%'",
    )
      .bind(RIVAL)
      .all();
    expect(active.results).toHaveLength(3);
  });
});

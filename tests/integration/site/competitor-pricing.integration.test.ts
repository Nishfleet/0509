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
});

import { env } from "cloudflare:test";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildIdentityCard } from "../../../app/lib/identity/card.server";
import fixture from "../../fixtures/gymshark-2026-09-21.html?raw";

// The whole card write path against real local D1 (migrations applied by the
// workers project setup). fetch is stubbed per-URL so the run is
// deterministic; the real-network probes are cited in the PR body.

const JEV_ANSWERS = {
  answers: {
    public_subject: { type: "boolean", probability: 0.97 },
    d7_name: { type: "boolean", probability: 0.96 },
    d7_logo: { type: "boolean", probability: 0.94 },
    d7_description: { type: "boolean", probability: 0.55 }, // the "check this" band
    d7_socials: { type: "boolean", probability: 0.93 },
  },
};

function stubFetch(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://gymshark.com/") return new Response(fixture, { status: 200 });
    if (url.includes("wikidata.org")) return new Response(JSON.stringify({ search: [] }), { status: 200 });
    if (url.includes("site.webmanifest")) return new Response(JSON.stringify({ name: "", icons: [] }), { status: 200 });
    if (url.startsWith("http://jev.test")) return new Response(JSON.stringify(JEV_ANSWERS), { status: 200 });
    return new Response("nf", { status: 404 }); // logo candidates
  });
}

async function seedUser() {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT OR IGNORE INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ('u1','U','u@t.co',0,?,?)`).bind(now, now).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO workspace (id, name, owner_user_id, created_at) VALUES ('w1','W','u1',?)`).bind(now).run();
}

afterEach(() => vi.restoreAllMocks());

describe("buildIdentityCard (#3885 P4)", () => {
  it("writes entity + pages + verdicts + onboarding_run in one batch", async () => {
    await seedUser();
    stubFetch();
    const res = await buildIdentityCard(
      { db: env.DB, cache: env.IDENTITY_CACHE, jev: { url: "http://jev.test/jev" } },
      { workspaceId: "w1", userId: "u1", input: "gymshark.com" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const entity = await env.DB.prepare(`SELECT role, state, name FROM entity WHERE id = ?`).bind(res.entityId).first();
    expect(entity?.role).toBe("self");
    expect(entity?.state).toBe("on");
    expect(entity?.name).toBe("Gymshark");

    const pages = await env.DB.prepare(`SELECT role FROM page WHERE entity_id = ?`).bind(res.entityId).all();
    expect(pages.results.length).toBeGreaterThan(0);

    const verdicts = await env.DB.prepare(`SELECT question_id, p FROM jev_verdict WHERE workspace_id = 'w1'`).all();
    expect(verdicts.results.length).toBe(res.verdictCount);
    expect(verdicts.results.map((r) => r.question_id)).toContain("public_subject");

    const run = await env.DB.prepare(`SELECT card_ready_at FROM onboarding_run WHERE id = ?`).bind(res.onboardingRunId).first();
    expect(run?.card_ready_at).toBeTruthy();

    const desc = res.fields.find((f) => f.name === "description");
    expect(desc?.state).toBe("check"); // p=0.55 sits in the band — shown, not auto-trusted
    const name = res.fields.find((f) => f.name === "name");
    expect(name).toMatchObject({ value: "Gymshark", state: "filled" });
  });

  it("refuses a takedown-listed subject before any probe", async () => {
    await seedUser();
    await env.DB.prepare(`INSERT INTO takedown (id, subject, created_at) VALUES ('t1','gymshark.com',?)`).bind(new Date().toISOString()).run();
    const spy = stubFetch();
    const res = await buildIdentityCard(
      { db: env.DB, cache: env.IDENTITY_CACHE, jev: { url: "http://jev.test/jev" } },
      { workspaceId: "w1", userId: "u1", input: "gymshark.com" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("brands and creators");
    expect(spy).not.toHaveBeenCalled(); // no probe is made at all
  });

  it("renders fields as extracted+check when Jev is unreachable", async () => {
    await seedUser();
    stubFetch();
    await env.DB.prepare(`DELETE FROM takedown WHERE subject = 'gymshark.com'`).run();
    const res = await buildIdentityCard(
      { db: env.DB, cache: env.IDENTITY_CACHE, jev: { url: "http://jev.invalid/jev" } },
      { workspaceId: "w1", userId: "u1", input: "gymshark.com" },
    );
    // jev.invalid misses the stub's jev.test prefix -> 404 -> Jev failure path.
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.verdictCount).toBe(0);
    expect(res.fields.find((f) => f.name === "name")?.state).toBe("check");
  });
});

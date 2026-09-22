import { env } from "cloudflare:test";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildIdentityCard } from "../../../app/lib/identity/card.server";
import fixture from "../../fixtures/gymshark-2026-09-21.html?raw";

// The whole card write path against real local D1 (migrations applied by the
// workers project setup). fetch is stubbed per-URL so the run is
// deterministic; the real-network probes are cited in the PR body.

let d9Asked = 0;

function stubFetch(opts: { publicSubjectP?: number } = {}): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const u = new URL(url);
    if (url === "https://gymshark.com/") return new Response(fixture, { status: 200 });
    if (u.hostname === "www.wikidata.org") {
      return new Response(JSON.stringify({ search: [] }), { status: 200 });
    }
    if (u.pathname.endsWith("site.webmanifest")) {
      return new Response(JSON.stringify({ name: "", icons: [] }), { status: 200 });
    }
    if (u.hostname === "jev.test") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { questions?: Record<string, unknown> };
      const asked = Object.keys(body.questions ?? {});
      d9Asked = asked.filter((q) => q.startsWith("d9_")).length;
      const answers = Object.fromEntries(
        asked.map((qid) => [
          qid,
          qid.startsWith("d9_")
            ? { type: "choice", choice: "pricing", probabilities: { pricing: 0.8 }, reason: `stub:${qid}` }
            : qid === "public_subject"
              ? { type: "boolean", probability: opts.publicSubjectP ?? 0.97, reason: "stub:public_subject" }
              : { type: "boolean", probability: qid === "d7_description" ? 0.55 : 0.93, reason: `stub:${qid}` },
        ]),
      );
      return new Response(JSON.stringify({ answers }), { status: 200 });
    }
    return new Response("nf", { status: 404 });
  });
}

function countingDb(db: D1Database): { counts: { batch: number; run: number }; db: D1Database } {
  const counts = { batch: 0, run: 0 };
  const wrapStmt = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop) {
        if (prop === "bind") {
          return (...a: unknown[]) =>
            wrapStmt((target.bind as (...x: unknown[]) => D1PreparedStatement).apply(target, a));
        }
        if (prop === "run") {
          return async (...a: unknown[]) => {
            counts.run += 1;
            return (target.run as (...x: unknown[]) => Promise<unknown>).apply(target, a);
          };
        }
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => wrapStmt(target.prepare(sql));
      if (prop === "batch") {
        return async (stmts: D1PreparedStatement[]) => {
          counts.batch += 1;
          return target.batch(stmts);
        };
      }
      const v = Reflect.get(target, prop) as unknown;
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { counts, db: proxy };
}

async function seedUser() {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT OR IGNORE INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ('u1','U','u@t.co',0,?,?)`).bind(now, now).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO workspace (id, name, owner_user_id, created_at) VALUES ('w1','W','u1',?)`).bind(now).run();
}

afterEach(() => vi.restoreAllMocks());

describe("buildIdentityCard (#3885 P4)", () => {
  it("writes entity + pages + verdicts in one batch", async () => {
    await seedUser();
    stubFetch();
    const { counts, db } = countingDb(env.DB);
    const res = await buildIdentityCard(
      { db, cache: env.IDENTITY_CACHE, jev: { url: "http://jev.test/jev" } },
      { workspaceId: "w1", userId: "u1", input: "gymshark.com" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(counts.batch).toBe(1);
    expect(counts.run).toBe(0);

    const entity = await env.DB.prepare(`SELECT role, state, name FROM entity WHERE id = ?`).bind(res.entityId).first();
    expect(entity?.role).toBe("self");
    expect(entity?.state).toBe("on");
    expect(entity?.name).toBe("Gymshark");

    const pages = await env.DB.prepare(`SELECT role FROM page WHERE entity_id = ?`).bind(res.entityId).all();
    expect(pages.results.length).toBeGreaterThan(0);

    const verdicts = await env.DB.prepare(`SELECT question_id, input_hash, p, reason FROM jev_verdict WHERE workspace_id = 'w1'`).all();
    expect(verdicts.results.length).toBe(res.verdictCount);
    expect(verdicts.results.map((r) => r.question_id)).toContain("public_subject");
    expect(verdicts.results.find((r) => r.question_id === "d7_name")?.reason).toBe("stub:d7_name");

    expect(d9Asked).toBeGreaterThanOrEqual(2);
    const d9 = await env.DB
      .prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT input_hash) AS h FROM jev_verdict WHERE question_id = 'd9_page_role'`)
      .first<{ n: number; h: number }>();
    expect(d9?.n).toBe(d9Asked);
    expect(d9?.h).toBe(d9Asked);

    const run = await env.DB.prepare(`SELECT card_ready_at FROM onboarding_run WHERE id = ?`).bind(res.onboardingRunId).first();
    expect(run?.card_ready_at).toBeTruthy();

    const desc = res.fields.find((f) => f.name === "description");
    expect(desc?.state).toBe("check");
    const name = res.fields.find((f) => f.name === "name");
    expect(name).toMatchObject({ value: "Gymshark", state: "filled" });
  });

  it("refuses a takedown-listed subject before any probe and records the refusal", async () => {
    await seedUser();
    await env.DB.prepare(`INSERT INTO takedown (id, subject, created_at) VALUES ('t1','gymshark.com',?)`).bind(new Date().toISOString()).run();
    await env.DB.prepare(`DELETE FROM entity WHERE workspace_id = 'w1'`).run();
    const spy = stubFetch();
    const res = await buildIdentityCard(
      { db: env.DB, cache: env.IDENTITY_CACHE, jev: { url: "http://jev.test/jev" } },
      { workspaceId: "w1", userId: "u1", input: "gymshark.com" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("brands and creators");
    expect(spy).not.toHaveBeenCalled();

    const refusal = await env.DB
      .prepare(`SELECT verdict FROM user_decision WHERE workspace_id = 'w1' AND verdict = 'refused:takedown'`)
      .first();
    expect(refusal).toBeTruthy();
    const entities = await env.DB.prepare(`SELECT COUNT(*) AS n FROM entity WHERE workspace_id = 'w1'`).first<{ n: number }>();
    expect(entities?.n).toBe(0);
  });

  it("refuses a private subject on the D10 verdict and records verdict + refusal", async () => {
    await seedUser();
    await env.DB.prepare(`DELETE FROM takedown WHERE subject = 'gymshark.com'`).run();
    await env.DB.prepare(`DELETE FROM user_decision WHERE workspace_id = 'w1'`).run();
    await env.DB.prepare(`DELETE FROM entity WHERE workspace_id = 'w1'`).run();
    stubFetch({ publicSubjectP: 0.05 });
    const res = await buildIdentityCard(
      { db: env.DB, cache: env.IDENTITY_CACHE, jev: { url: "http://jev.test/jev" } },
      { workspaceId: "w1", userId: "u1", input: "gymshark.com" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("brands and creators");

    const verdict = await env.DB
      .prepare(`SELECT p FROM jev_verdict WHERE workspace_id = 'w1' AND question_id = 'public_subject'`)
      .first<{ p: number }>();
    expect(verdict?.p).toBe(0.05);
    const refusal = await env.DB
      .prepare(`SELECT verdict FROM user_decision WHERE workspace_id = 'w1' AND verdict = 'refused:public_subject'`)
      .first();
    expect(refusal).toBeTruthy();
    const entities = await env.DB.prepare(`SELECT COUNT(*) AS n FROM entity WHERE workspace_id = 'w1'`).first<{ n: number }>();
    expect(entities?.n).toBe(0);
  });

  it("renders fields as extracted+check when Jev is unreachable", async () => {
    await seedUser();
    stubFetch();
    await env.DB.prepare(`DELETE FROM takedown WHERE subject = 'gymshark.com'`).run();
    await env.DB.prepare(`DELETE FROM user_decision WHERE workspace_id = 'w1'`).run();
    const res = await buildIdentityCard(
      { db: env.DB, cache: env.IDENTITY_CACHE, jev: { url: "http://jev.invalid/jev" } },
      { workspaceId: "w1", userId: "u1", input: "gymshark.com" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.verdictCount).toBe(0);
    expect(res.fields.find((f) => f.name === "name")?.state).toBe("check");
  });

  it("re-onboard reuses the canonical entity id", async () => {
    await seedUser();
    stubFetch();
    await env.DB.prepare(`DELETE FROM user_decision WHERE workspace_id = 'w1'`).run();
    const first = await buildIdentityCard(
      { db: env.DB, cache: env.IDENTITY_CACHE, jev: { url: "http://jev.test/jev" } },
      { workspaceId: "w1", userId: "u1", input: "gymshark.com" },
    );
    const second = await buildIdentityCard(
      { db: env.DB, cache: env.IDENTITY_CACHE, jev: { url: "http://jev.test/jev" } },
      { workspaceId: "w1", userId: "u1", input: "gymshark.com" },
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.entityId).toBe(first.entityId);
    const entities = await env.DB.prepare(`SELECT COUNT(*) AS n FROM entity WHERE workspace_id = 'w1'`).first<{ n: number }>();
    expect(entities?.n).toBe(1);
  });
});

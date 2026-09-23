import { env } from "cloudflare:test";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  confirmEntityStmt,
  confirmedSelfEntityForWorkspace,
  readEntityForWorkspace,
  readSelfEntityForWorkspace,
} from "../../../app/lib/data/entity.server";
import { readOnboardingRunForWorkspace } from "../../../app/lib/data/onboarding-run.server";
import { priorConfirmationExists, recordIdentityConfirmation } from "../../../app/lib/data/user-decision.server";
import { buildIdentityCard, cardFromIdentityJson } from "../../../app/lib/identity/card.server";
import { IdentityTailWorkflow, type Params as TailParams } from "../../../workers/identity-tail-workflow";
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

function failingBatchDb(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, prop, recv) {
      if (prop === "batch") return () => Promise.reject(new Error("injected batch failure"));
      const v = Reflect.get(target, prop, recv) as unknown;
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

async function seedUser() {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT OR IGNORE INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ('u1','U','u@t.co',0,?,?)`).bind(now, now).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO workspace (id, name, owner_user_id, created_at) VALUES ('w1','W','u1',?)`).bind(now).run();
}

afterEach(() => vi.restoreAllMocks());

describe("buildIdentityCard (#3885 P4)", () => {
  it("writes entity + pages + verdicts", async () => {
    await seedUser();
    stubFetch();
    const res = await buildIdentityCard(
      { db: env.DB, cache: env.IDENTITY_CACHE, jev: { url: "http://jev.test/jev" } },
      { workspaceId: "w1", userId: "u1", input: "gymshark.com" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.publicSubject).toBe("cleared");

    const entity = await env.DB
      .prepare(`SELECT role, state, name, confirmed_at FROM entity WHERE id = ?`)
      .bind(res.entityId)
      .first();
    expect(entity?.role).toBe("self");
    expect(entity?.state).toBe("on");
    expect(entity?.name).toBe("Gymshark");
    expect(entity?.confirmed_at).toBeNull();

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
    const pricing = res.fields.find((f) => f.name === "pricing_page");
    expect(pricing?.state).toBe("check");
    expect(pricing?.value).toBeTruthy();
    const category = res.fields.find((f) => f.name === "category");
    expect(category?.state).toBe("empty");

    const row = await env.DB
      .prepare(`SELECT identity_json FROM entity WHERE id = ?`)
      .bind(res.entityId)
      .first<{ identity_json: string }>();
    const stored = cardFromIdentityJson(res.entityId, row?.identity_json ?? "");
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.onboardingRunId).toBe(res.onboardingRunId);
    expect(stored.subject.registrable).toBe("gymshark.com");
    expect(stored.transport).toBe("fetch");
    expect(stored.publicSubject).toBe("cleared");
    expect(stored.verdictCount).toBe(res.verdictCount);
    expect(stored.fields.find((f) => f.name === "name")).toMatchObject({ value: "Gymshark", state: "filled" });

    expect(await readSelfEntityForWorkspace(res.entityId, "w1")).toBeTruthy();
    expect(await readOnboardingRunForWorkspace(res.onboardingRunId, "w1")).toBeTruthy();
    expect(await readOnboardingRunForWorkspace(res.onboardingRunId, "w2")).toBeNull();
  });

  it("confirm marker records edits + confirmation and reads back per workspace", async () => {
    await seedUser();
    stubFetch();
    await env.DB.prepare(`DELETE FROM user_decision WHERE workspace_id = 'w1'`).run();
    const res = await buildIdentityCard(
      { db: env.DB, cache: env.IDENTITY_CACHE, jev: { url: "http://jev.test/jev" } },
      { workspaceId: "w1", userId: "u1", input: "gymshark.com" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(await priorConfirmationExists("w1", res.entityId)).toBe(false);
    await recordIdentityConfirmation({
      workspaceId: "w1",
      userId: "u1",
      entityId: res.entityId,
      runId: res.onboardingRunId,
      edits: { name: "Gymshark Ltd" },
    });
    expect(await priorConfirmationExists("w1", res.entityId)).toBe(true);
    const marker = await env.DB
      .prepare(`SELECT verdict, note FROM user_decision WHERE workspace_id = 'w1' AND verdict = 'confirmed:identity'`)
      .first<{ verdict: string; note: string }>();
    expect(marker?.note).toBe(res.onboardingRunId);
    const edit = await env.DB
      .prepare(`SELECT verdict, note FROM user_decision WHERE workspace_id = 'w1' AND verdict = 'identity_edit:name'`)
      .first<{ verdict: string; note: string }>();
    expect(edit?.note).toBe("Gymshark Ltd");

    expect(await confirmedSelfEntityForWorkspace("w1")).toBeNull();
    await env.DB.batch([
      confirmEntityStmt(env.DB, {
        entityId: res.entityId,
        workspaceId: "w1",
        now: new Date().toISOString(),
      }),
    ]);
    expect(await confirmedSelfEntityForWorkspace("w1")).toMatchObject({ id: res.entityId });
    expect(await confirmedSelfEntityForWorkspace("w2")).toBeNull();
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
    expect(res.jevStatus).toBe("unreachable");
    expect(res.publicSubject).toBe("unverified");
    expect(res.fields.find((f) => f.name === "name")?.state).toBe("check");
    const stored = await env.DB
      .prepare(`SELECT identity_json FROM entity WHERE id = ?`)
      .bind(res.entityId)
      .first<{ identity_json: string }>();
    expect(JSON.parse(stored?.identity_json ?? "{}").jev_status).toBe("unreachable");
    const unconfirmed = await env.DB
      .prepare(`SELECT confirmed_at FROM entity WHERE id = ?`)
      .bind(res.entityId)
      .first();
    expect(unconfirmed?.confirmed_at).toBeNull();
  });

  it("leaves no rows when the persist batch fails", async () => {
    await seedUser();
    stubFetch();
    await env.DB.prepare(`DELETE FROM takedown WHERE subject = 'gymshark.com'`).run();
    await env.DB.prepare(`DELETE FROM user_decision WHERE workspace_id = 'w1'`).run();
    await env.DB.prepare(`DELETE FROM entity WHERE workspace_id = 'w1'`).run();
    await expect(
      buildIdentityCard(
        { db: failingBatchDb(env.DB), cache: env.IDENTITY_CACHE, jev: { url: "http://jev.test/jev" } },
        { workspaceId: "w1", userId: "u1", input: "gymshark.com" },
      ),
    ).rejects.toThrow("injected batch failure");
    const entities = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM entity WHERE workspace_id = 'w1'`)
      .first<{ n: number }>();
    expect(entities?.n).toBe(0);
  });

  it("confirm path only sees entities inside the session workspace", async () => {
    await seedUser();
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT OR IGNORE INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ('u2','U2','u2@t.co',0,?,?)`).bind(now, now).run();
    await env.DB.prepare(`INSERT OR IGNORE INTO workspace (id, name, owner_user_id, created_at) VALUES ('w2','W2','u2',?)`).bind(now).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO entity (id, workspace_id, role, domain, origin, state, created_at)
       VALUES ('e-other','w2','self','other.example','manual','on',?)`,
    ).bind(now).run();
    expect(await readEntityForWorkspace("e-other", "w1")).toBeNull();
    expect((await readEntityForWorkspace("e-other", "w2"))?.domain).toBe("other.example");
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

// The durable tail is the fail-closed gate: an unverified public_subject never
// confirms. run() is driven directly with a stub step + env so the refusal and
// confirm branches execute against real local D1.

function stubStep() {
  return {
    do: async (_name: string, a: unknown, b?: () => Promise<unknown>) => {
      const fn = typeof a === "function" ? (a as () => Promise<unknown>) : b;
      return fn?.();
    },
  } as unknown as WorkflowStep;
}

function tailWorkflow(jevUrl: string, sendSpy = vi.fn(async () => ({}))) {
  const wfEnv = {
    ...env,
    PAGE_SWEEP: { send: sendSpy },
    JEV_URL: jevUrl,
    JEV_API_KEY: "k",
  } as Env;
  const run = (event: WorkflowEvent<TailParams>) =>
    IdentityTailWorkflow.prototype.run.call({ env: wfEnv }, event, stubStep());
  return { run, sendSpy };
}

async function seedDraftEntity(id: string, domain: string) {
  const now = new Date().toISOString();
  await env.DB.prepare(`DELETE FROM entity WHERE workspace_id = 'w1'`).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO entity (id, workspace_id, role, domain, origin, state, created_at)
     VALUES (?, 'w1', 'self', ?, 'manual', 'on', ?)`,
  ).bind(id, domain, now).run();
}

function tailEvent(entityId: string, domain: string, publicSubject: TailParams["publicSubject"]) {
  return {
    payload: {
      workspaceId: "w1",
      userId: "u1",
      entityId,
      onboardingRunId: "r1",
      domain,
      homepageUrl: null,
      publicSubject,
    },
  } as WorkflowEvent<TailParams>;
}

describe("IdentityTailWorkflow (#3885 P4)", () => {
  it("confirms a cleared subject without re-judging", async () => {
    await seedUser();
    await seedDraftEntity("e-clear", "clear.example");
    const { run, sendSpy } = tailWorkflow("http://jev.test/jev");
    await run(tailEvent("e-clear", "clear.example", "cleared"));
    const row = await env.DB.prepare(`SELECT confirmed_at FROM entity WHERE id = 'e-clear'`).first();
    expect(row?.confirmed_at).toBeTruthy();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    await env.DB.prepare(`DELETE FROM entity WHERE id = 'e-clear'`).run();
  });

  it("deletes the draft and records the refusal when Jev refuses the subject", async () => {
    await seedUser();
    await seedDraftEntity("e-refuse", "refuse.example");
    stubFetch({ publicSubjectP: 0.05 });
    const { run, sendSpy } = tailWorkflow("http://jev.test/jev");
    await run(tailEvent("e-refuse", "refuse.example", "unverified"));

    expect(await env.DB.prepare(`SELECT id FROM entity WHERE id = 'e-refuse'`).first()).toBeNull();
    const refusal = await env.DB
      .prepare(`SELECT verdict, note FROM user_decision WHERE workspace_id = 'w1' AND verdict = 'refused:public_subject' AND note = 'refuse.example'`)
      .first<{ verdict: string; note: string }>();
    expect(refusal).toBeTruthy();
    const verdict = await env.DB
      .prepare(`SELECT p, entity_id FROM jev_verdict WHERE workspace_id = 'w1' AND question_id = 'public_subject' AND entity_id IS NULL ORDER BY decided_at DESC LIMIT 1`)
      .first<{ p: number; entity_id: string | null }>();
    expect(verdict?.p).toBe(0.05);
    expect(verdict?.entity_id).toBeNull();
    expect(sendSpy).not.toHaveBeenCalled();
    await env.DB.prepare(`DELETE FROM user_decision WHERE workspace_id = 'w1' AND note = 'refuse.example'`).run();
    await env.DB.prepare(`DELETE FROM jev_verdict WHERE workspace_id = 'w1' AND entity_id IS NULL`).run();
  });

  it("fails the run and seeds nothing when the re-judge cannot reach Jev", async () => {
    await seedUser();
    await seedDraftEntity("e-retry", "retry.example");
    const { run, sendSpy } = tailWorkflow("http://127.0.0.1:1/jev");
    // Fail-closed: the gate step throws, so the run ends before persist,
    // seed-watches, discovery or the first snapshot. The stub step runs each
    // fn once; under real Workflows the throw is what step.do retries.
    await expect(run(tailEvent("e-retry", "retry.example", "unverified"))).rejects.toThrow(
      /public-subject gate/,
    );
    const row = await env.DB.prepare(`SELECT confirmed_at FROM entity WHERE id = 'e-retry'`).first();
    expect(row?.confirmed_at).toBeNull();
    expect(sendSpy).not.toHaveBeenCalled();
    const watches = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM watch WHERE entity_id = 'e-retry'`)
      .first<{ n: number }>();
    expect(watches?.n).toBe(0);
    const refusal = await env.DB
      .prepare(`SELECT id FROM user_decision WHERE workspace_id = 'w1' AND note = 'retry.example'`)
      .first();
    expect(refusal).toBeNull();
    await env.DB.prepare(`DELETE FROM entity WHERE id = 'e-retry'`).run();
  });
});

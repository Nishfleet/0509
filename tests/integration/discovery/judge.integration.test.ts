import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  excludedDomains,
  judgeShortlist,
  judgeTracked,
} from "../../../app/lib/discovery/judge";
import {
  discoveryEntityId,
  persistDiscovery,
  persistRefresh,
} from "../../../app/lib/discovery/persist";
import type { ScoredCandidate } from "../../../app/lib/discovery/shortlist";

// Jev is stubbed per case (its verdicts are inputs, not the thing under test);
// every assertion below is against real local D1 rows — the schema, the batch
// write and the UNIQUE constraints are what this suite pins.

const NOW = "2026-09-22T12:00:00.000Z";
let seedN = 0;

async function seedWorkspace() {
  seedN += 1;
  const userId = `u_dsc_${seedN}`;
  const workspaceId = `ws_dsc_${seedN}`;
  const selfId = `ent_self_${seedN}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
    ).bind(userId, "Test", `dsc-${seedN}@example.test`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(workspaceId, "Discovery Test", userId, "UTC", NOW),
    env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
       VALUES (?1, ?2, 'self', 'gymshark.com', 'Gymshark', ?3, 'manual', 'on', ?4)`,
    ).bind(selfId, workspaceId, JSON.stringify({ category: "DTC gym apparel", country: "GB" }), NOW),
  ]);
  return { workspaceId, selfId };
}

function scored(over: Partial<ScoredCandidate> & { name: string; domain?: string }): ScoredCandidate {
  const domain = over.domain ?? null;
  return {
    candidate: {
      name: over.name,
      ...(domain ? { domain } : {}),
      evidence: over.candidate?.evidence ?? [
        {
          sourceUrl: "https://example.test/roundup",
          excerpt: `${over.name} appears beside the subject`,
          generator: "google-news-roundup",
          publisherDomain: "example.test",
        },
      ],
    },
    key: domain ? `d:${domain}` : `n:${over.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
    domain,
    generatorCount: over.generatorCount ?? 2,
    publisherCount: over.publisherCount ?? 2,
    evidenceCount: over.evidenceCount ?? 2,
    guaranteedVia: over.guaranteedVia ?? null,
    shortlisted: over.shortlisted ?? true,
  };
}

function jevStub(p: number, extra?: Record<string, unknown>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("jev.test")) {
      return new Response(
        JSON.stringify({
          answers: {
            is_competitor: { type: "boolean", probability: p },
            still_competitor: { type: "boolean", probability: p },
            reason: { type: "choice", choice: "active", probabilities: { active: 1 } },
            ...extra,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("<html><body>ok</body></html>", { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const JEV_ENV = (impl: typeof fetch) => ({
  DB: env.DB,
  JEV_ENDPOINT: "https://jev.test/jev",
  JEV_KEY: "test-key",
  fetchImpl: impl,
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM jev_verdict"),
    env.DB.prepare("DELETE FROM suggestion"),
    env.DB.prepare("DELETE FROM watch"),
    env.DB.prepare("DELETE FROM entity"),
    env.DB.prepare("DELETE FROM workspace"),
    env.DB.prepare("DELETE FROM user"),
  ]);
});

describe("judgeShortlist + persistDiscovery against real D1", () => {
  it("accepts at p >= 0.9 with a resolved live domain and writes entity + suggestion + verdict in one batch", async () => {
    const { workspaceId } = await seedWorkspace();
    const { impl } = jevStub(0.93);
    const row = scored({ name: "Alphalete Athletics", domain: "alphaleteathletics.com" });
    const judged = await judgeShortlist(JEV_ENV(impl), workspaceId, [row], new Map());
    expect(judged).toHaveLength(1);
    expect(judged[0]!.decision).toBe("accept");
    expect(judged[0]!.p).toBe(0.93);
    const result = await persistDiscovery({ DB: env.DB }, workspaceId, judged, [row]);
    expect(result.accepted).toEqual(["alphaleteathletics.com"]);
    const entity = await env.DB.prepare(
      "SELECT role, origin, state FROM entity WHERE workspace_id = ? AND domain = 'alphaleteathletics.com'",
    )
      .bind(workspaceId)
      .first();
    expect(entity).toMatchObject({ role: "competitor", origin: "auto", state: "on" });
    const suggestion = await env.DB.prepare(
      "SELECT status, decided_by, verdict_p FROM suggestion WHERE workspace_id = ? AND candidate_domain = 'alphaleteathletics.com'",
    )
      .bind(workspaceId)
      .first();
    expect(suggestion).toMatchObject({ status: "auto_on", decided_by: "jev", verdict_p: 0.93 });
    const verdict = await env.DB.prepare(
      "SELECT question_id, p, entity_id FROM jev_verdict WHERE workspace_id = ?",
    )
      .bind(workspaceId)
      .first();
    expect(verdict).toMatchObject({ question_id: "d1.is_competitor", p: 0.93 });
    expect(verdict!.entity_id).toBe(await discoveryEntityId(workspaceId, "alphaleteathletics.com"));
  });

  it("handles the p = 0.9 boundary as add, and p <= 0.1 as dismissed", async () => {
    const { workspaceId } = await seedWorkspace();
    const { impl } = jevStub(0.9);
    const boundary = scored({ name: "Boundary Brand", domain: "boundary.test" });
    const judged = await judgeShortlist(JEV_ENV(impl), workspaceId, [boundary], new Map());
    expect(judged[0]!.decision).toBe("accept");
    const { impl: implDrop } = jevStub(0.05);
    const loser = scored({ name: "Noise Publisher", domain: "noise.test" });
    const judgedDrop = await judgeShortlist(JEV_ENV(implDrop), workspaceId, [loser], new Map());
    expect(judgedDrop[0]!.decision).toBe("drop");
    await persistDiscovery({ DB: env.DB }, workspaceId, [...judged, ...judgedDrop], [boundary, loser]);
    const dropped = await env.DB.prepare(
      "SELECT status, decided_by FROM suggestion WHERE candidate_domain = 'noise.test'",
    ).first();
    expect(dropped).toMatchObject({ status: "dismissed", decided_by: "jev" });
  });

  it("never re-suggests a dismissed candidate on a later run", async () => {
    const { workspaceId } = await seedWorkspace();
    const { impl } = jevStub(0.05);
    const loser = scored({ name: "Noise Publisher", domain: "noise.test" });
    const first = await judgeShortlist(JEV_ENV(impl), workspaceId, [loser], new Map());
    await persistDiscovery({ DB: env.DB }, workspaceId, first, [loser]);
    const excluded = await excludedDomains(JEV_ENV(impl), workspaceId);
    expect(excluded.has("noise.test")).toBe(true);
    const second = await judgeShortlist(JEV_ENV(impl), workspaceId, [loser], new Map());
    expect(second).toHaveLength(0);
    const rows = await env.DB.prepare(
      "SELECT status FROM suggestion WHERE candidate_domain = 'noise.test'",
    ).all();
    expect(rows.results).toEqual([{ status: "dismissed" }]);
  });

  it("reuses a cached verdict for an identical context pack instead of re-calling Jev", async () => {
    const { workspaceId } = await seedWorkspace();
    const { impl, calls } = jevStub(0.55);
    const row = scored({ name: "Maybe Brand", domain: "maybe.test" });
    const first = await judgeShortlist(JEV_ENV(impl), workspaceId, [row], new Map());
    const jevCalls = calls.filter((u) => u.includes("jev.test")).length;
    expect(jevCalls).toBe(1);
    await persistDiscovery({ DB: env.DB }, workspaceId, first, [row]);
    const second = await judgeShortlist(JEV_ENV(impl), workspaceId, [row], new Map());
    const jevCallsAfter = calls.filter((u) => u.includes("jev.test")).length;
    expect(second[0]!.p).toBe(0.55);
    expect(jevCallsAfter).toBe(jevCalls);
  });

  it("stores unjudged shortlist overflow as pending suggestions with no verdict", async () => {
    const { workspaceId } = await seedWorkspace();
    const { impl } = jevStub(0.5);
    const inShortlist = scored({ name: "Top", domain: "top.test", shortlisted: true });
    const overflow = scored({ name: "Overflow", domain: "overflow.test", shortlisted: false });
    const judged = await judgeShortlist(JEV_ENV(impl), workspaceId, [inShortlist, overflow], new Map());
    const result = await persistDiscovery({ DB: env.DB }, workspaceId, judged, [inShortlist, overflow]);
    expect(result.unjudged).toBe(1);
    const pending = await env.DB.prepare(
      "SELECT status, verdict_p FROM suggestion WHERE candidate_domain = 'overflow.test'",
    ).first();
    expect(pending).toMatchObject({ status: "pending", verdict_p: null });
  });

  it("treats an unreachable Jev as unjudged, never dropped", async () => {
    const { workspaceId } = await seedWorkspace();
    const impl = (async () => new Response("down", { status: 502 })) as typeof fetch;
    const row = scored({ name: "Uncalled", domain: "uncalled.test" });
    const judged = await judgeShortlist(JEV_ENV(impl), workspaceId, [row], new Map());
    expect(judged[0]!.judged).toBe(false);
    expect(judged[0]!.decision).toBe("maybe");
    await persistDiscovery({ DB: env.DB }, workspaceId, judged, [row]);
    const row2 = await env.DB.prepare(
      "SELECT status, verdict_p FROM suggestion WHERE candidate_domain = 'uncalled.test'",
    ).first();
    expect(row2).toMatchObject({ status: "pending", verdict_p: null });
  });
});

describe("migration 0004 discovery sources", () => {
  it("seeds one source row per generator with the reliability the pack reads", async () => {
    const rows = await env.DB.prepare(
      "SELECT plugin_key, reliability, is_enabled FROM source WHERE plugin_key LIKE '%roundup%' OR plugin_key LIKE '%comentions%' ORDER BY plugin_key",
    ).all<{ plugin_key: string; reliability: string; is_enabled: number }>();
    expect(rows.results).toEqual([
      { plugin_key: "google-news-roundup", reliability: "rss", is_enabled: 1 },
      { plugin_key: "hn-algolia-comentions", reliability: "best_effort", is_enabled: 1 },
    ]);
    const writable = await env.DB.prepare(
      "SELECT id FROM source WHERE is_enabled = 1 AND key NOT LIKE 'discovery.%'",
    ).all();
    expect(writable.results).toEqual([]);
  });
});

describe("judgeTracked + persistRefresh (D2)", () => {
  async function seedCompetitor(workspaceId: string, origin = "auto") {
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, created_at)
       VALUES (?1, ?2, 'competitor', 'rival.test', 'Rival', ?3, 'on', ?4)`,
    )
      .bind(`ent_rival_${workspaceId}`, workspaceId, origin, NOW)
      .run();
    return `ent_rival_${workspaceId}`;
  }

  it("auto-retires only on p <= 0.1 with reason acquired or shut down", async () => {
    const { workspaceId } = await seedWorkspace();
    const entityId = await seedCompetitor(workspaceId);
    const impl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("jev.test")) {
        return new Response(
          JSON.stringify({
            answers: {
              still_competitor: { type: "boolean", probability: 0.05 },
              reason: { type: "choice", choice: "acquired" },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const outcomes = await judgeTracked(JEV_ENV(impl), workspaceId);
    expect(outcomes[0]).toMatchObject({ action: "retire", reason: "acquired" });
    await persistRefresh({ DB: env.DB }, workspaceId, outcomes);
    const entity = await env.DB.prepare(
      "SELECT state, state_reason, state_changed_by FROM entity WHERE id = ?",
    )
      .bind(entityId)
      .first();
    expect(entity).toMatchObject({ state: "off", state_reason: "acquired", state_changed_by: "jev" });
  });

  it("never auto-retires a user-added brand — it asks instead", async () => {
    const { workspaceId } = await seedWorkspace();
    await seedCompetitor(workspaceId, "manual");
    const impl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("jev.test")) {
        return new Response(
          JSON.stringify({
            answers: {
              still_competitor: { type: "boolean", probability: 0.02 },
              reason: { type: "choice", choice: "shut down" },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const outcomes = await judgeTracked(JEV_ENV(impl), workspaceId);
    expect(outcomes[0]!.action).toBe("ask");
    await persistRefresh({ DB: env.DB }, workspaceId, outcomes);
    const entity = await env.DB.prepare(
      "SELECT state FROM entity WHERE domain = 'rival.test'",
    ).first();
    expect(entity).toMatchObject({ state: "on" });
    const ask = await env.DB.prepare(
      "SELECT kind, status FROM suggestion WHERE workspace_id = ? AND kind = 'retire'",
    )
      .bind(workspaceId)
      .first();
    expect(ask).toMatchObject({ kind: "retire", status: "pending" });
  });

  it("dormant always asks, even at p <= 0.1", async () => {
    const { workspaceId } = await seedWorkspace();
    await seedCompetitor(workspaceId);
    const impl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("jev.test")) {
        return new Response(
          JSON.stringify({
            answers: {
              still_competitor: { type: "boolean", probability: 0.03 },
              reason: { type: "choice", choice: "dormant" },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const outcomes = await judgeTracked(JEV_ENV(impl), workspaceId);
    expect(outcomes[0]!.action).toBe("ask");
  });
});

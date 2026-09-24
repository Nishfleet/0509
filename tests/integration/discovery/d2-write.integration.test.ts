import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { readRefreshTargets, type EntityOrigin, type RefreshTarget } from "../../../app/lib/data/entity.server";
import {
  stillCompetitorAction,
  writeStillCompetitorResults,
  type StillCompetitorResult,
} from "../../../app/lib/discovery/refresh.server";
import type { ChoiceVerdict, NoulVerdict } from "../../../app/lib/jev/client.server";

const NOW = "2026-09-24T06:00:00.000Z";
const LATER = "2026-10-01T06:00:00.000Z";

let runs = 0;

interface Brand {
  domain: string;
  name: string;
  origin: EntityOrigin;
}

const BRANDS: Brand[] = [
  { domain: "alpha.example", name: "Alpha", origin: "auto" },
  { domain: "beta.example", name: "Beta", origin: "manual" },
  { domain: "gamma.example", name: "Gamma", origin: "auto" },
  { domain: "delta.example", name: "Delta", origin: "auto" },
  { domain: "epsilon.example", name: "Epsilon", origin: "auto" },
  { domain: "zeta.example", name: "Zeta", origin: "auto" },
];

interface EntityStateRow {
  state: string;
  state_reason: string | null;
  state_changed_by: string | null;
  state_changed_at: string | null;
}

interface SuggestionRow {
  kind: string;
  status: string;
  entity_id: string | null;
  verdict_p: number | null;
  verdict_reason: string | null;
  decided_at: string | null;
}

interface AlertRow {
  kind: string;
  title: string;
  body: string | null;
}

async function seedWorkspace(): Promise<{ workspaceId: string; targets: Map<string, RefreshTarget> }> {
  runs += 1;
  const userId = `user-d2-${String(runs)}`;
  const workspaceId = `ws-d2-${String(runs)}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)',
    ).bind(userId, `Acme ${userId}`, `${userId}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Acme', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'self', 'acme.example', 'Acme', '{}', ?3)",
    ).bind(`${workspaceId}-self`, workspaceId, NOW),
    ...BRANDS.map((brand) =>
      env.DB.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, ?5, 'on', ?6)",
      ).bind(`${workspaceId}-${brand.domain}`, workspaceId, brand.domain, brand.name, brand.origin, NOW),
    ),
  ]);
  const targets = new Map((await readRefreshTargets(workspaceId)).map((t) => [t.domain, t]));
  return { workspaceId, targets };
}

function targetOf(targets: Map<string, RefreshTarget>, domain: string): RefreshTarget {
  const target = targets.get(domain);
  if (target === undefined) throw new Error(`no target for ${domain}`);
  return target;
}

function noul(domain: string, p: number): NoulVerdict {
  return { questionId: "still_competitor", inputHash: `hash-${String(runs)}-${domain}-noul`, p, cached: false };
}

function choice(domain: string, picked: string): ChoiceVerdict {
  return {
    questionId: "still_competitor_reason",
    inputHash: `hash-${String(runs)}-${domain}-choice`,
    choice: picked,
    cached: false,
  };
}

function buildResults(targets: Map<string, RefreshTarget>): StillCompetitorResult[] {
  return [
    { target: targetOf(targets, "alpha.example"), verdict: noul("alpha.example", 0.05), reason: choice("alpha.example", "shut_down") },
    { target: targetOf(targets, "beta.example"), verdict: noul("beta.example", 0.05), reason: choice("beta.example", "acquired") },
    { target: targetOf(targets, "gamma.example"), verdict: noul("gamma.example", 0.95), reason: choice("gamma.example", "dormant") },
    { target: targetOf(targets, "delta.example"), verdict: noul("delta.example", 0.95), reason: choice("delta.example", "active") },
    { target: targetOf(targets, "epsilon.example"), verdict: noul("epsilon.example", 0.5), reason: choice("epsilon.example", "active") },
    { target: targetOf(targets, "zeta.example"), verdict: null, reason: null },
  ];
}

async function entityState(workspaceId: string, domain: string): Promise<EntityStateRow | null> {
  return env.DB.prepare(
    "SELECT state, state_reason, state_changed_by, state_changed_at FROM entity WHERE workspace_id = ? AND domain = ?",
  )
    .bind(workspaceId, domain)
    .first<EntityStateRow>();
}

async function suggestionFor(workspaceId: string, domain: string): Promise<SuggestionRow | null> {
  return env.DB.prepare(
    "SELECT kind, status, entity_id, verdict_p, verdict_reason, decided_at FROM suggestion WHERE workspace_id = ? AND candidate_domain = ?",
  )
    .bind(workspaceId, domain)
    .first<SuggestionRow>();
}

async function alertsFor(workspaceId: string, domain: string): Promise<AlertRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT a.kind, a.title, a.body FROM alert a JOIN entity e ON e.id = a.entity_id WHERE a.workspace_id = ? AND e.domain = ? AND a.kind = 'competitor_retired'",
  )
    .bind(workspaceId, domain)
    .all<AlertRow>();
  return results;
}

async function verdictCount(workspaceId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM jev_verdict WHERE workspace_id = ?")
    .bind(workspaceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("stillCompetitorAction", () => {
  it("retires only a sure-dead auto brand, keeps the sure-active one, and asks about the rest", async () => {
    const { targets } = await seedWorkspace();
    expect(buildResults(targets).map(stillCompetitorAction)).toEqual([
      "retire",
      "ask",
      "ask",
      "keep",
      "ask",
      "none",
    ]);
  });
});

describe("writeStillCompetitorResults", () => {
  it("retires a shut-down auto brand with one owner alert, asks about a user-added, a quiet and an unsure brand, keeps the active one, and stores two verdicts per judged brand", async () => {
    const { workspaceId, targets } = await seedWorkspace();

    await writeStillCompetitorResults(workspaceId, buildResults(targets), NOW);

    expect(await entityState(workspaceId, "alpha.example")).toEqual({
      state: "off",
      state_reason: "shut_down",
      state_changed_by: "jev",
      state_changed_at: NOW,
    });

    const retiredAlerts = await alertsFor(workspaceId, "alpha.example");
    expect(retiredAlerts).toHaveLength(1);
    expect(retiredAlerts[0]?.kind).toBe("competitor_retired");
    expect(retiredAlerts[0]?.body).toContain("Looks like it shut down");
    expect(retiredAlerts[0]?.body).not.toMatch(/[0-9]/);
    expect(retiredAlerts[0]?.body).not.toContain("shut_down");

    expect(await suggestionFor(workspaceId, "beta.example")).toMatchObject({
      kind: "retire",
      status: "pending",
      entity_id: targetOf(targets, "beta.example").entityId,
      verdict_p: 0.05,
      verdict_reason: "Looks like it was acquired",
    });
    expect(await suggestionFor(workspaceId, "gamma.example")).toMatchObject({
      kind: "retire",
      status: "pending",
      entity_id: targetOf(targets, "gamma.example").entityId,
      verdict_reason: "Quiet for the last 30 days",
    });
    expect(await suggestionFor(workspaceId, "epsilon.example")).toMatchObject({
      kind: "retire",
      status: "pending",
      entity_id: targetOf(targets, "epsilon.example").entityId,
      verdict_reason: "We're not sure it still competes with you",
    });

    for (const domain of ["beta.example", "gamma.example", "epsilon.example"]) {
      expect((await entityState(workspaceId, domain))?.state).toBe("on");
    }
    expect(await suggestionFor(workspaceId, "delta.example")).toBeNull();
    expect(await suggestionFor(workspaceId, "zeta.example")).toBeNull();
    expect((await entityState(workspaceId, "delta.example"))?.state).toBe("on");
    expect((await entityState(workspaceId, "zeta.example"))?.state).toBe("on");

    expect(await verdictCount(workspaceId)).toBe(10);
  });

  it("stores no second verdict for the same judged brand and leaves a kept brand unasked for four weeks", async () => {
    const { workspaceId, targets } = await seedWorkspace();
    const results = buildResults(targets);

    await writeStillCompetitorResults(workspaceId, results, NOW);
    await env.DB.prepare(
      "UPDATE suggestion SET status = 'dismissed', decided_by = 'user', decided_at = ? WHERE workspace_id = ? AND candidate_domain = ?",
    )
      .bind(NOW, workspaceId, "beta.example")
      .run();

    await writeStillCompetitorResults(workspaceId, buildResults(targets), LATER);

    expect(await verdictCount(workspaceId)).toBe(10);
    expect(await suggestionFor(workspaceId, "beta.example")).toMatchObject({
      kind: "retire",
      status: "dismissed",
      decided_at: NOW,
    });
    expect((await entityState(workspaceId, "beta.example"))?.state).toBe("on");
    expect((await entityState(workspaceId, "alpha.example"))?.state).toBe("off");
  });

  it("does nothing at all when no brand was judged", async () => {
    const { workspaceId, targets } = await seedWorkspace();
    const batch = vi.spyOn(env.DB, "batch");

    await writeStillCompetitorResults(
      workspaceId,
      [{ target: targetOf(targets, "zeta.example"), verdict: null, reason: null }],
      NOW,
    );

    expect(batch).not.toHaveBeenCalled();
    batch.mockRestore();
    expect(await verdictCount(workspaceId)).toBe(0);
    expect((await entityState(workspaceId, "zeta.example"))?.state).toBe("on");
  });
});

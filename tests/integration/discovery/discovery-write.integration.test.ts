import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readCompetitors, readDiscoveryContext, readOnboardingCompetitors } from "../../../app/lib/data/entity.server";
import { writeDiscoveryResults } from "../../../app/lib/data/suggestion.server";
import { judgeCandidates } from "../../../app/lib/discovery/run.server";
import type { ResolvedCandidate } from "../../../app/lib/discovery/run.server";

const NOW = "2026-09-24T06:00:00.000Z";

let runs = 0;

async function seedWorkspace(): Promise<string> {
  runs += 1;
  const userId = `user-discovery-${String(runs)}`;
  const workspaceId = `ws-discovery-${String(runs)}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, `${userId}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'self', 'gymshark.com', 'Gymshark', '{\"description\":\"Gym clothing\"}', ?3)",
    ).bind(`${workspaceId}-self`, workspaceId, NOW),
  ]);
  return workspaceId;
}

function candidate(name: string, domain: string): ResolvedCandidate {
  return {
    name,
    domain,
    evidence: [{ sourceUrl: "https://www.glamour.co.uk", excerpt: `Gymshark, ${name} and more`, generator: "news" }],
    line: "Named alongside you by 1 publisher",
  };
}

function verdict(p: number) {
  return { questionId: "is_competitor", inputHash: `hash-${String(p)}-${String(runs)}`, p, cached: false };
}

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

describe("writeDiscoveryResults", () => {
  it("adds a p >= 0.9 brand ON, keeps the uncertain and unjudged as maybes, and drops p <= 0.1", async () => {
    const workspaceId = await seedWorkspace();
    await writeDiscoveryResults(
      workspaceId,
      [
        { ...candidate("Alphalete", "alphaleteathletics.com"), verdict: verdict(0.9) },
        { ...candidate("Lululemon", "lululemon.com"), verdict: verdict(0.5) },
        { ...candidate("Nike", "nike.com"), verdict: null },
        { ...candidate("Glamour", "glamour.co.uk"), verdict: verdict(0.05) },
      ],
      NOW,
    );

    const { on, maybes } = await readOnboardingCompetitors(workspaceId);
    expect(on.map((row) => [row.domain, row.reason])).toEqual([
      ["alphaleteathletics.com", "Named alongside you by 1 publisher"],
    ]);
    expect(maybes.map((row) => row.domain)).toEqual(["lululemon.com", "nike.com"]);

    const verdicts = await env.DB.prepare("SELECT COUNT(*) AS n FROM jev_verdict WHERE workspace_id = ?")
      .bind(workspaceId)
      .first<{ n: number }>();
    expect(verdicts?.n).toBe(3);
  });

  it("never brings back a brand the owner dismissed, even when a later run is sure", async () => {
    const workspaceId = await seedWorkspace();
    await writeDiscoveryResults(workspaceId, [{ ...candidate("Nike", "nike.com"), verdict: verdict(0.5) }], NOW);
    const [maybe] = (await readOnboardingCompetitors(workspaceId)).maybes;
    await env.DB.prepare("UPDATE suggestion SET status = 'dismissed' WHERE id = ?").bind(maybe?.suggestionId).run();

    await writeDiscoveryResults(workspaceId, [{ ...candidate("Nike", "nike.com"), verdict: verdict(0.97) }], NOW);

    const { competitors, maybes } = await readCompetitors(workspaceId);
    expect(competitors).toEqual([]);
    expect(maybes).toEqual([]);
    const context = await readDiscoveryContext(workspaceId);
    expect(context?.dismissedDomains).toEqual(["nike.com"]);
  });

  it("promotes an unjudged maybe once a later run judges it", async () => {
    const workspaceId = await seedWorkspace();
    await writeDiscoveryResults(workspaceId, [{ ...candidate("Nike", "nike.com"), verdict: null }], NOW);
    await writeDiscoveryResults(workspaceId, [{ ...candidate("Nike", "nike.com"), verdict: verdict(0.93) }], NOW);

    const { on, maybes } = await readOnboardingCompetitors(workspaceId);
    expect(on.map((row) => row.domain)).toEqual(["nike.com"]);
    expect(maybes).toEqual([]);
  });
});

describe("judgeCandidates", () => {
  it("asks Jev once per candidate and reuses a stored verdict for the same input", async () => {
    const workspaceId = await seedWorkspace();
    const context = await readDiscoveryContext(workspaceId);
    if (context === null) throw new Error("seed failed");
    const run = vi.fn(() => Promise.resolve({ answers: { is_competitor: { type: "noul", noul: 0.92 } } }));
    Reflect.set(env, "AI", { run });

    const first = await judgeCandidates(context, [candidate("Alphalete", "alphaleteathletics.com")]);
    await writeDiscoveryResults(workspaceId, first, NOW);
    const second = await judgeCandidates(context, [candidate("Alphalete", "alphaleteathletics.com")]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe("typesafe/jev");
    expect(first[0]?.verdict).toMatchObject({ p: 0.92, cached: false });
    expect(second[0]?.verdict).toMatchObject({ p: 0.92, cached: true });
  });

  it("stores every candidate unjudged when Jev refuses, and stops asking after the first refusal", async () => {
    const workspaceId = await seedWorkspace();
    const context = await readDiscoveryContext(workspaceId);
    if (context === null) throw new Error("seed failed");
    const run = vi.fn(() => Promise.reject(new Error("Insufficient balance; add money to your gateway")));
    Reflect.set(env, "AI", { run });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const results = await judgeCandidates(context, [
      candidate("Alphalete", "alphaleteathletics.com"),
      candidate("Nike", "nike.com"),
    ]);

    errors.mockRestore();
    expect(run).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.verdict)).toEqual([null, null]);
  });
});

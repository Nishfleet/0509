import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readDiscoveryContext } from "../../../app/lib/data/entity.server";
import { judgeCandidates } from "../../../app/lib/discovery/run.server";
import type { ResolvedCandidate } from "../../../app/lib/discovery/run.server";

const NOW = "2026-09-24T06:00:00.000Z";

let runs = 0;

async function seedWorkspace(identityJson: string): Promise<string> {
  runs += 1;
  const userId = `user-creator-${String(runs)}`;
  const workspaceId = `ws-creator-${String(runs)}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, `${userId}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Training with Mia', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'self', 'mia.example', 'Training with Mia', ?3, ?4)",
    ).bind(`${workspaceId}-self`, workspaceId, identityJson, NOW),
  ]);
  return workspaceId;
}

function candidate(name: string, domain: string): ResolvedCandidate {
  return {
    name,
    domain,
    evidence: [
      { sourceUrl: "https://www.example.com", excerpt: `Training with Mia, ${name} and more`, generator: "news" },
    ],
    line: "Named alongside you by 1 publisher",
  };
}

function jevStub(questionId: string) {
  return vi.fn(async (_model: string, request: { questions: Record<string, { type: string }> }) => {
    const answer = { type: "noul", noul: 0.9 };
    return { answers: questionId in request.questions ? { [questionId]: answer } : {} };
  });
}

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

describe("judgeCandidates question choice", () => {
  it("asks the creator-rival question and never the company-competitor one when the self is a creator", async () => {
    const workspaceId = await seedWorkspace(
      '{"kind":"channel","platform":"youtube","description":"Fitness classes"}',
    );
    const context = await readDiscoveryContext(workspaceId);
    if (context === null) throw new Error("seed failed");
    expect(context.self.kind).toBe("creator");
    const run = jevStub("is_creator_rival");
    Reflect.set(env, "AI", { run });

    const results = await judgeCandidates(context, [candidate("With Riley", "withriley.example")]);

    expect(run).toHaveBeenCalledTimes(1);
    const questions = run.mock.calls[0]?.[1].questions;
    expect(questions?.["is_creator_rival"]).toBeDefined();
    expect(questions?.["is_competitor"]).toBeUndefined();
    expect(results[0]?.verdict).toMatchObject({ questionId: "is_creator_rival", p: 0.9, cached: false });
  });

  it("asks the company-competitor question and never the creator-rival one when the self is a domain", async () => {
    const workspaceId = await seedWorkspace('{"kind":"domain","description":"Gym clothing"}');
    const context = await readDiscoveryContext(workspaceId);
    if (context === null) throw new Error("seed failed");
    expect(context.self.kind).toBe("domain");
    const run = jevStub("is_competitor");
    Reflect.set(env, "AI", { run });

    const results = await judgeCandidates(context, [candidate("Alphalete", "alphaleteathletics.com")]);

    expect(run).toHaveBeenCalledTimes(1);
    const questions = run.mock.calls[0]?.[1].questions;
    expect(questions?.["is_competitor"]).toBeDefined();
    expect(questions?.["is_creator_rival"]).toBeUndefined();
    expect(results[0]?.verdict).toMatchObject({ questionId: "is_competitor", p: 0.9, cached: false });
  });
});

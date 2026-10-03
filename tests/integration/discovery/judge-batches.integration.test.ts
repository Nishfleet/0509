import { env, introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { judgeBatches, JUDGE_BATCH_SIZE } from "../../../app/lib/discovery/run.server";
import type { ResolvedCandidate } from "../../../app/lib/discovery/run.server";

const NOW = "2026-09-24T06:00:00.000Z";
const WORKSPACE_ID = "ws-judge-batches";
const CANDIDATES = 6;

function generated() {
  return {
    shortlisted: Array.from({ length: CANDIDATES }, (_, index) => ({
      name: `Rival ${String(index)}`,
      domain: `rival${String(index)}.example`,
      evidence: [
        { sourceUrl: "https://www.example.com", excerpt: `Gymshark and Rival ${String(index)}`, generator: "news" },
      ],
      line: "Named alongside you by 1 publisher",
    })),
    rest: [],
    promoted: [],
  };
}

async function seedWorkspace(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?1, ?2, 1, ?3, ?3)',
    ).bind("user-judge-batches", "judge-batches@example.com", NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', 'user-judge-batches', 'UTC', 1, 8, ?2)",
    ).bind(WORKSPACE_ID, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES ('ent-judge-batches', ?1, 'self', 'gymshark.com', 'Gymshark', '{\"description\":\"Gym clothing\"}', ?2)",
    ).bind(WORKSPACE_ID, NOW),
  ]);
}

async function suggestionRows(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM suggestion WHERE workspace_id = ?1")
    .bind(WORKSPACE_ID)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
  vi.restoreAllMocks();
});

describe("judgeBatches", () => {
  it("splits candidates into batches of at most the batch size, in order", () => {
    const candidates = Array.from({ length: JUDGE_BATCH_SIZE * 2 + 1 }, (_, index) => ({
      name: `Rival ${String(index)}`,
      domain: `rival${String(index)}.example`,
      evidence: [],
      line: "",
    })) satisfies ResolvedCandidate[];
    const batches = judgeBatches(candidates);
    expect(batches.map((batch) => batch.length)).toEqual([JUDGE_BATCH_SIZE, JUDGE_BATCH_SIZE, 1]);
    expect(batches.flat()).toEqual(candidates);
  });
});

describe("Discovery workflow judging", () => {
  it("judges every batch at once so the first rivals show within one Jev round trip", async () => {
    await seedWorkspace();
    let inFlight = 0;
    let peak = 0;
    const run = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 25));
      inFlight -= 1;
      return {
        answers: { is_competitor: { type: "noul", noul: 0.5 }, same_product_category: { type: "noul", noul: 0.5 } },
      };
    });
    Reflect.set(env, "AI", { run });

    await using instance = await introspectWorkflowInstance(env.DISCOVERY, "judge-batches");
    await instance.modify(async (modifier) => {
      await modifier.mockStepResult({ name: "jev-ready" }, true);
      await modifier.mockStepResult({ name: "generate" }, generated());
    });
    await env.DISCOVERY.create({ id: "judge-batches", params: { workspaceId: WORKSPACE_ID, mode: "create" } });
    await instance.waitForStatus("complete");

    expect(run).toHaveBeenCalledTimes(CANDIDATES);
    expect(peak).toBe(CANDIDATES / JUDGE_BATCH_SIZE);
    expect(await suggestionRows()).toBe(CANDIDATES);
  });
});

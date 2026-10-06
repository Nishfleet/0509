import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readSignalAlerts } from "../../../app/lib/data/alert.server";
import { planTargets, sweepTarget } from "../../../workers/mentions/sweep";

const NIGHT_ONE = "2026-09-24T03:00:00.000Z";
const NIGHT_TWO = "2026-09-25T03:00:00.000Z";
const TITLE = "Quillon opens a London flagship";

const PAIR = [
  { url: "https://news.example.com/a", title: TITLE, seendate: "20260923T101500Z", domain: "news.example.com" },
  {
    url: "https://www.syndicator.example.org/copy-of-a?utm_source=feed",
    title: TITLE,
    seendate: "20260923T101600Z",
    domain: "syndicator.example.org",
  },
];

let runs = 0;

async function seedWorkspace(): Promise<{ workspaceId: string; competitorId: string; brand: string }> {
  runs += 1;
  const workspaceId = `ws-rejudge-dedup-${String(runs)}`;
  const userId = `user-rejudge-dedup-${String(runs)}`;
  const brand = `Quillon Rejudge ${String(runs)}`;
  const competitorId = `${workspaceId}-competitor`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, `${userId}@example.com`, NIGHT_ONE),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NIGHT_ONE),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'self', ?3, 'Gymshark', '{\"description\":\"Gym clothing\"}', ?4)",
    ).bind(`${workspaceId}-self`, workspaceId, `gymshark-rejudge-dedup-${String(runs)}.com`, NIGHT_ONE),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, ?5)",
    ).bind(competitorId, workspaceId, `quillon-rejudge-dedup-${String(runs)}.com`, brand, NIGHT_ONE),
  ]);
  return { workspaceId, competitorId, brand };
}

function jev(duplicateAnswer: number | "down") {
  return vi.fn((_model: string, input: { questions: Record<string, unknown> }) => {
    const [questionId] = Object.keys(input.questions);
    if (questionId === "duplicate_signal") {
      if (duplicateAnswer === "down") return Promise.reject(new Error("gateway timed out"));
      return Promise.resolve({ answers: { duplicate_signal: { type: "noul", noul: duplicateAnswer } } });
    }
    return Promise.resolve({ answers: { [questionId ?? ""]: { type: "noul", noul: 0.96 } } });
  });
}

async function sweep(brand: string, now: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ articles: PAIR }))),
  );
  const target = (await planTargets()).find((entry) => entry.pluginKey === "gdelt.doc" && entry.query === brand);
  if (target === undefined) throw new Error(`no gdelt target for ${brand}`);
  return sweepTarget(target, now, null);
}

async function rows(competitorId: string) {
  const result = await env.DB.prepare(
    "SELECT id, canonical_url, duplicate_of, state FROM signal WHERE entity_id = ? ORDER BY canonical_url",
  )
    .bind(competitorId)
    .all<{ id: string; canonical_url: string; duplicate_of: string | null; state: string | null }>();
  return result.results;
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(env, "AI");
});

describe("re-judging two copies of one story (0509#7084)", () => {
  it("alerts once when both copies were stored unjudged and Jev collapses them", async () => {
    const { workspaceId, competitorId, brand } = await seedWorkspace();
    Reflect.set(env, "AI", { run: vi.fn(() => Promise.reject(new Error("gateway timed out"))) });
    await sweep(brand, NIGHT_ONE);
    expect((await rows(competitorId)).map((row) => row.state)).toEqual(["unjudged", "unjudged"]);

    Reflect.set(env, "AI", { run: jev(0.96) });
    await sweep(brand, NIGHT_TWO);

    const all = await rows(competitorId);
    expect(all.filter((row) => row.duplicate_of !== null)).toHaveLength(1);
    expect(all.map((row) => row.state)).toEqual(["judged", "judged"]);
    expect(await readSignalAlerts(env.DB, workspaceId)).toHaveLength(1);
  });

  it("keeps the second copy unjudged and unalerted while the duplicate check cannot run", async () => {
    const { workspaceId, competitorId, brand } = await seedWorkspace();
    Reflect.set(env, "AI", { run: vi.fn(() => Promise.reject(new Error("gateway timed out"))) });
    await sweep(brand, NIGHT_ONE);

    Reflect.set(env, "AI", { run: jev("down") });
    await sweep(brand, NIGHT_TWO);

    const all = await rows(competitorId);
    expect(all.map((row) => row.state)).toEqual(["judged", "unjudged"]);
    expect(await readSignalAlerts(env.DB, workspaceId)).toHaveLength(1);

    Reflect.set(env, "AI", { run: jev(0.96) });
    await sweep(brand, "2026-09-26T03:00:00.000Z");
    expect((await rows(competitorId)).filter((row) => row.duplicate_of !== null)).toHaveLength(1);
    expect(await readSignalAlerts(env.DB, workspaceId)).toHaveLength(1);
  });

  it("stores a fresh copy unjudged and unalerted when its duplicate check cannot run", async () => {
    const { workspaceId, competitorId, brand } = await seedWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ articles: PAIR.slice(0, 1) }))),
    );
    Reflect.set(env, "AI", { run: jev(0.96) });
    const target = (await planTargets()).find((entry) => entry.pluginKey === "gdelt.doc" && entry.query === brand);
    if (target === undefined) throw new Error("no gdelt target");
    await sweepTarget(target, NIGHT_ONE, null);

    Reflect.set(env, "AI", { run: jev("down") });
    await sweep(brand, NIGHT_TWO);

    expect((await rows(competitorId)).map((row) => row.state)).toEqual(["judged", "unjudged"]);
    expect(await readSignalAlerts(env.DB, workspaceId)).toHaveLength(1);
  });
});

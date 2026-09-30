import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readSignalAlerts } from "../../../app/lib/data/alert.server";
import { planTargets, sweepTarget } from "../../../workers/mentions/sweep";

const NIGHT_ONE = "2026-09-24T03:00:00.000Z";
const NIGHT_TWO = "2026-09-25T03:00:00.000Z";
const NIGHT_THREE = "2026-09-26T03:00:00.000Z";

const ARTICLES = [
  {
    url: "https://news.example.com/quillon-opens-london-flagship",
    title: "Quillon opens a London flagship",
    seendate: "20260923T101500Z",
    domain: "news.example.com",
  },
  {
    url: "https://weather.example.com/quill-winds",
    title: "Quill winds expected this weekend",
    seendate: "20260923T081500Z",
    domain: "weather.example.com",
  },
];

let runs = 0;

async function seedWorkspace(): Promise<{ workspaceId: string; competitorId: string; brand: string }> {
  runs += 1;
  const workspaceId = `ws-rejudge-${String(runs)}`;
  const userId = `user-rejudge-${String(runs)}`;
  const brand = `Quillon ${String(runs)}`;
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
    ).bind(`${workspaceId}-self`, workspaceId, `gymshark-rejudge-${String(runs)}.com`, NIGHT_ONE),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, ?5)",
    ).bind(competitorId, workspaceId, `quillon-${String(runs)}.com`, brand, NIGHT_ONE),
  ]);
  return { workspaceId, competitorId, brand };
}

function stubGdelt() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ articles: ARTICLES }))),
  );
}

function jevAnswering() {
  return vi.fn((_model: string, input: { state: { item: { title: string } }; questions: Record<string, unknown> }) => {
    const [questionId] = Object.keys(input.questions);
    const title = input.state.item.title;
    const p = questionId === "mention_is_about_brand" ? (title.includes("winds") ? 0.03 : 0.96) : 0.94;
    return Promise.resolve({ answers: { [questionId ?? ""]: { type: "noul", noul: p } } });
  });
}

function jevDown() {
  return vi.fn(() => Promise.reject(new Error("Insufficient balance")));
}

async function gdeltTargetFor(brand: string) {
  const target = (await planTargets()).find((entry) => entry.pluginKey === "gdelt.doc" && entry.query === brand);
  if (target === undefined) throw new Error(`no gdelt target for ${brand}`);
  return target;
}

async function signalRows(competitorId: string) {
  const rows = await env.DB.prepare(
    "SELECT id, title, state, is_tombstoned FROM signal WHERE entity_id = ? ORDER BY title",
  )
    .bind(competitorId)
    .all<{ id: string; title: string; state: string | null; is_tombstoned: number }>();
  return rows.results;
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(env, "AI");
});

describe("re-judging unjudged mentions", () => {
  it("turns unjudged mentions into judged rows once Jev answers, tombstoning the D5 reject", async () => {
    const { workspaceId, competitorId, brand } = await seedWorkspace();
    stubGdelt();

    Reflect.set(env, "AI", { run: jevDown() });
    const first = await sweepTarget(await gdeltTargetFor(brand), NIGHT_ONE, null);
    expect(first).toEqual({ items: 2, stored: 0, unjudged: 2, skipped: 0 });
    expect((await signalRows(competitorId)).map((row) => [row.title, row.state, row.is_tombstoned])).toEqual([
      ["Quill winds expected this weekend", "unjudged", 0],
      ["Quillon opens a London flagship", "unjudged", 0],
    ]);

    const run = jevAnswering();
    Reflect.set(env, "AI", { run });
    const second = await sweepTarget(await gdeltTargetFor(brand), NIGHT_TWO, null);
    expect(second).toEqual({ items: 2, stored: 1, unjudged: 0, skipped: 0 });

    const rows = await signalRows(competitorId);
    expect(rows.map((row) => [row.title, row.state, row.is_tombstoned])).toEqual([
      ["Quill winds expected this weekend", "judged", 1],
      ["Quillon opens a London flagship", "judged", 0],
    ]);

    const reject = rows.find((row) => row.title.includes("winds"));
    const rejectVerdict = await env.DB.prepare("SELECT question_id, p FROM jev_verdict WHERE signal_id = ?")
      .bind(reject?.id ?? "")
      .all<{ question_id: string; p: number }>();
    expect(rejectVerdict.results).toHaveLength(1);
    expect(rejectVerdict.results[0]?.question_id).toBe("mention_is_about_brand");
    expect(rejectVerdict.results[0]?.p).toBeLessThanOrEqual(0.1);

    const kept = rows.find((row) => row.title.includes("flagship"));
    const keptVerdicts = await env.DB.prepare(
      "SELECT question_id FROM jev_verdict WHERE signal_id = ? ORDER BY question_id",
    )
      .bind(kept?.id ?? "")
      .all<{ question_id: string }>();
    expect(keptVerdicts.results.map((row) => row.question_id)).toEqual(["mention_is_about_brand", "mention_matters"]);
    expect((await readSignalAlerts(env.DB, workspaceId)).map((alert) => alert.title)).toEqual([
      `${brand}: Quillon opens a London flagship`,
    ]);

    const callsAfterSecond = run.mock.calls.length;
    await sweepTarget(await gdeltTargetFor(brand), NIGHT_THREE, null);
    expect(run.mock.calls.length).toBe(callsAfterSecond);
  });

  it("leaves rows unjudged and drops nothing while Jev is still down", async () => {
    const { competitorId, brand } = await seedWorkspace();
    stubGdelt();

    Reflect.set(env, "AI", { run: jevDown() });
    await sweepTarget(await gdeltTargetFor(brand), NIGHT_ONE, null);

    const stillDown = jevDown();
    Reflect.set(env, "AI", { run: stillDown });
    const second = await sweepTarget(await gdeltTargetFor(brand), NIGHT_TWO, null);
    expect(second).toEqual({ items: 2, stored: 0, unjudged: 0, skipped: 0 });
    expect(stillDown).toHaveBeenCalledTimes(1);
    expect((await signalRows(competitorId)).map((row) => [row.state, row.is_tombstoned])).toEqual([
      ["unjudged", 0],
      ["unjudged", 0],
    ]);
  });
});

import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { planTargets, rejudgeWindowMentions, sweepTarget } from "../../../workers/mentions/sweep";

const NIGHT_ONE = "2026-09-24T03:00:00.000Z";
const NIGHT_TWO = "2026-09-25T03:00:00.000Z";

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
      "INSERT INTO plan (id, workspace_id, tier, status, updated_at) VALUES (?1, ?2, 'scout', 'trialing', ?3)",
    ).bind(`${workspaceId}-plan`, workspaceId, NIGHT_ONE),
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

describe("re-judging a closing week's mentions before the freeze", () => {
  it("judges the unjudged mentions of the window, and only the window", async () => {
    const { workspaceId, competitorId, brand } = await seedWorkspace();
    stubGdelt();
    Reflect.set(env, "AI", { run: jevDown() });
    await sweepTarget(await gdeltTargetFor(brand), NIGHT_ONE, null);

    expect((await signalRows(competitorId)).map((row) => row.state)).toEqual(["unjudged", "unjudged"]);

    Reflect.set(env, "AI", { run: jevAnswering() });
    const outside = await rejudgeWindowMentions({
      workspaceId,
      windowStartAt: "2026-09-10T00:00:00.000Z",
      windowEndAt: "2026-09-17T00:00:00.000Z",
      limit: 10,
    });
    expect(outside).toBe(0);

    const judged = await rejudgeWindowMentions({
      workspaceId,
      windowStartAt: "2026-09-17T00:00:00.000Z",
      windowEndAt: NIGHT_TWO,
      limit: 10,
    });
    expect(judged).toBeGreaterThan(0);
    expect((await signalRows(competitorId)).map((row) => [row.title, row.state, row.is_tombstoned])).toEqual([
      ["Quill winds expected this weekend", "judged", 1],
      ["Quillon opens a London flagship", "judged", 0],
    ]);
  });

  it("writes one verdict and one alert per mention when two re-judges overlap", async () => {
    const { workspaceId, competitorId, brand } = await seedWorkspace();
    stubGdelt();
    Reflect.set(env, "AI", { run: jevDown() });
    await sweepTarget(await gdeltTargetFor(brand), NIGHT_ONE, null);

    Reflect.set(env, "AI", { run: jevAnswering() });
    const window = { workspaceId, windowStartAt: "2026-09-17T00:00:00.000Z", windowEndAt: NIGHT_TWO, limit: 10 };
    await Promise.all([rejudgeWindowMentions(window), rejudgeWindowMentions(window)]);

    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM jev_verdict WHERE entity_id = ?1) AS verdicts, (SELECT COUNT(*) FROM alert WHERE entity_id = ?1 AND kind = 'mention') AS alerts",
    )
      .bind(competitorId)
      .first<{ verdicts: number; alerts: number }>();
    expect(counts?.verdicts).toBe(3);
    expect(counts?.alerts).toBe(1);
  });

  it("leaves them unjudged, without throwing, while Jev is down", async () => {
    const { workspaceId, competitorId, brand } = await seedWorkspace();
    stubGdelt();
    Reflect.set(env, "AI", { run: jevDown() });
    await sweepTarget(await gdeltTargetFor(brand), NIGHT_ONE, null);

    const judged = await rejudgeWindowMentions({
      workspaceId,
      windowStartAt: "2026-09-17T00:00:00.000Z",
      windowEndAt: NIGHT_TWO,
      limit: 10,
    });
    expect(judged).toBe(0);
    expect((await signalRows(competitorId)).every((row) => row.state === "unjudged")).toBe(true);
  });

  it("gives a mention judged from a cached verdict its own verdict row", async () => {
    const { workspaceId, competitorId, brand } = await seedWorkspace();
    stubGdelt();
    Reflect.set(env, "AI", { run: jevAnswering() });
    await sweepTarget(await gdeltTargetFor(brand), NIGHT_ONE, null);
    const kept = (await signalRows(competitorId)).find((row) => row.title.includes("flagship"));
    const copyKept = (id: string) =>
      env.DB.prepare(
        `INSERT INTO signal (id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, title, url, canonical_url, url_hash,
           author, engagement_json, payload_json, dedup_key, published_at, observed_at, last_seen_at, is_tombstoned, state, title_hash, norm_url_hash)
         SELECT ?1, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, title, url, canonical_url, url_hash,
           author, engagement_json, payload_json, ?1, published_at, observed_at, last_seen_at, 1, 'unjudged', title_hash, norm_url_hash
         FROM signal WHERE id = ?2`,
      )
        .bind(id, kept?.id ?? "")
        .run();
    const window = { workspaceId, windowStartAt: "2026-09-17T00:00:00.000Z", windowEndAt: NIGHT_TWO, limit: 10 };

    await copyKept("sig-twin-a");
    await rejudgeWindowMentions(window);
    await copyKept("sig-twin-b");
    const run = jevAnswering();
    Reflect.set(env, "AI", { run });
    await rejudgeWindowMentions(window);

    expect(run).not.toHaveBeenCalled();
    const questions = (signalId: string) =>
      env.DB.prepare("SELECT question_id FROM jev_verdict WHERE signal_id = ? ORDER BY question_id")
        .bind(signalId)
        .all<{ question_id: string }>();
    const expected = ["mention_is_about_brand", "mention_matters"];
    expect((await questions("sig-twin-a")).results.map((row) => row.question_id)).toEqual(expected);
    expect((await questions("sig-twin-b")).results.map((row) => row.question_id)).toEqual(expected);
  });

  it("never shows an unjudged mention whose watch is switched off", async () => {
    const { workspaceId, competitorId, brand } = await seedWorkspace();
    stubGdelt();
    Reflect.set(env, "AI", { run: jevDown() });
    await sweepTarget(await gdeltTargetFor(brand), NIGHT_ONE, null);
    await env.DB.prepare("UPDATE watch SET is_active = 0 WHERE entity_id = ?").bind(competitorId).run();

    Reflect.set(env, "AI", { run: jevAnswering() });
    const judged = await rejudgeWindowMentions({
      workspaceId,
      windowStartAt: "2026-09-17T00:00:00.000Z",
      windowEndAt: NIGHT_TWO,
      limit: 10,
    });
    expect(judged).toBe(0);
    expect((await signalRows(competitorId)).map((row) => [row.state, row.is_tombstoned])).toEqual([
      ["unjudged", 1],
      ["unjudged", 1],
    ]);
  });
});

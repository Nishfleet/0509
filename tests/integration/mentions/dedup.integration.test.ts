import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readMentionFeed } from "../../../app/lib/data/mention.server";
import { planTargets, sweepTarget } from "../../../workers/mentions/sweep";

const NIGHT_ONE = "2026-09-24T03:00:00.000Z";
const NIGHT_TWO = "2026-09-25T03:00:00.000Z";
const MUCH_LATER = "2026-10-03T03:00:00.000Z";
const TITLE = "Quillon opens a London flagship";

interface Article {
  url: string;
  title: string;
  seendate: string;
  domain: string;
}

function article(url: string, title = TITLE, domain = "news.example.com"): Article {
  return { url, title, seendate: "20260923T101500Z", domain };
}

function sameSweepPair(): Article[] {
  return [
    article("https://news.example.com/a"),
    article("https://www.syndicator.example.org/copy-of-a?utm_source=feed", TITLE, "syndicator.example.org"),
  ];
}

let runs = 0;

async function seedWorkspace(brand: string): Promise<{ workspaceId: string; competitorId: string }> {
  runs += 1;
  const workspaceId = `ws-dedup-${String(runs)}`;
  const userId = `user-dedup-${String(runs)}`;
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
    ).bind(`${workspaceId}-self`, workspaceId, `gymshark-dedup-${String(runs)}.com`, NIGHT_ONE),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, ?5)",
    ).bind(competitorId, workspaceId, `quillon-dedup-${String(runs)}.com`, brand, NIGHT_ONE),
  ]);
  return { workspaceId, competitorId };
}

function freshBrand(): string {
  return `Quillon Dedup ${String(runs + 1)}`;
}

function jev(duplicateAnswer: number | "down") {
  return vi.fn((_model: string, input: { questions: Record<string, unknown> }) => {
    const [questionId] = Object.keys(input.questions);
    if (questionId === "duplicate_signal") {
      if (duplicateAnswer === "down") return Promise.reject(new Error("Insufficient balance"));
      return Promise.resolve({ answers: { duplicate_signal: { type: "noul", noul: duplicateAnswer } } });
    }
    return Promise.resolve({ answers: { [questionId ?? ""]: { type: "noul", noul: 0.96 } } });
  });
}

function duplicateAsks(run: ReturnType<typeof jev>): number {
  return run.mock.calls.filter(([, input]) => "duplicate_signal" in input.questions).length;
}

async function sweep(brand: string, articles: Article[], now: string, workspaceId?: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ articles }))),
  );
  const target = (await planTargets()).find((entry) => entry.pluginKey === "gdelt.doc" && entry.query === brand);
  if (target === undefined) throw new Error(`no gdelt target for ${brand}`);
  return sweepTarget(
    {
      ...target,
      watches: target.watches.filter((watch) => workspaceId === undefined || watch.workspace_id === workspaceId),
    },
    now,
    null,
  );
}

async function rows(competitorId: string) {
  const result = await env.DB.prepare(
    "SELECT id, canonical_url, duplicate_of, state, is_tombstoned FROM signal WHERE entity_id = ? ORDER BY canonical_url",
  )
    .bind(competitorId)
    .all<{
      id: string;
      canonical_url: string;
      duplicate_of: string | null;
      state: string | null;
      is_tombstoned: number;
    }>();
  return result.results;
}

async function firstThenSecond(answer: number) {
  const brand = freshBrand();
  const { workspaceId, competitorId } = await seedWorkspace(brand);
  const run = jev(answer);
  Reflect.set(env, "AI", { run });
  await sweep(brand, [article("https://news.example.com/a")], NIGHT_ONE);
  expect(duplicateAsks(run)).toBe(0);
  await sweep(
    brand,
    [article("https://www.syndicator.example.org/copy-of-a?utm_source=feed", TITLE, "syndicator.example.org")],
    NIGHT_TWO,
  );
  return { brand, workspaceId, competitorId, run, all: await rows(competitorId) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(env, "AI");
});

const hostOf = (url: string): string => new URL(url).host.replace(/^www\./, "");

describe("D8 duplicate_signal", () => {
  it("collapses at p >= 0.9, keeps both rows, stores the verdict on the newer row", async () => {
    const { workspaceId, run, all } = await firstThenSecond(0.96);
    const older = all.find((row) => hostOf(row.canonical_url) === "news.example.com");
    const newer = all.find((row) => hostOf(row.canonical_url) === "syndicator.example.org");
    expect(all).toHaveLength(2);
    expect(older?.duplicate_of).toBeNull();
    expect(newer?.duplicate_of).toBe(older?.id);
    expect(duplicateAsks(run)).toBe(1);
    const verdict = await env.DB.prepare(
      "SELECT signal_id, p FROM jev_verdict WHERE question_id = 'duplicate_signal'",
    ).all<{ signal_id: string; p: number }>();
    expect(verdict.results.filter((row) => row.signal_id === newer?.id)).toHaveLength(1);
    const feed = await readMentionFeed(workspaceId, new Date(NIGHT_TWO));
    expect(feed).toHaveLength(1);
    expect(feed[0]?.id).toBe(older?.id);
    expect(feed[0]?.alsoCount).toBe(1);
  });

  it.each([0.5, 0.05])("keeps the two separate and shown at p = %s", async (answer) => {
    const { workspaceId, run, all } = await firstThenSecond(answer);
    expect(duplicateAsks(run)).toBe(1);
    expect(all.map((row) => row.duplicate_of)).toEqual([null, null]);
    const feed = await readMentionFeed(workspaceId, new Date(NIGHT_TWO));
    expect(feed.map((row) => row.alsoCount)).toEqual([0, 0]);
  });

  it("asks nothing when no title or url matches", async () => {
    const brand = freshBrand();
    const { competitorId } = await seedWorkspace(brand);
    const run = jev(0.96);
    Reflect.set(env, "AI", { run });
    await sweep(brand, [article("https://news.example.com/a")], NIGHT_ONE);
    await sweep(brand, [article("https://news.example.com/b", "Quillon hires a new chief executive")], NIGHT_TWO);
    expect(duplicateAsks(run)).toBe(0);
    expect((await rows(competitorId)).map((row) => row.duplicate_of)).toEqual([null, null]);
  });

  it("matches on the normalized url when the titles differ", async () => {
    const brand = freshBrand();
    const { competitorId } = await seedWorkspace(brand);
    const run = jev(0.96);
    Reflect.set(env, "AI", { run });
    await sweep(brand, [article("https://news.example.com/a")], NIGHT_ONE);
    await sweep(brand, [article("https://www.news.example.com/a/?utm_medium=x", "A different headline")], NIGHT_TWO);
    expect(duplicateAsks(run)).toBe(1);
    expect((await rows(competitorId)).filter((row) => row.duplicate_of !== null)).toHaveLength(1);
  });

  it("never treats an older-than-seven-days mention as a candidate", async () => {
    const brand = freshBrand();
    await seedWorkspace(brand);
    const run = jev(0.96);
    Reflect.set(env, "AI", { run });
    await sweep(brand, [article("https://news.example.com/a")], NIGHT_ONE);
    await sweep(brand, [article("https://news.example.com/b")], MUCH_LATER);
    expect(duplicateAsks(run)).toBe(0);
  });

  it("does not ask twice for a pair it already has a verdict for", async () => {
    const { brand, competitorId, run, all } = await firstThenSecond(0.96);
    const newer = all.find((row) => row.duplicate_of !== null);
    await env.DB.batch([
      env.DB.prepare("UPDATE jev_verdict SET signal_id = NULL WHERE signal_id = ?").bind(newer?.id ?? ""),
      env.DB.prepare("DELETE FROM signal WHERE id = ?").bind(newer?.id ?? ""),
    ]);
    const asksBefore = duplicateAsks(run);
    await sweep(
      brand,
      [article("https://www.syndicator.example.org/copy-of-a?utm_source=feed", TITLE, "syndicator.example.org")],
      NIGHT_TWO,
    );
    expect(duplicateAsks(run)).toBe(asksBefore);
    expect((await rows(competitorId)).filter((row) => row.duplicate_of !== null)).toHaveLength(1);
  });

  it("stores both uncollapsed and stops asking once Jev is down", async () => {
    const brand = freshBrand();
    const { competitorId } = await seedWorkspace(brand);
    Reflect.set(env, "AI", { run: jev(0.96) });
    await sweep(brand, [article("https://news.example.com/a")], NIGHT_ONE);

    const down = jev("down");
    Reflect.set(env, "AI", { run: down });
    const outcome = await sweep(
      brand,
      [
        article("https://other.example.org/copy"),
        article("https://news.example.com/c", "Quillon raises a funding round"),
      ],
      NIGHT_TWO,
    );
    expect(duplicateAsks(down)).toBe(1);
    expect(down).toHaveBeenCalledTimes(3);
    expect(outcome.unjudged).toBe(1);
    const all = await rows(competitorId);
    expect(all).toHaveLength(3);
    expect(all.map((row) => row.duplicate_of)).toEqual([null, null, null]);
  });

  it("counts each pair against the per-watch judging budget", async () => {
    const brand = freshBrand();
    const { competitorId } = await seedWorkspace(brand);
    const run = jev(0.96);
    Reflect.set(env, "AI", { run });
    const titles = Array.from({ length: 12 }, (_, index) => `Quillon launches product ${String(index)}`);
    await sweep(
      brand,
      titles.map((title, index) => article(`https://news.example.com/o${String(index)}`, title)),
      NIGHT_ONE,
    );
    expect((await rows(competitorId)).length).toBe(12);

    await sweep(
      brand,
      titles.map((title, index) => article(`https://copy.example.org/c${String(index)}`, title)),
      NIGHT_TWO,
    );
    const all = await rows(competitorId);
    expect(all).toHaveLength(18);
    expect(duplicateAsks(run)).toBe(6);
    expect(all.filter((row) => row.duplicate_of !== null)).toHaveLength(6);
  });

  it("collapses a same-sweep pair at p >= 0.9 and keeps both rows", async () => {
    const brand = freshBrand();
    const { workspaceId, competitorId } = await seedWorkspace(brand);
    const run = jev(0.96);
    Reflect.set(env, "AI", { run });
    await sweep(brand, sameSweepPair(), NIGHT_ONE);
    const all = await rows(competitorId);
    const earlier = all.find((row) => hostOf(row.canonical_url) === "news.example.com");
    const later = all.find((row) => hostOf(row.canonical_url) === "syndicator.example.org");
    expect(all).toHaveLength(2);
    expect(duplicateAsks(run)).toBe(1);
    expect(earlier?.duplicate_of).toBeNull();
    expect(later?.duplicate_of).toBe(earlier?.id);
    const feed = await readMentionFeed(workspaceId, new Date(NIGHT_ONE));
    expect(feed.map((row) => row.id)).toEqual([earlier?.id]);
  });

  it("pairs a same-sweep item on the normalized url when the titles differ", async () => {
    const brand = freshBrand();
    const { competitorId } = await seedWorkspace(brand);
    const run = jev(0.96);
    Reflect.set(env, "AI", { run });
    await sweep(
      brand,
      [
        article("https://news.example.com/a"),
        article("https://www.news.example.com/a/?utm_medium=x", "Another headline"),
      ],
      NIGHT_ONE,
    );
    expect(duplicateAsks(run)).toBe(1);
    expect((await rows(competitorId)).filter((row) => row.duplicate_of !== null)).toHaveLength(1);
  });

  it("points a third same-sweep item at the earliest one", async () => {
    const brand = freshBrand();
    const { competitorId } = await seedWorkspace(brand);
    const run = jev(0.96);
    Reflect.set(env, "AI", { run });
    await sweep(
      brand,
      [...sameSweepPair(), article("https://third.example.net/x", TITLE, "third.example.net")],
      NIGHT_ONE,
    );
    const all = await rows(competitorId);
    const earliest = all.find((row) => hostOf(row.canonical_url) === "news.example.com");
    expect(duplicateAsks(run)).toBe(2);
    expect(all.filter((row) => row.duplicate_of === earliest?.id)).toHaveLength(2);
  });

  it.each([0.5, 0.05])("keeps a same-sweep pair separate at p = %s", async (answer) => {
    const brand = freshBrand();
    const { competitorId } = await seedWorkspace(brand);
    const run = jev(answer);
    Reflect.set(env, "AI", { run });
    await sweep(brand, sameSweepPair(), NIGHT_ONE);
    expect(duplicateAsks(run)).toBe(1);
    expect((await rows(competitorId)).map((row) => row.duplicate_of)).toEqual([null, null]);
  });

  it("does not ask again for a same-sweep pair it already has a verdict for", async () => {
    const brand = freshBrand();
    const { competitorId } = await seedWorkspace(brand);
    const run = jev(0.96);
    Reflect.set(env, "AI", { run });
    await sweep(brand, sameSweepPair(), NIGHT_ONE);
    const asksBefore = duplicateAsks(run);
    await env.DB.batch([
      env.DB.prepare("UPDATE jev_verdict SET signal_id = NULL WHERE entity_id = ?").bind(competitorId),
      env.DB.prepare("DELETE FROM signal WHERE entity_id = ?").bind(competitorId),
    ]);
    await sweep(brand, sameSweepPair(), NIGHT_TWO);
    expect(duplicateAsks(run)).toBe(asksBefore);
    expect((await rows(competitorId)).filter((row) => row.duplicate_of !== null)).toHaveLength(1);
  });

  it("counts same-sweep pairs against the per-watch judging budget", async () => {
    const brand = freshBrand();
    const { competitorId } = await seedWorkspace(brand);
    const run = jev(0.96);
    Reflect.set(env, "AI", { run });
    const interleaved = Array.from({ length: 12 }, (_, index) => [
      article(`https://news.example.com/o${String(index)}`, `Quillon launches product ${String(index)}`),
      article(`https://copy.example.org/c${String(index)}`, `Quillon launches product ${String(index)}`),
    ]).flat();
    await sweep(brand, interleaved, NIGHT_ONE);
    const all = await rows(competitorId);
    expect(duplicateAsks(run)).toBe(4);
    expect(all).toHaveLength(8);
    expect(all.filter((row) => row.duplicate_of !== null)).toHaveLength(4);
  });

  it("never pairs a mention with another workspace's row", async () => {
    const brand = freshBrand();
    const first = await seedWorkspace(brand);
    const second = await seedWorkspace(brand);
    const run = jev(0.96);
    Reflect.set(env, "AI", { run });
    await sweep(brand, [article("https://news.example.com/a")], NIGHT_ONE, first.workspaceId);
    await sweep(brand, [article("https://www.syndicator.example.org/copy")], NIGHT_TWO, second.workspaceId);
    expect(duplicateAsks(run)).toBe(0);
    expect((await rows(second.competitorId)).map((row) => row.duplicate_of)).toEqual([null]);
  });
});

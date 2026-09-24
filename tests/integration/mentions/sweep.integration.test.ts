import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readSignalAlerts } from "../../../app/lib/data/alert.server";
import { planTargets, sweepTarget } from "../../../workers/mentions/sweep";

const NOW = "2026-09-24T03:00:00.000Z";

const ARTICLES = [
  {
    url: "https://news.example.com/zephyrwear-opens-london-flagship",
    title: "Zephyrwear opens a London flagship",
    seendate: "20260923T101500Z",
    domain: "news.example.com",
  },
  {
    url: "https://blog.example.com/ten-hoodies",
    title: "Ten hoodies we liked, Zephyrwear among them",
    seendate: "20260923T091500Z",
    domain: "blog.example.com",
  },
  {
    url: "https://weather.example.com/zephyr-winds",
    title: "Zephyr winds expected this weekend",
    seendate: "20260923T081500Z",
    domain: "weather.example.com",
  },
];

let runs = 0;

async function seedWorkspace(): Promise<{ workspaceId: string; competitorId: string; brand: string }> {
  runs += 1;
  const workspaceId = `ws-mentions-${String(runs)}`;
  const userId = `user-mentions-${String(runs)}`;
  const brand = `Zephyrwear ${String(runs)}`;
  const competitorId = `${workspaceId}-competitor`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, `${userId}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'self', ?3, 'Gymshark', '{\"description\":\"Gym clothing\"}', ?4)",
    ).bind(`${workspaceId}-self`, workspaceId, `gymshark-${String(runs)}.com`, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, ?5)",
    ).bind(competitorId, workspaceId, `zephyrwear-${String(runs)}.com`, brand, NOW),
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
    const p =
      questionId === "mention_is_about_brand"
        ? title.includes("winds")
          ? 0.03
          : 0.96
        : title.includes("flagship")
          ? 0.94
          : 0.4;
    return Promise.resolve({ answers: { [questionId ?? ""]: { type: "noul", noul: p } } });
  });
}

async function gdeltTargetFor(brand: string) {
  const targets = await planTargets();
  const target = targets.find((entry) => entry.pluginKey === "gdelt.doc" && entry.query === brand);
  if (target === undefined) throw new Error(`no gdelt target for ${brand}`);
  return target;
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(env, "AI");
});

describe("nightly mentions sweep", () => {
  it("watches every brand that is on, on both news sources", async () => {
    const { brand } = await seedWorkspace();
    const targets = (await planTargets()).filter((entry) => entry.query === brand);
    expect(targets.map((entry) => entry.pluginKey).sort()).toEqual(["gdelt.doc", "hn.algolia"]);
  });

  it("alerts only on news that matters, hides look-alike names and keeps the proof", async () => {
    const { workspaceId, competitorId, brand } = await seedWorkspace();
    stubGdelt();
    Reflect.set(env, "AI", { run: jevAnswering() });

    const outcome = await sweepTarget(await gdeltTargetFor(brand), NOW);
    expect(outcome).toEqual({ items: 3, stored: 2, unjudged: 0 });

    const alerts = await readSignalAlerts(env.DB, workspaceId);
    expect(alerts.map((alert) => alert.title)).toEqual([`${brand}: Zephyrwear opens a London flagship`]);

    const signals = await env.DB.prepare(
      "SELECT title, is_tombstoned FROM signal WHERE entity_id = ? ORDER BY title",
    )
      .bind(competitorId)
      .all<{ title: string; is_tombstoned: number }>();
    expect(signals.results.map((row) => [row.title, row.is_tombstoned])).toEqual([
      ["Ten hoodies we liked, Zephyrwear among them", 0],
      ["Zephyr winds expected this weekend", 1],
      ["Zephyrwear opens a London flagship", 0],
    ]);

    const snapshot = await env.DB.prepare(
      "SELECT sn.payload_r2_key AS r2_key FROM snapshot sn JOIN watch w ON w.id = sn.watch_id WHERE w.entity_id = ?",
    )
      .bind(competitorId)
      .first<{ r2_key: string }>();
    const stored = await env.SNAPSHOTS.get(snapshot?.r2_key ?? "");
    expect(JSON.parse((await stored?.text()) ?? "{}")).toEqual({ articles: ARTICLES });
  });

  it("does not judge or alert the same article twice", async () => {
    const { workspaceId, brand } = await seedWorkspace();
    stubGdelt();
    const run = jevAnswering();
    Reflect.set(env, "AI", { run });

    await sweepTarget(await gdeltTargetFor(brand), NOW);
    const callsAfterFirst = run.mock.calls.length;
    const second = await sweepTarget(await gdeltTargetFor(brand), "2026-09-25T03:00:00.000Z");

    expect(run.mock.calls.length).toBe(callsAfterFirst);
    expect(second).toEqual({ items: 3, stored: 0, unjudged: 0 });
    expect(await readSignalAlerts(env.DB, workspaceId)).toHaveLength(1);
  });

  it("stores nothing unjudged when the AI is unavailable, so the next night retries", async () => {
    const { workspaceId, competitorId, brand } = await seedWorkspace();
    stubGdelt();
    Reflect.set(env, "AI", { run: vi.fn(() => Promise.reject(new Error("Insufficient balance"))) });

    const outcome = await sweepTarget(await gdeltTargetFor(brand), NOW);
    expect(outcome).toEqual({ items: 3, stored: 0, unjudged: 3 });

    const signals = await env.DB.prepare("SELECT COUNT(*) AS n FROM signal WHERE entity_id = ?")
      .bind(competitorId)
      .first<{ n: number }>();
    expect(signals?.n).toBe(0);
    expect(await readSignalAlerts(env.DB, workspaceId)).toEqual([]);
  });
});

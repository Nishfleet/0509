import { env } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CanarySource } from "../../../app/lib/data/source.server";
import { readCanarySources } from "../../../app/lib/data/source.server";
import { runCanary } from "../../../workers/mentions/canary";
import { planTargets, sweepTarget } from "../../../workers/mentions/sweep";

const NOW = "2026-09-24T03:00:00.000Z";
const LAST_GOOD = "2026-09-23T03:00:00.000Z";

const ONE_ARTICLE = {
  articles: [
    {
      url: "https://news.example.com/zephyrwear-opens-london-flagship",
      title: "Zephyrwear opens a London flagship",
      seendate: "20260923T101500Z",
      domain: "news.example.com",
    },
  ],
};

let runs = 0;

/**
 * A dedicated mentions source row for the canary cases: a distinct platform
 * keeps it clear of the seeded rows' UNIQUE (platform, kind, plugin_key), and
 * is_enabled = 0 keeps readActiveWatches from auto-watching it, so the sibling
 * sweep suite's target counts are untouched. It still routes to the real gdelt
 * adapter through plugin_key.
 */
async function seedCanarySource(slot: string): Promise<CanarySource> {
  const sourceId = `src_canary_${slot}`;
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json, canary_query, last_good_at)
     VALUES (?1, ?2, 'mentions', 'canary_test', 'gdelt.doc', 'official_api', 0, '{}', 'google', ?3)`,
  )
    .bind(sourceId, `canary.test.${slot}`, LAST_GOOD)
    .run();
  return { id: sourceId, pluginKey: "gdelt.doc", canaryQuery: "google" };
}

async function readSource(sourceId: string) {
  return env.DB.prepare("SELECT degraded_reason, last_good_at FROM source WHERE id = ?")
    .bind(sourceId)
    .first<{ degraded_reason: string | null; last_good_at: string | null }>();
}

async function seedWorkspace(): Promise<{ competitorId: string; brand: string }> {
  runs += 1;
  const workspaceId = `ws-canary-${String(runs)}`;
  const userId = `user-canary-${String(runs)}`;
  const brand = `Canarywear ${String(runs)}`;
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
    ).bind(competitorId, workspaceId, `canarywear-${String(runs)}.com`, brand, NOW),
  ]);
  return { competitorId, brand };
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

describe("per-source canary in the mentions sweep (#4003 slice 2/6)", () => {
  it("reads the enabled mentions sources that carry a canary query", async () => {
    const sources = await readCanarySources();
    const gdelt = sources.find((source) => source.pluginKey === "gdelt.doc");
    if (gdelt === undefined) throw new Error("no gdelt canary source");
    expect(gdelt.canaryQuery).toBe("google");
    expect(gdelt.id).toBeTruthy();
    for (const source of sources) {
      expect(source.canaryQuery.length).toBeGreaterThan(0);
      expect(source.pluginKey.length).toBeGreaterThan(0);
    }
  });

  it("case A: a body with one article is a green canary and clears the degraded reason", async () => {
    const source = await seedCanarySource("a");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(ONE_ARTICLE))));

    try {
      const count = await runCanary(source, NOW);

      expect(count).toBe(1);
      const row = await readSource(source.id);
      expect(row?.degraded_reason).toBeNull();
      expect(row?.last_good_at).toBe(NOW);
    } finally {
      await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(source.id).run();
    }
  });

  it("case B: an empty 200 body is a zero canary that degrades the source and leaves last_good_at", async () => {
    const source = await seedCanarySource("b");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ articles: [] }))));

    try {
      const count = await runCanary(source, NOW);

      expect(count).toBe(0);
      const row = await readSource(source.id);
      expect(row?.degraded_reason).toBe("not answering");
      expect(row?.last_good_at).toBe(LAST_GOOD);
    } finally {
      await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(source.id).run();
    }
  });

  it("case B2: an adapter that throws is a zero canary, never a green one", async () => {
    const source = await seedCanarySource("b2");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));

    try {
      const count = await runCanary(source, NOW);

      expect(count).toBe(0);
      const row = await readSource(source.id);
      expect(row?.degraded_reason).toBe("not answering");
    } finally {
      await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(source.id).run();
    }
  });

  it("case C: the sweep writes the canary count it was handed onto every snapshot row", async () => {
    const { competitorId, brand } = await seedWorkspace();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(ONE_ARTICLE))));
    Reflect.set(env, "AI", {
      run: vi.fn((_model: string, input: { questions: Record<string, unknown> }) => {
        const [questionId] = Object.keys(input.questions);
        const p = questionId === "mention_matters" ? 0.94 : 0.96;
        return Promise.resolve({ answers: { [questionId ?? ""]: { type: "boolean", probability: p } } });
      }),
    });

    const target = await gdeltTargetFor(brand);
    const outcome = await sweepTarget(target, NOW, 0);
    expect(outcome.items).toBe(1);
    const snapshots = await env.DB.prepare(
      "SELECT sn.canary_count AS canary_count FROM snapshot sn JOIN watch w ON w.id = sn.watch_id WHERE w.entity_id = ?",
    )
      .bind(competitorId)
      .all<{ canary_count: number | null }>();
    expect(snapshots.results.length).toBeGreaterThan(0);
    for (const snapshot of snapshots.results) {
      expect(snapshot.canary_count).toBe(0);
    }
  });
});

describe("mentions sweep telemetry (#4003 slice 3/6)", () => {
  it("case D: each swept source emits exactly one MENTIONS_SOURCES point with its item and canary counts", async () => {
    const { brand } = await seedWorkspace();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(ONE_ARTICLE))));
    const spy = vi.spyOn(workerEnv.MENTIONS_SOURCES, "writeDataPoint");

    try {
      const target = await gdeltTargetFor(brand);
      await sweepTarget(target, NOW, 3);

      expect(spy).toHaveBeenCalledExactlyOnceWith({
        blobs: [target.pluginKey],
        doubles: [1, 3],
        indexes: [target.pluginKey],
      });
      const call = spy.mock.calls[0];
      if (!call || !call[0]) throw new Error("expected one MENTIONS_SOURCES point");
      const point = call[0];
      const blobsAndIndexes: (string | ArrayBuffer | null)[] = [
        ...(point.blobs ?? []),
        ...(point.indexes ?? []),
      ];
      for (const value of blobsAndIndexes) {
        if (typeof value !== "string") continue;
        expect(value).not.toContain(target.query);
      }
    } finally {
      spy.mockRestore();
    }
  });
});

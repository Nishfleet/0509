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
  return vi.fn(
    (
      _model: string,
      input: {
        state: { item?: { title?: string }; other?: { title?: string } };
        questions: Record<string, unknown>;
      },
    ) => {
      const [questionId] = Object.keys(input.questions);
      const title = input.state.item?.title ?? "";
      const other = input.state.other?.title ?? "";
      let p = 0.4;
      if (questionId === "mention_is_about_brand") p = title.includes("winds") ? 0.03 : 0.96;
      else if (questionId === "duplicate_signal") p = title !== "" && title === other ? 0.96 : 0.04;
      else if (title.includes("flagship")) p = 0.94;
      return Promise.resolve({ answers: { [questionId ?? ""]: { type: "noul", noul: p } } });
    },
  );
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
      ["Zephyrwear opens a London flagship", 0],
    ]);
    const drop = await env.DB.prepare(
      "SELECT question_id, reason, signal_id FROM jev_verdict WHERE workspace_id = ? AND reason = 'drop'",
    )
      .bind(workspaceId)
      .all<{ question_id: string; reason: string; signal_id: string | null }>();
    expect(drop.results).toEqual([{ question_id: "mention_is_about_brand", reason: "drop", signal_id: null }]);

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

  it("collapses a second sighting of the same story and upgrades a Google News URL", async () => {
    const { workspaceId, competitorId, brand } = await seedWorkspace();
    const googleUrl = "https://news.google.com/rss/articles/zephyr-flagship";
    const priorId = `prior-${workspaceId}`;
    await env.DB.prepare(
      `INSERT INTO signal
        (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, dedup_key, observed_at, last_seen_at, payload_json)
       VALUES (?1, ?2, ?3, 'src_mentions_hn', 'mention', ?4, ?5, ?5, ?6, ?7, ?8, ?8, '{}')`,
    )
      .bind(
        priorId,
        workspaceId,
        competitorId,
        ARTICLES[0]?.title,
        googleUrl,
        await sha256Hex(googleUrl),
        `prior-${priorId}`,
        "2026-09-23T03:00:00.000Z",
      )
      .run();
    stubGdelt();
    Reflect.set(env, "AI", { run: jevAnswering() });

    const outcome = await sweepTarget(await gdeltTargetFor(brand), NOW);
    expect(outcome).toEqual({ items: 3, stored: 1, unjudged: 0 });

    const prior = await env.DB.prepare(
      "SELECT canonical_url, last_seen_at, engagement_json FROM signal WHERE id = ?",
    )
      .bind(priorId)
      .first<{ canonical_url: string; last_seen_at: string; engagement_json: string }>();
    expect(prior?.canonical_url).toBe(ARTICLES[0]?.url);
    expect(prior?.last_seen_at).toBe(NOW);
    expect(JSON.parse(prior?.engagement_json ?? "{}")).toEqual({
      sightings: [
        {
          source_id: "src_mentions_gdelt",
          url: ARTICLES[0]?.url,
          title: ARTICLES[0]?.title,
          seen_at: NOW,
        },
      ],
    });

    const titles = await env.DB.prepare("SELECT title FROM signal WHERE entity_id = ? ORDER BY title")
      .bind(competitorId)
      .all<{ title: string }>();
    expect(titles.results.map((row) => row.title)).toEqual([
      "Ten hoodies we liked, Zephyrwear among them",
      "Zephyrwear opens a London flagship",
    ]);

    const collapse = await env.DB.prepare(
      "SELECT question_id, p, reason, signal_id FROM jev_verdict WHERE workspace_id = ? AND question_id = 'duplicate_signal' AND reason = 'collapse'",
    )
      .bind(workspaceId)
      .first<{ question_id: string; p: number; reason: string; signal_id: string }>();
    expect(collapse).toMatchObject({ question_id: "duplicate_signal", p: 0.96, reason: "collapse", signal_id: priorId });
    expect(await readSignalAlerts(env.DB, workspaceId)).toEqual([]);
  });
});

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { D3_QUESTION_ID, D6_QUESTION_ID } from "../../../workers/standing/score";
import type { RefreshInput } from "../../../workers/standing/refresh";
import { COUNT_BUCKETS, refreshWorkspaceScores } from "../../../workers/standing/refresh";

/**
 * The nightly refresh against the real D1 the deploy ships.
 *
 * One call recomputes every ON entity's score for one workspace and one week:
 * the bucket counts run as the COUNT_BUCKETS SQL, the weights resolve as of the
 * week, and the upsert writes only score and computed_at in a single batch. The
 * seed pins the arithmetic (A = 3.9, B = 3.4, C = 0) and the EXPLAIN test pins
 * the index the counting query must use.
 */

const WINDOW_START = "2026-09-15T00:00:00.000Z";
const WINDOW_END = "2026-09-22T00:00:00.000Z";
const WEEK_START = "2026-09-21T00:00:00.000Z";
const SEED_WEEK = "2026-09-14T00:00:00.000Z";
const SEEDED_AT = "2026-09-21T00:00:00.000Z";

const v1Weights: [string, number][] = [
  ["ad_copy_change", 3],
  ["ad_new_creative", 2],
  ["hiring_new_role", 1],
  ["mention_matters", 3],
  ["mention_normal", 1],
  ["reliability_best_effort", 0.5],
  ["reliability_official_api", 1],
  ["reliability_rss", 0.9],
  ["reliability_scraped_page", 0.6],
  ["site_change_noteworthy", 4],
];

interface Seeded {
  workspaceId: string;
  entityA: string;
  entityB: string;
  entityC: string;
  entityD: string;
}

let seededRuns = 0;
let weightsSeeded = false;

async function seed(): Promise<Seeded> {
  seededRuns += 1;
  const run = String(seededRuns);
  const workspaceId = `refresh-t-ws-${run}`;
  const userId = `refresh-t-user-${run}`;
  const entityA = `refresh-t-ent-a-${run}`;
  const entityB = `refresh-t-ent-b-${run}`;
  const entityC = `refresh-t-ent-c-${run}`;
  const entityD = `refresh-t-ent-d-${run}`;
  const sourceMentions = `refresh-t-src-mentions-${run}`;
  const sourceHiring = `refresh-t-src-hiring-${run}`;
  const sourceSite = `refresh-t-src-site-${run}`;
  const sourceAds = `refresh-t-src-ads-${run}`;
  const signalMentionHigh = `refresh-t-sig-mention-high-${run}`;
  const signalMentionLow = `refresh-t-sig-mention-low-${run}`;
  const signalHiring = `refresh-t-sig-hiring-${run}`;
  const signalHiringOutside = `refresh-t-sig-hiring-outside-${run}`;
  const signalChange = `refresh-t-sig-change-${run}`;
  const signalAd = `refresh-t-sig-ad-${run}`;
  const signalHiringOff = `refresh-t-sig-hiring-off-${run}`;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
    ).bind(userId, "Refresh Test", `refresh-t-${run}@example.test`, SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(workspaceId, "Refresh Test", userId, "UTC", SEEDED_AT),
    ...[
      ["a", entityA],
      ["b", entityB],
      ["c", entityC],
    ].map(([slug, id]) =>
      env.DB.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, 'on', ?5)",
      ).bind(id, workspaceId, `${slug}-${run}.example`, `Brand ${slug.toUpperCase()}`, SEEDED_AT),
    ),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, 'off', ?5)",
    ).bind(entityD, workspaceId, `d-${run}.example`, "Brand D", SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability) VALUES (?1, ?2, 'mentions', ?3, ?4, 'official_api')",
    ).bind(sourceMentions, `refresh-t-src-mentions-${run}`, `refresh-t-pf-mentions-${run}`, `refresh-t-pl-mentions-${run}`),
    env.DB.prepare(
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability) VALUES (?1, ?2, 'hiring', ?3, ?4, 'rss')",
    ).bind(sourceHiring, `refresh-t-src-hiring-${run}`, `refresh-t-pf-hiring-${run}`, `refresh-t-pl-hiring-${run}`),
    env.DB.prepare(
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability) VALUES (?1, ?2, 'site', ?3, ?4, 'scraped_page')",
    ).bind(sourceSite, `refresh-t-src-site-${run}`, `refresh-t-pf-site-${run}`, `refresh-t-pl-site-${run}`),
    env.DB.prepare(
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability) VALUES (?1, ?2, 'ads', ?3, ?4, 'best_effort')",
    ).bind(sourceAds, `refresh-t-src-ads-${run}`, `refresh-t-pf-ads-${run}`, `refresh-t-pl-ads-${run}`),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, canonical_url, url_hash, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'mention', ?5, ?6, ?7, ?8)",
    ).bind(signalMentionHigh, workspaceId, entityA, sourceMentions, `https://example.test/high-${run}`, `refresh-t-hash-high-${run}`, `refresh-t-dedup-high-${run}`, "2026-09-16T10:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, canonical_url, url_hash, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'mention', ?5, ?6, ?7, ?8)",
    ).bind(signalMentionLow, workspaceId, entityA, sourceMentions, `https://example.test/low-${run}`, `refresh-t-hash-low-${run}`, `refresh-t-dedup-low-${run}`, "2026-09-17T10:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'hiring', ?5, ?6)",
    ).bind(signalHiring, workspaceId, entityA, sourceHiring, `refresh-t-dedup-hiring-${run}`, "2026-09-18T10:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'hiring', ?5, ?6)",
    ).bind(signalHiringOutside, workspaceId, entityA, sourceHiring, `refresh-t-dedup-hiring-old-${run}`, "2026-09-10T10:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'change', 'copy', ?5, ?6)",
    ).bind(signalChange, workspaceId, entityB, sourceSite, `refresh-t-dedup-change-${run}`, "2026-09-19T10:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, published_at, observed_at) VALUES (?1, ?2, ?3, ?4, 'ad', ?5, ?6, ?7)",
    ).bind(signalAd, workspaceId, entityB, sourceAds, `refresh-t-dedup-ad-${run}`, "2026-09-16T10:00:00.000Z", "2026-09-20T10:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'hiring', ?5, ?6)",
    ).bind(signalHiringOff, workspaceId, entityD, sourceHiring, `refresh-t-dedup-hiring-off-${run}`, "2026-09-17T10:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'mention_matters', ?3, ?4, 0.95, ?5)",
    ).bind(`refresh-t-jev-high-${run}`, workspaceId, `refresh-t-ih-high-${run}`, signalMentionHigh, SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'mention_matters', ?3, ?4, 0.05, ?5)",
    ).bind(`refresh-t-jev-low-${run}`, workspaceId, `refresh-t-ih-low-${run}`, signalMentionLow, SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'noteworthy_change', ?3, ?4, 0.95, ?5)",
    ).bind(`refresh-t-jev-change-${run}`, workspaceId, `refresh-t-ih-change-${run}`, signalChange, SEEDED_AT),
  ]);

  if (!weightsSeeded) {
    weightsSeeded = true;
    await env.DB.batch([
      ...v1Weights.map(([key, weight]) =>
        env.DB.prepare(
          "INSERT INTO scoring_weight (id, key, weight, effective_from) VALUES (?1, ?2, ?3, ?4)",
        ).bind(`refresh-t-weight-${key}-${run}`, key, weight, SEED_WEEK),
      ),
      env.DB.prepare(
        "INSERT INTO scoring_weight (id, key, weight, effective_from) VALUES (?1, 'mention_matters', 100, ?2)",
      ).bind(`refresh-t-weight-later-${run}`, "2026-09-28T00:00:00.000Z"),
    ]);
  }

  return { workspaceId, entityA, entityB, entityC, entityD };
}

function inputFor(seedRun: Seeded, computedAt: string): RefreshInput {
  return {
    workspaceId: seedRun.workspaceId,
    weekStartAt: WEEK_START,
    windowStartAt: WINDOW_START,
    windowEndAt: WINDOW_END,
    computedAt,
  };
}

describe("refreshWorkspaceScores against real D1", () => {
  it("scores every ON entity and leaves the OFF brand without a row", async () => {
    const seeded = await seed();
    const scores = await refreshWorkspaceScores(
      env.DB,
      inputFor(seeded, "2026-09-21T06:00:00.000Z"),
    );

    expect(scores.size).toBe(3);
    expect(scores.get(seeded.entityA)).toBeCloseTo(3.9, 10);
    expect(scores.get(seeded.entityB)).toBeCloseTo(3.4, 10);
    expect(scores.get(seeded.entityC)).toBeCloseTo(0, 10);
    expect(scores.has(seeded.entityD)).toBe(false);

    const rows = await env.DB.prepare(
      "SELECT entity_id, score, rank, movement FROM standing WHERE workspace_id = ?1",
    )
      .bind(seeded.workspaceId)
      .all<{ entity_id: string; score: number; rank: number | null; movement: number | null }>();

    const byEntity = new Map((rows.results ?? []).map((row) => [row.entity_id, row]));
    expect(byEntity.size).toBe(3);
    expect(byEntity.get(seeded.entityA)?.score).toBeCloseTo(3.9, 10);
    expect(byEntity.get(seeded.entityB)?.score).toBeCloseTo(3.4, 10);
    expect(byEntity.get(seeded.entityC)?.score).toBeCloseTo(0, 10);
    expect(byEntity.has(seeded.entityD)).toBe(false);
    for (const row of byEntity.values()) {
      expect(row.rank).toBeNull();
      expect(row.movement).toBeNull();
    }
  });

  it("keeps exactly three rows and updates computed_at on a second refresh", async () => {
    const seeded = await seed();
    await refreshWorkspaceScores(env.DB, inputFor(seeded, "2026-09-21T06:00:00.000Z"));
    const secondComputedAt = "2026-09-21T07:00:00.000Z";
    await refreshWorkspaceScores(env.DB, inputFor(seeded, secondComputedAt));

    const rows = await env.DB.prepare(
      "SELECT entity_id, score, computed_at, rank, movement FROM standing WHERE workspace_id = ?1",
    )
      .bind(seeded.workspaceId)
      .all<{ entity_id: string; score: number; computed_at: string; rank: number | null; movement: number | null }>();

    expect(rows.results?.length).toBe(3);
    const ids = (rows.results ?? []).map((row) => row.entity_id).sort();
    expect(ids).toEqual([seeded.entityA, seeded.entityB, seeded.entityC].sort());
    for (const row of rows.results ?? []) {
      expect(row.computed_at).toBe(secondComputedAt);
      expect(row.rank).toBeNull();
      expect(row.movement).toBeNull();
    }
  });

  it("uses the signal index rather than scanning signal", async () => {
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${COUNT_BUCKETS}`)
      .bind(
        "refresh-t-ws-plan",
        WINDOW_START,
        WINDOW_END,
        D6_QUESTION_ID,
        D3_QUESTION_ID,
      )
      .all<{ detail: string }>();
    const details = (plan.results ?? []).map((row) => row.detail);
    console.log("EXPLAIN QUERY PLAN refresh:", JSON.stringify(details));
    expect(details.some((detail) => /^SEARCH s /.test(detail))).toBe(true);
    expect(details.every((detail) => !/^SCAN s( |$)/.test(detail))).toBe(true);
  });
});

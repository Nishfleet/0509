import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { parseBriefPayload, type BriefPayload } from "../../app/lib/brief-payload";
import { readHowRanked, readHowRankedInputs } from "../../app/lib/how-ranked.server";
import type { BucketCount } from "../../app/lib/standing-score";
import { refreshWorkspaceScores } from "../../workers/standing/refresh";

/**
 * The "how this is ranked" sheet's read against the real D1 the deploy ships.
 *
 * One call returns every scoring_weight row and the week's per-brand bucket
 * counts in a single batch — the same query the nightly score uses. The seed
 * mirrors the nightly refresh's, so the bucket assertions and the weight
 * assertions pin what the sheet will render.
 */

const WINDOW_START = "2026-09-15T00:00:00.000Z";
const WINDOW_END = "2026-09-22T00:00:00.000Z";
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
}

let seededRuns = 0;
let weightsSeeded = false;

async function seed(): Promise<Seeded> {
  seededRuns += 1;
  const run = String(seededRuns);
  const workspaceId = `how-ranked-t-ws-${run}`;
  const userId = `how-ranked-t-user-${run}`;
  const entityA = `how-ranked-t-ent-a-${run}`;
  const entityB = `how-ranked-t-ent-b-${run}`;
  const entityD = `how-ranked-t-ent-d-${run}`;
  const sourceMentions = `how-ranked-t-src-mentions-${run}`;
  const sourceHiring = `how-ranked-t-src-hiring-${run}`;
  const sourceSite = `how-ranked-t-src-site-${run}`;
  const sourceAds = `how-ranked-t-src-ads-${run}`;
  const signalMentionHigh = `how-ranked-t-sig-mention-high-${run}`;
  const signalMentionLow = `how-ranked-t-sig-mention-low-${run}`;
  const signalHiring = `how-ranked-t-sig-hiring-${run}`;
  const signalHiringOutside = `how-ranked-t-sig-hiring-outside-${run}`;
  const signalChange = `how-ranked-t-sig-change-${run}`;
  const signalAd = `how-ranked-t-sig-ad-${run}`;
  const signalHiringOffOff = `how-ranked-t-sig-hiring-off-${run}`;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
    ).bind(userId, "How Ranked Test", `how-ranked-t-${run}@example.test`, SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(workspaceId, "How Ranked Test", userId, "UTC", SEEDED_AT),
    ...[
      ["a", entityA],
      ["b", entityB],
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
    ).bind(sourceMentions, `how-ranked-t-src-mentions-${run}`, `how-ranked-t-pf-mentions-${run}`, `how-ranked-t-pl-mentions-${run}`),
    env.DB.prepare(
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability) VALUES (?1, ?2, 'hiring', ?3, ?4, 'rss')",
    ).bind(sourceHiring, `how-ranked-t-src-hiring-${run}`, `how-ranked-t-pf-hiring-${run}`, `how-ranked-t-pl-hiring-${run}`),
    env.DB.prepare(
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability) VALUES (?1, ?2, 'site', ?3, ?4, 'scraped_page')",
    ).bind(sourceSite, `how-ranked-t-src-site-${run}`, `how-ranked-t-pf-site-${run}`, `how-ranked-t-pl-site-${run}`),
    env.DB.prepare(
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability) VALUES (?1, ?2, 'ads', ?3, ?4, 'best_effort')",
    ).bind(sourceAds, `how-ranked-t-src-ads-${run}`, `how-ranked-t-pf-ads-${run}`, `how-ranked-t-pl-ads-${run}`),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, canonical_url, url_hash, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'mention', ?5, ?6, ?7, ?8)",
    ).bind(signalMentionHigh, workspaceId, entityA, sourceMentions, `https://example.test/high-${run}`, `how-ranked-t-hash-high-${run}`, `how-ranked-t-dedup-high-${run}`, "2026-09-16T10:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, canonical_url, url_hash, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'mention', ?5, ?6, ?7, ?8)",
    ).bind(signalMentionLow, workspaceId, entityA, sourceMentions, `https://example.test/low-${run}`, `how-ranked-t-hash-low-${run}`, `how-ranked-t-dedup-low-${run}`, "2026-09-17T10:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'hiring', ?5, ?6)",
    ).bind(signalHiring, workspaceId, entityA, sourceHiring, `how-ranked-t-dedup-hiring-${run}`, "2026-09-18T10:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'hiring', ?5, ?6)",
    ).bind(signalHiringOutside, workspaceId, entityA, sourceHiring, `how-ranked-t-dedup-hiring-old-${run}`, "2026-09-10T10:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'change', 'copy', ?5, ?6)",
    ).bind(signalChange, workspaceId, entityB, sourceSite, `how-ranked-t-dedup-change-${run}`, "2026-09-19T10:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, published_at, observed_at) VALUES (?1, ?2, ?3, ?4, 'ad', ?5, ?6, ?7)",
    ).bind(signalAd, workspaceId, entityB, sourceAds, `how-ranked-t-dedup-ad-${run}`, "2026-09-16T10:00:00.000Z", "2026-09-20T10:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'hiring', ?5, ?6)",
    ).bind(signalHiringOffOff, workspaceId, entityD, sourceHiring, `how-ranked-t-dedup-hiring-off-${run}`, "2026-09-17T10:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'mention_matters', ?3, ?4, 0.95, ?5)",
    ).bind(`how-ranked-t-jev-high-${run}`, workspaceId, `how-ranked-t-ih-high-${run}`, signalMentionHigh, SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'mention_matters', ?3, ?4, 0.05, ?5)",
    ).bind(`how-ranked-t-jev-low-${run}`, workspaceId, `how-ranked-t-ih-low-${run}`, signalMentionLow, SEEDED_AT),
    env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'noteworthy_change', ?3, ?4, 0.95, ?5)",
    ).bind(`how-ranked-t-jev-change-${run}`, workspaceId, `how-ranked-t-ih-change-${run}`, signalChange, SEEDED_AT),
  ]);

  if (!weightsSeeded) {
    weightsSeeded = true;
    await env.DB.batch(
      v1Weights.map(([key, weight]) =>
        env.DB.prepare(
          "INSERT INTO scoring_weight (id, key, weight, effective_from) VALUES (?1, ?2, ?3, ?4)",
        ).bind(`how-ranked-t-weight-${key}`, key, weight, SEED_WEEK),
      ),
    );
  }

  return { workspaceId, entityA, entityB };
}

function payloadFor(seeded: Seeded): BriefPayload {
  return parseBriefPayload(
    JSON.stringify({
      workspace_id: seeded.workspaceId,
      timezone: "UTC",
      period_start: WINDOW_START,
      period_end: WINDOW_END,
      headline_rank: 2,
      headline_total: 2,
      why_line: "Brand A is the mover.",
      brands: [
        { entity_id: seeded.entityA, name: "Brand A" },
        { entity_id: seeded.entityB, name: "Brand B" },
      ],
    }),
  );
}

describe("readHowRankedInputs against real D1", () => {
  it("returns the window's bucket counts and drops a signal outside it", async () => {
    const seeded = await seed();
    const { counts } = await readHowRankedInputs(
      env.DB,
      seeded.workspaceId,
      WINDOW_START,
      WINDOW_END,
    );

    const byKey = (a: BucketCount, b: BucketCount) =>
      `${a.entity_id}\u0000${a.bucket}\u0000${a.reliability}`.localeCompare(
        `${b.entity_id}\u0000${b.bucket}\u0000${b.reliability}`,
      );

    expect([...counts].sort(byKey)).toEqual(
      [
        { entity_id: seeded.entityA, bucket: "hiring_new_role", reliability: "rss", n: 1 },
        { entity_id: seeded.entityA, bucket: "mention_matters", reliability: "official_api", n: 1 },
        { entity_id: seeded.entityB, bucket: "ad_new_creative", reliability: "best_effort", n: 1 },
        { entity_id: seeded.entityB, bucket: "site_change_noteworthy", reliability: "scraped_page", n: 1 },
      ].sort(byKey),
    );
  });

  it("returns every scoring_weight row unfiltered by date", async () => {
    const seeded = await seed();
    await env.DB.prepare(
      "INSERT INTO scoring_weight (id, key, weight, effective_from) VALUES (?1, ?2, ?3, ?4)",
    )
      .bind("how-ranked-t-sw-mm", "mention_matters", 100, "2099-01-01T00:00:00.000Z")
      .run();

    const { weightRows } = await readHowRankedInputs(
      env.DB,
      seeded.workspaceId,
      WINDOW_START,
      WINDOW_END,
    );

    expect(weightRows).toEqual(
      expect.arrayContaining(v1Weights.map(([key, weight]) => ({ key, weight, effective_from: SEED_WEEK }))),
    );
    expect(weightRows).toContainEqual({
      key: "mention_matters",
      weight: 100,
      effective_from: "2099-01-01T00:00:00.000Z",
    });
  });

  it("returns no counts for a workspace with no entities", async () => {
    const { counts } = await readHowRankedInputs(
      env.DB,
      "how-ranked-t-ws-empty",
      WINDOW_START,
      WINDOW_END,
    );

    expect(counts).toEqual([]);
  });
});

describe("readHowRanked against real D1", () => {
  it("is null with no payload, and matches the nightly score for the frozen week", async () => {
    const seeded = await seed();
    expect(await readHowRanked(env.DB, null)).toBeNull();

    const sheet = await readHowRanked(env.DB, payloadFor(seeded));
    const scores = await refreshWorkspaceScores(env.DB, {
      workspaceId: seeded.workspaceId,
      weekStartAt: WINDOW_START,
      windowStartAt: WINDOW_START,
      windowEndAt: WINDOW_END,
      computedAt: SEEDED_AT,
    });

    expect(sheet?.brands).toHaveLength(2);
    for (const brand of sheet?.brands ?? []) {
      expect(brand.total).toBeCloseTo(scores.get(brand.entityId) ?? 0);
    }
    expect(scores.get(seeded.entityA)).toBeGreaterThan(0);
  });
});

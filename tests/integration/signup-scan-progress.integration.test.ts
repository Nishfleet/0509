import { describe, expect, it } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
  claimOrchestratedWatchlistRun,
  finishOrchestratedWatchlistRun,
  FIRST_SCAN_MAX_ATTEMPTS,
  resolveMonitoringOrchestrationLeaseMs,
} from "~/lib/monitoring-fanout.server";
import { getWatchlist } from "~/lib/data.server";
import {
  captureActivationMentionSources,
  prepareFirstWatchlistScanRun,
} from "~/lib/first-watchlist-scan.server";
import {
  planScanSources,
  readLatestScanProgressForWatchlist,
  recordScanSourceTick,
} from "~/lib/scan-source-progress.server";

import { appEnv, db, ISO_T0, seedRun, seedUser, seedWatchlist, uid } from "./fixtures";

/**
 * Issue #3176 — the activation fan-out's progress state, on the REAL schema.
 *
 * Runs on real workerd against the repo's real migrations (no #3176 migration
 * exists: the ticks ride `watchlist_run.summary_json.sourceProgress`, no new
 * table or column). Proves the three D1 truths the whole #3176 contract
 * stands on:
 *
 *   1. the planned denominator + per-source ticks round-trip through
 *      `watchlist_run.summary_json` and read back through the reader the
 *      waiting surface polls,
 *   2. `finishOrchestratedWatchlistRun`'s wholesale summary write PRESERVES
 *     the fan-out's progress subtree, and a source finishing after the run
 *     still appends its tick (the "late sources append without reload" path)
 *     without disturbing the finisher's own fields, and
 *   3. the mention leg (#3171) really polls through the EXISTING customer
 *     poll path on real D1 — gated connectors are skipped, degraded polls
 *     are ticked honestly, and one failing source never blocks the next.
 */

const FEED_HOST = "https://1.1.1.1";

const RSS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>MamaEarth Journal</title>
  <link>${FEED_HOST}</link>
  <item>
    <title>MamaEarth unveils its new sunscreen</title>
    <link>https://1.1.1.1/posts/sunscreen</link>
    <guid>https://1.1.1.1/posts/sunscreen</guid>
    <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    <author>editor@mamaearth.test (Editor)</author>
    <description>The geranium sunscreen everyone asked for.</description>
  </item>
</channel></rss>`;

/** Serves the fixture feed for any 1.1.1.1 hop (IP literal, no DNS), robots included. */
function feedFetcherFor(mode: "feed" | "dead"): typeof fetch {
  return ((input: unknown) => {
    if (mode === "dead") {
      return Promise.resolve(new Response("nope", { status: 500 }));
    }
    const url = String(input);
    if (url.includes("robots")) {
      return Promise.resolve(
        new Response("User-agent: *\nAllow: /", { status: 200 }),
      );
    }
    return Promise.resolve(
      new Response(RSS_FEED, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      }),
    );
  }) as typeof fetch;
}

/** The activation leg's gate posture: presence generally available, RSS in rollout. */
function activatedLegEnv(overrides: Record<string, string> = {}): AppEnv {
  return {
    ...appEnv,
    PRESENCE_WEBSITE_ROLLOUT: "ga",
    PRESENCE_RSS_ROLLOUT: "internal",
    ...overrides,
  } as AppEnv;
}

async function seedStarterWorkspacePlan(userId: string) {
  // The mention leg's poll path enforces the presence plan gates; a Starter
  // row unlocks presence_self_tracking + presence_social_connect, which is
  // exactly what a non-website mention target needs.
  await db()
    .prepare(
      "INSERT INTO user_plan (user_id, plan, dodo_status) VALUES (?, 'starter', 'active')",
    )
    .bind(userId, "active")
    .run();
}

async function seedTrackedEntityWithRssTargets(
  userId: string,
  targetCount: number,
): Promise<string[]> {
  const trackedEntityId = uid("entity");
  await db()
    .prepare(
      `INSERT INTO tracked_entity (
         id, user_id, tracking_mode, label, canonical_url, notes,
         is_active, created_at, updated_at
       ) VALUES (?, ?, 'self', 'MamaEarth', 'https://mamaearth.in', NULL, 1, ?, ?)`,
    )
    .bind(trackedEntityId, userId, ISO_T0, ISO_T0)
    .run();

  // `source_target.connector_id` (0055, widened by 0093) accepts 'rss'; the
  // presence_item CHECK (0098) does too, so the leg's captured items are
  // real rows, not mocks.
  const targetIds: string[] = [];
  for (let index = 0; index < targetCount; index += 1) {
    const targetId = uid("stgt");
    targetIds.push(targetId);
    await db()
      .prepare(
        `INSERT INTO source_target (
           id, tracked_entity_id, user_id, connector_id, target_key, target_url,
           metadata_json, coverage_label, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, 'rss', ?, 'https://1.1.1.1/brand-feed.xml', '{}', 'UNAVAILABLE', 1, ?, ?)`,
      )
      .bind(
        targetId,
        trackedEntityId,
        userId,
        `mamaearth-feed-${index}`,
        ISO_T0,
        ISO_T0,
      )
      .run();
  }
  return targetIds;
}

describe("signup scan-source progress on real D1 (#3176)", () => {
  it("plans the denominator and reads it back through the waiting surface's reader", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const runId = await seedRun(watchlistId, { status: "pending" });

    // The seam leg ticks by adapter id; the mention leg by source_target row
    // id — one map, distinct keys, no collisions.
    await planScanSources(appEnv, runId, [
      { sourceId: "google_ads", kind: "ad_library", label: "Google Ads" },
      { sourceId: "tiktok", kind: "ad_library", label: "TikTok Ads" },
      { sourceId: "stgt-1", kind: "mention", label: "RSS / Atom / JSON Feed" },
    ]);
    await recordScanSourceTick(appEnv, runId, "google_ads", {
      kind: "ad_library",
      label: "Google Ads",
      status: "running",
    });
    await recordScanSourceTick(appEnv, runId, "tiktok", {
      kind: "ad_library",
      label: "TikTok Ads",
      status: "done",
      detail: "changes:0",
    });

    const summary = await readLatestScanProgressForWatchlist(appEnv, watchlistId);
    expect(summary.total).toBe(3);
    expect(summary.done).toBe(1);
    expect(summary.remaining).toBe(2);
    const googleAds = summary.entries.find((e) => e.sourceId === "google_ads");
    expect(googleAds?.kind).toBe("ad_library");
    expect(googleAds?.status).toBe("running");
    expect(googleAds?.label).toBe("Google Ads");
  });

  it("the finisher preserves the progress subtree, and late sources still append to the finished run", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const runId = await seedRun(watchlistId, { status: "pending" });

    // The seam is mid-capture when the run finishes.
    await recordScanSourceTick(appEnv, runId, "google", {
      kind: "ad_library",
      label: "Google Ads",
      status: "running",
    });

    const claim = await claimOrchestratedWatchlistRun(appEnv, {
      runId,
      leaseMs: resolveMonitoringOrchestrationLeaseMs(appEnv),
      maxAttempts: FIRST_SCAN_MAX_ATTEMPTS,
    });
    expect(claim.claimed).toBe(true);
    const finalized = await finishOrchestratedWatchlistRun(appEnv, {
      runId,
      processingToken: claim.processingToken,
      status: "succeeded",
      pagesScanned: 1,
      summary: { adsSeen: 2, events: 0 },
    });
    expect(finalized).toBeTruthy();

    // #3176 money path: the finisher's wholesale summary write must NOT have
    // dropped the in-flight sourceProgress subtree.
    const afterFinish = await readLatestScanProgressForWatchlist(appEnv, watchlistId);
    const google = afterFinish.entries.find((e) => e.sourceId === "google");
    expect(google?.status).toBe("running");

    // The mention source finishes AFTER the run wrote — the late-append path.
    await recordScanSourceTick(appEnv, runId, "mention-1", {
      kind: "mention",
      label: "RSS / Atom / JSON Feed",
      status: "done",
      detail: "items:2",
    });

    const afterLateTick = await readLatestScanProgressForWatchlist(appEnv, watchlistId);
    expect(
      afterLateTick.entries.find((e) => e.sourceId === "mention-1")?.status,
    ).toBe("done");
    expect(
      afterLateTick.entries.find((e) => e.sourceId === "google")?.status,
    ).toBe("running");

    // And the late tick's json_set preserved the finisher's own wholesale
    // fields — the run row's summary stays one coherent document.
    const row = await db()
      .prepare("SELECT summary_json FROM watchlist_run WHERE id = ?")
      .bind(runId)
      .first<{ summary_json: string }>();
    const parsed = JSON.parse(row!.summary_json) as {
      adsSeen: number;
      sourceProgress: Record<string, { status: string }>;
    };
    expect(parsed.adsSeen).toBe(2);
    expect(parsed.sourceProgress["mention-1"].status).toBe("done");
  });

  it("the mention leg polls through the real customer poll path and captures into the mention table", async () => {
    const userId = await seedUser();
    await seedStarterWorkspacePlan(userId);
    const watchlistId = await seedWatchlist(userId);
    const runId = await seedRun(watchlistId, { status: "pending" });
    const [goodTargetId, deadTargetId] = await seedTrackedEntityWithRssTargets(userId, 2);

    // One healthy feed and one 500ing source: a failing source is ticked and
    // the next one still runs — "a source timing out never blocks the brief"
    // at the fan-out's own level.
    let call = 0;
    const flakyFetcher = ((input: unknown) => {
      call += 1;
      return call === 1
        ? feedFetcherFor("dead")(input as never)
        : feedFetcherFor("feed")(input as never);
    }) as typeof fetch;

    await expect(
      captureActivationMentionSources(activatedLegEnv(), userId, runId, {
        fetchImpl: flakyFetcher,
      }),
    ).resolves.toBeUndefined();

    const summary = await readLatestScanProgressForWatchlist(appEnv, watchlistId);
    const good = summary.entries.find((e) => e.sourceId === goodTargetId);
    expect(good?.status).toBe("done");
    expect(good?.detail).toBe("items:1");
    expect(good?.label).toBe("RSS / Atom / JSON Feed");

    const dead = summary.entries.find((e) => e.sourceId === deadTargetId);
    expect(dead?.status).toBe("failed");
    expect(dead?.detail).toBeTruthy();

    // The capture landed in the real mention substrate (presence_item), not
    // just in the progress map.
    const captured = await db()
      .prepare(
        "SELECT count(*) AS n FROM presence_item WHERE source_target_id = ?",
      )
      .bind(goodTargetId)
      .first<{ n: number }>();
    expect(captured?.n).toBeGreaterThanOrEqual(1);
  });

  it("ticks a connector whose rollout kill flag is closed as skipped, without burning the budget", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const runId = await seedRun(watchlistId, { status: "pending" });
    const [targetId] = await seedTrackedEntityWithRssTargets(userId, 1);

    // Rollout disabled: the leg's pre-check skips the source before any
    // poll — the free workspace needs no plan row at all here.
    await expect(
      captureActivationMentionSources(
        activatedLegEnv({ PRESENCE_RSS_ROLLOUT: "disabled" }),
        userId,
        runId,
        { fetchImpl: feedFetcherFor("feed") },
      ),
    ).resolves.toBeUndefined();

    const summary = await readLatestScanProgressForWatchlist(appEnv, watchlistId);
    const skipped = summary.entries.find((e) => e.sourceId === targetId);
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.detail).toBe("connector_not_operational");
  });

  it("a workspace with no tracked mention sources yet fans out quietly", async () => {
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const runId = await seedRun(watchlistId, { status: "pending" });

    await expect(
      captureActivationMentionSources(appEnv, userId, runId, {
        fetchImpl: feedFetcherFor("feed"),
      }),
    ).resolves.toBeUndefined();

    const summary = await readLatestScanProgressForWatchlist(appEnv, watchlistId);
    expect(summary.total).toBe(0);
  });

  it("the real activation preparation yields a run row the progress reader resolves", async () => {
    // The wiring proof: prepareFirstWatchlistScanRun (the same helper the
    // Workflow's first_scan job runs) creates the run the waiting surface
    // reads — before the leg plans anything, the summary is honestly empty.
    const userId = await seedUser();
    const watchlistId = await seedWatchlist(userId);
    const watchlist = await getWatchlist(appEnv, watchlistId);
    expect(watchlist).toBeTruthy();

    const descriptor = await prepareFirstWatchlistScanRun(appEnv, watchlist!);
    const summary = await readLatestScanProgressForWatchlist(appEnv, watchlistId);
    expect(summary.total).toBe(0);

    // Once the workflow's plan lands, the denominator appears — even while
    // every source is still pending (the "scanning N sources" moment).
    await planScanSources(appEnv, descriptor.runId, [
      { sourceId: "google_ads", kind: "ad_library", label: "Google Ads" },
      { sourceId: "stgt-1", kind: "mention", label: "RSS / Atom / JSON Feed" },
    ]);
    const planned = await readLatestScanProgressForWatchlist(appEnv, watchlistId);
    expect(planned.total).toBe(2);
    expect(planned.done).toBe(0);
  });
});

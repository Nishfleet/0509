import { expect, it, describe } from "vitest";

import { runWatchlist } from "~/lib/monitoring.server";
import { getWatchlist } from "~/lib/data/watchlists-core.server";
import type { AppEnv } from "~/lib/env.server";

import {
  appEnv,
  db,
  ISO_T0,
  seedUser,
  uid,
} from "./fixtures";

/**
 * Issue #3103: the Meta discovery canary went red because
 * `website_site_scan` had 0 rows — the full-site scan write path was
 * silently skipped in production. The orchestrator placed the site-scan
 * block *after* the degraded (`cache_only`) throw inside runWatchlist's
 * first lease-fenced effect closure, so any shared discovery-provider
 * cooldown that degrades scheduled runs suppressed every inventory
 * manifest write while the ads pipeline kept showing life. A
 * mocked-binding unit test cannot see that ordering against the real
 * lease and schema, so the orchestrator write path is proven here
 * against real migrations.
 *
 * `runWatchlist`'s later phases (proof capture, alert delivery) may
 * reject on bindings this fixture does not provide; the warnings below
 * swallow exactly those. The manifest is the write under test: it must
 * persist regardless of what a later phase does, and it must exist for a
 * cache-only (degraded) run too — that is the #3103 regression seal.
 */

const siteScanEnv = {
  ...appEnv,
  FULLSITE_WATCH_ENABLED: "true",
} as AppEnv;

async function seedAdvertiserWatchlistWithWebsite(id = uid("wl")) {
  const workspaceId = await seedUser();
  await db().prepare(
    `INSERT INTO watchlist (
       id, user_id, name, target_type, target_id, target_fingerprint,
       target_label, is_active, created_at, updated_at
     ) VALUES (?, ?, ?, 'advertiser', 'https://competitor.example', ?, ?, 1, ?, ?)`,
  )
    .bind(id, workspaceId, `Fixture ${id}`, `fp_${id}`, `Label ${id}`, ISO_T0, ISO_T0)
    .run();
  return { workspaceId, watchlistId: id };
}

async function seedRunningClaimedRun(watchlistId: string, processingToken: string) {
  const id = uid("run");
  await db()
    .prepare(
      `INSERT INTO watchlist_run (
         id, watchlist_id, trigger_type, status, processing_token,
         summary_json, started_at, created_at, updated_at
       ) VALUES (?, ?, 'scheduled', 'running', ?, '{}', ?, ?, ?)`,
    )
    .bind(id, watchlistId, processingToken, ISO_T0, ISO_T0, ISO_T0)
    .run();
  return id;
}

interface RunWatchlistOutcome {
  threw: boolean;
  error: unknown;
}

async function runOrchestratedScan(
  env: AppEnv,
  watchlistId: string,
  processingToken: string,
  degraded: boolean,
) {
  const runId = await seedRunningClaimedRun(watchlistId, processingToken);
  const watchlist = await getWatchlist(env, watchlistId);
  if (!watchlist) {
    throw new Error(`fixture watchlist ${watchlistId} missing`);
  }
  let threw = false;
  try {
    await runWatchlist(
      env,
      watchlist,
      "scheduled",
      async () => ({ ads: [], pagesScanned: 0, degraded }),
      { existingRunId: runId, orchestrationToken: processingToken },
    );
  } catch (error) {
    threw = true;
    console.warn(
      "runWatchlist later phase rejected on fixture bindings (not under test)",
      error,
    );
  }
  return { runId, threw };
}

describe("website_site_scan orchestrator write path against real D1 (issue #3103)", () => {
  it("lands a manifest row for a healthy scheduled run through runWatchlist", async () => {
    const { watchlistId } = await seedAdvertiserWatchlistWithWebsite();
    const { runId } = await runOrchestratedScan(siteScanEnv, watchlistId, "token-healthy", false);

    const row = await db()
      .prepare("SELECT * FROM website_site_scan WHERE watchlist_run_id = ?")
      .bind(runId)
      .first();
    expect(
      row,
      "the orchestrator must land a website_site_scan manifest for a scheduled run",
    ).not.toBeNull();
  });

  it("still lands a manifest row when the ad scan returns degraded (cache-only) — issue #3103 regression", async () => {
    const { watchlistId } = await seedAdvertiserWatchlistWithWebsite();
    const { runId } = await runOrchestratedScan(siteScanEnv, watchlistId, "token-degraded", true);

    const row = await db()
      .prepare("SELECT * FROM website_site_scan WHERE watchlist_run_id = ?")
      .bind(runId)
      .first();
    expect(
      row,
      "a cache-only cooldown must not silence the full-site inventory manifest (issue #3103)",
    ).not.toBeNull();
  });
});

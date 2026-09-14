import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import type { AppEnv } from "~/lib/env.server";
import { bulkAcceptSuggestedCompetitors } from "~/lib/auto-competitor-bulk-accept.server";
import {
  firstWatchlistScanExecutionKey,
  processFirstWatchlistScanQueue,
} from "~/lib/first-watchlist-scan.server";
import { maybeFileAndDeliverFirstBrief } from "~/lib/first-brief.server";
import { getWatchlist } from "~/lib/data.server";

import { appEnv, db, seedUser, uid } from "./fixtures";

/**
 * Issue #3380 — the signup→first-run→first-brief loop's step zero: a freshly
 * created watchlist must be PICKED UP by the first-scan queue, not left for
 * the next free-plan scheduled slot (weekly, Monday 03:00 UTC).
 *
 * Everything here runs on the REAL migrations (apply-migrations.ts) against
 * real workerd D1 — the schema is the assertion surface, so a mocked-binding
 * test would not count (issue #3380 accept 2).
 *
 * The production creation path under test is `bulkAcceptSuggestedCompetitors`
 * (the auto-competitor bulk accept, which creates watchlists through the same
 * `createWatchlistWithinLimit` surface every other creation path uses). Its
 * per-candidate loop queues the activation scan via `queueFirstWatchlistScan`
 * — the wiring this suite exists to pin. On origin/main that call is absent,
 * so no `watchlist_run` row exists after creation and both tests below fail.
 *
 * The `workers` project's wrangler.test.jsonc deliberately declares ONLY the
 * D1 (and rate-limit) bindings — there is no MONITORING_WORKFLOW binding. The
 * durable dispatch contract therefore plays out exactly as designed for a
 * failed handoff (`dispatchFirstWatchlistScanWorkflow`): the run row stays
 * `pending` with `error_code = 'workflow_binding_missing'` and a retry_after,
 * left for reconciliation. The queue is then executed WITHOUT a Workflow
 * binding via `processFirstWatchlistScanQueue` — the module's compatibility
 * helper, which replays the Workflow step on the SAME durable run. With
 * `E2E_PROVIDER_NETWORK_DENY=1` the scan finishes honestly `skipped`
 * (`scanStatus: 'e2e_provider_network_denied'`): zero events claimed, no
 * phantom brief filed — the honest all-quiet heartbeat the issue asks for.
 *
 * Storage is isolated per test FILE, so every fixture id is unique and every
 * assertion is scoped to its own workspace/watchlist ids.
 */

/** Runs the real bulk-accept production path and tolerates the env-honest dispatch rejection. */
async function bulkAcceptOneCandidate(options: { workspaceUserId: string; advertiser: string }) {
  return bulkAcceptSuggestedCompetitors({
    env: appEnv,
    workspaceUserId: options.workspaceUserId,
    candidates: [
      {
        candidateId: uid("cand"),
        advertiser: options.advertiser,
        landingPageUrl: `https://${options.advertiser.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.example.com/launch`,
        targetCountry: "all",
      },
    ],
    planLimit: 3,
    currentCount: 0,
    existingFingerprints: [],
  }).then(
    (result) => ({ result, dispatchError: null as unknown }),
    (error) => ({ result: null, dispatchError: error }),
  );
}

/**
 * The import-backed creation path names the watchlist `"${targetLabel} watch"
 * (competitor-import's prepareImportRow), not the raw advertiser string, so
 * the lookup is scoped to the per-test seeded user (ids are unique per call
 * and storage is isolated per file) and takes that user's newest watchlist.
 */
async function findCreatedWatchlist(options: { workspaceUserId: string }) {
  const row = await db()
    .prepare(
      `SELECT id, name, user_id, is_active, last_scanned_at
       FROM watchlist
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(options.workspaceUserId)
    .first<{
      id: string;
      name: string;
      user_id: string;
      is_active: number;
      last_scanned_at: string | null;
    }>();
  return row;
}

async function readFirstScanRun(watchlistId: string) {
  return db()
    .prepare(
      `SELECT id, watchlist_id, trigger_type, status, idempotency_key,
              workflow_instance_id, error_code, summary_json, finished_at,
              workflow_instance_id IS NOT NULL AS has_workflow_instance
       FROM watchlist_run
       WHERE watchlist_id = ? AND idempotency_key = ?
       LIMIT 1`,
    )
    .bind(watchlistId, firstWatchlistScanExecutionKey(watchlistId))
    .first<{
      id: string;
      watchlist_id: string;
      trigger_type: string;
      status: string;
      idempotency_key: string;
      workflow_instance_id: string | null;
      error_code: string | null;
      summary_json: string;
      finished_at: string | null;
      has_workflow_instance: number;
    }>();
}

describe("monitoring pickup — first-scan queue on a production watchlist-creation path (issue #3380)", () => {
  it("queues a durable first-scan run joined on the new watchlist id when the bulk-accept production path creates it", async () => {
    const userId = await seedUser(uid("user"));
    const advertiser = `Acme Sneakers ${uid("adv")}`;

    const { result, dispatchError } = await bulkAcceptOneCandidate({
      workspaceUserId: userId,
      advertiser,
    });

    // The watchlist itself must exist no matter how the dispatch handoff
    // resolved — creation is the production path's own effect.
    const watchlist = await findCreatedWatchlist({ workspaceUserId: userId });
    expect(watchlist).not.toBeNull();
    expect(watchlist!.user_id).toBe(userId);
    expect(watchlist!.is_active).toBe(1);

    // In this integration env there is no MONITORING_WORKFLOW binding, so the
    // dispatch throws AFTER marking the durable dispatch failure. Either the
    // accept resolved (dispatch accepted) or rejected — but the queue must
    // have been called either way. What proves the wiring is the durable row:
    if (dispatchError instanceof Error) {
      expect(dispatchError.message).toContain("MONITORING_WORKFLOW binding is not configured");
      expect(result).toBeNull();
    }

    // THE mechanism assertion: the production creation path's OWN queue call
    // inserted the first-scan run, joined on the watchlist id. On origin/main
    // (no queueFirstWatchlistScan in the bulk-accept loop) no row exists here.
    const run = await readFirstScanRun(watchlist!.id);
    expect(run).not.toBeNull();
    expect(run!.watchlist_id).toBe(watchlist!.id);
    expect(run!.trigger_type).toBe("manual");
    expect(run!.idempotency_key).toBe(`watchlist-run:first-scan:${watchlist!.id}`);
    // Dispatch deferred to reconciliation: still queued, honestly marked.
    expect(run!.status).toBe("pending");
    expect(run!.error_code).toBe("workflow_binding_missing");
    expect(run!.has_workflow_instance).toBe(0);
  });

  it("executes the queued pickup without a Workflow binding and lands the honest all-quiet outcome", async () => {
    const userId = await seedUser(uid("user"));
    const advertiser = `Bolt Runners ${uid("adv")}`;

    await bulkAcceptOneCandidate({ workspaceUserId: userId, advertiser });

    // Precondition (the same mechanism as the first test): the production
    // path already queued the run before anything else in this test runs.
    const watchlistRow = await findCreatedWatchlist({ workspaceUserId: userId });
    expect(watchlistRow).not.toBeNull();
    const queued = await readFirstScanRun(watchlistRow!.id);
    expect(queued).not.toBeNull();
    expect(queued!.status).toBe("pending");

    const watchlist = await getWatchlist(appEnv, watchlistRow!.id, userId);
    expect(watchlist).not.toBeNull();
    expect(watchlist!.isActive).toBe(true);
    expect(watchlist!.lastScannedAt ?? null).toBeNull();

    // Execute the queue WITHOUT a Workflow binding: the compatibility helper
    // replays the Workflow step on the SAME durable run. The provider network
    // is denied (the local release-proof contract), so the scan must finish
    // honestly skipped — never fabricate ads, never lie about success.
    const deniedEnv = { ...appEnv, E2E_PROVIDER_NETWORK_DENY: "1" } as AppEnv;
    const executed = await processFirstWatchlistScanQueue(deniedEnv, watchlist!);
    expect(executed.status).toBe("skipped");
    expect(executed.runId).toBe(queued!.id);

    const finished = await db()
      .prepare(
        `SELECT status, summary_json, error_code, finished_at,
                workflow_instance_id IS NOT NULL AS has_workflow_instance
         FROM watchlist_run WHERE id = ?`,
      )
      .bind(queued!.id)
      .first<{
        status: string;
        summary_json: string;
        error_code: string | null;
        finished_at: string | null;
        has_workflow_instance: number;
      }>();
    expect(finished!.status).toBe("skipped");
    expect(finished!.finished_at).not.toBeNull();
    // The replay bound the deterministic Workflow identity on the same run.
    expect(finished!.has_workflow_instance).toBe(1);
    expect(finished!.error_code).toBe("e2e_provider_network_denied");
    const summary = JSON.parse(finished!.summary_json) as {
      scanStatus?: string;
      adsSeen?: number;
      events?: number;
    };
    expect(summary.scanStatus).toBe("e2e_provider_network_denied");
    expect(summary.adsSeen).toBe(0);
    expect(summary.events).toBe(0);

    // The digest layer's honest all-quiet heartbeat: with zero events and
    // zero evidence, the first-brief filing path must REFUSE to file —
    // "no_evidence" — and no phantom brief may exist for the workspace.
    const firstBrief = await maybeFileAndDeliverFirstBrief(deniedEnv, {
      watchlist: watchlist!,
      events: [],
      adsSeen: 0,
      observations: [],
      userDeliveryProfile: {
        email: `${userId}@example.test`,
        name: "Fixture",
      },
    });
    expect(firstBrief.reason).toBe("no_evidence");
    expect(firstBrief.filed).toBe(false);
    expect(firstBrief.delivered).toBe(false);
    expect(firstBrief.digestRunId).toBeNull();

    const digestCount = await db()
      .prepare(`SELECT COUNT(*) AS n FROM digest_run WHERE user_id = ?`)
      .bind(userId)
      .first<{ n: number }>();
    expect(digestCount?.n ?? 0).toBe(0);
  });
});

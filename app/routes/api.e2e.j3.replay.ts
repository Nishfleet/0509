import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import type { AppEnv } from "~/lib/env.server";

const J3_WORKFLOW_WATCHLIST_ID = "e2e-watchlist-j3-workflow";
const J3_CRASH_WATCHLIST_ID = "e2e-watchlist-j3-crash";
const J3_DELIVERY_DIGEST_ID = "e2e-digest-j3-provider-denied";
const J3_CRASH_RESERVATION_KEY = "e2e-j3-crash-reservation"; // gitleaks:allow -- fixture identifier.
const J3_RECONCILE_RESERVATION_KEY = "e2e-j3-reconcile-reservation"; // gitleaks:allow -- fixture identifier.
const J3_UNSUBSCRIBE_ATTEMPT_KEY = "e2e-j3-unsubscribe-attempt"; // gitleaks:allow -- fixture identifier.
const J3_RUN_HISTORY_WATCHLIST_ID = "e2e-watchlist-j3-runhistory";
const J3_RUN_HISTORY_RUN_ID = "e2e-run-j3-run-history";

// Run-history fixture targets (issue #1476): one target that captured
// cleanly and one that hit an anti-bot challenge. Their proofs belong to a
// watchlist the board never touches, so the run-history e2e owns the pair.
const J3_RUN_HISTORY_TARGETS = {
  succeeded: "e2e-proof-target-j3-runhistory-a",
  failed: "e2e-proof-target-j3-runhistory-b",
} as const;

type J3ReplayAction =
  | "workflow_accept"
  | "crash_reclaim"
  | "reconcile"
  | "delivery_denied"
  | "unsubscribe_cas"
  | "recover"
  | "run_history";

interface J3ReplayMapping {
  action: J3ReplayAction;
  userId: string;
  runId: string;
}

const J3_REPLAY_VIEWPORTS = ["375x812", "768x900", "1440x900"] as const;

const J3_REPLAY_ACTIONS: Readonly<Record<string, J3ReplayMapping>> = Object.freeze({
  "e2e-j3-workflow-accept": {
    action: "workflow_accept",
    userId: "e2e-starter",
    runId: "e2e-run-j3-workflow-accept",
  },
  "e2e-j3-crash-reclaim": {
    action: "crash_reclaim",
    userId: "e2e-starter",
    runId: "e2e-run-j3-crash-reclaim",
  },
  "e2e-j3-reconcile": {
    action: "reconcile",
    userId: "e2e-starter",
    runId: "e2e-run-j3-reconcile",
  },
  "e2e-j3-delivery-denied": {
    action: "delivery_denied",
    userId: "e2e-starter",
    runId: "e2e-run-j3-delivery-denied",
  },
  "e2e-j3-unsubscribe-cas": {
    action: "unsubscribe_cas",
    userId: "e2e-free",
    runId: "e2e-run-j3-unsubscribe-cas",
  },
  "e2e-j3-recover": {
    action: "recover",
    userId: "e2e-starter",
    runId: "e2e-run-j3-recover",
  },
  "e2e-j3-run-history": {
    action: "run_history",
    userId: "e2e-starter",
    runId: J3_RUN_HISTORY_RUN_ID,
  },
  ...Object.fromEntries(
    J3_REPLAY_VIEWPORTS.flatMap((viewport) => [
      [
        `e2e-j3-workflow-accept-monitoring-${viewport}`,
        {
          action: "workflow_accept",
          userId: "e2e-starter",
          runId: `e2e-run-j3-workflow-accept-monitoring-${viewport}`,
        },
      ],
      [
        `e2e-j3-crash-reclaim-monitoring-${viewport}`,
        {
          action: "crash_reclaim",
          userId: "e2e-starter",
          runId: `e2e-run-j3-crash-reclaim-monitoring-${viewport}`,
        },
      ],
      [
        `e2e-j3-reconcile-monitoring-${viewport}`,
        {
          action: "reconcile",
          userId: "e2e-starter",
          runId: `e2e-run-j3-reconcile-monitoring-${viewport}`,
        },
      ],
      [
        `e2e-j3-recover-monitoring-${viewport}`,
        {
          action: "recover",
          userId: "e2e-starter",
          runId: `e2e-run-j3-recover-monitoring-${viewport}`,
        },
      ],
      [
        `e2e-j3-delivery-denied-digest-${viewport}`,
        {
          action: "delivery_denied",
          userId: "e2e-starter",
          runId: `e2e-run-j3-delivery-denied-digest-${viewport}`,
        },
      ],
      [
        `e2e-j3-unsubscribe-cas-digest-${viewport}`,
        {
          action: "unsubscribe_cas",
          userId: "e2e-free",
          runId: `e2e-run-j3-unsubscribe-cas-digest-${viewport}`,
        },
      ],
      [
        `e2e-j3-recover-digest-${viewport}`,
        {
          action: "recover",
          userId: "e2e-starter",
          runId: `e2e-run-j3-recover-digest-${viewport}`,
        },
      ],
    ]),
  ),
});

interface RunStateRow {
  id: string;
  status: string;
  attempt_count: number;
  workflow_instance_id: string | null;
  processing_token: string | null;
  error_code: string | null;
}

interface ReservationStateRow {
  status: string;
  owner_run_id: string | null;
  owner_processing_token: string | null;
}

interface AccountRow {
  email: string;
  name: string | null;
  emailVerified: number | string | null;
}

interface ReplayStateRow {
  action: J3ReplayAction;
  user_id: string;
  run_id: string;
  status: "started" | "succeeded";
  processing_token: string;
  result_json: string | null;
  updated_at: string;
}

export function loader(_args: LoaderFunctionArgs) {
  return notFound();
}

export function resolveJ3ReplayAction(idempotencyKey: string, userId: string, runId: string) {
  const resolved = J3_REPLAY_ACTIONS[idempotencyKey];
  return resolved?.userId === userId && resolved.runId === runId
    ? resolved.action
    : null;
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const [{ resolveE2EProviderDeny, sanitizeE2EProviderEnv }, { isE2ETestRequestEnabled }, guardModule] =
    await Promise.all([
      import("~/lib/e2e-provider.server"),
      import("~/lib/e2e-auth.server"),
      import("~/lib/e2e-harness-guard.server"),
    ]);

  const networkDeny = await resolveE2EProviderDeny(env, request);
  const testModeEnabled = await isE2ETestRequestEnabled(env, request);
  const guarded = await guardModule.guardE2EHarnessReplayRequest(request, {
    networkDeny,
    testMode: {
      enabled: testModeEnabled,
      sentinel: networkDeny.enabled && networkDeny.failClosed,
    },
  });
  if (!guarded.ok || guarded.metadata.scenario !== "j3") return notFound();

  const replayAction = resolveJ3ReplayAction(
    guarded.metadata.idempotencyKey,
    guarded.metadata.userId,
    guarded.metadata.runId,
  );
  if (!replayAction || !env.DB) return notFound();

  const replayEnv = sanitizeE2EProviderEnv(env);
  try {
    const claim = await claimReplayAction(replayEnv, replayAction, guarded.metadata);
    if (claim.replayed) {
      return noStoreJson({ ok: true, replayed: true, ...claim.result });
    }
    const result = await runJ3ReplayAction(replayEnv, replayAction, guarded.metadata);
    await completeReplayAction(replayEnv, guarded.metadata.idempotencyKey, claim.processingToken, result);
    return noStoreJson({ ok: true, replayed: false, ...result });
  } catch {
    return noStoreJson({ ok: false, blocker: "j3_replay_failed" }, 503);
  }
}

async function runJ3ReplayAction(
  env: AppEnv,
  replayAction: J3ReplayAction,
  metadata: { userId: string; runId: string; idempotencyKey: string; clock: string },
) {
  switch (replayAction) {
    case "workflow_accept":
      return runWorkflowAcceptance(env, metadata.userId);
    case "crash_reclaim":
      return runCrashReclaim(env, metadata.userId, metadata.clock);
    case "reconcile":
      return runReservationReconciliation(env, metadata.userId, metadata.clock);
    case "delivery_denied":
      return runProviderDeniedDelivery(env, metadata.userId, metadata.clock);
    case "unsubscribe_cas":
      return runUnsubscribeCas(env, metadata.userId, metadata.clock);
    case "recover":
      return runRecoveryCleanup(env, metadata.userId);
    case "run_history":
      return runRunHistorySeed(env, metadata.userId, metadata.clock);
  }
}

/**
 * Seed the run-history fixture for issue #1476's e2e: one succeeded capture
 * and one `capture_failed` capture (internal failure code
 * `landing_challenge_page` -> public `cloudflare_challenge`) inside a single
 * latest run for a dedicated watchlist. Deterministic on retry: the action
 * deletes its own rows before inserting, and the replay ledger makes the
 * duplicate POST a no-op.
 */
async function runRunHistorySeed(env: AppEnv, userId: string, clock: string) {
  const db = ensureDb(env);
  const user = await db
    .prepare("SELECT id FROM user WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<{ id: string }>();
  if (!user) throw new Error("fixture_user_unavailable");

  const watchlistId = J3_RUN_HISTORY_WATCHLIST_ID;
  const targetSucceeded = J3_RUN_HISTORY_TARGETS.succeeded;
  const targetFailed = J3_RUN_HISTORY_TARGETS.failed;
  const captureSucceeded = `e2e-proof-capture-j3-runhistory-a`;
  const captureFailed = `e2e-proof-capture-j3-runhistory-b`;
  const startedAt = isoMinusMinutes(clock, 12);
  const finishedAt = isoMinusMinutes(clock, 5);
  const succeededAt = isoMinusMinutes(clock, 6);
  const failedAttemptedAt = isoMinusMinutes(clock, 8);

  await db.batch([
    // Child rows first so the deletes are foreign-key safe whether the
    // connection enforces them or not.
    db.prepare(
      `DELETE FROM proof_capture
       WHERE proof_target_id IN (
         SELECT target.id FROM proof_target target WHERE target.watchlist_id = ?
       )`,
    ).bind(watchlistId),
    db.prepare("DELETE FROM proof_target WHERE watchlist_id = ?").bind(watchlistId),
    db.prepare("DELETE FROM watchlist_run WHERE watchlist_id = ?").bind(watchlistId),
    db.prepare("DELETE FROM watchlist WHERE id = ?").bind(watchlistId),
  ]);

  await db.batch([
    db.prepare(
      `INSERT INTO watchlist (
         id, user_id, name, target_type, target_id, target_fingerprint,
         target_label, is_active, last_scanned_at, created_at, updated_at,
         paused_reason, target_country, tracking_role
       ) VALUES (?, ?, ?, 'saved_query', ?, ?, ?, 1, ?, ?, ?, NULL, 'IN', 'competitor')`,
    ).bind(
      watchlistId,
      userId,
      "Run history fixture",
      `e2e-query-j3-runhistory`,
      `e2e-query-j3-runhistory`,
      "Okara",
      finishedAt,
      isoMinusMinutes(clock, 24 * 60),
      finishedAt,
    ),
    db.prepare(
      `INSERT INTO proof_target (
         id, watchlist_id, ad_id, landing_page_url, canonical_page_identity,
         proof_target_identity, last_capture_attempt_at, last_successful_proof_at,
         last_successful_capture_id, created_at, updated_at
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      targetSucceeded,
      watchlistId,
      "https://okara.example.invalid/launch",
      "okara.example.invalid/launch",
      targetSucceeded,
      succeededAt,
      succeededAt,
      captureSucceeded,
      isoMinusMinutes(clock, 24 * 60),
      succeededAt,
    ),
    db.prepare(
      `INSERT INTO proof_target (
         id, watchlist_id, ad_id, landing_page_url, canonical_page_identity,
         proof_target_identity, last_capture_attempt_at, last_successful_proof_at,
         last_successful_capture_id, created_at, updated_at
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    ).bind(
      targetFailed,
      watchlistId,
      "https://okara.example.invalid/checkout",
      "okara.example.invalid/checkout",
      targetFailed,
      failedAttemptedAt,
      isoMinusMinutes(clock, 24 * 60),
      failedAttemptedAt,
    ),
    db.prepare(
      `INSERT INTO proof_capture (
         id, proof_target_id, status, skip_reason, failure_code, failure_reason,
         screenshot_artifact_key, html_artifact_key, extracted_fields_json,
         field_confidence_json, extraction_warnings_json, capture_metadata_json,
         render_mode, device_profile, extractor_version, idempotency_key,
         attempted_at, succeeded_at, created_at, updated_at
       ) VALUES (?, ?, 'succeeded', NULL, NULL, NULL, NULL, NULL, ?, '{}', '[]',
         ?, 'mobile', 'mobile_default', 'e2e-v1', ?, ?, ?, ?, ?)`,
    ).bind(
      captureSucceeded,
      targetSucceeded,
      '{"headline":"Workflow offer","cta":"Learn more","offer":"Free trial"}',
      '{"source":"e2e-j3-run-history"}',
      `e2e-proof-capture-j3-runhistory-a`,
      isoMinusMinutes(clock, 7),
      succeededAt,
      isoMinusMinutes(clock, 7),
      succeededAt,
    ),
    db.prepare(
      `INSERT INTO proof_capture (
         id, proof_target_id, status, skip_reason, failure_code, failure_reason,
         screenshot_artifact_key, html_artifact_key, extracted_fields_json,
         field_confidence_json, extraction_warnings_json, capture_metadata_json,
         render_mode, device_profile, extractor_version, idempotency_key,
         attempted_at, succeeded_at, created_at, updated_at
       ) VALUES (?, ?, 'failed', NULL, ?, ?, NULL, NULL, '{}', '{}', '[]',
         ?, 'mobile', 'mobile_default', 'e2e-v1', ?, ?, NULL, ?, ?)`,
    ).bind(
      captureFailed,
      targetFailed,
      "landing_challenge_page",
      "Page served a challenge during capture.",
      '{"source":"e2e-j3-run-history"}',
      `e2e-proof-capture-j3-runhistory-b`,
      failedAttemptedAt,
      failedAttemptedAt,
      failedAttemptedAt,
    ),
    db.prepare(
      `INSERT INTO watchlist_run (
         id, watchlist_id, trigger_type, status, page_budget, pages_scanned,
         baseline_from_run_id, summary_json, started_at, finished_at,
         error_code, error_message, created_at, updated_at, idempotency_key
       ) VALUES (?, ?, 'scheduled', 'succeeded', 4, 2, NULL, ?, ?, ?,
         NULL, NULL, ?, ?, ?)`,
    ).bind(
      J3_RUN_HISTORY_RUN_ID,
      watchlistId,
      '{"scanStatus":"healthy","attempts":2,"failed":1}',
      startedAt,
      finishedAt,
      startedAt,
      finishedAt,
      J3_RUN_HISTORY_RUN_ID,
    ),
  ]);

  const attempts = await db
    .prepare(
      `SELECT capture.status, capture.failure_code
       FROM proof_capture capture
       JOIN proof_target target ON target.id = capture.proof_target_id
       WHERE target.watchlist_id = ?
       ORDER BY capture.attempted_at ASC`,
    )
    .bind(watchlistId)
    .all<{ status: string; failure_code: string | null }>();
  const rows = attempts.results ?? [];
  const failedCaptures = rows.filter((row) => row.status === "failed").length;
  if (rows.length !== 2 || failedCaptures !== 1) {
    throw new Error("run_history_fixture_mismatch");
  }

  return {
    action: "run_history",
    watchlistId,
    runId: J3_RUN_HISTORY_RUN_ID,
    attempts: rows.length,
    failedCaptures,
    internalFailureCode: rows.find((row) => row.status === "failed")?.failure_code ?? null,
  };
}

function isoMinusMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) - minutes * 60_000).toISOString();
}

async function runWorkflowAcceptance(env: AppEnv, userId: string) {
  const [{ getWatchlist }, monitoring, fanout] = await Promise.all([
    import("~/lib/data.server"),
    import("~/lib/monitoring.server"),
    import("~/lib/monitoring-fanout.server"),
  ]);
  const watchlist = await getWatchlist(env, J3_WORKFLOW_WATCHLIST_ID, userId);
  if (!watchlist || watchlist.lastScannedAt) throw new Error("workflow_watchlist_unavailable");

  const descriptor = await monitoring.prepareFirstWatchlistScanRun(env, watchlist);
  const dispatch = await fanout.dispatchFirstWatchlistScanWorkflow(env, descriptor);
  const state = await readRunState(env, descriptor.runId);
  if (!state?.workflow_instance_id) throw new Error("workflow_not_bound");
  if (!env.MONITORING_WORKFLOW) throw new Error("workflow_binding_missing");
  const workflowStatus = await (
    await env.MONITORING_WORKFLOW.get(state.workflow_instance_id)
  ).status();
  if (!isWorkflowAcceptanceStatus(workflowStatus.status)) {
    throw new Error("workflow_not_accepted");
  }

  return {
    action: "workflow_accept",
    workflowAccepted: true,
    dispatchState: dispatch.status,
    workflowStatus: workflowStatus.status,
    run: publicRunState(state),
  };
}

async function runCrashReclaim(env: AppEnv, userId: string, clock: string) {
  const [{ getWatchlist }, monitoring, fanout, evidence] = await Promise.all([
    import("~/lib/data.server"),
    import("~/lib/monitoring.server"),
    import("~/lib/monitoring-fanout.server"),
    import("~/lib/evidence-usage.server"),
  ]);
  const watchlist = await getWatchlist(env, J3_CRASH_WATCHLIST_ID, userId);
  if (!watchlist || watchlist.lastScannedAt) throw new Error("crash_watchlist_unavailable");

  const usageBefore = await evidence.getEvidenceUsageSummary(env, userId);
  const existingReservation = await readReservationState(env, J3_CRASH_RESERVATION_KEY);
  let runId: string;
  let firstProcessingToken: string;
  if (existingReservation?.status === "pending" && existingReservation.owner_run_id) {
    const existingRun = await readRunState(env, existingReservation.owner_run_id);
    if (!existingRun || existingRun.status !== "running" || !existingRun.processing_token) {
      throw new Error("incomplete_crash_replay");
    }
    if (existingRun.processing_token !== existingReservation.owner_processing_token) {
      const recoveredReservation = await evidence.reserveEvidenceCheck(env, {
        workspaceUserId: userId,
        logicalOperationKey: J3_CRASH_RESERVATION_KEY,
        source: "e2e_j3_crash_reclaim",
        now: clock,
        lease: { runId: existingRun.id, processingToken: existingRun.processing_token },
      });
      if (!recoveredReservation.ok) throw new Error("crash_reservation_recovery_failed");
    }
    if (Number(existingRun.attempt_count) >= 2) {
      const recoveredUsage = await evidence.getEvidenceUsageSummary(env, userId);
      return {
        action: "crash_reclaim",
        staleOwnerRejected: true,
        reservationAdopted: true,
        includedUsedBefore: usageBefore.includedUsed,
        includedUsedAfter: recoveredUsage.includedUsed,
        run: publicRunState(existingRun),
      };
    }
    runId = existingRun.id;
    firstProcessingToken = existingRun.processing_token;
  } else {
    const descriptor = await monitoring.prepareFirstWatchlistScanRun(env, watchlist);
    runId = descriptor.runId;
    const firstClaim = await fanout.claimOrchestratedWatchlistRun(env, {
      runId,
      leaseMs: 1_000,
      maxAttempts: 3,
    });
    if (!firstClaim.claimed) throw new Error("first_claim_failed");
    firstProcessingToken = firstClaim.processingToken;

    const firstReservation = await evidence.reserveEvidenceCheck(env, {
      workspaceUserId: userId,
      logicalOperationKey: J3_CRASH_RESERVATION_KEY,
      source: "e2e_j3_crash_reclaim",
      now: clock,
      lease: { runId, processingToken: firstProcessingToken },
    });
    if (!firstReservation.ok) throw new Error("first_reservation_failed");
  }

  const staleAt = new Date(Date.parse(clock) - 10 * 60_000).toISOString();
  const aged = await ensureDb(env)
    .prepare(
      `UPDATE watchlist_run
       SET processing_started_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running' AND processing_token = ?`,
    )
    .bind(staleAt, staleAt, runId, firstProcessingToken)
    .run();
  if (Number(aged.meta?.changes ?? 0) !== 1) throw new Error("crash_injection_failed");

  const successor = await fanout.claimOrchestratedWatchlistRun(env, {
    runId,
    leaseMs: 1_000,
    maxAttempts: 3,
  });
  if (!successor.claimed) throw new Error("reclaim_failed");

  const staleOwnerFinalized = await fanout.finishOrchestratedWatchlistRun(env, {
    runId,
    processingToken: firstProcessingToken,
    status: "failed",
    pagesScanned: 0,
    summary: { scanStatus: "stale_owner" },
    errorCode: "stale_owner",
    errorMessage: "A stale local replay owner attempted to finalize the run.",
  });
  const adopted = await evidence.reserveEvidenceCheck(env, {
    workspaceUserId: userId,
    logicalOperationKey: J3_CRASH_RESERVATION_KEY,
    source: "e2e_j3_crash_reclaim",
    now: clock,
    lease: { runId, processingToken: successor.processingToken },
  });
  const state = await readRunState(env, runId);
  const reservation = await readReservationState(env, J3_CRASH_RESERVATION_KEY);
  const usageAfter = await evidence.getEvidenceUsageSummary(env, userId);
  if (!adopted.ok || !state) throw new Error("reservation_adoption_failed");
  if (
    state.attempt_count < 2 ||
    !state.processing_token ||
    reservation?.owner_processing_token !== state.processing_token
  ) {
    throw new Error("reservation_owner_mismatch");
  }

  return {
    action: "crash_reclaim",
    staleOwnerRejected: staleOwnerFinalized === false,
    reservationAdopted: true,
    includedUsedBefore: usageBefore.includedUsed,
    includedUsedAfter: usageAfter.includedUsed,
    run: publicRunState(state),
  };
}

async function runReservationReconciliation(env: AppEnv, userId: string, clock: string) {
  const evidence = await import("~/lib/evidence-usage.server");
  const current = await readReservationState(env, J3_RECONCILE_RESERVATION_KEY);
  if (!current) {
    const staleReservationTime = new Date(Date.parse(clock) - 16 * 60_000).toISOString();
    const reserved = await evidence.reserveEvidenceCheck(env, {
      workspaceUserId: userId,
      logicalOperationKey: J3_RECONCILE_RESERVATION_KEY,
      source: "e2e_j3_reconcile",
      now: staleReservationTime,
    });
    if (!reserved.ok) throw new Error("stale_reservation_setup_failed");
  }

  const released = await evidence.reconcileStaleEvidenceReservations(env, clock);
  const state = await readReservationState(env, J3_RECONCILE_RESERVATION_KEY);
  const usage = await evidence.getEvidenceUsageSummary(env, userId);
  if (state?.status !== "released") throw new Error("stale_reservation_not_released");
  return {
    action: "reconcile",
    released: released > 0 || state.status === "released",
    reservationStatus: state.status,
    includedUsed: usage.includedUsed,
  };
}

async function runProviderDeniedDelivery(env: AppEnv, userId: string, clock: string) {
  const account = await ensureDb(env)
    .prepare("SELECT email, name, emailVerified FROM user WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<AccountRow>();
  if (!account || !(account.emailVerified === 1 || account.emailVerified === "1")) {
    throw new Error("verified_account_required");
  }

  const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
  await deliverWeeklyDigest(env, {
    userId,
    userName: account.name ?? "E2E workspace",
    accountEmail: account.email,
    digestRunId: J3_DELIVERY_DIGEST_ID,
    periodStart: new Date(Date.parse(clock) - 8 * 24 * 60 * 60_000).toISOString(),
    periodEnd: new Date(Date.parse(clock) - 24 * 60 * 60_000).toISOString(),
    cadence: "weekly",
    items: [
      {
        eventId: "e2e-event-confirmed",
        eventType: "ad_new",
        watchlistId: "e2e-watchlist-starter-1",
        watchlistName: "Okara competitor watch",
        title: "Okara launched a new workflow offer",
        summary: "Fixture confirmed proof-backed event.",
        metadata: { source: "verified_proof" },
      },
    ],
  });

  const rows = await ensureDb(env)
    .prepare(
      `SELECT status, webhook_status, target_value
       FROM delivery_attempt
       WHERE user_id = ? AND digest_run_id = ? AND channel = 'email'
       ORDER BY created_at ASC`,
    )
    .bind(userId, J3_DELIVERY_DIGEST_ID)
    .all<{ status: string; webhook_status: string; target_value: string }>();
  const attempts = rows.results ?? [];
  if (attempts.length !== 1) throw new Error("delivery_attempt_count_mismatch");
  const attempt = attempts[0]!;
  if (
    attempt.status !== "failed" ||
    attempt.webhook_status !== "failed" ||
    attempt.target_value.trim().toLowerCase() !== account.email.trim().toLowerCase()
  ) {
    throw new Error("provider_denial_not_preserved");
  }
  return {
    action: "delivery_denied",
    providerCalled: false,
    verifiedRecipientBound: true,
    attemptCount: attempts.length,
    status: attempt.status,
    webhookStatus: attempt.webhook_status,
  };
}

async function runUnsubscribeCas(env: AppEnv, userId: string, clock: string) {
  const account = await ensureDb(env)
    .prepare("SELECT email, name, emailVerified FROM user WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<AccountRow>();
  if (!account || !(account.emailVerified === 1 || account.emailVerified === "1")) {
    throw new Error("verified_account_required");
  }

  const data = await import("~/lib/data.server");
  const baseline = await ensureDb(env)
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM delivery_target
          WHERE user_id = ? AND channel = 'email' AND lower(trim(target_value)) = lower(trim(?))) AS target_count,
         (SELECT COUNT(*) FROM delivery_attempt
          WHERE user_id = ? AND idempotency_key = ?) AS attempt_count`,
    )
    .bind(userId, account.email, userId, J3_UNSUBSCRIBE_ATTEMPT_KEY)
    .first<{ target_count: number; attempt_count: number }>();
  if (Number(baseline?.target_count ?? -1) !== 0 || Number(baseline?.attempt_count ?? -1) !== 0) {
    throw new Error("unsubscribe_fixture_not_clean");
  }
  const target = await data.upsertDeliveryTarget(env, {
    userId,
    watchlistId: null,
    channel: "email",
    targetValue: account.email,
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    optInSource: "e2e_j3_replay",
    optedInAt: clock,
    isPaused: false,
    metadata: { fixtureReplay: true },
  });
  if (!target) throw new Error("target_setup_failed");

  let attempt = await ensureDb(env)
    .prepare("SELECT id, updated_at FROM delivery_attempt WHERE idempotency_key = ? LIMIT 1")
    .bind(J3_UNSUBSCRIBE_ATTEMPT_KEY)
    .first<{ id: string; updated_at: string }>();
  if (!attempt) {
    const attemptId = await data.createDeliveryAttempt(env, {
      userId,
      watchlistId: null,
      digestRunId: null,
      deliveryTargetId: target.id,
      lane: "customer",
      channel: "email",
      provider: "cloudflare_email",
      status: "pending",
      webhookStatus: "pending",
      targetValue: account.email,
      idempotencyKey: J3_UNSUBSCRIBE_ATTEMPT_KEY,
      timestamp: clock,
    });
    attempt = { id: attemptId, updated_at: clock };
  }

  const suppressed = await data.suppressEmailTargetsForUserAndAddress(env, {
    userId,
    targetValue: account.email,
    source: "e2e_j3_unsubscribe",
  });
  const dispatchStarted = await data.markInstantDeliveryDispatchStarted(
    env,
    attempt.id,
    attempt.updated_at,
  );
  const final = await ensureDb(env)
    .prepare("SELECT status, webhook_status FROM delivery_attempt WHERE id = ? LIMIT 1")
    .bind(attempt.id)
    .first<{ status: string; webhook_status: string }>();

  await ensureDb(env).batch([
    ensureDb(env).prepare("DELETE FROM delivery_attempt WHERE id = ? AND user_id = ?").bind(attempt.id, userId),
    ensureDb(env).prepare("DELETE FROM delivery_target WHERE id = ? AND user_id = ?").bind(target.id, userId),
  ]);
  if (suppressed !== 1 || dispatchStarted !== null || final?.status !== "failed") {
    throw new Error("unsubscribe_cas_failed");
  }
  const remaining = await ensureDb(env)
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM delivery_target
          WHERE user_id = ? AND channel = 'email' AND lower(trim(target_value)) = lower(trim(?))) AS target_count,
         (SELECT COUNT(*) FROM delivery_attempt
          WHERE user_id = ? AND idempotency_key = ?) AS attempt_count`,
    )
    .bind(userId, account.email, userId, J3_UNSUBSCRIBE_ATTEMPT_KEY)
    .first<{ target_count: number; attempt_count: number }>();
  if (Number(remaining?.target_count ?? -1) !== 0 || Number(remaining?.attempt_count ?? -1) !== 0) {
    throw new Error("unsubscribe_cleanup_failed");
  }
  return {
    action: "unsubscribe_cas",
    unsubscribeWon: true,
    dispatchStarted: false,
    attemptStatus: final.status,
    cleanupVerified: true,
  };
}

async function runRecoveryCleanup(env: AppEnv, userId: string) {
  const [fanout, evidence] = await Promise.all([
    import("~/lib/monitoring-fanout.server"),
    import("~/lib/evidence-usage.server"),
  ]);
  const crashReservation = await readReservationState(env, J3_CRASH_RESERVATION_KEY);
  if (
    crashReservation?.status === "pending" &&
    crashReservation.owner_run_id &&
    crashReservation.owner_processing_token
  ) {
    const currentRun = await readRunState(env, crashReservation.owner_run_id);
    const activeProcessingToken = currentRun?.status === "running" && currentRun.processing_token
      ? currentRun.processing_token
      : crashReservation.owner_processing_token;
    if (activeProcessingToken !== crashReservation.owner_processing_token) {
      const adopted = await evidence.reserveEvidenceCheck(env, {
        workspaceUserId: userId,
        logicalOperationKey: J3_CRASH_RESERVATION_KEY,
        source: "e2e_j3_crash_reclaim",
        lease: {
          runId: crashReservation.owner_run_id,
          processingToken: activeProcessingToken,
        },
      });
      if (!adopted.ok) throw new Error("recovery_reservation_adoption_failed");
    }
    const released = await evidence.releaseEvidenceReservation(env, J3_CRASH_RESERVATION_KEY, {
      runId: crashReservation.owner_run_id,
      processingToken: activeProcessingToken,
    });
    if (!released) throw new Error("recovery_reservation_release_failed");
    await fanout.finishOrchestratedWatchlistRun(env, {
      runId: crashReservation.owner_run_id,
      processingToken: activeProcessingToken,
      status: "failed",
      pagesScanned: 0,
      summary: { scanStatus: "recovered_after_injected_crash" },
      errorCode: "e2e_injected_crash_recovered",
      errorMessage: "The local release replay reconciled the injected crash.",
    });
  }

  const reconcileReservation = await readReservationState(env, J3_RECONCILE_RESERVATION_KEY);
  if (
    reconcileReservation?.status === "pending" &&
    !reconcileReservation.owner_run_id &&
    !reconcileReservation.owner_processing_token
  ) {
    await evidence.releaseEvidenceReservation(env, J3_RECONCILE_RESERVATION_KEY);
  }

  for (const run of await readReplayWatchlistRuns(env)) {
    if (run.status === "running" && run.processing_token) {
      await fanout.finishOrchestratedWatchlistRun(env, {
        runId: run.id,
        processingToken: run.processing_token,
        status: "failed",
        pagesScanned: 0,
        summary: { scanStatus: "e2e_cleanup" },
        errorCode: "e2e_cleanup",
        errorMessage: "The local release replay reconciled its Workflow run.",
      });
    } else if (run.status === "pending") {
      await fanout.markOrchestratedRunCancelled(env, {
        runId: run.id,
        reason: "e2e_cleanup",
        message: "The local release replay cancelled its pending Workflow run.",
      });
    }
  }

  const db = ensureDb(env);
  await db.batch([
    db.prepare("DELETE FROM delivery_attempt WHERE user_id = ? AND digest_run_id = ?").bind(userId, J3_DELIVERY_DIGEST_ID),
    db.prepare("DELETE FROM delivery_attempt WHERE idempotency_key = ?").bind(J3_UNSUBSCRIBE_ATTEMPT_KEY),
    db.prepare("DELETE FROM delivery_target WHERE user_id = 'e2e-free' AND opt_in_source = 'e2e_j3_replay'"),
    db.prepare("DELETE FROM digest_delivery WHERE digest_run_id = ?").bind(J3_DELIVERY_DIGEST_ID),
    db.prepare("DELETE FROM evidence_usage_reservation WHERE logical_operation_key IN (?, ?) AND status = 'released'")
      .bind(J3_CRASH_RESERVATION_KEY, J3_RECONCILE_RESERVATION_KEY),
    db.prepare(
      `DELETE FROM watchlist_run
       WHERE watchlist_id IN (?, ?)
         AND idempotency_key LIKE 'watchlist-run:first-scan:%'
         AND status NOT IN ('pending', 'running')`,
    ).bind(J3_WORKFLOW_WATCHLIST_ID, J3_CRASH_WATCHLIST_ID),
  ]);

  const remaining = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM delivery_attempt WHERE user_id = ? AND digest_run_id = ?) AS delivery_count,
        (SELECT COUNT(*) FROM delivery_attempt WHERE idempotency_key = ?) AS unsubscribe_attempt_count,
        (SELECT COUNT(*) FROM delivery_target WHERE user_id = 'e2e-free' AND opt_in_source = 'e2e_j3_replay') AS unsubscribe_target_count,
        (SELECT COUNT(*) FROM digest_delivery WHERE digest_run_id = ?) AS digest_delivery_count,
        (SELECT COUNT(*) FROM evidence_usage_reservation WHERE logical_operation_key IN (?, ?)) AS reservation_count,
        (SELECT COUNT(*) FROM watchlist_run WHERE watchlist_id IN (?, ?) AND idempotency_key LIKE 'watchlist-run:first-scan:%') AS run_count`,
    )
    .bind(
      userId,
      J3_DELIVERY_DIGEST_ID,
      J3_UNSUBSCRIBE_ATTEMPT_KEY,
      J3_DELIVERY_DIGEST_ID,
      J3_CRASH_RESERVATION_KEY,
      J3_RECONCILE_RESERVATION_KEY,
      J3_WORKFLOW_WATCHLIST_ID,
      J3_CRASH_WATCHLIST_ID,
    )
    .first<{
      delivery_count: number;
      unsubscribe_attempt_count: number;
      unsubscribe_target_count: number;
      digest_delivery_count: number;
      reservation_count: number;
      run_count: number;
    }>();
  const usage = await evidence.getEvidenceUsageSummary(env, userId);
  const cleanupVerified =
    Number(remaining?.delivery_count ?? -1) === 0 &&
    Number(remaining?.unsubscribe_attempt_count ?? -1) === 0 &&
    Number(remaining?.unsubscribe_target_count ?? -1) === 0 &&
    Number(remaining?.digest_delivery_count ?? -1) === 0 &&
    Number(remaining?.reservation_count ?? -1) === 0 &&
    Number(remaining?.run_count ?? -1) === 0;
  if (!cleanupVerified) throw new Error("j3_cleanup_incomplete");
  return {
    action: "recover",
    cleanupVerified,
    includedUsed: usage.includedUsed,
  };
}

async function claimReplayAction(
  env: AppEnv,
  action: J3ReplayAction,
  metadata: { userId: string; runId: string; idempotencyKey: string },
) {
  const db = ensureDb(env);
  const processingToken = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO e2e_j3_replay (
         idempotency_key, action, user_id, run_id, status, processing_token,
         result_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'started', ?, NULL, ?, ?)
       ON CONFLICT(idempotency_key) DO NOTHING`,
    )
    .bind(
      metadata.idempotencyKey,
      action,
      metadata.userId,
      metadata.runId,
      processingToken,
      timestamp,
      timestamp,
    )
    .run();

  let row = await readReplayState(env, metadata.idempotencyKey);
  if (
    !row ||
    row.action !== action ||
    row.user_id !== metadata.userId ||
    row.run_id !== metadata.runId
  ) {
    throw new Error("replay_identity_conflict");
  }
  if (row.status === "succeeded") {
    const result = parseReplayResult(row.result_json);
    return { replayed: true as const, processingToken: row.processing_token, result };
  }
  if (row.processing_token === processingToken) {
    return { replayed: false as const, processingToken, result: null };
  }

  const staleBefore = new Date(Date.now() - 30_000).toISOString();
  const reclaimed = await db
    .prepare(
      `UPDATE e2e_j3_replay
       SET processing_token = ?, updated_at = ?
       WHERE idempotency_key = ?
         AND status = 'started'
         AND processing_token = ?
         AND updated_at <= ?`,
    )
    .bind(
      processingToken,
      timestamp,
      metadata.idempotencyKey,
      row.processing_token,
      staleBefore,
    )
    .run();
  if (Number(reclaimed.meta?.changes ?? 0) !== 1) {
    throw new Error("replay_in_progress");
  }
  row = await readReplayState(env, metadata.idempotencyKey);
  if (row?.processing_token !== processingToken) throw new Error("replay_reclaim_failed");
  return { replayed: false as const, processingToken, result: null };
}

async function completeReplayAction(
  env: AppEnv,
  idempotencyKey: string,
  processingToken: string,
  result: Record<string, unknown>,
) {
  const resultJson = JSON.stringify(result);
  if (resultJson.length > 8_192) throw new Error("replay_result_too_large");
  const completed = await ensureDb(env)
    .prepare(
      `UPDATE e2e_j3_replay
       SET status = 'succeeded', result_json = ?, updated_at = ?
       WHERE idempotency_key = ?
         AND status = 'started'
         AND processing_token = ?`,
    )
    .bind(resultJson, new Date().toISOString(), idempotencyKey, processingToken)
    .run();
  if (Number(completed.meta?.changes ?? 0) !== 1) {
    throw new Error("replay_completion_lost");
  }
}

async function readReplayState(env: AppEnv, idempotencyKey: string) {
  return ensureDb(env)
    .prepare(
      `SELECT action, user_id, run_id, status, processing_token, result_json, updated_at
       FROM e2e_j3_replay WHERE idempotency_key = ? LIMIT 1`,
    )
    .bind(idempotencyKey)
    .first<ReplayStateRow>();
}

function parseReplayResult(value: string | null) {
  if (!value || value.length > 8_192) throw new Error("invalid_replay_result");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("invalid_replay_result");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_replay_result");
  }
  return parsed as Record<string, unknown>;
}

function ensureDb(env: AppEnv) {
  if (!env.DB) throw new Error("missing_db");
  return env.DB;
}

async function readRunState(env: AppEnv, runId: string) {
  return ensureDb(env)
    .prepare(
      `SELECT id, status, attempt_count, workflow_instance_id, processing_token, error_code
       FROM watchlist_run WHERE id = ? LIMIT 1`,
    )
    .bind(runId)
    .first<RunStateRow>();
}

async function readReplayWatchlistRuns(env: AppEnv) {
  const rows = await ensureDb(env)
    .prepare(
      `SELECT id, status, attempt_count, workflow_instance_id, processing_token, error_code
       FROM watchlist_run
       WHERE watchlist_id IN (?, ?)
         AND idempotency_key LIKE 'watchlist-run:first-scan:%'
       ORDER BY created_at ASC`,
    )
    .bind(J3_WORKFLOW_WATCHLIST_ID, J3_CRASH_WATCHLIST_ID)
    .all<RunStateRow>();
  return rows.results ?? [];
}

async function readReservationState(env: AppEnv, logicalOperationKey: string) {
  return ensureDb(env)
    .prepare(
      `SELECT status, owner_run_id, owner_processing_token
       FROM evidence_usage_reservation WHERE logical_operation_key = ? LIMIT 1`,
    )
    .bind(logicalOperationKey)
    .first<ReservationStateRow>();
}

function publicRunState(row: RunStateRow) {
  return {
    status: row.status,
    attemptCount: Number(row.attempt_count),
    workflowBound: Boolean(row.workflow_instance_id),
    errorCode: row.error_code,
  };
}

export function isWorkflowAcceptanceStatus(status: string) {
  return status === "queued" ||
    status === "running" ||
    status === "paused" ||
    status === "complete" ||
    status === "waiting" ||
    status === "waitingForPause";
}

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function notFound() {
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

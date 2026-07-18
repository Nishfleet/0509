import { ensureDb, queryAll, queryOne } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import { deleteProofArtifactsForCapture } from "~/lib/proof-artifact-retention.server";

const CANARY_KIND = "launch_readiness_canary";
const CANARY_CAPTURE_KIND = "launch_readiness_real_capture";
const CANARY_PROOF_URL = "https://0509.io/";
const CANARY_EVENT_TITLE = "Launch readiness canary";
const CANARY_EVENT_SUMMARY =
  "Private canary verified the monitoring, proof, and digest delivery pipeline.";
const cleanupLocks = new WeakMap<object, Promise<void>>();

interface LaunchCanaryCleanupIdentifiers {
  ownerUserId: string;
  runId: string;
  proofCaptureId: string;
  digestRunId: string;
}

export type LaunchCanaryCleanupInput =
  | LaunchCanaryCleanupIdentifiers
  | { ownerUserId: string; gateRunId: string };

export interface LaunchCanaryCleanupResult {
  cleaned: boolean;
  reason?: "not_found_or_not_canary" | "shared_rows_present" | "artifact_cleanup_incomplete";
  preservedProofCaptureId: string | null;
  deleted: {
    deliveryAttempts: number;
    digestDeliveries: number;
    digestItems: number;
    watchEvents: number;
    digestRuns: number;
    watchlistRuns: number;
  };
}

interface CanaryRunRow {
  id: string;
  watchlist_id: string;
}

interface CanaryProofRow {
  id: string;
  html_artifact_key: string | null;
  screenshot_artifact_key: string | null;
}

interface CanaryCleanupIdentityRow {
  run_id: string;
  proof_capture_id: string;
  digest_run_id: string;
}

interface CanaryEventRow {
  id: string;
  proof_capture_id: string | null;
  title: string;
  summary: string;
  metadata_json: string;
}

interface CanaryDigestItemRow {
  id: string;
  watchlist_id: string;
  metadata_json: string;
}

interface CanaryDeliveryAttemptRow {
  id: string;
  user_id: string;
  lane: string;
  payload_snapshot_json: string;
}

interface CountRow {
  count: number;
}

const emptyResult = (reason: LaunchCanaryCleanupResult["reason"]): LaunchCanaryCleanupResult => ({
  cleaned: false,
  reason,
  preservedProofCaptureId: null,
  deleted: {
    deliveryAttempts: 0,
    digestDeliveries: 0,
    digestItems: 0,
    watchEvents: 0,
    digestRuns: 0,
    watchlistRuns: 0,
  },
});

function parseObject(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isCanaryEvent(row: CanaryEventRow, proofCaptureId: string) {
  const metadata = parseObject(row.metadata_json);
  return (
    row.proof_capture_id === proofCaptureId &&
    row.title === CANARY_EVENT_TITLE &&
    row.summary === CANARY_EVENT_SUMMARY &&
    metadata?.kind === CANARY_KIND
  );
}

function isCanaryDigestItem(row: CanaryDigestItemRow, watchlistId: string, eventIds: Set<string>, proofCaptureId: string) {
  const metadata = parseObject(row.metadata_json);
  return (
    row.watchlist_id === watchlistId &&
    metadata?.kind === CANARY_KIND &&
    typeof metadata.eventId === "string" &&
    eventIds.has(metadata.eventId) &&
    metadata.proofCaptureId === proofCaptureId
  );
}

function isCanaryDeliveryAttempt(row: CanaryDeliveryAttemptRow, ownerUserId: string) {
  const payload = parseObject(row.payload_snapshot_json);
  return row.user_id === ownerUserId && row.lane === "internal" && payload?.kind === "weekly_digest";
}

async function resolveCleanupIdentifiers(
  env: AppEnv,
  input: LaunchCanaryCleanupInput,
): Promise<LaunchCanaryCleanupIdentifiers | null> {
  if ("runId" in input) return input;
  if (!/^[a-z0-9._-]{1,128}$/u.test(input.gateRunId)) return null;

  const rows = await queryAll<CanaryCleanupIdentityRow>(
    env,
    `
      SELECT DISTINCT
        watch_event.run_id,
        proof_capture.id AS proof_capture_id,
        digest_item.digest_run_id
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
      INNER JOIN watch_event
        ON watch_event.proof_capture_id = proof_capture.id
       AND watch_event.watchlist_id = watchlist.id
      INNER JOIN digest_item
        ON digest_item.watchlist_id = watchlist.id
       AND json_extract(digest_item.metadata_json, '$.eventId') = watch_event.id
       AND json_extract(digest_item.metadata_json, '$.proofCaptureId') = proof_capture.id
      INNER JOIN digest_run ON digest_run.id = digest_item.digest_run_id
      WHERE watchlist.user_id = ?
        AND proof_capture.idempotency_key = ?
        AND proof_capture.status = 'succeeded'
        AND json_extract(proof_capture.capture_metadata_json, '$.kind') = ?
        AND json_extract(proof_capture.capture_metadata_json, '$.proofUrl') = ?
        AND json_extract(watch_event.metadata_json, '$.kind') = ?
        AND json_extract(digest_item.metadata_json, '$.kind') = ?
        AND digest_run.user_id = ?
        AND json_extract(digest_run.summary_json, '$.kind') = ?
      LIMIT 2
    `,
    input.ownerUserId,
    `launch-readiness:${input.gateRunId}:proof`,
    CANARY_CAPTURE_KIND,
    CANARY_PROOF_URL,
    CANARY_KIND,
    CANARY_KIND,
    input.ownerUserId,
    CANARY_KIND,
  );
  if (rows.length !== 1) return null;
  return {
    ownerUserId: input.ownerUserId,
    runId: rows[0].run_id,
    proofCaptureId: rows[0].proof_capture_id,
    digestRunId: rows[0].digest_run_id,
  };
}

/**
 * Removes only the non-proof rows created by a completed launch-readiness
 * canary. The proof capture is deliberately preserved because its target may
 * have existed before the canary and the route does not return the prior
 * target pointer needed to restore it safely.
 */
export async function cleanupLaunchReadinessCanary(
  env: AppEnv,
  input: LaunchCanaryCleanupInput,
): Promise<LaunchCanaryCleanupResult> {
  const db = ensureDb(env);
  const identifiers = await resolveCleanupIdentifiers(env, input);
  if (!identifiers) return emptyResult("not_found_or_not_canary");
  const run = await queryOne<CanaryRunRow>(
    env,
    `
      SELECT watchlist_run.id, watchlist_run.watchlist_id
      FROM watchlist_run
      INNER JOIN watchlist ON watchlist.id = watchlist_run.watchlist_id
      WHERE watchlist_run.id = ?
        AND watchlist.user_id = ?
        AND watchlist_run.trigger_type = 'manual'
        AND watchlist_run.status = 'succeeded'
        AND json_extract(watchlist_run.summary_json, '$.kind') = ?
      LIMIT 1
    `,
    identifiers.runId,
    identifiers.ownerUserId,
    CANARY_KIND,
  );
  if (!run) return emptyResult("not_found_or_not_canary");

  const digest = await queryOne<{ id: string }>(
    env,
    `
      SELECT id
      FROM digest_run
      WHERE id = ?
        AND user_id = ?
        AND json_extract(summary_json, '$.kind') = ?
      LIMIT 1
    `,
    identifiers.digestRunId,
    identifiers.ownerUserId,
    CANARY_KIND,
  );
  if (!digest) return emptyResult("not_found_or_not_canary");

  const proof = await queryOne<CanaryProofRow>(
    env,
    `
      SELECT
        proof_capture.id,
        proof_capture.html_artifact_key,
        proof_capture.screenshot_artifact_key
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      WHERE proof_capture.id = ?
        AND proof_target.watchlist_id = ?
        AND proof_capture.status = 'succeeded'
        AND proof_capture.idempotency_key LIKE 'launch-readiness:%:proof'
        AND json_extract(proof_capture.capture_metadata_json, '$.kind') = ?
        AND json_extract(proof_capture.capture_metadata_json, '$.proofUrl') = ?
      LIMIT 1
    `,
    identifiers.proofCaptureId,
    run.watchlist_id,
    CANARY_CAPTURE_KIND,
    CANARY_PROOF_URL,
  );
  if (!proof) return emptyResult("not_found_or_not_canary");

  const artifactKeys = [proof.html_artifact_key, proof.screenshot_artifact_key]
    .filter((key): key is string => typeof key === "string");
  if (artifactKeys.length > 0) {
    const artifactResults = await deleteProofArtifactsForCapture(
      env,
      identifiers.ownerUserId,
      proof.id,
      artifactKeys,
    );
    if (artifactResults.some((result) => !result.ok)) {
      return emptyResult("artifact_cleanup_incomplete");
    }
  }

  const events = await queryAll<CanaryEventRow>(
    env,
    `
      SELECT id, proof_capture_id, title, summary, metadata_json
      FROM watch_event
      WHERE run_id = ? AND watchlist_id = ?
    `,
    run.id,
    run.watchlist_id,
  );
  if (events.length === 0 || events.some((event) => !isCanaryEvent(event, proof.id))) {
    return emptyResult("shared_rows_present");
  }

  const eventIds = new Set(events.map((event) => event.id));
  const digestItems = await queryAll<CanaryDigestItemRow>(
    env,
    `
      SELECT id, watchlist_id, metadata_json
      FROM digest_item
      WHERE digest_run_id = ?
    `,
    digest.id,
  );
  if (
    digestItems.length === 0 ||
    digestItems.some((item) => !isCanaryDigestItem(item, run.watchlist_id, eventIds, proof.id))
  ) {
    return emptyResult("shared_rows_present");
  }

  const attempts = await queryAll<CanaryDeliveryAttemptRow>(
    env,
    `
      SELECT id, user_id, lane, payload_snapshot_json
      FROM delivery_attempt
      WHERE digest_run_id = ?
    `,
    digest.id,
  );
  if (attempts.length === 0 || attempts.some((attempt) => !isCanaryDeliveryAttempt(attempt, identifiers.ownerUserId))) {
    return emptyResult("shared_rows_present");
  }

  const [runReferences, eventReferences] = await Promise.all([
    queryOne<CountRow>(
      env,
      "SELECT COUNT(*) AS count FROM watchlist_run WHERE baseline_from_run_id = ?",
      run.id,
    ),
    queryOne<CountRow>(
      env,
      "SELECT COUNT(*) AS count FROM watch_event WHERE baseline_from_run_id = ?",
      run.id,
    ),
  ]);
  if (Number(runReferences?.count ?? 0) > 0 || Number(eventReferences?.count ?? 0) > 0) {
    return emptyResult("shared_rows_present");
  }

  const statements = [
    db
      .prepare(
        `
          DELETE FROM delivery_attempt
          WHERE digest_run_id = ?
            AND user_id = ?
            AND lane = 'internal'
            AND json_extract(payload_snapshot_json, '$.kind') = 'weekly_digest'
        `,
      )
      .bind(digest.id, identifiers.ownerUserId),
    db.prepare("DELETE FROM digest_delivery WHERE digest_run_id = ?").bind(digest.id),
    db.prepare("DELETE FROM digest_item WHERE digest_run_id = ?").bind(digest.id),
    db
      .prepare("DELETE FROM watch_event WHERE run_id = ? AND watchlist_id = ?")
      .bind(run.id, run.watchlist_id),
    db
      .prepare(
        `
          DELETE FROM digest_run
          WHERE id = ? AND user_id = ?
            AND json_extract(summary_json, '$.kind') = ?
        `,
      )
      .bind(digest.id, identifiers.ownerUserId, CANARY_KIND),
    db
      .prepare(
        `
          DELETE FROM watchlist_run
          WHERE id = ? AND watchlist_id = ?
            AND trigger_type = 'manual'
            AND status = 'succeeded'
            AND json_extract(summary_json, '$.kind') = ?
        `,
      )
      .bind(run.id, run.watchlist_id, CANARY_KIND),
  ];
  const previous = cleanupLocks.get(db as object) ?? Promise.resolve();
  const batch = previous.catch(() => undefined).then(() => db.batch(statements));
  cleanupLocks.set(
    db as object,
    batch.then(
      () => undefined,
      () => undefined,
    ),
  );
  const results = await batch;
  const deleted = {
    deliveryAttempts: Number(results[0]?.meta?.changes ?? 0),
    digestDeliveries: Number(results[1]?.meta?.changes ?? 0),
    digestItems: Number(results[2]?.meta?.changes ?? 0),
    watchEvents: Number(results[3]?.meta?.changes ?? 0),
    digestRuns: Number(results[4]?.meta?.changes ?? 0),
    watchlistRuns: Number(results[5]?.meta?.changes ?? 0),
  };

  return deleted.watchlistRuns === 1 && deleted.digestRuns === 1
    ? { cleaned: true, preservedProofCaptureId: proof.id, deleted }
    : { cleaned: false, reason: "not_found_or_not_canary", preservedProofCaptureId: proof.id, deleted };
}

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
const gateCleanupLocks = new WeakMap<object, Promise<void>>();
const RUNNING_CANARY_STALE_MS = 10 * 60 * 1000;

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
  status?: string;
  started_at?: string;
}

interface CanaryProofRow {
  id: string;
  watchlist_id: string;
  html_artifact_key: string | null;
  screenshot_artifact_key: string | null;
  capture_metadata_json: string;
}

interface LaunchCanaryCleanupClaim {
  token: string;
  gateRunId: string;
  runId: string | null;
  digestRunId: string | null;
}

interface GateCanaryEventRow extends CanaryEventRow {
  run_id: string;
  watchlist_id: string;
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

function readCleanupClaim(proof: CanaryProofRow) {
  const metadata = parseObject(proof.capture_metadata_json);
  const value = metadata?.launchCanaryCleanupClaim;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const claim = value as Record<string, unknown>;
  return (
    typeof claim.token === "string" &&
    typeof claim.gateRunId === "string" &&
    (typeof claim.runId === "string" || claim.runId === null) &&
    (typeof claim.digestRunId === "string" || claim.digestRunId === null)
  ) ? claim as unknown as LaunchCanaryCleanupClaim : null;
}

function cleanupClaimFor(
  proof: CanaryProofRow,
  identity: Omit<LaunchCanaryCleanupClaim, "token">,
) {
  const existing = readCleanupClaim(proof);
  if (existing) {
    return (
      existing.gateRunId === identity.gateRunId &&
      existing.runId === identity.runId &&
      existing.digestRunId === identity.digestRunId
    ) ? existing : null;
  }
  return {
    ...identity,
    token: crypto.randomUUID(),
  } satisfies LaunchCanaryCleanupClaim;
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

function emptyDeleted(): LaunchCanaryCleanupResult["deleted"] {
  return {
    deliveryAttempts: 0,
    digestDeliveries: 0,
    digestItems: 0,
    watchEvents: 0,
    digestRuns: 0,
    watchlistRuns: 0,
  };
}

async function proofArtifactReferencesAreCleared(
  env: AppEnv,
  ownerUserId: string,
  proofCaptureId: string,
) {
  const current = await queryOne<Pick<CanaryProofRow, "html_artifact_key" | "screenshot_artifact_key">>(
    env,
    `
      SELECT proof_capture.html_artifact_key, proof_capture.screenshot_artifact_key
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
      WHERE proof_capture.id = ?
        AND watchlist.user_id = ?
      LIMIT 1
    `,
    proofCaptureId,
    ownerUserId,
  );
  return Boolean(
    current &&
    current.html_artifact_key === null &&
    current.screenshot_artifact_key === null,
  );
}

async function cleanupCanaryProofArtifacts(
  env: AppEnv,
  ownerUserId: string,
  proof: CanaryProofRow,
) {
  const artifactKeys = [proof.html_artifact_key, proof.screenshot_artifact_key]
    .filter((key): key is string => typeof key === "string");
  if (artifactKeys.length === 0) return true;
  const artifactResults = await deleteProofArtifactsForCapture(
    env,
    ownerUserId,
    proof.id,
    artifactKeys,
  );
  return (
    artifactResults.every((result) => result.ok) ||
    proofArtifactReferencesAreCleared(env, ownerUserId, proof.id)
  );
}

function buildProofCleanupClaimStatement(
  db: ReturnType<typeof ensureDb>,
  ownerUserId: string,
  proof: CanaryProofRow,
  claim: LaunchCanaryCleanupClaim,
) {
  return db.prepare(`
      UPDATE proof_capture
      SET capture_metadata_json = json_set(
            capture_metadata_json,
            '$.launchCanaryCleanupClaim',
            json(?)
          )
      WHERE id = ?
        AND json_extract(capture_metadata_json, '$.kind') = ?
        AND json_extract(capture_metadata_json, '$.proofUrl') = ?
        AND json_extract(capture_metadata_json, '$.gateRunId') = ?
        AND (
          json_extract(capture_metadata_json, '$.launchCanaryCleanupClaim.token') IS NULL
          OR json_extract(capture_metadata_json, '$.launchCanaryCleanupClaim.token') = ?
        )
        AND EXISTS (
          SELECT 1
          FROM proof_target
          INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
          WHERE proof_target.id = proof_capture.proof_target_id
            AND watchlist.user_id = ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM watch_event
          WHERE proof_capture_id = proof_capture.id
            AND (? IS NULL OR run_id <> ? OR watchlist_id <> ?)
        )
        AND NOT EXISTS (
          SELECT 1 FROM digest_item
          WHERE json_extract(metadata_json, '$.proofCaptureId') = proof_capture.id
            AND (? IS NULL OR digest_run_id <> ?)
        )
    `).bind(
    JSON.stringify(claim),
    proof.id,
    CANARY_CAPTURE_KIND,
    CANARY_PROOF_URL,
    claim.gateRunId,
    claim.token,
    ownerUserId,
    claim.runId,
    claim.runId,
    proof.watchlist_id,
    claim.digestRunId,
    claim.digestRunId,
  );
}

async function claimProofForArtifactCleanup(
  env: AppEnv,
  ownerUserId: string,
  proof: CanaryProofRow,
  claim: LaunchCanaryCleanupClaim,
) {
  const result = await buildProofCleanupClaimStatement(
    ensureDb(env),
    ownerUserId,
    proof,
    claim,
  ).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

const proofCleanupClaimGuardSql = `
  AND EXISTS (
    SELECT 1 FROM proof_capture AS cleanup_proof
    WHERE cleanup_proof.id = ?
      AND json_extract(
        cleanup_proof.capture_metadata_json,
        '$.launchCanaryCleanupClaim.token'
      ) = ?
  )
`;

async function cleanupLaunchReadinessCanaryByGateRunId(
  env: AppEnv,
  input: { ownerUserId: string; gateRunId: string },
  verifyAbsentAfterNoop = true,
): Promise<LaunchCanaryCleanupResult> {
  if (!/^[a-z0-9._-]{1,128}$/u.test(input.gateRunId)) {
    return emptyResult("not_found_or_not_canary");
  }
  const db = ensureDb(env);
  const staleRunningCutoff = new Date(Date.now() - RUNNING_CANARY_STALE_MS).toISOString();
  const [runs, proofs, events, digests] = await Promise.all([
    queryAll<CanaryRunRow>(
      env,
      `
        SELECT watchlist_run.id, watchlist_run.watchlist_id,
               watchlist_run.status, watchlist_run.started_at
        FROM watchlist_run
        INNER JOIN watchlist ON watchlist.id = watchlist_run.watchlist_id
        WHERE watchlist.user_id = ?
          AND watchlist_run.trigger_type = 'manual'
          AND watchlist_run.status IN ('running', 'failed', 'succeeded')
          AND json_extract(watchlist_run.summary_json, '$.kind') = ?
          AND json_extract(watchlist_run.summary_json, '$.gateRunId') = ?
        LIMIT 2
      `,
      input.ownerUserId,
      CANARY_KIND,
      input.gateRunId,
    ),
    queryAll<CanaryProofRow>(
      env,
      `
        SELECT proof_capture.id, proof_target.watchlist_id,
               proof_capture.html_artifact_key, proof_capture.screenshot_artifact_key,
               proof_capture.capture_metadata_json
        FROM proof_capture
        INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
        INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
        WHERE watchlist.user_id = ?
          AND proof_capture.status = 'succeeded'
          AND proof_capture.idempotency_key = ?
          AND json_extract(proof_capture.capture_metadata_json, '$.kind') = ?
          AND json_extract(proof_capture.capture_metadata_json, '$.proofUrl') = ?
          AND json_extract(proof_capture.capture_metadata_json, '$.gateRunId') = ?
        LIMIT 2
      `,
      input.ownerUserId,
      `launch-readiness:${input.gateRunId}:proof`,
      CANARY_CAPTURE_KIND,
      CANARY_PROOF_URL,
      input.gateRunId,
    ),
    queryAll<GateCanaryEventRow>(
      env,
      `
        SELECT watch_event.id, watch_event.run_id, watch_event.watchlist_id,
               watch_event.proof_capture_id, watch_event.title,
               watch_event.summary, watch_event.metadata_json
        FROM watch_event
        INNER JOIN watchlist ON watchlist.id = watch_event.watchlist_id
        WHERE watchlist.user_id = ?
          AND json_extract(watch_event.metadata_json, '$.kind') = ?
          AND json_extract(watch_event.metadata_json, '$.gateRunId') = ?
        LIMIT 2
      `,
      input.ownerUserId,
      CANARY_KIND,
      input.gateRunId,
    ),
    queryAll<{ id: string }>(
      env,
      `
        SELECT id
        FROM digest_run
        WHERE user_id = ?
          AND json_extract(summary_json, '$.kind') = ?
          AND json_extract(summary_json, '$.gateRunId') = ?
        LIMIT 2
      `,
      input.ownerUserId,
      CANARY_KIND,
      input.gateRunId,
    ),
  ]);
  if ([runs, proofs, events, digests].some((rows) => rows.length > 1)) {
    return emptyResult("shared_rows_present");
  }
  const run = runs[0] ?? null;
  const proof = proofs[0] ?? null;
  const event = events[0] ?? null;
  const digest = digests[0] ?? null;
  if (
    run?.status === "running" &&
    Date.parse(run.started_at ?? "") > Date.parse(staleRunningCutoff)
  ) {
    return emptyResult("shared_rows_present");
  }
  if (!run && !proof && !event && !digest) {
    return { cleaned: true, preservedProofCaptureId: null, deleted: emptyDeleted() };
  }
  if (
    (event && (!run || !proof)) ||
    (event && (
      event.run_id !== run?.id ||
      event.watchlist_id !== run?.watchlist_id ||
      event.watchlist_id !== proof?.watchlist_id ||
      !isCanaryEvent(event, proof.id) ||
      parseObject(event.metadata_json)?.gateRunId !== input.gateRunId
    )) ||
    (run && proof && run.watchlist_id !== proof.watchlist_id)
  ) {
    return emptyResult("shared_rows_present");
  }

  const [
    digestItems,
    attempts,
    digestDeliveryCount,
    allRunEvents,
    externalDigestReferences,
    observationReferences,
    candidateReferences,
    proofEventReferences,
    proofDigestReferences,
  ] =
    await Promise.all([
      digest
        ? queryAll<CanaryDigestItemRow>(env, `
            SELECT id, watchlist_id, metadata_json FROM digest_item WHERE digest_run_id = ?
          `, digest.id)
        : Promise.resolve([]),
      digest
        ? queryAll<CanaryDeliveryAttemptRow>(env, `
            SELECT id, user_id, lane, payload_snapshot_json
            FROM delivery_attempt WHERE digest_run_id = ?
          `, digest.id)
        : Promise.resolve([]),
      digest
        ? queryOne<CountRow>(env, "SELECT COUNT(*) AS count FROM digest_delivery WHERE digest_run_id = ?", digest.id)
        : Promise.resolve(null),
      run
        ? queryAll<GateCanaryEventRow>(env, `
            SELECT id, run_id, watchlist_id, proof_capture_id, title, summary, metadata_json
            FROM watch_event WHERE run_id = ? AND watchlist_id = ?
          `, run.id, run.watchlist_id)
        : Promise.resolve([]),
      event && proof
        ? queryAll<{ digest_run_id: string }>(env, `
            SELECT digest_run_id
            FROM digest_item
            WHERE json_extract(metadata_json, '$.eventId') = ?
              AND json_extract(metadata_json, '$.proofCaptureId') = ?
          `, event.id, proof.id)
        : Promise.resolve([]),
      run
        ? queryOne<CountRow>(env, "SELECT COUNT(*) AS count FROM ad_observation WHERE watchlist_run_id = ?", run.id)
        : Promise.resolve(null),
      run
        ? queryOne<CountRow>(env, "SELECT COUNT(*) AS count FROM event_candidate WHERE run_id = ?", run.id)
        : Promise.resolve(null),
      proof
        ? queryOne<CountRow>(env, `
            SELECT COUNT(*) AS count
            FROM watch_event
            WHERE proof_capture_id = ?
              AND (? IS NULL OR id <> ?)
          `, proof.id, event?.id ?? null, event?.id ?? null)
        : Promise.resolve(null),
      proof
        ? queryOne<CountRow>(env, `
            SELECT COUNT(*) AS count
            FROM digest_item
            WHERE json_extract(metadata_json, '$.proofCaptureId') = ?
              AND (? IS NULL OR digest_run_id <> ?)
          `, proof.id, digest?.id ?? null, digest?.id ?? null)
        : Promise.resolve(null),
    ]);
  const eventIds = new Set(event ? [event.id] : []);
  if (
    (run && (
      allRunEvents.length !== (event ? 1 : 0) ||
      (event && allRunEvents[0]?.id !== event.id)
    )) ||
    (digest && (!event || !proof || !run || digestItems.length === 0)) ||
    digestItems.some((item) =>
      !isCanaryDigestItem(item, run?.watchlist_id ?? "", eventIds, proof?.id ?? "") ||
      parseObject(item.metadata_json)?.gateRunId !== input.gateRunId
    ) ||
    attempts.some((attempt) => !isCanaryDeliveryAttempt(attempt, input.ownerUserId)) ||
    externalDigestReferences.some((reference) => reference.digest_run_id !== digest?.id) ||
    [
      observationReferences,
      candidateReferences,
      proofEventReferences,
      proofDigestReferences,
    ]
      .some((row) => Number(row?.count ?? 0) > 0)
  ) {
    return emptyResult("shared_rows_present");
  }

  const existingProofCleanupClaim = proof ? readCleanupClaim(proof) : null;
  const proofCleanupClaim = proof
    ? (!run && !event && !digest && existingProofCleanupClaim?.gateRunId === input.gateRunId
        ? existingProofCleanupClaim
        : cleanupClaimFor(proof, {
            gateRunId: input.gateRunId,
            runId: run?.id ?? null,
            digestRunId: digest?.id ?? null,
          }))
    : null;
  if (proof && !proofCleanupClaim) return emptyResult("shared_rows_present");
  if (!run && !event && !digest) {
    if (
      proof &&
      (!(await claimProofForArtifactCleanup(env, input.ownerUserId, proof, proofCleanupClaim!)) ||
        !(await cleanupCanaryProofArtifacts(env, input.ownerUserId, proof)))
    ) {
      return { ...emptyResult("artifact_cleanup_incomplete"), preservedProofCaptureId: proof.id };
    }
    return { cleaned: true, preservedProofCaptureId: proof?.id ?? null, deleted: emptyDeleted() };
  }

  const claimGuard = proof ? proofCleanupClaimGuardSql : "";
  const claimBindings = proof && proofCleanupClaim
    ? [proof.id, proofCleanupClaim.token]
    : [];

  const statements = [
    ...(proof && proofCleanupClaim
      ? [buildProofCleanupClaimStatement(db, input.ownerUserId, proof, proofCleanupClaim)]
      : []),
    ...(digest ? [
      db.prepare(`
        DELETE FROM delivery_attempt
        WHERE digest_run_id = ? AND user_id = ? AND lane = 'internal'
          AND json_extract(payload_snapshot_json, '$.kind') = 'weekly_digest'
          ${claimGuard}
      `).bind(digest.id, input.ownerUserId, ...claimBindings),
      db.prepare(`
        DELETE FROM digest_delivery
        WHERE digest_run_id = ?
          ${claimGuard}
      `).bind(digest.id, ...claimBindings),
      db.prepare(`
        DELETE FROM digest_item
        WHERE digest_run_id = ?
          AND json_extract(metadata_json, '$.kind') = ?
          AND json_extract(metadata_json, '$.gateRunId') = ?
          ${claimGuard}
      `).bind(digest.id, CANARY_KIND, input.gateRunId, ...claimBindings),
    ] : []),
    ...(event ? [db.prepare(`
      DELETE FROM watch_event
      WHERE id = ? AND run_id = ? AND watchlist_id = ?
        AND json_extract(metadata_json, '$.kind') = ?
        AND json_extract(metadata_json, '$.gateRunId') = ?
        ${claimGuard}
    `).bind(event.id, event.run_id, event.watchlist_id, CANARY_KIND, input.gateRunId, ...claimBindings)] : []),
    ...(digest ? [db.prepare(`
      DELETE FROM digest_run
      WHERE id = ? AND user_id = ?
        AND json_extract(summary_json, '$.kind') = ?
        AND json_extract(summary_json, '$.gateRunId') = ?
        ${claimGuard}
    `).bind(digest.id, input.ownerUserId, CANARY_KIND, input.gateRunId, ...claimBindings)] : []),
    ...(run ? [db.prepare(`
      DELETE FROM watchlist_run
      WHERE id = ? AND watchlist_id = ? AND trigger_type = 'manual'
        AND (
          status IN ('failed', 'succeeded')
          OR (status = 'running' AND started_at <= ?)
        )
        AND json_extract(summary_json, '$.kind') = ?
        AND json_extract(summary_json, '$.gateRunId') = ?
        ${claimGuard}
    `).bind(
      run.id,
      run.watchlist_id,
      staleRunningCutoff,
      CANARY_KIND,
      input.gateRunId,
      ...claimBindings,
    )] : []),
  ];
  const previous = cleanupLocks.get(db as object) ?? Promise.resolve();
  const batch = previous.catch(() => undefined).then(() => db.batch(statements));
  cleanupLocks.set(db as object, batch.then(() => undefined, () => undefined));
  const results = await batch;
  let index = 0;
  if (proof) {
    if (Number(results[index++]?.meta?.changes ?? 0) !== 1) {
      return cleanupLaunchReadinessCanaryByGateRunId(env, input, false);
    }
  }
  const deleted = emptyDeleted();
  if (digest) {
    deleted.deliveryAttempts = Number(results[index++]?.meta?.changes ?? 0);
    deleted.digestDeliveries = Number(results[index++]?.meta?.changes ?? 0);
    deleted.digestItems = Number(results[index++]?.meta?.changes ?? 0);
  }
  if (event) deleted.watchEvents = Number(results[index++]?.meta?.changes ?? 0);
  if (digest) deleted.digestRuns = Number(results[index++]?.meta?.changes ?? 0);
  if (run) deleted.watchlistRuns = Number(results[index++]?.meta?.changes ?? 0);
  const expected = {
    deliveryAttempts: attempts.length,
    digestDeliveries: Number(digestDeliveryCount?.count ?? 0),
    digestItems: digestItems.length,
    watchEvents: event ? 1 : 0,
    digestRuns: digest ? 1 : 0,
    watchlistRuns: run ? 1 : 0,
  };
  const complete = Object.entries(expected).every(
    ([key, count]) => deleted[key as keyof typeof deleted] === count,
  );
  if (complete) {
    const artifactsCleaned = !proof || await cleanupCanaryProofArtifacts(env, input.ownerUserId, proof);
    return artifactsCleaned
      ? { cleaned: true, preservedProofCaptureId: proof?.id ?? null, deleted }
      : { ...emptyResult("artifact_cleanup_incomplete"), preservedProofCaptureId: proof?.id ?? null, deleted };
  }
  if (verifyAbsentAfterNoop) {
    return cleanupLaunchReadinessCanaryByGateRunId(env, input, false);
  }
  return { cleaned: false, reason: "not_found_or_not_canary", preservedProofCaptureId: proof?.id ?? null, deleted };
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
  if ("gateRunId" in input) {
    const db = ensureDb(env);
    const previous = gateCleanupLocks.get(db as object) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => cleanupLaunchReadinessCanaryByGateRunId(env, input));
    gateCleanupLocks.set(
      db as object,
      operation.then(() => undefined, () => undefined),
    );
    return operation;
  }
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
  if (!run) {
    const orphanProof = await queryOne<CanaryProofRow>(
      env,
      `
        SELECT proof_capture.id, proof_target.watchlist_id,
               proof_capture.html_artifact_key, proof_capture.screenshot_artifact_key,
               proof_capture.capture_metadata_json
        FROM proof_capture
        INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
        INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
        WHERE proof_capture.id = ?
          AND watchlist.user_id = ?
          AND proof_capture.status = 'succeeded'
          AND json_extract(proof_capture.capture_metadata_json, '$.kind') = ?
          AND json_extract(proof_capture.capture_metadata_json, '$.proofUrl') = ?
        LIMIT 1
      `,
      identifiers.proofCaptureId,
      identifiers.ownerUserId,
      CANARY_CAPTURE_KIND,
      CANARY_PROOF_URL,
    );
    const claim = orphanProof ? readCleanupClaim(orphanProof) : null;
    if (
      !orphanProof ||
      !claim ||
      claim.runId !== identifiers.runId ||
      claim.digestRunId !== identifiers.digestRunId
    ) {
      return emptyResult("not_found_or_not_canary");
    }
    const [eventReferences, digestReferences, digestRow] = await Promise.all([
      queryOne<CountRow>(
        env,
        "SELECT COUNT(*) AS count FROM watch_event WHERE proof_capture_id = ?",
        orphanProof.id,
      ),
      queryOne<CountRow>(
        env,
        `
          SELECT COUNT(*) AS count
          FROM digest_item
          WHERE json_extract(metadata_json, '$.proofCaptureId') = ?
        `,
        orphanProof.id,
      ),
      queryOne<{ id: string }>(
        env,
        "SELECT id FROM digest_run WHERE id = ? LIMIT 1",
        identifiers.digestRunId,
      ),
    ]);
    if (
      digestRow ||
      Number(eventReferences?.count ?? 0) > 0 ||
      Number(digestReferences?.count ?? 0) > 0
    ) {
      return emptyResult("shared_rows_present");
    }
    return (await cleanupCanaryProofArtifacts(env, identifiers.ownerUserId, orphanProof))
      ? { cleaned: true, preservedProofCaptureId: orphanProof.id, deleted: emptyDeleted() }
      : { ...emptyResult("artifact_cleanup_incomplete"), preservedProofCaptureId: orphanProof.id };
  }

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
        proof_capture.screenshot_artifact_key,
        proof_capture.capture_metadata_json,
        proof_target.watchlist_id
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

  const [proofEventReferences, proofDigestReferences] = await Promise.all([
    queryAll<{ id: string }>(
      env,
      "SELECT id FROM watch_event WHERE proof_capture_id = ?",
      proof.id,
    ),
    queryAll<{ id: string; digest_run_id: string }>(
      env,
      `
        SELECT id, digest_run_id
        FROM digest_item
        WHERE json_extract(metadata_json, '$.proofCaptureId') = ?
      `,
      proof.id,
    ),
  ]);
  const digestItemIds = new Set(digestItems.map((item) => item.id));
  if (
    proofEventReferences.some((reference) => !eventIds.has(reference.id)) ||
    proofDigestReferences.some((reference) =>
      reference.digest_run_id !== digest.id || !digestItemIds.has(reference.id)
    )
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

  const proofGateRunId = parseObject(proof.capture_metadata_json)?.gateRunId;
  if (typeof proofGateRunId !== "string") return emptyResult("not_found_or_not_canary");
  const proofCleanupClaim = cleanupClaimFor(proof, {
    gateRunId: proofGateRunId,
    runId: run.id,
    digestRunId: digest.id,
  });
  if (!proofCleanupClaim) return emptyResult("shared_rows_present");
  const claimBindings = [proof.id, proofCleanupClaim.token];

  const statements = [
    buildProofCleanupClaimStatement(
      db,
      identifiers.ownerUserId,
      proof,
      proofCleanupClaim,
    ),
    db
      .prepare(
        `
          DELETE FROM delivery_attempt
          WHERE digest_run_id = ?
            AND user_id = ?
            AND lane = 'internal'
            AND json_extract(payload_snapshot_json, '$.kind') = 'weekly_digest'
            ${proofCleanupClaimGuardSql}
        `,
      )
      .bind(digest.id, identifiers.ownerUserId, ...claimBindings),
    db.prepare(`
      DELETE FROM digest_delivery
      WHERE digest_run_id = ?
        ${proofCleanupClaimGuardSql}
    `).bind(digest.id, ...claimBindings),
    db.prepare(`
      DELETE FROM digest_item
      WHERE digest_run_id = ?
        ${proofCleanupClaimGuardSql}
    `).bind(digest.id, ...claimBindings),
    db
      .prepare(`
        DELETE FROM watch_event
        WHERE run_id = ? AND watchlist_id = ?
          ${proofCleanupClaimGuardSql}
      `)
      .bind(run.id, run.watchlist_id, ...claimBindings),
    db
      .prepare(
        `
          DELETE FROM digest_run
          WHERE id = ? AND user_id = ?
            AND json_extract(summary_json, '$.kind') = ?
            ${proofCleanupClaimGuardSql}
        `,
      )
      .bind(digest.id, identifiers.ownerUserId, CANARY_KIND, ...claimBindings),
    db
      .prepare(
        `
          DELETE FROM watchlist_run
          WHERE id = ? AND watchlist_id = ?
            AND trigger_type = 'manual'
            AND status = 'succeeded'
            AND json_extract(summary_json, '$.kind') = ?
            ${proofCleanupClaimGuardSql}
        `,
      )
      .bind(run.id, run.watchlist_id, CANARY_KIND, ...claimBindings),
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
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    return cleanupLaunchReadinessCanary(env, identifiers);
  }
  const deleted = {
    deliveryAttempts: Number(results[1]?.meta?.changes ?? 0),
    digestDeliveries: Number(results[2]?.meta?.changes ?? 0),
    digestItems: Number(results[3]?.meta?.changes ?? 0),
    watchEvents: Number(results[4]?.meta?.changes ?? 0),
    digestRuns: Number(results[5]?.meta?.changes ?? 0),
    watchlistRuns: Number(results[6]?.meta?.changes ?? 0),
  };

  if (deleted.watchlistRuns !== 1 || deleted.digestRuns !== 1) {
    return { cleaned: false, reason: "not_found_or_not_canary", preservedProofCaptureId: proof.id, deleted };
  }
  const artifactsCleaned = await cleanupCanaryProofArtifacts(env, identifiers.ownerUserId, proof);
  return artifactsCleaned
    ? { cleaned: true, preservedProofCaptureId: proof.id, deleted }
    : { ...emptyResult("artifact_cleanup_incomplete"), preservedProofCaptureId: proof.id, deleted };
}

import {
  execute as run,
  queryAll as many,
  queryIn,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  createId,
  jsonValue,
  nowIso,
  type JsonRecord,
} from "~/lib/data/helpers.server";
import {
  toProofCaptureRecord,
  toProofTargetRecord,
  type CountRow,
  type ProofCaptureRow,
  type ProofTargetRow,
} from "~/lib/data/watchlist-rows.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  ProofCaptureRecord,
  ProofDeviceProfile,
  ProofRenderMode,
  ProofSkipReason,
  ProofStatus,
} from "~/lib/types";
export async function getProofTargetByIdentity(
  env: AppEnv,
  proofTargetIdentity: string,
) {
  const row = await one<ProofTargetRow>(
    env,
    `
      SELECT *
      FROM proof_target
      WHERE proof_target_identity = ?
      LIMIT 1
    `,
    proofTargetIdentity,
  );

  return row ? toProofTargetRecord(row) : null;
}
export async function upsertProofTarget(
  env: AppEnv,
  input: {
    watchlistId: string;
    adId: string | null;
    landingPageUrl: string | null;
    canonicalPageIdentity: string;
    proofTargetIdentity: string;
    lastCaptureAttemptAt?: string | null;
    lastSuccessfulProofAt?: string | null;
    lastSuccessfulCaptureId?: string | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO proof_target (
        id,
        watchlist_id,
        ad_id,
        landing_page_url,
        canonical_page_identity,
        proof_target_identity,
        last_capture_attempt_at,
        last_successful_proof_at,
        last_successful_capture_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(proof_target_identity)
      DO UPDATE SET watchlist_id = excluded.watchlist_id,
                    ad_id = excluded.ad_id,
                    landing_page_url = excluded.landing_page_url,
                    canonical_page_identity = excluded.canonical_page_identity,
                    last_capture_attempt_at = COALESCE(excluded.last_capture_attempt_at, proof_target.last_capture_attempt_at),
                    last_successful_proof_at = COALESCE(excluded.last_successful_proof_at, proof_target.last_successful_proof_at),
                    last_successful_capture_id = COALESCE(excluded.last_successful_capture_id, proof_target.last_successful_capture_id),
                    updated_at = excluded.updated_at
    `,
    id,
    input.watchlistId,
    input.adId,
    input.landingPageUrl,
    input.canonicalPageIdentity,
    input.proofTargetIdentity,
    input.lastCaptureAttemptAt ?? null,
    input.lastSuccessfulProofAt ?? null,
    input.lastSuccessfulCaptureId ?? null,
    timestamp,
    timestamp,
  );

  return getProofTargetByIdentity(env, input.proofTargetIdentity);
}
export async function listProofCapturesForTarget(
  env: AppEnv,
  proofTargetId: string,
  limit = 20,
) {
  const rows = await many<ProofCaptureRow>(
    env,
    `
      SELECT
        id,
        proof_target_id,
        status,
        skip_reason,
        failure_code,
        failure_reason,
        screenshot_artifact_key,
        html_artifact_key,
        extracted_fields_json,
        field_confidence_json,
        extraction_warnings_json,
        capture_metadata_json,
        render_mode,
        device_profile,
        extractor_version,
        idempotency_key,
        attempted_at,
        succeeded_at,
        created_at,
        updated_at
      FROM proof_capture
      WHERE proof_target_id = ?
      ORDER BY attempted_at DESC
      LIMIT ?
    `,
    proofTargetId,
    limit,
  );

  return rows.map(toProofCaptureRecord);
}
const PROOF_CAPTURE_LIST_COLUMNS = `
  proof_capture.id,
  proof_capture.proof_target_id,
  proof_capture.status,
  proof_capture.skip_reason,
  proof_capture.failure_code,
  proof_capture.failure_reason,
  proof_capture.screenshot_artifact_key,
  proof_capture.html_artifact_key,
  proof_capture.extracted_fields_json,
  proof_capture.field_confidence_json,
  proof_capture.extraction_warnings_json,
  proof_capture.capture_metadata_json,
  proof_capture.render_mode,
  proof_capture.device_profile,
  proof_capture.extractor_version,
  proof_capture.idempotency_key,
  proof_capture.attempted_at,
  proof_capture.succeeded_at,
  proof_capture.created_at,
  proof_capture.updated_at
`;
export async function listProofCapturesForTargets(
  env: AppEnv,
  proofTargetIds: string[],
  limitPerTarget = 20,
) {
  const uniqueIds = [...new Set(proofTargetIds.filter(Boolean))];
  const capturesByTargetId = new Map<string, ProofCaptureRecord[]>();
  if (uniqueIds.length === 0) {
    return capturesByTargetId;
  }

  const perTarget = Math.max(1, Math.min(50, Math.floor(limitPerTarget)));
  const rows = await queryIn<ProofCaptureRow & { rn: number }>(env, {
    buildSql: (placeholders) => `
      SELECT *
      FROM (
        SELECT
          ${PROOF_CAPTURE_LIST_COLUMNS},
          ROW_NUMBER() OVER (
            PARTITION BY proof_capture.proof_target_id
            ORDER BY proof_capture.attempted_at DESC
          ) AS rn
        FROM proof_capture
        WHERE proof_capture.proof_target_id IN (${placeholders})
      )
      WHERE rn <= ?
      ORDER BY proof_target_id ASC, attempted_at DESC
    `,
    values: uniqueIds,
    suffix: [perTarget],
  });

  for (const row of rows) {
    const record = toProofCaptureRecord(row);
    const next = capturesByTargetId.get(record.proofTargetId) ?? [];
    next.push(record);
    capturesByTargetId.set(record.proofTargetId, next);
  }

  return capturesByTargetId;
}
async function getProofCaptureByIdempotencyKey(
  env: AppEnv,
  idempotencyKey: string,
) {
  const row = await one<ProofCaptureRow>(
    env,
    `
      SELECT *
      FROM proof_capture
      WHERE idempotency_key = ?
      LIMIT 1
    `,
    idempotencyKey,
  );

  return row ? toProofCaptureRecord(row) : null;
}
type CreateProofCaptureInput = {
  proofTargetId: string;
  status: ProofStatus;
  skipReason?: ProofSkipReason | null;
  failureCode?: string | null;
  failureReason?: string | null;
  screenshotArtifactKey?: string | null;
  htmlArtifactKey?: string | null;
  extractedFields?: JsonRecord;
  fieldConfidence?: Record<string, number>;
  extractionWarnings?: string[];
  captureMetadata?: JsonRecord;
  renderMode?: ProofRenderMode;
  deviceProfile?: ProofDeviceProfile;
  extractorVersion: string;
  idempotencyKey?: string | null;
  attemptedAt?: string;
  succeededAt?: string | null;
};
function getReusableProofCaptureId(existing: ProofCaptureRecord, input: CreateProofCaptureInput) {
  if (existing.proofTargetId !== input.proofTargetId) {
    throw new Error("Existing proof capture request belongs to a different proof target.");
  }
  if (existing.status !== input.status) {
    throw new Error("Existing proof capture request has an incompatible status.");
  }
  if (input.status === "succeeded" && !matchesSuccessfulProofCapturePayload(existing, input)) {
    throw new Error("Existing proof capture request has an incompatible proof payload.");
  }
  return existing.id;
}
function matchesSuccessfulProofCapturePayload(
  existing: ProofCaptureRecord,
  input: CreateProofCaptureInput,
) {
  return (
    Boolean(existing.succeededAt) &&
    existing.succeededAt === (input.succeededAt ?? null) &&
    existing.screenshotArtifactKey === (input.screenshotArtifactKey ?? null) &&
    existing.htmlArtifactKey === (input.htmlArtifactKey ?? null) &&
    existing.extractorVersion === input.extractorVersion &&
    existing.renderMode === (input.renderMode ?? "mobile") &&
    existing.deviceProfile === (input.deviceProfile ?? "mobile_default") &&
    jsonEquivalent(existing.extractedFields, input.extractedFields ?? {}) &&
    jsonEquivalent(existing.fieldConfidence, input.fieldConfidence ?? {}) &&
    jsonEquivalent(existing.extractionWarnings, input.extractionWarnings ?? []) &&
    jsonEquivalent(existing.captureMetadata, input.captureMetadata ?? {})
  );
}
function jsonEquivalent(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
export async function listSuccessfulProofCapturesForAd(
  env: AppEnv,
  watchlistId: string,
  adId: string,
  limit = 5,
) {
  const rows = await many<ProofCaptureRow>(
    env,
    `
      SELECT ${PROOF_CAPTURE_LIST_COLUMNS}
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      WHERE proof_target.watchlist_id = ?
        AND proof_target.ad_id = ?
        AND proof_capture.status = 'succeeded'
        AND proof_capture.succeeded_at IS NOT NULL
      ORDER BY proof_capture.succeeded_at DESC
      LIMIT ?
    `,
    watchlistId,
    adId,
    limit,
  );

  return rows.map(toProofCaptureRecord);
}
export async function listLastSuccessfulProofCapturesForAds(
  env: AppEnv,
  watchlistId: string,
  adIds: string[],
  limitPerAd = 5,
) {
  const uniqueIds = [...new Set(adIds.filter(Boolean))];
  const capturesByAdId = new Map<string, ProofCaptureRecord[]>();
  if (uniqueIds.length === 0) {
    return capturesByAdId;
  }

  const perAd = Math.max(1, Math.min(20, Math.floor(limitPerAd)));
  const rows = await queryIn<ProofCaptureRow & { ad_id: string; rn: number }>(env, {
    buildSql: (placeholders) => `
      SELECT *
      FROM (
        SELECT
          ${PROOF_CAPTURE_LIST_COLUMNS},
          proof_target.ad_id AS ad_id,
          ROW_NUMBER() OVER (
            PARTITION BY proof_target.ad_id
            ORDER BY proof_capture.succeeded_at DESC
          ) AS rn
        FROM proof_capture
        INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
        WHERE proof_target.watchlist_id = ?
          AND proof_target.ad_id IN (${placeholders})
          AND proof_capture.status = 'succeeded'
          AND proof_capture.succeeded_at IS NOT NULL
      )
      WHERE rn <= ?
      ORDER BY ad_id ASC, succeeded_at DESC
    `,
    values: uniqueIds,
    prefix: [watchlistId],
    suffix: [perAd],
  });

  for (const row of rows) {
    const record = toProofCaptureRecord(row);
    const next = capturesByAdId.get(row.ad_id) ?? [];
    next.push(record);
    capturesByAdId.set(row.ad_id, next);
  }

  return capturesByAdId;
}
export async function listRecentProofCapturesForWatchlist(
  env: AppEnv,
  watchlistId: string,
  limit = 12,
) {
  const rows = await many<ProofCaptureRow>(
    env,
    `
      SELECT proof_capture.*
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      WHERE proof_target.watchlist_id = ?
      ORDER BY proof_capture.attempted_at DESC
      LIMIT ?
    `,
    watchlistId,
    limit,
  );

  return rows.map(toProofCaptureRecord);
}
export async function countProofCapturesForWatchlistSince(
  env: AppEnv,
  watchlistId: string,
  attemptedSince: string,
) {
  const row = await one<CountRow>(
    env,
    `
      SELECT COUNT(*) AS total
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      WHERE proof_target.watchlist_id = ?
        AND proof_capture.attempted_at >= ?
    `,
    watchlistId,
    attemptedSince,
  );

  return row?.total ?? 0;
}
export async function countProofCapturesForWorkspaceSince(
  env: AppEnv,
  userId: string,
  attemptedSince: string,
) {
  const row = await one<CountRow>(
    env,
    `
      SELECT COUNT(*) AS total
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
      WHERE watchlist.user_id = ?
        AND proof_capture.attempted_at >= ?
    `,
    userId,
    attemptedSince,
  );

  return row?.total ?? 0;
}
export async function getSuccessfulProofCaptureStatsForUser(env: AppEnv, userId: string) {
  const row = await one<{
    total: number;
    latest_at: string | null;
  }>(
    env,
    `
      SELECT COUNT(*) AS total, MAX(proof_capture.succeeded_at) AS latest_at
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
      WHERE watchlist.user_id = ?
        AND proof_capture.status = 'succeeded'
        AND proof_capture.succeeded_at IS NOT NULL
    `,
    userId,
  );

  return {
    count: Number(row?.total ?? 0),
    latestAt: row?.latest_at ?? null,
  };
}
export async function listRecentWorkspaceProofCaptures(
  env: AppEnv,
  userId: string,
  limit = 20,
) {
  const rows = await many<ProofCaptureRow>(
    env,
    `
      SELECT proof_capture.*
      FROM proof_capture
      INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
      INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
      WHERE watchlist.user_id = ?
      ORDER BY proof_capture.attempted_at DESC
      LIMIT ?
    `,
    userId,
    limit,
  );

  return rows.map(toProofCaptureRecord);
}
export async function createProofCapture(
  env: AppEnv,
  input: CreateProofCaptureInput,
) {
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (idempotencyKey) {
    const existing = await getProofCaptureByIdempotencyKey(env, idempotencyKey);
    if (existing) {
      return getReusableProofCaptureId(existing, input);
    }
  }

  const id = createId();
  const timestamp = nowIso();
  try {
    await run(
      env,
      `
        INSERT INTO proof_capture (
          id,
          proof_target_id,
          status,
          skip_reason,
          failure_code,
          failure_reason,
          screenshot_artifact_key,
          html_artifact_key,
          extracted_fields_json,
          field_confidence_json,
          extraction_warnings_json,
          capture_metadata_json,
          render_mode,
          device_profile,
          extractor_version,
          idempotency_key,
          attempted_at,
          succeeded_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      id,
      input.proofTargetId,
      input.status,
      input.skipReason ?? null,
      input.failureCode ?? null,
      input.failureReason ?? null,
      input.screenshotArtifactKey ?? null,
      input.htmlArtifactKey ?? null,
      jsonValue(input.extractedFields ?? {}),
      jsonValue(input.fieldConfidence ?? {}),
      jsonValue(input.extractionWarnings ?? []),
      jsonValue(input.captureMetadata ?? {}),
      input.renderMode ?? "mobile",
      input.deviceProfile ?? "mobile_default",
      input.extractorVersion,
      idempotencyKey,
      input.attemptedAt ?? timestamp,
      input.succeededAt ?? null,
      timestamp,
      timestamp,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!idempotencyKey || !/proof_capture\.idempotency_key|SQLITE_CONSTRAINT_UNIQUE/i.test(message)) {
      throw error;
    }
    const existing = await getProofCaptureByIdempotencyKey(env, idempotencyKey);
    if (!existing) {
      throw error;
    }
    return getReusableProofCaptureId(existing, input);
  }

  return id;
}

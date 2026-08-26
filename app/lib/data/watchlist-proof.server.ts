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
  recentFailureCutoff?: string,
) {
  const rows = recentFailureCutoff
    ? await many<ProofCaptureRow>(
        env,
        `
      SELECT *
      FROM (
        SELECT
          ${PROOF_CAPTURE_LIST_COLUMNS},
          ROW_NUMBER() OVER (
            PARTITION BY proof_capture.proof_target_id
            ORDER BY proof_capture.attempted_at DESC
          ) AS rn
        FROM proof_capture
        WHERE proof_capture.proof_target_id = ?
      )
      WHERE rn <= ?
        OR (status = 'failed' AND attempted_at >= ?)
      ORDER BY attempted_at DESC
    `,
        proofTargetId,
        limit,
        recentFailureCutoff,
      )
    : await many<ProofCaptureRow>(
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
  recentFailureCutoff?: string,
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
      WHERE rn <= ?${
        recentFailureCutoff
          ? "\n        OR (status = 'failed' AND attempted_at >= ?)"
          : ""
      }
      ORDER BY proof_target_id ASC, attempted_at DESC
    `,
    values: uniqueIds,
    suffix: recentFailureCutoff
      ? [perTarget, recentFailureCutoff]
      : [perTarget],
  });

  for (const row of rows) {
    const record = toProofCaptureRecord(row);
    const next = capturesByTargetId.get(record.proofTargetId) ?? [];
    next.push(record);
    capturesByTargetId.set(record.proofTargetId, next);
  }

  return capturesByTargetId;
}

export async function listProofCapturePairsForEventIds(
  env: AppEnv,
  userId: string,
  eventIds: string[],
  options: { includePrevious?: boolean } = {},
) {
  const uniqueEventIds = [...new Set(eventIds.filter(Boolean))];
  if (uniqueEventIds.length === 0) return [];

  const currentRows = await queryIn<
    ProofCaptureRow & {
      event_confirmed_at: string | null;
      event_id: string;
    }
  >(env, {
    buildSql: (placeholders) => `
      SELECT
        ${PROOF_CAPTURE_LIST_COLUMNS},
        watch_event.confirmed_at AS event_confirmed_at,
        watch_event.id AS event_id
      FROM watch_event
      INNER JOIN watchlist ON watchlist.id = watch_event.watchlist_id
      INNER JOIN proof_capture ON proof_capture.id = watch_event.proof_capture_id
      WHERE watch_event.id IN (${placeholders})
        AND watchlist.user_id = ?
    `,
    values: uniqueEventIds,
    suffix: [userId],
  });

  if (options.includePrevious === false) {
    return currentRows.map((current) => ({
      eventId: current.event_id,
      current: toProofCaptureRecord(current),
      previous: null,
    }));
  }

  const previousRows = await Promise.all(
    currentRows.map((current) => {
      const currentAt =
        current.event_confirmed_at ??
        current.succeeded_at ??
        current.attempted_at;
      return one<ProofCaptureRow>(
        env,
        `
          SELECT ${PROOF_CAPTURE_LIST_COLUMNS}
          FROM proof_capture
          INNER JOIN proof_target AS prior_target
            ON prior_target.id = proof_capture.proof_target_id
          INNER JOIN proof_target AS current_target
            ON current_target.id = ?
          WHERE (
              proof_capture.proof_target_id = ?
              OR (
                prior_target.watchlist_id = current_target.watchlist_id
                AND (
                  prior_target.ad_id = current_target.ad_id
                  OR (
                    prior_target.ad_id IS NULL
                    AND current_target.ad_id IS NULL
                  )
                )
              )
            )
            AND proof_capture.id <> ?
            AND proof_capture.status = 'succeeded'
            AND COALESCE(
              proof_capture.succeeded_at,
              proof_capture.attempted_at
            ) < ?
          ORDER BY
            CASE
              WHEN proof_capture.proof_target_id = current_target.id THEN 0
              ELSE 1
            END ASC,
            COALESCE(
              proof_capture.succeeded_at,
              proof_capture.attempted_at
            ) DESC
          LIMIT 1
        `,
        current.proof_target_id,
        current.proof_target_id,
        current.id,
        currentAt,
      );
    }),
  );

  return currentRows.map((current, index) => {
    const previous = previousRows[index];
    return {
      eventId: current.event_id,
      current: toProofCaptureRecord(current),
      previous: previous ? toProofCaptureRecord(previous) : null,
    };
  });
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
export const PROOF_SCREENSHOT_SHARE_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function countRecentSucceededProofScreenshotShare(
  env: AppEnv,
  nowIso: string,
  windowMs: number = PROOF_SCREENSHOT_SHARE_WINDOW_MS,
) {
  const windowStartedAt = new Date(Date.parse(nowIso) - windowMs).toISOString();
  const row = await one<{
    succeeded: number;
    with_screenshot: number | null;
  }>(
    env,
    `
      SELECT
        COUNT(*) AS succeeded,
        SUM(
          CASE
            WHEN screenshot_artifact_key IS NOT NULL
              AND TRIM(screenshot_artifact_key) != ''
            THEN 1
            ELSE 0
          END
        ) AS with_screenshot
      FROM proof_capture
      WHERE status = 'succeeded'
        AND succeeded_at IS NOT NULL
        AND succeeded_at >= ?
    `,
    windowStartedAt,
  );

  return {
    succeeded: Number(row?.succeeded ?? 0),
    withScreenshot: Number(row?.with_screenshot ?? 0),
    windowStartedAt,
  };
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

  if (
    input.status === "succeeded" &&
    !(typeof input.screenshotArtifactKey === "string" && input.screenshotArtifactKey.trim().length > 0)
  ) {
    throw new Error("proof_capture_succeeded_without_screenshot");
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

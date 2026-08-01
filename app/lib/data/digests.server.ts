/**
 * Digest-run / digest-item / digest-delivery D1 persistence.
 * Product code should keep importing from `~/lib/data.server` until later
 * migration PRs. Does not include email HTML or sender paths.
 */

import {
	ensureDb,
  execute as run,
  queryAll as many,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  createId,
  jsonValue,
  nowIso,
  parseJson,
  type JsonRecord,
} from "~/lib/data/helpers.server";
import {
	DIGEST_STRATEGY_GENERATION_PENDING,
	DIGEST_STRATEGY_GENERATION_READY,
	readDigestStrategyNote,
} from "~/lib/digest-strategy";
import {
	DIGEST_ITEM_SET_PROVENANCE,
	selectDigestCohort,
} from "~/lib/digest-provenance";
import { DIGEST_PROVIDER_CLAIM_PROTOCOL } from "~/lib/delivery-attempt-lease";
import type { AppEnv } from "~/lib/env.server";
import type {
  DigestDeliveryRecord,
  DigestItemRecord,
  DigestRecord,
  WatchEventType,
} from "~/lib/types";

const PROOF_CAPTURE_CLEANUP_CLAIM_PATH = "$.launchCanaryCleanupClaim";
const PROOF_CAPTURE_CLEANUP_CLAIMED_ERROR = "proof_capture_cleanup_claimed";

interface DigestRunRow {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
	summary_json: string;
  created_at: string;
}

export { DIGEST_ITEM_SET_PROVENANCE } from "~/lib/digest-provenance";

interface DigestItemRow {
  id: string;
  digest_run_id: string;
  watchlist_id: string;
  watchlist_name: string;
  event_type: WatchEventType;
  title: string;
  summary: string;
  metadata_json: string;
  created_at: string;
}

interface DigestDeliveryRow {
  id: string;
  digest_run_id: string;
  provider: string;
  status: DigestDeliveryRecord["status"];
  recipient_email: string;
  external_message_id: string | null;
  error_message: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DigestRunClaim {
	digestRunId: string;
	created: boolean;
}

export interface DigestScheduleJob {
	id: string;
	userId: string;
	userEmail: string;
	userName: string;
	cadence: "daily" | "weekly";
	periodStart: string;
	periodEnd: string;
	attemptCount: number;
	status: "pending" | "running" | "completed" | "failed" | "exhausted";
	lastErrorCode: string | null;
	updatedAt: string;
	exhaustedAt: string | null;
	exhaustionAlertedAt: string | null;
}

interface DigestScheduleJobRow {
	id: string;
	user_id: string;
	user_email: string;
	user_name: string;
	cadence: DigestScheduleJob["cadence"];
	period_start: string;
	period_end: string;
	attempt_count: number;
	status: DigestScheduleJob["status"];
	last_error_code: string | null;
	updated_at: string;
	exhausted_at: string | null;
	exhaustion_alerted_at: string | null;
}

export interface DigestRunItemInput {
	watchlistId: string;
	watchlistName: string;
	eventType: WatchEventType;
	title: string;
	summary: string;
	metadata?: JsonRecord;
}

function toDigestScheduleJob(row: DigestScheduleJobRow): DigestScheduleJob {
	return {
		id: row.id,
		userId: row.user_id,
		userEmail: row.user_email,
		userName: row.user_name,
		cadence: row.cadence,
		periodStart: row.period_start,
		periodEnd: row.period_end,
		attemptCount: Number(row.attempt_count),
		status: row.status,
		lastErrorCode: row.last_error_code,
		updatedAt: row.updated_at,
		exhaustedAt: row.exhausted_at,
		exhaustionAlertedAt: row.exhaustion_alerted_at,
	};
}

const DIGEST_SCHEDULE_JOB_SELECT = `
  digest_schedule_job.id,
  digest_schedule_job.user_id,
  user.email AS user_email,
  user.name AS user_name,
  digest_schedule_job.cadence,
  digest_schedule_job.period_start,
  digest_schedule_job.period_end,
  digest_schedule_job.attempt_count,
  digest_schedule_job.status,
  digest_schedule_job.last_error_code,
  digest_schedule_job.updated_at,
  digest_schedule_job.exhausted_at,
  digest_schedule_job.exhaustion_alerted_at
`;

export async function enqueueDigestScheduleJobs(
	env: AppEnv,
	input: {
		cadence: DigestScheduleJob["cadence"];
		periodStart: string;
		periodEnd: string;
	},
) {
	const createdAt = nowIso();
	const result = await run(
		env,
		`
			INSERT OR IGNORE INTO digest_schedule_job (
				id, user_id, cadence, period_start, period_end, status,
				attempt_count, created_at, updated_at
			)
			SELECT
				'digest-schedule:' || ? || ':' || ? || ':' || user.id,
				user.id,
				?,
				?,
				?,
				'pending',
				0,
				?,
				?
			FROM user
			INNER JOIN watchlist ON watchlist.user_id = user.id
			WHERE watchlist.is_active = 1
			GROUP BY user.id
		`,
		input.cadence,
		input.periodEnd,
		input.cadence,
		input.periodStart,
		input.periodEnd,
		createdAt,
		createdAt,
	);
	return Number(result.meta?.changes ?? 0);
}

export async function listRetryableDigestScheduleJobs(
	env: AppEnv,
	input: {
		staleRunningBefore: string;
		maxAttempts: number;
		limit: number;
	},
) {
	const rows = await many<DigestScheduleJobRow>(
		env,
		`
				SELECT ${DIGEST_SCHEDULE_JOB_SELECT}
			FROM digest_schedule_job
			INNER JOIN user ON user.id = digest_schedule_job.user_id
			WHERE digest_schedule_job.attempt_count < ?
				AND (
					digest_schedule_job.status IN ('pending', 'failed')
					OR (
						digest_schedule_job.status = 'running'
						AND digest_schedule_job.processing_started_at <= ?
					)
				)
			ORDER BY digest_schedule_job.period_end ASC, digest_schedule_job.user_id ASC
			LIMIT ?
		`,
		input.maxAttempts,
		input.staleRunningBefore,
		input.limit,
	);
	return rows.map(toDigestScheduleJob);
}

export async function exhaustStaleMaxAttemptDigestScheduleJobs(
  env: AppEnv,
  input: {
    staleRunningBefore: string;
    maxAttempts: number;
    now: string;
  },
) {
  const result = await run(
    env,
    `UPDATE digest_schedule_job
		 SET status = 'exhausted',
		     processing_token = NULL,
		     processing_started_at = NULL,
		     last_error_code = 'digest_schedule_job_lease_exhausted',
		     exhausted_at = COALESCE(exhausted_at, ?),
		     updated_at = ?
		 WHERE status = 'running'
		   AND attempt_count >= ?
		   AND processing_started_at <= ?`,
    input.now,
    input.now,
    input.maxAttempts,
    input.staleRunningBefore,
  );
  return Number(result.meta?.changes ?? 0);
}

export async function claimDigestScheduleJob(
	env: AppEnv,
	input: {
		jobId: string;
		processingToken: string;
		now: string;
		staleRunningBefore: string;
		maxAttempts: number;
	},
) {
	const claim = await run(
		env,
		`
			UPDATE digest_schedule_job
			SET status = 'running',
				processing_token = ?,
				processing_started_at = ?,
				attempt_count = attempt_count + 1,
				last_error_code = NULL,
				updated_at = ?
			WHERE id = ?
				AND attempt_count < ?
				AND (
					status IN ('pending', 'failed')
					OR (status = 'running' AND processing_started_at <= ?)
				)
		`,
		input.processingToken,
		input.now,
		input.now,
		input.jobId,
		input.maxAttempts,
		input.staleRunningBefore,
	);
	if (Number(claim.meta?.changes ?? 0) !== 1) return null;

	const row = await one<DigestScheduleJobRow>(
		env,
		`
				SELECT ${DIGEST_SCHEDULE_JOB_SELECT}
			FROM digest_schedule_job
			INNER JOIN user ON user.id = digest_schedule_job.user_id
			WHERE digest_schedule_job.id = ?
				AND digest_schedule_job.status = 'running'
				AND digest_schedule_job.processing_token = ?
			LIMIT 1
		`,
		input.jobId,
		input.processingToken,
	);
	return row ? toDigestScheduleJob(row) : null;
}

export async function completeDigestScheduleJob(
	env: AppEnv,
	input: { jobId: string; processingToken: string; now: string },
) {
	const result = await run(
		env,
		`
			UPDATE digest_schedule_job
			SET status = 'completed',
				processing_token = NULL,
				processing_started_at = NULL,
				completed_at = ?,
				updated_at = ?
			WHERE id = ?
				AND status = 'running'
				AND processing_token = ?
		`,
		input.now,
		input.now,
		input.jobId,
		input.processingToken,
	);
	return Number(result.meta?.changes ?? 0) === 1;
}

export async function failDigestScheduleJob(
	env: AppEnv,
	input: {
		jobId: string;
		processingToken: string;
		now: string;
			errorCode: string;
			exhausted?: boolean;
		},
) {
	const status = input.exhausted ? "exhausted" : "failed";
	const result = await run(
		env,
		`
			UPDATE digest_schedule_job
				SET status = ?,
					processing_token = NULL,
					processing_started_at = NULL,
					last_error_code = ?,
					exhausted_at = CASE WHEN ? = 'exhausted' THEN ? ELSE exhausted_at END,
					updated_at = ?
			WHERE id = ?
				AND status = 'running'
				AND processing_token = ?
		`,
		status,
		input.errorCode,
		status,
		input.now,
		input.now,
		input.jobId,
		input.processingToken,
	);
	return Number(result.meta?.changes ?? 0) === 1;
}

export async function listExhaustedDigestScheduleJobs(
	env: AppEnv,
	input: { limit: number },
) {
	const limit = Math.max(1, Math.min(100, Math.floor(input.limit)));
	const rows = await many<DigestScheduleJobRow>(
		env,
		`SELECT ${DIGEST_SCHEDULE_JOB_SELECT}
		 FROM digest_schedule_job
		 INNER JOIN user ON user.id = digest_schedule_job.user_id
		 WHERE digest_schedule_job.status = 'exhausted'
		 ORDER BY digest_schedule_job.exhausted_at ASC, digest_schedule_job.id ASC
		 LIMIT ?`,
		limit,
	);
	return rows.map(toDigestScheduleJob);
}

export async function listDigestScheduleJobsAwaitingAlert(
	env: AppEnv,
	input: { staleAlertBefore: string; limit: number },
) {
	const rows = await many<DigestScheduleJobRow>(
		env,
		`SELECT ${DIGEST_SCHEDULE_JOB_SELECT}
		 FROM digest_schedule_job
		 INNER JOIN user ON user.id = digest_schedule_job.user_id
		 WHERE digest_schedule_job.status = 'exhausted'
		   AND digest_schedule_job.exhaustion_alerted_at IS NULL
		   AND (
		     digest_schedule_job.exhaustion_alert_token IS NULL
		     OR digest_schedule_job.exhaustion_alert_started_at <= ?
		   )
		 ORDER BY digest_schedule_job.exhausted_at ASC, digest_schedule_job.id ASC
		 LIMIT ?`,
		input.staleAlertBefore,
		Math.max(1, Math.min(100, Math.floor(input.limit))),
	);
	return rows.map(toDigestScheduleJob);
}

export async function claimDigestScheduleJobExhaustionAlert(
	env: AppEnv,
	input: {
		jobId: string;
		alertToken: string;
		now: string;
		staleAlertBefore: string;
	},
) {
	const result = await run(
		env,
		`UPDATE digest_schedule_job
		 SET exhaustion_alert_token = ?,
		     exhaustion_alert_started_at = ?,
		     updated_at = ?
		 WHERE id = ?
		   AND status = 'exhausted'
		   AND exhaustion_alerted_at IS NULL
		   AND (
		     exhaustion_alert_token IS NULL
		     OR exhaustion_alert_started_at <= ?
		   )`,
		input.alertToken,
		input.now,
		input.now,
		input.jobId,
		input.staleAlertBefore,
	);
	if (Number(result.meta?.changes ?? 0) !== 1) return null;
	const row = await one<DigestScheduleJobRow>(
		env,
		`SELECT ${DIGEST_SCHEDULE_JOB_SELECT}
		 FROM digest_schedule_job
		 INNER JOIN user ON user.id = digest_schedule_job.user_id
		 WHERE digest_schedule_job.id = ?
		   AND digest_schedule_job.exhaustion_alert_token = ?
		 LIMIT 1`,
		input.jobId,
		input.alertToken,
	);
	return row ? toDigestScheduleJob(row) : null;
}

export async function settleDigestScheduleJobExhaustionAlert(
	env: AppEnv,
	input: {
		jobId: string;
		alertToken: string;
		now: string;
		alerted: boolean;
	},
) {
	const result = await run(
		env,
		`UPDATE digest_schedule_job
		 SET exhaustion_alert_token = NULL,
		     exhaustion_alert_started_at = NULL,
		     exhaustion_alerted_at = CASE WHEN ? = 1 THEN ? ELSE NULL END,
		     updated_at = ?
		 WHERE id = ?
		   AND status = 'exhausted'
		   AND exhaustion_alert_token = ?`,
		input.alerted ? 1 : 0,
		input.now,
		input.now,
		input.jobId,
		input.alertToken,
	);
	return Number(result.meta?.changes ?? 0) === 1;
}

interface DigestRunClaimOptions {
	returnClaim: true;
	/**
	 * When present, the claim and its complete item set are committed in one D1
	 * batch transaction. A losing claim writes neither the run nor any items.
	 */
	items?: readonly DigestRunItemInput[];
}

function toDigestRunSummary(
  row: Pick<DigestRunRow, "summary_json">,
): JsonRecord {
	// summary_json is free-form JSON; legacy rows may hold non-object payloads.
	const parsed = parseJson<unknown>(row.summary_json, {});
	return parsed && typeof parsed === "object" && !Array.isArray(parsed)
		? (parsed as JsonRecord)
		: {};
}

function toDigestItemRecord(row: DigestItemRow): DigestItemRecord {
  return {
    id: row.id,
    digestRunId: row.digest_run_id,
    watchlistId: row.watchlist_id,
    watchlistName: row.watchlist_name,
    eventType: row.event_type,
    title: row.title,
    summary: row.summary,
    metadata: parseJson<JsonRecord>(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

function orderDigestItemRecords(rows: readonly DigestItemRow[]) {
  const records = rows.map(toDigestItemRecord);
  return selectDigestCohort(records, records.length).items;
}

function toDigestDeliveryRecord(row: DigestDeliveryRow): DigestDeliveryRecord {
  return {
    id: row.id,
    digestRunId: row.digest_run_id,
    provider: row.provider,
    status: row.status,
    recipientEmail: row.recipient_email,
    externalMessageId: row.external_message_id,
    errorMessage: row.error_message,
    deliveredAt: row.delivered_at,
  };
}

export function createDigestRun(
	env: AppEnv,
	userId: string,
	periodStart: string,
	periodEnd: string,
	summary: JsonRecord,
): Promise<string>;
export function createDigestRun(
	env: AppEnv,
	userId: string,
	periodStart: string,
	periodEnd: string,
	summary: JsonRecord,
	options: DigestRunClaimOptions,
): Promise<DigestRunClaim>;
export async function createDigestRun(
  env: AppEnv,
  userId: string,
  periodStart: string,
  periodEnd: string,
  summary: JsonRecord,
	options?: DigestRunClaimOptions,
): Promise<string | DigestRunClaim> {
  const id = createId();
	const createdAt = nowIso();
	const db = ensureDb(env);
	const itemInputs = options?.items;
  const cohort =
    itemInputs === undefined ? null : selectDigestCohort(itemInputs);
	const persistedItems = cohort === null
		? null
		: cohort.items.map((input) => ({
				id: createId(),
				watchlistId: input.watchlistId,
				watchlistName: input.watchlistName,
				eventType: input.eventType,
				title: input.title,
				summary: input.summary,
				metadata: input.metadata ?? {},
			}));
	const persistedItemsJson = persistedItems === null ? null : JSON.stringify(persistedItems);
	const hasProofCaptureReferences = persistedItems?.some(
		(item) => typeof item.metadata.proofCaptureId === "string" && item.metadata.proofCaptureId.length > 0,
	) === true;
  const persistedSummary =
    itemInputs === undefined
		? summary
		: {
				...summary,
				totalEligibleEvents: cohort!.totalEligibleEvents,
				includedEvents: cohort!.includedEvents,
				omittedEvents: cohort!.omittedEvents,
				totalEvents: cohort!.totalEligibleEvents,
				digestItemSetProvenance: DIGEST_ITEM_SET_PROVENANCE,
			};
	const insertStatement = db
		.prepare(
	      `
	      INSERT INTO digest_run (
        id,
        user_id,
        period_start,
        period_end,
	        summary_json,
	        created_at
	      )
	      ${hasProofCaptureReferences
				? `SELECT ?, ?, ?, ?, ?, ?
				   WHERE NOT EXISTS (
				     SELECT 1
				     FROM json_each(?) AS candidate
				     INNER JOIN proof_capture
				       ON proof_capture.id = json_extract(candidate.value, '$.metadata.proofCaptureId')
				     WHERE json_valid(proof_capture.capture_metadata_json)
				       AND json_type(
				         proof_capture.capture_metadata_json,
				         '${PROOF_CAPTURE_CLEANUP_CLAIM_PATH}'
				       ) IS NOT NULL
				   )`
				: "VALUES (?, ?, ?, ?, ?, ?)"}
	      ON CONFLICT(user_id, period_start, period_end) DO NOTHING
	    `,
		)
		.bind(
			id,
			userId,
			periodStart,
			periodEnd,
				jsonValue(persistedSummary),
				createdAt,
				...(hasProofCaptureReferences ? [persistedItemsJson] : []),
			);

  const itemInsert =
    cohort === null
		? null
		: db
				.prepare(
					`
					  INSERT INTO digest_item (
					    id, digest_run_id, watchlist_id, watchlist_name, event_type,
					    title, summary, metadata_json, created_at
					  )
					  SELECT
					    json_extract(value, '$.id'), ?,
					    json_extract(value, '$.watchlistId'),
					    json_extract(value, '$.watchlistName'),
					    json_extract(value, '$.eventType'),
					    json_extract(value, '$.title'),
					    json_extract(value, '$.summary'),
					    json_extract(value, '$.metadata'), ?
					  FROM json_each(?)
					  INNER JOIN digest_run ON digest_run.id = ?
					`,
				)
					.bind(
						id,
						createdAt,
						persistedItemsJson,
						id,
					);
  const results =
    itemInsert === null
		? [await insertStatement.run()]
		: await db.batch([insertStatement, itemInsert]);

	const created = Number(results[0]?.meta?.changes ?? 0) > 0;
	if (created) {
		return options?.returnClaim ? { digestRunId: id, created: true } : id;
	}

  const row = await one<DigestRunRow>(
    env,
    `
      SELECT *
      FROM digest_run
      WHERE user_id = ?
        AND period_start = ?
        AND period_end = ?
      LIMIT 1
    `,
    userId,
    periodStart,
    periodEnd,
  );

	if (!row) {
		if (hasProofCaptureReferences) {
			throw new Error(PROOF_CAPTURE_CLEANUP_CLAIMED_ERROR);
		}
	    throw new Error(
      "Digest period claim was not created and no existing run was found.",
    );
	}

	return options?.returnClaim
		? { digestRunId: row.id, created: false }
		: row.id;
}

/**
 * Explicitly replaces a digest run's summary_json. Period-claim losers must
 * never call this: the row creator's summary is the immutable delivery source
 * for overlapping executions, retries, and reports.
 */
export async function updateDigestRunSummary(
	env: AppEnv,
	digestRunId: string,
	summary: JsonRecord,
) {
	const row = await one<Pick<DigestRunRow, "summary_json">>(
		env,
		"SELECT summary_json FROM digest_run WHERE id = ? LIMIT 1",
		digestRunId,
	);
	const currentSummary = row ? toDigestRunSummary(row) : {};
	const persistedSummary = { ...summary };
	delete persistedSummary.digestItemSetProvenance;
  if (currentSummary.digestItemSetProvenance === DIGEST_ITEM_SET_PROVENANCE) {
		persistedSummary.digestItemSetProvenance = DIGEST_ITEM_SET_PROVENANCE;
	}
	await run(
		env,
		"UPDATE digest_run SET summary_json = ? WHERE id = ?",
		jsonValue(persistedSummary),
		digestRunId,
	);
}

export async function claimDigestStrategyGenerationLease(
	env: AppEnv,
	digestRunId: string,
	input: {
		expectedLeaseId: string;
		expectedLeaseExpiresAt: string;
		leaseId: string;
		leaseExpiresAt: string;
	},
) {
	const result = await run(
		env,
    `
      UPDATE digest_run
      SET summary_json = json_set(
        summary_json,
        '$.strategyGenerationLeaseId', ?,
        '$.strategyGenerationLeaseExpiresAt', ?
      )
      WHERE id = ?
        AND json_extract(summary_json, '$.strategyGenerationStatus') = ?
        AND COALESCE(json_extract(summary_json, '$.strategyGenerationLeaseId'), '') = ?
        AND COALESCE(json_extract(summary_json, '$.strategyGenerationLeaseExpiresAt'), '') = ?
    `,
		input.leaseId,
		input.leaseExpiresAt,
		digestRunId,
		DIGEST_STRATEGY_GENERATION_PENDING,
		input.expectedLeaseId,
		input.expectedLeaseExpiresAt,
	);
	return Number(result.meta?.changes ?? 0) === 1;
}

export async function completeDigestStrategyGeneration(
	env: AppEnv,
	digestRunId: string,
	input: {
		leaseId: string;
		summary: JsonRecord;
	},
) {
	const row = await one<Pick<DigestRunRow, "summary_json">>(
		env,
		"SELECT summary_json FROM digest_run WHERE id = ? LIMIT 1",
		digestRunId,
	);
	if (!row) {
		return false;
	}

	const currentSummary = toDigestRunSummary(row);
	const persistedSummary: JsonRecord = {
		...currentSummary,
		...input.summary,
		strategyGenerationStatus: DIGEST_STRATEGY_GENERATION_READY,
	};
	delete persistedSummary.strategyGenerationLeaseId;
	delete persistedSummary.strategyGenerationLeaseExpiresAt;
	delete persistedSummary.digestItemSetProvenance;
  if (currentSummary.digestItemSetProvenance === DIGEST_ITEM_SET_PROVENANCE) {
		persistedSummary.digestItemSetProvenance = DIGEST_ITEM_SET_PROVENANCE;
	}

	const result = await run(
		env,
    `
      UPDATE digest_run
      SET summary_json = ?
      WHERE id = ?
        AND json_extract(summary_json, '$.strategyGenerationStatus') = ?
        AND json_extract(summary_json, '$.strategyGenerationLeaseId') = ?
    `,
		jsonValue(persistedSummary),
		digestRunId,
		DIGEST_STRATEGY_GENERATION_PENDING,
		input.leaseId,
	);
	return Number(result.meta?.changes ?? 0) === 1;
}

const LATEST_STRATEGY_SUMMARY_SCAN_LIMIT = 10;

/**
 * Returns the most recent stored AI strategy paragraph whose persisted input
 * provenance belongs exclusively to this watchlist. Legacy, mixed-watchlist,
 * and mismatched notes fail closed. Read-only: never triggers generation.
 */
export async function getLatestDigestRunSummaryForWatchlist(
	env: AppEnv,
	userId: string,
	watchlistId: string,
) {
	const rows = await many<DigestRunRow>(
		env,
    `
      WITH
      js_whitespace(chars) AS (
        VALUES (char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194,
          8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239,
          8287, 12288, 65279))
      ),
      workspace_runs AS (
        SELECT digest_run.*,
          CASE WHEN json_valid(summary_json) THEN summary_json ELSE '{}' END
            AS valid_summary_json
        FROM digest_run
        WHERE user_id = ?
      )
      SELECT id, user_id, period_start, period_end, summary_json, created_at
      FROM workspace_runs
      CROSS JOIN js_whitespace
      WHERE json_type(valid_summary_json, '$.strategyParagraph') = 'text'
        AND trim(
          json_extract(valid_summary_json, '$.strategyParagraph'),
          js_whitespace.chars
        ) != ''
        AND json_type(valid_summary_json, '$.strategyWatchlistIds') = 'array'
        AND json_array_length(valid_summary_json, '$.strategyWatchlistIds') > 0
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(valid_summary_json, '$.strategyWatchlistIds') AS provenance
          WHERE provenance.type != 'text'
             OR trim(provenance.value, js_whitespace.chars) != ?
        )
      ORDER BY period_end DESC
      LIMIT ?
    `,
		userId,
		watchlistId,
		LATEST_STRATEGY_SUMMARY_SCAN_LIMIT,
	);

	for (const row of rows) {
		const note = readDigestStrategyNote(toDigestRunSummary(row));
		if (
			note?.watchlistIds?.length &&
			note.watchlistIds.every((provenanceId) => provenanceId === watchlistId)
		) {
			return {
				paragraph: note.paragraph,
				generatedAt: note.generatedAt,
				periodEnd: row.period_end,
			};
		}
	}

	return null;
}

export async function clearDigestItems(env: AppEnv, digestRunId: string) {
  await run(
    env,
    "DELETE FROM digest_item WHERE digest_run_id = ?",
    digestRunId,
  );
}

export async function addDigestItem(
  env: AppEnv,
  digestRunId: string,
	input: DigestRunItemInput,
) {
  const proofCaptureId = typeof input.metadata?.proofCaptureId === "string" && input.metadata.proofCaptureId.length > 0
    ? input.metadata.proofCaptureId
    : null;
  const result = await run(
    env,
    `
      INSERT INTO digest_item (
        id,
        digest_run_id,
        watchlist_id,
        watchlist_name,
        event_type,
        title,
        summary,
        metadata_json,
        created_at
      )
      ${proofCaptureId
        ? `SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1
             FROM proof_capture
             WHERE id = ?
               AND json_valid(capture_metadata_json)
               AND json_type(capture_metadata_json, '${PROOF_CAPTURE_CLEANUP_CLAIM_PATH}') IS NOT NULL
           )`
        : "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"}
    `,
    createId(),
    digestRunId,
    input.watchlistId,
    input.watchlistName,
    input.eventType,
    input.title,
    input.summary,
    jsonValue(input.metadata ?? {}),
    nowIso(),
    ...(proofCaptureId ? [proofCaptureId] : []),
  );
  if (proofCaptureId && Number(result.meta?.changes ?? 0) !== 1) {
    throw new Error(PROOF_CAPTURE_CLEANUP_CLAIMED_ERROR);
  }
}

export async function upsertDigestDelivery(
  env: AppEnv,
  digestRunId: string,
	input: Omit<DigestDeliveryRecord, "id" | "digestRunId"> & {
		/**
		 * Set ONLY by the writer that won the delivery-attempt claim for this
		 * run. A claim winner may honestly move a 'failed' aggregate back to
		 * 'pending' (e.g. its retry ended provider-unknown); mirror writers that
		 * merely observed someone else's in-flight attempt may not — under a
		 * duplicate cron fire their late 'pending' would bury the failure and
		 * hide the run from the failed-digest retry sweep forever.
		 */
		allowPendingOverwriteOfFailed?: boolean;
	},
) {
  const timestamp = nowIso();
  const allowPendingOverFailed =
    input.allowPendingOverwriteOfFailed === true ? 1 : 0;
  await run(
    env,
    `
      INSERT INTO digest_delivery (
        id,
        digest_run_id,
        provider,
        status,
        recipient_email,
        external_message_id,
        error_message,
        delivered_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(digest_run_id)
      DO UPDATE SET provider = excluded.provider,
                    status = excluded.status,
                    recipient_email = excluded.recipient_email,
                    external_message_id = excluded.external_message_id,
                    error_message = excluded.error_message,
                    delivered_at = excluded.delivered_at,
                    updated_at = excluded.updated_at
      WHERE NOT (
        digest_delivery.status = 'sent'
        AND (
          excluded.status != 'sent'
          OR (
            digest_delivery.delivered_at IS NOT NULL
            AND excluded.delivered_at IS NULL
          )
          OR (
            digest_delivery.delivered_at IS NOT NULL
            AND excluded.delivered_at IS NOT NULL
            AND julianday(excluded.delivered_at) < julianday(digest_delivery.delivered_at)
          )
        )
      )
      AND NOT (
        digest_delivery.status = 'failed'
        AND excluded.status = 'pending'
        AND ? = 0
      )
    `,
    createId(),
    digestRunId,
    input.provider,
    input.status,
    input.recipientEmail,
    input.externalMessageId,
    input.errorMessage,
    input.deliveredAt,
    timestamp,
    timestamp,
			allowPendingOverFailed,
  );
}

const DIGEST_RUN_LIST_LIMIT = 60;

export async function listDigests(
  env: AppEnv,
  userId: string,
  limit: number = DIGEST_RUN_LIST_LIMIT,
) {
  const runs = await many<DigestRunRow>(
    env,
    `
      SELECT *
      FROM digest_run
      WHERE user_id = ?
      ORDER BY period_end DESC
      LIMIT ?
    `,
    userId,
    limit,
  );

  if (runs.length === 0) {
    return [];
  }

  // Join through digest_run instead of expanding run ids into `IN (?, ...)`:
  // D1 caps bound parameters at 100, so long-tenured users with many digest
  // runs would otherwise break this query permanently. Rows from runs that
  // tie on the oldest period_end but fall outside `runs` are ignored by the
  // run-id maps below.
  const oldestPeriodEnd = runs[runs.length - 1]!.period_end;
  const [items, deliveries] = await Promise.all([
    many<DigestItemRow>(
      env,
      `
        SELECT digest_item.*
        FROM digest_item
        INNER JOIN digest_run ON digest_run.id = digest_item.digest_run_id
        WHERE digest_run.user_id = ? AND digest_run.period_end >= ?
        ORDER BY digest_item.created_at ASC
      `,
      userId,
      oldestPeriodEnd,
    ),
    many<DigestDeliveryRow>(
      env,
      `
        SELECT digest_delivery.*
        FROM digest_delivery
        INNER JOIN digest_run ON digest_run.id = digest_delivery.digest_run_id
        WHERE digest_run.user_id = ? AND digest_run.period_end >= ?
      `,
      userId,
      oldestPeriodEnd,
    ),
  ]);
  const itemsByDigestId = new Map<string, DigestItemRow[]>();
  const deliveryByDigestId = new Map<string, DigestDeliveryRow>();

  for (const item of items) {
    const group = itemsByDigestId.get(item.digest_run_id) ?? [];
    group.push(item);
    itemsByDigestId.set(item.digest_run_id, group);
  }

  for (const delivery of deliveries) {
    deliveryByDigestId.set(delivery.digest_run_id, delivery);
  }

  return runs.map((run) => {
    const delivery = deliveryByDigestId.get(run.id) ?? null;
    return {
      id: run.id,
      userId: run.user_id,
      periodStart: run.period_start,
      periodEnd: run.period_end,
			summary: toDigestRunSummary(run),
      createdAt: run.created_at,
      items: orderDigestItemRecords(itemsByDigestId.get(run.id) ?? []),
      delivery: delivery ? toDigestDeliveryRecord(delivery) : null,
    };
  });
}

export async function getDigest(env: AppEnv, digestRunId: string) {
  const run = await one<DigestRunRow>(
    env,
    "SELECT * FROM digest_run WHERE id = ?",
    digestRunId,
  );
  if (!run) {
    return null;
  }
  const [items, delivery] = await Promise.all([
    many<DigestItemRow>(
      env,
      "SELECT * FROM digest_item WHERE digest_run_id = ? ORDER BY created_at ASC",
      digestRunId,
    ),
    one<DigestDeliveryRow>(
      env,
      "SELECT * FROM digest_delivery WHERE digest_run_id = ?",
      digestRunId,
    ),
  ]);

  return {
    id: run.id,
    userId: run.user_id,
    periodStart: run.period_start,
    periodEnd: run.period_end,
		summary: toDigestRunSummary(run),
    createdAt: run.created_at,
    items: orderDigestItemRecords(items),
    delivery: delivery ? toDigestDeliveryRecord(delivery) : null,
  } satisfies DigestRecord;
}

export async function getDigestByPeriod(
  env: AppEnv,
  userId: string,
  periodStart: string,
  periodEnd: string,
) {
  const row = await one<DigestRunRow>(
    env,
    `
      SELECT *
      FROM digest_run
      WHERE user_id = ?
        AND period_start = ?
        AND period_end = ?
      LIMIT 1
    `,
    userId,
    periodStart,
    periodEnd,
  );

  if (!row) {
    return null;
  }

  return getDigest(env, row.id);
}

export async function listRetryableDigestRuns(
  env: AppEnv,
  input: {
    since: string;
		stalePreDispatchBefore: string;
    limit: number;
  },
) {
  const rows = await many<
    DigestRunRow & { user_email: string; user_name: string }
  >(
    env,
    `
      SELECT digest_run.*, user.email AS user_email, user.name AS user_name
      FROM digest_run
      INNER JOIN user ON user.id = digest_run.user_id
      WHERE digest_run.period_end >= ?
        AND (
          NOT EXISTS (
            SELECT 1
            FROM delivery_attempt
            WHERE delivery_attempt.digest_run_id = digest_run.id
          )
          OR EXISTS (
            SELECT 1
            FROM delivery_attempt
            WHERE delivery_attempt.digest_run_id = digest_run.id
              AND delivery_attempt.status = 'failed'
              AND delivery_attempt.webhook_status = 'failed'
          )
          OR EXISTS (
            SELECT 1
            FROM delivery_attempt
            WHERE delivery_attempt.digest_run_id = digest_run.id
              AND delivery_attempt.status = 'pending'
              AND delivery_attempt.webhook_status = 'pending'
              AND delivery_attempt.updated_at <= ?
              AND json_extract(
                delivery_attempt.payload_snapshot_json,
                '$.deliveryClaimProtocol'
              ) = ?
          )
          OR (
            user.emailVerified = 1
            AND COALESCE((
              SELECT workspace_delivery_config.digest_enabled
              FROM workspace_delivery_config
              WHERE workspace_delivery_config.user_id = digest_run.user_id
              LIMIT 1
            ), 1) = 1
            AND COALESCE((
              SELECT workspace_delivery_config.email_enabled
              FROM workspace_delivery_config
              WHERE workspace_delivery_config.user_id = digest_run.user_id
              LIMIT 1
            ), 1) = 1
            AND (
              EXISTS (
                SELECT 1
                FROM delivery_target
                WHERE delivery_target.user_id = digest_run.user_id
                  AND delivery_target.watchlist_id IS NULL
                  AND delivery_target.channel = 'email'
                  AND delivery_target.is_paused = 0
                  AND delivery_target.opted_out_at IS NULL
                  AND delivery_target.validation_status != 'invalid'
                  AND NOT EXISTS (
                    SELECT 1
                    FROM delivery_attempt AS expected_attempt
                    WHERE expected_attempt.digest_run_id = digest_run.id
                      AND expected_attempt.lane = 'customer'
                      AND expected_attempt.channel = 'email'
                      AND LOWER(TRIM(expected_attempt.target_value)) =
                        LOWER(TRIM(delivery_target.target_value))
                  )
              )
              OR (
                TRIM(user.email) != ''
                AND NOT EXISTS (
                  SELECT 1
                  FROM delivery_target
                  WHERE delivery_target.user_id = digest_run.user_id
                    AND delivery_target.watchlist_id IS NULL
                    AND delivery_target.channel = 'email'
                    AND delivery_target.is_paused = 0
                    AND delivery_target.opted_out_at IS NULL
                    AND delivery_target.validation_status != 'invalid'
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM delivery_target
                  WHERE delivery_target.user_id = digest_run.user_id
                    AND delivery_target.watchlist_id IS NULL
                    AND delivery_target.channel = 'email'
                    AND LOWER(TRIM(delivery_target.target_value)) = LOWER(TRIM(user.email))
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM delivery_attempt AS expected_attempt
                  WHERE expected_attempt.digest_run_id = digest_run.id
                    AND expected_attempt.lane = 'customer'
                    AND expected_attempt.channel = 'email'
                    AND LOWER(TRIM(expected_attempt.target_value)) = LOWER(TRIM(user.email))
                )
              )
            )
          )
        )
        AND json_extract(
          digest_run.summary_json,
          '$.digestItemSetProvenance'
        ) = ?
      ORDER BY digest_run.period_end ASC
      LIMIT ?
    `,
    input.since,
		input.stalePreDispatchBefore,
		DIGEST_PROVIDER_CLAIM_PROTOCOL,
		DIGEST_ITEM_SET_PROVENANCE,
    input.limit,
  );

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    userName: row.user_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
  }));
}

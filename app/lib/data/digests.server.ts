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
import type { AppEnv } from "~/lib/env.server";
import type {
  DigestDeliveryRecord,
  DigestItemRecord,
  DigestRecord,
  WatchEventType,
} from "~/lib/types";

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

export interface DigestRunItemInput {
	watchlistId: string;
	watchlistName: string;
	eventType: WatchEventType;
	title: string;
	summary: string;
	metadata?: JsonRecord;
}

interface DigestRunClaimOptions {
	returnClaim: true;
	/**
	 * When present, the claim and its complete item set are committed in one D1
	 * batch transaction. A losing claim writes neither the run nor any items.
	 */
	items?: readonly DigestRunItemInput[];
}

function toDigestRunSummary(row: Pick<DigestRunRow, "summary_json">): JsonRecord {
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
	const cohort = itemInputs === undefined ? null : selectDigestCohort(itemInputs);
	const persistedSummary = itemInputs === undefined
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
      VALUES (?, ?, ?, ?, ?, ?)
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
		);

	const itemInsert = cohort === null
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
					JSON.stringify(
						cohort.items.map((input) => ({
							id: createId(),
							watchlistId: input.watchlistId,
							watchlistName: input.watchlistName,
							eventType: input.eventType,
							title: input.title,
							summary: input.summary,
							metadata: input.metadata ?? {},
						})),
					),
					id,
				);
	const results = itemInsert === null
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
		throw new Error("Digest period claim was not created and no existing run was found.");
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
	if (
		currentSummary.digestItemSetProvenance === DIGEST_ITEM_SET_PROVENANCE
	) {
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
	if (
		currentSummary.digestItemSetProvenance === DIGEST_ITEM_SET_PROVENANCE
	) {
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
  await run(env, "DELETE FROM digest_item WHERE digest_run_id = ?", digestRunId);
}

export async function addDigestItem(
  env: AppEnv,
  digestRunId: string,
	input: DigestRunItemInput,
) {
  await run(
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  );
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
	const allowPendingOverFailed = input.allowPendingOverwriteOfFailed === true ? 1 : 0;
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
      DO UPDATE SET provider = CASE
                      WHEN (digest_delivery.status = 'sent' AND excluded.status != 'sent')
                        OR (digest_delivery.status = 'failed' AND excluded.status = 'pending' AND ? = 0)
                        THEN digest_delivery.provider
                      ELSE excluded.provider
                    END,
                    status = CASE
                      WHEN digest_delivery.status = 'sent' THEN 'sent'
                      WHEN digest_delivery.status = 'failed' AND excluded.status = 'pending' AND ? = 0
                        THEN 'failed'
                      ELSE excluded.status
                    END,
                    recipient_email = CASE
                      WHEN (digest_delivery.status = 'sent' AND excluded.status != 'sent')
                        OR (digest_delivery.status = 'failed' AND excluded.status = 'pending' AND ? = 0)
                        THEN digest_delivery.recipient_email
                      ELSE excluded.recipient_email
                    END,
                    external_message_id = CASE
                      WHEN (digest_delivery.status = 'sent' AND excluded.status != 'sent')
                        OR (digest_delivery.status = 'failed' AND excluded.status = 'pending' AND ? = 0)
                        THEN digest_delivery.external_message_id
                      ELSE excluded.external_message_id
                    END,
                    error_message = CASE
                      WHEN (digest_delivery.status = 'sent' AND excluded.status != 'sent')
                        OR (digest_delivery.status = 'failed' AND excluded.status = 'pending' AND ? = 0)
                        THEN digest_delivery.error_message
                      ELSE excluded.error_message
                    END,
                    delivered_at = CASE
                      WHEN (digest_delivery.status = 'sent' AND excluded.status != 'sent')
                        OR (digest_delivery.status = 'failed' AND excluded.status = 'pending' AND ? = 0)
                        THEN digest_delivery.delivered_at
                      ELSE excluded.delivered_at
                    END,
                    updated_at = excluded.updated_at
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
		allowPendingOverFailed,
		allowPendingOverFailed,
		allowPendingOverFailed,
		allowPendingOverFailed,
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
      items: (itemsByDigestId.get(run.id) ?? []).map(toDigestItemRecord),
      delivery: delivery ? toDigestDeliveryRecord(delivery) : null,
    };
  });
}

export async function getDigest(env: AppEnv, digestRunId: string) {
  const run = await one<DigestRunRow>(env, "SELECT * FROM digest_run WHERE id = ?", digestRunId);
  if (!run) {
    return null;
  }
  const [items, delivery] = await Promise.all([
    many<DigestItemRow>(
      env,
      "SELECT * FROM digest_item WHERE digest_run_id = ? ORDER BY created_at ASC",
      digestRunId,
    ),
    one<DigestDeliveryRow>(env, "SELECT * FROM digest_delivery WHERE digest_run_id = ?", digestRunId),
  ]);

  return {
    id: run.id,
    userId: run.user_id,
    periodStart: run.period_start,
    periodEnd: run.period_end,
		summary: toDigestRunSummary(run),
    createdAt: run.created_at,
    items: items.map(toDigestItemRecord),
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
      LEFT JOIN digest_delivery ON digest_delivery.digest_run_id = digest_run.id
      WHERE digest_run.period_end >= ?
        AND (
          digest_delivery.status = 'failed'
          OR digest_delivery.id IS NULL
          OR EXISTS (
            SELECT 1
            FROM delivery_attempt
            WHERE delivery_attempt.digest_run_id = digest_run.id
              AND delivery_attempt.status = 'pending'
              AND delivery_attempt.webhook_status = 'pending'
              AND delivery_attempt.updated_at <= ?
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

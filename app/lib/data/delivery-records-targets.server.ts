import {
  ensureDb,
  execute as run,
  queryAll as many,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  toDeliveryTargetRecord,
  type DeliveryTargetRow,
} from "~/lib/data/delivery-records-rows.server";
import {
  boolToInt,
  createId,
  jsonValue,
  nowIso,
  parseJson,
  type JsonRecord,
} from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import {
  isSlackWebhookDeliveryCustomerFacing,
  isTeamsWebhookDeliveryCustomerFacing,
  isWhatsAppDeliveryCustomerFacing,
} from "~/lib/ga-customer-surface";
import type {
  DeliveryChannel,
  DeliveryTargetValidationStatus,
} from "~/lib/types";

export async function listDeliveryTargets(
  env: AppEnv,
  userId: string,
  options: {
    watchlistId?: string | null;
    channel?: DeliveryChannel;
    targetValue?: string;
    limit?: number;
  } = {},
) {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 20)));
  const clauses = ["user_id = ?"];
  const bindings: unknown[] = [userId];
  if (options.watchlistId !== undefined) {
    clauses.push(options.watchlistId === null ? "watchlist_id IS NULL" : "watchlist_id = ?");
    if (options.watchlistId !== null) {
      bindings.push(options.watchlistId);
    }
  }
  if (options.channel) {
    clauses.push("channel = ?");
    bindings.push(options.channel);
  }
  if (options.targetValue !== undefined) {
    clauses.push("lower(trim(target_value)) = lower(trim(?))");
    bindings.push(options.targetValue);
  }

  const rows = await many<DeliveryTargetRow>(
    env,
    `
      SELECT *
      FROM delivery_target
      WHERE ${clauses.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    ...bindings,
    limit,
  );

  return rows.map(toDeliveryTargetRecord);
}

export async function hasSuppressedEmailTargetForUserAndAddress(
  env: AppEnv,
  input: { userId: string; targetValue: string },
) {
  const row = await one<{ suppressed: number }>(
    env,
    `
      SELECT 1 AS suppressed
      FROM delivery_target
      WHERE user_id = ?
        AND channel = 'email'
        AND lower(trim(target_value)) = lower(trim(?))
        AND opted_out_at IS NOT NULL
      LIMIT 1
    `,
    input.userId,
    input.targetValue,
  );
  return row?.suppressed === 1;
}

/**
 * Lazily creates one validated workspace email target without reopening an
 * address that was unsubscribed in any target scope. The NOT EXISTS predicate
 * and insert share one SQLite statement, so a concurrent unsubscribe either
 * blocks this insert or suppresses the inserted row before the later dispatch
 * CAS can advance.
 */
export async function provisionVerifiedAccountEmailTargetIfUnsuppressed(
  env: AppEnv,
  input: {
    userId: string;
    targetValue: string;
    optInSource: string;
    metadata?: JsonRecord;
  },
) {
  const targetValue = normalizeDeliveryTargetValue("email", input.targetValue);
  if (!targetValue) return null;

  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT OR IGNORE INTO delivery_target (
        id,
        user_id,
        watchlist_id,
        channel,
        target_value,
        validation_status,
        is_validated,
        is_opted_in,
        opt_in_source,
        opted_in_at,
        is_paused,
        paused_at,
        opted_out_at,
        template_eligible,
        last_successful_delivery_at,
        last_successful_attempt_id,
        provider_identifier,
        metadata_json,
        created_at,
        updated_at
      )
      SELECT
        ?, ?, NULL, 'email', ?, 'validated', 1, 1, ?, ?, 0, NULL, NULL,
        0, NULL, NULL, NULL, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1
        FROM delivery_target
        WHERE user_id = ?
          AND channel = 'email'
          AND lower(trim(target_value)) = lower(trim(?))
          AND opted_out_at IS NOT NULL
      )
    `,
    createId(),
    input.userId,
    targetValue,
    input.optInSource,
    timestamp,
    jsonValue(input.metadata ?? {}),
    timestamp,
    timestamp,
    input.userId,
    targetValue,
  );

  const target = await getDeliveryTargetByUniqueFields(env, {
    userId: input.userId,
    watchlistId: null,
    channel: "email",
    targetValue,
  });
  if (
    !target ||
    !target.isOptedIn ||
    target.isPaused ||
    target.optedOutAt ||
    !target.isValidated ||
    target.validationStatus !== "validated"
  ) {
    return null;
  }
  return target;
}

export async function getDeliveryTargetReadinessStats(env: AppEnv, userId: string) {
  const channelPredicates = [
    `
      (
        channel = 'email'
        AND is_opted_in = 1
        AND is_paused = 0
        AND opted_out_at IS NULL
        AND is_validated = 1
        AND validation_status = 'validated'
      )
    `,
  ];
  if (isSlackWebhookDeliveryCustomerFacing()) {
    channelPredicates.push(`
      (
        channel = 'slack'
        AND is_opted_in = 1
        AND is_paused = 0
        AND opted_out_at IS NULL
        AND is_validated = 1
        AND validation_status = 'validated'
      )
    `);
  }
  if (isTeamsWebhookDeliveryCustomerFacing()) {
    channelPredicates.push(`
      (
        channel = 'teams'
        AND is_opted_in = 1
        AND is_paused = 0
        AND opted_out_at IS NULL
        AND is_validated = 1
        AND validation_status = 'validated'
      )
    `);
  }
  if (isWhatsAppDeliveryCustomerFacing()) {
    channelPredicates.push(`
      (
        channel = 'whatsapp'
        AND is_opted_in = 1
        AND is_paused = 0
        AND opted_out_at IS NULL
        AND is_validated = 1
        AND validation_status = 'validated'
        AND template_eligible = 1
      )
    `);
  }

  const row = await one<{
    active_count: number | null;
    proven_count: number | null;
  }>(
    env,
    `
      WITH usable_targets AS (
        SELECT last_successful_delivery_at
        FROM delivery_target
        WHERE user_id = ?
          AND (${channelPredicates.join(" OR ")})
      )
      SELECT
        COUNT(*) AS active_count,
        SUM(CASE
          WHEN last_successful_delivery_at IS NOT NULL
          THEN 1 ELSE 0
        END) AS proven_count
      FROM usable_targets
    `,
    userId,
  );

  return {
    activeCount: Number(row?.active_count ?? 0),
    provenCount: Number(row?.proven_count ?? 0),
  };
}

export async function upsertDeliveryTarget(
  env: AppEnv,
  input: {
    userId: string;
    watchlistId?: string | null;
    channel: DeliveryChannel;
    targetValue: string;
    validationStatus?: DeliveryTargetValidationStatus;
    isValidated?: boolean;
    isOptedIn?: boolean;
    optInSource?: string | null;
    optedInAt?: string | null;
    isPaused?: boolean;
    pausedAt?: string | null;
    optedOutAt?: string | null;
    templateEligible?: boolean;
    lastSuccessfulDeliveryAt?: string | null;
    lastSuccessfulAttemptId?: string | null;
    providerIdentifier?: string | null;
    metadata?: JsonRecord;
  },
) {
  const targetValue = normalizeDeliveryTargetValue(input.channel, input.targetValue);
  const existingTarget = await getDeliveryTargetByUniqueFields(env, {
    userId: input.userId,
    watchlistId: input.watchlistId ?? null,
    channel: input.channel,
    targetValue,
  });
  const timestamp = nowIso();
  if (existingTarget) {
    const inputGeneration = readMetadataString(input.metadata, "validationGeneration");
    const existingGeneration = readMetadataString(
      existingTarget.metadata,
      "validationGeneration",
    );
    const existingValidationMessageId = readMetadataString(
      existingTarget.metadata,
      "validationProviderMessageId",
    );
    const preserveCurrentWhatsAppValidation =
      input.channel === "whatsapp" &&
      input.validationStatus === "pending" &&
      inputGeneration !== null &&
      inputGeneration === existingGeneration &&
      existingValidationMessageId !== null;
    const effectiveInput = preserveCurrentWhatsAppValidation
      ? {
          ...input,
          validationStatus: existingTarget.validationStatus,
          isValidated: existingTarget.isValidated,
          templateEligible: existingTarget.templateEligible,
          lastSuccessfulDeliveryAt: existingTarget.lastSuccessfulDeliveryAt,
          lastSuccessfulAttemptId: existingTarget.lastSuccessfulAttemptId,
          providerIdentifier: existingTarget.providerIdentifier,
          metadata: {
            ...(input.metadata ?? {}),
            ...existingTarget.metadata,
            ...(input.metadata && "displayName" in input.metadata
              ? { displayName: input.metadata.displayName }
              : {}),
          },
        }
      : input;
    await run(
      env,
      `
        UPDATE delivery_target
        SET target_value = ?,
            validation_status = ?,
            is_validated = ?,
            is_opted_in = ?,
            opt_in_source = ?,
            opted_in_at = ?,
            is_paused = ?,
            paused_at = ?,
            opted_out_at = ?,
            template_eligible = ?,
            last_successful_delivery_at = ?,
            last_successful_attempt_id = ?,
            provider_identifier = ?,
            metadata_json = ?,
            updated_at = ?
        WHERE id = ?
      `,
      targetValue,
      effectiveInput.validationStatus ?? "pending",
      boolToInt(effectiveInput.isValidated ?? false),
      boolToInt(effectiveInput.isOptedIn ?? false),
      effectiveInput.optInSource ?? null,
      effectiveInput.optedInAt ?? null,
      boolToInt(effectiveInput.isPaused ?? false),
      effectiveInput.pausedAt ?? null,
      effectiveInput.optedOutAt ?? null,
      boolToInt(effectiveInput.templateEligible ?? false),
      effectiveInput.lastSuccessfulDeliveryAt ?? null,
      effectiveInput.lastSuccessfulAttemptId ?? null,
      effectiveInput.providerIdentifier ?? null,
      jsonValue(effectiveInput.metadata ?? {}),
      timestamp,
      existingTarget.id,
    );
  } else {
    await run(
      env,
      `
        INSERT INTO delivery_target (
          id,
          user_id,
          watchlist_id,
          channel,
          target_value,
          validation_status,
          is_validated,
          is_opted_in,
          opt_in_source,
          opted_in_at,
          is_paused,
          paused_at,
          opted_out_at,
          template_eligible,
          last_successful_delivery_at,
          last_successful_attempt_id,
          provider_identifier,
          metadata_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      createId(),
      input.userId,
      input.watchlistId ?? null,
      input.channel,
      targetValue,
      input.validationStatus ?? "pending",
      boolToInt(input.isValidated ?? false),
      boolToInt(input.isOptedIn ?? false),
      input.optInSource ?? null,
      input.optedInAt ?? null,
      boolToInt(input.isPaused ?? false),
      input.pausedAt ?? null,
      input.optedOutAt ?? null,
      boolToInt(input.templateEligible ?? false),
      input.lastSuccessfulDeliveryAt ?? null,
      input.lastSuccessfulAttemptId ?? null,
      input.providerIdentifier ?? null,
      jsonValue(input.metadata ?? {}),
      timestamp,
      timestamp,
    );
  }

  const [target] = await listDeliveryTargets(env, input.userId, {
    watchlistId: input.watchlistId ?? null,
    channel: input.channel,
    limit: 1,
  });
  return target ?? null;
}

function readMetadataString(metadata: JsonRecord | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function reconcileWhatsAppSetupTargetFromAttempt(
  env: AppEnv,
  input: {
    userId: string;
    targetId: string;
    attemptId: string;
    providerMessageId: string;
    validationGeneration: string | null;
    webhookStatus: "pending" | "delivered" | "failed";
    providerStatusLastSeenAt: string;
    errorMessage: string | null;
  },
) {
  const incomingSeenAt = Date.parse(input.providerStatusLastSeenAt);
  if (!Number.isFinite(incomingSeenAt)) return null;

  for (let retry = 0; retry < 2; retry += 1) {
    const existing = await one<DeliveryTargetRow>(
      env,
      `SELECT * FROM delivery_target
       WHERE id = ? AND user_id = ? AND channel = 'whatsapp'
       LIMIT 1`,
      input.targetId,
      input.userId,
    );
    if (!existing) return null;

    const metadata = parseJson<JsonRecord>(existing.metadata_json, {});
    const currentGeneration = readMetadataString(metadata, "validationGeneration");
    const currentAttemptId = readMetadataString(metadata, "validationAttemptId");
    const currentMessageId = readMetadataString(metadata, "validationProviderMessageId");
    const currentStatus = readMetadataString(metadata, "validationWebhookStatus");
    const replacingFailedAttempt =
      currentStatus === "failed" &&
      currentGeneration !== null &&
      currentGeneration === input.validationGeneration &&
      currentAttemptId === input.attemptId &&
      currentMessageId !== null &&
      currentMessageId !== input.providerMessageId &&
      (existing.provider_identifier === null || existing.provider_identifier === currentMessageId);
    if (
      (input.validationGeneration !== null && currentGeneration !== input.validationGeneration) ||
      (input.validationGeneration === null && currentMessageId !== input.providerMessageId) ||
      (currentMessageId !== null &&
        currentMessageId !== input.providerMessageId &&
        !replacingFailedAttempt) ||
      (existing.provider_identifier !== null &&
        existing.provider_identifier !== input.providerMessageId &&
        !replacingFailedAttempt)
    ) {
      return toDeliveryTargetRecord(existing);
    }

    const currentSeenAtValue = readMetadataString(metadata, "validationStatusLastSeenAt");
    const currentSeenAt = currentSeenAtValue
      ? Date.parse(currentSeenAtValue)
      : Number.NEGATIVE_INFINITY;
    const currentTerminal = currentStatus === "delivered" || currentStatus === "failed";
    const incomingTerminal = input.webhookStatus !== "pending";
    if (
      incomingSeenAt < currentSeenAt ||
      (currentTerminal && currentStatus !== input.webhookStatus && !replacingFailedAttempt) ||
      (currentTerminal && !incomingTerminal && !replacingFailedAttempt)
    ) {
      return toDeliveryTargetRecord(existing);
    }

    const delivered = input.webhookStatus === "delivered";
    const failed = input.webhookStatus === "failed";
    const updatedAt = nowIso();
    const nextMetadata: JsonRecord = {
      ...metadata,
      validationAttemptId: input.attemptId,
      validationProviderMessageId: input.providerMessageId,
      validationWebhookStatus: input.webhookStatus,
      validationStatusLastSeenAt: input.providerStatusLastSeenAt,
      validationErrorMessage: failed
        ? (input.errorMessage ?? "WhatsApp setup delivery failed.")
        : null,
    };
    const updated = await run(
      env,
      `UPDATE delivery_target
       SET validation_status = ?,
           is_validated = ?,
           template_eligible = ?,
           last_successful_delivery_at = ?,
           last_successful_attempt_id = ?,
           provider_identifier = ?,
           metadata_json = ?,
           updated_at = ?
       WHERE id = ?
         AND user_id = ?
         AND channel = 'whatsapp'
         AND updated_at = ?
         AND metadata_json = ?
         AND (
           provider_identifier IS NULL
           OR provider_identifier = ?
           OR (? = 1 AND provider_identifier = ?)
         )`,
      delivered ? "validated" : failed ? "invalid" : replacingFailedAttempt ? "pending" : existing.validation_status,
      delivered ? 1 : failed ? 0 : existing.is_validated,
      delivered ? 1 : failed ? 0 : existing.template_eligible,
      delivered ? input.providerStatusLastSeenAt : existing.last_successful_delivery_at,
      delivered ? input.attemptId : existing.last_successful_attempt_id,
      input.providerMessageId,
      jsonValue(nextMetadata),
      updatedAt,
      existing.id,
      input.userId,
      existing.updated_at,
      existing.metadata_json,
      input.providerMessageId,
      replacingFailedAttempt ? 1 : 0,
      currentMessageId,
    );
    if (Number(updated.meta?.changes ?? 0) === 1) {
      const durable = await one<DeliveryTargetRow>(
        env,
        "SELECT * FROM delivery_target WHERE id = ?",
        existing.id,
      );
      return durable ? toDeliveryTargetRecord(durable) : null;
    }
  }

  return getDeliveryTargetById(env, {
    userId: input.userId,
    targetId: input.targetId,
  });
}

async function getDeliveryTargetByUniqueFields(
  env: AppEnv,
  input: {
    userId: string;
    watchlistId: string | null;
    channel: DeliveryChannel;
    targetValue: string;
  },
) {
  const row = await one<DeliveryTargetRow>(
    env,
    `
      SELECT *
      FROM delivery_target
      WHERE user_id = ?
        AND ${input.watchlistId === null ? "watchlist_id IS NULL" : "watchlist_id = ?"}
        AND channel = ?
        AND ${input.channel === "email" ? "lower(trim(target_value)) = ?" : "target_value = ?"}
      LIMIT 1
    `,
    ...[
      input.userId,
      ...(input.watchlistId === null ? [] : [input.watchlistId]),
      input.channel,
      input.targetValue,
    ],
  );

  return row ? toDeliveryTargetRecord(row) : null;
}

export async function reconcileWhatsAppSetupTargetByProviderMessageId(
  env: AppEnv,
  input: {
    providerMessageId: string;
    webhookStatus: "delivered" | "failed";
    providerStatusLastSeenAt: string;
    errorMessage: string | null;
  },
) {
  const existing = await one<DeliveryTargetRow>(
    env,
    `SELECT * FROM delivery_target
     WHERE channel = 'whatsapp' AND provider_identifier = ?
     ORDER BY updated_at DESC LIMIT 1`,
    input.providerMessageId,
  );
  if (!existing) return null;
  const metadata = parseJson<JsonRecord>(existing.metadata_json, {});
  if (metadata.validationProviderMessageId !== input.providerMessageId) {
    return toDeliveryTargetRecord(existing);
  }
  const incomingSeenAt = Date.parse(input.providerStatusLastSeenAt);
  const currentSeenAt = typeof metadata.validationStatusLastSeenAt === "string"
    ? Date.parse(metadata.validationStatusLastSeenAt)
    : Number.NEGATIVE_INFINITY;
  const currentStatus = metadata.validationWebhookStatus;
  const currentTerminal = currentStatus === "delivered" || currentStatus === "failed";
  if (
    !Number.isFinite(incomingSeenAt) ||
    incomingSeenAt < currentSeenAt ||
    (currentTerminal && currentStatus !== input.webhookStatus)
  ) {
    return toDeliveryTargetRecord(existing);
  }
  const delivered = input.webhookStatus === "delivered";
  const nextMetadata = {
    ...metadata,
    validationWebhookStatus: input.webhookStatus,
    validationStatusLastSeenAt: input.providerStatusLastSeenAt,
    validationErrorMessage: delivered
      ? null
      : (input.errorMessage ?? "WhatsApp setup delivery failed."),
    validationReconciledWithoutAttempt: true,
  };
  await run(
    env,
    `UPDATE delivery_target
     SET validation_status = ?, is_validated = ?, template_eligible = ?,
         last_successful_delivery_at = ?, metadata_json = ?, updated_at = ?
     WHERE id = ? AND provider_identifier = ? AND updated_at = ? AND metadata_json = ?`,
    delivered ? "validated" : "invalid",
    boolToInt(delivered),
    boolToInt(delivered),
    delivered ? input.providerStatusLastSeenAt : existing.last_successful_delivery_at,
    jsonValue(nextMetadata),
    nowIso(),
    existing.id,
    input.providerMessageId,
    existing.updated_at,
    existing.metadata_json,
  );
  const durable = await one<DeliveryTargetRow>(
    env,
    "SELECT * FROM delivery_target WHERE id = ?",
    existing.id,
  );
  return durable ? toDeliveryTargetRecord(durable) : null;
}

export async function getDeliveryTargetById(
  env: AppEnv,
  input: {
    userId: string;
    targetId: string;
  },
) {
  const row = await one<DeliveryTargetRow>(
    env,
    `
      SELECT *
      FROM delivery_target
      WHERE user_id = ?
        AND id = ?
      LIMIT 1
    `,
    input.userId,
    input.targetId,
  );

  return row ? toDeliveryTargetRecord(row) : null;
}

/**
 * Atomically suppress every email target for this account/address pair.
 * Email addresses are case-insensitive and may be attached to both a
 * workspace-wide target and one or more watchlists, so unsubscribe must not
 * stop at the target represented by the link.
 */
export async function suppressEmailTargetsForUserAndAddress(
  env: AppEnv,
  input: { userId: string; targetValue: string; source?: string },
) {
  const timestamp = nowIso();
  const db = ensureDb(env);
  const targetSuppression = db
    .prepare(
      `
      UPDATE delivery_target
      SET is_opted_in = 0,
          is_paused = 1,
          paused_at = COALESCE(paused_at, ?),
          opted_out_at = COALESCE(opted_out_at, ?),
          metadata_json = json_set(
            COALESCE(metadata_json, '{}'),
            '$.unsubscribedVia',
            ?
          ),
          updated_at = ?
      WHERE user_id = ?
        AND channel = 'email'
        AND lower(trim(target_value)) = lower(trim(?))
      `,
    )
    .bind(
      timestamp,
      timestamp,
      input.source ?? "email_unsubscribe_link",
      timestamp,
      input.userId,
      input.targetValue,
    );

  // The target state and the pre-dispatch attempt state must commit together.
  // A test send that has already moved its attempt to provider_unknown has won
  // the race and is intentionally left alone; a pending claim is cancelled by
  // this same transaction and therefore cannot pass its dispatch CAS later.
  const pendingAttemptSuppression = db
    .prepare(
      `
        UPDATE delivery_attempt
        SET status = 'failed',
            webhook_status = 'failed',
            error_message = 'Email delivery target was unsubscribed before dispatch.',
            failed_at = ?,
            updated_at = ?
        WHERE user_id = ?
          AND channel = 'email'
          AND status = 'pending'
          AND webhook_status = 'pending'
          AND delivery_target_id IN (
            SELECT id
            FROM delivery_target
            WHERE user_id = ?
              AND channel = 'email'
              AND lower(trim(target_value)) = lower(trim(?))
          )
      `,
    )
    .bind(timestamp, timestamp, input.userId, input.userId, input.targetValue);

  const [targetResult] = await db.batch([targetSuppression, pendingAttemptSuppression]);
  return Number(targetResult?.meta?.changes ?? 0);
}

/**
 * Atomically re-opt every email target suppressed for this account/address
 * pair. Unsubscribe is account-and-address-wide, so the workspace-default
 * target cannot be resumed safely with a per-target upsert. A target that was
 * already paused before the unsubscribe remains paused after the re-opt.
 */
export async function resumeEmailTargetsForUserAndAddress(
  env: AppEnv,
  input: { userId: string; targetValue: string; source?: string },
) {
  const timestamp = nowIso();
  const result = await ensureDb(env)
    .prepare(
      `
        UPDATE delivery_target
        SET is_opted_in = 1,
            opt_in_source = ?,
            opted_in_at = ?,
            is_paused = CASE
              WHEN paused_at = opted_out_at THEN 0
              ELSE is_paused
            END,
            paused_at = CASE
              WHEN paused_at = opted_out_at THEN NULL
              ELSE paused_at
            END,
            opted_out_at = NULL,
            metadata_json = json_remove(
              COALESCE(metadata_json, '{}'),
              '$.unsubscribedVia'
            ),
            updated_at = ?
        WHERE user_id = ?
          AND channel = 'email'
          AND lower(trim(target_value)) = lower(trim(?))
          AND is_opted_in = 0
          AND opted_out_at IS NOT NULL
      `,
    )
    .bind(
      input.source ?? "delivery_settings",
      timestamp,
      timestamp,
      input.userId,
      input.targetValue,
    )
    .run();

  return Number(result?.meta?.changes ?? 0);
}

/**
 * Claims an active email target immediately before a user-requested test
 * send. The UPDATE is the CAS: an unsubscribe that commits first changes the
 * target state and therefore yields zero rows here, so the provider is never
 * called for a suppressed target.
 */
export async function claimEmailTargetForDispatch(
  env: AppEnv,
  input: { userId: string; targetId: string },
) {
  const timestamp = nowIso();
  const result = await run(
    env,
    `
      UPDATE delivery_target
      SET target_value = lower(trim(target_value)),
          updated_at = ?
      WHERE id = ?
        AND user_id = ?
        AND channel = 'email'
        AND is_opted_in = 1
        AND is_paused = 0
        AND opted_out_at IS NULL
        AND is_validated = 1
        AND validation_status = 'validated'
        AND EXISTS (
          SELECT 1
          FROM user
          WHERE user.id = delivery_target.user_id
            AND user.emailVerified = 1
            AND lower(trim(user.email)) = lower(trim(delivery_target.target_value))
        )
    `,
    timestamp,
    input.targetId,
    input.userId,
  );
  if (Number(result.meta?.changes ?? 0) === 0) {
    return null;
  }

  const target = await getDeliveryTargetById(env, input);
  if (
    !target ||
    target.channel !== "email" ||
    !target.isOptedIn ||
    target.isPaused ||
    target.optedOutAt ||
    !target.isValidated ||
    target.validationStatus !== "validated"
  ) {
    return null;
  }

  return target;
}

function normalizeDeliveryTargetValue(channel: DeliveryChannel, value: string) {
  return channel === "email" ? value.trim().toLowerCase() : value;
}

export async function getDeliveryTargetByProviderIdentifier(
  env: AppEnv,
  input: {
    channel: DeliveryChannel;
    providerIdentifier: string;
  },
) {
  const row = await one<DeliveryTargetRow>(
    env,
    `
      SELECT *
      FROM delivery_target
      WHERE channel = ?
        AND provider_identifier = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    input.channel,
    input.providerIdentifier,
  );

  return row ? toDeliveryTargetRecord(row) : null;
}

import {
  execute as run,
  queryAll as many,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  toDeliveryTargetRecord,
  type DeliveryTargetRow,
} from "~/lib/data/delivery-records-rows.server";
import { boolToInt, createId, jsonValue, nowIso, parseJson, type JsonRecord } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import {
  isSlackDeliveryCustomerFacing,
  isWhatsAppDeliveryCustomerFacing,
} from "~/lib/ga-customer-surface";
import type {
  DeliveryChannel,
  DeliveryTargetValidationStatus,
} from "~/lib/types";

export async function listDeliveryTargets(
  env: AppEnv,
  userId: string,
  options: { watchlistId?: string | null; channel?: DeliveryChannel; limit?: number } = {},
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
  if (isSlackDeliveryCustomerFacing()) {
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
  const existingTarget = await getDeliveryTargetByUniqueFields(env, {
    userId: input.userId,
    watchlistId: input.watchlistId ?? null,
    channel: input.channel,
    targetValue: input.targetValue,
  });
  const timestamp = nowIso();
  if (existingTarget) {
    await run(
      env,
      `
        UPDATE delivery_target
        SET validation_status = ?,
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
      input.targetValue,
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
        AND target_value = ?
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
const existing = await one<DeliveryTargetRow>(env, `
		SELECT * FROM delivery_target
		WHERE channel = 'whatsapp' AND provider_identifier = ?
		ORDER BY updated_at DESC LIMIT 1
	`, input.providerMessageId);
if (!existing) return null;
const metadata = parseJson<JsonRecord>(existing.metadata_json, {});
if (metadata.validationProviderMessageId !== input.providerMessageId) {
return toDeliveryTargetRecord(existing);
}
const incomingSeenAt = Date.parse(input.providerStatusLastSeenAt);
const currentSeenAt = typeof metadata.validationStatusLastSeenAt === "string"
? Date.parse(metadata.validationStatusLastSeenAt) : Number.NEGATIVE_INFINITY;
const currentStatus = metadata.validationWebhookStatus;
const currentTerminal = currentStatus === "delivered" || currentStatus === "failed";
if (!Number.isFinite(incomingSeenAt) || incomingSeenAt < currentSeenAt
|| (currentTerminal && currentStatus !== input.webhookStatus)) {
return toDeliveryTargetRecord(existing);
}
const delivered = input.webhookStatus === "delivered";
const nextMetadata = {
...metadata,
validationWebhookStatus: input.webhookStatus,
validationStatusLastSeenAt: input.providerStatusLastSeenAt,
validationErrorMessage: delivered ? null : input.errorMessage ?? "WhatsApp setup delivery failed.",
validationReconciledWithoutAttempt: true,
};
await run(env, `
		UPDATE delivery_target
		SET validation_status = ?, is_validated = ?, template_eligible = ?,
			last_successful_delivery_at = ?, metadata_json = ?, updated_at = ?
		WHERE id = ? AND provider_identifier = ? AND updated_at = ? AND metadata_json = ?
	`, delivered ? "validated" : "invalid", boolToInt(delivered), boolToInt(delivered),
delivered ? input.providerStatusLastSeenAt : existing.last_successful_delivery_at,
jsonValue(nextMetadata), nowIso(), existing.id, input.providerMessageId,
existing.updated_at, existing.metadata_json);
const durable = await one<DeliveryTargetRow>(
env, "SELECT * FROM delivery_target WHERE id = ?", existing.id,
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

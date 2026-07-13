import {
  ensureDb,
  execute as run,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  toWorkspaceDeliveryConfigRecord,
  type WorkspaceDeliveryConfigRow,
} from "~/lib/data/delivery-records-rows.server";
import { boolToInt, createId, jsonValue, nowIso } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import type { DeliveryQuietHours, SensitivityMode } from "~/lib/types";

export function legacyWorkspaceDeliveryDefaults(input: { hasEmail: boolean }) {
  return {
    sensitivityMode: "balanced" as const,
    instantEnabled: false,
    digestEnabled: true,
    emailEnabled: input.hasEmail,
    whatsappEnabled: false,
    slackEnabled: false,
  };
}

// After a verified email change, the auto-provisioned delivery target still
// points at the OLD address — and because any usable target short-circuits
// auto-provisioning, the customer's digests/alerts would silently keep going
// to an inbox they may have lost. Retarget those rows to the new address.
export async function migrateAutoProvisionedEmailTargets(
  env: AppEnv,
  userId: string,
  newEmail: string,
) {
  const db = ensureDb(env);
  const timestamp = nowIso();

  // UPDATE OR IGNORE skips rows whose new-address twin already exists
  // (unique indexes on user/watchlist/channel/value)…
  const updated = await db
    .prepare(
      `
        UPDATE OR IGNORE delivery_target
        SET target_value = ?,
            validation_status = 'validated',
            is_validated = 1,
            updated_at = ?
        WHERE user_id = ?
          AND channel = 'email'
          AND opt_in_source = 'account_email'
          AND opted_out_at IS NULL
          AND target_value != ?
      `,
    )
    .bind(newEmail, timestamp, userId, newEmail)
    .run();

  // …and any stale row that couldn't be updated (twin existed) is removed.
  await db
    .prepare(
      `
        DELETE FROM delivery_target
        WHERE user_id = ?
          AND channel = 'email'
          AND opt_in_source = 'account_email'
          AND opted_out_at IS NULL
          AND target_value != ?
      `,
    )
    .bind(userId, newEmail)
    .run();

  return Number(updated.meta?.changes ?? 0);
}

export async function getWorkspaceDeliveryConfig(env: AppEnv, userId: string) {
  const row = await one<WorkspaceDeliveryConfigRow>(
    env,
    `
      SELECT *
      FROM workspace_delivery_config
      WHERE user_id = ?
      LIMIT 1
    `,
    userId,
  );

  return row ? toWorkspaceDeliveryConfigRecord(row) : null;
}

export async function upsertWorkspaceDeliveryConfig(
  env: AppEnv,
  input: {
    userId: string;
    sensitivityMode: SensitivityMode;
    instantEnabled: boolean;
    digestEnabled: boolean;
    emailEnabled: boolean;
    whatsappEnabled: boolean;
    slackEnabled?: boolean;
    quietHours?: DeliveryQuietHours | null;
    timezone?: string | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO workspace_delivery_config (
        id,
        user_id,
        sensitivity_mode,
        instant_enabled,
        digest_enabled,
        email_enabled,
        whatsapp_enabled,
        slack_enabled,
        quiet_hours_json,
        timezone,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id)
      DO UPDATE SET sensitivity_mode = excluded.sensitivity_mode,
                    instant_enabled = excluded.instant_enabled,
                    digest_enabled = excluded.digest_enabled,
                    email_enabled = excluded.email_enabled,
                    whatsapp_enabled = excluded.whatsapp_enabled,
                    slack_enabled = excluded.slack_enabled,
                    quiet_hours_json = excluded.quiet_hours_json,
                    timezone = excluded.timezone,
                    updated_at = excluded.updated_at
    `,
    id,
    input.userId,
    input.sensitivityMode,
    boolToInt(input.instantEnabled),
    boolToInt(input.digestEnabled),
    boolToInt(input.emailEnabled),
    boolToInt(input.whatsappEnabled),
    boolToInt(input.slackEnabled ?? false),
    jsonValue(input.quietHours ?? null),
    input.timezone ?? null,
    timestamp,
    timestamp,
  );

  return getWorkspaceDeliveryConfig(env, input.userId);
}

export async function getUserDeliveryProfile(env: AppEnv, userId: string) {
  const row = await one<{ id: string; email: string | null; name: string | null }>(
    env,
    `
      SELECT id, email, name
      FROM user
      WHERE id = ?
      LIMIT 1
    `,
    userId,
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name ?? "",
  };
}

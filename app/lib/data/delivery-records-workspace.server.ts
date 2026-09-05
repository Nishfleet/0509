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
import type { DeliveryQuietHours, DigestCadencePreference, SensitivityMode } from "~/lib/types";

export function legacyWorkspaceDeliveryDefaults(input: { hasEmail: boolean }) {
  return {
    sensitivityMode: "balanced" as const,
    // FIX-6: existing workspaces with no saved row must not silently gain
    // instant alerts. New workspaces write an explicit snapshot via
    // ensureNewWorkspaceDeliveryDefaults (instantEnabled: true).
    instantEnabled: false,
    digestEnabled: true,
    digestCadencePreference: "plan_default" as DigestCadencePreference,
    emailEnabled: input.hasEmail,
    whatsappEnabled: false,
    slackEnabled: false,
    teamsEnabled: false,
  };
}

/**
 * FIX-6: first-time workspace delivery snapshot for newly onboarded accounts.
 * No-op when a config row already exists (never override customer settings).
 */
export async function ensureNewWorkspaceDeliveryDefaults(
  env: AppEnv,
  userId: string,
  options: { hasEmail?: boolean } = {},
) {
  const existing = await getWorkspaceDeliveryConfig(env, userId);
  if (existing) {
    return { created: false as const, config: existing };
  }
  await upsertWorkspaceDeliveryConfig(env, {
    userId,
    sensitivityMode: "balanced",
    instantEnabled: true,
    digestEnabled: true,
    digestCadencePreference: "plan_default",
    emailEnabled: options.hasEmail !== false,
    whatsappEnabled: false,
    slackEnabled: false,
    teamsEnabled: false,
  });
  const config = await getWorkspaceDeliveryConfig(env, userId);
  return { created: true as const, config };
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
  const normalizedEmail = newEmail.trim().toLowerCase();

  // A suppressed current address must never be resurrected by an account
  // email migration. Suppress stale auto-provisioned rows instead.
  const suppressedCurrentAddress = await one<{ present: number }>(
    env,
    `
        SELECT 1 AS present
        FROM delivery_target
        WHERE user_id = ?
          AND channel = 'email'
          AND lower(trim(target_value)) = ?
          AND opted_out_at IS NOT NULL
        LIMIT 1
      `,
    userId,
    normalizedEmail,
  );

  if (suppressedCurrentAddress) {
    const result = await db
      .prepare(
        `
          UPDATE delivery_target
          SET is_opted_in = 0,
              is_paused = 1,
              paused_at = COALESCE(paused_at, ?),
              opted_out_at = COALESCE(opted_out_at, ?),
              updated_at = ?
          WHERE user_id = ?
            AND channel = 'email'
            AND opt_in_source = 'account_email'
            AND opted_out_at IS NULL
        `,
      )
      .bind(timestamp, timestamp, timestamp, userId)
      .run();
    return Number(result.meta?.changes ?? 0);
  }

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
          AND lower(trim(target_value)) != ?
      `,
    )
    .bind(normalizedEmail, timestamp, userId, normalizedEmail)
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
          AND lower(trim(target_value)) != ?
      `,
    )
    .bind(userId, normalizedEmail)
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
    digestCadencePreference?: DigestCadencePreference;
    emailEnabled: boolean;
    whatsappEnabled: boolean;
    slackEnabled?: boolean;
    teamsEnabled?: boolean;
    quietHours?: DeliveryQuietHours | null;
    timezone?: string | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  const digestCadencePreference =
    input.digestCadencePreference === "weekly_only" ? "weekly_only" : "plan_default";
  await run(
    env,
    `
      INSERT INTO workspace_delivery_config (
        id,
        user_id,
        sensitivity_mode,
        instant_enabled,
        digest_enabled,
        digest_cadence_preference,
        email_enabled,
        whatsapp_enabled,
        slack_enabled,
        teams_enabled,
        quiet_hours_json,
        timezone,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id)
      DO UPDATE SET sensitivity_mode = excluded.sensitivity_mode,
                    instant_enabled = excluded.instant_enabled,
                    digest_enabled = excluded.digest_enabled,
                    digest_cadence_preference = excluded.digest_cadence_preference,
                    email_enabled = excluded.email_enabled,
                    whatsapp_enabled = excluded.whatsapp_enabled,
                    slack_enabled = excluded.slack_enabled,
                    teams_enabled = excluded.teams_enabled,
                    quiet_hours_json = excluded.quiet_hours_json,
                    timezone = excluded.timezone,
                    updated_at = excluded.updated_at
    `,
    id,
    input.userId,
    input.sensitivityMode,
    boolToInt(input.instantEnabled),
    boolToInt(input.digestEnabled),
    digestCadencePreference,
    boolToInt(input.emailEnabled),
    boolToInt(input.whatsappEnabled),
    boolToInt(input.slackEnabled ?? false),
    boolToInt(input.teamsEnabled ?? false),
    jsonValue(input.quietHours ?? null),
    input.timezone ?? null,
    timestamp,
    timestamp,
  );

  return getWorkspaceDeliveryConfig(env, input.userId);
}

export async function getUserDeliveryProfile(env: AppEnv, userId: string) {
  const row = await one<{
    id: string;
    email: string | null;
    name: string | null;
    email_verified: number | boolean | null;
  }>(
    env,
    `
      SELECT id, email, name, emailVerified AS email_verified
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
    emailVerified: row.email_verified === 1 || row.email_verified === true,
  };
}

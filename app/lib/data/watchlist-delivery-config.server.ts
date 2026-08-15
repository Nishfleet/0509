import {
  execute as run,
  queryOne as one,
} from "~/lib/data/d1.server";
import { boolToInt, createId, jsonValue, nowIso } from "~/lib/data/helpers.server";
import {
  toWatchlistDeliveryConfigRecord,
  type WatchlistDeliveryConfigRow,
} from "~/lib/data/watchlist-rows.server";
import type { AppEnv } from "~/lib/env.server";
import type { DeliveryQuietHours, SensitivityMode } from "~/lib/types";
export async function getWatchlistDeliveryConfig(env: AppEnv, watchlistId: string) {
  const row = await one<WatchlistDeliveryConfigRow>(
    env,
    `
      SELECT *
      FROM watchlist_delivery_config
      WHERE watchlist_id = ?
      LIMIT 1
    `,
    watchlistId,
  );

  return row ? toWatchlistDeliveryConfigRecord(row) : null;
}
export async function upsertWatchlistDeliveryConfig(
  env: AppEnv,
  input: {
    watchlistId: string;
    userId: string;
    sensitivityMode: SensitivityMode;
    instantEnabled: boolean;
    digestEnabled: boolean;
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
  await run(
    env,
    `
      INSERT INTO watchlist_delivery_config (
        id,
        watchlist_id,
        user_id,
        sensitivity_mode,
        instant_enabled,
        digest_enabled,
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
      ON CONFLICT(watchlist_id)
      DO UPDATE SET user_id = excluded.user_id,
                    sensitivity_mode = excluded.sensitivity_mode,
                    instant_enabled = excluded.instant_enabled,
                    digest_enabled = excluded.digest_enabled,
                    email_enabled = excluded.email_enabled,
                    whatsapp_enabled = excluded.whatsapp_enabled,
                    slack_enabled = excluded.slack_enabled,
                    teams_enabled = excluded.teams_enabled,
                    quiet_hours_json = excluded.quiet_hours_json,
                    timezone = excluded.timezone,
                    updated_at = excluded.updated_at
    `,
    id,
    input.watchlistId,
    input.userId,
    input.sensitivityMode,
    boolToInt(input.instantEnabled),
    boolToInt(input.digestEnabled),
    boolToInt(input.emailEnabled),
    boolToInt(input.whatsappEnabled),
    boolToInt(input.slackEnabled ?? false),
    boolToInt(input.teamsEnabled ?? false),
    jsonValue(input.quietHours ?? null),
    input.timezone ?? null,
    timestamp,
    timestamp,
  );

  return getWatchlistDeliveryConfig(env, input.watchlistId);
}

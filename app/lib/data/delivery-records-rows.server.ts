import { parseJson, type JsonRecord } from "~/lib/data/helpers.server";
import type {
  DeliveryAttemptRecord,
  DeliveryAttemptStatus,
  DeliveryChannel,
  DeliveryLane,
  DeliveryQuietHours,
  DeliveryTargetRecord,
  DeliveryTargetValidationStatus,
  SensitivityMode,
  WebhookReconciliationStatus,
  WorkspaceDeliveryConfigRecord,
} from "~/lib/types";

export interface WorkspaceDeliveryConfigRow {
  id: string;
  user_id: string;
  sensitivity_mode: SensitivityMode;
  instant_enabled: number;
  digest_enabled: number;
  digest_cadence_preference?: string | null;
  email_enabled: number;
  whatsapp_enabled: number;
  slack_enabled: number;
  teams_enabled: number;
  quiet_hours_json: string | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryTargetRow {
  id: string;
  user_id: string;
  watchlist_id: string | null;
  channel: DeliveryChannel;
  target_value: string;
  validation_status: DeliveryTargetValidationStatus;
  is_validated: number;
  is_opted_in: number;
  opt_in_source: string | null;
  opted_in_at: string | null;
  is_paused: number;
  paused_at: string | null;
  opted_out_at: string | null;
  template_eligible: number;
  last_successful_delivery_at: string | null;
  last_successful_attempt_id: string | null;
  provider_identifier: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface DeliveryAttemptRow {
  id: string;
  user_id: string;
  watchlist_id: string | null;
  digest_run_id: string | null;
  delivery_target_id: string | null;
  lane: DeliveryLane;
  channel: DeliveryChannel;
  provider: string;
  status: DeliveryAttemptStatus;
  webhook_status: WebhookReconciliationStatus;
  target_value: string;
  provider_message_id: string | null;
  provider_status_last_seen_at: string | null;
  template_name: string | null;
  event_ids_json: string;
  payload_snapshot_json: string;
  idempotency_key: string | null;
  error_message: string | null;
  sent_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toWorkspaceDeliveryConfigRecord(
  row: WorkspaceDeliveryConfigRow,
): WorkspaceDeliveryConfigRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sensitivityMode: row.sensitivity_mode,
    instantEnabled: row.instant_enabled === 1,
    digestEnabled: row.digest_enabled === 1,
    digestCadencePreference:
      row.digest_cadence_preference === "weekly_only" ? "weekly_only" : "plan_default",
    emailEnabled: row.email_enabled === 1,
    whatsappEnabled: row.whatsapp_enabled === 1,
    slackEnabled: row.slack_enabled === 1,
    teamsEnabled: row.teams_enabled === 1,
    quietHours: parseJson<DeliveryQuietHours | null>(row.quiet_hours_json, null),
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toDeliveryTargetRecord(row: DeliveryTargetRow): DeliveryTargetRecord {
  return {
    id: row.id,
    userId: row.user_id,
    watchlistId: row.watchlist_id,
    channel: row.channel,
    targetValue: row.target_value,
    validationStatus: row.validation_status,
    isValidated: row.is_validated === 1,
    isOptedIn: row.is_opted_in === 1,
    optInSource: row.opt_in_source,
    optedInAt: row.opted_in_at,
    isPaused: row.is_paused === 1,
    pausedAt: row.paused_at,
    optedOutAt: row.opted_out_at,
    templateEligible: row.template_eligible === 1,
    lastSuccessfulDeliveryAt: row.last_successful_delivery_at,
    lastSuccessfulAttemptId: row.last_successful_attempt_id,
    providerIdentifier: row.provider_identifier,
    metadata: parseJson<JsonRecord>(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toDeliveryAttemptRecord(row: DeliveryAttemptRow): DeliveryAttemptRecord {
  return {
    id: row.id,
    userId: row.user_id,
    watchlistId: row.watchlist_id,
    digestRunId: row.digest_run_id,
    deliveryTargetId: row.delivery_target_id,
    lane: row.lane,
    channel: row.channel,
    provider: row.provider,
    status: row.status,
    webhookStatus: row.webhook_status,
    targetValue: row.target_value,
    providerMessageId: row.provider_message_id,
    providerStatusLastSeenAt: row.provider_status_last_seen_at,
    templateName: row.template_name,
    eventIds: parseJson<string[]>(row.event_ids_json, []),
    payloadSnapshot: parseJson<JsonRecord>(row.payload_snapshot_json, {}),
    idempotencyKey: row.idempotency_key,
    errorMessage: row.error_message,
    sentAt: row.sent_at,
    failedAt: row.failed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

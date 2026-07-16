import { decryptCredential } from "~/lib/credential-crypto.server";
import { readResponseTextWithinLimit } from "~/lib/bounded-response.server";
import type { AppEnv } from "~/lib/env.server";
import { fetchWithTimeout } from "~/lib/fetch-timeout.server";
import type { DeliveryTargetRecord, WebhookReconciliationStatus } from "~/lib/types";

export const SLACK_PROVIDER = "slack_incoming_webhook";
const SLACK_WEBHOOK_TIMEOUT_MS = 10_000;
const SLACK_WEBHOOK_RESPONSE_MAX_BYTES = 8_000;

type FetchImpl = typeof fetch;

export interface SlackWebhookSendResult {
  provider: typeof SLACK_PROVIDER;
  status: "sent" | "failed";
  webhookStatus: WebhookReconciliationStatus;
  providerMessageId: string | null;
  providerStatusLastSeenAt: string | null;
  errorMessage: string | null;
  deliveredAt: string | null;
}

export interface SlackWebhookPayload {
  text: string;
  blocks?: Array<Record<string, unknown>>;
}

export type SlackWebhookTargetPreparation =
  | { ok: true; webhookUrl: string }
  | { ok: false; result: SlackWebhookSendResult };

export async function prepareSlackWebhookTarget(
  env: AppEnv,
  target: DeliveryTargetRecord,
): Promise<SlackWebhookTargetPreparation> {
  const encryptedWebhookUrl = readString(target.metadata.encryptedWebhookUrl);
  if (!encryptedWebhookUrl) {
    return {
      ok: false,
      result: slackLocalFailure(
        "Slack webhook is not connected for this destination.",
      ),
    };
  }

  try {
    return {
      ok: true,
      webhookUrl: await decryptCredential(env, encryptedWebhookUrl),
    };
  } catch {
    return {
      ok: false,
      result: slackLocalFailure("Slack webhook could not be decrypted."),
    };
  }
}

export async function sendSlackWebhookMessage(
  env: AppEnv,
  target: DeliveryTargetRecord,
  payload: SlackWebhookPayload,
  options: { fetchImpl?: FetchImpl } = {},
): Promise<SlackWebhookSendResult> {
  const preparation = await prepareSlackWebhookTarget(env, target);
  if (!preparation.ok) return preparation.result;
  return sendSlackWebhookUrl(preparation.webhookUrl, payload, options);
}

export async function sendSlackWebhookUrl(
  webhookUrl: string,
  payload: SlackWebhookPayload,
  options: { fetchImpl?: FetchImpl } = {},
  statusSeenAt = new Date().toISOString(),
): Promise<SlackWebhookSendResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      webhookUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      { fetcher: options.fetchImpl, timeoutMs: SLACK_WEBHOOK_TIMEOUT_MS },
    );
  } catch {
    return slackAmbiguousFailure(
      statusSeenAt,
      "Slack send outcome is unknown after a transport error.",
    );
  }

  let responseText: string | null;
  try {
    responseText = await readResponseTextWithinLimit(
      response,
      SLACK_WEBHOOK_RESPONSE_MAX_BYTES,
    );
  } catch {
    return response.ok
      ? slackAmbiguousFailure(
          statusSeenAt,
          "Slack send outcome is unknown because its success response could not be read.",
        )
      : slackFailure(
          statusSeenAt,
          `Slack send failed with HTTP ${response.status}.`,
        );
  }
  if (responseText === null) {
    return response.ok
      ? slackAmbiguousFailure(
          statusSeenAt,
          "Slack send outcome is unknown because its success response was invalid.",
        )
      : slackFailure(
          statusSeenAt,
          `Slack send failed: Slack returned HTTP ${response.status}.`,
        );
  }
  if (!response.ok || responseText.trim().toLowerCase() !== "ok") {
    const error = (responseText.trim() || `Slack returned HTTP ${response.status}`).replace(/\.+$/, "");
    return slackFailure(statusSeenAt, `Slack send failed: ${error}.`);
  }

  return {
    provider: SLACK_PROVIDER,
    status: "sent",
    webhookStatus: "delivered",
    providerMessageId: null,
    providerStatusLastSeenAt: statusSeenAt,
    errorMessage: null,
    deliveredAt: statusSeenAt,
  };
}

function slackAmbiguousFailure(
  statusSeenAt: string,
  errorMessage: string,
): SlackWebhookSendResult {
  return {
    provider: SLACK_PROVIDER,
    status: "failed",
    webhookStatus: "provider_unknown",
    providerMessageId: null,
    providerStatusLastSeenAt: statusSeenAt,
    errorMessage,
    deliveredAt: null,
  };
}

function slackLocalFailure(errorMessage: string): SlackWebhookSendResult {
  return {
    provider: SLACK_PROVIDER,
    status: "failed",
    webhookStatus: "failed",
    providerMessageId: null,
    providerStatusLastSeenAt: null,
    errorMessage,
    deliveredAt: null,
  };
}

function slackFailure(statusSeenAt: string, errorMessage: string): SlackWebhookSendResult {
  return {
    provider: SLACK_PROVIDER,
    status: "failed",
    webhookStatus: "failed",
    providerMessageId: null,
    providerStatusLastSeenAt: statusSeenAt,
    errorMessage,
    deliveredAt: null,
  };
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

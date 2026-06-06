import { decryptCredential } from "~/lib/credential-crypto.server";
import type { AppEnv } from "~/lib/env.server";
import type { DeliveryTargetRecord, WebhookReconciliationStatus } from "~/lib/types";

export const SLACK_PROVIDER = "slack_incoming_webhook";

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

export async function sendSlackWebhookMessage(
  env: AppEnv,
  target: DeliveryTargetRecord,
  payload: SlackWebhookPayload,
  options: { fetchImpl?: FetchImpl } = {},
): Promise<SlackWebhookSendResult> {
  const statusSeenAt = new Date().toISOString();
  const encryptedWebhookUrl = readString(target.metadata.encryptedWebhookUrl);
  if (!encryptedWebhookUrl) {
    return slackFailure(statusSeenAt, "Slack webhook is not connected for this destination.");
  }

  let webhookUrl: string;
  try {
    webhookUrl = await decryptCredential(env, encryptedWebhookUrl);
  } catch {
    return slackFailure(statusSeenAt, "Slack webhook could not be decrypted.");
  }

  return sendSlackWebhookUrl(webhookUrl, payload, options, statusSeenAt);
}

export async function sendSlackWebhookUrl(
  webhookUrl: string,
  payload: SlackWebhookPayload,
  options: { fetchImpl?: FetchImpl } = {},
  statusSeenAt = new Date().toISOString(),
): Promise<SlackWebhookSendResult> {
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return slackFailure(
      statusSeenAt,
      `Slack send failed: ${error instanceof Error ? error.message : "network error"}.`,
    );
  }

  const responseText = await response.text().catch(() => "");
  if (!response.ok || responseText.trim().toLowerCase() !== "ok") {
    const error = responseText.trim() || `Slack returned HTTP ${response.status}.`;
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

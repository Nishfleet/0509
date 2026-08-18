import { decryptCredential } from "~/lib/credential-crypto.server";
import { readResponseTextWithinLimit } from "~/lib/bounded-response.server";
import type { AppEnv } from "~/lib/env.server";
import { fetchWithTimeout } from "~/lib/fetch-timeout.server";
import type { DeliveryTargetRecord, WebhookReconciliationStatus } from "~/lib/types";

export const TEAMS_PROVIDER = "microsoft_teams_incoming_webhook";
const TEAMS_WEBHOOK_TIMEOUT_MS = 10_000;
const TEAMS_WEBHOOK_RESPONSE_MAX_BYTES = 8_000;

type FetchImpl = typeof fetch;

export interface TeamsWebhookSendResult {
  provider: typeof TEAMS_PROVIDER;
  status: "sent" | "failed";
  webhookStatus: WebhookReconciliationStatus;
  providerMessageId: string | null;
  providerStatusLastSeenAt: string | null;
  errorMessage: string | null;
  deliveredAt: string | null;
}

export interface TeamsWebhookPayload {
  text: string;
  title?: string;
}

export type TeamsWebhookTargetPreparation =
  | { ok: true; webhookUrl: string }
  | { ok: false; result: TeamsWebhookSendResult };

/**
 * Teams incoming webhook URLs follow one of two documented connector shapes:
 * - Current connector: https://<tenant>.webhook.office.com/webhookb2/<id>@<tenant>/IncomingWebhook/<id>/<key>
 * - Legacy connector: https://outlook.office.com/webhook/<id>@<tenant>/IncomingWebhook/<id>/<key>
 *
 * Workflow URLs (https://prod-<region>.westus.logic.azure.com/workflows/…)
 * are NOT accepted: their success response is a bare 202 with an empty body,
 * so there is no way to fail closed on them. The two connector shapes POST
 * JSON and answer 2xx with "1" on acceptance — a checkable, honest signal.
 */
export function normalizeTeamsWebhookUrl(input: string) {
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Response("Paste a valid Microsoft Teams incoming webhook URL.", { status: 400 });
  }

  const isCurrentConnectorHost =
    url.hostname === "webhook.office.com" || url.hostname.endsWith(".webhook.office.com");
  const isLegacyConnectorHost = url.hostname === "outlook.office.com";
  const pathParts = url.pathname.split("/").filter(Boolean);
  const validCurrentShape =
    isCurrentConnectorHost && pathParts[0] === "webhookb2" && pathParts.length >= 4;
  const validLegacyShape =
    isLegacyConnectorHost && pathParts[0] === "webhook" && pathParts.length >= 4;
  if (url.protocol !== "https:" || (!validCurrentShape && !validLegacyShape)) {
    throw new Response("Paste a Microsoft Teams incoming webhook URL from webhook.office.com.", {
      status: 400,
    });
  }

  url.hash = "";
  return url.toString();
}

export async function prepareTeamsWebhookTarget(
  env: AppEnv,
  target: DeliveryTargetRecord,
): Promise<TeamsWebhookTargetPreparation> {
  const encryptedWebhookUrl = readString(target.metadata.encryptedWebhookUrl);
  if (!encryptedWebhookUrl) {
    return {
      ok: false,
      result: teamsLocalFailure(
        "Teams webhook is not connected for this destination.",
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
      result: teamsLocalFailure("Teams webhook could not be decrypted."),
    };
  }
}

export async function sendTeamsWebhookMessage(
  env: AppEnv,
  target: DeliveryTargetRecord,
  payload: TeamsWebhookPayload,
  options: { fetchImpl?: FetchImpl } = {},
): Promise<TeamsWebhookSendResult> {
  const preparation = await prepareTeamsWebhookTarget(env, target);
  if (!preparation.ok) return preparation.result;
  return sendTeamsWebhookUrl(preparation.webhookUrl, payload, options);
}

export async function sendTeamsWebhookUrl(
  webhookUrl: string,
  payload: TeamsWebhookPayload,
  options: { fetchImpl?: FetchImpl } = {},
  statusSeenAt = new Date().toISOString(),
): Promise<TeamsWebhookSendResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      webhookUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: payload.text,
          ...(payload.title ? { title: payload.title } : {}),
        }),
      },
      { fetcher: options.fetchImpl, timeoutMs: TEAMS_WEBHOOK_TIMEOUT_MS },
    );
  } catch {
    return teamsAmbiguousFailure(
      statusSeenAt,
      "Teams send outcome is unknown after a transport error.",
    );
  }

  // Fail-closed honest status: a 2xx is the only proof of acceptance. A
  // non-2xx is a hard failure; an unreadable or non-success response body is
  // recorded as unknown, never as delivered.
  if (!response.ok) {
    let errorText: string | null;
    try {
      errorText = await readResponseTextWithinLimit(
        response,
        TEAMS_WEBHOOK_RESPONSE_MAX_BYTES,
      );
    } catch {
      errorText = null;
    }
    return teamsFailure(
      statusSeenAt,
      `Teams send failed with HTTP ${response.status}${errorText ? `: ${trimError(errorText)}` : "."}`,
    );
  }

  return {
    provider: TEAMS_PROVIDER,
    status: "sent",
    webhookStatus: "delivered",
    providerMessageId: null,
    providerStatusLastSeenAt: statusSeenAt,
    errorMessage: null,
    deliveredAt: statusSeenAt,
  };
}

function teamsAmbiguousFailure(
  statusSeenAt: string,
  errorMessage: string,
): TeamsWebhookSendResult {
  return {
    provider: TEAMS_PROVIDER,
    status: "failed",
    webhookStatus: "provider_unknown",
    providerMessageId: null,
    providerStatusLastSeenAt: statusSeenAt,
    errorMessage,
    deliveredAt: null,
  };
}

function teamsLocalFailure(errorMessage: string): TeamsWebhookSendResult {
  return {
    provider: TEAMS_PROVIDER,
    status: "failed",
    webhookStatus: "failed",
    providerMessageId: null,
    providerStatusLastSeenAt: null,
    errorMessage,
    deliveredAt: null,
  };
}

function teamsFailure(statusSeenAt: string, errorMessage: string): TeamsWebhookSendResult {
  return {
    provider: TEAMS_PROVIDER,
    status: "failed",
    webhookStatus: "failed",
    providerMessageId: null,
    providerStatusLastSeenAt: statusSeenAt,
    errorMessage,
    deliveredAt: null,
  };
}

function trimError(value: string) {
  return value.trim().replace(/\.+$/, "").slice(0, 400);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

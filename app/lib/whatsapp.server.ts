import type { AppEnv } from "~/lib/env.server";
import {
  isCustomerWhatsAppReady,
  isWhatsAppProviderConfigured,
  whatsappGraphApiVersion,
} from "~/lib/env.server";
import type {
  DeliveryAttemptStatus,
  DeliveryLane,
  DeliveryTargetRecord,
  WebhookReconciliationStatus,
} from "~/lib/types";

const WHATSAPP_DIGEST_TEMPLATE_NAMES: Record<DeliveryLane, string> = {
  customer: "proof_digest_customer_v1",
  internal: "proof_digest_internal_v1",
};

interface WhatsAppSendResult {
  provider: "whatsapp_cloud_api";
  status: "sent" | "failed";
  webhookStatus: WebhookReconciliationStatus;
  providerMessageId: string | null;
  providerStatusLastSeenAt: string | null;
  templateName: string;
  errorMessage: string | null;
}

interface SendDigestWhatsAppInput {
  lane: DeliveryLane;
  target: DeliveryTargetRecord;
  itemCount: number;
  periodStart: string;
  periodEnd: string;
}

export interface WhatsAppWebhookStatusUpdate {
  provider: "whatsapp_cloud_api";
  providerMessageId: string;
  webhookStatus: WebhookReconciliationStatus;
  status: DeliveryAttemptStatus | null;
  providerStatusLastSeenAt: string;
  errorMessage: string | null;
}

export async function sendDigestWhatsApp(
  env: AppEnv,
  input: SendDigestWhatsAppInput,
): Promise<WhatsAppSendResult> {
  const readinessFailure = validateDigestTarget(env, input);
  const templateName = WHATSAPP_DIGEST_TEMPLATE_NAMES[input.lane];

  if (readinessFailure) {
    return {
      provider: "whatsapp_cloud_api",
      status: "failed",
      webhookStatus: "provider_unknown",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName,
      errorMessage: readinessFailure,
    };
  }

  const response = await fetch(
    `https://graph.facebook.com/${whatsappGraphApiVersion(env)}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.target.targetValue,
        type: "template",
        template: {
          ...(env.WHATSAPP_TEMPLATE_NAMESPACE
            ? { namespace: env.WHATSAPP_TEMPLATE_NAMESPACE }
            : {}),
          name: templateName,
          language: {
            policy: "deterministic",
            code: "en_US",
          },
          components: [
            {
              type: "body",
              parameters: [
                {
                  type: "text",
                  text: formatPeriodRange(input.periodStart, input.periodEnd),
                },
                {
                  type: "text",
                  text: String(input.itemCount),
                },
              ],
            },
          ],
        },
      }),
    },
  );

  const payload = await response
    .json()
    .catch(() => null) as
    | {
        error?: {
          message?: string;
          error_user_msg?: string;
        };
        messages?: Array<{ id?: string }>;
      }
    | null;

  if (!response.ok) {
    return {
      provider: "whatsapp_cloud_api",
      status: "failed",
      webhookStatus: "failed",
      providerMessageId: null,
      providerStatusLastSeenAt: new Date().toISOString(),
      templateName,
      errorMessage:
        payload?.error?.error_user_msg ??
        payload?.error?.message ??
        `WhatsApp send failed with status ${response.status}.`,
    };
  }

  return {
    provider: "whatsapp_cloud_api",
    status: "sent",
    webhookStatus: "pending",
    providerMessageId: payload?.messages?.[0]?.id ?? null,
    providerStatusLastSeenAt: new Date().toISOString(),
    templateName,
    errorMessage: null,
  };
}

function validateDigestTarget(env: AppEnv, input: SendDigestWhatsAppInput) {
  if (!isWhatsAppProviderConfigured(env)) {
    return "WhatsApp provider is not configured for this environment.";
  }

  if (input.lane === "customer" && !isCustomerWhatsAppReady(env)) {
    return "Customer WhatsApp delivery is not ready yet.";
  }

  if (!input.target.isOptedIn) {
    return "The WhatsApp target has not opted in.";
  }

  if (input.target.isPaused || input.target.optedOutAt) {
    return "The WhatsApp target is paused or opted out.";
  }

  if (!input.target.isValidated || input.target.validationStatus !== "validated") {
    return "The WhatsApp target is not validated.";
  }

  if (!input.target.templateEligible) {
    return "The WhatsApp target is not template-eligible.";
  }

  return null;
}

function formatPeriodRange(periodStart: string, periodEnd: string) {
  const formatter = new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
  });

  return `${formatter.format(new Date(periodStart))} to ${formatter.format(new Date(periodEnd))}`;
}

export function verifyWhatsAppWebhookChallenge(env: AppEnv, url: URL) {
  const mode = url.searchParams.get("hub.mode");
  const verifyToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !challenge) {
    return null;
  }

  if (!env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || verifyToken !== env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    throw new Response("Forbidden", { status: 403 });
  }

  return challenge;
}

export function extractWhatsAppWebhookStatusUpdates(payload: unknown): WhatsAppWebhookStatusUpdate[] {
  const entries =
    (payload as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            statuses?: Array<{
              id?: string;
              status?: string;
              timestamp?: string;
              errors?: Array<{ message?: string }>;
            }>;
          };
        }>;
      }>;
    })?.entry ?? [];

  const deduped = new Map<string, WhatsAppWebhookStatusUpdate>();

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        if (!status.id) {
          continue;
        }

        const mapped = mapWhatsAppStatus(status.status, status.errors?.[0]?.message ?? null);
        const providerStatusLastSeenAt = status.timestamp
          ? new Date(Number(status.timestamp) * 1000).toISOString()
          : new Date().toISOString();
        const candidate: WhatsAppWebhookStatusUpdate = {
          provider: "whatsapp_cloud_api",
          providerMessageId: status.id,
          webhookStatus: mapped.webhookStatus,
          status: mapped.status,
          providerStatusLastSeenAt,
          errorMessage: mapped.errorMessage,
        };
        const existing = deduped.get(status.id);

        if (!existing || statusPriority(candidate) >= statusPriority(existing)) {
          deduped.set(status.id, candidate);
        }
      }
    }
  }

  return [...deduped.values()];
}

function mapWhatsAppStatus(rawStatus: string | undefined, providerError: string | null) {
  switch ((rawStatus ?? "").toLowerCase()) {
    case "sent":
    case "delivered":
    case "read":
      return {
        webhookStatus: "delivered" as const,
        status: "sent" as const,
        errorMessage: null,
      };
    case "failed":
    case "undelivered":
      return {
        webhookStatus: "failed" as const,
        status: "failed" as const,
        errorMessage: providerError ?? "WhatsApp delivery failed.",
      };
    default:
      return {
        webhookStatus: "pending" as const,
        status: null,
        errorMessage: providerError,
      };
  }
}

function statusPriority(candidate: WhatsAppWebhookStatusUpdate) {
  if (candidate.webhookStatus === "failed") {
    return 3;
  }
  if (candidate.webhookStatus === "delivered") {
    return 2;
  }
  return 1;
}

import type { AppEnv } from "~/lib/env.server";
import {
  isCustomerWhatsAppReady,
  isWhatsAppProviderConfigured,
  whatsappGraphApiVersion,
} from "~/lib/env.server";
import type {
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

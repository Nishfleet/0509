import { safeTimeZone } from "~/lib/safe-timezone";
import type { AppEnv } from "~/lib/env.server";
import {
  isCustomerWhatsAppReady,
  isWhatsAppProviderConfigured,
  isWhatsAppWebhookConfigured,
  whatsappGraphApiVersion,
} from "~/lib/env.server";
import {
  createDeliveryAttempt,
  listDeliveryTargets,
  upsertDeliveryTarget,
} from "~/lib/data.server";
import { readResponseJsonWithinLimit } from "~/lib/bounded-response.server";
import { fetchWithTimeout } from "~/lib/fetch-timeout.server";
import type {
  DeliveryAttemptStatus,
  DeliveryLane,
  DeliveryTargetRecord,
  WebhookReconciliationStatus,
} from "~/lib/types";

const WHATSAPP_SEND_TIMEOUT_MS = 10_000;
const WHATSAPP_SEND_JSON_MAX_BYTES = 64_000;
const WHATSAPP_DIGEST_TEMPLATE_NAMES: Record<DeliveryLane, string> = {
  customer: "proof_digest_customer_v1",
  internal: "proof_digest_internal_v1",
};

const WHATSAPP_INSTANT_TEMPLATE_NAMES = {
  customer: {
    confirmed: "confirmed_instant_customer_v1",
    provisional: "provisional_customer_v1",
  },
  internal: {
    confirmed: "internal_instant_v1",
    provisional: "internal_instant_v1",
  },
} as const;
const WHATSAPP_OPT_IN_SOURCE = "manual_whatsapp_setup";

interface WhatsAppSendResult {
  provider: "whatsapp_cloud_api";
  status: "sent" | "failed" | "pending";
  webhookStatus: WebhookReconciliationStatus;
  providerMessageId: string | null;
  providerStatusLastSeenAt: string | null;
  templateName: string;
  errorMessage: string | null;
}

export interface SendDigestWhatsAppInput {
  lane: DeliveryLane;
  target: DeliveryTargetRecord;
  itemCount: number;
  periodStart: string;
  periodEnd: string;
  timeZone?: string | null;
}

interface SendInstantWhatsAppInput {
  lane: DeliveryLane;
  target: DeliveryTargetRecord;
  competitor: string;
  shortChange: string;
  watchlistUrl: string | null;
  provisional: boolean;
}

export interface WhatsAppWebhookStatusUpdate {
  provider: "whatsapp_cloud_api";
  providerMessageId: string;
  rawProviderStatus: string | null;
  webhookStatus: WebhookReconciliationStatus;
  status: DeliveryAttemptStatus | null;
  providerStatusLastSeenAt: string;
  errorMessage: string | null;
}

export function normalizeWhatsAppRecipient(input: string) {
  const normalized = input.trim().replace(/[\s().-]/g, "");
  const withoutPlus = normalized.startsWith("+") ? normalized.slice(1) : normalized;

  if (!/^[1-9]\d{7,14}$/.test(withoutPlus)) {
    throw new Response("Enter a WhatsApp number in international format, for example +919876543210.", {
      status: 400,
    });
  }

  return withoutPlus;
}

export async function saveWhatsAppDeliveryTarget(
  env: AppEnv,
  input: {
    userId: string;
    targetValue: string;
    name?: string | null;
    explicitOptIn: boolean;
  },
) {
  if (!input.explicitOptIn) {
    throw new Response("Confirm the recipient opted in before connecting WhatsApp delivery.", {
      status: 400,
    });
  }

  if (!isWhatsAppProviderConfigured(env)) {
    throw new Response("WhatsApp provider is not configured for this environment.", { status: 400 });
  }

  if (!isCustomerWhatsAppReady(env)) {
    throw new Response("Customer WhatsApp delivery is not enabled.", { status: 400 });
  }

  if (!isWhatsAppWebhookConfigured(env)) {
    throw new Response("WhatsApp webhook is not configured.", { status: 400 });
  }

  const targetValue = normalizeWhatsAppRecipient(input.targetValue);
  const existingTarget = await findExistingWhatsAppTarget(env, input.userId, targetValue);
  const timestamp = new Date().toISOString();
  const templateName = WHATSAPP_DIGEST_TEMPLATE_NAMES.customer;
  const testResult = await sendWhatsAppTemplate(env, {
    targetValue,
    templateName,
    bodyParameters: [formatPeriodRange(timestamp, timestamp), "1"],
  });

  if (testResult.status !== "sent") {
    throw new Response(testResult.errorMessage ?? "WhatsApp did not accept the setup template.", {
      status: 400,
    });
  }
  if (!testResult.providerMessageId) {
    throw new Response("WhatsApp accepted the setup template without a message id.", {
      status: 400,
    });
  }

  const requiresFreshValidation = Boolean(existingTarget?.optedOutAt);
  const validationProviderMessageId = testResult.providerMessageId;
  const target = await upsertDeliveryTarget(env, {
    userId: input.userId,
    watchlistId: null,
    channel: "whatsapp",
    targetValue,
    validationStatus:
      !requiresFreshValidation && existingTarget?.validationStatus === "validated"
        ? "validated"
        : "pending",
    isValidated: !requiresFreshValidation && (existingTarget?.isValidated ?? false),
    isOptedIn: true,
    optInSource: WHATSAPP_OPT_IN_SOURCE,
    optedInAt: timestamp,
    isPaused: existingTarget?.isPaused ?? false,
    pausedAt: existingTarget?.pausedAt ?? null,
    optedOutAt: null,
    templateEligible: !requiresFreshValidation && (existingTarget?.templateEligible ?? false),
    lastSuccessfulDeliveryAt: existingTarget?.lastSuccessfulDeliveryAt ?? null,
    lastSuccessfulAttemptId: existingTarget?.lastSuccessfulAttemptId ?? null,
    providerIdentifier: validationProviderMessageId,
    metadata: {
      ...(existingTarget?.metadata ?? {}),
      displayName: normalizeWhatsAppDestinationName(input.name),
      validationTemplateName: templateName,
      validationProviderMessageId,
      validationAcceptedAt: testResult.providerStatusLastSeenAt,
      validationWebhookStatus: "pending",
    },
  });

  if (!target) {
    throw new Response("WhatsApp target could not be saved.", { status: 500 });
  }

  await createDeliveryAttempt(env, {
    userId: input.userId,
    watchlistId: null,
    digestRunId: null,
    deliveryTargetId: target.id,
    lane: "customer",
    channel: "whatsapp",
    provider: testResult.provider,
    status: "pending",
    webhookStatus: "pending",
    targetValue,
    providerMessageId: validationProviderMessageId,
    providerStatusLastSeenAt: testResult.providerStatusLastSeenAt,
    templateName,
    eventIds: [],
    payloadSnapshot: {
      kind: "whatsapp_setup_validation",
      templateName,
    },
    idempotencyKey: `whatsapp_setup_validation:${input.userId}:${targetValue}:${validationProviderMessageId}`,
    errorMessage: null,
    sentAt: null,
    failedAt: null,
  });

  return target;
}

export function whatsappTargetDisplayName(target: Pick<DeliveryTargetRecord, "metadata" | "targetValue">) {
  return readString(target.metadata.displayName) || maskWhatsAppRecipient(target.targetValue);
}

export async function sendDigestWhatsApp(
  env: AppEnv,
  input: SendDigestWhatsAppInput,
): Promise<WhatsAppSendResult> {
  const preparation = prepareDigestWhatsAppTarget(env, input);

  if (preparation.errorMessage) {
    return {
      provider: "whatsapp_cloud_api",
      status: "failed",
      webhookStatus: "failed",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName: preparation.templateName,
      errorMessage: preparation.errorMessage,
    };
  }

  return sendWhatsAppTemplate(env, {
    targetValue: input.target.targetValue,
    templateName: preparation.templateName,
    bodyParameters: [
      formatPeriodRange(input.periodStart, input.periodEnd, input.timeZone),
      String(input.itemCount),
    ],
  });
}

export async function sendInstantWhatsApp(
  env: AppEnv,
  input: SendInstantWhatsAppInput,
): Promise<WhatsAppSendResult> {
  const readinessFailure = validateInstantTarget(env, input);
  const templateName = input.provisional
    ? WHATSAPP_INSTANT_TEMPLATE_NAMES[input.lane].provisional
    : WHATSAPP_INSTANT_TEMPLATE_NAMES[input.lane].confirmed;

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

  const link = input.watchlistUrl ?? "https://0509.io/app/watchlists";
  const bodyParameters =
    input.lane === "internal"
      ? [input.competitor, input.shortChange, input.provisional ? "Possible change" : "Confirmed change", link]
      : input.provisional
        ? [input.competitor, link]
        : [input.competitor, input.shortChange, link];

  return sendWhatsAppTemplate(env, {
    targetValue: input.target.targetValue,
    templateName,
    bodyParameters,
  });
}

export function prepareDigestWhatsAppTarget(
  env: AppEnv,
  input: SendDigestWhatsAppInput,
) {
  return {
    templateName: WHATSAPP_DIGEST_TEMPLATE_NAMES[input.lane],
    errorMessage: validateDigestTarget(env, input),
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

function validateInstantTarget(env: AppEnv, input: SendInstantWhatsAppInput) {
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

// Period dates are formatted in the workspace's configured delivery timezone
// when one exists, otherwise UTC. Locale-neutral en-GB — recipients are global.
function formatPeriodRange(periodStart: string, periodEnd: string, timeZone?: string | null) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
    timeZone: safeTimeZone(timeZone),
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

export async function verifyWhatsAppWebhookSignature(
  env: AppEnv,
  request: Request,
  rawBody: string,
) {
  if (!env.WHATSAPP_APP_SECRET) {
    throw new Response("WhatsApp webhook signing secret is not configured.", { status: 503 });
  }

  const providedSignature = request.headers.get("x-hub-signature-256");
  if (!providedSignature?.startsWith("sha256=")) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const expectedSignature = await signWhatsAppBody(env.WHATSAPP_APP_SECRET, rawBody);
  const providedHex = providedSignature.slice("sha256=".length).trim().toLowerCase();

  if (!constantTimeHexEqual(providedHex, expectedSignature)) {
    throw new Response("Unauthorized", { status: 401 });
  }
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
        const timestampSeconds = Number(status.timestamp);
        if (status.timestamp && (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0)) {
          continue;
        }
        const providerStatusLastSeenAt = status.timestamp
          ? new Date(timestampSeconds * 1000).toISOString()
          : new Date().toISOString();
        const candidate: WhatsAppWebhookStatusUpdate = {
          provider: "whatsapp_cloud_api",
          providerMessageId: status.id,
          rawProviderStatus: status.status ?? null,
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

async function sendWhatsAppTemplate(
  env: AppEnv,
  input: {
    targetValue: string;
    templateName: string;
    bodyParameters: string[];
  },
): Promise<WhatsAppSendResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `https://graph.facebook.com/${whatsappGraphApiVersion(env)}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.targetValue,
          type: "template",
          template: {
            ...(env.WHATSAPP_TEMPLATE_NAMESPACE
              ? { namespace: env.WHATSAPP_TEMPLATE_NAMESPACE }
              : {}),
            name: input.templateName,
            language: {
              policy: "deterministic",
              code: "en_US",
            },
            components: [
              {
                type: "body",
                parameters: input.bodyParameters.map((text) => ({
                  type: "text",
                  text,
                })),
              },
            ],
          },
        }),
      },
      { timeoutMs: WHATSAPP_SEND_TIMEOUT_MS },
    );
  } catch (error) {
    return {
      provider: "whatsapp_cloud_api",
      status: "pending",
      webhookStatus: "provider_unknown",
      providerMessageId: null,
      providerStatusLastSeenAt: new Date().toISOString(),
      templateName: input.templateName,
      errorMessage: error instanceof Error ? error.message : "WhatsApp send failed.",
    };
  }

  const payload = await readResponseJsonWithinLimit<
    | {
        error?: {
          message?: string;
          error_user_msg?: string;
        };
        messages?: Array<{ id?: string }>;
      }
    | null
  >(response, WHATSAPP_SEND_JSON_MAX_BYTES);

  if (!response.ok) {
    return {
      provider: "whatsapp_cloud_api",
      status: "failed",
      webhookStatus: "failed",
      providerMessageId: null,
      providerStatusLastSeenAt: new Date().toISOString(),
      templateName: input.templateName,
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
    templateName: input.templateName,
    errorMessage: null,
  };
}

async function signWhatsAppBody(secret: string, rawBody: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return Array.from(new Uint8Array(signature))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeHexEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

function statusPriority(candidate: WhatsAppWebhookStatusUpdate) {
  if (candidate.webhookStatus === "failed") {
    return 4;
  }
  const rawStatus = candidate.rawProviderStatus?.toLowerCase() ?? null;
  if (rawStatus === "read") {
    return 3;
  }
  if (rawStatus === "delivered") {
    return 2;
  }
  if (rawStatus === "sent" || candidate.webhookStatus === "delivered") {
    return 1;
  }
  return 0;
}

function normalizeWhatsAppDestinationName(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized && normalized.length <= 80 ? normalized : "WhatsApp recipient";
}

function maskWhatsAppRecipient(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `WhatsApp ending ${digits.slice(-4)}` : "WhatsApp recipient";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function findExistingWhatsAppTarget(env: AppEnv, userId: string, targetValue: string) {
  const targets = await listDeliveryTargets(env, userId, {
    watchlistId: null,
    channel: "whatsapp",
    limit: 50,
  });

  return targets.find((target) => target.targetValue === targetValue) ?? null;
}

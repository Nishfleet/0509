import {
  credentialFingerprint,
  encryptCredential,
} from "~/lib/credential-crypto.server";
import {
  getDeliveryTargetById,
  upsertDeliveryTarget,
} from "~/lib/data.server";
import type { AppEnv } from "~/lib/env.server";
import type { DeliveryTargetRecord } from "~/lib/types";
import {
  normalizeTeamsWebhookUrl,
  sendTeamsWebhookUrl,
  TEAMS_PROVIDER,
} from "~/lib/teams-webhook.server";
export {
  normalizeTeamsWebhookUrl,
  sendTeamsWebhookMessage,
  TEAMS_PROVIDER,
} from "~/lib/teams-webhook.server";

const TEAMS_OPT_IN_SOURCE = "manual_teams_webhook";
const TEAMS_TARGET_PREFIX = "teams";

export function normalizeTeamsDestinationWebhookUrl(input: string) {
  return normalizeTeamsWebhookUrl(input);
}

export async function saveTeamsWebhookTarget(
  env: AppEnv,
  input: {
    userId: string;
    webhookUrl: string;
    name?: string | null;
  },
  options: { fetchImpl?: typeof fetch } = {},
) {
  const webhookUrl = normalizeTeamsWebhookUrl(input.webhookUrl);
  const testResult = await sendTeamsWebhookUrl(
    webhookUrl,
    {
      text: "Five to Nine Teams delivery is connected. Future eligible competitor changes can post here.",
    },
    {
      fetchImpl: options.fetchImpl,
    },
  );
  if (testResult.status !== "sent") {
    throw new Response(testResult.errorMessage ?? "Teams did not accept the test message.", {
      status: 400,
    });
  }

  const fingerprint = await credentialFingerprint(webhookUrl);
  const displayName = normalizeTeamsDestinationName(input.name);
  const timestamp = new Date().toISOString();

  return upsertDeliveryTarget(env, {
    userId: input.userId,
    watchlistId: null,
    channel: "teams",
    targetValue: `${TEAMS_TARGET_PREFIX}:${fingerprint.slice(0, 16)}`,
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    optInSource: TEAMS_OPT_IN_SOURCE,
    optedInAt: timestamp,
    isPaused: false,
    pausedAt: null,
    optedOutAt: null,
    templateEligible: true,
    providerIdentifier: fingerprint,
    metadata: {
      displayName,
      encryptedWebhookUrl: await encryptCredential(env, webhookUrl),
      webhookHost: new URL(webhookUrl).hostname,
    },
  });
}

export async function pauseTeamsWebhookTarget(
  env: AppEnv,
  input: {
    userId: string;
    targetId: string;
  },
) {
  return updateTeamsWebhookTargetPaused(env, input, true);
}

export async function resumeTeamsWebhookTarget(
  env: AppEnv,
  input: {
    userId: string;
    targetId: string;
  },
) {
  return updateTeamsWebhookTargetPaused(env, input, false);
}

async function updateTeamsWebhookTargetPaused(
  env: AppEnv,
  input: {
    userId: string;
    targetId: string;
  },
  paused: boolean,
) {
  const target = await getDeliveryTargetById(env, {
    userId: input.userId,
    targetId: input.targetId,
  });
  if (!target || target.channel !== "teams") {
    return false;
  }

  await upsertDeliveryTarget(env, {
    userId: target.userId,
    watchlistId: target.watchlistId,
    channel: target.channel,
    targetValue: target.targetValue,
    validationStatus: target.validationStatus,
    isValidated: target.isValidated,
    isOptedIn: target.isOptedIn,
    optInSource: target.optInSource,
    optedInAt: target.optedInAt,
    isPaused: paused,
    pausedAt: paused ? new Date().toISOString() : null,
    optedOutAt: target.optedOutAt,
    templateEligible: target.templateEligible,
    lastSuccessfulDeliveryAt: target.lastSuccessfulDeliveryAt,
    lastSuccessfulAttemptId: target.lastSuccessfulAttemptId,
    providerIdentifier: target.providerIdentifier,
    metadata: target.metadata,
  });

  return true;
}

export function teamsTargetDisplayName(target: Pick<DeliveryTargetRecord, "metadata" | "targetValue">) {
  return readString(target.metadata.displayName) || target.targetValue;
}

function normalizeTeamsDestinationName(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized && normalized.length <= 80 ? normalized : "Five to Nine Teams channel";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

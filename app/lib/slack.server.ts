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
import { sendSlackWebhookUrl } from "~/lib/slack-webhook.server";
export {
  sendSlackWebhookMessage,
  SLACK_PROVIDER,
} from "~/lib/slack-webhook.server";

const SLACK_OPT_IN_SOURCE = "manual_slack_webhook";
const SLACK_TARGET_PREFIX = "slack";

export function normalizeSlackWebhookUrl(input: string) {
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Response("Paste a valid Slack incoming webhook URL.", { status: 400 });
  }

  const isSlackWebhookHost = url.hostname === "hooks.slack.com" || url.hostname === "hooks.slack-gov.com";
  const pathParts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || !isSlackWebhookHost || pathParts[0] !== "services" || pathParts.length < 4) {
    throw new Response("Paste a Slack incoming webhook URL from hooks.slack.com.", { status: 400 });
  }

  url.hash = "";
  return url.toString();
}

export async function saveSlackWebhookTarget(
  env: AppEnv,
  input: {
    userId: string;
    webhookUrl: string;
    name?: string | null;
  },
  options: { fetchImpl?: typeof fetch } = {},
) {
  const webhookUrl = normalizeSlackWebhookUrl(input.webhookUrl);
  const testResult = await sendSlackWebhookUrl(
    webhookUrl,
    {
      text: "Five to Nine Slack delivery is connected. Future eligible competitor digests can post here.",
    },
    {
      fetchImpl: options.fetchImpl,
    },
  );
  if (testResult.status !== "sent") {
    throw new Response(testResult.errorMessage ?? "Slack did not accept the test message.", {
      status: 400,
    });
  }

  const fingerprint = await credentialFingerprint(webhookUrl);
  const displayName = normalizeSlackDestinationName(input.name);
  const timestamp = new Date().toISOString();

  return upsertDeliveryTarget(env, {
    userId: input.userId,
    watchlistId: null,
    channel: "slack",
    targetValue: `${SLACK_TARGET_PREFIX}:${fingerprint.slice(0, 16)}`,
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    optInSource: SLACK_OPT_IN_SOURCE,
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

export async function pauseSlackWebhookTarget(
  env: AppEnv,
  input: {
    userId: string;
    targetId: string;
  },
) {
  return updateSlackWebhookTargetPaused(env, input, true);
}

export async function resumeSlackWebhookTarget(
  env: AppEnv,
  input: {
    userId: string;
    targetId: string;
  },
) {
  return updateSlackWebhookTargetPaused(env, input, false);
}

async function updateSlackWebhookTargetPaused(
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
  if (!target || target.channel !== "slack") {
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

export function slackTargetDisplayName(target: Pick<DeliveryTargetRecord, "metadata" | "targetValue">) {
  return readString(target.metadata.displayName) || target.targetValue;
}

function normalizeSlackDestinationName(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized && normalized.length <= 80 ? normalized : "Five to Nine Slack channel";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export {
  NotificationsRoute as default,
  notificationsMeta as meta,
} from "~/routes/app.notifications.ui";
export {
  NotificationsHydrateFallback as HydrateFallback,
  WorkspaceSettingsErrorBoundary as ErrorBoundary,
} from "~/routes/workspace-settings.shared";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { sanitizeCustomerFacingMessage } from "~/lib/customer-route-error";
import {
  isSlackDeliveryCustomerFacing,
  isWhatsAppDeliveryCustomerFacing,
  whatsappDeliveryUnavailableMessage,
} from "~/lib/ga-customer-surface";

const notificationActionIntents = new Set([
  "save-slack-webhook",
  "save-whatsapp-target",
  "pause-slack-webhook",
  "resume-slack-webhook",
  "save-digest-cadence",
]);

const slackNotificationIntents = new Set([
  "save-slack-webhook",
  "pause-slack-webhook",
  "resume-slack-webhook",
]);

export function handlesNotificationIntent(intent: string) {
  return notificationActionIntents.has(intent);
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { listDeliveryTargets } = await import("~/lib/data.server");
  const {
    isCustomerWhatsAppReady,
    isWhatsAppProviderConfigured,
    isWhatsAppWebhookConfigured,
  } = await import("~/lib/env.server");
  const { slackTargetDisplayName } = await import("~/lib/slack.server");
  const { whatsappTargetDisplayName } = await import("~/lib/whatsapp.server");
  const { getEffectiveWorkspacePlan } = await import("~/lib/plan.server");
  const { canUsePlanFeature } = await import("~/lib/plan-entitlements");
  const { getWorkspaceDeliveryConfig, legacyWorkspaceDeliveryDefaults } = await import(
    "~/lib/data.server"
  );
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const plan = await getEffectiveWorkspacePlan(env, workspaceUserId);
  const workspaceDeliveryConfig = await getWorkspaceDeliveryConfig(env, workspaceUserId);
  const digestCadencePreference =
    workspaceDeliveryConfig?.digestCadencePreference === "weekly_only"
      ? "weekly_only"
      : "plan_default";
  const showSlackDelivery = isSlackDeliveryCustomerFacing();
  const slackDeliveryEntitled = canUsePlanFeature(plan, "slack_delivery");
  const showWhatsAppDelivery = isWhatsAppDeliveryCustomerFacing();
  const whatsappProviderConfigured = showWhatsAppDelivery && isWhatsAppProviderConfigured(env);
  const whatsappCustomerReady = showWhatsAppDelivery && isCustomerWhatsAppReady(env);
  const whatsappWebhookConfigured = showWhatsAppDelivery && isWhatsAppWebhookConfigured(env);
  const [slackTargets, whatsappTargets] = await Promise.all([
    showSlackDelivery
      ? listDeliveryTargets(env, workspaceUserId, {
          watchlistId: null,
          channel: "slack",
          limit: 10,
        })
      : Promise.resolve([]),
    showWhatsAppDelivery
      ? listDeliveryTargets(env, workspaceUserId, {
          channel: "whatsapp",
          limit: 100,
        })
      : Promise.resolve([]),
  ]);
  const usableWhatsAppTargets = whatsappTargets.filter(
    (target) =>
      target.isOptedIn &&
      target.isValidated &&
      target.validationStatus === "validated" &&
      target.templateEligible &&
      !target.isPaused &&
      !target.optedOutAt,
  );
  const lastWhatsAppSuccessAt = whatsappTargets
    .map((target) => target.lastSuccessfulDeliveryAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    emailDeliveryReady: Boolean(session.user.email),
    digestCadencePreference,
    showSlackDelivery,
    slackDelivery: {
      plan,
      entitled: slackDeliveryEntitled,
    },
    canManageWhatsAppDelivery:
      whatsappProviderConfigured && whatsappCustomerReady && whatsappWebhookConfigured,
    slackTargets: slackTargets.map((target) => ({
      id: target.id,
      displayName: slackTargetDisplayName(target),
      isPaused: target.isPaused,
      lastSuccessfulDeliveryAt: target.lastSuccessfulDeliveryAt,
      createdAt: target.createdAt,
    })),
    whatsappTargets: whatsappTargets.map((target) => ({
      id: target.id,
      displayName: whatsappTargetDisplayName(target),
      isPaused: target.isPaused,
      validationStatus: target.validationStatus,
      templateEligible: target.templateEligible,
      lastSuccessfulDeliveryAt: target.lastSuccessfulDeliveryAt,
      createdAt: target.createdAt,
    })),
    whatsappDelivery: {
      providerConfigured: whatsappProviderConfigured,
      customerReady: whatsappCustomerReady,
      webhookConfigured: whatsappWebhookConfigured,
      configuredTargets: whatsappTargets.length,
      usableTargets: usableWhatsAppTargets.length,
      lastSuccessfulDeliveryAt: lastWhatsAppSuccessAt,
    },
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const { session, workspaceUserId, isMember } = await requireWorkspaceSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (isMember && handlesNotificationIntent(intent)) {
    return {
      ok: false,
      message: "Only the account owner can manage notification delivery targets.",
    };
  }

  if (slackNotificationIntents.has(intent)) {
    const { isSlackDeliveryCustomerFacing, slackDeliveryUnavailableMessage } = await import(
      "~/lib/ga-customer-surface"
    );
    if (!isSlackDeliveryCustomerFacing()) {
      return { ok: false, message: slackDeliveryUnavailableMessage() };
    }

    const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
    const slackGate = await requireWorkspacePlanFeature(env, workspaceUserId, "slack_delivery");
    if (!slackGate.ok) {
      return { ok: false, message: "Slack delivery is included in Starter and Agency plans." };
    }
  }

  if (intent === "save-slack-webhook") {
    const { saveSlackWebhookTarget } = await import("~/lib/slack.server");
    const {
      getWorkspaceDeliveryConfig,
      legacyWorkspaceDeliveryDefaults,
      upsertWorkspaceDeliveryConfig,
    } = await import("~/lib/data.server");
    const webhookUrl = String(formData.get("slackWebhookUrl") ?? "");
    const name = String(formData.get("slackDestinationName") ?? "");
    try {
      await saveSlackWebhookTarget(env, {
        userId: workspaceUserId,
        webhookUrl,
        name,
      });
    } catch (error) {
      if (error instanceof Response && error.status >= 400 && error.status < 500) {
        return {
          ok: false,
          message: sanitizeCustomerFacingMessage((await error.text()) || "Slack delivery could not be connected."),
        };
      }

      throw error;
    }
    const existingConfig = await getWorkspaceDeliveryConfig(env, workspaceUserId);
    const defaults = legacyWorkspaceDeliveryDefaults({
      hasEmail: Boolean(session.user.email),
    });
    await upsertWorkspaceDeliveryConfig(env, {
      userId: workspaceUserId,
      sensitivityMode: existingConfig?.sensitivityMode ?? defaults.sensitivityMode,
      instantEnabled: existingConfig?.instantEnabled ?? defaults.instantEnabled,
      digestEnabled: existingConfig?.digestEnabled ?? defaults.digestEnabled,
      digestCadencePreference:
        existingConfig?.digestCadencePreference ?? defaults.digestCadencePreference,
      emailEnabled: existingConfig?.emailEnabled ?? defaults.emailEnabled,
      whatsappEnabled: existingConfig?.whatsappEnabled ?? defaults.whatsappEnabled,
      slackEnabled: true,
      quietHours: existingConfig?.quietHours ?? null,
      timezone: existingConfig?.timezone ?? null,
    });

    return {
      ok: true,
      message:
        "Slack delivery connected. Slack accepted the setup test, and future eligible digests can post to that channel.",
    };
  }

  if (intent === "save-digest-cadence") {
    const {
      getWorkspaceDeliveryConfig,
      legacyWorkspaceDeliveryDefaults,
      upsertWorkspaceDeliveryConfig,
    } = await import("~/lib/data.server");
    const preferenceRaw = String(formData.get("digestCadencePreference") ?? "plan_default");
    const digestCadencePreference =
      preferenceRaw === "weekly_only" ? "weekly_only" : "plan_default";
    const existingConfig = await getWorkspaceDeliveryConfig(env, workspaceUserId);
    const defaults = legacyWorkspaceDeliveryDefaults({
      hasEmail: Boolean(session.user.email),
    });
    await upsertWorkspaceDeliveryConfig(env, {
      userId: workspaceUserId,
      sensitivityMode: existingConfig?.sensitivityMode ?? defaults.sensitivityMode,
      instantEnabled: existingConfig?.instantEnabled ?? defaults.instantEnabled,
      digestEnabled: existingConfig?.digestEnabled ?? defaults.digestEnabled,
      digestCadencePreference,
      emailEnabled: existingConfig?.emailEnabled ?? defaults.emailEnabled,
      whatsappEnabled: existingConfig?.whatsappEnabled ?? defaults.whatsappEnabled,
      slackEnabled: existingConfig?.slackEnabled ?? defaults.slackEnabled,
      quietHours: existingConfig?.quietHours ?? null,
      timezone: existingConfig?.timezone ?? null,
    });
    return {
      ok: true,
      message:
        digestCadencePreference === "weekly_only"
          ? "Digest frequency saved: weekly only."
          : "Digest frequency saved: plan default.",
    };
  }

  if (intent === "save-whatsapp-target") {
    if (!isWhatsAppDeliveryCustomerFacing()) {
      return { ok: false, message: whatsappDeliveryUnavailableMessage() };
    }
    const { saveWhatsAppDeliveryTarget } = await import("~/lib/whatsapp.server");
    const {
      getWorkspaceDeliveryConfig,
      legacyWorkspaceDeliveryDefaults,
      upsertWorkspaceDeliveryConfig,
    } = await import("~/lib/data.server");
    const targetValue = String(formData.get("whatsappTargetValue") ?? "");
    const name = String(formData.get("whatsappDestinationName") ?? "");
    const explicitOptIn = formData.has("whatsappExplicitOptIn");
    try {
      await saveWhatsAppDeliveryTarget(env, {
        userId: workspaceUserId,
        targetValue,
        name,
        explicitOptIn,
      });
    } catch (error) {
      if (error instanceof Response && error.status >= 400 && error.status < 500) {
        return {
          ok: false,
          message: sanitizeCustomerFacingMessage((await error.text()) || "WhatsApp delivery could not be connected."),
        };
      }

      throw error;
    }
    const existingConfig = await getWorkspaceDeliveryConfig(env, workspaceUserId);
    const defaults = legacyWorkspaceDeliveryDefaults({
      hasEmail: Boolean(session.user.email),
    });
    await upsertWorkspaceDeliveryConfig(env, {
      userId: workspaceUserId,
      sensitivityMode: existingConfig?.sensitivityMode ?? defaults.sensitivityMode,
      instantEnabled: existingConfig?.instantEnabled ?? defaults.instantEnabled,
      digestEnabled: existingConfig?.digestEnabled ?? defaults.digestEnabled,
      digestCadencePreference:
        existingConfig?.digestCadencePreference ?? defaults.digestCadencePreference,
      emailEnabled: existingConfig?.emailEnabled ?? defaults.emailEnabled,
      whatsappEnabled: true,
      slackEnabled: existingConfig?.slackEnabled ?? defaults.slackEnabled,
      quietHours: existingConfig?.quietHours ?? null,
      timezone: existingConfig?.timezone ?? null,
    });

    return {
      ok: true,
      message:
        "WhatsApp setup sent. Delivery turns on after Meta confirms the setup template was delivered.",
    };
  }

  if (intent === "pause-slack-webhook") {
    const { isSlackDeliveryCustomerFacing, slackDeliveryUnavailableMessage } = await import(
      "~/lib/ga-customer-surface"
    );
    if (!isSlackDeliveryCustomerFacing()) {
      return { ok: false, message: slackDeliveryUnavailableMessage() };
    }
    const { pauseSlackWebhookTarget } = await import("~/lib/slack.server");
    const targetId = String(formData.get("slackTargetId") ?? "");
    const paused = await pauseSlackWebhookTarget(env, {
      userId: workspaceUserId,
      targetId,
    });

    return {
      ok: paused,
      message: paused ? "Slack delivery paused." : "Slack delivery target was not found.",
    };
  }

  if (intent === "resume-slack-webhook") {
    const { isSlackDeliveryCustomerFacing, slackDeliveryUnavailableMessage } = await import(
      "~/lib/ga-customer-surface"
    );
    if (!isSlackDeliveryCustomerFacing()) {
      return { ok: false, message: slackDeliveryUnavailableMessage() };
    }
    const { resumeSlackWebhookTarget } = await import("~/lib/slack.server");
    const targetId = String(formData.get("slackTargetId") ?? "");
    const resumed = await resumeSlackWebhookTarget(env, {
      userId: workspaceUserId,
      targetId,
    });

    return {
      ok: resumed,
      message: resumed ? "Slack delivery resumed." : "Slack delivery target was not found.",
    };
  }

  return {
    ok: false,
    message: "Unknown notification action.",
  };
}

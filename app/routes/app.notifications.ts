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
  const { getWorkspaceDeliveryConfig } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const workspaceDeliveryConfig = await getWorkspaceDeliveryConfig(env, workspaceUserId);
  const digestCadencePreference =
    workspaceDeliveryConfig?.digestCadencePreference === "weekly_only"
      ? "weekly_only"
      : "plan_default";

  return {
    emailDeliveryReady: Boolean(session.user.email),
    digestCadencePreference,
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

  if (slackNotificationIntents.has(intent) || intent === "save-whatsapp-target") {
    // Dormant channels (GA posture): the customer-facing UI for these was
    // removed with the design-unification subtraction pass. A stray legacy
    // POST gets the honest answer, not a dead handler.
    const { slackDeliveryUnavailableMessage, whatsappDeliveryUnavailableMessage } = await import(
      "~/lib/ga-customer-surface"
    );
    return {
      ok: false,
      message:
        intent === "save-whatsapp-target"
          ? whatsappDeliveryUnavailableMessage()
          : slackDeliveryUnavailableMessage(),
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

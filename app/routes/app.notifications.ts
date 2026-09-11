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
  "save-teams-webhook",
  "pause-slack-webhook",
  "resume-slack-webhook",
  "pause-teams-webhook",
  "resume-teams-webhook",
  "save-whatsapp-target",
]);

const slackNotificationIntents = new Set([
  "save-slack-webhook",
  "pause-slack-webhook",
  "resume-slack-webhook",
]);

const teamsNotificationIntents = new Set([
  "save-teams-webhook",
  "pause-teams-webhook",
  "resume-teams-webhook",
]);

export function handlesNotificationIntent(intent: string) {
  return notificationActionIntents.has(intent);
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { listDeliveryTargets } = await import("~/lib/data.server");
  const { slackTargetDisplayName } = await import("~/lib/slack.server");
  const { teamsTargetDisplayName } = await import("~/lib/teams.server");
  const { getEffectiveWorkspacePlan } = await import("~/lib/plan.server");
  const { canUsePlanFeature } = await import("~/lib/plan-entitlements");
  const {
    isSlackWebhookDeliveryCustomerFacing,
    isTeamsWebhookDeliveryCustomerFacing,
  } = await import("~/lib/ga-customer-surface");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const plan = await getEffectiveWorkspacePlan(env, workspaceUserId);
  const showSlackDelivery = isSlackWebhookDeliveryCustomerFacing();
  const showTeamsDelivery = isTeamsWebhookDeliveryCustomerFacing();
  const slackDeliveryEntitled = canUsePlanFeature(plan, "slack_delivery");
  const teamsDeliveryEntitled = canUsePlanFeature(plan, "teams_delivery");
  const [slackTargets, teamsTargets] = await Promise.all([
    showSlackDelivery
      ? listDeliveryTargets(env, workspaceUserId, {
          watchlistId: null,
          channel: "slack",
          limit: 10,
        })
      : Promise.resolve([]),
    showTeamsDelivery
      ? listDeliveryTargets(env, workspaceUserId, {
          watchlistId: null,
          channel: "teams",
          limit: 10,
        })
      : Promise.resolve([]),
  ]);

  return {
    emailDeliveryReady: Boolean(session.user.email),
    showSlackDelivery,
    showTeamsDelivery,
    slackDelivery: {
      plan,
      entitled: slackDeliveryEntitled,
    },
    teamsDelivery: {
      plan,
      entitled: teamsDeliveryEntitled,
    },
    slackTargets: slackTargets.map((target) => ({
      id: target.id,
      displayName: slackTargetDisplayName(target),
      isPaused: target.isPaused,
      lastSuccessfulDeliveryAt: target.lastSuccessfulDeliveryAt,
      createdAt: target.createdAt,
    })),
    teamsTargets: teamsTargets.map((target) => ({
      id: target.id,
      displayName: teamsTargetDisplayName(target),
      isPaused: target.isPaused,
      lastSuccessfulDeliveryAt: target.lastSuccessfulDeliveryAt,
      createdAt: target.createdAt,
    })),
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

  if (slackNotificationIntents.has(intent) || teamsNotificationIntents.has(intent)) {
    const { isTeamsWebhookDeliveryCustomerFacing, isSlackWebhookDeliveryCustomerFacing } =
      await import("~/lib/ga-customer-surface");
    const isSlackIntent = slackNotificationIntents.has(intent);
    const surfaceLive = isSlackIntent
      ? isSlackWebhookDeliveryCustomerFacing()
      : isTeamsWebhookDeliveryCustomerFacing();
    if (!surfaceLive) {
      return {
        ok: false,
        message: isSlackIntent
          ? "Slack delivery isn’t available. Nothing was saved — use email delivery instead."
          : "Teams delivery isn’t available. Nothing was saved — use email delivery instead.",
      };
    }

    // Starter+ webhook delivery: the entitlement is enforced at save and at
    // send time, so a downgraded workspace cannot keep posting.
    const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
    const gate = await requireWorkspacePlanFeature(
      env,
      workspaceUserId,
      isSlackIntent ? "slack_delivery" : "teams_delivery",
    );
    if (!gate.ok) {
      return {
        ok: false,
        message: isSlackIntent
          ? "Slack delivery is included in Starter and Agency plans."
          : "Teams delivery is included in Starter and Agency plans.",
      };
    }
  }

  if (intent === "save-whatsapp-target") {
    // WhatsApp stays a dormant GA channel: a stray legacy POST gets the honest
    // answer, not a dead handler.
    const { whatsappDeliveryUnavailableMessage } = await import("~/lib/ga-customer-surface");
    return {
      ok: false,
      message: whatsappDeliveryUnavailableMessage(),
    };
  }

  if (intent === "save-slack-webhook") {
    const { saveSlackWebhookTarget } = await import("~/lib/slack.server");
    const { enableWorkspaceDeliveryChannel } = await import("~/lib/data.server");
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
    await enableWorkspaceDeliveryChannel(env, {
      userId: workspaceUserId,
      channel: "slack",
      hasEmail: Boolean(session.user.email),
    });

    return {
      ok: true,
      message:
        "Slack delivery connected. Slack accepted the setup test, and future eligible confirmed changes can post to that channel.",
    };
  }

  if (intent === "save-teams-webhook") {
    const { saveTeamsWebhookTarget } = await import("~/lib/teams.server");
    const { enableWorkspaceDeliveryChannel } = await import("~/lib/data.server");
    const webhookUrl = String(formData.get("teamsWebhookUrl") ?? "");
    const name = String(formData.get("teamsDestinationName") ?? "");
    try {
      await saveTeamsWebhookTarget(env, {
        userId: workspaceUserId,
        webhookUrl,
        name,
      });
    } catch (error) {
      if (error instanceof Response && error.status >= 400 && error.status < 500) {
        return {
          ok: false,
          message: sanitizeCustomerFacingMessage((await error.text()) || "Teams delivery could not be connected."),
        };
      }

      throw error;
    }
    await enableWorkspaceDeliveryChannel(env, {
      userId: workspaceUserId,
      channel: "teams",
      hasEmail: Boolean(session.user.email),
    });

    return {
      ok: true,
      message:
        "Teams delivery connected. Teams accepted the setup test, and future eligible confirmed changes can post to that channel.",
    };
  }

  if (intent === "pause-slack-webhook" || intent === "resume-slack-webhook") {
    const { pauseSlackWebhookTarget, resumeSlackWebhookTarget } = await import("~/lib/slack.server");
    const targetId = String(formData.get("targetId") ?? "");
    const paused = await (intent === "pause-slack-webhook"
      ? pauseSlackWebhookTarget(env, { userId: workspaceUserId, targetId })
      : resumeSlackWebhookTarget(env, { userId: workspaceUserId, targetId }));

    return paused
      ? {
          ok: true,
          message:
            intent === "pause-slack-webhook"
              ? "Slack delivery paused. Digests and alerts will not post until you resume it."
              : "Slack delivery resumed.",
        }
      : { ok: false, message: "We couldn't find that Slack destination." };
  }

  if (intent === "pause-teams-webhook" || intent === "resume-teams-webhook") {
    const { pauseTeamsWebhookTarget, resumeTeamsWebhookTarget } = await import("~/lib/teams.server");
    const targetId = String(formData.get("targetId") ?? "");
    const paused = await (intent === "pause-teams-webhook"
      ? pauseTeamsWebhookTarget(env, { userId: workspaceUserId, targetId })
      : resumeTeamsWebhookTarget(env, { userId: workspaceUserId, targetId }));

    return paused
      ? {
          ok: true,
          message:
            intent === "pause-teams-webhook"
              ? "Teams delivery paused. Digests and alerts will not post until you resume it."
              : "Teams delivery resumed.",
        }
      : { ok: false, message: "We couldn't find that Teams destination." };
  }

  return {
    ok: false,
    message: "Unknown notification action.",
  };
}

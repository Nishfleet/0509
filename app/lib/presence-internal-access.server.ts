import type { AppEnv } from "~/lib/env.server";
import { canUsePresenceFeature } from "~/lib/presence-entitlements";
import { countActivePilotWorkspaces, isPilotWorkspaceEnrolled } from "~/lib/presence-pilot-access.server";
import type { ConnectorRolloutState } from "~/lib/presence-types";
import { getUserPlan } from "~/lib/plan.server";

export interface PresenceWorkspaceAccessResult {
  allowed: boolean;
  rolloutState: ConnectorRolloutState;
  reasonCode: string | null;
  reasonMessage: string | null;
}

export function presenceInternalWorkspaceUserId(env: AppEnv) {
  return env.PRESENCE_INTERNAL_WORKSPACE_ID?.trim() ?? "";
}

function parseRolloutState(value: string | undefined, fallback: ConnectorRolloutState): ConnectorRolloutState {
  if (value === "generally_available") {
    return "ga";
  }
  if (value === "disabled" || value === "internal" || value === "pilot" || value === "ga") {
    return value;
  }
  return fallback;
}

async function workspaceHasPresenceEntitlement(env: AppEnv, workspaceUserId: string) {
  const plan = await getUserPlan(env, workspaceUserId);
  return (
    canUsePresenceFeature(plan, "presence_website_sources") ||
    canUsePresenceFeature(plan, "presence_competitor_tracking") ||
    canUsePresenceFeature(plan, "presence_self_tracking")
  );
}

export function presenceWebsiteRolloutState(env: AppEnv): ConnectorRolloutState {
  return parseRolloutState(env.PRESENCE_WEBSITE_ROLLOUT, "disabled");
}

export async function evaluatePresenceWorkspaceAccess(
  env: AppEnv,
  workspaceUserId: string,
): Promise<PresenceWorkspaceAccessResult> {
  const rolloutState = presenceWebsiteRolloutState(env);

  if (rolloutState === "disabled") {
    return {
      allowed: false,
      rolloutState,
      reasonCode: "presence_disabled",
      reasonMessage: "Presence tracking is not enabled yet.",
    };
  }

  if (rolloutState === "internal") {
    const internalWorkspaceId = presenceInternalWorkspaceUserId(env);
    if (!internalWorkspaceId) {
      return {
        allowed: false,
        rolloutState,
        reasonCode: "internal_workspace_unconfigured",
        reasonMessage: "Presence is not available on your account yet.",
      };
    }
    if (workspaceUserId !== internalWorkspaceId) {
      return {
        allowed: false,
        rolloutState,
        reasonCode: "internal_workspace_only",
        reasonMessage: "Presence is not available on your account yet.",
      };
    }
    return {
      allowed: true,
      rolloutState,
      reasonCode: null,
      reasonMessage: null,
    };
  }

  if (rolloutState === "pilot") {
    const enrolled = await isPilotWorkspaceEnrolled(env, workspaceUserId);
    if (!enrolled) {
      return {
        allowed: false,
        rolloutState,
        reasonCode: "pilot_workspace_only",
        reasonMessage: "Presence website tracking is in a controlled pilot — access is invite-only.",
      };
    }
    return {
      allowed: true,
      rolloutState,
      reasonCode: null,
      reasonMessage: null,
    };
  }

  if (rolloutState === "ga") {
    const entitled = await workspaceHasPresenceEntitlement(env, workspaceUserId);
    if (!entitled) {
      return {
        allowed: false,
        rolloutState,
        reasonCode: "plan_gated",
        reasonMessage: "Website presence tracking is not included in your current plan.",
      };
    }
    return {
      allowed: true,
      rolloutState,
      reasonCode: null,
      reasonMessage: null,
    };
  }

  return {
    allowed: false,
    rolloutState,
    reasonCode: "unknown_rollout",
    reasonMessage: "Presence tracking is not available.",
  };
}

export async function presenceNavVisible(env: AppEnv, workspaceUserId: string) {
  return (await evaluatePresenceWorkspaceAccess(env, workspaceUserId)).allowed;
}

export async function hasApprovedPilotWorkspace(env: AppEnv) {
  return (await countActivePilotWorkspaces(env)) > 0;
}

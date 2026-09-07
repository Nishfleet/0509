import type { AppEnv } from "~/lib/env.server";
import { evaluatePresenceWorkspaceAccess } from "~/lib/presence-internal-access.server";
import type {
  ConnectorRolloutState,
  PresenceConnectorId,
  PresenceTrackingMode,
} from "~/lib/presence-types";

export interface ConnectorAccessGateResult {
  allowed: boolean;
  rolloutState: ConnectorRolloutState;
  reasonCode: string | null;
  reasonMessage: string | null;
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

function connectorRolloutFromEnv(env: AppEnv, connectorId: PresenceConnectorId): ConnectorRolloutState {
  switch (connectorId) {
    case "website":
      return parseRolloutState(env.PRESENCE_WEBSITE_ROLLOUT, "disabled");
    case "x":
      return parseRolloutState(env.PRESENCE_X_ROLLOUT, "disabled");
    case "reddit":
      return parseRolloutState(env.PRESENCE_REDDIT_ROLLOUT, "disabled");
    case "linkedin":
      return parseRolloutState(env.PRESENCE_LINKEDIN_ROLLOUT, "disabled");
    case "rss":
      return parseRolloutState(env.PRESENCE_RSS_ROLLOUT, "disabled");
    default:
      return "disabled";
  }
}

function hasCredentials(env: AppEnv, connectorId: PresenceConnectorId): boolean {
  switch (connectorId) {
    case "website":
      return true;
    case "x":
      return Boolean(env.X_API_BEARER_TOKEN?.trim());
    case "reddit":
      return Boolean(env.REDDIT_CLIENT_ID?.trim() && env.REDDIT_CLIENT_SECRET?.trim());
    case "linkedin":
      return Boolean(env.LINKEDIN_CLIENT_ID?.trim() && env.LINKEDIN_CLIENT_SECRET?.trim());
    case "rss":
      // RSS/Atom/JSON Feed polling is public-web: no account or API credentials.
      // The rollout gate (PRESENCE_RSS_ROLLOUT) is still required to activate it.
      return true;
    default:
      return false;
  }
}

// research: This is the minimal additive extension of a REUSE read-only connector surface.
// The issue (Nishfleet/0509#1378) UNKNOWNS explicitly allow opening the existing `reddit`
// and `x` connectors as customer mention sources; app/lib/presence-access-gates.server.ts
// only gates whether a connector has a customer poll path, so widening the predicate here is
// sufficient. `linkedin` (no general customer poll path — limited competitor self-brand only)
// stays closed.
// help-first: Only the predicate changes; the runtime gates in evaluateConnectorAccessGate
// (rolloutState, credentials, reddit commercial access) still govern whether polling actually runs.
export function connectorHasCustomerPollPath(connectorId: PresenceConnectorId): boolean {
  return connectorId === "website" || connectorId === "rss" || connectorId === "x" || connectorId === "reddit";
}

export async function evaluateConnectorAccessGate(
  env: AppEnv,
  connectorId: PresenceConnectorId,
  trackingMode: PresenceTrackingMode,
  workspaceUserId?: string,
): Promise<ConnectorAccessGateResult> {
  const rolloutState = connectorRolloutFromEnv(env, connectorId);

  if (connectorId === "website" && workspaceUserId) {
    const workspaceAccess = await evaluatePresenceWorkspaceAccess(env, workspaceUserId);
    if (!workspaceAccess.allowed) {
      return {
        allowed: false,
        rolloutState: workspaceAccess.rolloutState,
        reasonCode: workspaceAccess.reasonCode,
        reasonMessage: workspaceAccess.reasonMessage,
      };
    }
  }

  if (rolloutState === "disabled") {
    return {
      allowed: false,
      rolloutState,
      reasonCode: "connector_disabled",
      reasonMessage: `${connectorId} presence tracking is not enabled yet.`,
    };
  }

  if (connectorId === "linkedin" && trackingMode === "competitor") {
    return {
      allowed: false,
      rolloutState,
      reasonCode: "competitor_limited",
      reasonMessage: "LinkedIn competitor tracking is pending — limited coverage only.",
    };
  }

  if (connectorId === "reddit" && env.REDDIT_COMMERCIAL_ACCESS !== "approved") {
    return {
      allowed: false,
      rolloutState,
      reasonCode: "commercial_access_pending",
      reasonMessage: "Reddit commercial API access is not approved for this workspace.",
    };
  }

  if (connectorId !== "website" && !hasCredentials(env, connectorId)) {
    return {
      allowed: false,
      rolloutState,
      reasonCode: "credentials_missing",
      reasonMessage: `${connectorId} API credentials are not configured.`,
    };
  }

  return {
    allowed: true,
    rolloutState,
    reasonCode: null,
    reasonMessage: null,
  };
}

export async function connectorOperationalForPolling(
  env: AppEnv,
  connectorId: PresenceConnectorId,
  trackingMode: PresenceTrackingMode,
  workspaceUserId?: string,
): Promise<boolean> {
  const gate = await evaluateConnectorAccessGate(env, connectorId, trackingMode, workspaceUserId);
  if (!gate.allowed) {
    return false;
  }
  if (!connectorHasCustomerPollPath(connectorId)) {
    return false;
  }
  return gate.rolloutState === "internal" || gate.rolloutState === "pilot" || gate.rolloutState === "ga";
}

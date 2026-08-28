import { linkedinConnector } from "~/lib/presence-connectors/linkedin.server";
import { redditConnector } from "~/lib/presence-connectors/reddit.server";
import { rssConnector } from "~/lib/presence-connectors/rss.server";
import { websiteConnector } from "~/lib/presence-connectors/website.server";
import { xConnector } from "~/lib/presence-connectors/x.server";
import { connectorOperationalForPolling, evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import type {
  ConnectorRolloutState,
  PresenceConnectorContext,
  PresenceConnectorId,
  PollResult,
  SourceTargetRecord,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";

const CONNECTORS = {
  website: websiteConnector,
  x: xConnector,
  reddit: redditConnector,
  linkedin: linkedinConnector,
  rss: rssConnector,
} as const;

export function getPresenceConnector(connectorId: PresenceConnectorId) {
  return CONNECTORS[connectorId];
}

export function listPresenceConnectors() {
  return Object.values(CONNECTORS);
}

export async function connectorRolloutState(
  env: import("~/lib/env.server").AppEnv,
  connectorId: PresenceConnectorId,
  trackingMode: "self" | "competitor",
  workspaceUserId?: string,
): Promise<ConnectorRolloutState> {
  return (await evaluateConnectorAccessGate(env, connectorId, trackingMode, workspaceUserId)).rolloutState;
}

export async function validatePresenceTarget(
  env: import("~/lib/env.server").AppEnv,
  connectorId: PresenceConnectorId,
  input: ValidateTargetInput,
  ctx: Omit<PresenceConnectorContext, "env">,
): Promise<ValidateTargetResult> {
  const connector = getPresenceConnector(connectorId);
  const fullCtx: PresenceConnectorContext = { ...ctx, env };
  if (connectorId === "website") {
    return websiteConnector.validateTarget(input);
  }
  return connector.validateTarget(input, fullCtx);
}

export async function pollPresenceTarget(
  env: import("~/lib/env.server").AppEnv,
  target: SourceTargetRecord,
  entity: { trackingMode: "self" | "competitor" },
  options: {
    connection?: PresenceConnectorContext["connection"];
    cursor?: { etag?: string | null; lastModified?: string | null };
    fetchImpl?: typeof fetch;
  } = {},
): Promise<PollResult> {
  const connector = getPresenceConnector(target.connectorId);
  if (!(await connectorOperationalForPolling(env, target.connectorId, entity.trackingMode, target.userId))) {
    return {
      ok: false,
      items: [],
      errorCode: "connector_not_operational",
      errorMessage: `${target.connectorId} is not operational for polling.`,
    };
  }

  const ctx: PresenceConnectorContext = {
    env,
    userId: target.userId,
    trackingMode: entity.trackingMode,
    connection: options.connection ?? null,
    fetchImpl: options.fetchImpl,
  };

  if (target.connectorId === "website") {
    return websiteConnector.poll(ctx, target, options.cursor);
  }
  if (target.connectorId === "rss") {
    return rssConnector.poll(ctx, target, options.cursor);
  }
  if (target.connectorId === "x") {
    return xConnector.poll(ctx);
  }
  if (target.connectorId === "reddit") {
    return redditConnector.poll(ctx);
  }
  return linkedinConnector.poll(ctx);
}

export function coverageLabelForConnector(
  connectorId: PresenceConnectorId,
  trackingMode: "self" | "competitor",
  validated?: ValidateTargetResult,
) {
  if (validated?.coverageLabel) {
    return validated.coverageLabel;
  }
  if (connectorId === "website") {
    return "PUBLIC_WEB_BEST_EFFORT" as const;
  }
  if (connectorId === "rss") {
    return "VERIFIED_PUBLIC_FEED" as const;
  }
  if (connectorId === "linkedin" && trackingMode === "competitor") {
    return "LIMITED_COVERAGE" as const;
  }
  if (connectorId === "x" || connectorId === "reddit") {
    return trackingMode === "self" ? "CONNECTED_ACCOUNT" : "OFFICIAL_PUBLIC_API";
  }
  return "UNAVAILABLE" as const;
}

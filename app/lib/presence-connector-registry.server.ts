import { gdeltConnector } from "~/lib/presence-connectors/gdelt.server";
import { hnConnector } from "~/lib/presence-connectors/hn.server";
import { linkedinConnector } from "~/lib/presence-connectors/linkedin.server";
import { blueskyConnector } from "~/lib/presence-connectors/bluesky.server";
import { pinterestConnector } from "~/lib/presence-connectors/pinterest.server";
import { redditConnector } from "~/lib/presence-connectors/reddit.server";
import { reviewSitesConnector } from "~/lib/presence-connectors/review-sites.server";
import { rssConnector } from "~/lib/presence-connectors/rss.server";
import { threadsConnector } from "~/lib/presence-connectors/threads.server";
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
  bluesky: blueskyConnector,
  gdelt: gdeltConnector,
  threads: threadsConnector,
  hn: hnConnector,
  pinterest: pinterestConnector,
  review_sites: reviewSitesConnector,
} as const;

export function getPresenceConnector(connectorId: PresenceConnectorId) {
  return CONNECTORS[connectorId];
}

/**
 * The connector ids whose stored `presence_item` rows count as mentions of a
 * tracked entity (issue #3179). Everything except `website`: the website
 * connector watches the tracked site itself; these connectors capture what
 * the public web published ABOUT the entity. Bluesky and GDELT landed in
 * #3251/#3250 and belong here with rss/x/reddit. Threads (#3254's
 * keyword-search connector) belongs here too — its stored rows are public
 * mentions of the tracked keywords, and they only exist when its env gate
 * is on. LinkedIn stays out — its LIMITED_COVERAGE self-brand-only posture
 * is not a general mention source.
 */
export const PRESENCE_MENTION_CONNECTOR_IDS: PresenceConnectorId[] = [
  "rss",
  "x",
  "reddit",
  "gdelt",
  "bluesky",
  "threads",
];

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
    cursor?: {
      etag?: string | null;
      lastModified?: string | null;
      /** Prior presence_poll_cursor.cursor_json — connectors that meter usage merge it forward. */
      record?: Record<string, unknown>;
    };
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
  if (target.connectorId === "gdelt") {
    return gdeltConnector.poll(ctx, target as Parameters<typeof gdeltConnector.poll>[1]);
  }
  if (target.connectorId === "threads") {
    return threadsConnector.poll(ctx, target);
  }
  if (target.connectorId === "hn") {
    // The prior cursor_json carries the time-window watermark
    // (lastItemCreatedAtI) — same wrapper the x/website/rss connectors read.
    return hnConnector.poll(ctx, target, options.cursor);
  }
  if (target.connectorId === "review_sites") {
    // The connector re-reads the published page window each poll; the
    // (source_target_id, url_hash) UNIQUE constraint dedupes the overlap, so
    // no cursor is carried (bluesky/threads precedent).
    return reviewSitesConnector.poll(ctx, target);
  }
  if (target.connectorId === "x") {
    return xConnector.poll(ctx, target, options.cursor);
  }
  if (target.connectorId === "reddit") {
    return redditConnector.poll(ctx, target);
  }
  if (target.connectorId === "bluesky") {
    // The mention connector needs the entity's match phrase; it reaches the
    // phrase surface through target_key — the connector itself decides.
    return blueskyConnector.poll(ctx, target);
  }
  if (target.connectorId === "pinterest") {
    // The mention connector tracks a Pinterest profile by handle; it reads
    // the handle surface through target_key/metadata — the connector itself
    // decides (same convention as the bluesky/threads dispatches; the
    // #3386 lesson: the registry MUST pass the whole target, not just env).
    return pinterestConnector.poll(ctx, target);
  }
  return linkedinConnector.poll(ctx, target);
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
  if (connectorId === "pinterest") {
    // The profile feed is a public RSS 2.0 feed — same syndication class as
    // the rss connector, not a documented paid API (issue #3201).
    return "VERIFIED_PUBLIC_FEED" as const;
  }
  if (connectorId === "gdelt" || connectorId === "threads" || connectorId === "hn") {
    return "OFFICIAL_PUBLIC_API" as const;
  }
  if (connectorId === "review_sites") {
    // A public business-unit review page — the same page a human reads,
    // fetched best-effort (bot-verification interstitials are an honestly
    // recorded failure, never a fabricated capture).
    return "PUBLIC_WEB_BEST_EFFORT" as const;
  }
  if (connectorId === "linkedin" && trackingMode === "competitor") {
    return "LIMITED_COVERAGE" as const;
  }
  if (connectorId === "x" || connectorId === "reddit" || connectorId === "bluesky") {
    return trackingMode === "self" ? "CONNECTED_ACCOUNT" : "OFFICIAL_PUBLIC_API";
  }
  return "UNAVAILABLE" as const;
}

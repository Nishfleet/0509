import { sanitizeAgentActionMetadata } from "~/lib/agent-actions.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  WebMentionSource,
  WebMentionTargetRecord,
} from "~/lib/types";
import {
  CustomerAgentActionError,
  readBoolean,
  readInteger,
  readString,
  readStringList,
} from "~/lib/customer-agent-actions/request.server";

export async function listWebMentionsFromAgent(
  env: AppEnv,
  userId: string,
  input: Record<string, unknown>,
) {
  const {
    getWatchlist,
    listWebMentionObservations,
    listWebMentionTargets,
  } = await import("~/lib/data.server");
  const watchlistId = readString(input, "watchlistId");
  if (watchlistId) {
    const watchlist = await getWatchlist(env, watchlistId, userId);
    if (!watchlist) {
      throw new CustomerAgentActionError("watchlist_not_found", "Watchlist not found.", { status: 404 });
    }
  }

  const sources = readWebMentionSources(input);
  const includeInactive = readBoolean(input, "includeInactive", false);
  const [targets, observations] = await Promise.all([
    listWebMentionTargets(env, userId, {
      ...(watchlistId ? { watchlistId } : {}),
      includeInactive,
      limit: readInteger(input, "targetLimit", 50),
    }),
    listWebMentionObservations(env, userId, {
      ...(watchlistId ? { watchlistId } : {}),
      sources,
      includeInactive,
      limit: readInteger(input, "limit", 50),
    }),
  ]);

  return {
    ok: true,
    action: "web_mentions.list",
    status: "available",
    boundary:
      "Returns existing source-backed website, blog, and Substack observations only. X, Reddit, YouTube, LinkedIn, and broad social listening are not live.",
    watchlistId,
    supportedSources: supportedWebMentionSources,
    targets: targets.map(safeWebMentionTargetRecord),
    observations: observations.map((observation) => ({
      id: observation.id,
      targetId: observation.targetId,
      source: observation.source,
      sourceId: observation.sourceId,
      url: observation.url,
      title: observation.title,
      author: observation.author,
      excerpt: observation.excerpt,
      publishedAt: observation.publishedAt,
      observedAt: observation.observedAt,
      sentiment: observation.sentiment,
      engagement: sanitizeAgentActionMetadata(observation.engagement),
      createdAt: observation.createdAt,
    })),
  };
}

const supportedWebMentionSources: WebMentionSource[] = ["blog", "substack", "web"];

function readWebMentionSources(input: Record<string, unknown>) {
  const requested = readStringList(input, "sources");
  if (requested.length === 0) {
    return supportedWebMentionSources;
  }

  return Array.from(new Set(requested.map((source) => {
    if (supportedWebMentionSources.includes(source as WebMentionSource)) {
      return source as WebMentionSource;
    }
    throw new CustomerAgentActionError(
      "unsupported_web_mention_source",
      "web_mentions.list currently supports blog, substack, and web only.",
    );
  })));
}

function safeWebMentionTargetRecord(target: WebMentionTargetRecord) {
  return {
    id: target.id,
    watchlistId: target.watchlistId,
    trackingRole: target.trackingRole,
    label: target.label,
    queryText: target.queryText,
    domain: target.domain,
    sources: target.sources.filter((source) => supportedWebMentionSources.includes(source)),
    isActive: target.isActive,
    lastCheckedAt: target.lastCheckedAt,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
  };
}

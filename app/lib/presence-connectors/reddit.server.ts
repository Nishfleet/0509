import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import type {
  CostEstimate,
  HealthCheckResult,
  PollResult,
  PresenceConnectorContext,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";

export const redditConnector = {
  id: "reddit" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return { units: 3, description: "Official Reddit API read (commercial-access gated)" };
  },

  async validateTarget(
    input: ValidateTargetInput,
    ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "reddit", input.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        coverageLabel: "LIMITED_COVERAGE",
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "Reddit connector is not available.",
      };
    }

    const subreddit = normalizeSubreddit(input.targetHandle ?? input.targetUrl);
    if (!subreddit) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_subreddit",
        errorMessage: "Enter a subreddit name, like r/brand.",
      };
    }

    return {
      ok: true,
      targetKey: subreddit,
      targetHandle: subreddit,
      coverageLabel: "OFFICIAL_PUBLIC_API",
    };
  },

  async healthCheck(ctx: PresenceConnectorContext): Promise<HealthCheckResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "reddit", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "Reddit commercial access pending.",
        errorCode: gate.reasonCode,
      };
    }
    return { ok: true, status: "healthy", summary: "Reddit API credentials configured." };
  },

  async poll(ctx: PresenceConnectorContext): Promise<PollResult> {
    if (ctx.env.PRESENCE_REDDIT_MOCK === "1") {
      const now = new Date().toISOString();
      return {
        ok: true,
        items: [
          {
            externalId: "mock-reddit-1",
            canonicalUrl: "https://www.reddit.com/r/example/comments/mock",
            title: "Mock Reddit post",
            bodyExcerpt: "Presence tracking mock item for tests.",
            author: "u/example",
            publishedAt: now,
            observedAt: now,
            contentHash: "mock",
          },
        ],
        costUnits: 0,
      };
    }

    const gate = await evaluateConnectorAccessGate(ctx.env, "reddit", ctx.trackingMode);
    return {
      ok: false,
      items: [],
      errorCode: gate.reasonCode ?? "connector_disabled",
      errorMessage: gate.reasonMessage ?? "Reddit connector is not enabled.",
    };
  },
};

function normalizeSubreddit(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim().replace(/^r\//i, "").toLowerCase();
  return /^[a-z0-9_]{2,21}$/.test(trimmed) ? trimmed : null;
}

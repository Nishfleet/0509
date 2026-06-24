import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import type {
  CostEstimate,
  HealthCheckResult,
  PollResult,
  PresenceConnectorContext,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";

export const LINKEDIN_OAUTH_SCOPES = ["r_organization_social", "r_basicprofile"] as const;

export const linkedinConnector = {
  id: "linkedin" as const,
  supportedModes: ["self"] as const,

  estimateCost(): CostEstimate {
    return { units: 4, description: "LinkedIn organization API read (OAuth)" };
  },

  async validateTarget(
    input: ValidateTargetInput,
    ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    if (input.trackingMode === "competitor") {
      return {
        ok: false,
        coverageLabel: "LIMITED_COVERAGE",
        errorCode: "competitor_limited",
        errorMessage: "LinkedIn competitor tracking is pending — limited coverage only.",
      };
    }

    const gate = await evaluateConnectorAccessGate(ctx.env, "linkedin", input.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "LinkedIn connector is not available.",
      };
    }

    const orgId = input.metadata?.organizationId;
    if (typeof orgId !== "string" || !/^\d+$/.test(orgId)) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_organization",
        errorMessage: "Connect LinkedIn and select an organization to track.",
      };
    }

    return {
      ok: true,
      targetKey: orgId,
      targetHandle: typeof input.targetHandle === "string" ? input.targetHandle : null,
      coverageLabel: "CONNECTED_ACCOUNT",
      metadata: { organizationId: orgId },
    };
  },

  async healthCheck(ctx: PresenceConnectorContext): Promise<HealthCheckResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "linkedin", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "LinkedIn OAuth is not configured.",
        errorCode: gate.reasonCode,
      };
    }

    if (!ctx.connection || ctx.connection.status !== "healthy") {
      return {
        ok: false,
        status: "pending",
        summary: "Connect your LinkedIn organization account to enable self tracking.",
        errorCode: "oauth_required",
      };
    }

    return { ok: true, status: "healthy", summary: "LinkedIn organization connected." };
  },

  async poll(ctx: PresenceConnectorContext): Promise<PollResult> {
    if (ctx.env.PRESENCE_LINKEDIN_MOCK === "1") {
      const now = new Date().toISOString();
      return {
        ok: true,
        items: [
          {
            externalId: "mock-li-1",
            canonicalUrl: "https://www.linkedin.com/feed/update/mock",
            title: "Mock LinkedIn update",
            bodyExcerpt: "Presence tracking mock item for tests.",
            author: "Example Org",
            publishedAt: now,
            observedAt: now,
            contentHash: "mock",
          },
        ],
        costUnits: 0,
      };
    }

    const gate = await evaluateConnectorAccessGate(ctx.env, "linkedin", ctx.trackingMode);
    return {
      ok: false,
      items: [],
      errorCode: gate.reasonCode ?? "connector_disabled",
      errorMessage: gate.reasonMessage ?? "LinkedIn connector is not enabled.",
    };
  },
};

export function buildLinkedInOAuthAuthorizeUrl(
  env: import("~/lib/env.server").AppEnv,
  state: string,
  pkceChallenge: string,
) {
  const clientId = env.LINKEDIN_CLIENT_ID?.trim();
  if (!clientId) {
    return null;
  }
  const redirectUri = `${env.BETTER_AUTH_URL?.replace(/\/$/, "") ?? "https://0509.io"}/api/presence/oauth/linkedin/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: LINKEDIN_OAUTH_SCOPES.join(" "),
    code_challenge: pkceChallenge,
    code_challenge_method: "S256",
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

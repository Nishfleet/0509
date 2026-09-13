import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import { decryptCredential } from "~/lib/credential-crypto.server";
import { presenceContentHash } from "~/lib/presence-hash";
import { presenceSafeFetch } from "~/lib/presence-robots.server";
import { normalizePublicHttpUrl } from "~/lib/public-url.server";
import type {
  CostEstimate,
  HealthCheckResult,
  NormalizedPresenceItem,
  PollResult,
  PresenceConnectorContext,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";

export const LINKEDIN_OAUTH_SCOPES = ["r_organization_social", "r_basicprofile"] as const;

/**
 * The versioned Posts-API base. Issue #3204: the connector captures the
 * tracked organization's own published posts — the lawful, documented, $0
 * public surface (LinkedIn ToS prohibit scraping, so unofficial scrapers were
 * researched and rejected; see docs/mentions/PLAN.md, §2, LinkedIn row).
 *
 * Versioned API: every call carries `X-Restli-Protocol-Version: 2.0.0` and a
 * `LinkedIn-Version: YYYYMM` header (official Posts API, fetched live
 * 2026-09-13; the page's own versioned string is 202508). Retrieval is
 * `GET /rest/posts?author=urn:li:organization:{id}` — the member token from
 * the stored connection must administer that organization (r_organization_social).
 * `sortBy=CREATED` (descending) + `count` (documented: default 10, max 100)
 * bound the response; the connector takes 25.
 */
const LINKEDIN_POSTS_API_URL = "https://api.linkedin.com/rest/posts";
const LINKEDIN_VERSIONED_API_VERSION = "202508";
const LINKEDIN_POSTS_COUNT = 25;
const LINKEDIN_MAX_RESPONSE_BYTES = 500_000;

/** What the registry dispatch hands the connector: the stored source target. */
export interface LinkedInPollTarget {
  targetKey: string | null;
  targetHandle: string | null;
  metadata: Record<string, unknown>;
}

interface LinkedInPostElement {
  id?: unknown;
  commentary?: unknown;
  author?: unknown;
  publishedAt?: unknown;
  createdAt?: unknown;
  lifecycleState?: unknown;
}

/**
 * `presenceSafeFetch` owns the header set it sends, so the bearer credential
 * and the two versioned-API protocol headers are injected by wrapping the
 * fetcher it calls — the SSRF re-validation, presence User-Agent, redirect
 * handling and bounded read all still apply (x-connector precedent).
 */
function versionedFetch(accessToken: string, fetchImpl: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${accessToken}`);
    headers.set("X-Restli-Protocol-Version", "2.0.0");
    headers.set("LinkedIn-Version", LINKEDIN_VERSIONED_API_VERSION);
    return fetchImpl(input, { ...init, headers });
  }) as typeof fetch;
}

/**
 * One FIND request for the tracked organization's posts, newest first.
 * Exactly one request per poll — no parallel fan-out, no pagination loop
 * (the documented count cap bounds the page; cost is $0, so no usage ledger
 * rides the poll cursor — see PLAN.md §2, LinkedIn rate budget).
 */
export function buildOrganizationPostsUrl(organizationId: string): string {
  const url = new URL(LINKEDIN_POSTS_API_URL);
  url.searchParams.set("author", `urn:li:organization:${organizationId}`);
  url.searchParams.set("count", String(LINKEDIN_POSTS_COUNT));
  url.searchParams.set("sortBy", "CREATED");
  return url.toString();
}

/**
 * The organization validateTarget stored: `metadata.organizationId` first,
 * the digits of `targetKey` as the stored fallback. Either way it is digits —
 * a target whose stored identity no longer parses fails closed WITHOUT a
 * request (the rate budget is not spent on a call that cannot succeed).
 */
function resolveOrganizationId(target?: LinkedInPollTarget): string | null {
  const metadataId = target?.metadata?.organizationId;
  if (typeof metadataId === "string" && /^\d+$/.test(metadataId.trim())) {
    return metadataId.trim();
  }
  if (typeof target?.targetKey === "string" && /^\d+$/.test(target.targetKey.trim())) {
    return target.targetKey.trim();
  }
  return null;
}

function finiteEpochMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Element → normalized mention. Only PUBLISHED posts whose stored URN yields
 * a public, www.linkedin.com update URL are captured — everything else is
 * skipped, never fabricated from the request URL (GDELT precedent).
 */
async function normalizeLinkedInPost(
  element: LinkedInPostElement,
  fallbackAuthor: string | null,
): Promise<NormalizedPresenceItem | null> {
  if (element.lifecycleState !== "PUBLISHED") return null;
  const externalId = typeof element.id === "string" ? element.id.trim() : "";
  if (!externalId) return null;
  // The post's canonical public location: the stable /feed/update/ URLs the
  // post URN addresses. Constructed, so the hostname check is the #3360
  // reviewer precedent: only a linkedin.com URL may become canonical.
  const permalink = normalizePublicHttpUrl(`https://www.linkedin.com/feed/update/${externalId}`);
  if (!permalink || !/(^|\.)linkedin\.com$/.test(permalink.hostname)) return null;

  const commentary = typeof element.commentary === "string" ? element.commentary.trim() : "";
  const firstLine = commentary.split("\n")[0]?.trim() ?? "";
  const title = firstLine.length > 200 ? `${firstLine.slice(0, 197)}…` : firstLine || "Untitled LinkedIn post";
  const bodyExcerpt = commentary.length > 280 ? `${commentary.slice(0, 277)}…` : commentary || null;
  const publishedAtMs = finiteEpochMs(element.publishedAt) ?? finiteEpochMs(element.createdAt);
  const publishedAt = publishedAtMs ? new Date(publishedAtMs).toISOString() : null;
  const author = fallbackAuthor ?? (typeof element.author === "string" && element.author ? element.author : null);

  return {
    externalId,
    canonicalUrl: permalink.toString(),
    title,
    bodyExcerpt,
    author,
    publishedAt,
    observedAt: new Date().toISOString(),
    contentHash: await presenceContentHash({ title, bodyExcerpt, author, publishedAt }),
  };
}

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

  /**
   * #3204 — real capture path. The kill flag (`PRESENCE_LINKEDIN_ROLLOUT`)
   * is evaluated first (via the shared access gate), then the per-user OAuth
   * connection: no connection or an unrestorable stored token fails closed
   * WITHOUT any request — the documented per-organization budget is never
   * spent on a poll that cannot succeed. Exactly one Posts-API request per
   * successful-or-4xx poll; 4xx/5xx map to honest degraded results, never
   * fabricated items; an empty element list is an honest empty result.
   */
  async poll(ctx: PresenceConnectorContext, target?: LinkedInPollTarget): Promise<PollResult> {
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
    if (!gate.allowed) {
      return {
        ok: false,
        items: [],
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "LinkedIn connector is not enabled.",
      };
    }

    // The OAuth grant is the credential: it was stored (encrypted) by the
    // /api/presence/oauth/linkedin/callback route on the source_connection
    // row the service layer resolves and passes here. A missing/decaying
    // connection is an honest degraded poll, not a retried hammer.
    const connection = ctx.connection;
    if (!connection || connection.connectorId !== "linkedin" || connection.status !== "healthy") {
      return {
        ok: false,
        items: [],
        errorCode: "oauth_required",
        errorMessage: "Connect your LinkedIn organization account to capture its posts.",
      };
    }

    const organizationId = resolveOrganizationId(target);
    if (!organizationId) {
      return {
        ok: false,
        items: [],
        errorCode: "missing_organization",
        errorMessage: "LinkedIn target has no organization to read posts for.",
      };
    }

    let accessToken: string | null = null;
    try {
      accessToken = await decryptCredential(ctx.env, connection.encryptedCredentials);
    } catch {
      // Unsupported/corrupt stored credential — honest degraded result, never
      // a thrown poll: the account reconnects through the existing OAuth route.
      accessToken = null;
    }
    if (!accessToken) {
      return {
        ok: false,
        items: [],
        errorCode: "linkedin_token_missing",
        errorMessage: "The stored LinkedIn credential could not be restored — reconnect the account.",
      };
    }

    // Exactly one serialized request per poll — the rate budget in PLAN.md §2.
    const fetchImpl = versionedFetch(accessToken, ctx.fetchImpl ?? fetch);
    const response = await presenceSafeFetch(
      buildOrganizationPostsUrl(organizationId),
      fetchImpl,
      { method: "GET", maxBytes: LINKEDIN_MAX_RESPONSE_BYTES, accept: "application/json" },
    );

    if (!response) {
      return {
        ok: false,
        items: [],
        errorCode: "fetch_failed",
        errorMessage: "Could not reach the LinkedIn Posts API.",
      };
    }

    if (!response.ok || !response.body) {
      // 4xx/5xx are honest degraded results — never fabricated items. 401
      // means the stored grant no longer answers: the account must reconnect
      // through the existing OAuth route (no silent refresh, no stored
      // client-secret-to-bridge — that machinery does not exist yet).
      const errorCode =
        response.status === 429
          ? "rate_limited"
          : response.status === 401
            ? "linkedin_auth_failed"
            : "linkedin_source_error";
      return {
        ok: false,
        items: [],
        errorCode,
        errorMessage: `LinkedIn Posts API responded with HTTP ${response.status}.`,
        coverageLabel: "CONNECTED_ACCOUNT",
      };
    }

    let parsed: { elements?: LinkedInPostElement[] };
    try {
      parsed = JSON.parse(response.body) as { elements?: LinkedInPostElement[] };
    } catch {
      return {
        ok: false,
        items: [],
        errorCode: "linkedin_parse_failed",
        errorMessage: "LinkedIn Posts API response was not valid JSON.",
        coverageLabel: "CONNECTED_ACCOUNT",
      };
    }

    const elements = Array.isArray(parsed.elements)
      ? (parsed.elements as LinkedInPostElement[]).slice(0, LINKEDIN_POSTS_COUNT)
      : [];
    // A non-array/absent element list is an honest empty result — there are
    // no posts (yet), not a failure.
    const fallbackAuthor =
      typeof target?.targetHandle === "string" && target.targetHandle.trim()
        ? target.targetHandle.trim()
        : null;
    const items: NormalizedPresenceItem[] = [];
    for (const element of elements) {
      const normalized = await normalizeLinkedInPost(element, fallbackAuthor);
      if (normalized) {
        items.push(normalized);
      }
    }

    return {
      ok: true,
      items,
      coverageLabel: "CONNECTED_ACCOUNT",
      costUnits: 0,
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

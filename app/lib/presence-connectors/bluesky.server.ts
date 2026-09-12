import { readResponseJsonWithinLimit } from "~/lib/bounded-response.server";
import { fetchWithTimeout, releaseFetchTimeout } from "~/lib/fetch-timeout.server";
import { presenceContentHash } from "~/lib/presence-hash";
import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import { resolvePublicHttpUrl } from "~/lib/public-url.server";
import type {
  CostEstimate,
  HealthCheckResult,
  NormalizedPresenceItem,
  PollResult,
  PresenceConnectorContext,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";

// research: This is a raw JSON XRPC client (fetch against the AT-Protocol
// appview endpoints documented at
// https://docs.bsky.app/docs/api/app-bsky-feed-search-posts) rather than the
// `@atproto/api` SDK. The connector uses exactly two endpoints
// (com.atproto.server.createSession, app.bsky.feed.searchPosts), so the SDK's
// install weight and API surface buy nothing here (the dependency comparison
// lives in the PR body: raw client chosen, no new npm dependency at all).
// help-first: the deterministic test entry point is
// `npx vitest run tests/integration/bluesky-mention-connector.integration.test.ts`.
//
// Host overrides (PRESENCE_BSKY_PDS_URL / PRESENCE_BSKY_APPVIEW_URL) exist so
// the integration test can pin both endpoints to an IP-literal fixture host —
// that skips the DNS hop resolvePublicHttpUrl makes, the same trick the rss
// test uses with https://1.1.1.1. Production defaults are the public
// Bluesky endpoints derived from the documented API surface.
const DEFAULT_APPVIEW_URL = "https://public.api.bsky.app";
const DEFAULT_PDS_URL = "https://bsky.social";

const FETCH_TIMEOUT_MS = 10_000;
const SESSION_MAX_BYTES = 16_000;
const SEARCH_MAX_BYTES = 512_000;
const MAX_PAGES = 2; // bounded cursor pagination per poll

interface SearchPostView {
  uri?: string | null;
  cid?: string | null;
  author?: { handle?: string | null };
  record?: { text?: string | null; createdAt?: string | null };
  indexedAt?: string | null;
}

interface SearchPostsResponse {
  posts?: SearchPostView[];
  cursor?: string | null;
  error?: string;
}

type SessionOutcome =
  | { ok: true; accessJwt: string }
  | { ok: false; errorCode: string; errorMessage: string };

export const blueskyConnector = {
  id: "bluesky" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return { units: 2, description: "Bluesky appview searchPosts (free, app-password authed)" };
  },

  async validateTarget(
    input: ValidateTargetInput,
    ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "bluesky", input.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "Bluesky connector is not available.",
      };
    }

    const phrase = normalizeMatchPhrase(input.targetHandle ?? input.targetUrl);
    if (!phrase) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_match_phrase",
        errorMessage: "Enter the match phrase to search Bluesky posts for.",
      };
    }

    return {
      ok: true,
      targetKey: phrase,
      targetHandle: phrase,
      coverageLabel: "OFFICIAL_PUBLIC_API",
    };
  },

  async healthCheck(ctx: PresenceConnectorContext): Promise<HealthCheckResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "bluesky", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "Bluesky connector is gated.",
        errorCode: gate.reasonCode,
      };
    }

    // Healthy means "searchPosts answers": create the session and run one
    // real (cheap, limit=1) query against the configured appview. A failure
    // surfaces as degraded, not fabricated health.
    const probe = await pollOnce(ctx, { phrase: "the", maxItems: 1 });
    if (!probe.ok) {
      return {
        ok: false,
        status: "degraded",
        summary: probe.errorMessage ?? "Bluesky session or search failed.",
        errorCode: probe.errorCode ?? null,
      };
    }
    return { ok: true, status: "healthy", summary: "Bluesky appview search answered." };
  },

  async poll(ctx: PresenceConnectorContext): Promise<PollResult> {
    if (ctx.env.PRESENCE_BLUESKY_MOCK === "1") {
      const now = new Date().toISOString();
      return {
        ok: true,
        items: [
          {
            externalId: "mock-bluesky-1",
            canonicalUrl: "https://bsky.app/profile/example.bsky.social/post/mock",
            title: "Mock Bluesky post",
            bodyExcerpt: "Presence tracking mock item for tests.",
            author: "example.bsky.social",
            publishedAt: now,
            observedAt: now,
            contentHash: "mock",
          },
        ],
        costUnits: 0,
      };
    }

    const gate = await evaluateConnectorAccessGate(ctx.env, "bluesky", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        items: [],
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "Bluesky connector is not enabled.",
      };
    }
    // The live poll path resolves the tracked entity's match phrase through
    // pollBlueskyMention below. A bare context (no phrase) fails fast rather
    // than searching an empty query.
    return {
      ok: false,
      items: [],
      errorCode: "missing_match_phrase",
      errorMessage: "No match phrase configured for this Bluesky source target.",
    };
  },
};

/**
 * Phrase-shaped live poll. The search surface is the entity's match phrase —
 * exact phrase, per the issue's advisory (exact phrase vs OR'd aliases). Empty
 * result sets are honest: `ok: true, items: []`.
 */
export async function pollBlueskyMention(
  ctx: PresenceConnectorContext,
  phraseInput: string,
): Promise<PollResult> {
  if (ctx.env.PRESENCE_BLUESKY_MOCK === "1") {
    return blueskyConnector.poll(ctx);
  }
  const gate = await evaluateConnectorAccessGate(ctx.env, "bluesky", ctx.trackingMode);
  if (!gate.allowed) {
    return {
      ok: false,
      items: [],
      errorCode: gate.reasonCode ?? "connector_disabled",
      errorMessage: gate.reasonMessage ?? "Bluesky connector is not enabled.",
    };
  }
  const phrase = normalizeMatchPhrase(phraseInput);
  if (!phrase) {
    return {
      ok: false,
      items: [],
      errorCode: "missing_match_phrase",
      errorMessage: "No match phrase configured for this Bluesky source target.",
    };
  }
  return pollOnce(ctx, { phrase });
}

async function pollOnce(
  ctx: PresenceConnectorContext,
  options: { phrase: string; maxItems?: number },
): Promise<PollResult> {
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const session = await createSession(ctx, fetchImpl);
  if (!session.ok) {
    return {
      ok: false,
      items: [],
      errorCode: session.errorCode,
      errorMessage: session.errorMessage,
    };
  }

  try {
    const items: NormalizedPresenceItem[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < (options.maxItems ? 1 : MAX_PAGES); page += 1) {
      const response = await searchPosts(ctx, fetchImpl, session.accessJwt, options.phrase, cursor);
      if (!response) {
        return {
          ok: false,
          items,
          errorCode: "bluesky_api_error",
          errorMessage: "Bluesky searchPosts did not answer.",
        };
      }
      const posts = response.posts ?? [];
      const normalized = await Promise.all(posts.map((post) => normalizePost(post)));
      items.push(...normalized);
      cursor = response.cursor ?? undefined;
      if (!cursor || (options.maxItems && items.length >= options.maxItems)) break;
    }
    return {
      ok: true,
      items: options.maxItems ? items.slice(0, options.maxItems) : items,
      cursor: cursor ? { cursor } : undefined,
      coverageLabel: "OFFICIAL_PUBLIC_API",
      costUnits: 0,
    };
  } finally {
    // The access JWT is ephemeral: it never leaves this closure — not stored,
    // not logged, and cleared before returning.
    session.accessJwt = "";
  }
}

async function createSession(
  ctx: PresenceConnectorContext,
  fetchImpl: typeof fetch,
): Promise<SessionOutcome> {
  const identifier = ctx.env.BSKY_IDENTIFIER?.trim();
  const password = ctx.env.BSKY_APP_PASSWORD?.trim();
  if (!identifier || !password) {
    return {
      ok: false,
      errorCode: "credentials_missing",
      errorMessage: "Bluesky API credentials are not configured.",
    };
  }
  const base = ctx.env.PRESENCE_BSKY_PDS_URL?.trim() || DEFAULT_PDS_URL;
  const url = await resolvePublicHttpUrl(`${base}/xrpc/com.atproto.server.createSession`);
  if (!url) {
    return {
      ok: false,
      errorCode: "ssrf_blocked",
      errorMessage: "Bluesky PDS endpoint failed the SSRF gate.",
    };
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(
      url.toString(),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      },
      { fetcher: fetchImpl, timeoutMs: FETCH_TIMEOUT_MS },
    );
  } catch {
    return {
      ok: false,
      errorCode: "bluesky_unreachable",
      errorMessage: "Bluesky session creation failed.",
    };
  }
  const payload = await readResponseJsonWithinLimit<{
    accessJwt?: string | null;
    error?: string;
    message?: string;
  }>(response, SESSION_MAX_BYTES);
  releaseFetchTimeout(response);
  if (!response.ok || !payload?.accessJwt) {
    return {
      ok: false,
      errorCode: "bluesky_auth_failed",
      errorMessage: `Bluesky session creation failed (${response.status}).`,
    };
  }
  return { ok: true, accessJwt: payload.accessJwt };
}

async function searchPosts(
  ctx: PresenceConnectorContext,
  fetchImpl: typeof fetch,
  accessJwt: string,
  phrase: string,
  cursor?: string,
): Promise<SearchPostsResponse | null> {
  const base = ctx.env.PRESENCE_BSKY_APPVIEW_URL?.trim() || DEFAULT_APPVIEW_URL;
  const url = new URL(`${base}/xrpc/app.bsky.feed.searchPosts`);
  url.searchParams.set("q", phrase);
  url.searchParams.set("sort", "latest");
  url.searchParams.set("limit", "100");
  if (cursor) url.searchParams.set("cursor", cursor);
  const resolved = await resolvePublicHttpUrl(url);
  if (!resolved) {
    return null;
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(
      resolved.toString(),
      { headers: { authorization: `Bearer ${accessJwt}` } },
      { fetcher: fetchImpl, timeoutMs: FETCH_TIMEOUT_MS },
    );
  } catch {
    return null;
  }
  const payload = await readResponseJsonWithinLimit<SearchPostsResponse>(response, SEARCH_MAX_BYTES);
  releaseFetchTimeout(response);
  return payload;
}

async function normalizePost(post: SearchPostView): Promise<NormalizedPresenceItem> {
  const text = post.record?.text?.trim() ?? "";
  const rkey = post.uri?.split("/").at(-1) ?? "";
  const handle = post.author?.handle ?? "unknown.bsky.social";
  const title = text.length > 200 ? `${text.slice(0, 197)}…` : text || "Untitled Bluesky post";
  const bodyExcerpt = text.length > 280 ? `${text.slice(0, 277)}…` : text;
  const publishedAt = post.record?.createdAt ?? post.indexedAt ?? new Date().toISOString();
  return {
    externalId: post.uri ?? post.cid ?? `bsky:${rkey}`,
    canonicalUrl: rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : "",
    title,
    bodyExcerpt,
    author: handle,
    publishedAt,
    observedAt: new Date().toISOString(),
    contentHash: await presenceContentHash({
      title,
      bodyExcerpt,
      author: handle,
      publishedAt,
    }),
  };
}

function normalizeMatchPhrase(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length >= 2 && trimmed.length <= 300 ? trimmed : null;
}

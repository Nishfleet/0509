import { Client, type FetchHandler } from "@atcute/client";
import "@atcute/atproto";
import "@atcute/bluesky";
import { readResponseTextWithinLimit } from "~/lib/bounded-response.server";
import { fetchWithTimeout } from "~/lib/fetch-timeout.server";
import { presenceContentHash } from "~/lib/presence-hash";
import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import { resolvePublicHttpUrl } from "~/lib/public-url.server";
import type {
  CostEstimate,
  HealthCheckResult,
  NormalizedPresenceItem,
  PollResult,
  PresenceConnectorContext,
  SourceTargetRecord,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";

// research: The XRPC transport is `@atcute/client` — chosen in the #3789
// dependency comparison (issue comment): +3 KiB gzip vs +152 KiB for
// `@atproto/api`, and `@atcute/bluesky`/`@atcute/atproto` contribute
// ambient-typed calls for `app.bsky.feed.searchPosts` /
// `com.atproto.server.createSession` at zero runtime bytes
// (`sideEffects: false`). The library only sees a `(pathname, init)` fetch
// handler — origin choice, the SSRF gate, timeouts and byte caps all stay in
// this file's handler below.
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

  async poll(ctx: PresenceConnectorContext, target?: SourceTargetRecord): Promise<PollResult> {
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
    // The tracked entity's match phrase rides the source target —
    // validateTarget stores it as target_key (and target_handle). A bare
    // context (no target phrase) fails fast rather than searching an empty
    // query. The live path delegates to pollBlueskyMention so the registry
    // dispatch and any direct caller share ONE poll body — the same gate,
    // phrase normalization, session handling and rate budget. Before #3206
    // this connector ignored the target entirely and every dispatched poll
    // answered missing_match_phrase, so no Bluesky mention was ever captured.
    const phrase = normalizeMatchPhrase(target?.targetKey ?? target?.targetHandle);
    if (!phrase) {
      return {
        ok: false,
        items: [],
        errorCode: "missing_match_phrase",
        errorMessage: "No match phrase configured for this Bluesky source target.",
      };
    }
    return pollBlueskyMention(ctx, phrase);
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

/**
 * Thrown inside the XRPC fetch handler when the resolved endpoint fails the
 * SSRF gate — callers map it to the connector's error codes.
 */
class EndpointBlockedError extends Error {}

function pdsBase(ctx: PresenceConnectorContext): string {
  return ctx.env.PRESENCE_BSKY_PDS_URL?.trim() || DEFAULT_PDS_URL;
}

function appviewBase(ctx: PresenceConnectorContext): string {
  return ctx.env.PRESENCE_BSKY_APPVIEW_URL?.trim() || DEFAULT_APPVIEW_URL;
}

/**
 * The one seam between `@atcute/client` and the outside world. The library
 * hands us `/xrpc/<nsid>?<query>` plus a RequestInit; everything else stays
 * ours — the origin is picked per-method (PDS for `com.atproto.server.*`,
 * appview otherwise), the absolute URL still goes through the SSRF gate, the
 * request rides `fetchWithTimeout` + `ctx.fetchImpl`, and the body is capped
 * (16 KiB session / 512 KiB search) before the library ever parses it. A
 * response over the cap reads as a 502 with an XRPC error payload.
 */
function gatedXrpcHandler(
  ctx: PresenceConnectorContext,
  fetchImpl: typeof fetch,
): FetchHandler {
  return async (pathname, init) => {
    const isPds = pathname.startsWith("/xrpc/com.atproto.server.");
    const base = isPds ? pdsBase(ctx) : appviewBase(ctx);
    const maxBytes = isPds ? SESSION_MAX_BYTES : SEARCH_MAX_BYTES;
    const resolved = await resolvePublicHttpUrl(new URL(pathname, base));
    if (!resolved) {
      throw new EndpointBlockedError();
    }
    const response = await fetchWithTimeout(resolved.toString(), init, {
      fetcher: fetchImpl,
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    const text = await readResponseTextWithinLimit(response, maxBytes);
    if (text === null) {
      return new Response(
        JSON.stringify({ error: "ResponseTooLarge", message: "XRPC response exceeded the byte cap." }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }
    // Only content-type crosses back over the seam: forwarding upstream
    // headers would carry a stale content-length/content-encoding for the
    // re-serialized body (and cookies we never asked for).
    return new Response(text, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  };
}

function xrpcClient(ctx: PresenceConnectorContext, fetchImpl: typeof fetch): Client {
  return new Client({ handler: gatedXrpcHandler(ctx, fetchImpl) });
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
  const client = xrpcClient(ctx, fetchImpl);
  try {
    const res = await client.post("com.atproto.server.createSession", {
      input: { identifier, password },
    });
    if (!res.ok || !res.data?.accessJwt) {
      return {
        ok: false,
        errorCode: "bluesky_auth_failed",
        errorMessage: `Bluesky session creation failed (${res.status}).`,
      };
    }
    return { ok: true, accessJwt: res.data.accessJwt };
  } catch (error) {
    if (error instanceof EndpointBlockedError) {
      return {
        ok: false,
        errorCode: "ssrf_blocked",
        errorMessage: "Bluesky PDS endpoint failed the SSRF gate.",
      };
    }
    return {
      ok: false,
      errorCode: "bluesky_unreachable",
      errorMessage: "Bluesky session creation failed.",
    };
  }
}

async function searchPosts(
  ctx: PresenceConnectorContext,
  fetchImpl: typeof fetch,
  accessJwt: string,
  phrase: string,
  cursor?: string,
): Promise<SearchPostsResponse | null> {
  const client = xrpcClient(ctx, fetchImpl);
  try {
    const res = await client.get("app.bsky.feed.searchPosts", {
      params: { q: phrase, sort: "latest", limit: 100, ...(cursor ? { cursor } : {}) },
      headers: { authorization: `Bearer ${accessJwt}` },
    });
    if (!res.ok) {
      const code = res.data?.error;
      // Unparseable or over-cap bodies were transport-class failures under
      // the raw-fetch version (null payload -> bluesky_api_error upstream);
      // a real XRPC error body still yields the honest empty page it did.
      // `UnknownXRPCError` is @atcute/client's sentinel for a non-XRPC error
      // body — if upstream renames it, HTML 5xxs flip back to empty pages.
      if (code === "UnknownXRPCError" || code === "ResponseTooLarge") {
        return null;
      }
      return { posts: [] };
    }
    return res.data as SearchPostsResponse;
  } catch {
    return null;
  }
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

import { readResponseJsonWithinLimit } from "~/lib/bounded-response.server";
import { fetchWithTimeout, releaseFetchTimeout } from "~/lib/fetch-timeout.server";
import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import { presenceContentHash } from "~/lib/presence-hash";
import { presenceSafeFetch } from "~/lib/presence-robots.server";
import { normalizePublicHttpUrl, resolvePublicHttpUrl } from "~/lib/public-url.server";
import type {
  CostEstimate,
  HealthCheckResult,
  NormalizedPresenceItem,
  PollResult,
  PresenceConnectorContext,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";

// research: This is a raw JSON client over `fetch` (Reddit Data API) rather
// than an SDK (snoowrap / PRAW / the published reddit-js wrappers). The
// connector uses exactly two endpoints (the OAuth2 client-credentials grant
// and the /r/<sub>/new listing), so a published wrapper's install weight,
// user-context assumptions and stale maintenance windows buy nothing for a
// fleet-owned read-only listing poll, and the repo keeps its
// zero-new-dependency connector posture (the gdelt/threads/bluesky
// precedent). The dependency comparison lives in the PR body: searched and
// rejected - snoowrap (built around a user-script grant, publish cadence
// stale), PRAW (Python, wrong runtime), and the 2026-wave wrapper packages
// (unmaintained). help-first: the deterministic test entry point is
// `npx vitest run tests/integration/reddit-mention-connector.integration.test.ts`.
/**
 * Reddit mention presence connector (issue #3202 — split of #3171, fed by the
 * #3178 mention-query adapter's subreddit candidates).
 *
 * Turns a tracked subreddit target (`targetKey`/`targetHandle` = the
 * subreddit slug, validated by `validateTarget`) into a Reddit Data API
 * listing poll (`GET https://oauth.reddit.com/r/<sub>/new?limit=100&raw_json=1`
 * behind an OAuth2 client-credentials access token) and emits normalized
 * `presence_item` rows — the mention table — whose `canonicalUrl` is the
 * post's www.reddit.com permalink and whose `raw` carries the free engagement
 * signals (score, num_comments) the mentions plan reserves.
 *
 * API: https://www.reddit.com/dev/api —
 *   grant:  POST https://www.reddit.com/api/v1/access_token (client_credentials)
 *   read:   https://oauth.reddit.com/r/<sub>/new
 * Terms: Data API Terms — OAuth required, no unauthenticated use; commercial
 * use requires Reddit's written approval (see docs/mentions/PLAN.md). The
 * gate already exists: `REDDIT_COMMERCIAL_ACCESS=approved`.
 *
 * Rate budget (documented): **100 requests per minute per OAuth client id,
 * averaged over a 10-minute window** (Data API Wiki). The env-held
 * client id/secret are ONE fleet principal, so the enforced usage is the SUM
 * of every reddit target's open window — the connector reads the counters
 * from `presence_poll_cursor.cursor_json` (`redditUsage`) across ALL reddit
 * targets before fetching and refuses the poll once they total the cap, so
 * the budget is enforced in connector logic and can never be silently
 * exceeded. Window shape: a 10-minute TUMBLING window with cap 1000 (100/min
 * × 10 min — exactly the documented allowance). Every attempted Data API read
 * counts (Threads precedent: a dropped request is counted — erring toward
 * fewer real queries); there is no documented "empty results are free"
 * exemption for Reddit, so successes AND failures count. The grant request is
 * not counted: the 100-QPM allowance meters Data API reads, and grants are
 * one per isolate per ~1h (the access token is cached in module state until
 * shortly before its documented expiry; `expires_in` bounds the cache).
 *
 * Every data hop goes through `presenceSafeFetch` (SSRF hardening +
 * redirects re-validated) — the bearer token rides via a wrapped fetchImpl
 * (x-connector precedent, because `presenceSafeFetch` owns the header set).
 * The token grant rides the bluesky createSession precedent:
 * `resolvePublicHttpUrl` + `fetchWithTimeout` + `readResponseJsonWithinLimit`
 * (SSRF-gated, bounded, released). A raw `fetch` to either endpoint is a
 * regression.
 *
 * Honest failures: 4xx/5xx/parse/unreachable map to honest degraded results —
 * never fabricated items. An empty listing is an honest empty result. The
 * item with no usable permalink is skipped, never fabricated.
 *
 * The connector stays dark behind `PRESENCE_ROLLOUT`/`PRESENCE_REDDIT_ROLLOUT`
 * (off by default; the gates also require the credentials and
 * `REDDIT_COMMERCIAL_ACCESS=approved`). `PRESENCE_REDDIT_MOCK=1` keeps the
 * e2e fixture item exactly as shipped — the mention-source-activation
 * integration test and the e2e provider depend on that branch, so its
 * position (first, before the gate) and shape are frozen.
 */
const REDDIT_OAUTH_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const REDDIT_API_BASE = "https://oauth.reddit.com";
const REDDIT_LISTING_MAX_BYTES = 750_000;
const REDDIT_TOKEN_MAX_BYTES = 16_000;
const REDDIT_LISTING_LIMIT = 100;
const MAX_REDDIT_EXCERPT_CHARS = 280;
const MAX_REDDIT_TITLE_CHARS = 120;
const REDDIT_FETCH_TIMEOUT_MS = 10_000;
/** Documented allowance: 100 requests/minute, averaged over a 10-minute window. */
export const REDDIT_RATE_BUDGET_PER_WINDOW = 1_000;
const REDDIT_WINDOW_MS = 10 * 60 * 1000;
/** Re-grant slightly before the documented ~1h expiry. */
const TOKEN_EXPIRY_SAFETY_MS = 60_000;

export interface RedditPollTarget {
  id: string;
  targetKey: string | null;
  targetUrl: string | null;
  targetHandle: string | null;
  metadata: Record<string, unknown>;
}

interface RedditUsageWindow {
  windowStart: string;
  count: number;
}

interface CachedAccessToken {
  token: string;
  expiresAtMs: number;
}

/**
 * Module-scoped because the grant is per-isolate, not per-target: the token
 * rides the one fleet OAuth client. `resetRedditAccessTokenCacheForTests`
 * exists because test files share module state — a 401-then-recover test must
 * start from a cold cache to be order-independent.
 */
let cachedAccessToken: CachedAccessToken | null = null;

export function resetRedditAccessTokenCacheForTests() {
  cachedAccessToken = null;
}

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

    // Healthy means "the Data API answers": one cheap (limit=1) real listing
    // through the documented endpoints. A failure surfaces as degraded, not
    // fabricated health. Like the threads precedent, the probe's own request
    // rides pollOnce without usage accounting — the orchestrated polls are
    // what the presence_poll_cursor ledger meters.
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const token = await getClientAccessToken(ctx, fetchImpl);
    if (!token.ok) {
      return {
        ok: false,
        status: "degraded",
        summary: token.errorMessage ?? "Reddit credential grant failed.",
        errorCode: token.errorCode ?? null,
      };
    }
    const probe = await pollOnce(ctx, token.token, null, { limit: 1 });
    if (!probe.ok) {
      return {
        ok: false,
        status: "degraded",
        summary: probe.errorMessage ?? "Reddit Data API did not answer a probe request.",
        errorCode: probe.errorCode ?? null,
      };
    }
    return { ok: true, status: "healthy", summary: "Reddit Data API answered a probe read." };
  },

  async poll(ctx: PresenceConnectorContext, target: RedditPollTarget): Promise<PollResult> {
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
    if (!gate.allowed) {
      return {
        ok: false,
        items: [],
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "Reddit connector is not enabled.",
      };
    }

    const credentials = readCredentials(ctx.env);
    if (!credentials) {
      return {
        ok: false,
        items: [],
        errorCode: "credentials_missing",
        errorMessage: "Reddit API credentials are not configured.",
      };
    }

    const subreddit = normalizeSubreddit(target?.targetKey ?? target?.targetHandle);
    if (!subreddit) {
      return {
        ok: false,
        items: [],
        errorCode: "missing_subreddit",
        errorMessage: "Reddit target has no subreddit to read.",
      };
    }

    // Enforce the documented 100-requests-per-10-minutes budget in connector
    // logic: read every reddit target's open usage window from
    // presence_poll_cursor.cursor_json and refuse the poll when they already
    // total the cap — never send a read we cannot account.
    const usage = await readRedditUsage(ctx, target.id);
    if (usage.used >= REDDIT_RATE_BUDGET_PER_WINDOW) {
      return {
        ok: false,
        items: [],
        errorCode: "reddit_rate_budget",
        errorMessage: `Reddit Data API budget reached (${REDDIT_RATE_BUDGET_PER_WINDOW} requests per 10-minute window; documented 100 QPM averaged over 10 minutes).`,
        coverageLabel: "OFFICIAL_PUBLIC_API",
      };
    }

    const fetchImpl = ctx.fetchImpl ?? fetch;
    const token = await getClientAccessToken(ctx, fetchImpl);
    if (!token.ok) {
      return {
        ok: false,
        items: [],
        errorCode: token.errorCode,
        errorMessage: token.errorMessage,
      };
    }

    return pollOnce(ctx, token.token, subreddit, { usage: usage });
  },
};

type TokenOutcome =
  | { ok: true; token: string }
  | { ok: false; errorCode: "credentials_missing" | "token_grant_failed" | "fetch_failed"; errorMessage: string };

function readCredentials(env: PresenceConnectorContext["env"]): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = env.REDDIT_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * OAuth2 client-credentials grant, cached in module state until shortly
 * before expiry. Rides the bluesky createSession precedent: the URL resolves
 * through the SSRF gate, the hop is bounded and timed, the payload read is
 * capped, and the timeout released. A 401 from the Data API drops the cache
 * so the next poll re-grants.
 */
async function getClientAccessToken(
  ctx: PresenceConnectorContext,
  fetchImpl: typeof fetch,
): Promise<TokenOutcome> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAtMs) {
    return { ok: true, token: cachedAccessToken.token };
  }
  const credentials = readCredentials(ctx.env);
  if (!credentials) {
    return {
      ok: false,
      errorCode: "credentials_missing",
      errorMessage: "Reddit API credentials are not configured.",
    };
  }
  const basic = btoa(`${credentials.clientId}:${credentials.clientSecret}`);
  let response: Response;
  try {
    response = await fetchWithTimeout(
      REDDIT_OAUTH_TOKEN_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
        },
        body: "grant_type=client_credentials",
      },
      { fetcher: fetchImpl, timeoutMs: REDDIT_FETCH_TIMEOUT_MS },
    );
  } catch {
    return {
      ok: false,
      errorCode: "fetch_failed",
      errorMessage: "Could not reach the Reddit OAuth2 token endpoint.",
    };
  }
  const payload = await readResponseJsonWithinLimit<{
    access_token?: string | null;
    expires_in?: number | null;
    error?: string;
  }>(response, REDDIT_TOKEN_MAX_BYTES);
  releaseFetchTimeout(response);
  if (!response.ok || !payload?.access_token) {
    return {
      ok: false,
      errorCode: "token_grant_failed",
      errorMessage: `Reddit credential grant failed (HTTP ${response.status}).`,
    };
  }
  const ttlMs =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? payload.expires_in * 1000
      : 0;
  const token = payload.access_token;
  if (ttlMs > TOKEN_EXPIRY_SAFETY_MS) {
    // `expires_in` is Reddit's documented token lifetime; cache until shortly
    // before expiry. Without it, re-grant next poll (safe, just noisier).
    cachedAccessToken = {
      token,
      expiresAtMs: Date.now() + ttlMs - TOKEN_EXPIRY_SAFETY_MS,
    };
  }
  return { ok: true, token };
}

/**
 * `presenceSafeFetch` owns the header set it sends, so the bearer is injected
 * by wrapping the fetcher it calls — the SSRF re-validation and bounded reads
 * all still apply (x-connector precedent).
 */
function bearerFetch(token: string, fetchImpl: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetchImpl(input, { ...init, headers });
  }) as typeof fetch;
}

async function pollOnce(
  ctx: PresenceConnectorContext,
  token: string,
  subreddit: string | null,
  options: { limit?: number; usage?: UsageLedger },
): Promise<PollResult> {
  const usage = options.usage;
  const limit = options.limit ?? REDDIT_LISTING_LIMIT;
  const url = `${REDDIT_API_BASE}/r/${subreddit}/new?limit=${limit}&raw_json=1`;
  const fetchImpl = bearerFetch(token, ctx.fetchImpl ?? fetch);
  const response = await presenceSafeFetch(url, fetchImpl, {
    method: "GET",
    maxBytes: REDDIT_LISTING_MAX_BYTES,
    accept: "application/json",
  });

  // The request was attempted; whether Reddit counts a dropped request is
  // undocumented, so we count it — erring toward fewer real reads.
  const countedCursor = usage?.nextCursor(true);

  if (!response) {
    return {
      ok: false,
      items: [],
      errorCode: "fetch_failed",
      errorMessage: "Could not reach the Reddit Data API.",
      coverageLabel: "OFFICIAL_PUBLIC_API",
      cursor: countedCursor,
    };
  }

  if (response.status === 401 || response.status === 403) {
    // The cached grant no longer works: drop it so the next poll re-grants.
    cachedAccessToken = null;
    return {
      ok: false,
      items: [],
      errorCode: "credentials_invalid",
      errorMessage: `Reddit Data API rejected the access token (HTTP ${response.status}).`,
      coverageLabel: "OFFICIAL_PUBLIC_API",
      cursor: countedCursor,
    };
  }

  if (!response.ok || !response.body) {
    return {
      ok: false,
      items: [],
      errorCode: response.status === 429 ? "rate_limited" : "reddit_api_error",
      errorMessage: `Reddit Data API responded with HTTP ${response.status}.`,
      coverageLabel: "OFFICIAL_PUBLIC_API",
      cursor: countedCursor,
    };
  }

  let parsed: ListingEnvelope;
  try {
    parsed = JSON.parse(response.body) as ListingEnvelope;
  } catch {
    return {
      ok: false,
      items: [],
      errorCode: "reddit_parse_failed",
      errorMessage: "Reddit Data API response was not valid JSON.",
      coverageLabel: "OFFICIAL_PUBLIC_API",
      cursor: countedCursor,
    };
  }

  const children = Array.isArray(parsed.data?.children) ? parsed.data.children : [];
  const items: NormalizedPresenceItem[] = [];
  for (const child of children) {
    const post = await normalizeRedditPost(child);
    if (post) {
      items.push(post);
    }
  }

  return {
    ok: true,
    items,
    coverageLabel: "OFFICIAL_PUBLIC_API",
    // The documented 100-QPM-averaged budget is exactly 1,000 requests per
    // 10-minute window; the counter persists via the poll orchestrator.
    cursor: countedCursor,
    costUnits: 0,
  };
}

interface ListingEnvelope {
  data?: { children?: RedditListingPost[] };
}

interface RedditListingPost {
  kind?: string;
  data?: {
    id?: string;
    title?: string;
    selftext?: string;
    author?: string;
    permalink?: string;
    created_utc?: number;
    score?: number;
    num_comments?: number;
    subreddit?: string;
  };
}

interface UsageLedger {
  used: number;
  nextCursor: (counted: boolean) => Record<string, unknown>;
}

/**
 * Reads every reddit target's `redditUsage` window out of
 * `presence_poll_cursor.cursor_json` and returns the fleet-wide total plus a
 * `nextCursor(counted)` that folds this target's own prior cursor keys
 * forward with the counter incremented (or the window rotated) as required.
 * The env-held client id/secret are a single fleet principal, so the sum is
 * taken across ALL reddit targets — not just this workspace user's.
 */
async function readRedditUsage(
  ctx: PresenceConnectorContext,
  targetId: string,
): Promise<UsageLedger> {
  const db = ctx.env.DB;
  const now = Date.now();

  if (!db) {
    // No D1 binding means no cursor persistence either — nothing can be
    // tracked, so there is no prior usage to enforce against.
    return { used: 0, nextCursor: (counted, extra = {}) => ({ ...extra }) };
  }

  const rows = await db
    .prepare(
      `SELECT st.id AS target_id, pc.cursor_json AS cursor_json
       FROM source_target st
       JOIN presence_poll_cursor pc ON pc.source_target_id = st.id
       WHERE st.connector_id = 'reddit' AND st.deleted_at IS NULL`,
    )
    .all<{ target_id: string; cursor_json: string }>();

  let used = 0;
  let ownCursor: Record<string, unknown> = {};
  for (const row of rows.results ?? []) {
    const cursor = parseCursorJson(row.cursor_json);
    const window = readUsageWindow(cursor, now);
    used += window?.count ?? 0;
    if (row.target_id === targetId) {
      ownCursor = cursor;
    }
  }

  const ownWindow = readUsageWindow(ownCursor, now);
  return {
    used,
    nextCursor: (counted, extra = {}) => {
      const redditUsage: RedditUsageWindow = counted
        ? ownWindow
          ? { windowStart: ownWindow.windowStart, count: ownWindow.count + 1 }
          : { windowStart: new Date(now).toISOString(), count: 1 }
        : (ownWindow ?? { windowStart: new Date(now).toISOString(), count: 0 });
      return { ...ownCursor, ...extra, redditUsage };
    },
  };
}

function readUsageWindow(cursor: Record<string, unknown>, now: number): RedditUsageWindow | null {
  const raw = cursor.redditUsage;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const { windowStart, count } = raw as Partial<RedditUsageWindow>;
  if (typeof windowStart !== "string" || typeof count !== "number") {
    return null;
  }
  const started = new Date(windowStart).getTime();
  if (Number.isNaN(started) || now - started >= REDDIT_WINDOW_MS) {
    return null; // window closed — its reads no longer count
  }
  return { windowStart, count };
}

function parseCursorJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function normalizeRedditPost(
  child: RedditListingPost,
): Promise<NormalizedPresenceItem | null> {
  const data = child?.data;
  if (!data?.permalink || !data.id) {
    return null;
  }
  // Only a normalizable public http(s) URL on www.reddit.com may become the
  // canonicalUrl (house convention, gdelt/threads precedent) — a Reddit
  // mention's canonical must actually be a reddit.com post permalink, so
  // anything else is skipped, never stored or later bot-fetched. The
  // canonicalUrl is never fabricated from the request URL.
  const canonical = normalizePublicHttpUrl(`https://www.reddit.com${data.permalink}`);
  if (!canonical || canonical.hostname !== "www.reddit.com") {
    return null;
  }

  const observedAt = new Date().toISOString();
  const title = (data.title ?? "").trim().slice(0, MAX_REDDIT_TITLE_CHARS) || "Reddit post";
  const selftext = typeof data.selftext === "string" ? data.selftext.trim() : "";
  const bodyExcerpt = selftext ? selftext.slice(0, MAX_REDDIT_EXCERPT_CHARS) : null;
  const author =
    typeof data.author === "string" && data.author && data.author !== "[deleted]"
      ? `u/${data.author}`
      : null;
  const publishedAt =
    typeof data.created_utc === "number" && Number.isFinite(data.created_utc)
      ? new Date(data.created_utc * 1000).toISOString()
      : null;

  return {
    externalId: data.id,
    canonicalUrl: canonical.toString(),
    title,
    bodyExcerpt,
    author,
    publishedAt,
    observedAt: new Date().toISOString(),
    contentHash: await presenceContentHash({
      title,
      bodyExcerpt,
      author,
      publishedAt,
    }),
    raw: {
      subreddit: typeof data.subreddit === "string" ? data.subreddit : null,
      score: typeof data.score === "number" ? data.score : null,
      numComments: typeof data.num_comments === "number" ? data.num_comments : null,
    },
  };
}

function normalizeSubreddit(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim().replace(/^r\//i, "").toLowerCase();
  return /^[a-z0-9_]{2,21}$/.test(trimmed) ? trimmed : null;
}

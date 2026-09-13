import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import type { AppEnv } from "~/lib/env.server";
import { buildMentionQuery } from "~/lib/mention-query.server";
import { presenceContentHash } from "~/lib/presence-hash";
import { presenceSafeFetch } from "~/lib/presence-robots.server";
import type {
  CostEstimate,
  HealthCheckResult,
  NormalizedPresenceItem,
  PollResult,
  PresenceConnectorContext,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";

/**
 * X presence connector — handle targets plus query-type mention-search targets
 * (issue #3255, parked under the MONEY flag).
 *
 * A query-type source_target carries the tracked entity's match phrase
 * (`target_key` = normalized phrase, `metadata_json.targetType === "query"` +
 * `metadata_json.matchPhrase`) and polls `GET /2/tweets/search/recent` on the
 * official X API v2. Handle targets keep their existing shape and map to a
 * `from:<handle>` recent-search query — both ride the same metered endpoint.
 *
 * MONEY flag: recent search is pay-per-use (~$0.005/post read — no free read
 * tier for new developers since Feb 2026). Every poll is a paid call, so the
 * connector refuses to fire one until the spend decision lands:
 * `X_PAID_ACCESS=approved` is the clearance flag (mirrors the plan doc's
 * `paid_source_pending_nish` marker — docs/mentions/PLAN.md). Until then
 * healthCheck/validateTarget/poll all report `paid_source_pending_nish` and no
 * network request is ever issued.
 *
 * Metering: each poll records `{ requests, posts }` per UTC day under
 * `cursor.meteredReads` in `presence_poll_cursor.cursor_json`, so spend is
 * observable per entity per day before any activation. `since_id` incremental
 * polling keeps each poll to the newest posts only.
 *
 * Every network hop goes through `presenceSafeFetch` (SSRF re-validation,
 * bounded response); the bearer token is injected by wrapping `fetchImpl`.
 */
const X_API_DEFAULT_BASE_URL = "https://api.x.com";
/** X requires max_results in [10, 100]; the floor keeps per-call spend smallest. */
const X_SEARCH_MAX_RESULTS = 10;
const MAX_X_RESPONSE_BYTES = 500_000;
const MAX_X_POST_EXCERPT_CHARS = 280;
const MAX_X_POST_TITLE_CHARS = 100;
const MAX_MATCH_PHRASE_CHARS = 128;
const X_METERED_DAYS_KEPT = 31;

export const X_PAID_PENDING_REASON_CODE = "paid_source_pending_nish";

/** The money flag: `X_PAID_ACCESS=approved` is set only after Nish's spend decision. */
export function xPaidAccessApproved(env: AppEnv): boolean {
  return env.X_PAID_ACCESS?.trim().toLowerCase() === "approved";
}

export type XPollTarget = {
  targetKey?: string;
  targetUrl?: string | null;
  targetHandle?: string | null;
  metadata?: Record<string, unknown>;
};

export interface XPollCursor {
  etag?: string | null;
  lastModified?: string | null;
  /** Prior `presence_poll_cursor.cursor_json` — carries meteredReads/sinceId forward. */
  record?: Record<string, unknown>;
}

export const xConnector = {
  id: "x" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return { units: 5, description: "Official X API recent search (pay-per-use reads, metered per entity per day)" };
  },

  async validateTarget(
    input: ValidateTargetInput,
    ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "x", input.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "X connector is not available.",
      };
    }

    if (!xPaidAccessApproved(ctx.env)) {
      return paidPendingTarget();
    }

    if (input.metadata?.targetType === "query") {
      const matchPhrase = normalizeMatchPhrase(input.metadata.matchPhrase);
      if (!matchPhrase) {
        return {
          ok: false,
          coverageLabel: "UNAVAILABLE",
          errorCode: "missing_match_phrase",
          errorMessage: "Enter the brand or person phrase to search on X.",
        };
      }
      const canonicalUrl =
        typeof input.metadata.canonicalUrl === "string" ? input.metadata.canonicalUrl : null;
      return {
        ok: true,
        targetKey: matchPhrase.toLowerCase(),
        targetHandle: null,
        coverageLabel: input.trackingMode === "self" ? "CONNECTED_ACCOUNT" : "OFFICIAL_PUBLIC_API",
        metadata: { targetType: "query", matchPhrase, ...(canonicalUrl ? { canonicalUrl } : {}) },
      };
    }

    const handle = normalizeHandle(input.targetHandle ?? input.targetUrl);
    if (!handle) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_handle",
        errorMessage: "Enter an X handle, like @brand.",
      };
    }

    return {
      ok: true,
      targetKey: handle,
      targetHandle: handle,
      coverageLabel: input.trackingMode === "self" ? "CONNECTED_ACCOUNT" : "OFFICIAL_PUBLIC_API",
    };
  },

  async healthCheck(ctx: PresenceConnectorContext): Promise<HealthCheckResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "x", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "X connector is gated.",
        errorCode: gate.reasonCode,
      };
    }
    if (!xPaidAccessApproved(ctx.env)) {
      return {
        ok: false,
        status: "pending",
        summary:
          "X mention search is a paid, metered source — reads are billed per post. Activation is pending a spend decision.",
        errorCode: X_PAID_PENDING_REASON_CODE,
      };
    }
    return {
      ok: true,
      status: "healthy",
      summary: "X API credentials configured; paid reads are approved and metered per entity per day.",
    };
  },

  async poll(
    ctx: PresenceConnectorContext,
    target?: XPollTarget,
    cursor?: XPollCursor,
  ): Promise<PollResult> {
    if (ctx.env.PRESENCE_X_MOCK === "1") {
      const now = new Date().toISOString();
      return {
        ok: true,
        items: [
          {
            externalId: "mock-x-1",
            canonicalUrl: "https://x.com/example/status/mock",
            title: "Mock X post",
            bodyExcerpt: "Presence tracking mock item for tests.",
            author: "@example",
            publishedAt: now,
            observedAt: now,
            contentHash: "mock",
          },
        ],
        costUnits: 0,
      };
    }

    const gate = await evaluateConnectorAccessGate(ctx.env, "x", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        items: [],
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "X connector is not enabled.",
      };
    }

    // The money flag: never issue a metered paid call before the spend decision.
    if (!xPaidAccessApproved(ctx.env)) {
      return paidPendingPoll();
    }

    const query = buildTargetQuery(target);
    if (!query) {
      return {
        ok: false,
        items: [],
        errorCode: "missing_query",
        errorMessage: "X source target has no match phrase or handle to search.",
      };
    }

    const searchUrl = buildRecentSearchUrl(ctx.env, query, cursor);
    const fetchImpl = bearerFetch(ctx.env.X_API_BEARER_TOKEN ?? "", ctx.fetchImpl ?? fetch);
    const response = await presenceSafeFetch(searchUrl, fetchImpl, {
      method: "GET",
      maxBytes: MAX_X_RESPONSE_BYTES,
      accept: "application/json",
      etag: cursor?.etag,
      lastModified: cursor?.lastModified,
    });

    if (!response) {
      return {
        ok: false,
        items: [],
        errorCode: "fetch_failed",
        errorMessage: "Could not reach the X recent-search endpoint.",
      };
    }

    if (response.notModified) {
      return {
        ok: true,
        items: [],
        costUnits: 0,
        etag: response.etag,
        lastModified: response.lastModified,
        coverageLabel: "OFFICIAL_PUBLIC_API",
        cursor: buildSearchCursor(query, cursor, 0),
      };
    }

    if (!response.ok || !response.body) {
      return {
        ok: false,
        items: [],
        errorCode: "search_unavailable",
        errorMessage: `X recent search responded with HTTP ${response.status}.`,
      };
    }

    const payload = parseSearchPayload(response.body);
    if (!payload) {
      return {
        ok: false,
        items: [],
        errorCode: "search_parse_failed",
        errorMessage: "X recent search returned a malformed response.",
        etag: response.etag,
        lastModified: response.lastModified,
      };
    }

    const items = await mapPostsToItems(payload);
    return {
      ok: true,
      items,
      etag: response.etag,
      lastModified: response.lastModified,
      coverageLabel: "OFFICIAL_PUBLIC_API",
      costUnits: items.length,
      cursor: buildSearchCursor(query, cursor, items.length, payload.meta?.newestId),
    };
  },
};

function paidPendingTarget(): ValidateTargetResult {
  return {
    ok: false,
    coverageLabel: "UNAVAILABLE",
    errorCode: X_PAID_PENDING_REASON_CODE,
    errorMessage: "X mention search is a paid source — activation is pending a spend decision.",
  };
}

function paidPendingPoll(): PollResult {
  return {
    ok: false,
    items: [],
    errorCode: X_PAID_PENDING_REASON_CODE,
    errorMessage: "X mention search is a paid source — activation is pending a spend decision.",
  };
}

function normalizeHandle(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(trimmed) ? trimmed : null;
}

function normalizeMatchPhrase(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_MATCH_PHRASE_CHARS);
}

/**
 * Query targets search the entity's match phrase through the canonical
 * `buildMentionQuery` builder (quoted label + canonical-domain OR term); handle
 * targets read that account's own posts. Retweets are excluded — a mention is
 * the original post, not the amplification.
 */
function buildTargetQuery(target: XPollTarget | undefined): string | null {
  if (!target) return null;
  const metadata = target.metadata ?? {};
  if (metadata.targetType === "query") {
    const phrase = normalizeMatchPhrase(metadata.matchPhrase) ?? normalizeMatchPhrase(target.targetKey);
    if (!phrase) return null;
    const canonicalUrl =
      typeof metadata.canonicalUrl === "string" ? metadata.canonicalUrl : null;
    const q = buildMentionQuery({ label: phrase, canonicalUrl }, "x").query.q;
    return q ? `${q} -is:retweet` : null;
  }
  const handle = normalizeHandle(target.targetHandle ?? target.targetKey);
  return handle ? `from:${handle} -is:retweet` : null;
}

function xApiBaseUrl(env: AppEnv): string {
  const override = env.X_API_BASE_URL?.trim();
  return (override || X_API_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function buildRecentSearchUrl(env: AppEnv, query: string, cursor?: XPollCursor): string {
  const url = new URL(`${xApiBaseUrl(env)}/2/tweets/search/recent`);
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(X_SEARCH_MAX_RESULTS));
  url.searchParams.set("tweet.fields", "created_at,author_id,lang");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username");
  const sinceId = typeof cursor?.record?.sinceId === "string" ? cursor.record.sinceId : null;
  if (sinceId) {
    url.searchParams.set("since_id", sinceId);
  }
  return url.toString();
}

/**
 * `presenceSafeFetch` owns the header set it sends, so auth is injected by
 * wrapping the fetcher it calls — the SSRF re-validation and bounded reads all
 * still apply.
 */
function bearerFetch(token: string, fetchImpl: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetchImpl(input, { ...init, headers });
  }) as typeof fetch;
}

interface XParsedPost {
  id: string;
  text: string;
  createdAt: string | null;
  authorId: string | null;
  lang: string | null;
}

interface XSearchPayload {
  posts: XParsedPost[];
  usersById: Map<string, string>;
  meta: { newestId: string | null };
}

function parseSearchPayload(body: string): XSearchPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as {
    data?: unknown;
    includes?: { users?: unknown };
    meta?: { newest_id?: unknown };
  };

  const usersById = new Map<string, string>();
  const users = Array.isArray(payload.includes?.users) ? payload.includes.users : [];
  for (const entry of users) {
    if (!entry || typeof entry !== "object") continue;
    const user = entry as { id?: unknown; username?: unknown };
    if (typeof user.id === "string" && typeof user.username === "string" && user.username) {
      usersById.set(user.id, user.username);
    }
  }

  const posts: XParsedPost[] = [];
  const data = Array.isArray(payload.data) ? payload.data : [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const tweet = entry as {
      id?: unknown;
      text?: unknown;
      created_at?: unknown;
      author_id?: unknown;
      lang?: unknown;
    };
    if (typeof tweet.id !== "string" || typeof tweet.text !== "string") continue;
    posts.push({
      id: tweet.id,
      text: tweet.text,
      createdAt: typeof tweet.created_at === "string" ? safeIsoDate(tweet.created_at) : null,
      authorId: typeof tweet.author_id === "string" ? tweet.author_id : null,
      lang: typeof tweet.lang === "string" ? tweet.lang : null,
    });
  }

  return {
    posts,
    usersById,
    meta: {
      newestId: typeof payload.meta?.newest_id === "string" ? payload.meta.newest_id : null,
    },
  };
}

async function mapPostsToItems(payload: XSearchPayload): Promise<NormalizedPresenceItem[]> {
  const items: NormalizedPresenceItem[] = [];
  for (const post of payload.posts) {
    const username = post.authorId ? payload.usersById.get(post.authorId) : undefined;
    const canonicalUrl = username
      ? `https://x.com/${username}/status/${post.id}`
      : `https://x.com/i/web/status/${post.id}`;
    const text = post.text.replace(/\s+/g, " ").trim();
    const observedAt = new Date().toISOString();
    const title =
      text.length > MAX_X_POST_TITLE_CHARS ? `${text.slice(0, MAX_X_POST_TITLE_CHARS - 1)}…` : text;
    const bodyExcerpt = text.slice(0, MAX_X_POST_EXCERPT_CHARS) || null;
    const author = username ? `@${username}` : null;
    items.push({
      externalId: post.id,
      canonicalUrl,
      title,
      bodyExcerpt,
      author,
      publishedAt: post.createdAt,
      observedAt,
      contentHash: await presenceContentHash({
        title,
        bodyExcerpt,
        author,
        publishedAt: post.createdAt,
      }),
      raw: { kind: "x_tweet", lang: post.lang, authorId: post.authorId },
    });
  }
  return items;
}

/**
 * Metered-read ledger carried in `presence_poll_cursor.cursor_json`: per UTC
 * day, `{ requests, posts }`. Merged forward from the prior cursor record so
 * spend stays observable per entity per day; pruned to the newest 31 day keys
 * so the JSON column stays small.
 */
function buildSearchCursor(
  query: string,
  prior: XPollCursor | undefined,
  postsRead: number,
  newestId?: string | null,
): Record<string, unknown> {
  const dayKey = new Date().toISOString().slice(0, 10);
  const meteredReads: Record<string, { requests: number; posts: number }> = {};

  const priorReads = prior?.record?.meteredReads;
  if (priorReads && typeof priorReads === "object") {
    for (const [key, value] of Object.entries(priorReads as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      meteredReads[key] = {
        requests:
          typeof entry.requests === "number" && entry.requests > 0 ? Math.floor(entry.requests) : 0,
        posts: typeof entry.posts === "number" && entry.posts > 0 ? Math.floor(entry.posts) : 0,
      };
    }
  }

  const today = meteredReads[dayKey] ?? { requests: 0, posts: 0 };
  meteredReads[dayKey] = { requests: today.requests + 1, posts: today.posts + postsRead };

  for (const key of Object.keys(meteredReads).sort().slice(0, -X_METERED_DAYS_KEPT)) {
    delete meteredReads[key];
  }

  const priorSinceId = typeof prior?.record?.sinceId === "string" ? prior.record.sinceId : null;
  return {
    kind: "x_recent_search",
    query,
    sinceId: newestId ?? priorSinceId,
    meteredReads,
  };
}

function safeIsoDate(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

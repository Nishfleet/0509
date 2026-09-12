import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
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
 * Threads keyword-search presence connector (issue #3254 — fast-follow
 * mention source, post-MVP, gated on Meta app review).
 *
 * Turns a tracked entity's match phrase into a Threads keyword search
 * (`GET https://graph.threads.net/v1.0/keyword_search?q=<phrase>` with the
 * `threads_keyword_search` permission) and emits normalized `presence_item`
 * rows whose `canonicalUrl` is the public threads.net post permalink.
 *
 * API: https://developers.facebook.com/docs/threads/keyword-search/
 * Terms: Meta Platform Terms + Threads API terms. Free, but the real cost is
 * Meta app-review lead time — before `threads_keyword_search` is approved the
 * search only returns posts owned by the authenticated user.
 *
 * Rate cap (documented): a user can send at most 2,200 queries in a rolling
 * 24h window, counted across apps, and queries that return no results do NOT
 * count. The cap rides on the authenticated principal — this connector uses
 * the env-held fleet token (`THREADS_ACCESS_TOKEN`), one Meta "user" shared
 * by every threads target, so the enforced usage is the SUM of all threads
 * targets' per-target counters. Each target's usage lives in its
 * `presence_poll_cursor.cursor_json` under `threadsUsage` — the connector
 * reads the counters before fetching and refuses the poll once the open
 * 24h windows total the cap, so the cap is enforced in connector logic and
 * can never be silently exceeded.
 *
 * Two honest approximations, both landing on Meta's documented 429 rather
 * than silent breakage: (1) the stored window is TUMBLING — all counted
 * queries expire together at `windowStart + 24h` — which under-counts
 * relative to Meta's per-query rolling expiry, so queries sent late in a
 * window can be released early and Meta's own 429 then surfaces as
 * `rate_limited` (counted, degraded poll); (2) the counter advances only
 * because the poll orchestrator persists the returned cursor back into
 * `presence_poll_cursor.cursor_json` (`pollPresenceSourceTarget` does) — a
 * direct `poll` caller that drops the cursor un-counts its own queries.
 * The counter is a fail-safe floor, not a mutex: polls are already
 * serialized upstream by `runPresencePollingBatch`.
 *
 * Every network hop goes through `presenceSafeFetch` (SSRF hardening +
 * redirects re-validated). A raw `fetch` to the Graph endpoint is a
 * regression.
 *
 * The connector ships dark behind `PRESENCE_THREADS_ROLLOUT` (off by
 * default); activation needs the flag, `THREADS_ACCESS_TOKEN`, the Meta app
 * approval, and the 0099 CHECK widen for `source_target.connector_id =
 * 'threads'` — not a code change here.
 */
const THREADS_API_BASE = "https://graph.threads.net/v1.0";
const THREADS_MAX_BYTES = 750_000;
const MAX_MATCH_PHRASE_CHARS = 256;
const MAX_THREADS_EXCERPT_CHARS = 280;
const MAX_THREADS_TITLE_CHARS = 120;
const THREADS_SEARCH_LIMIT = 100;
/** Documented cap: 2,200 keyword_search queries per user per rolling 24h. */
export const THREADS_DAILY_QUERY_CAP = 2_200;
const THREADS_USAGE_WINDOW_MS = 24 * 60 * 60 * 1000;
const THREADS_SEARCH_FIELDS =
  "id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply";

interface ThreadsUsageWindow {
  windowStart: string;
  count: number;
}

interface ThreadsMedia {
  id?: string;
  text?: string;
  media_type?: string;
  permalink?: string;
  timestamp?: string;
  username?: string;
  has_replies?: boolean;
  is_quote_post?: boolean;
  is_reply?: boolean;
}

export const threadsConnector = {
  id: "threads" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return {
      units: 2,
      description: "One Threads keyword_search Graph call (2,200 queries/user/24h cap)",
    };
  },

  async validateTarget(
    input: ValidateTargetInput,
    ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "threads", input.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "Threads connector is not available.",
      };
    }

    // The "target" for Threads is the tracked entity's match phrase — it
    // arrives as targetHandle/targetUrl (query-target convention, same as
    // gdelt) or in metadata.matchPhrase, and is stored in metadata.matchPhrase.
    const raw =
      input.targetHandle ?? input.targetUrl ?? input.metadata?.matchPhrase;
    if (typeof raw !== "string" || !raw.trim()) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_match_phrase",
        errorMessage: "Enter a match phrase to search Threads posts for.",
      };
    }
    const phrase = normalizeMatchPhrase(raw);
    if (!phrase) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "match_phrase_too_long",
        errorMessage: `Match phrase is too long for Threads keyword search (max ${MAX_MATCH_PHRASE_CHARS} characters).`,
      };
    }

    return {
      ok: true,
      targetKey: phrase.toLowerCase(),
      targetUrl: null,
      targetHandle: phrase,
      coverageLabel: "OFFICIAL_PUBLIC_API",
      metadata: { matchPhrase: phrase },
    };
  },

  async healthCheck(ctx: PresenceConnectorContext): Promise<HealthCheckResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "threads", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "Threads keyword search is not enabled yet.",
        errorCode: gate.reasonCode,
      };
    }

    // Rollout on + token present: probe the Graph API once (`GET /me` is the
    // documented token liveness surface). Healthy only when it answers 2xx —
    // an expired/insufficient token or a Graph outage is honest degraded.
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(
      buildThreadsMeUrl(ctx.env.THREADS_ACCESS_TOKEN as string),
      fetchImpl,
      { method: "GET", maxBytes: THREADS_MAX_BYTES, accept: "application/json,*/*" },
    );

    if (!response || !response.ok) {
      return {
        ok: false,
        status: "degraded",
        summary: response
          ? `Threads Graph API answered the health probe with HTTP ${response.status}.`
          : "Threads Graph API did not answer the health probe.",
        errorCode: "threads_unreachable",
      };
    }

    return {
      ok: true,
      status: "healthy",
      summary: "Threads keyword search credentials configured and Graph API answers.",
    };
  },

  async poll(
    ctx: PresenceConnectorContext,
    target: {
      id: string;
      userId: string;
      targetKey: string;
      targetUrl: string | null;
      targetHandle: string | null;
      metadata: Record<string, unknown>;
    },
  ): Promise<PollResult> {
    const rawPhrase =
      (typeof target.metadata.matchPhrase === "string" && target.metadata.matchPhrase.trim()
        ? target.metadata.matchPhrase
        : null) ??
      target.targetHandle ??
      target.targetKey;
    if (!rawPhrase?.trim()) {
      return {
        ok: false,
        items: [],
        errorCode: "missing_match_phrase",
        errorMessage: "Threads target has no match phrase to search for.",
      };
    }
    const phrase = normalizeMatchPhrase(rawPhrase);
    if (!phrase) {
      return {
        ok: false,
        items: [],
        errorCode: "match_phrase_too_long",
        errorMessage: `Match phrase exceeds the Threads keyword search limit (max ${MAX_MATCH_PHRASE_CHARS} characters).`,
      };
    }

    const gate = await evaluateConnectorAccessGate(ctx.env, "threads", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        items: [],
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "Threads connector is not enabled.",
      };
    }
    const token = ctx.env.THREADS_ACCESS_TOKEN?.trim();
    if (!token) {
      return {
        ok: false,
        items: [],
        errorCode: "credentials_missing",
        errorMessage: "Threads API credentials are not configured.",
      };
    }

    // Enforce the documented 2,200 queries/user/24h cap in connector logic:
    // read every threads target's `threadsUsage` window from
    // presence_poll_cursor.cursor_json and refuse the poll when the open
    // windows already total the cap — never send a query we cannot account.
    const usage = await readThreadsUsage(ctx, target.id);
    if (usage.used >= THREADS_DAILY_QUERY_CAP) {
      return {
        ok: false,
        items: [],
        errorCode: "threads_daily_query_cap",
        errorMessage: `Threads keyword search cap reached (${THREADS_DAILY_QUERY_CAP} queries per user per rolling 24h).`,
        coverageLabel: "OFFICIAL_PUBLIC_API",
      };
    }

    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(buildKeywordSearchUrl(phrase, token), fetchImpl, {
      method: "GET",
      maxBytes: THREADS_MAX_BYTES,
      accept: "application/json,*/*",
    });

    if (!response) {
      // The request was attempted; whether Meta counts a dropped request is
      // undocumented, so we count it — erring toward fewer real queries.
      return {
        ok: false,
        items: [],
        errorCode: "fetch_failed",
        errorMessage: "Could not reach the Threads Graph API.",
        cursor: usage.nextCursor(true),
      };
    }

    if (!response.ok || !response.body) {
      return {
        ok: false,
        items: [],
        errorCode: response.status === 429 ? "rate_limited" : "threads_api_error",
        errorMessage: `Threads Graph API responded with HTTP ${response.status}.`,
        coverageLabel: "OFFICIAL_PUBLIC_API",
        cursor: usage.nextCursor(true),
      };
    }

    let parsed: { data?: ThreadsMedia[] };
    try {
      parsed = JSON.parse(response.body) as { data?: ThreadsMedia[] };
    } catch {
      return {
        ok: false,
        items: [],
        errorCode: "threads_parse_failed",
        errorMessage: "Threads Graph API response was not valid JSON.",
        coverageLabel: "OFFICIAL_PUBLIC_API",
        cursor: usage.nextCursor(true),
      };
    }

    const media = Array.isArray(parsed.data) ? parsed.data : [];
    // Documented cap semantics: a query that returns no results does NOT
    // count against the 2,200/24h limit — record usage only for real queries.
    const counted = media.length > 0;

    const items: NormalizedPresenceItem[] = [];
    for (const post of media) {
      const normalized = await normalizeThreadsMedia(post);
      if (normalized) {
        items.push(normalized);
      }
    }

    return {
      ok: true,
      items,
      coverageLabel: "OFFICIAL_PUBLIC_API",
      costUnits: counted ? 1 : 0,
      // No completeSnapshot: keyword_search is a bounded, ranked window onto
      // public posts — absence from a result page is not a deletion, so the
      // reconcile step must never tombstone on it.
      cursor: usage.nextCursor(counted, { phrase }),
    };
  },
};

function normalizeMatchPhrase(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > MAX_MATCH_PHRASE_CHARS) {
    return null;
  }
  return normalized;
}

export function buildKeywordSearchUrl(phrase: string, accessToken: string): string {
  const url = new URL(`${THREADS_API_BASE}/keyword_search`);
  url.searchParams.set("q", phrase);
  url.searchParams.set("search_type", "RECENT");
  url.searchParams.set("search_mode", "KEYWORD");
  url.searchParams.set("fields", THREADS_SEARCH_FIELDS);
  url.searchParams.set("limit", String(THREADS_SEARCH_LIMIT));
  url.searchParams.set("access_token", accessToken);
  return url.toString();
}

function buildThreadsMeUrl(accessToken: string): string {
  const url = new URL(`${THREADS_API_BASE}/me`);
  url.searchParams.set("fields", "id");
  url.searchParams.set("access_token", accessToken);
  return url.toString();
}

interface ThreadsUsage {
  used: number;
  nextCursor: (counted: boolean, extra?: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Reads every threads target's `threadsUsage` window out of
 * `presence_poll_cursor.cursor_json` and returns the rolling-24h total plus
 * a `nextCursor(counted)` that folds this target's own prior cursor keys
 * forward with the counter incremented (or the window rotated) as required.
 * The env-held token is a single Meta principal, so the sum is taken across
 * ALL threads targets — not just this workspace user's.
 */
async function readThreadsUsage(
  ctx: PresenceConnectorContext,
  targetId: string,
): Promise<ThreadsUsage> {
  const db = ctx.env.DB;
  const now = Date.now();

  if (!db) {
    // No D1 binding means no cursor persistence either — nothing can be
    // tracked, so there is no prior usage to enforce against.
    return { used: 0, nextCursor: (_counted, extra = {}) => ({ ...extra }) };
  }

  const rows = await db
    .prepare(
      `SELECT st.id AS target_id, pc.cursor_json AS cursor_json
       FROM source_target st
       JOIN presence_poll_cursor pc ON pc.source_target_id = st.id
       WHERE st.connector_id = 'threads' AND st.deleted_at IS NULL`,
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
      const threadsUsage: ThreadsUsageWindow = counted
        ? ownWindow
          ? { windowStart: ownWindow.windowStart, count: ownWindow.count + 1 }
          : { windowStart: new Date(now).toISOString(), count: 1 }
        : (ownWindow ?? { windowStart: new Date(now).toISOString(), count: 0 });
      return { ...ownCursor, ...extra, threadsUsage };
    },
  };
}

function readUsageWindow(cursor: Record<string, unknown>, now: number): ThreadsUsageWindow | null {
  const raw = cursor.threadsUsage;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const { windowStart, count } = raw as Partial<ThreadsUsageWindow>;
  if (typeof windowStart !== "string" || typeof count !== "number") {
    return null;
  }
  const started = new Date(windowStart).getTime();
  if (Number.isNaN(started) || now - started >= THREADS_USAGE_WINDOW_MS) {
    return null; // window closed — its queries no longer count
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

async function normalizeThreadsMedia(post: ThreadsMedia): Promise<NormalizedPresenceItem | null> {
  const permalink =
    typeof post.permalink === "string" && post.permalink.startsWith("http") ? post.permalink : null;
  // A result without the public threads.net permalink is skipped — the
  // canonicalUrl is never fabricated from the request URL.
  if (!permalink) {
    return null;
  }

  const observedAt = new Date().toISOString();
  const text = typeof post.text === "string" ? post.text.trim() : "";
  const title = text.split("\n")[0]?.slice(0, MAX_THREADS_TITLE_CHARS).trim() || "Threads post";
  const publishedAt = post.timestamp ? safeIsoDate(post.timestamp) : null;

  const item: NormalizedPresenceItem = {
    externalId: typeof post.id === "string" && post.id ? post.id : null,
    canonicalUrl: permalink,
    title,
    bodyExcerpt: text ? text.slice(0, MAX_THREADS_EXCERPT_CHARS) : null,
    author: typeof post.username === "string" && post.username ? `@${post.username}` : null,
    publishedAt: publishedAt ?? observedAt,
    observedAt,
    contentHash: "",
    raw: {
      kind: "threads_post",
      mediaType: post.media_type ?? null,
      hasReplies: post.has_replies ?? null,
      isQuotePost: post.is_quote_post ?? null,
      isReply: post.is_reply ?? null,
    },
  };
  item.contentHash = await presenceContentHash({
    title: item.title,
    bodyExcerpt: item.bodyExcerpt,
    author: item.author,
    publishedAt: item.publishedAt,
  });
  return item;
}

function safeIsoDate(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

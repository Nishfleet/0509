import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
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

/**
 * YouTube presence connector (issue #3203 — fast-follow mention source,
 * free, one documented surface, no purchase, activation-gated).
 *
 * Turns a tracked entity's match phrase into a YouTube Data API v3
 * `search.list` call
 * (`GET https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=<phrase>&order=date&key=<key>`)
 * and emits normalized `presence_item` rows whose `canonicalUrl` is the
 * public youtube.com watch URL constructed from the API's own `id.videoId`
 * — the address the mention is actually read at, never a fabricated or
 * API-hostname URL.
 *
 * Public surface (official docs, read 2026-09-13):
 * - Quota: "Projects that enable the YouTube Data API have a default quota
 *   allocation of 100 search.list calls, 100 videos.insert calls, and 10,000
 *   units per day combined for all other endpoints."
 *   (developers.google.com/youtube/v3/determine_quota_cost — the same
 *   allocation statement appears on the getting-started page.) There is no
 *   documented reset-time guarantee on those pages, so the connector uses a
 *   rolling-24h usage window (below): it can only OVERCOUNT a daily bucket,
 *   so it can only under-use the documented 100-call allocation.
 * - `publishedAfter`: "The publishedAfter parameter indicates that the API
 *   response should only contain resources created at or after the specified
 *   time. The value is an RFC 3339 formatted date-time value."
 *   (developers.google.com/youtube/v3/docs/search/list)
 * - `maxResults`: "Acceptable values are 0 to 50, inclusive" — and the API
 *   "may return fewer items than the requested maxResults per page due to
 *   internal sorting or filtering, even if additional results are available.
 *   Always rely on the nextPageToken..." (same page).
 * - `order=date`: resources sorted reverse-chronologically by creation date
 *   (same page).
 *
 * Rate budget — the documented 100 search.list calls/day is a COUNT of
 * calls, shared by every tracked brand (one Google project = one key = one
 * principal), so the connector treats it as a duty to be frugal rather than
 * a guarantee:
 *
 * - ONE serialized request per poll. No parallel fan-out, no `pageToken`
 *   walking — a single `await`ed `presenceSafeFetch` of the FIRST page is
 *   the whole network portion of a poll.
 * - No deep paging. The connector always reads ONE page of
 *   `maxResults=50` (the documented inclusive maximum) in `order=date`
 *   (newest first) and relies on the DOCUMENTED `publishedAfter` filter for
 *   the rest: the returned cursor folds the newest `snippet.publishedAt` it
 *   saw; the NEXT poll passes `publishedAfter=W` so the window slides
 *   forward and the unbounded result set is never walked. The documented
 *   semantics are inclusive ("at or after"), so the boundary item can be
 *   re-read by the next poll — the mention table's unique
 *   (source_target_id, url_hash) absorbs that; it must never multiply rows
 *   (pinned by the integration test).
 * - Counting: the documented allocation counts CALLS. Every SENT
 *   search.list call counts against the window — including an
 *   empty-result one (there is no documented Threads-style
 *   empty-results-are-free exemption here) and including a failed one (the
 *   request was attempted; whether Google counted it is undocumented, so we
 *   count it — erring toward fewer real calls).
 * - The usage window rides `presence_poll_cursor.cursor_json` as
 *   `youtubeUsage` and is summed across EVERY youtube target (the shared
 *   Google project is one principal — another workspace's searches count),
 *   exactly the Threads convention (#3205). A closed window (>24h) does not
 *   count. The healthCheck probe deliberately does NOT use search.list: it
 *   is a one-row `videos.list` read, drawn from the documented
 *   10,000-units/day combined bucket ("all other endpoints"), not from the
 *   dedicated 100-call search bucket.
 *
 * Every network hop goes through `presenceSafeFetch` (SSRF hardening +
 * redirects re-validated). A raw `fetch` to the googleapis endpoint is a
 * regression.
 *
 * The connector ships dark behind `PRESENCE_YOUTUBE_ROLLOUT` +
 * `YOUTUBE_API_KEY` (off by default); activation needs the flag, the key,
 * and the 0101 CHECK widen for `source_target.connector_id = 'youtube'` —
 * not a code change here.
 */
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_MAX_BYTES = 750_000;
const MAX_MATCH_PHRASE_CHARS = 256;
const MAX_YOUTUBE_EXCERPT_CHARS = 280;
const MAX_YOUTUBE_TITLE_CHARS = 120;
/**
 * Documented default allocation: 100 search.list calls per day. A COUNT of
 * calls — every search.list request the connector sends spends one, whether
 * or not it returned results.
 */
export const YOUTUBE_DAILY_SEARCH_CAP = 100;
/**
 * Largest single page the connector ever reads (the documented inclusive
 * maximum). The connector never sends `pageToken`, so it never walks the
 * result set: one page, then `publishedAfter` time-window slicing on the
 * next poll.
 */
export const YOUTUBE_MAX_RESULTS = 50;
const YOUTUBE_USAGE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Watch-URL host family — the only hostname a YouTube mention's canonicalUrl may carry. */
const YOUTUBE_WATCH_HOST = "www.youtube.com";

interface YouTubeUsageWindow {
  windowStart: string;
  count: number;
}

interface YouTubeSearchResponse {
  items?: YouTubeSearchResult[];
}

/**
 * Builds the documented search.list request for a phrase:
 * `part=snippet`, `type=video`, `order=date` (newest first),
 * `maxResults=50` (the documented inclusive maximum — one page, never
 * paged), `key=<the Google API key>`. `publishedAfterIso` — when the prior
 * poll recorded one — becomes the documented time-window filter: the
 * RFC 3339 instant, VERBATIM (no clock math): the documented semantics are
 * inclusive ("at or after"), so the boundary item may be re-read and the
 * mention table's url_hash dedup absorbs it.
 */
export function buildSearchListUrl(
  phrase: string,
  apiKey: string,
  publishedAfterIso?: string | null,
): string {
  const url = new URL(`${YOUTUBE_API_BASE}/search`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("q", phrase);
  // Newest first, so the returned watermark is the window's newest mention.
  url.searchParams.set("order", "date");
  // One page, never paged: the documented 0..50 inclusive maximum, and the
  // documented nextPageToken note is honored by NOT walking it — the next
  // poll's publishedAfter covers the remainder.
  url.searchParams.set("maxResults", String(YOUTUBE_MAX_RESULTS));
  url.searchParams.set("key", apiKey);
  if (isFiniteWatermark(publishedAfterIso)) {
    // Time-window slicing — the documented inclusive publishedAfter filter.
    // No pageToken is ever sent.
    url.searchParams.set("publishedAfter", publishedAfterIso);
  }
  return url.toString();
}

/**
 * The documented cheapest-honest-liveness probe: a one-row, id-only
 * `videos.list` read (`chart=mostPopular`). It answers "is the Google API
 * key configured and the endpoint answering" WITHOUT spending one of the
 * dedicated 100 search.list calls/day — videos.list draws from the
 * documented 10,000-units/day combined bucket for other endpoints.
 */
export function buildVideosListUrl(apiKey: string): string {
  const url = new URL(`${YOUTUBE_API_BASE}/videos`);
  url.searchParams.set("part", "id");
  // Documented charts value: mostPopular — the most popular videos for a
  // content region; one row is the cheapest honest liveness question.
  url.searchParams.set("chart", "mostPopular");
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("key", apiKey);
  return url.toString();
}

export const youtubeConnector = {
  id: "youtube" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return {
      units: 1,
      description: "One YouTube Data API search.list call (dedicated 100 calls/day default bucket)",
    };
  },

  async validateTarget(
    input: ValidateTargetInput,
    ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "youtube", input.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "YouTube connector is not available.",
      };
    }

    // The "target" for YouTube keyword mentions is the tracked entity's
    // match phrase — it arrives as targetHandle/targetUrl (query-target
    // convention, same as gdelt/threads/hn) or in metadata.matchPhrase, and
    // is stored in metadata.matchPhrase.
    const raw = input.targetHandle ?? input.targetUrl ?? input.metadata?.matchPhrase;
    if (typeof raw !== "string" || !raw.trim()) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_match_phrase",
        errorMessage: "Enter a match phrase to search YouTube for.",
      };
    }
    const phrase = normalizeMatchPhrase(raw);
    if (!phrase) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "match_phrase_too_long",
        errorMessage: `Match phrase is too long for the YouTube search (max ${MAX_MATCH_PHRASE_CHARS} characters).`,
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
    const gate = await evaluateConnectorAccessGate(ctx.env, "youtube", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "YouTube tracking is not enabled yet.",
        errorCode: gate.reasonCode,
      };
    }

    // The rollout is on and the gate checked the key: probe the public
    // endpoint once — a one-row videos.list read is the cheapest honest
    // liveness question, and it draws from the documented 10,000-units/day
    // combined bucket, NOT from the dedicated 100-call search bucket. Healthy
    // only when the endpoint answers.
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(
      buildVideosListUrl(ctx.env.YOUTUBE_API_KEY as string),
      fetchImpl,
      { method: "GET", maxBytes: YOUTUBE_MAX_BYTES, accept: "application/json" },
    );

    if (!response || !response.ok) {
      return {
        ok: false,
        status: "degraded",
        summary: response
          ? `The YouTube Data API answered the health probe with HTTP ${response.status}.`
          : "The YouTube Data API did not answer the health probe.",
        errorCode: "youtube_unreachable",
      };
    }

    return {
      ok: true,
      status: "healthy",
      summary: "YouTube Data API key configured and the public videos.list read answers.",
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
    // Prior presence_poll_cursor.cursor_json, as the poll orchestrator passes
    // it (same wrapper the hn/x/website/rss connectors receive). Its
    // lastItemPublishedAt is the publishedAfter watermark; its youtubeUsage
    // window is this target's counted-call window.
    priorCursor?: { record?: Record<string, unknown> } | null,
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
        errorMessage: "YouTube target has no match phrase to search for.",
      };
    }
    const phrase = normalizeMatchPhrase(rawPhrase);
    if (!phrase) {
      return {
        ok: false,
        items: [],
        errorCode: "match_phrase_too_long",
        errorMessage: `Match phrase exceeds the YouTube search limit (max ${MAX_MATCH_PHRASE_CHARS} characters).`,
      };
    }

    const gate = await evaluateConnectorAccessGate(ctx.env, "youtube", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        items: [],
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "YouTube connector is not enabled.",
      };
    }
    const apiKey = ctx.env.YOUTUBE_API_KEY?.trim();
    if (!apiKey) {
      return {
        ok: false,
        items: [],
        errorCode: "credentials_missing",
        errorMessage: "YouTube API credentials are not configured.",
      };
    }

    // Enforce the documented 100 search.list calls/day allocation in connector
    // logic: read every youtube target's `youtubeUsage` window from
    // presence_poll_cursor.cursor_json and refuse the poll when the open
    // windows already total the cap — never send a call we cannot account.
    const usage = await readYouTubeUsage(ctx, target.id);
    if (usage.used >= YOUTUBE_DAILY_SEARCH_CAP) {
      return {
        ok: false,
        items: [],
        errorCode: "youtube_daily_search_cap",
        errorMessage: `YouTube search cap reached (${YOUTUBE_DAILY_SEARCH_CAP} search.list calls per day).`,
        coverageLabel: "OFFICIAL_PUBLIC_API",
      };
    }

    // Time-window slicing (the documented replacement for deep paging): the
    // prior poll's newest snippet.publishedAt, stored by the poll orchestrator
    // in presence_poll_cursor.cursor_json, becomes the inclusive
    // publishedAfter bound. A failed poll returns no watermark, so the
    // service keeps the prior window and the next poll retries it — a failure
    // never silently skips mentions.
    const priorRecord = priorCursor?.record ?? {};
    const priorWatermark = readWatermark(priorRecord);

    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(
      buildSearchListUrl(phrase, apiKey, priorWatermark),
      fetchImpl,
      { method: "GET", maxBytes: YOUTUBE_MAX_BYTES, accept: "application/json" },
    );

    // A dropped request still counted against the window (see readYouTubeUsage
    // comment): whether Google counted it is undocumented, so we count it —
    // erring toward fewer real calls.
    if (!response) {
      return {
        ok: false,
        items: [],
        errorCode: "fetch_failed",
        errorMessage: "Could not reach the YouTube Data API.",
        cursor: usage.nextCursor(priorRecord),
      };
    }

    if (!response.ok || !response.body) {
      return {
        ok: false,
        items: [],
        errorCode: response.status === 429 ? "rate_limited" : "youtube_api_error",
        errorMessage: `The YouTube Data API responded with HTTP ${response.status}.`,
        coverageLabel: "OFFICIAL_PUBLIC_API",
        cursor: usage.nextCursor(priorRecord),
      };
    }

    let parsed: YouTubeSearchResponse;
    try {
      parsed = JSON.parse(response.body) as YouTubeSearchResponse;
    } catch {
      return {
        ok: false,
        items: [],
        errorCode: "youtube_parse_failed",
        errorMessage: "The YouTube Data API response was not valid JSON.",
        coverageLabel: "OFFICIAL_PUBLIC_API",
        cursor: usage.nextCursor(priorRecord),
      };
    }

    const searchResults = Array.isArray(parsed.items) ? parsed.items : [];

    const items: NormalizedPresenceItem[] = [];
    // The watermark advances past EVERY result this page returned — skipped
    // (unusable) results included — so the next poll's window never re-reads
    // what this response already answered for.
    let watermarkIso: string | null = priorWatermark;
    let watermarkMs = watermarkIso ? (new Date(watermarkIso).getTime() || 0) : 0;
    for (const result of searchResults) {
      const publishedAtRaw =
        typeof result.snippet?.publishedAt === "string" ? result.snippet.publishedAt : null;
      if (publishedAtRaw) {
        const publishedMs = new Date(publishedAtRaw).getTime();
        if (Number.isFinite(publishedMs) && publishedMs > watermarkMs) {
          watermarkMs = publishedMs;
          // Carried VERBATIM — no clock math; the documented publishedAfter is
          // inclusive, so the boundary result may legitimately be re-read once
          // and absorbed by the mention table's url_hash uniqueness.
          watermarkIso = publishedAtRaw;
        }
      }
      const normalized = await normalizeYouTubeSearchResult(result);
      if (normalized) {
        items.push(normalized);
      }
    }

    return {
      ok: true,
      items,
      coverageLabel: "OFFICIAL_PUBLIC_API",
      // The documented allocation counts CALLS: an empty-result search is
      // still a call (no Threads-style documented exemption exists), so every
      // sent request costs 1 against the 100/day window.
      costUnits: 1,
      // No completeSnapshot: search.list is a bounded, date-ordered window
      // onto YouTube's index — absence from a result page is not a deletion,
      // so the reconcile step must never tombstone on it.
      cursor: usage.nextCursor(priorRecord, watermarkIso),
    };
  },
};

function isFiniteWatermark(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed);
}

function readWatermark(record: Record<string, unknown>): string | null {
  const raw = record.lastItemPublishedAt;
  return isFiniteWatermark(raw) ? raw : null;
}

interface YouTubeUsage {
  used: number;
  nextCursor: (
    priorRecord: Record<string, unknown>,
    watermarkIso?: string | null,
  ) => Record<string, unknown>;
}

/**
 * Reads every youtube target's `youtubeUsage` window out of
 * `presence_poll_cursor.cursor_json` and returns the rolling-24h total plus a
 * `nextCursor(...)` that folds this target's prior cursor keys forward with
 * the counter incremented (or the window rotated) as required. The
 * env-held Google API key is a single project principal, so the sum is taken
 * across ALL youtube targets — not just this workspace user's.
 */
async function readYouTubeUsage(
  ctx: PresenceConnectorContext,
  targetId: string,
): Promise<YouTubeUsage> {
  const db = ctx.env.DB;
  const now = Date.now();

  if (!db) {
    // No D1 binding means no cursor persistence either — nothing can be
    // tracked, so there is no prior usage to enforce against.
    return {
      used: 0,
      nextCursor: (priorRecord, watermarkIso) => nextUsageCursor({}, priorRecord, watermarkIso, now),
    };
  }

  const rows = await db
    .prepare(
      `SELECT st.id AS target_id, pc.cursor_json AS cursor_json
       FROM source_target st
       JOIN presence_poll_cursor pc ON pc.source_target_id = st.id
       WHERE st.connector_id = 'youtube' AND st.deleted_at IS NULL`,
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
    nextCursor: (priorRecord, watermarkIso) =>
      nextUsageCursor(ownCursor, priorRecord, watermarkIso, now, ownWindow, true),
  };
}

/**
 * Folds the next cursor: the prior record's keys (including any
 * lastItemPublishedAt) carried forward, this poll's watermark (only when the
 * page actually surfaced one), and this target's youtubeUsage window —
 * counted (every sent call counts, whether or not it returned results) or
 * merely opened. The usage SUM is recomputed fresh on the next poll by
 * readYouTubeUsage, which reads every target's window.
 */
function nextUsageCursor(
  ownCursor: Record<string, unknown>,
  priorRecord: Record<string, unknown>,
  watermarkIso: string | null | undefined,
  now: number,
  ownWindow?: YouTubeUsageWindow | null,
  counted = true,
): Record<string, unknown> {
  const youtubeUsage: YouTubeUsageWindow = counted
    ? ownWindow
      ? { windowStart: ownWindow.windowStart, count: ownWindow.count + 1 }
      : { windowStart: new Date(now).toISOString(), count: 1 }
    : (ownWindow ?? { windowStart: new Date(now).toISOString(), count: 0 });
  const watermarkKeys = watermarkIso ? { lastItemPublishedAt: watermarkIso } : {};
  return { ...ownCursor, ...priorRecord, ...watermarkKeys, youtubeUsage };
}

function readUsageWindow(cursor: Record<string, unknown>, now: number): YouTubeUsageWindow | null {
  const raw = cursor.youtubeUsage;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const { windowStart, count } = raw as Partial<YouTubeUsageWindow>;
  if (typeof windowStart !== "string" || typeof count !== "number") {
    return null;
  }
  const started = new Date(windowStart).getTime();
  if (Number.isNaN(started) || now - started >= YOUTUBE_USAGE_WINDOW_MS) {
    return null; // window closed — its calls no longer count
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

async function normalizeYouTubeSearchResult(
  result: YouTubeSearchResult,
): Promise<NormalizedPresenceItem | null> {
  // Only a URL-safe videoId may become the public watch URL — the
  // canonicalUrl is constructed from the API's own primary key, never
  // fabricated from the request URL. Results without an id.videoId (e.g. a
  // channel/playlist search result) are skipped, never fabricated.
  const videoId = result.id?.videoId;
  if (typeof videoId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(videoId)) {
    return null;
  }
  // The canonicalUrl is ALWAYS the public youtube.com watch page — never an
  // googleapis.com API hostname. Only a normalizable http(s) URL on the
  // youtube.com host family qualifies (house convention).
  const watchUrl = normalizePublicHttpUrl(`https://${YOUTUBE_WATCH_HOST}/watch?v=${videoId}`);
  if (
    !watchUrl ||
    !(watchUrl.hostname === YOUTUBE_WATCH_HOST ||
      watchUrl.hostname === "youtube.com" ||
      watchUrl.hostname.endsWith(".youtube.com"))
  ) {
    return null;
  }

  const observedAt = new Date().toISOString();
  const title =
    typeof result.snippet?.title === "string" && result.snippet.title.trim()
      ? result.snippet.title.trim().slice(0, MAX_YOUTUBE_TITLE_CHARS)
      : "YouTube video";
  // The documented RFC 3339 publishedAt, carried VERBATIM — the #3198
  // x-connector precedent (post.createdAt, no normalization) and this
  // connector's own no-clock-math contract: the mention-table value is the
  // source's own instant, and the inclusive-publishedAfter watermark (which
  // already carries the raw string) reads the same value. Only validity is
  // guarded, so a missing or unparseable publishedAt still falls back to
  // observedAt instead of fabricating a 1970-01-01 epoch.
  const publishedAtRaw = typeof result.snippet?.publishedAt === "string"
    ? result.snippet.publishedAt
    : null;
  const publishedAt = publishedAtRaw && Number.isFinite(new Date(publishedAtRaw).getTime())
    ? publishedAtRaw
    : null;
  const description =
    typeof result.snippet?.description === "string" ? result.snippet.description.trim() : "";
  const author =
    typeof result.snippet?.channelTitle === "string" && result.snippet.channelTitle.trim()
      ? result.snippet.channelTitle.trim()
      : null;

  const item: NormalizedPresenceItem = {
    externalId: videoId,
    // The public youtube.com watch URL — never a googleapis.com hostname.
    canonicalUrl: watchUrl.toString(),
    title,
    bodyExcerpt: description ? description.replace(/\s+/g, " ").slice(0, MAX_YOUTUBE_EXCERPT_CHARS) : null,
    // The channel DISPLAY name, plainly — never an invented @handle.
    author,
    publishedAt: publishedAt ?? observedAt,
    observedAt,
    contentHash: "",
    raw: {
      kind: "youtube_video",
      channelId: typeof result.snippet?.channelId === "string" ? result.snippet.channelId : null,
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

interface YouTubeSearchResult {
  id?: { videoId?: string | null; kind?: string | null } | null;
  snippet?: {
    publishedAt?: string | null;
    channelId?: string | null;
    title?: string | null;
    description?: string | null;
    channelTitle?: string | null;
  } | null;
}
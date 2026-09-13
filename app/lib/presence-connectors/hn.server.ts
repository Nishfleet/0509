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
 * Hacker News presence connector (issue #3253 — fast-follow mention source,
 * post-MVP, free, no key, no auth).
 *
 * Turns a tracked entity's match phrase into an Algolia HN search
 * (`GET https://hn.algolia.com/api/v1/search_by_date?query=<phrase>&tags=(story,comment)`)
 * and emits normalized `presence_item` rows whose `canonicalUrl` is the
 * public news.ycombinator.com item URL (the HN discussion page — the link an
 * HN mention is actually read at, not the story's external URL, which rides
 * in raw_json for ranking context).
 *
 * API: https://hn.algolia.com/api — the HN Search API maintained by Algolia.
 * Terms: free, no key, no auth. The commonly cited ~10,000 requests/hour/IP
 * is a community-observed courtesy budget, NOT a documented SLA, so the
 * connector treats it as a duty to be frugal rather than a guarantee:
 *
 * - ONE serialized request per poll. No parallel page fan-out, ever — the
 *   single `await`ed `presenceSafeFetch` call is the whole network portion
 *   of a poll.
 * - No deep paging. Algolia returns at most 1,000 results for a query
 *   (default 20 pages x 50 hits; past that, results are unreachable through
 *   pagination), so the connector never walks pages: it always reads the
 *   first page of the date-ordered (search_by_date) results, bounded by
 *   `hitsPerPage = 50`, and relies on the DOCUMENTED pattern for the rest —
 *   time-window slicing. The returned cursor folds the newest
 *   `created_at_i` it saw; the NEXT poll passes
 *   `numericFilters=created_at_i>W` so the window slides forward and the
 *   1,000-result ceiling is never approached.
 * - Cadence stays with the poll orchestrator (`runPresencePollingBatch`
 *   serializes polls upstream); one low-cadence request per target per
 *   cadence keeps the fleet's share of the courtesy budget negligible.
 *
 * Every network hop goes through `presenceSafeFetch` (SSRF hardening +
 * redirects re-validated). A raw `fetch` to the Algolia endpoint is a
 * regression.
 *
 * Story vs comment: ONE target, one query, `tags=(story,comment)` — a tracked
 * entity's HN presence is both its mentions inside stories AND the
 * discussions (comments) it earns. The two hit shapes differ only in which
 * Algolia fields they populate; both normalize to the same `presence_item`
 * row, with `itemType`, `points` and `commentCount` in raw_json for ranking
 * (issue UNKNOWN: one target vs two — pinned by the integration test as ONE
 * target whose hits carry both kinds).
 *
 * Research (issue #3207 — required: research existing open-source collectors
 * first, cite searched + rejected): surveyed 2026-09-13 via
 * `gh search repos "hacker news mentions"` — Bemmu/hnfirstmention (pushed
 * 2018-02), ltranco/TheHackerNewsBump (pushed 2014-08),
 * mihailgaberov/hacker-news-scraper (pushed 2021-02), all 0-star dormant
 * one-shot scrapers with no dedup substrate — and via npm ("hacker news" +
 * mentions: only generic mention/parse libraries, no live HN-mention
 * collector). All rejected: adopting a dormant 2014–2021 scraper adds a
 * dependency without removing anything, while the in-repo #3178 connector
 * interface already provides the capture substrate. The rejected OFFICIAL
 * alternative remains the Firebase HN API (no search endpoint —
 * docs/mentions/PLAN.md, source inventory).
 *
 * The connector ships dark behind `PRESENCE_HN_ROLLOUT` (off by default);
 * activation needs the flag and the 0100 CHECK widen for
 * `source_target.connector_id = 'hn'` — not a code change here.
 */
const HN_API_BASE = "https://hn.algolia.com/api/v1";
const HN_MAX_BYTES = 750_000;
const MAX_MATCH_PHRASE_CHARS = 256;
const MAX_HN_EXCERPT_CHARS = 280;
const MAX_HN_TITLE_CHARS = 120;
/**
 * Largest single page the connector ever reads (Algolia's own default page
 * size). The connector never asks for a second page, so the documented
 * ~1,000-result (20 x 50) ceiling is respected by construction: one page,
 * then time-window slicing on the next poll.
 */
export const HN_MAX_HITS_PER_PAGE = 50;
/** `news.ycombinator.com` — the public HN item page, the mention's real address. */
const HN_ITEM_URL_HOST = "news.ycombinator.com";
/** Stable probe phrase for healthCheck — guaranteed hits on the public index. */
const PRESENCE_HN_PROBE_PHRASE = "hacker news";

interface HnSearchHit {
  objectID?: string | number;
  created_at?: string | null;
  created_at_i?: number | null;
  title?: string | null;
  story_title?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  url?: string | null;
  author?: string | null;
  points?: number | null;
  num_comments?: number | null;
  story_id?: number | null;
}

interface HnSearchResponse {
  hits?: HnSearchHit[];
  nbHits?: number;
  page?: number;
  nbPages?: number;
}

/**
 * Builds the documented Algolia HN search_by_date request for a phrase.
 * `watermarkSeconds` (epoch seconds) — when the prior poll recorded one —
 * becomes `numericFilters=created_at_i>W`: the documented time-window
 * slicing pattern that replaces deep paging past Algolia's ~1,000-result
 * ceiling. No `page` param: the connector always reads page 0 of the window.
 * `hitsPerPage` (default HN_MAX_HITS_PER_PAGE) — the healthCheck probe passes
 * 1: a one-hit search is the cheapest honest liveness question.
 */
export function buildSearchByDateUrl(
  phrase: string,
  watermarkSeconds?: number | null,
  hitsPerPage: number = HN_MAX_HITS_PER_PAGE,
): string {
  const url = new URL(`${HN_API_BASE}/search_by_date`);
  url.searchParams.set("query", phrase);
  // Tags: Algolia ANDs bare tags, so BOTH item kinds need the parenthesized
  // OR form — a bare `tags=story,comment` means story AND comment, and no
  // item is both, so every poll would honestly return zero rows. One target
  // tracks both HN item kinds (issue #3253; the item's own itemType in
  // raw_json tells them apart).
  url.searchParams.set("tags", "(story,comment)");
  url.searchParams.set("hitsPerPage", String(hitsPerPage));
  if (isFiniteWatermark(watermarkSeconds)) {
    // Time-window slicing — the documented replacement for deep paging past
    // Algolia's ~1,000-result ceiling. No `page` param is ever sent.
    url.searchParams.set("numericFilters", `created_at_i>${Math.floor(watermarkSeconds)}`);
  }
  return url.toString();
}

export const hnConnector = {
  id: "hn" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return {
      units: 1,
      description: "One serialized Algolia HN search_by_date request (free, no key)",
    };
  },

  async validateTarget(
    input: ValidateTargetInput,
    ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "hn", input.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "Hacker News connector is not available.",
      };
    }

    // The "target" for HN is the tracked entity's match phrase — it arrives
    // as targetHandle/targetUrl (query-target convention, same as gdelt and
    // threads) or in metadata.matchPhrase, and is stored in
    // metadata.matchPhrase.
    const raw = input.targetHandle ?? input.targetUrl ?? input.metadata?.matchPhrase;
    if (typeof raw !== "string" || !raw.trim()) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_match_phrase",
        errorMessage: "Enter a match phrase to search Hacker News for.",
      };
    }
    const phrase = normalizeMatchPhrase(raw);
    if (!phrase) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "match_phrase_too_long",
        errorMessage: `Match phrase is too long for the HN search (max ${MAX_MATCH_PHRASE_CHARS} characters).`,
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
    const gate = await evaluateConnectorAccessGate(ctx.env, "hn", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "Hacker News tracking is not enabled yet.",
        errorCode: gate.reasonCode,
      };
    }

    // The rollout is on: probe the public endpoint once — a one-hit search
    // is the cheapest honest liveness question (and a single courtesy-budget
    // request). Healthy only when the endpoint answers.
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(
      buildSearchByDateUrl(PRESENCE_HN_PROBE_PHRASE, null, 1),
      fetchImpl,
      { method: "GET", maxBytes: HN_MAX_BYTES, accept: "application/json" },
    );

    if (!response || !response.ok) {
      return {
        ok: false,
        status: "degraded",
        summary: response
          ? `The Algolia HN Search API answered the health probe with HTTP ${response.status}.`
          : "The Algolia HN Search API did not answer the health probe.",
        errorCode: "hn_unreachable",
      };
    }

    return {
      ok: true,
      status: "healthy",
      summary: "Algolia HN search polling is available — no key, no credentials required.",
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
    // it (same wrapper the x/website/rss connectors receive). Its
    // lastItemCreatedAtI is the time-window watermark.
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
        errorMessage: "Hacker News target has no match phrase to search for.",
      };
    }
    const phrase = normalizeMatchPhrase(rawPhrase);
    if (!phrase) {
      return {
        ok: false,
        items: [],
        errorCode: "match_phrase_too_long",
        errorMessage: `Match phrase exceeds the HN search limit (max ${MAX_MATCH_PHRASE_CHARS} characters).`,
      };
    }

    const gate = await evaluateConnectorAccessGate(ctx.env, "hn", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        items: [],
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "Hacker News connector is not enabled.",
      };
    }

    // Time-window slicing (the documented pattern that replaces deep paging
    // past Algolia's ~1,000-result ceiling): the prior poll's newest
    // created_at_i, stored by the poll orchestrator in
    // presence_poll_cursor.cursor_json, becomes numericFilters=created_at_i>W.
    // A failed poll returns no cursor, so the service keeps the prior window
    // and the next poll retries it — a failure never silently skips mentions.
    const priorRecord = priorCursor?.record ?? {};
    const priorWatermark = readWatermark(priorRecord);

    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(buildSearchByDateUrl(phrase, priorWatermark), fetchImpl, {
      method: "GET",
      maxBytes: HN_MAX_BYTES,
      accept: "application/json",
    });

    if (!response) {
      return {
        ok: false,
        items: [],
        errorCode: "fetch_failed",
        errorMessage: "Could not reach the Algolia HN Search API.",
      };
    }

    if (!response.ok || !response.body) {
      return {
        ok: false,
        items: [],
        errorCode: response.status === 429 ? "rate_limited" : "hn_api_error",
        errorMessage: `The Algolia HN Search API responded with HTTP ${response.status}.`,
        coverageLabel: "OFFICIAL_PUBLIC_API",
      };
    }

    let parsed: HnSearchResponse;
    try {
      parsed = JSON.parse(response.body) as HnSearchResponse;
    } catch {
      return {
        ok: false,
        items: [],
        errorCode: "hn_parse_failed",
        errorMessage: "The Algolia HN Search response was not valid JSON.",
        coverageLabel: "OFFICIAL_PUBLIC_API",
      };
    }

    const hits = Array.isArray(parsed.hits) ? parsed.hits : [];

    const items: NormalizedPresenceItem[] = [];
    let watermark = priorWatermark ?? 0;
    for (const hit of hits) {
      // The watermark advances past EVERY hit this page returned — skipped
      // (unusable) hits included — so the next poll's window never re-reads
      // what this response already answered for.
      const hitTime = readHitTime(hit);
      if (hitTime > watermark) {
        watermark = hitTime;
      }
      const normalized = await normalizeHnHit(hit);
      if (normalized) {
        items.push(normalized);
      }
    }

    return {
      ok: true,
      items,
      coverageLabel: "OFFICIAL_PUBLIC_API",
      // One courtesy request per poll — no documented empty-result exemption
      // exists on the shared courtesy budget, so the poll costs 1 either way.
      costUnits: 1,
      // No completeSnapshot: search_by_date is a bounded, date-ordered window
      // onto the HN index — absence from a result page is not a deletion, so
      // the reconcile step must never tombstone on it.
      cursor: {
        ...priorRecord,
        // 0 means "no watermark yet" — the next poll reads the newest page
        // without a numericFilters bound, exactly the first-poll semantics.
        lastItemCreatedAtI: watermark,
      },
    };
  },
};

function isFiniteWatermark(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function readWatermark(record: Record<string, unknown>): number | null {
  const raw = record.lastItemCreatedAtI;
  return isFiniteWatermark(raw) ? Math.floor(raw) : null;
}

function readHitTime(hit: HnSearchHit): number {
  return typeof hit.created_at_i === "number" && Number.isFinite(hit.created_at_i)
    ? hit.created_at_i
    : 0;
}

interface HnHitShape {
  itemType: "story" | "comment";
  points: number;
  commentCount: number;
  storyId: number | null;
  externalUrl: string | null;
}

/**
 * Reads the ranking/shape fields off a hit once, defensively: the public
 * search responses put `points`/`num_comments` on story hits and commonly
 * leave them null or absent on comment hits — absence ranks as 0, never as
 * an error. `itemType` distinguishes the two hit kinds: comment hits carry a
 * `comment_text` (and reference their story), story hits carry a `title`.
 */
function readHitShape(hit: HnSearchHit): HnHitShape {
  const isComment = hit.comment_text != null || hit.story_id != null;
  return {
    itemType: isComment ? "comment" : "story",
    points: typeof hit.points === "number" && Number.isFinite(hit.points) ? hit.points : 0,
    commentCount:
      typeof hit.num_comments === "number" && Number.isFinite(hit.num_comments) ? hit.num_comments : 0,
    storyId: typeof hit.story_id === "number" && Number.isFinite(hit.story_id) ? hit.story_id : null,
    externalUrl: typeof hit.url === "string" && hit.url.startsWith("http") ? hit.url : null,
  };
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

async function normalizeHnHit(hit: HnSearchHit): Promise<NormalizedPresenceItem | null> {
  // Only a digits-only objectID may become the public HN item URL — the
  // canonicalUrl is constructed from the API's own primary key, never
  // fabricated from the request URL.
  const objectId = hit.objectID != null ? String(hit.objectID) : "";
  if (!/^[0-9]+$/.test(objectId)) {
    return null;
  }
  // The canonicalUrl is ALWAYS the public news.ycombinator.com item page —
  // for comments the discussion they live in, for stories the HN listing of
  // the story (the issue acceptance pins this; the story's EXTERNAL url
  // rides in raw_json for ranking context). Only a normalizable http(s) URL
  // on the news.ycombinator.com host qualifies (house convention).
  const itemUrl = normalizePublicHttpUrl(`https://news.ycombinator.com/item?id=${objectId}`);
  if (!itemUrl || itemUrl.hostname !== HN_ITEM_URL_HOST) {
    return null;
  }

  const observedAt = new Date().toISOString();
  const shape = readHitShape(hit);
  const commentText = typeof hit.comment_text === "string" ? hit.comment_text.trim() : "";
  const storyText = typeof hit.story_text === "string" ? hit.story_text.trim() : "";
  const excerptSource = commentText || storyText;
  const titleSource =
    (typeof hit.title === "string" && hit.title.trim()) ||
    (typeof hit.story_title === "string" && hit.story_title.trim()) ||
    (commentText ? (commentText.split("\n")[0]?.trim() ?? "") : "");
  const title = (titleSource || "Hacker News item").slice(0, MAX_HN_TITLE_CHARS);
  // rss:552 house pattern — created_at is `string | null` in the Algolia
  // hit, so the typeof guard both satisfies strict TS and keeps a missing
  // created_at as honest null instead of safeIsoDate's new Date(null) =
  // 1970-01-01 epoch (reviewer Act-on #2).
  const publishedAt =
    typeof hit.created_at === "string" ? safeIsoDate(hit.created_at) : null;
  const author = typeof hit.author === "string" && hit.author.trim() ? hit.author.trim() : null;
  const bodyExcerpt = excerptSource
    ? excerptSource.replace(/\s+/g, " ").slice(0, MAX_HN_EXCERPT_CHARS)
    : null;

  const item: NormalizedPresenceItem = {
    externalId: objectId,
    // The public news.ycombinator.com discussion URL — never an Algolia
    // internal hostname.
    canonicalUrl: itemUrl.toString(),
    title,
    bodyExcerpt: bodyExcerpt || null,
    author,
    publishedAt: publishedAt ?? observedAt,
    observedAt,
    contentHash: "",
    raw: {
      kind: "hn_item",
      itemType: shape.itemType,
      // Ranking inputs, exactly as the public API reported them.
      points: shape.points,
      commentCount: shape.commentCount,
      storyId: shape.storyId,
      externalUrl: shape.externalUrl,
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

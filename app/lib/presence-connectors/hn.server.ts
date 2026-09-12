import { decodeHtmlEntities } from "~/lib/decode-html.server";
import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import { readResponseJsonWithinLimit } from "~/lib/bounded-response.server";
import { presenceContentHash } from "~/lib/presence-hash";
import type {
  HealthCheckResult,
  NormalizedPresenceItem,
  PollResult,
  PresenceConnectorContext,
  ValidateTargetInput,
  ValidateTargetResult,
} from "~/lib/presence-types";

/**
 * Hacker News presence connector (Algolia HN Search API — issue #3253).
 *
 * Zero-spend mention backbone entry: turns a tracked entity's match phrase
 * into an Algolia HN `search_by_date` query
 * (https://hn.algolia.com/api/v1/search_by_date?query=<phrase>&tags=story,comment)
 * and emits normalized `presence_item` rows. Free, no key, no auth.
 *
 * Courtesy budget, not an SLA: the ~10,000 requests/hour/IP figure is
 * community-observed. Polls therefore stay serialized and low-cadence — a
 * single page fetch per poll, no parallel page fan-out, no deep paging past
 * the ~1,000-result API cap. Incremental windows use time-window slicing
 * (a `numericFilters created_at_i>` filter built from the last cursor), the
 * pattern the Algolia HN API documents for bounded retrieval, so each
 * successive poll reads only the new slice.
 *
 * The host is the fixed public Algolia endpoint (never user-supplied), so
 * there is no user-controlled URL to SSRF-guard; responses are still read
 * through the bounded-response reader so an oversized or malicious payload
 * cannot blow the worker memory ceiling.
 *
 * The connector is wired into the registry but gated behind
 * `PRESENCE_HN_ROLLOUT` (off by default); activation requires the rollout
 * flag and, before migration 0098, the `source_target.connector_id` CHECK
 * widened to accept 'hn' — not a code change in this connector.
 */

const HN_SEARCH_BASE = "https://hn.algolia.com/api/v1/search_by_date";
const HN_ITEM_URL = "https://news.ycombinator.com/item?id=";
const MAX_HN_FETCH_BYTES = 500_000;
/** Hits returned per poll page. One page per poll, serialized, low-cadence. */
const HN_HITS_PER_PAGE = 50;
const MAX_HN_EXCERPT_CHARS = 280;

interface AlgoliaHit {
  objectID: string;
  created_at: string;
  author?: string;
  title?: string | null;
  story_title?: string | null;
  comment_text?: string | null;
  story_text?: string | null;
  points?: number | null;
  num_comments?: number | null;
  story_id?: number | null;
  url?: string | null;
}

export const hnConnector = {
  id: "hn" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost() {
    return { units: 1, description: "One public Algolia HN search_by_date query (no auth, courtesy budget)" };
  },

  /**
   * An HN target is a match phrase, not a URL. No network is touched: the
   * phrase is validated structurally and the live search only happens at
   * poll time (a rejected phrase would cost a query for every poll).
   */
  async validateTarget(
    input: ValidateTargetInput,
    _ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    const raw = (input.targetUrl ?? input.targetHandle ?? "").trim();
    if (!raw) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_phrase",
        errorMessage: "Enter the match phrase to search for on Hacker News.",
      };
    }
    const phrase = collapseWhitespace(raw);
    return {
      ok: true,
      targetKey: phrase,
      targetUrl: null,
      targetHandle: phrase,
      coverageLabel: "OFFICIAL_PUBLIC_API",
      metadata: { query: phrase, tags: "story,comment" },
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
    return {
      ok: true,
      status: "healthy",
      summary: "Hacker News (Algolia Search API) polling is available — no credentials required.",
    };
  },

  async poll(
    ctx: PresenceConnectorContext,
    target: { targetUrl: string | null; targetHandle?: string | null; metadata: Record<string, unknown> },
    cursor?: { lastCreatedAt?: number | string | null },
  ): Promise<PollResult> {
    const query =
      (typeof target.metadata.query === "string" && target.metadata.query.trim()) ||
      (typeof target.targetHandle === "string" && target.targetHandle.trim()) ||
      "";
    if (!query) {
      return {
        ok: false,
        items: [],
        errorCode: "missing_phrase",
        errorMessage: "Hacker News target is missing its match phrase.",
      };
    }

    // Time-window slicing: an explicit numericFilters window (from the last
    // poll's newest createdAt) instead of deep paging. Deep paging is a
    // regression — Algolia caps retrievable results around ~1,000 per query.
    // `created_at_i` is in SECONDS (unix epoch), so the cursor is emitted in
    // seconds to match — a millisecond filter would sit in the far future and
    // return zero hits forever.
    const window = readCursorWindow(cursor);
    let url =
      `${HN_SEARCH_BASE}?query=${encodeURIComponent(query)}` +
      // Parenthesized OR form: Algolia's bare comma is AND, and a hit is
      // either a story OR a comment — the conjunctive form matches nothing.
      `&tags=${encodeURIComponent("(story,comment)")}` +
      `&hitsPerPage=${HN_HITS_PER_PAGE}` +
      `&page=0`;
    if (window !== null) {
      url += `&numericFilters=${encodeURIComponent(`created_at_i>${window}`)}`;
    }

    // Serialized: exactly one fetch per poll. No Promise.all fan-out.
    const fetchImpl = ctx.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
      });
    } catch {
      return {
        ok: false,
        items: [],
        errorCode: "fetch_failed",
        errorMessage: "Could not reach the Algolia HN Search API.",
      };
    }

    if (!response.ok) {
      release(response);
      return {
        ok: false,
        items: [],
        errorCode: "hn_unavailable",
        errorMessage: `Algolia HN Search API responded with HTTP ${response.status}.`,
      };
    }

    let payload: { hits?: AlgoliaHit[] } | null;
    try {
      payload = await readResponseJsonWithinLimit<{ hits?: AlgoliaHit[] }>(response, MAX_HN_FETCH_BYTES);
    } catch {
      payload = null;
    }
    if (!payload || !Array.isArray(payload.hits)) {
      release(response);
      return {
        ok: false,
        items: [],
        errorCode: "hn_parse_failed",
        errorMessage: "Algolia HN Search API returned an unparseable, oversized, or malformed response.",
      };
    }

    const hits = payload.hits;
    const items: NormalizedPresenceItem[] = [];
    // `created_at_i` units are seconds; keep the cursor in seconds.
    let maxCreatedAtSec = window ?? 0;
    for (const hit of hits) {
      if (!hit || typeof hit.objectID !== "string" || !hit.objectID) {
        continue;
      }
      const publishedAt = safeIsoDate(hit.created_at);
      if (publishedAt) {
        const createdSec = Math.floor(Date.parse(publishedAt) / 1000);
        if (Number.isFinite(createdSec) && createdSec > maxCreatedAtSec) {
          maxCreatedAtSec = createdSec;
        }
      }
      items.push(await normalizeHit(hit, publishedAt, query));
    }

    return {
      ok: true,
      items,
      coverageLabel: "OFFICIAL_PUBLIC_API",
      costUnits: 1,
      // NOT a complete snapshot: this is one bounded page (optionally a
      // time-window slice) of a date-ordered search, not the full mention
      // set. Reporting completeSnapshot here would mass-tombstone every
      // previously-seen mention outside the newest window on the next poll.
      cursor: { lastCreatedAt: maxCreatedAtSec > 0 ? maxCreatedAtSec : null, query, completeSnapshot: false },
    };
  },
};

function readCursorWindow(cursor?: { lastCreatedAt?: number | string | null }): number | null {
  const value = cursor?.lastCreatedAt;
  if (value === null || value === undefined) {
    return null;
  }
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
}

function release(response: Response) {
  try {
    response.body?.cancel();
  } catch {
    // best-effort body release
  }
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function safeIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

async function normalizeHit(
  hit: AlgoliaHit,
  publishedAt: string | null,
  query: string,
): Promise<NormalizedPresenceItem> {
  const isComment =
    typeof hit.comment_text === "string" && hit.comment_text.length > 0;
  const storyTitle =
    (typeof hit.story_title === "string" && collapseWhitespace(hit.story_title)) ||
    (typeof hit.title === "string" && collapseWhitespace(hit.title)) ||
    null;
  const bodySource = isComment ? hit.comment_text : hit.story_text ?? hit.url ?? null;
  const excerpt =
    typeof bodySource === "string"
      ? decodeHtmlEntities(stripHtml(bodySource)).slice(0, MAX_HN_EXCERPT_CHARS)
      : "";
  const title = storyTitle
    ? isComment
      ? `Comment on "${storyTitle}"`
      : storyTitle
    : isComment
      ? "Hacker News comment"
      : "Hacker News story";

  // canonicalUrl is always the public news.ycombinator.com item URL. Link
  // metadata (points, num_comments, story_id) travels in raw for ranking,
  // not as the canonical identity.
  return {
    externalId: hit.objectID,
    canonicalUrl: `${HN_ITEM_URL}${hit.objectID}`,
    title,
    bodyExcerpt: excerpt || null,
    author: hit.author ?? null,
    publishedAt,
    observedAt: new Date().toISOString(),
    contentHash: await presenceContentHash({
      title,
      bodyExcerpt: excerpt || null,
      author: hit.author ?? null,
      publishedAt,
    }),
    raw: {
      kind: isComment ? "hn_comment" : "hn_story",
      searchEngine: "hn_algolia",
      query,
      objectID: hit.objectID,
      storyId: hit.story_id ?? null,
      points: hit.points ?? null,
      numComments: hit.num_comments ?? null,
    },
  };
}

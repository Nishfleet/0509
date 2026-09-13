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
 * Hacker News presence connector (issue #3207, mentions epic #3171).
 *
 * MVP-split source: an `hn` presence connector that turns a tracked entity's
 * match phrase into an Algolia HN Search API `search_by_date` query and emits
 * normalized `presence_item` rows — stories AND comments naming the tracked
 * phrase — with no key, no auth, and no spend.
 *
 * API: https://hn.algolia.com/api/v1/search_by_date (the date-ordered
 * variant the ToS directs date-sorted readers to).
 * Terms: the API is provided by Algolia for the HN community, free; no
 * published rate-limit SLA — the ~10,000 req/hr/IP figure is community
 * observed, not an SLA (docs/mentions/PLAN.md §2, "Hacker News" row). The
 * rejected official alternative is the Firebase HN API (no search endpoint).
 * OSS collectors surveyed before building (searched: "hacker news mentions"
 — GitHub, 27 results; surveyed vercel-labs/slacker, TristanH/slackernews,
 * Tuccinator/hn-moocs): all dormant single-tenant Slack/list bots with no
 * mention substrate, so the connector rides the in-repo connector interface
 * instead of adopting a 2015–2023 poller (smaller, no new dependency).
 *
 * Fair use: exactly one `presenceSafeFetch` per poll — no parallel fan-out —
 * and the result page is capped at 50 hits against the courtesy budget.
 * The search window is a rolling 7-day `numericFilters=created_at_i>` bound,
 * so overlap between polls is expected and deduped downstream: the capture
 * path keys `presence_item` uniqueness on (source_target_id, url_hash), and
 * `url_hash` hashes the canonical URL.
 *
 * Every network hop goes through `presenceSafeFetch` (SSRF hardening +
 * redirects re-validated). A raw `fetch` to the Algolia endpoint is a
 * regression.
 *
 * 4xx/5xx/rate responses map to honest degraded results — never fabricated
 * items. An empty hit list is an honest empty result.
 *
 * The connector is wired into the registry but gated behind
 * `PRESENCE_HN_ROLLOUT` (off by default); healthCheck reports "pending"
 * while the flag is unset. Activation also needs the 0100 CHECK widen for
 * `source_target.connector_id = 'hn'`.
 */
const HN_ALGOLIA_SEARCH_BASE = "https://hn.algolia.com/api/v1/search_by_date";
const HN_MAX_HITS = 50;
const HN_MAX_BYTES = 750_000;
const DEFAULT_WINDOW_DAYS = 7;
const HN_ITEM_URL = "https://news.ycombinator.com/item";

interface AlgoliaHit {
  objectID?: unknown;
  created_at?: unknown;
  title?: unknown;
  url?: unknown;
  author?: unknown;
  comment_text?: unknown;
  story_text?: unknown;
  story_title?: unknown;
  points?: unknown;
  num_comments?: unknown;
  story_id?: unknown;
}

/**
 * The "target" for the hn connector is the tracked entity's match phrase,
 * exactly as for gdelt: the validate target carries it as targetUrl or
 * targetHandle and the connector stores it in metadata.matchPhrase.
 */
export const hnConnector = {
  id: "hn" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return { units: 1, description: "One serialized Algolia HN search_by_date request" };
  },

  async validateTarget(
    input: ValidateTargetInput,
    _ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    // Mirror the gdelt target shape: the match phrase rides targetUrl or
    // targetHandle; the connector stores it in metadata.matchPhrase.
    const phrase = (input.targetUrl ?? input.targetHandle ?? "").trim();
    if (!phrase) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_match_phrase",
        errorMessage: "Enter a match phrase to search Hacker News for.",
      };
    }

    if (phrase.length > 256) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "match_phrase_too_long",
        errorMessage: "Match phrase is too long for the Algolia HN search API (max 256 characters).",
      };
    }

    const normalizedPhrase = normalizeSearchPhrase(phrase);
    if (!normalizedPhrase) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "match_phrase_invalid",
        errorMessage: "Match phrase is empty after normalization.",
      };
    }

    // Algolia runs with advanced syntax off: the phrase is the literal
    // full-text query. Stored for provenance in metadata.
    return {
      ok: true,
      targetKey: normalizedPhrase.toLowerCase().slice(0, 256),
      targetUrl: null,
      targetHandle: phrase,
      coverageLabel: "OFFICIAL_PUBLIC_API",
      metadata: {
        matchPhrase: normalizedPhrase,
        hnQuery: normalizedPhrase,
        windowDays: DEFAULT_WINDOW_DAYS,
        maxHits: HN_MAX_HITS,
      },
    };
  },

  async healthCheck(ctx: PresenceConnectorContext): Promise<HealthCheckResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "hn", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "Hacker News mention tracking is not enabled yet.",
        errorCode: gate.reasonCode,
      };
    }

    // The rollout is on: probe the public endpoint once. Healthy only when
    // the endpoint answers.
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(
      buildSearchUrl(HN_PROBE_PHRASE, DEFAULT_WINDOW_DAYS, 1),
      fetchImpl,
      { method: "GET", maxBytes: HN_MAX_BYTES, accept: "application/json" },
    );

    if (!response || !response.ok) {
      return {
        ok: false,
        status: "degraded",
        summary: "Algolia HN endpoint did not answer a probe request.",
        errorCode: "hn_unreachable",
      };
    }

    return {
      ok: true,
      status: "healthy",
      summary: "Hacker News (Algolia) mention polling is available — no key required.",
    };
  },

  async poll(
    ctx: PresenceConnectorContext,
    target: { targetHandle: string | null; targetUrl: string | null; metadata: Record<string, unknown>; targetKey: string },
  ): Promise<PollResult> {
    const phrase =
      (typeof target.metadata.matchPhrase === "string" && target.metadata.matchPhrase) ||
      target.targetHandle ||
      (target.targetKey?.trim() ? target.targetKey : null);
    if (!phrase?.trim()) {
      return {
        ok: false,
        items: [],
        errorCode: "missing_match_phrase",
        errorMessage: "Hacker News target has no match phrase to search for.",
      };
    }
    if (phrase.trim().length > 256) {
      return {
        ok: false,
        items: [],
        errorCode: "match_phrase_too_long",
        errorMessage: "Match phrase exceeds the Algolia HN search API limit (max 256 characters).",
      };
    }

    // Fail closed on a stored phrase that no longer normalizes (a target
    // written before the guard, or hand-edited): honest degraded result, and
    // the courtesy budget of one request per poll is not spent on it.
    const normalizedPhrase = normalizeSearchPhrase(phrase);
    if (!normalizedPhrase) {
      return {
        ok: false,
        items: [],
        errorCode: "match_phrase_invalid",
        errorMessage: "Stored Hacker News match phrase is empty after normalization; fix the target's match phrase.",
      };
    }

    const windowDays =
      typeof target.metadata.windowDays === "number" && target.metadata.windowDays > 0
        ? Math.min(Math.floor(target.metadata.windowDays), 30)
        : DEFAULT_WINDOW_DAYS;

    // Serialized against the courtesy budget: exactly one request per poll —
    // no parallel fan-out. There is no published rate SLA (see header); the
    // serial low-cadence poll is the budget.
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(
      buildSearchUrl(normalizedPhrase, windowDays, HN_MAX_HITS),
      fetchImpl,
      { method: "GET", maxBytes: HN_MAX_BYTES, accept: "application/json" },
    );

    if (!response) {
      return {
        ok: false,
        items: [],
        errorCode: "fetch_failed",
        errorMessage: "Could not reach the Algolia HN Search API.",
      };
    }

    if (!response.ok || !response.body) {
      // 4xx/5xx/rate responses are honest degraded results — never fabricate
      // items from a failed request.
      return {
        ok: false,
        items: [],
        errorCode: response.status === 429 ? "rate_limited" : "hn_source_error",
        errorMessage: `Algolia HN API responded with HTTP ${response.status}.`,
        coverageLabel: "OFFICIAL_PUBLIC_API",
      };
    }

    let parsed: { hits?: AlgoliaHit[] };
    try {
      parsed = JSON.parse(response.body) as { hits?: AlgoliaHit[] };
    } catch {
      return {
        ok: false,
        items: [],
        errorCode: "hn_parse_failed",
        errorMessage: "Algolia HN API response was not valid JSON.",
        coverageLabel: "OFFICIAL_PUBLIC_API",
      };
    }

    const hits = Array.isArray(parsed.hits) ? parsed.hits.slice(0, HN_MAX_HITS) : [];
    const items: NormalizedPresenceItem[] = [];
    // In-page dedup by canonical URL: one canonical discussion mention, even
    // if the same canonical URL reaches this page twice. Across polls the
    // capture substrate dedups on (source_target_id, url_hash).
    const seenCanonicalUrls = new Set<string>();
    for (const hit of hits) {
      const itemId = typeof hit.objectID === "string" && hit.objectID ? hit.objectID : null;
      if (!itemId) {
        // A hit without its HN item id cannot produce an honest canonical
        // mention: skipped, never fabricated.
        continue;
      }
      const isComment = typeof hit.comment_text === "string" && hit.comment_text.trim().length > 0;

      // canonicalUrl is the public surface: a story's own external URL when
      // it has one, otherwise the HN discussion item page (comments always
      // anchor their own item page). Never the Algolia API URL. Third-party
      // rows: only a normalizable public http(s) URL may become canonical.
      const storyUrlRaw = !isComment && typeof hit.url === "string" && hit.url ? hit.url : null;
      const publicUrl = storyUrlRaw ?? `${HN_ITEM_URL}?id=${itemId}`;
      const canonicalUrl = normalizePublicHttpUrl(publicUrl)?.toString() ?? null;
      if (!canonicalUrl) {
        continue;
      }
      if (seenCanonicalUrls.has(canonicalUrl)) {
        continue;
      }
      seenCanonicalUrls.add(canonicalUrl);

      const storyTitle =
        (typeof hit.title === "string" && hit.title.trim()) ||
        (typeof hit.story_title === "string" && hit.story_title.trim()) ||
        null;
      const title = isComment
        ? storyTitle
          ? `Comment on: ${storyTitle}`
          : "Hacker News comment"
        : storyTitle ?? "Untitled HN post";
      const excerptRaw =
        (isComment ? hit.comment_text : (typeof hit.story_text === "string" ? hit.story_text : null)) ?? null;
      const excerpt = typeof excerptRaw === "string" && excerptRaw.trim() ? excerptRaw.trim().slice(0, 280) : null;
      const observedAt = new Date().toISOString();
      const publishedAt = parseHnDate(hit.created_at) ?? observedAt;
      const base: NormalizedPresenceItem = {
        externalId: itemId,
        // canonicalUrl is the public HN/publisher surface — never the API URL.
        canonicalUrl,
        title,
        bodyExcerpt: excerptRaw,
        author: typeof hit.author === "string" && hit.author ? hit.author : null,
        publishedAt,
        observedAt,
        contentHash: "",
        raw: {
          kind: "hn_item",
          itemType: isComment ? "comment" : "story",
          storyId: typeof hit.story_id === "string" ? hit.story_id : null,
          points: typeof hit.points === "number" ? hit.points : null,
          numComments: typeof hit.num_comments === "number" ? hit.num_comments : null,
        },
      };
      base.contentHash = await presenceContentHash({
        title: base.title,
        bodyExcerpt: base.bodyExcerpt,
        author: base.author,
        publishedAt: base.publishedAt,
      });
      items.push(base);
    }

    return {
      ok: true,
      items,
      coverageLabel: "OFFICIAL_PUBLIC_API",
      costUnits: 1,
      cursor: { phrase: normalizedPhrase, windowDays },
    };
  },
};

/** Probe phrase for healthCheck — a stable term guaranteed to return hits. */
const HN_PROBE_PHRASE = "hacker news";

/**
 * Build the Algolia HN Search API `search_by_date` URL. Kept public for the
 * health probe. The rolling window rides `numericFilters=created_at_i>`,
 * bounds courtesy of the 7-day cadence, and the page is capped at
 * `hitsPerPage` — the courtesy-budget shape: one bounded request, no fan-out.
 */
export function buildSearchUrl(query: string, windowDays: number, hitsPerPage: number): string {
  const url = new URL(HN_ALGOLIA_SEARCH_BASE);
  url.searchParams.set("query", query);
  url.searchParams.set("tags", "(story,comment)");
  const sinceSeconds = Math.floor(Date.now() / 1000) - windowDays * 24 * 60 * 60;
  url.searchParams.set("numericFilters", `created_at_i>${sinceSeconds}`);
  url.searchParams.set("hitsPerPage", String(hitsPerPage));
  return url.toString();
}

/**
 * Collapse whitespace in a match phrase. Algolia's HN endpoint runs with
 * advanced syntax off, so the phrase is literal — no operator stripping, only
 * whitespace hygiene. A phrase that survives with nothing left fails closed
 * (validateTarget/poll callers). Kept in step with the 256-character API
 * bound that `validateTarget` and `poll` enforce first.
 */
export function normalizeSearchPhrase(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const phrase = value.trim().replace(/\s+/g, " ").trim();
  if (!phrase || phrase.length > 256) {
    return null;
  }
  return phrase;
}

/** Parse an Algolia `created_at` ISO instant; absent/invalid falls back to the caller (never fabricated). */
function parseHnDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

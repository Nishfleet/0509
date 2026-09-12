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
 * GDELT DOC 2.1 mainstream-news mention connector (issue #3178).
 *
 * A mention target is a QUERY target: target_key is the brand/person match
 * phrase, and the surface's own search pre-filters news coverage of that
 * phrase. Every GDELT run uses fetchImpl injected through the SSRF-hardened
 * `presenceSafeFetch` path — a raw `fetch` is a regression.
 *
 * Surface + terms (no paid vendor, $0):
 * - API docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 * - Terms: https://www.gdeltproject.org/about.html#termsofuse — "unlimited and
 *   unrestricted use for any academic, commercial, or governmental use of any
 *   kind without fee"; citation required, so every emitted item carries the
 *   source domain and the GDELT API URL in its raw payload.
 *
 * Rate budget (fair-use guidance, encoded here and asserted in tests):
 * - ONE request per poll (a poll = one `doc/doc` artlist query).
 * - `maxrecords` capped at 75 (API max is 250; we stay well under).
 * - `timespan` bounded to a rolling window so repeated polls only re-fetch the
 *   recent slice; no crawl of the 3-month archive.
 * - No logo/image/social-image fetches; no second hop per article.
 */

const GDELT_API_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";
/** Fair-use budget: one artlist query per poll, ≤75 records, rolling window. */
const MAX_ARTICLES_PER_POLL = 75;
const MAX_TIMESPAN_DAYS = 1;
/** GDELT titles are headline-only; cap the excerpt at the same bound the feed connector uses. */
const MAX_EXCERPT_CHARS = 280;

export const gdeltConnector = {
  id: "gdelt" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return { units: 1, description: "One GDELT DOC 2.1 artlist query poll (fair-use: 1 request/poll, ≤75 records)" };
  },

  async validateTarget(
    input: ValidateTargetInput,
    ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "gdelt", input.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "GDELT news tracking is not enabled yet.",
      };
    }

    const phrase = normalizeQueryPhrase(input.targetHandle ?? input.targetUrl);
    if (!phrase) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_query",
        errorMessage: "Enter the brand or person name to match, like “Acme Robotics”.",
      };
    }

    return {
      ok: true,
      targetKey: phrase.toLowerCase(),
      targetHandle: phrase,
      coverageLabel: "OFFICIAL_PUBLIC_API",
      metadata: {
        sourceReadout: "gdelt_doc_2_1",
        query: phrase,
      },
    };
  },

  async healthCheck(ctx: PresenceConnectorContext): Promise<HealthCheckResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "gdelt", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "GDELT connector is gated.",
        errorCode: gate.reasonCode,
      };
    }
    return {
      ok: true,
      status: "healthy",
      summary: "GDELT DOC 2.1 polling is available — public API, no credentials required.",
    };
  },

  async poll(ctx: PresenceConnectorContext, target: { metadata: Record<string, unknown> }): Promise<PollResult> {
    if (ctx.env.PRESENCE_GDELT_MOCK === "1") {
      // Deterministic fixture mention (tests/e2e): the fixture brand returns
      // exactly one mainstream-news mention, matching the issue's e2e bar.
      const now = new Date().toISOString();
      const item: NormalizedPresenceItem = {
        externalId: "mock-gdelt-1",
        canonicalUrl: "https://fixture-news.example.test/story/fixture-brand-launch",
        title: "Fixture brand launches — mainstream news mention",
        bodyExcerpt: "Fixture coverage of the brand from the GDELT connector e2e.",
        author: null,
        publishedAt: now,
        observedAt: now,
        contentHash: await presenceContentHash({
          title: "Fixture brand launches — mainstream news mention",
        }),
        raw: { source: "fixture", api: GDELT_API_BASE },
      };
      return { ok: true, items: [item], costUnits: 0, cursor: { completeSnapshot: false } };
    }

    const queryMeta = target.metadata?.query;
    const phrase = normalizeQueryPhrase(typeof queryMeta === "string" ? queryMeta : null);
    if (!phrase) {
      return {
        ok: false,
        items: [],
        errorCode: "missing_query",
        errorMessage: "GDELT target is missing its match phrase.",
      };
    }

    const timespanDays = clampInt(target.metadata?.timespanDays, 1, MAX_TIMESPAN_DAYS);
    // Fair-use budget (issue acceptance: "rate budgets per source"): exactly
    // one HTTP request per poll, ≤75 records, rolling `timespan` window.
    const apiUrl =
      `${GDELT_API_BASE}?query=${encodeURIComponent(`"${phrase}"`)}&mode=artlist` +
      `&maxrecords=${MAX_ARTICLES_PER_POLL}&timespan=${timespanDays}d&format=json`;

    const response = await presenceSafeFetch(apiUrl, ctx.fetchImpl ?? fetch, {
      method: "GET",
      maxBytes: 1_000_000,
      accept: "application/json,text/plain,*/*",
    });

    if (!response) {
      return { ok: false, items: [], errorCode: "fetch_failed", errorMessage: "Could not fetch the GDELT DOC API." };
    }
    if (response.status === 429) {
      return {
        ok: false,
        items: [],
        errorCode: "rate_limited",
        errorMessage: "GDELT rate budget reached — back off and retry at the next poll.",
      };
    }
    if (!response.ok || !response.body) {
      return {
        ok: false,
        items: [],
        errorCode: "gdelt_unavailable",
        errorMessage: `GDELT DOC API responded with HTTP ${response.status}.`,
      };
    }

    let parsed: { articles?: unknown } | null = null;
    try {
      parsed = JSON.parse(response.body) as { articles?: unknown };
    } catch {
      return {
        ok: false,
        items: [],
        errorCode: "gdelt_parse_failed",
        errorMessage: "GDELT DOC API response was not valid JSON.",
      };
    }

    if (!Array.isArray(parsed.articles)) {
      return {
        ok: false,
        items: [],
        errorCode: "gdelt_parse_failed",
        errorMessage: "GDELT DOC API response had no articles list.",
      };
    }

    const now = new Date().toISOString();
    const items: NormalizedPresenceItem[] = [];
    for (const article of parsed.articles.slice(0, MAX_ARTICLES_PER_POLL)) {
      if (!article || typeof article !== "object") continue;
      const record = article as Record<string, unknown>;
      const url = typeof article.url === "string" && article.url ? article.url : null;
      const title = typeof article.title === "string" && article.title ? article.title : null;
      if (!url || !title) continue;
      const domain = typeof article.domain === "string" ? article.domain : null;
      const publishedAt = parseGdeltSeenDate(typeof article.seendate === "string" ? article.seendate : null);
      items.push({
        externalId: url,
        canonicalUrl: url,
        title: title.slice(0, MAX_EXCERPT_CHARS),
        bodyExcerpt: null,
        author: null,
        publishedAt: publishedAt ?? now,
        observedAt: now,
        contentHash: "",
        raw: {
          kind: "news_article",
          provider: "gdelt_doc_2_1",
          apiUrl: GDELT_API_BASE,
          sourceDomain: domain,
          language: typeof article.language === "string" ? article.language : null,
          sourceCountry: typeof article.sourcecountry === "string" ? article.sourcecountry : null,
        },
      });
    }

    for (const item of items) {
      item.contentHash = await presenceContentHash({
        title: item.title,
        bodyExcerpt: item.bodyExcerpt,
        author: item.author,
        publishedAt: item.publishedAt,
      });
    }

    return {
      ok: true,
      items,
      cursor: { api: GDELT_API_BASE, maxRecords: MAX_ARTICLES_PER_POLL, timespanDays },
      coverageLabel: "OFFICIAL_PUBLIC_API",
      costUnits: 1,
    };
  },
};

function clampInt(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "number" ? Math.floor(value) : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function normalizeQueryPhrase(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const phrase = value.trim().replace(/\s+/g, " ");
  if (!phrase || phrase.length > 120) return null;
  return phrase;
}

/**
 * GDELT `seendate` format is `YYYYMMDDTHHMMSSZ` (e.g. 20260912T083000Z).
 */
function parseGdeltSeenDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match;
  const parsed = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

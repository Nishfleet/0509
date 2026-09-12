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
 * GDELT DOC 2.1 mainstream-news presence connector (issue #3251).
 *
 * MVP mention source 2 of 3: a `gdelt` presence connector that turns a
 * tracked entity's match phrase into a GDELT DOC 2.1 article-list query and
 * emits normalized `presence_item` rows, giving mainstream-news mention
 * coverage across ~65 machine-translated languages with no key, no auth, and
 * no spend.
 *
 * API: https://api.gdeltproject.org/api/v2/doc/doc?query=<phrase>&mode=artlist&format=json&timespan=<window>
 * Terms: unlimited unrestricted use including commercial, citation required
 * (https://www.gdeltproject.org/about.html#termsofuse).
 *
 * Fair use: requests inside `poll` are serialized — one `presenceSafeFetch`
 * per poll, never a parallel fan-out, and the record list is capped at 250.
 * Rolling search window defaults to 1 week (advisory default).
 *
 * Every network hop goes through `presenceSafeFetch` (SSRF hardening +
 * redirects re-validated). A raw `fetch` to the GDELT endpoint is a
 * regression.
 *
 * 4xx/5xx/rate responses map to honest degraded results — never fabricated
 * items. An empty article list is an honest empty result.
 *
 * The connector is wired into the registry but gated behind
 * `PRESENCE_GDELT_ROLLOUT` (off by default); healthCheck reports "pending"
 * while the flag is unset. Activation also needs the 0098 CHECK widen for
 * `source_target.connector_id = 'gdelt'`.
 */
const GDELT_API_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_MAX_RECORDS = 250;
const DEFAULT_TIMESPAN = "1week";
const MAX_GDELT_EXCERPT_CHARS = 280;

interface GdeltArticle {
  url?: unknown;
  title?: string;
  seendate?: string;
  language?: string;
  domain?: string;
  sourcecountry?: string;
}

export const gdeltConnector = {
  id: "gdelt" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return { units: 1, description: "One serialized GDELT DOC 2.1 article-list request" };
  },

  async validateTarget(
    input: ValidateTargetInput,
    _ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    // The "target" for GDELT is the tracked entity's match phrase. The
    // validate target carries it as targetUrl (analogous to a search surface)
    // or in targetHandle; the connector stores it in metadata.matchPhrase.
    const phrase = (input.targetUrl ?? input.targetHandle ?? "").trim();
    if (!phrase) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_match_phrase",
        errorMessage: "Enter a match phrase to search GDELT mainstream news for.",
      };
    }

    if (phrase.length > 256) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "match_phrase_too_long",
        errorMessage: "Match phrase is too long for the GDELT query API (max 256 characters).",
      };
    }

    // Advisory syntax mapping: the phrase is wrapped in GDELT quoted-phrase
    // syntax. The test pins output shape only.
    const query = `"${phrase}"`;
    const targetKey = phrase.toLowerCase().replace(/\s+/g, " ").slice(0, 256);

    return {
      ok: true,
      targetKey,
      targetUrl: null,
      targetHandle: phrase,
      coverageLabel: "OFFICIAL_PUBLIC_API",
      metadata: {
        matchPhrase: phrase,
        gdeltQuery: query,
        timespan: DEFAULT_TIMESPAN,
        maxRecords: GDELT_MAX_RECORDS,
      },
    };
  },

  async healthCheck(ctx: PresenceConnectorContext): Promise<HealthCheckResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "gdelt", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "GDELT mainstream news tracking is not enabled yet.",
        errorCode: gate.reasonCode,
      };
    }

    // The rollout is on: probe the public endpoint once. Healthy only when
    // the endpoint answers.
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(
      buildArticleListUrl(`"${PRESENCE_GDELT_PROBE_PHRASE}"`, "1week", 1),
      fetchImpl,
      { method: "GET", maxBytes: GDELT_MAX_BYTES },
    );

    if (!response || !response.ok) {
      return {
        ok: false,
        status: "degraded",
        summary: "GDELT endpoint did not answer a probe request.",
        errorCode: "gdelt_unreachable",
      };
    }

    return {
      ok: true,
      status: "healthy",
      summary: "GDELT DOC 2.1 mainstream news polling is available — no key required.",
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
        errorMessage: "GDELT target has no match phrase to search for.",
      };
    }

    const timespan =
      typeof target.metadata.timespan === "string" && target.metadata.timespan
        ? target.metadata.timespan
        : DEFAULT_TIMESPAN;

    // Serialized against GDELT fair-use guidance: exactly one request per
    // poll — no parallel fan-out.
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(
      buildArticleListUrl(`"${phrase.trim()}"`, timespan, GDELT_MAX_RECORDS),
      fetchImpl,
      { method: "GET", maxBytes: GDELT_MAX_BYTES, accept: "application/json,text/plain,*/*" },
    );

    if (!response) {
      return {
        ok: false,
        items: [],
        errorCode: "fetch_failed",
        errorMessage: "Could not reach the GDELT DOC 2.1 API.",
      };
    }

    if (!response.ok || !response.body) {
      // 4xx/5xx/rate responses are honest degraded results — never fabricate
      // items from a failed request.
      return {
        ok: false,
        items: [],
        errorCode: response.status === 429 ? "rate_limited" : "gdelt_source_error",
        errorMessage: `GDELT API responded with HTTP ${response.status}.`,
        coverageLabel: "OFFICIAL_PUBLIC_API",
      };
    }

    let parsed: { articles?: GdeltArticle[] };
    try {
      parsed = JSON.parse(response.body) as { articles?: GdeltArticle[] };
    } catch {
      return {
        ok: false,
        items: [],
        errorCode: "gdelt_parse_failed",
        errorMessage: "GDELT API response was not valid JSON.",
        coverageLabel: "OFFICIAL_PUBLIC_API",
      };
    }

    const articles = Array.isArray(parsed.articles) ? parsed.articles.slice(0, GDELT_MAX_RECORDS) : [];
    const items: NormalizedPresenceItem[] = [];
    for (const article of articles) {
      const url = typeof article.url === "string" && article.url.startsWith("http") ? article.url : null;
      if (!url) {
        // An article without a usable canonical article URL is skipped, not
        // fabricated from the request URL.
        continue;
      }
      const title =
        typeof article.title === "string" && article.title.trim() ? article.title.trim() : "Untitled article";
      const observedAt = new Date().toISOString();
      const publishedAt = parseGdeltSeenDate(article.seendate) ?? observedAt;
      const base: NormalizedPresenceItem = {
        externalId: url,
        // canonicalUrl is the article URL — never the API request URL.
        canonicalUrl: url,
        title,
        bodyExcerpt: null,
        author: typeof article.domain === "string" && article.domain ? article.domain : null,
        publishedAt,
        observedAt,
        contentHash: "",
        raw: {
          kind: "gdelt_article",
          language: article.language ?? null,
          domain: article.domain ?? null,
          sourceCountry: article.sourcecountry ?? null,
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
      cursor: { phrase, timespan },
    };
  },
};

/** Probe phrase for healthCheck — a stable term guaranteed to return articles. */
const PRESENCE_GDELT_PROBE_PHRASE = "globe";
const GDELT_MAX_BYTES = 750_000;

/**
 * Build the GDELT DOC 2.1 article-list JSON URL. Kept public for the health
 * probe. `timesspan` is the API's rolling-search window parameter.
 */
export function buildArticleListUrl(query: string, timespan: string, maxRecords: number): string {
  const url = new URL(GDELT_API_BASE);
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("timespan", timespan);
  url.searchParams.set("maxrecords", String(maxRecords));
  return url.toString();
}

/** GDELT `seendate` format is `YYYYMMDDTHHMMSSZ` (UTC). */
export function parseGdeltSeenDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/i);
  if (!match) {
    return safeIsoDate(value);
  }
  return safeIsoDate(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`,
  );
}

function safeIsoDate(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

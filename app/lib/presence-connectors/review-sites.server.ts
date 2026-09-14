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
 * Review-sites presence connector (issue #3209 — split of #3171, epic #3171).
 *
 * First wired provider: Trustpilot business-unit review pages. A tracked
 * brand's public review page — `https://www.trustpilot.com/review/<domain>`,
 * the same page a human reads — carries the business unit's OWN published
 * schema.org/Review JSON-LD. The connector's contract is "the response
 * body's own ld+json": no vendor account, no API key, no credentials. The
 * published structured data is the evidence, committed verbatim as the
 * integration fixture (tests/integration/fixtures/review-sites/
 * trustpilot-review-github-com.2026-09-13.html, captured 2026-09-13).
 *
 * What the public surface covers — stated, not implied:
 * - Trustpilot: the ~20 newest reviews the business-unit page publishes
 *   (measured: the 2026-09-13 fixture ships exactly 20). Each item's
 *   canonicalUrl is `https://www.trustpilot.com/reviews/<review-uuid>`, built
 *   from the published @id's final segment (Trustpilot's own published
 *   identifier); the `/reviews/<uuid>` path is confirmed by Trustpilot's own
 *   301 redirect (measured 2026-09-14). Star ratings ride raw_json — a free
 *   engagement signal, never paid enrichment.
 * - G2 / Capterra: their public product pages are bot-verified (G2 =
 *   DataDome CAPTCHA, Capterra = Cloudflare; measured 2026-09-13/14 from the
 *   fleet box — the challenge fixture ships with this issue) and their
 *   documented APIs are partner/paid programs. They are NOT captured by this
 *   slice; adding a g2.com/capterra.com target answers honestly
 *   (`provider_not_wired_yet`). Documented in docs/mentions/PLAN.md §2/§8 —
 *   the research log cites what was searched and rejected.
 *
 * Rate budget: exactly ONE serialized GET of the business-unit review page
 * per poll (the agreed per-source budget; polls serialize upstream in the
 * existing fan-out). No pagination: the page publishes what it publishes,
 * and re-polling overlaps it — the (source_target_id, url_hash) UNIQUE
 * constraint dedupes by canonical URL, so the sliding ~20-review window
 * glides without duplication and older captured reviews stay put.
 *
 * Fail-closed (the capture-validity posture, mentions edition): a challenge
 * page (AWS-WAF "Verifying Connection" / DataDome) or an unparsable body is
 * an honest recorded failure (`review_site_challenge` /
 * `review_site_parse_failed`) — never a fabricated mention. The 2026-09-13/14
 * measurements: a plain unauthenticated fetch from the fleet box receives
 * Trustpilot's 991-byte AWS-WAF interstitial (HTTP 403, CloudFront) —
 * production admission rides the rollout decision, exactly like every other
 * gated connector.
 *
 * The connector ships dark behind `PRESENCE_REVIEW_SITES_ROLLOUT` (off by
 * default); activation needs the flag and the 0103 CHECK widen for
 * `source_target.connector_id = 'review_sites'` — not a code change here.
 */
const TRUSTPILOT_BUSINESS_UNIT_URL_BASE = "https://www.trustpilot.com/review";
/** The public review permalink pattern, 301-confirmed 2026-09-14. */
const TRUSTPILOT_REVIEW_URL_BASE = "https://www.trustpilot.com/reviews";
const TRUSTPILOT_HOSTS = new Set(["www.trustpilot.com", "trustpilot.com"]);
const REVIEW_SITES_MAX_BYTES = 750_000;
const MAX_REVIEW_EXCERPT_CHARS = 280;
const MAX_REVIEW_TITLE_CHARS = 120;
/**
 * The measured business-unit page publishes the ~20 newest reviews (the
 * 2026-09-13 fixture ships exactly 20); the cap only bounds pathological
 * future payloads so the one-request budget story cannot silently grow.
 */
const MAX_REVIEWS_PER_POLL = 50;
/** Stable probe target for healthCheck — a famous, permanent business unit. */
const TRUSTPILOT_PROBE_BUSINESS_UNIT = "github.com";

interface TrustpilotReviewNode {
  "@id"?: string | null;
  author?: { name?: string | null } | string | null;
  datePublished?: string | null;
  headline?: string | null;
  reviewBody?: string | null;
  reviewRating?: { ratingValue?: string | number | null } | null;
}

interface TrustpilotGraphContainer {
  "@context"?: string | null;
  "@graph"?: Array<Record<string, unknown>> | null;
  "@type"?: string | string[] | null;
  [key: string]: unknown;
}

/**
 * Resolves the Trustpilot business-unit domain id ("github.com") from the
 * target input, house-style: only what the input actually says, never a
 * fabricated guess.
 *
 * Priority:
 * 1. an explicit trustpilot.com/review/<domain> targetUrl — its last /review/
 *    segment IS the published business-unit key;
 * 2. any other http(s) targetUrl — the tracked brand's own website; its
 *    hostname (one leading "www." stripped) is the searched-for unit;
 * 3. targetHandle — a bare domain ("github.com");
 * 4. metadata.reviewDomain — the stored precedent.
 * Returns null when none of those yield a plausible domain — the caller
 * answers honestly instead of guessing.
 */
export function resolveReviewDomain(input: {
  targetUrl?: string | null;
  targetHandle?: string | null;
  metadata?: Record<string, unknown>;
}): string | null {
  const domainFromHost = (hostname: string): string | null => {
    const stripped = hostname.trim().toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(stripped) ? stripped : null;
  };

  if (typeof input.metadata?.reviewDomain === "string") {
    const fromMetadata = domainFromHost(input.metadata.reviewDomain);
    if (fromMetadata) {
      return fromMetadata;
    }
  }

  if (typeof input.targetUrl === "string" && input.targetUrl.trim()) {
    try {
      const url = new URL(input.targetUrl.trim());
      if (TRUSTPILOT_HOSTS.has(url.hostname.toLowerCase())) {
        const segment = url.pathname.match(/^\/review\/([^/]+)/);
        if (segment?.[1]) {
          return decodeURIComponent(segment[1]).toLowerCase();
        }
      }
      return domainFromHost(url.hostname);
    } catch {
      // not a usable URL — fall through to the handle.
    }
  }

  if (typeof input.targetHandle === "string" && input.targetHandle.trim()) {
    const raw = input.targetHandle.trim();
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw)) {
      return raw.toLowerCase().replace(/^www\./, "");
    }
    try {
      return domainFromHost(new URL(raw).hostname);
    } catch {
      return null;
    }
  }

  return null;
}

function isOtherKnownReviewProvider(url: URL): boolean {
  return url.hostname === "www.g2.com" || url.hostname === "g2.com" ||
    url.hostname === "www.capterra.com" || url.hostname === "capterra.com";
}

export const reviewSitesConnector = {
  id: "review_sites" as const,
  supportedModes: ["self", "competitor"] as const,

  estimateCost(): CostEstimate {
    return {
      units: 1,
      description: "One serialized Trustpilot business-unit review-page fetch (free, public web)",
    };
  },

  async validateTarget(
    input: ValidateTargetInput,
    ctx: PresenceConnectorContext,
  ): Promise<ValidateTargetResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "review_sites", input.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "Review-sites connector is not available.",
      };
    }

    // Known but not-yet-wired providers answer honestly — their bot-verified
    // public pages and partner/paid APIs are documented in
    // docs/mentions/PLAN.md §2/§8; inclusion rides a future slice.
    if (typeof input.targetUrl === "string" && input.targetUrl.trim()) {
      try {
        if (isOtherKnownReviewProvider(new URL(input.targetUrl.trim()))) {
          return {
            ok: false,
            coverageLabel: "UNAVAILABLE",
            errorCode: "provider_not_wired_yet",
            errorMessage:
              "G2/Capterra pages are bot-verified (DataDome/Cloudflare) and not captured yet — documented in docs/mentions/PLAN.md. Add the tracked brand's Trustpilot review page or its own website.",
          };
        }
      } catch {
        // the domain resolver answers this honestly below.
      }
    }

    const domain = resolveReviewDomain(input);
    if (!domain) {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_review_domain",
        errorMessage:
          "Enter the tracked brand's Trustpilot review page (trustpilot.com/review/<domain>) or its own website.",
      };
    }

    const businessUnitUrl = normalizePublicHttpUrl(
      `${TRUSTPILOT_BUSINESS_UNIT_URL_BASE}/${domain}`,
    );
    if (!businessUnitUrl || businessUnitUrl.hostname !== "www.trustpilot.com") {
      return {
        ok: false,
        coverageLabel: "UNAVAILABLE",
        errorCode: "missing_review_domain",
        errorMessage: "The resolved business-unit URL is not a usable http(s) Trustpilot review page.",
      };
    }

    return {
      ok: true,
      // The published business-unit key, unique per (entity, connector).
      targetKey: domain,
      targetUrl: businessUnitUrl.toString(),
      targetHandle: domain,
      coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
      metadata: { reviewDomain: domain, provider: "trustpilot", businessUnitUrl: businessUnitUrl.toString() },
    };
  },

  async healthCheck(ctx: PresenceConnectorContext): Promise<HealthCheckResult> {
    const gate = await evaluateConnectorAccessGate(ctx.env, "review_sites", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        status: "pending",
        summary: gate.reasonMessage ?? "Review-sites tracking is not enabled yet.",
        errorCode: gate.reasonCode,
      };
    }

    // The rollout is on: probe the public business-unit page once — the
    // cheapest honest liveness question, and the single budgeted request.
    // Healthy only when the page answers (a challenge interstitial answers
    // "degraded" — the measured fleet-box posture, 2026-09-13/14).
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(
      `${TRUSTPILOT_BUSINESS_UNIT_URL_BASE}/${TRUSTPILOT_PROBE_BUSINESS_UNIT}`,
      fetchImpl,
      { method: "GET", maxBytes: REVIEW_SITES_MAX_BYTES, accept: "text/html" },
    );

    if (!response || !response.ok) {
      return {
        ok: false,
        status: "degraded",
        summary: response
          ? `The Trustpilot business-unit review page answered the health probe with HTTP ${response.status}.`
          : "The Trustpilot business-unit review page did not answer the health probe.",
        errorCode: "review_site_unreachable",
      };
    }

    return {
      ok: true,
      status: "healthy",
      summary: "Trustpilot business-unit review-page polling is available — no account, no API key required.",
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
    const domain = resolveReviewDomain({
      targetUrl: target.targetUrl,
      targetHandle: target.targetHandle,
      metadata: target.metadata,
    }) ?? (typeof target.targetKey === "string" && target.targetKey.includes(".")
      ? target.targetKey.toLowerCase()
      : null);
    if (!domain) {
      return {
        ok: false,
        items: [],
        errorCode: "missing_review_domain",
        errorMessage: "Review-sites target has no business-unit domain to poll.",
      };
    }

    const gate = await evaluateConnectorAccessGate(ctx.env, "review_sites", ctx.trackingMode);
    if (!gate.allowed) {
      return {
        ok: false,
        items: [],
        errorCode: gate.reasonCode ?? "connector_disabled",
        errorMessage: gate.reasonMessage ?? "Review-sites connector is not enabled.",
      };
    }

    // Exactly one serialized request per poll — the whole network portion.
    const businessUnitUrl = normalizePublicHttpUrl(
      `${TRUSTPILOT_BUSINESS_UNIT_URL_BASE}/${domain}`,
    );
    if (!businessUnitUrl || businessUnitUrl.hostname !== "www.trustpilot.com") {
      return {
        ok: false,
        items: [],
        errorCode: "missing_review_domain",
        errorMessage: "The stored business-unit domain no longer resolves to a usable review page.",
      };
    }

    const fetchImpl = ctx.fetchImpl ?? fetch;
    const response = await presenceSafeFetch(businessUnitUrl.toString(), fetchImpl, {
      method: "GET",
      maxBytes: REVIEW_SITES_MAX_BYTES,
      accept: "text/html",
    });

    if (!response) {
      return {
        ok: false,
        items: [],
        errorCode: "fetch_failed",
        errorMessage: "Could not reach the Trustpilot business-unit review page.",
      };
    }

    if (!response.ok || !response.body) {
      // 4xx/5xx are honest degraded results — never fabricated items.
      // presenceSafeFetch answers non-2xx with the status alone (body: null),
      // so the surfacing is by the only evidence there is: 429 is the shared
      // rate-limit name; 403 on these surfaces IS the bot-verification
      // interstitial (AWS-WAF "Verify Connection" / DataDome — both measured;
      // the challenge fixture ships with this issue); anything else is a
      // source error.
      const errorCode =
        response.status === 429
          ? "rate_limited"
          : response.status === 403
            ? "review_site_challenge"
            : "review_site_http_error";
      return {
        ok: false,
        items: [],
        errorCode,
        errorMessage: `The Trustpilot business-unit review page responded with HTTP ${response.status}.`,
        coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
      };
    }

    const reviews = extractPublishedReviews(response.body);
    if (reviews.length === 0) {
      // A 200 that publishes no review nodes. Two honest truths, told apart
      // by what the page itself publishes: a business unit that ships its
      // aggregateRating node but no reviews yet is an HONEST EMPTY result
      // (a tracked brand nobody reviewed — the hn/linkedin precedent);
      // anything else (a challenge interstitial served with 200, a foreign
      // page) is a recorded failure. Neither fabricates a mention.
      if (hasPublishedBusinessUnit(response.body)) {
        return {
          ok: true,
          items: [],
          coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
          costUnits: 1,
        };
      }
      return {
        ok: false,
        items: [],
        errorCode: looksLikeChallengePage(response.body)
          ? "review_site_challenge"
          : "review_site_parse_failed",
        errorMessage: "The review page published no business-unit review data (schema.org/Review).",
        coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
      };
    }

    const observedAt = new Date().toISOString();
    const items: NormalizedPresenceItem[] = [];
    for (const review of reviews.slice(0, MAX_REVIEWS_PER_POLL)) {
      const normalized = await normalizeTrustpilotReview(review, domain, observedAt);
      if (normalized) {
        items.push(normalized);
      }
    }

    return {
      ok: true,
      items,
      coverageLabel: "PUBLIC_WEB_BEST_EFFORT",
      // One bounded public-web fetch per poll — budgeted either way; an
      // honestly empty review page still cost its one request.
      costUnits: 1,
      // No cursor: every poll re-reads the published page window and the
      // (source_target_id, url_hash) UNIQUE constraint dedupes the overlap.
    };
  },
};

/**
 * True when the response body carries one of the measured bot-verification
 * markers: AWS-WAF's interstitial (a7d575be72e8.edge.sdk.awswaf.com — the
 * 2026-09-14 Trustpilot measurement) or DataDome's challenge shell
 * (captcha-delivery.com — the committed 2026-09-13 G2 fixture).
 */
export function looksLikeChallengePage(body: string | null): boolean {
  if (!body) {
    return false;
  }
  return /edge\.sdk\.awswaf\.com|captcha-delivery\.com|geetest|hcaptcha|recaptcha|cf-challenge|challenge-platform/i.test(body);
}

/**
 * True when the response body carries the business unit's own published
 * aggregateRating node — the fixture-published witness that THIS response is
 * the unit's review page (a unit with zero reviews is an honest empty, not a
 * parse failure).
 */
export function hasPublishedBusinessUnit(body: string | null): boolean {
  if (!body) {
    return false;
  }
  return /"aggregateRating"|"@type":\s*"LocalBusiness"/i.test(body);
}

/**
 * Extracts the published Trustpilot review nodes from the response body's
 * own ld+json. The contract: whatever wraps it (a full HTML page or a
 * minimal stand-in — the committed fixture is the latter), the
 * `application/ld+json` script blocks decide. Every block is parsed
 * defensively; unparseable blocks are skipped, and @graph containers are
 * flattened (the published business-unit document nests its Review nodes in
 * one). Unparsable-JSON-LD bodies surface as zero reviews — the caller
 * records the honest failure.
 */
export function extractPublishedReviews(body: string): TrustpilotReviewNode[] {
  const reviews: TrustpilotReviewNode[] = [];
  const scriptBlocks = body.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of scriptBlocks) {
    let parsed: TrustpilotGraphContainer;
    try {
      parsed = JSON.parse(block[1]!.trim()) as TrustpilotGraphContainer;
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
    for (const node of nodes) {
      const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
      if (types.includes("Review")) {
        reviews.push(node as unknown as TrustpilotReviewNode);
      }
    }
  }
  return reviews;
}

/**
 * Normalizes one published review into a mention row. Only the published
 * fields travel: the review's own @id (final segment — Trustpilot's
 * published identifier) becomes the public /reviews/<uuid> permalink; the
 * 301-confirmed path (measured 2026-09-14) plus the published uuid is
 * evidence-backed, never a fabricated scheme.
 */
async function normalizeTrustpilotReview(
  review: TrustpilotReviewNode,
  domain: string,
  observedAt: string,
): Promise<NormalizedPresenceItem | null> {
  const reviewId = typeof review["@id"] === "string" ? review["@id"].split("/").pop() ?? "" : "";
  if (!/^[0-9a-f]{8,}$/i.test(reviewId)) {
    return null;
  }
  const reviewUrl = normalizePublicHttpUrl(`${TRUSTPILOT_REVIEW_URL_BASE}/${reviewId}`);
  if (!reviewUrl || reviewUrl.hostname !== "www.trustpilot.com") {
    return null;
  }

  const authorName =
    typeof review.author === "string"
      ? review.author.trim()
      : typeof review.author?.name === "string"
        ? review.author.name.trim()
        : "";
  const headline = typeof review.headline === "string" ? review.headline.trim() : "";
  const reviewBody = typeof review.reviewBody === "string" ? review.reviewBody : "";
  const publishedAt =
    typeof review.datePublished === "string" ? safeIsoDate(review.datePublished) : null;
  const ratingValue = review.reviewRating?.ratingValue;
  const rating =
    typeof ratingValue === "number" && Number.isFinite(ratingValue)
      ? ratingValue
      : typeof ratingValue === "string" && ratingValue.trim() && Number.isFinite(Number(ratingValue))
        ? Number(ratingValue)
        : null;

  const title = (headline || `Trustpilot review of ${domain}`).slice(0, MAX_REVIEW_TITLE_CHARS);
  const bodyExcerpt = reviewBody
    ? reviewBody.replace(/\s+/g, " ").trim().slice(0, MAX_REVIEW_EXCERPT_CHARS)
    : null;

  const item: NormalizedPresenceItem = {
    externalId: reviewId,
    // The public review permalink — Trustpilot's published identifier on
    // their 301-confirmed /reviews/ path; never the fixture's URL.
    canonicalUrl: reviewUrl.toString(),
    title,
    bodyExcerpt: bodyExcerpt || null,
    author: authorName || null,
    publishedAt: publishedAt ?? observedAt,
    observedAt,
    contentHash: "",
    raw: {
      kind: "trustpilot_review",
      // Free engagement signal — the star rating exactly as published.
      ratingValue: rating,
      businessUnitDomain: domain,
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

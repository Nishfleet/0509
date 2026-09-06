import { registrableDomainFromHostname } from "~/lib/search-query";

/**
 * A minimal, shape-compatible subset of `WebsiteIdentity`
 * (see ~/lib/website-identity.server.ts). The full identity is resolved by the
 * caller; `buildMentionQuery` never performs network/identity probing itself.
 */
export interface MentionQueryIdentityEnrichment {
  domainAliases?: string[];
  siteName?: string | null;
}

export type MentionSource = "reddit" | "x";

export interface TrackedEntityInput {
  label: string;
  canonicalUrl: string | null;
}

export interface RedditMentionQuery {
  source: "reddit";
  query: {
    subredditCandidates: string[];
  };
  provenance: {
    subredditCandidates: Array<{ candidate: string; probe: string }>;
  };
}

export interface XMentionQuery {
  source: "x";
  query: {
    q: string;
  };
  provenance: {
    query: { q: string; probe: string };
  };
}

export type MentionQuery = RedditMentionQuery | XMentionQuery;

const REDDIT_CANDIDATE_MAX_LENGTH = 21;
const REDDIT_LABEL_PROBE = "entity-label";
const REDDIT_DOMAIN_PROBE = "canonical-domain";
const REDDIT_ALIASES_PROBE = "website-identity-probe:aliases";

/**
 * Normalize a raw label token into a reddit subreddit-style slug: lowercase,
 * alnum + underscore with runs collapsed, leading "r/" stripped, and capped at
 * ~21 characters (subreddit names are limited to 21 chars).
 */
function normalizeSubredditCandidate(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^r\//, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) {
    return "";
  }
  return cleaned.slice(0, REDDIT_CANDIDATE_MAX_LENGTH);
}

function dedupeByCandidate(
  candidates: Array<{ candidate: string; probe: string }>,
): Array<{ candidate: string; probe: string }> {
  const seen = new Set<string>();
  const out: Array<{ candidate: string; probe: string }> = [];
  for (const entry of candidates) {
    if (entry.candidate && !seen.has(entry.candidate)) {
      seen.add(entry.candidate);
      out.push(entry);
    }
  }
  return out;
}

function registrableDomainFromUrlOrNull(canonicalUrl: string | null): string | null {
  if (!canonicalUrl) {
    return null;
  }
  try {
    const hostname = new URL(canonicalUrl).hostname;
    if (!hostname) {
      return null;
    }
    return registrableDomainFromHostname(hostname);
  } catch {
    return null;
  }
}

function buildRedditQuery(
  trackedEntity: TrackedEntityInput,
  identity?: MentionQueryIdentityEnrichment,
): RedditMentionQuery {
  const candidates: Array<{ candidate: string; probe: string }> = [];

  const labelSlug = normalizeSubredditCandidate(trackedEntity.label);
  if (labelSlug) {
    candidates.push({ candidate: labelSlug, probe: REDDIT_LABEL_PROBE });
  }

  const canonicalDomain = registrableDomainFromUrlOrNull(trackedEntity.canonicalUrl);
  if (canonicalDomain) {
    const domainSlug = normalizeSubredditCandidate(canonicalDomain);
    if (domainSlug) {
      candidates.push({ candidate: domainSlug, probe: REDDIT_DOMAIN_PROBE });
    }
  }

  for (const alias of identity?.domainAliases ?? []) {
    const aliasSlug = normalizeSubredditCandidate(alias);
    if (aliasSlug) {
      candidates.push({ candidate: aliasSlug, probe: REDDIT_ALIASES_PROBE });
    }
  }

  const provenance = dedupeByCandidate(candidates);

  return {
    source: "reddit",
    query: {
      subredditCandidates: provenance.map((entry) => entry.candidate),
    },
    provenance: {
      subredditCandidates: provenance,
    },
  };
}

function quotedTerm(term: string): string {
  return `"${term.replace(/"/g, "")}"`;
}

function buildXQuery(
  trackedEntity: TrackedEntityInput,
  identity?: MentionQueryIdentityEnrichment,
): XMentionQuery {
  const terms: string[] = [];

  const label = trackedEntity.label.trim();
  if (label) {
    terms.push(quotedTerm(label));
  }

  // Enrich the label-facing query with a known site name where available.
  const siteName = identity?.siteName?.trim();
  if (siteName) {
    terms.push(quotedTerm(siteName));
  }

  const canonicalDomain = registrableDomainFromUrlOrNull(trackedEntity.canonicalUrl);
  if (canonicalDomain) {
    terms.push(quotedTerm(canonicalDomain));
  }

  const q = terms.length > 0 ? terms.join(" OR ") : "";

  return {
    source: "x",
    query: { q },
    provenance: {
      query: { q, probe: "entity-and-canonical-domain" },
    },
  };
}

/**
 * Build a pure, synchronous mention query for a tracked entity on a given
 * source. No env, no network, no async — the same inputs always produce the
 * same output. Missing/null inputs are handled gracefully: a tracked entity
 * without a canonicalUrl still yields subreddit candidates derived from its
 * label (and from any enrichment aliases), and the x query simply omits the
 * canonical-domain term.
 *
 * Optional `identity` enrichment (shape-compatible with `WebsiteIdentity`) is
 * folded in as additional candidate provenance; this function never performs
 * the website-identity probe itself — the caller passes the result in.
 *
 * @param trackedEntity the entity label and optional canonical URL.
 * @param source the target mention source (`"reddit"` or `"x"`).
 * @param identity optional already-resolved identity enrichment.
 */
export function buildMentionQuery(
  trackedEntity: TrackedEntityInput,
  source: MentionSource,
  identity?: MentionQueryIdentityEnrichment,
): MentionQuery {
  if (source === "reddit") {
    return buildRedditQuery(trackedEntity, identity);
  }
  return buildXQuery(trackedEntity, identity);
}

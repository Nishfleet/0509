import { queryAll } from "~/lib/data/d1.server";
import { decodeHtmlEntities } from "~/lib/decode-html.server";
import type { AppEnv } from "~/lib/env.server";
import { fetchWithTimeout, promiseWithTimeout } from "~/lib/fetch-timeout.server";
import { resolvePublicHttpUrl } from "~/lib/public-url.server";
import { registrableDomainFromHostname } from "~/lib/search-query";
import { resolveWebsiteIdentity } from "~/lib/website-identity.server";

/**
 * Onboarding slice 1 identity resolution (issue #3173, epic #3172).
 *
 * ONE input — "Your website or your name". This module classifies it as a
 * domain, a person, or a brand name, then builds an instant identity card
 * plus up to 3 ranked candidates from the surfaces this repo already
 * captures: the budgeted site-identity resolver the search pipeline already
 * uses, ad rows already persisted in D1, and social links on the homepage,
 * plus a FAST web lookup with a HARD 3 s deadline. No paid identity vendor:
 * the only network call is the brand homepage itself — the same fetch the
 * search identity resolver already makes.
 *
 * The card never misses its budget: the whole live resolution runs under
 * one wall-clock deadline and the resolver ALWAYS returns a card — whatever
 * resolved in budget; the rest streams in later (the same first-card-budget
 * contract the search surface is priced on). This is what keeps the
 * "< 5 s p95 identity card" acceptance honest in the e2e harness.
 *
 * Confirming never mutates anything here: /join's confirm action folds the
 * confirmed identity forward into the EXISTING signup + setup paths
 * (#2415/#2414 prefill fold, #3045 self-inference) instead of opening a
 * parallel flow.
 */

export type JoinInputKind = "domain" | "person" | "brand";

/** Overall wall-clock budget for one card resolution (issue #3173: < 5 s p95). */
export const JOIN_IDENTITY_BUDGET_MS = 3_000;

/** Max candidates returned for an ambiguous input (issue #3173: up to 3). */
export const MAX_JOIN_CANDIDATES = 3;

const HOMEPAGE_FETCH_TIMEOUT_MS = 3_000;
const MAX_HOMEPAGE_RESPONSE_BYTES = 200_000;
const MAX_HOMEPAGE_REDIRECTS = 4;

export interface JoinMentionRef {
  title: string;
  url: string;
}

export interface JoinIdentityCard {
  kind: JoinInputKind;
  /** The raw input as typed. */
  input: string;
  name: string | null;
  logoUrl: string | null;
  site: string | null;
  /** Registrable domain when the card is (or points at) a domain. */
  domain: string | null;
  socials: string[];
  /** Ad evidence already captured in D1 (public surfaces, not a vendor). */
  adCount: number;
  adsLastSeenAt: string | null;
  /** Latest mention resolved in budget (null until the mention fan-out has data). */
  latestMention: JoinMentionRef | null;
  /** Person identity markers used for disambiguation ON the card — never a separate form. */
  handle: string | null;
  linkedinUrl: string | null;
}

export interface JoinIdentityCandidate extends JoinIdentityCard {
  /** Ranked best-first; higher is a stronger evidence match. */
  score: number;
  /** One-line evidence source ("why"). */
  evidence: string;
}

export interface JoinIdentityResolution {
  kind: JoinInputKind;
  elapsedMs: number;
  primary: JoinIdentityCard;
  candidates: JoinIdentityCandidate[];
  /**
   * True when the input is a person (or brand) with no resolvable identity —
   * the card asks for a handle / site / LinkedIn URL on the card (issue
   * #3173: persons disambiguate on the card, never a form elsewhere).
   */
  ambiguous: boolean;
  /** Card-time metrics (the time-to-first-confirm event's resolve leg). */
  metrics: {
    kind: JoinInputKind;
    elapsedMs: number;
    liveLookupAttempted: boolean;
    liveLookupTimedOut: boolean;
  };
}

const PERSON_PROFILE_HOSTS = new Set([
  "linkedin.com",
  "www.linkedin.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "www.instagram.com",
  "github.com",
  "www.github.com",
  "facebook.com",
  "www.facebook.com",
]);

const LINKEDIN_URL_PATTERN =
  /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|company)\/[A-Za-z0-9_%-]{2,80}/i;

const SOCIAL_LINK_PATTERN =
  /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|company)\/[A-Za-z0-9_%-]{2,80}|https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.]{2,64}|https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9_]{1,60}|https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/)[A-Za-z0-9_\-.]{2,80}|https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9_.]{2,60}|https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9_.-]{2,80}/gi;

/**
 * Classify the single onboarding input without any network I/O. A URL
 * (except a person-profile URL) folds to the domain path; a handle or
 * person-profile URL is a person; a bare two-or-three-word capitalized
 * name is a person; everything else is a brand name the resolver must
 * pin to a domain or track as a saved query.
 */
export function classifyJoinInput(raw: string): { kind: JoinInputKind; input: string } | null {
  const input = raw.trim();
  if (!input) {
    return null;
  }

  const url = tryParseUrl(input);
  if (url) {
    if (PERSON_PROFILE_HOSTS.has(url.hostname.toLowerCase())) {
      return { kind: "person", input };
    }
    return { kind: "domain", input };
  }

  if (input.startsWith("@") && !/\s/.test(input)) {
    return { kind: "person", input };
  }

  const words = input.split(/\s+/);
  const nameShaped =
    words.length >= 2 &&
    words.length <= 3 &&
    words.every((word) => /^[\p{Lu}][\p{L}'’.-]*$/u.test(word));

  return nameShaped ? { kind: "person", input } : { kind: "brand", input };
}

/**
 * Resolve the identity card within budget. A resolution that loses its
 * deadline still returns a card — whatever resolved in budget; the rest
 * streams in later. Only a truly empty input throws.
 */
export async function resolveJoinIdentity(
  env: AppEnv,
  raw: string,
  options: {
    budgetMs?: number;
    /** Turn off the live web lookup (e2e harness: deterministic card time). */
    liveLookup?: boolean;
  } = {},
): Promise<JoinIdentityResolution> {
  const classified = classifyJoinInput(raw);
  if (!classified) {
    throw new TypeError("resolveJoinIdentity requires a non-empty input");
  }
  const budgetMs = options.budgetMs ?? JOIN_IDENTITY_BUDGET_MS;
  const liveLookup = options.liveLookup ?? true;
  const started = Date.now();

  const outcome = liveLookup
    ? await promiseWithTimeout(resolveClassified(env, classified, true), budgetMs, "join identity budget exceeded").catch(
        () => classificationOnlyOutcome(classified),
      )
    : await resolveClassified(env, classified, false);

  const elapsedMs = Math.max(1, Date.now() - started);
  const primary = buildPrimaryCard(classified, outcome);
  const candidates = buildCandidates(outcome)
    .filter((candidate) => candidate.domain !== primary.domain || candidate.name !== primary.name)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_JOIN_CANDIDATES);

  return {
    kind: classified.kind,
    elapsedMs,
    primary,
    candidates,
    ambiguous: outcome.ambiguous,
    metrics: {
      kind: classified.kind,
      elapsedMs,
      liveLookupAttempted: outcome.liveLookupAttempted,
      liveLookupTimedOut: outcome.liveLookupTimedOut,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

export interface ResolutionOutcome {
  input: string;
  kind: JoinInputKind;
  domain: string | null;
  site: string | null;
  name: string | null;
  logoUrl: string | null;
  socials: string[];
  adCount: number;
  adsLastSeenAt: string | null;
  aliasDomains: string[];
  handle: string | null;
  linkedinUrl: string | null;
  ambiguous: boolean;
  advertiserCandidates: AdvertiserCandidate[];
  liveLookupAttempted: boolean;
  liveLookupTimedOut: boolean;
  /** Non-null when the brand probe pinned a live domain. */
  brandProbeDomain: string | null;
}

interface AdvertiserCandidate {
  name: string;
  adCount: number;
  lastSeenAt: string | null;
}

interface AdStats {
  adCount: number;
  lastSeenAt: string | null;
}

function classificationOnlyOutcome(classified: { kind: JoinInputKind; input: string }): ResolutionOutcome {
  const input = classified.input;
  return {
    kind: classified.kind,
    input,
    domain: extractDomainFromInput(input),
    site: null,
    name: null,
    logoUrl: null,
    socials: [],
    adCount: 0,
    adsLastSeenAt: null,
    aliasDomains: [],
    handle: extractHandle(input),
    linkedinUrl: extractLinkedInUrl(input),
    ambiguous: false,
    advertiserCandidates: [],
    liveLookupAttempted: false,
    liveLookupTimedOut: false,
    brandProbeDomain: null,
  };
}

async function resolveClassified(
  env: AppEnv,
  classified: { kind: JoinInputKind; input: string },
  liveLookup: boolean,
): Promise<ResolutionOutcome> {
  try {
    const base = classificationOnlyOutcome(classified);
    base.liveLookupAttempted = liveLookup;

    if (classified.kind === "domain") {
      return await resolveDomainCard(env, base, liveLookup);
    }
    if (classified.kind === "person") {
      return await resolvePersonCard(env, base, liveLookup);
    }
    return await resolveBrandCard(env, base, liveLookup);
  } catch {
    return classificationOnlyOutcome(classified);
  }
}

async function resolveDomainCard(
  env: AppEnv,
  base: ResolutionOutcome,
  liveLookup: boolean,
): Promise<ResolutionOutcome> {
  const url = tryParseUrl(base.input);
  const registrable = url ? registrableDomainFromHostname(url.hostname) : null;
  if (!url || !registrable) {
    return base;
  }

  if (!liveLookup) {
    // D1 is a local read, not a web lookup: ad evidence still resolves —
    // only the homepage/identity probes wait on the network.
    const adStats = await fetchAdStats(env, registrable).catch(() => EMPTY_AD_STATS);
    return {
      ...base,
      kind: "domain",
      domain: registrable,
      site: url.toString(),
      adCount: adStats.adCount,
      adsLastSeenAt: adStats.lastSeenAt,
    };
  }

  const [homepageProbe, adStats, identity] = await Promise.all([
    probeHomepage(url).catch(() => null),
    fetchAdStats(env, registrable).catch(() => EMPTY_AD_STATS),
    resolveWebsiteIdentity(url.toString()).catch(() => null),
  ]);

  const identityCanonical = identity?.canonicalUrl ?? null;
  const canonicalSite = identityCanonical ? orNullTryUrl(identityCanonical) : null;

  return {
    ...base,
    kind: "domain",
    domain: registrable,
    site: homepageProbe?.resolvedUrl ?? canonicalSite ?? url.toString(),
    name: homepageProbe?.siteName ?? identity?.siteName ?? identity?.title ?? null,
    logoUrl: homepageProbe?.logoUrl ?? null,
    socials: homepageProbe?.socials ?? [],
    adCount: adStats.adCount,
    adsLastSeenAt: adStats.lastSeenAt,
    aliasDomains: identity?.domainAliases ?? [],
    ambiguous: false,
    liveLookupTimedOut: homepageProbe?.timedOut ?? false,
  };
}

/**
 * Persons are never resolved by a paid vendor: name evidence comes from the
 * advertiser catalog already captured (a creator who runs ads), and
 * disambiguation happens via the handle / site / LinkedIn markers rendered
 * ON the card itself.
 */
async function resolvePersonCard(
  env: AppEnv,
  base: ResolutionOutcome,
  liveLookup: boolean,
): Promise<ResolutionOutcome> {
  const terms = new Set<string>();
  if (base.handle) {
    terms.add(base.handle);
  }
  const bareName = base.input.replace(/^@/, "").replace(/\s+/g, " ").trim();
  if (bareName && bareName !== base.handle) {
    terms.add(bareName);
  }

  const advertiserCandidates = await fetchAdvertiserCandidates(env, [...terms]).catch(() => []);

  const hasIdentityMarker = Boolean(base.handle ?? base.linkedinUrl);
  return {
    ...base,
    kind: "person",
    name: base.handle ?? bareName,
    adCount: advertiserCandidates.reduce((max, row) => Math.max(max, row.adCount), 0),
    adsLastSeenAt: advertiserCandidates[0]?.lastSeenAt ?? null,
    advertiserCandidates,
    liveLookupAttempted: liveLookup && terms.size > 0,
    // A bare person name is ambiguous on purpose: the card asks for a
    // handle / site / LinkedIn URL to disambiguate — never a form page.
    ambiguous: !hasIdentityMarker && advertiserCandidates.length === 0,
  };
}

async function resolveBrandCard(
  env: AppEnv,
  base: ResolutionOutcome,
  liveLookup: boolean,
): Promise<ResolutionOutcome> {
  const advertiserCandidates = await fetchAdvertiserCandidates(env, [base.input]).catch(() => []);

  if (!liveLookup) {
    return { ...base, kind: "brand", name: base.input, ambiguous: false };
  }

  // The fast web lookup: the plain .com form of the brand name, one bounded
  // homepage probe — never multi-engine, never paid.
  const slug = brandSlug(base.input);
  const probeUrl = slug.length >= 3 ? tryParseUrl(`${slug}.com`) : null;
  const homepageProbe = probeUrl ? await probeHomepage(probeUrl).catch(() => null) : null;
  const pinnedDomain = homepageProbe?.ok
    ? registrableDomainFromHostname(new URL(homepageProbe.resolvedUrl).hostname)
    : null;

  return {
    ...base,
    kind: "brand",
    name: base.input,
    site: homepageProbe?.ok ? homepageProbe.resolvedUrl : null,
    domain: pinnedDomain,
    logoUrl: homepageProbe?.logoUrl ?? null,
    socials: homepageProbe?.socials ?? [],
    adCount: advertiserCandidates.reduce((max, row) => Math.max(max, row.adCount), 0),
    adsLastSeenAt: advertiserCandidates[0]?.lastSeenAt ?? null,
    advertiserCandidates,
    ambiguous: false,
    liveLookupTimedOut: homepageProbe?.timedOut ?? false,
    brandProbeDomain: pinnedDomain,
  };
}

const EMPTY_AD_STATS: AdStats = { adCount: 0, lastSeenAt: null };

/**
 * Ad evidence for a domain from the ads already captured in D1 — the public
 * capture surfaces, not a paid identity vendor. A fresh brand usually has 0
 * rows; the card then says exactly that instead of pretending coverage.
 */
export async function fetchAdStats(env: AppEnv, registrableDomain: string): Promise<AdStats> {
  const rows = await queryAll<AdStatsRow>(
    env,
    `SELECT COUNT(*) AS ad_count, MAX(last_seen_at) AS last_seen
       FROM ad
      WHERE landing_page_url LIKE ? ESCAPE '\\'
        AND is_active = 1`,
    `%${escapeLikePattern(registrableDomain)}%`,
  );
  const row = rows[0];
  return {
    adCount: Number(row?.ad_count ?? 0),
    lastSeenAt: row?.last_seen ?? null,
  };
}

interface AdStatsRow {
  ad_count: number | string;
  last_seen: string | null;
}

/** Name matches against the captured advertiser catalog, ranked by ad volume. */
export async function fetchAdvertiserCandidates(
  env: AppEnv,
  terms: string[],
): Promise<AdvertiserCandidate[]> {
  const matched: AdvertiserCandidate[] = [];
  for (const term of terms) {
    const trimmed = term.trim();
    if (trimmed.length < 3) {
      continue;
    }
    const rows = await queryAll<AdvertiserRow>(
      env,
      `SELECT advertiser, COUNT(*) AS ad_count, MAX(last_seen_at) AS last_seen
         FROM ad
        WHERE advertiser LIKE ? ESCAPE '\\'
          AND is_active = 1
        GROUP BY advertiser
        ORDER BY ad_count DESC, last_seen DESC
        LIMIT 3`,
      `%${escapeLikePattern(trimmed)}%`,
    );
    for (const row of rows) {
      if (!matched.some((existing) => existing.name === row.advertiser)) {
        matched.push({ name: row.advertiser, adCount: Number(row.ad_count), lastSeenAt: row.last_seen });
      }
    }
  }
  // Re-rank in JS so the helper's contract never depends on SQL ORDER BY
  // surviving a provider quirk.
  matched.sort((a, b) => b.adCount - a.adCount);
  return matched.slice(0, MAX_JOIN_CANDIDATES);
}

interface AdvertiserRow {
  advertiser: string;
  ad_count: number | string;
  last_seen: string | null;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

interface HomepageProbe {
  resolvedUrl: string;
  siteName: string | null;
  logoUrl: string | null;
  socials: string[];
  timedOut: boolean;
  ok: boolean;
}

/**
 * One bounded homepage fetch that walks redirect hops through the same
 * public-URL safety guard the search identity resolver uses, then extracts
 * the card's fast facts: site name, logo, social profile links. Never
 * throws: an unusable page returns a probe with `ok: false`, a never-
 * connecting fetch returns `timedOut: true` so the card can say "still
 * scanning" instead of stalling the flow.
 */
async function probeHomepage(startUrl: URL): Promise<HomepageProbe | null> {
  let currentUrl = await resolvePublicHttpUrl(startUrl.toString());
  let connected = false;

  for (let redirects = 0; currentUrl && redirects <= MAX_HOMEPAGE_REDIRECTS; redirects += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        currentUrl.toString(),
        {
          redirect: "manual",
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent": "0509-join-identity/1.0",
          },
        },
        { timeoutMs: HOMEPAGE_FETCH_TIMEOUT_MS },
      );
    } catch {
      if (connected) {
        return probeFromUrl(currentUrl, { ok: true, timedOut: false });
      }
      return probeFromUrl(currentUrl, { ok: false, timedOut: true });
    }

    try {
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        currentUrl = location ? orNullRedirect(location, currentUrl) : null;
        continue;
      }

      if (response.ok) {
        connected = true;
        const html = (await response.text()).slice(0, MAX_HOMEPAGE_RESPONSE_BYTES);
        return probeFromHtml(html, currentUrl);
      }

      return probeFromUrl(currentUrl, { ok: true, timedOut: false });
    } finally {
      void response.body?.cancel().catch(() => undefined);
    }
  }

  return null;
}

interface ProbeFacts {
  ok: boolean;
  timedOut: boolean;
}

function probeFromUrl(url: URL, facts: ProbeFacts): HomepageProbe {
  return { resolvedUrl: url.toString(), siteName: null, logoUrl: null, socials: [], ...facts };
}

function probeFromHtml(html: string, url: URL): HomepageProbe {
  const siteName = extractMetaContent(html, "og:site_name");
  const logoUrl = extractMetaContent(html, "og:logo") ?? extractLinkRelIcon(html);
  return {
    resolvedUrl: url.toString(),
    siteName: siteName ? decodeHtmlEntities(siteName) : null,
    logoUrl: logoUrl ? orNullTryUrl(logoUrl, url) : null,
    socials: extractSocials(html),
    ok: true,
    timedOut: false,
  };
}

function orNullRedirect(value: string, base: URL): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function orNullTryUrl(value: string, base?: URL): string | null {
  try {
    return base ? new URL(value, base).toString() : new URL(value).toString();
  } catch {
    return null;
  }
}

function extractSocials(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(SOCIAL_LINK_PATTERN)) {
    found.add(match[0]);
  }
  return [...found].slice(0, 8);
}

/** Static property constants with prebuilt patterns: no runtime RegExp()
 * from untrusted input (sgscan detect-non-literal-regexp: ReDoS surface). */
const META_SITE_NAME_PATTERN = /<meta[^>]*(?:property|name)=["']og:site_name["'][^>]*content=["']([^"']+)["']|<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:site_name["']/i;
const META_LOGO_PATTERN = /<meta[^>]*(?:property|name)=["']og:logo["'][^>]*content=["']([^"']+)["']|<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:logo["']/i;
const META_CONTENT_PATTERNS: Record<string, RegExp> = {
  "og:site_name": META_SITE_NAME_PATTERN,
  "og:logo": META_LOGO_PATTERN,
};

/** Only the two prebuilt properties are called today; the fallback keeps
 * future call sites working. */
type MetaPropertyName = keyof typeof META_CONTENT_PATTERNS;

/** Property must be one of the prebuilt pattern keys (compile-time
 * constants only — no regex is ever built from request data). */
function extractMetaContent(html: string, property: MetaPropertyName): string | null {
  const match = html.match(META_CONTENT_PATTERNS[property]);
  const value = match?.[1] ?? match?.[2] ?? null;
  return value && value.trim().length > 0 ? value.trim() : null;
}

function extractLinkRelIcon(html: string): string | null {
  const tags = html.match(/<link[^>]+>/gi);
  if (!tags) {
    return null;
  }
  for (const tag of tags) {
    if (!/rel=["'][^"']*icon[^"']*["']/i.test(tag)) {
      continue;
    }
    const href = tag.match(/href=["']([^"']+)["']/i);
    if (href?.[1]) {
      return href[1];
    }
  }
  return null;
}


function extractDomainFromInput(input: string): string | null {
  const url = tryParseUrl(input);
  return url ? registrableDomainFromHostname(url.hostname) : null;
}

function extractLinkedInUrl(input: string): string | null {
  return input.match(LINKEDIN_URL_PATTERN)?.[0] ?? null;
}

function extractHandle(input: string): string | null {
  const trimmed = input.trim();
  return /^@[A-Za-z0-9_.]{2,30}$/.test(trimmed) ? trimmed.slice(1) : null;
}

function brandSlug(input: string): string {
  return input
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 40);
}

function tryParseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Card + candidate builders                                           */
/* ------------------------------------------------------------------ */

function buildPrimaryCard(
  classified: { kind: JoinInputKind; input: string },
  outcome: ResolutionOutcome,
): JoinIdentityCard {
  return {
    kind: outcome.kind,
    input: classified.input,
    name: outcome.name ?? classified.input,
    logoUrl: outcome.logoUrl,
    site: outcome.site,
    domain: outcome.domain ?? extractDomainFromInput(classified.input),
    socials: outcome.socials,
    adCount: outcome.adCount,
    adsLastSeenAt: outcome.adsLastSeenAt,
    latestMention: null,
    handle: outcome.handle,
    linkedinUrl: outcome.linkedinUrl,
  };
}

function buildCandidates(outcome: ResolutionOutcome): JoinIdentityCandidate[] {
  const candidates: JoinIdentityCandidate[] = [];

  for (const alias of outcome.aliasDomains) {
    candidates.push(
      candidateBase(outcome, {
        kind: "domain",
        name: outcome.name,
        domain: alias,
        site: `https://${alias}`,
        adCount: 0,
        score: 1,
        evidence: "other domain the brand's own site points at (redirect/canonical)",
      }),
    );
  }

  if (outcome.brandProbeDomain) {
    candidates.push(
      candidateBase(outcome, {
        kind: "domain",
        name: outcome.name,
        domain: outcome.brandProbeDomain,
        site: outcome.site,
        adCount: outcome.adCount,
        logoUrl: outcome.logoUrl,
        score: 3,
        evidence: `${brandSlug(outcome.input)}.com resolves live (fast web lookup, 3 s cap)`,
      }),
    );
  }

  for (const row of outcome.advertiserCandidates) {
    candidates.push(
      candidateBase(outcome, {
        kind: outcome.handle || outcome.linkedinUrl ? "person" : "brand",
        name: row.name,
        domain: null,
        site: null,
        adCount: row.adCount,
        adsLastSeenAt: row.lastSeenAt,
        score: 2 + Math.min(0.9, row.adCount / 50),
        evidence:
          row.adCount > 0
            ? `${row.adCount} ad${row.adCount === 1 ? "" : "s"} captured for “${row.name}”${
                row.lastSeenAt ? ` — last seen ${row.lastSeenAt.slice(0, 10)}` : ""
              }`
            : `“${row.name}” in the captured advertiser catalog`,
      }),
    );
  }

  return candidates;
}

function candidateBase(
  outcome: ResolutionOutcome,
  overrides: {
    kind: JoinInputKind;
    name: string | null;
    domain: string | null;
    site: string | null;
    adCount: number;
    adsLastSeenAt?: string | null;
    logoUrl?: string | null;
    score: number;
    evidence: string;
  },
): JoinIdentityCandidate {
  return {
    input: outcome.input,
    name: overrides.name,
    logoUrl: overrides.logoUrl ?? null,
    site: overrides.site,
    domain: overrides.domain,
    socials: outcome.socials,
    adCount: overrides.adCount ?? 0,
    adsLastSeenAt: overrides.adsLastSeenAt ?? outcome.adsLastSeenAt,
    latestMention: null,
    handle: outcome.handle,
    linkedinUrl: outcome.linkedinUrl,
    score: overrides.score,
    evidence: overrides.evidence,
  };
}

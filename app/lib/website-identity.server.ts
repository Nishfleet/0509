import { decodeHtmlEntities } from "~/lib/decode-html.server";
import { fetchWithTimeout, releaseFetchTimeout } from "~/lib/fetch-timeout.server";
import { resolvePublicHttpUrl, resolvePublicRedirectUrl } from "~/lib/public-url.server";
import { registrableDomainFromHostname } from "~/lib/search-query";
import { stripScriptAndStyle } from "~/lib/sanitize-text.server";

export interface WebsiteIdentity {
  registrableDomain: string;
  canonicalUrl: string | null;
  title: string | null;
  siteName: string | null;
  aliases: string[];
  /**
   * Other registrable domains proven to be the same site: hosts seen on the
   * redirect chain or in the HTML canonical. mamaearth.com → mamaearth.in
   * is the load-bearing case. Brand names stay in `aliases`; these are hosts.
   */
  domainAliases: string[];
  /**
   * The brand's numeric Meta Page id, when curated. Scopes the provider
   * search to that exact page (`view_all_page_id`) instead of a keyword
   * query, so the brand's own ads surface instead of keyword junk. The
   * matcher still verifies each ad lands on the brand's domain — a curated
   * page id never fabricates a verified row, it only asks the provider the
   * right question (issue #1982). Optional so legacy fixtures that predate
   * the field still type-check; production always sets it via `?? null`.
   */
  advertiserPageId?: string | null;
  resolvedAt: string;
}

const MAX_IDENTITY_FETCH_REDIRECTS = 5;
const MAX_IDENTITY_RESPONSE_BYTES = 250_000;
const IDENTITY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const IDENTITY_FETCH_TIMEOUT_MS = 10_000;
/**
 * Overall wall-clock budget for ONE live identity resolution (issue #2870).
 *
 * The per-request fetch timeout is 10 s and a redirect chain pays a
 * DNS-over-HTTPS lookup (up to 5 s) plus a fetch (up to 10 s) on EVERY hop,
 * so a slow/bot-walled brand homepage could legally spend 40+ s inside
 * `buildSearchV2Context` — which runs BEFORE the search-result cache read.
 * Live 2026-09-11: cache=hit searches for allianz.com / freshworks.com /
 * reliance.com / ridge.com delivered their first card at 26-42 s (BET 2
 * p95 42 s against a 5 s budget) purely on a cold-isolate identity miss.
 *
 * When the live fetch exceeds this budget the search stops waiting and
 * falls back to the curated-only identity (`applyIdentityOverride(null, …)`),
 * the same fallback a bot-blocked homepage already gets. The timeout result
 * is cached for the normal TTL, so the cost is paid at most once per domain
 * per isolate lifetime. This is not the streaming fix (#2403 owns the
 * pre-warm path); it bounds the blocking segment the BET 2 first-card p95
 * is priced from.
 */
export const IDENTITY_RESOLVE_DEADLINE_MS = 2_500;

/**
 * Curated identity facts for brands whose homepages cannot be fetched for
 * identity resolution (a CDN that bot-blocks the crawler with a 403, e.g.
 * goat.com) or whose domain-alias relationship is not discoverable from the
 * redirect chain alone (on.com vs the on-running.com host its ads still use).
 *
 * These are NOT synthetic Meta coverage — they never classify a row as
 * verified. They only feed discovery so the search-v2 pipeline can ask the
 * provider the right question and connect ads that land on the brand's alias
 * host to the searched domain. A brand that genuinely runs no Meta ads still
 * renders no verified/likely rows and never ships a page — the "never force a
 * page" rule is preserved by the matcher.
 *
 * The provider question itself is the registrable domain (issue #1999) unless
 * an entry curates `providerQuery`, which is only needed when the registrable
 * domain is not a term Meta indexes at all (a country storefront that
 * redirects onto the brand's primary host, issue #2233).
 */
const IDENTITY_OVERRIDES: Record<
  string,
  {
    siteName?: string;
    domainAliases?: string[];
    advertiserPageId?: string;
    providerQuery?: string;
  }
> = {
  // GOAT's marketplace CDN returns 403 to scripted fetches regardless of the
  // user-agent (even a full browser UA), so live identity resolution cannot
  // read its homepage. The sneaker-resale seed list names the brand "GOAT";
  // the curated siteName is the matching alias the post-fetch classifier uses
  // to connect GOAT's ads to a searched goat.com. The provider query itself
  // is the registrable domain goat.com (issue #1999), not this alias. The
  // curated name also wins over a live one if the CDN ever unblocks, by design
  // (see applyIdentityOverride pin).
  //
  // The curated Meta Page id (facebook.com/goatapp) scopes the provider search
  // to GOAT's own page so its ~69 ads landing on goat.com surface instead of
  // the ~39k keyword-junk rows a bare "GOAT" keyword query returns (issue
  // #1982). The matcher still verifies each ad lands on goat.com — a curated
  // page id never fabricates a verified row.
  "goat.com": { siteName: "GOAT", advertiserPageId: "746493592053334" },
  // On runs its ads across both on.com and its long-standing on-running.com
  // host (on-running.com now redirects into www.on.com). The live redirect
  // chain for on.com never touches on-running.com, so the alias is not
  // discoverable and On ads landing on on-running.com would not connect to a
  // searched on.com. The 2-char stem "on" also falls under the matcher's
  // stem-extension floor, so this alias is the load-bearing link.
  //
  // on.com's live og:site_name is "On Shop" (not "On"), so trusting the live
  // fetch leaves the matching alias on "On Shop" — a shop label, not the
  // advertiser page. The curated site name pins the matching alias to "On"
  // the same way goat.com's does. The provider query itself is the registrable
  // domain on.com (issue #1999), not this alias — live 2026-09-09 evidence
  // showed website=on.com asked Meta for "On Shop" and returned 0 verified
  // rows while q=on.com returned 30.
  //
  // The curated Meta Page id (facebook.com/On) scopes the provider search to
  // On's own page so its ~5,500 ads landing on on.com surface instead of the
  // generic keyword junk a bare "On" query returns (issue #1982). The matcher
  // still verifies each ad lands on on.com/on-running.com.
  "on.com": {
    siteName: "On",
    domainAliases: ["on-running.com"],
    advertiserPageId: "238939146624",
  },
  // Reebok is a major global Meta advertiser, but its Shopify-hosted homepage
  // is bot-blocked for the scripted production crawler (like goat.com), so
  // live identity resolution cannot read a site name. The curated site name
  // is the matching alias the post-fetch classifier uses; the provider query
  // is the registrable domain reebok.com (issue #1999). The curated name also
  // wins over a live one if the block lifts, by design (see
  // applyIdentityOverride pin).
  "reebok.com": { siteName: "Reebok" },
  // Ridge (issue #2012). ridge.com is the buyer-typed domain, but Ridge's ads
  // land on the product domain ridgewallet.com (and regional variants like
  // ridgewallet.eu). The live redirect chain from ridge.com never touches a
  // ridgewallet host, so the alias is not discoverable, and the stem-extension
  // matcher cannot bridge it either: "ridgewallet" is a stem extension of
  // "ridge" only on the SAME generic TLD (ridge.com vs ridgewallet.com works,
  // but a ridgewallet.eu landing fails the .com suffix check). The /ads/:domain
  // publish layer already resolves ridge.com -> ridgewallet.com (issue #1446
  // canonical aliases), so coverage exists — the search surface just could not
  // connect it, dead-ending a §1.8 money-path brand. The curated aliases feed
  // the same audited-alias path on.com uses. The curated site name is the
  // matching alias the post-fetch classifier uses; the provider query is the
  // registrable domain ridge.com (issue #1999), not this alias.
  "ridge.com": { siteName: "Ridge", domainAliases: ["ridgewallet.com", "ridgewallet.eu"] },
  // Zappos (issue #2059). zappos.com is the buyer-typed domain, but Zappos's
  // 13 verified Meta ads all land on the www host (www.zappos.com). The live
  // apex homepage fetch does not surface that host in its redirect chain, so
  // the alias is not discoverable, and without a curated site name the
  // provider query degenerates — a bare website=zappos.com search settles on
  // "No verified ads found for zappos.com" while q=zappos.com returns 13
  // verified rows, and /ads/zappos.com refuses to publish. Same audited-alias
  // rail as on.com/ridge.com; the curated site name is the matching alias the
  // post-fetch classifier uses; the provider query is the registrable domain
  // zappos.com (issue #1999), not this alias.
  "zappos.com": { siteName: "Zappos", domainAliases: ["www.zappos.com"] },
  // Saucony UK (issue #2233). saucony.co.uk is the buyer-typed UK storefront,
  // but it 302s onto the US host (https://saucony.co.uk ->
  // https://www.saucony.com/UK/en_GB/home/), so the brand's Meta ads land on
  // saucony.com and never on the .co.uk host itself.
  //
  // The #1999 rule asks Meta for the registrable domain, which is the right
  // question for a .com brand that prints its domain in its ads. It is the
  // wrong question when the registrable domain is a country storefront Meta
  // has never indexed: live 2026-09-10, website=saucony.co.uk asked Meta for
  // "saucony.co.uk" and settled on a confirmed "No verified ads found for
  // saucony.co.uk" (0 rows) while q=saucony returned 9 verified rows. The
  // canary was green on saucony.co.uk (8-9 verified rows) in all 39 runs
  // before #1999 shipped and red on it in every run after.
  //
  // TCS (issue #2870). tcs.com is a recognisable brand that dead-ended the
  // BET 2 25-domain check: live 2026-09-11, website=tcs.com settled on a
  // confirmed 0-row empty state while q="Tata Consultancy Services" returned
  // 7 real TCS Meta ads ("TCS Rural IT Quiz") — Meta indexes the full brand
  // name, never the bare "TCS" acronym (q=TCS returned 0 rows too) or the
  // registrable domain tcs.com. The curated term is the question Meta
  // answers; the curated site name is the matching alias so those rows
  // classify as LIKELY (advertiser name match) instead of collapsing back
  // to an empty page. The matcher still verifies each ad's landing page —
  // a curated term never fabricates a verified row.
  "tcs.com": {
    siteName: "Tata Consultancy Services",
    providerQuery: "Tata Consultancy Services",
  },
  // The curated brand term is the query Meta actually indexes, exactly as
  // ridge.com/zappos.com curate the alias facts that connect their ads. It
  // does not loosen the matcher: a row is still verified only by its landing
  // page. No alias or site name is curated here because none is needed —
  // www.saucony.com and saucony.co.uk share the folded label "saucony", which
  // hostnamesMatchBrandCollapsedLabel already connects, and the live redirect
  // chain supplies saucony.com as a resolved alias as well.
  "saucony.co.uk": { providerQuery: "Saucony" },
};

const identityCache = new Map<string, { expiresAt: number; identity: WebsiteIdentity | null }>();

export async function resolveWebsiteIdentity(domainUrl: string): Promise<WebsiteIdentity | null> {
  const safeUrl = await resolvePublicHttpUrl(domainUrl.startsWith("http") ? domainUrl : `https://${domainUrl}`);
  if (!safeUrl) {
    return null;
  }

  const registrableDomain = registrableDomainFromHostname(safeUrl.hostname);
  if (!registrableDomain) {
    return null;
  }

  const cached = identityCache.get(registrableDomain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.identity;
  }

  const livePromise = fetchWebsiteIdentity(safeUrl, registrableDomain).catch(
    () => null,
  );
  // Race the live chain against the overall deadline (issue #2870). The
  // deadline loser falls back to the curated-only identity — the same
  // fallback a hard-failed fetch already takes — and the loser's promise is
  // drained so a late rejection can never surface as an unhandled one.
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const live = await Promise.race([
    livePromise,
    new Promise<null>((resolveDeadline) => {
      deadlineTimer = setTimeout(
        () => resolveDeadline(null),
        IDENTITY_RESOLVE_DEADLINE_MS,
      );
    }),
  ]);
  clearTimeout(deadlineTimer);
  void livePromise.then(() => undefined, () => undefined);

  const identity = applyIdentityOverride(await live, registrableDomain);
  identityCache.set(registrableDomain, {
    identity,
    expiresAt: Date.now() + IDENTITY_CACHE_TTL_MS,
  });

  return identity;
}

/**
 * Merge the curated `IDENTITY_OVERRIDES` facts into the live-resolved identity.
 *
 * When the live fetch succeeded but missed a known alias (on.com), the
 * override is added to `domainAliases`. When the live fetch failed entirely —
 * a bot-blocked CDN (goat.com) or any other unreachable homepage — a curated
 * site name still gives the post-fetch classifier the right matching alias.
 * The Meta provider query is the registrable domain (issue #1999), not the
 * site name, except where an entry curates `providerQuery` (issue #2233).
 * Curated facts never fabricate a verified row; the brand must genuinely run
 * Meta ads landing on its own domain for the matcher to classify one.
 */
function applyIdentityOverride(
  live: WebsiteIdentity | null,
  registrableDomain: string,
): WebsiteIdentity | null {
  const override = IDENTITY_OVERRIDES[registrableDomain];
  if (!override) {
    return live;
  }

  const domainAliases = live?.domainAliases ?? [];
  const mergedDomainAliases = [...new Set([...domainAliases, ...(override.domainAliases ?? [])])];

  const overrideSiteName = override.siteName ?? null;
  // The curated name wins as the matching alias: on.com's live og:site_name
  // is "On Shop" — a shop label, not the advertiser page. A live site name
  // must not displace the curated brand term (issue #1993). The Meta query
  // itself is the registrable domain (issue #1999), or the entry's curated
  // providerQuery — not this alias.
  const siteName = overrideSiteName ?? live?.siteName ?? null;
  if (!live && !siteName && mergedDomainAliases.length === 0) {
    return null;
  }

  // A curated site name supplies an identity alias even though the homepage
  // could not be fetched (bot-blocked CDN).
  const baseAliases = new Set(live ? live.aliases : []);
  if (overrideSiteName) {
    baseAliases.add(overrideSiteName);
  }

  return {
    registrableDomain,
    canonicalUrl: live?.canonicalUrl ?? null,
    title: live?.title ?? null,
    siteName,
    aliases: siteName ? [...new Set([...baseAliases, siteName])] : [...baseAliases],
    domainAliases: mergedDomainAliases,
    advertiserPageId: override.advertiserPageId ?? null,
    resolvedAt: live?.resolvedAt ?? new Date().toISOString(),
  };
}

export function clearWebsiteIdentityCacheForTests() {
  identityCache.clear();
}

/**
 * Sync lookup of a curated Meta Page id for a registrable domain, without
 * a network fetch. Used by the /ads/:domain loader and sitemap to re-derive
 * the same page-scoped cache key the publisher wrote, so the page renders
 * and the sitemap lists it (issue #1982). Returns null when no curated id
 * exists (the common case).
 */
export function getCuratedAdvertiserPageId(registrableDomain: string): string | null {
  return IDENTITY_OVERRIDES[registrableDomain]?.advertiserPageId ?? null;
}

/**
 * Sync lookup of a curated Meta Ad Library query term for a registrable
 * domain, without a network fetch. Used by the search-v2 query builder so a
 * country storefront Meta has never indexed (saucony.co.uk) still asks the
 * provider the term it indexes (the brand name) instead of its own host,
 * which returns nothing (issue #2233). Returns null when no curated term
 * exists — the common case, where the registrable domain is the right
 * question (issue #1999).
 */
export function getCuratedProviderQuery(registrableDomain: string): string | null {
  return IDENTITY_OVERRIDES[registrableDomain]?.providerQuery ?? null;
}

async function fetchWebsiteIdentity(safeUrl: URL, registrableDomain: string): Promise<WebsiteIdentity | null> {
  let currentUrl: URL | null = safeUrl;
  const domainAliases = new Set<string>();

  for (let redirects = 0; currentUrl && redirects <= MAX_IDENTITY_FETCH_REDIRECTS; redirects += 1) {
    const resolved = await resolvePublicHttpUrl(currentUrl);
    if (!resolved) {
      return null;
    }
    addDomainAlias(domainAliases, resolved.hostname, registrableDomain);

    let response: Response;
    try {
      response = await fetchWithTimeout(
        resolved.toString(),
        {
          redirect: "manual",
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent": "0509-search-identity/1.0",
          },
        },
        { timeoutMs: IDENTITY_FETCH_TIMEOUT_MS },
      );
    } catch {
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      const redirected = resolvePublicRedirectUrl(response.headers.get("location"), resolved);
      releaseFetchTimeout(response);
      currentUrl = redirected ? new URL(redirected) : null;
      continue;
    }

    if (!response.ok) {
      releaseFetchTimeout(response);
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      releaseFetchTimeout(response);
      return null;
    }

    const html = await readIdentityHtmlPrefix(response, MAX_IDENTITY_RESPONSE_BYTES).catch(() => null);
    if (!html) {
      return null;
    }

    const title = extractTagContent(html, "title");
    const siteName =
      extractMetaContent(html, "og:site_name") ??
      extractMetaContent(html, "application-name") ??
      extractJsonLdOrganizationName(html);
    const canonical = extractCanonicalUrl(html, resolved);
    if (canonical) {
      try {
        addDomainAlias(domainAliases, new URL(canonical).hostname, registrableDomain);
      } catch {
        // Canonical is best-effort; a malformed URL must not fail identity.
      }
    }

    const aliases = new Set<string>();
    if (siteName) {
      aliases.add(siteName.trim());
    }
    if (title) {
      aliases.add(title.trim());
    }

    return {
      registrableDomain,
      canonicalUrl: canonical,
      title,
      siteName,
      aliases: [...aliases].filter(Boolean),
      domainAliases: [...domainAliases],
      advertiserPageId: null,
      resolvedAt: new Date().toISOString(),
    };
  }

  return null;
}

function addDomainAlias(aliases: Set<string>, hostname: string, originRegistrable: string) {
  const hopRegistrable = registrableDomainFromHostname(hostname);
  if (hopRegistrable && hopRegistrable !== originRegistrable) {
    aliases.add(hopRegistrable);
  }
}

function tagContentPatternForTag(tagName: string): RegExp | null {
  switch (tagName) {
    case "title":
      return /<title[^>]*>([\s\S]*?)<\/title>/i;
    default:
      return null;
  }
}

/** Extract inner text of allowlisted HTML tags. Unknown tags, including
 * those that contain regex metacharacters, return null. */
export function extractTagContent(html: string, tagName: string) {
  const pattern = tagContentPatternForTag(tagName);
  if (pattern === null) return null;
  const match = html.match(pattern);
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? null;
}

function extractMetaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1].trim());
    }
  }

  return null;
}

/**
 * Read an HTML body for identity resolution, bounded to `maxBytes`, WITHOUT
 * failing when the page is larger than the cap.
 *
 * A modern brand homepage routinely streams far more markup than this cap
 * (on.com ~620 KB, reebok.com ~1.5 MB decoded) — the previous
 * `readResponseTextWithinLimit` cancelled the stream and returned null the
 * instant the running total exceeded `maxBytes`, so any oversized homepage
 * failed the WHOLE identity resolution. Identity feeds the provider query
 * term and the alias sets, so a null here left on.com/reebok.com on the bare
 * domain label ("on", "reebok"), surfacing keyword junk instead of the
 * brand's own ads and blocking their /ads pages.
 *
 * The signals identity resolution needs — <title>, the <link rel=canonical>,
 * and the meta / JSON-LD organization name — all live in the <head>, which is
 * squarely inside even a modest cap. So truncating at the cap and parsing the
 * PREFIX is safe: we keep the read bounded (the whole point of the cap) while
 * still extracting identity from an oversized page instead of bailing.
 */
async function readIdentityHtmlPrefix(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) {
    try {
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer.slice(0, maxBytes));
      return bytes.length > 0 ? new TextDecoder().decode(bytes) : null;
    } finally {
      releaseFetchTimeout(response);
    }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      const remaining = maxBytes - totalBytes;
      if (remaining <= 0) {
        break;
      }
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        totalBytes += remaining;
        break;
      }
      totalBytes += value.byteLength;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    releaseFetchTimeout(response);
  }

  if (totalBytes === 0) {
    return null;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

function extractCanonicalUrl(html: string, baseUrl: URL) {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  if (!match?.[1]) {
    return baseUrl.toString();
  }

  try {
    const canonical = new URL(match[1], baseUrl);
    return canonical.toString();
  } catch {
    return baseUrl.toString();
  }
}

function extractJsonLdOrganizationName(html: string) {
  const pattern =
    /<script\b(?:[^>"']|"[^"]*"|'[^']*')*type=["']application\/ld\+json["'](?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/script\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const payload = stripScriptAndStyle(match[1] ?? "").trim();
    try {
      const parsed = JSON.parse(payload) as { name?: string; "@type"?: string };
      if (typeof parsed.name === "string" && (!parsed["@type"] || /organization/i.test(parsed["@type"]))) {
        return parsed.name.trim();
      }
    } catch {
      continue;
    }
  }

  return null;
}

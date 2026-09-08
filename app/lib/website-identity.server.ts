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
  resolvedAt: string;
}

const MAX_IDENTITY_FETCH_REDIRECTS = 5;
const MAX_IDENTITY_RESPONSE_BYTES = 250_000;
const IDENTITY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const IDENTITY_FETCH_TIMEOUT_MS = 10_000;

/**
 * Curated identity facts for brands whose homepages cannot be fetched for
 * identity resolution (a CDN that bot-blocks the crawler with a 403, e.g.
 * goat.com) or whose domain-alias relationship is not discoverable from the
 * redirect chain alone (on.com vs the on-running.com host its ads still use).
 *
 * These are NOT synthetic Meta coverage — they never classify a row as
 * verified. They only feed discovery so the search-v2 pipeline can ask the
 * provider the right question (the brand/site name) and connect ads that land
 * on the brand's alias host to the searched domain. A brand that genuinely
 * runs no Meta ads still renders no verified/likely rows and never ships a
 * page — the "never force a page" rule is preserved by the matcher.
 */
const IDENTITY_OVERRIDES: Record<
  string,
  { siteName?: string; domainAliases?: string[] }
> = {
  // GOAT's marketplace CDN returns 403 to scripted fetches regardless of the
  // user-agent (even a full browser UA), so live identity resolution cannot
  // read its homepage. The sneaker-resale seed list names the brand "GOAT";
  // without that term the provider query degenerates to the bare label "goat"
  // and surfaces keyword junk (mouth-tape, marketplace ads) instead of GOAT's
  // own ads.
  "goat.com": { siteName: "GOAT" },
  // On runs its ads across both on.com and its long-standing on-running.com
  // host (on-running.com now redirects into www.on.com). The live redirect
  // chain for on.com never touches on-running.com, so the alias is not
  // discoverable and On ads landing on on-running.com would not connect to a
  // searched on.com. The 2-char stem "on" also falls under the matcher's
  // stem-extension floor, so this alias is the load-bearing link.
  "on.com": { domainAliases: ["on-running.com"] },
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

  const identity = applyIdentityOverride(
    await fetchWebsiteIdentity(safeUrl, registrableDomain),
    registrableDomain,
  );
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
 * site name still lets the pipeline ask the provider the right question.
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
  const siteName = live?.siteName ?? overrideSiteName;
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
    resolvedAt: live?.resolvedAt ?? new Date().toISOString(),
  };
}

export function clearWebsiteIdentityCacheForTests() {
  identityCache.clear();
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

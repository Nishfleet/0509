import {
  contentLengthExceeds,
  readResponseTextWithinLimit,
} from "~/lib/bounded-response.server";
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

  const identity = await fetchWebsiteIdentity(safeUrl, registrableDomain);
  identityCache.set(registrableDomain, {
    identity,
    expiresAt: Date.now() + IDENTITY_CACHE_TTL_MS,
  });

  return identity;
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

    if (contentLengthExceeds(response.headers, MAX_IDENTITY_RESPONSE_BYTES)) {
      releaseFetchTimeout(response);
      return null;
    }

    const html = await readResponseTextWithinLimit(response, MAX_IDENTITY_RESPONSE_BYTES).catch(() => null);
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

function metaContentPatternsForKey(key: string): RegExp[] | null {
  switch (key) {
    case "og:site_name":
      return [
        /<meta[^>]+(?:property|name)=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:site_name["']/i,
      ];
    case "application-name":
      return [
        /<meta[^>]+(?:property|name)=["']application-name["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']application-name["']/i,
      ];
    default:
      return null;
  }
}

/** Extract content of allowlisted meta names. Unknown keys, including
 * those that contain regex metacharacters, return null. */
export function extractMetaContent(html: string, key: string) {
  const patterns = metaContentPatternsForKey(key);
  if (patterns === null) return null;

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1].trim());
    }
  }

  return null;
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

import {
  contentLengthExceeds,
  readResponseTextWithinLimit,
} from "~/lib/bounded-response.server";
import {
  resolvePublicHttpUrl,
  resolvePublicRedirectUrl,
} from "~/lib/public-url.server";
import { fetchWithTimeout, releaseFetchTimeout } from "~/lib/fetch-timeout.server";

export const PRESENCE_BOT_NAME = "FiveToNinePresenceBot";
export const PRESENCE_BOT_INFO_URL = "https://0509.io/bots/presence";
export const PRESENCE_USER_AGENT = `${PRESENCE_BOT_NAME}/1.0 (+${PRESENCE_BOT_INFO_URL})`;

const MAX_ROBOTS_BYTES = 500 * 1024;
const MAX_REDIRECTS = 5;
const ROBOTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PRESENCE_FETCH_TIMEOUT_MS = 10_000;

export type RobotsFetchStatus = "ok" | "unavailable" | "failed";

export interface RobotsPolicy {
  status: RobotsFetchStatus;
  fetchedAt: string;
  sitemaps: string[];
  rules: RobotsRule[];
}

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

interface RobotsCacheEntry {
  policy: RobotsPolicy;
  expiresAt: number;
}

const robotsCache = new Map<string, RobotsCacheEntry>();

function cacheKeyForUrl(url: URL) {
  return `${url.protocol}//${url.host}`;
}

export function clearRobotsCacheForTests() {
  robotsCache.clear();
}

export async function fetchRobotsPolicy(
  siteUrl: string,
  fetchImpl: typeof fetch,
): Promise<RobotsPolicy> {
  const safeOrigin = await resolvePublicHttpUrl(siteUrl);
  if (!safeOrigin) {
    return {
      status: "failed",
      fetchedAt: new Date().toISOString(),
      sitemaps: [],
      rules: [],
    };
  }

  const key = cacheKeyForUrl(safeOrigin);
  const cached = robotsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.policy;
  }

  const robotsUrl = new URL("/robots.txt", safeOrigin);
  const fetchedAt = new Date().toISOString();
  const response = await presenceSafeFetch(robotsUrl.toString(), fetchImpl, {
    method: "GET",
    maxBytes: MAX_ROBOTS_BYTES,
    accept: "text/plain,*/*",
  });

  let policy: RobotsPolicy;
  if (!response) {
    policy = { status: "failed", fetchedAt, sitemaps: [], rules: [] };
  } else if (response.status >= 500 || response.status === 0) {
    policy = { status: "failed", fetchedAt, sitemaps: [], rules: [] };
  } else if (response.status >= 400) {
    policy = { status: "unavailable", fetchedAt, sitemaps: [], rules: [] };
  } else if (!response.ok || !response.body) {
    policy = { status: "failed", fetchedAt, sitemaps: [], rules: [] };
  } else {
    const parsed = parseRobotsTxt(response.body);
    policy = {
      status: "ok",
      fetchedAt,
      sitemaps: parsed.sitemaps,
      rules: parsed.rules,
    };
  }

  robotsCache.set(key, { policy, expiresAt: Date.now() + ROBOTS_CACHE_TTL_MS });
  return policy;
}

export function isRobotsAllowed(policy: RobotsPolicy, targetUrl: string) {
  if (policy.status !== "ok") {
    return false;
  }

  let path = "/";
  try {
    const url = new URL(targetUrl);
    path = url.pathname || "/";
    if (url.search) {
      path += url.search;
    }
  } catch {
    return false;
  }

  return pathAllowed(policy.rules, path);
}

export function parseRobotsTxt(body: string) {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);

  const groups: Array<{ agents: string[]; rules: RobotsRule[]; sitemaps: string[] }> = [];
  let current: { agents: string[]; rules: RobotsRule[]; sitemaps: string[] } | null = null;
  const globalSitemaps: string[] = [];

  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      if (!current || current.rules.length > 0 || current.sitemaps.length > 0) {
        current = { agents: [], rules: [], sitemaps: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (field === "sitemap") {
      if (current) {
        current.sitemaps.push(value);
      } else {
        globalSitemaps.push(value);
      }
      continue;
    }

    if (!current) {
      current = { agents: ["*"], rules: [], sitemaps: [] };
      groups.push(current);
    }

    if (field === "allow") {
      current.rules.push({ allow: true, pattern: value || "/" });
    } else if (field === "disallow") {
      current.rules.push({ allow: false, pattern: value || "/" });
    }
  }

  const applicable = selectApplicableGroup(groups);
  return {
    rules: applicable?.rules ?? [],
    sitemaps: [...globalSitemaps, ...(applicable?.sitemaps ?? [])],
  };
}

function selectApplicableGroup(groups: Array<{ agents: string[]; rules: RobotsRule[]; sitemaps: string[] }>) {
  const botName = PRESENCE_BOT_NAME.toLowerCase();
  let wildcard: (typeof groups)[number] | null = null;
  let specific: (typeof groups)[number] | null = null;

  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent === "*") {
        wildcard = group;
      } else if (botName.includes(agent) || agent.includes(botName.toLowerCase())) {
        specific = group;
      }
    }
  }

  return specific ?? wildcard;
}

function pathAllowed(rules: RobotsRule[], path: string) {
  let bestMatch = "";
  let allowed = true;

  for (const rule of rules) {
    if (ruleMatches(rule.pattern, path)) {
      if (rule.pattern.length > bestMatch.length) {
        bestMatch = rule.pattern;
        allowed = rule.allow;
      } else if (rule.pattern.length === bestMatch.length && !rule.allow) {
        allowed = false;
      }
    }
  }

  return allowed;
}

function ruleMatches(pattern: string, path: string) {
  if (!pattern) {
    return path === "/" || path.startsWith("/");
  }

  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\\$/g, "$");
  const anchored = pattern.endsWith("$") ? `^${escaped.slice(0, -1)}$` : `^${escaped}`;
  return new RegExp(anchored).test(path);
}

export interface PresenceSafeFetchResult {
  ok: boolean;
  status: number;
  body: string | null;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  notModified?: boolean;
}

export async function presenceSafeFetch(
  url: string,
  fetchImpl: typeof fetch,
  options: {
    method?: string;
    maxBytes: number;
    accept?: string;
    etag?: string | null;
    lastModified?: string | null;
  },
): Promise<PresenceSafeFetchResult | null> {
  let currentUrl = await resolvePublicHttpUrl(url);
  for (let redirects = 0; currentUrl && redirects <= MAX_REDIRECTS; redirects += 1) {
    const headers: Record<string, string> = {
      accept: options.accept ?? "text/html,application/xhtml+xml,application/xml,text/xml,*/*",
      "user-agent": PRESENCE_USER_AGENT,
    };
    if (options.etag) headers["if-none-match"] = options.etag;
    if (options.lastModified) headers["if-modified-since"] = options.lastModified;

    let response: Response;
    try {
      response = await fetchWithTimeout(
        currentUrl.toString(),
        {
          method: options.method ?? "GET",
          redirect: "manual",
          headers,
        },
        { fetcher: fetchImpl, timeoutMs: PRESENCE_FETCH_TIMEOUT_MS },
      );
    } catch {
      return null;
    }

    if (response.status === 304) {
      releaseFetchTimeout(response);
      return {
        ok: true,
        status: 304,
        body: null,
        contentType: response.headers.get("content-type"),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        notModified: true,
      };
    }

    if (response.status >= 300 && response.status < 400) {
      const redirected = resolvePublicRedirectUrl(response.headers.get("location"), currentUrl);
      releaseFetchTimeout(response);
      currentUrl = redirected ? await resolvePublicHttpUrl(redirected) : null;
      continue;
    }

    if (options.method === "HEAD") {
      releaseFetchTimeout(response);
      return {
        ok: response.ok,
        status: response.status,
        body: null,
        contentType: response.headers.get("content-type"),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
    }

    if (!response.ok) {
      releaseFetchTimeout(response);
      return {
        ok: false,
        status: response.status,
        body: null,
        contentType: null,
        etag: null,
        lastModified: null,
      };
    }

    if (contentLengthExceeds(response.headers, options.maxBytes)) {
      releaseFetchTimeout(response);
      return null;
    }

    const body = await readResponseTextWithinLimit(response, options.maxBytes).catch(() => null);
    if (body === null) {
      return null;
    }
    return {
      ok: true,
      status: response.status,
      body,
      contentType: response.headers.get("content-type"),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
  }

  return null;
}

export async function assertRobotsAllowedForUrls(
  siteUrl: string,
  urls: string[],
  fetchImpl: typeof fetch,
) {
  const policy = await fetchRobotsPolicy(siteUrl, fetchImpl);
  if (policy.status === "failed") {
    return {
      allowed: false,
      policy,
      errorCode: "robots_fetch_failed",
      errorMessage: "Could not fetch robots.txt — crawling is blocked until retry.",
    };
  }
  if (policy.status === "unavailable") {
    return {
      allowed: false,
      policy,
      errorCode: "robots_unavailable",
      errorMessage: "robots.txt is unavailable — crawling is blocked until retry.",
    };
  }

  for (const target of urls) {
    if (!isRobotsAllowed(policy, target)) {
      return {
        allowed: false,
        policy,
        errorCode: "robots_disallowed",
        errorMessage: "robots.txt disallows crawling the requested path.",
      };
    }
  }

  return { allowed: true, policy, errorCode: null, errorMessage: null };
}

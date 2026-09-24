import { getDomain, getSubdomain } from "tldts";

export const BOARD_PLATFORMS = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
] as const;

export type BoardPlatform = (typeof BOARD_PLATFORMS)[number];

export interface DiscoveredBoard {
  platform: BoardPlatform | "none";
  boardUrl: string | null;
  via: "nav" | "careers-page" | "none";
}

export interface ProbeResponse {
  ok: boolean;
  contentType: string | null;
  body: string;
}

export type Probe = (url: string) => Promise<ProbeResponse>;

export interface DiscoverOptions {
  probe?: Probe;
}

interface DocumentedHost {
  platform: BoardPlatform;
  aliases: readonly string[];
  listingUrl: (slug: string, matchedAlias: string) => string;
  slugFrom: (url: URL) => string | null;
  hasListing: (body: string) => boolean;
}

interface BoardCandidate {
  via: "nav" | "careers-page";
  platform: BoardPlatform;
  boardUrl: string;
  probeUrl: string;
  hasListing: (body: string) => boolean;
}

interface LeadCandidate {
  leadUrl: string;
}

type LinkItem = BoardCandidate | LeadCandidate;

const PROBE_TIMEOUT_MS = 8_000;

const MIN_LEAD_BYTES = 200;

const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;

const URL_IN_TEXT = /https?:\/\/[^\s"'<>\\]+/gi;

const CAREERS_LABELS: readonly string[] = ["careers", "jobs", "hiring"];

function firstPathSegment(url: URL): string | null {
  const first = url.pathname.split("/").find((segment) => segment.length > 0);
  return first !== undefined && SLUG_PATTERN.test(first) ? first : null;
}

function querySlug(url: URL, name: string): string | null {
  const value = url.searchParams.get(name);
  return value !== null && SLUG_PATTERN.test(value) ? value : null;
}

function greenhouseSlugFromUrl(url: URL): string | null {
  const first = firstPathSegment(url);
  return first === "embed" ? querySlug(url, "for") : first;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function textHasField(body: string, field: string): boolean {
  const parsed = parseJson(body);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && field in parsed;
}

const DOCUMENTED_HOSTS: readonly DocumentedHost[] = [
  {
    platform: "greenhouse",
    aliases: ["boards.greenhouse.io", "job-boards.greenhouse.io", "job-boards.eu.greenhouse.io"],
    listingUrl: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    slugFrom: greenhouseSlugFromUrl,
    hasListing: (body) => textHasField(body, "jobs"),
  },
  {
    platform: "lever",
    aliases: ["jobs.lever.co", "jobs.eu.lever.co"],
    listingUrl: (slug, matchedAlias) =>
      matchedAlias === "jobs.eu.lever.co"
        ? `https://api.eu.lever.co/v0/postings/${slug}?mode=json`
        : `https://api.lever.co/v0/postings/${slug}?mode=json`,
    slugFrom: firstPathSegment,
    hasListing: (body) => Array.isArray(parseJson(body)),
  },
  {
    platform: "ashby",
    aliases: ["jobs.ashbyhq.com"],
    listingUrl: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    slugFrom: firstPathSegment,
    hasListing: (body) => textHasField(body, "jobs"),
  },
  {
    platform: "workable",
    aliases: ["apply.workable.com"],
    listingUrl: (slug) => `https://apply.workable.com/api/v1/widget/accounts/${slug}`,
    slugFrom: firstPathSegment,
    hasListing: (body) => textHasField(body, "jobs"),
  },
  {
    platform: "smartrecruiters",
    aliases: ["jobs.smartrecruiters.com", "careers.smartrecruiters.com"],
    listingUrl: (slug) => `https://api.smartrecruiters.com/v1/companies/${slug}/postings`,
    slugFrom: firstPathSegment,
    hasListing: (body) => textHasField(body, "content"),
  },
];

function toUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function firstSubdomainLabel(host: string): string {
  return getSubdomain(host)?.split(".")[0] ?? "";
}

function isCareersLead(url: URL, domain: string): boolean {
  const host = url.hostname.toLowerCase();
  const registrable = getDomain(host);
  if (registrable === null || registrable !== getDomain(domain)) return false;
  if (CAREERS_LABELS.includes(firstSubdomainLabel(host))) return true;
  const segment = firstPathSegment(url);
  return segment !== null && CAREERS_LABELS.includes(segment);
}

function documentedHostFor(host: string): DocumentedHost | null {
  return DOCUMENTED_HOSTS.find((candidate) => candidate.aliases.includes(host)) ?? null;
}

function boardCandidate(host: DocumentedHost, matchedAlias: string, slug: string, via: "nav" | "careers-page"): BoardCandidate {
  return {
    via,
    platform: host.platform,
    boardUrl: `https://${matchedAlias}/${slug}`,
    probeUrl: host.listingUrl(slug, matchedAlias),
    hasListing: host.hasListing,
  };
}

function linkItemsFor(link: string, domain: string): LinkItem[] {
  const url = toUrl(link);
  if (url?.protocol !== "https:") return [];
  const host = url.hostname.toLowerCase();

  const documented = documentedHostFor(host);
  if (documented) {
    const slug = documented.slugFrom(url);
    return slug === null ? [] : [boardCandidate(documented, host, slug, "nav")];
  }

  return isCareersLead(url, domain) ? [{ leadUrl: url.href }] : [];
}

function documentedLinksInPage(body: string): BoardCandidate[] {
  const found: BoardCandidate[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(URL_IN_TEXT)) {
    const candidate = boardCandidateFromText(match[0]);
    if (candidate === null || seen.has(candidate.boardUrl)) continue;
    seen.add(candidate.boardUrl);
    found.push(candidate);
  }
  return found;
}

function boardCandidateFromText(text: string): BoardCandidate | null {
  const url = toUrl(text);
  if (url?.protocol !== "https:" && url?.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const documented = documentedHostFor(host);
  if (documented === null) return null;
  const slug = documented.slugFrom(url);
  return slug === null ? null : boardCandidate(documented, host, slug, "careers-page");
}

function isScannablePage(body: string, contentType: string | null): boolean {
  if (contentType !== null && !contentType.includes("html")) return false;
  return body.length >= MIN_LEAD_BYTES;
}

const defaultProbe = async (url: string): Promise<ProbeResponse> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return { ok: response.ok, contentType: response.headers.get("content-type"), body: await response.text() };
  } catch {
    return { ok: false, contentType: null, body: "" };
  }
};

export async function discoverBoard(
  links: readonly string[],
  domain: string,
  options: DiscoverOptions = {},
): Promise<DiscoveredBoard> {
  const probe = options.probe ?? defaultProbe;
  const queue: LinkItem[] = links.flatMap((link) => linkItemsFor(link, domain));

  while (queue.length > 0) {
    const item = queue.shift();
    if (item === undefined) continue;

    if ("leadUrl" in item) {
      const page = await probe(item.leadUrl);
      if (!page.ok || !isScannablePage(page.body, page.contentType)) continue;
      queue.push(...documentedLinksInPage(page.body));
      continue;
    }

    const response = await probe(item.probeUrl);
    if (!response.ok || !item.hasListing(response.body)) continue;
    return { platform: item.platform, boardUrl: item.boardUrl, via: item.via };
  }

  return { platform: "none", boardUrl: null, via: "none" };
}

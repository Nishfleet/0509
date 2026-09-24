import { getDomain, getSubdomain } from "tldts";

export interface DiscoveredBoard {
  platform: "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters" | "none";
  boardUrl: string | null;
  via: "nav" | "subdomain" | "none";
}

export interface ProbeResponse {
  ok: boolean;
  contentType: string | null;
  body: string;
}

export interface DiscoverOptions {
  probe?: (url: string) => Promise<ProbeResponse>;
}

type BoardPlatform = "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters";

interface DocumentedHost {
  platform: BoardPlatform;
  aliases: readonly string[];
  listingUrl: (slug: string) => string;
  hasListing: (body: string) => boolean;
}

interface BoardCandidate {
  via: "nav" | "subdomain";
  platform: BoardPlatform;
  boardUrl: string;
  probeUrl: string;
  hasListing: (body: string) => boolean;
}

interface LeadCandidate {
  leadUrl: string;
}

type NavItem = BoardCandidate | LeadCandidate;

const PROBE_TIMEOUT_MS = 8_000;

const MIN_LEAD_BYTES = 200;

const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;

const URL_IN_TEXT = /https?:\/\/[^\s"'<>\\]+/gi;

const CAREERS_LABELS: readonly string[] = ["careers", "jobs", "hiring"];

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
    hasListing: (body) => textHasField(body, "jobs"),
  },
  {
    platform: "lever",
    aliases: ["jobs.lever.co"],
    listingUrl: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
    hasListing: (body) => Array.isArray(parseJson(body)),
  },
  {
    platform: "ashby",
    aliases: ["jobs.ashbyhq.com"],
    listingUrl: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    hasListing: (body) => textHasField(body, "jobs"),
  },
  {
    platform: "workable",
    aliases: ["apply.workable.com"],
    listingUrl: (slug) => `https://apply.workable.com/api/v1/widget/accounts/${slug}`,
    hasListing: (body) => textHasField(body, "jobs"),
  },
  {
    platform: "smartrecruiters",
    aliases: ["jobs.smartrecruiters.com", "careers.smartrecruiters.com"],
    listingUrl: (slug) => `https://api.smartrecruiters.com/v1/companies/${slug}/postings`,
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

function isCareersSubdomainOf(host: string, domain: string): boolean {
  const registrable = getDomain(host);
  const firstLabel = getSubdomain(host)?.split(".")[0] ?? "";
  return registrable !== null && registrable === getDomain(domain) && CAREERS_LABELS.includes(firstLabel);
}

function documentedHostFor(host: string): DocumentedHost | null {
  return DOCUMENTED_HOSTS.find((candidate) => candidate.aliases.includes(host)) ?? null;
}

function slugFromUrl(url: URL): string | null {
  const first = url.pathname.split("/").find((segment) => segment.length > 0);
  return first !== undefined && SLUG_PATTERN.test(first) ? first : null;
}

function boardCandidate(host: DocumentedHost, matchedAlias: string, slug: string, via: "nav" | "subdomain"): BoardCandidate {
  return {
    via,
    platform: host.platform,
    boardUrl: `https://${matchedAlias}/${slug}`,
    probeUrl: host.listingUrl(slug),
    hasListing: host.hasListing,
  };
}

function navItemsFor(link: string, domain: string): NavItem[] {
  const url = toUrl(link);
  if (url?.protocol !== "https:") return [];
  const host = url.hostname.toLowerCase();

  const documented = documentedHostFor(host);
  if (documented) {
    const slug = slugFromUrl(url);
    return slug === null ? [] : [boardCandidate(documented, host, slug, "nav")];
  }

  return isCareersSubdomainOf(host, domain) ? [{ leadUrl: url.href }] : [];
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
  const slug = slugFromUrl(url);
  return slug === null ? null : boardCandidate(documented, host, slug, "subdomain");
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
  navLinks: readonly string[],
  domain: string,
  options: DiscoverOptions = {},
): Promise<DiscoveredBoard> {
  const probe = options.probe ?? defaultProbe;
  const queue: NavItem[] = navLinks.flatMap((link) => navItemsFor(link, domain));

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

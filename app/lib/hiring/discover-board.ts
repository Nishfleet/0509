/**
 * Hiring board discovery (0509#4172, slice of #4162, umbrella #3842).
 *
 * Turns the nav links the identity extractor already produced into a job board
 * we can actually serve, or an honest `none`. Two rules are load-bearing and
 * both are the reason this module exists rather than a slug guess:
 *
 *   1. A slug is only ever read out of a nav link's *documented* URL shape
 *      (docs/REBUILD-SCHEMA.md `source.platform` carries `greenhouse`, et al).
 *      A board URL is never constructed from the brand's domain, so a brand we
 *      "know" uses Greenhouse still carries no hiring watch unless its nav
 *      names the board.
 *   2. The brand's own careers subdomain is tried only when the nav already
 *      points at it. Subdomains are never enumerated — that is the crt.sh leg
 *      KEEPLIST already parks as unproven.
 *
 * **A board is accepted only when its documented listing endpoint answers 2xx
 * with a body carrying that platform's listing field** (`jobs`, `content`, or a
 * postings array), probed with the shared `fetch` and an 8 s abort. A nav-named
 * careers subdomain is a *lead*, not a board: it is fetched, and the board it
 * reveals is the one probed. A subdomain that merely answers 200 — a marketing
 * page, a "not hiring" page, or a client-rendered shell that 200s for every
 * path — reveals no documented board and is an honest `none`, because there is
 * nothing true to track.
 *
 * Rule 5 of the issue: `navLinks` is an argument, so this module imports
 * nothing from the identity engine.
 */

/** A public ATS board host we recognise by its documented URL shape. */
export type BoardPlatform = "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters";

/** The result of probing one candidate URL. Injectable so tests need no network. */
export interface ProbeResponse {
  /** True only for a 2xx from the egress. */
  ok: boolean;
  /** The `content-type` header value, or null when absent. */
  contentType: string | null;
  /** The response body as text (empty on transport failure). */
  body: string;
}

export type Probe = (url: string) => Promise<ProbeResponse>;

export interface DiscoveredBoard {
  /** The recognised platform, or `"none"`. */
  platform: BoardPlatform | "none";
  /** The canonical human board URL, or null when none was found. */
  boardUrl: string | null;
  /** How the board was found: from a nav ATS link, a nav-named lead, or neither. */
  via: "nav" | "subdomain" | "none";
}

export interface DiscoverOptions {
  /** Override the network probe (tests). Defaults to the shared 8 s fetch below. */
  probe?: Probe;
}

/** The 8-second deadline identity-card.md §Workflow assigns every probe. */
const PROBE_TIMEOUT_MS = 8_000;

/**
 * A real browser UA: the identity probe found origins do not gate on it, but a
 * bare default is refused by a few. Matching the probes recorded for #3885.
 */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Minimum body length for an HTML lead page to be worth scanning for a board. */
const MIN_HTML_BYTES = 200;

/** The character class every ATS slug is drawn from. */
const SLUG_CLASS = "[A-Za-z0-9_-]+";

interface DocumentedHost {
  /** The platform name written to `source.platform`. */
  platform: BoardPlatform;
  /** Board host names this platform's public board lives on (www stripped). */
  hosts: readonly string[];
  /** Build the documented listing endpoint for a slug (never a guessed slug). */
  listingUrl: (slug: string) => string;
  /** True when a parsed JSON body carries this platform's documented listing field. */
  accepts: (parsed: unknown) => boolean;
  /** The canonical board URL for a matched board host + slug. */
  boardUrl: (matchedHost: string, slug: string) => string;
}

/**
 * The public board hosts we recognise, each by its own documented URL shapes.
 * Greenhouse's `platform` is the only hiring platform in the schema comment
 * (REBUILD-SCHEMA.md line ~311); the rest are added because REBUILD-SCHEMA.md
 * deliberately keeps `platform` free of a CHECK — an INSERT plus a plugin, never
 * a migration (#3891). Each row here is that INSERT's discovery leg.
 */
const DOCUMENTED_HOSTS: readonly DocumentedHost[] = [
  {
    // Greenhouse serves public boards on three host names; the listing API that
    // answers 2xx from our egress is the US one for every slug, including
    // boards hosted on the EU board host. Probed live 2026-09-22: the EU API
    // host does not resolve (NXDOMAIN) and the US API answers for both
    // gymshark (EU board) and stripe (US board).
    platform: "greenhouse",
    hosts: ["boards.greenhouse.io", "job-boards.greenhouse.io", "job-boards.eu.greenhouse.io"],
    listingUrl: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    accepts: (parsed) => hasArray(parsed, "jobs"),
    boardUrl: (matchedHost, slug) =>
      matchedHost.startsWith("job-boards.eu.")
        ? `https://job-boards.eu.greenhouse.io/${slug}`
        : `https://job-boards.greenhouse.io/${slug}`,
  },
  {
    platform: "lever",
    hosts: ["jobs.lever.co"],
    listingUrl: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
    // Lever's listing is a bare JSON array of postings.
    accepts: (parsed) => Array.isArray(parsed),
    boardUrl: (_matchedHost, slug) => `https://jobs.lever.co/${slug}`,
  },
  {
    platform: "ashby",
    hosts: ["jobs.ashbyhq.com"],
    listingUrl: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    accepts: (parsed) => hasArray(parsed, "jobs"),
    boardUrl: (_matchedHost, slug) => `https://jobs.ashbyhq.com/${slug}`,
  },
  {
    platform: "workable",
    hosts: ["apply.workable.com"],
    listingUrl: (slug) => `https://apply.workable.com/api/v1/widget/accounts/${slug}`,
    accepts: (parsed) => hasArray(parsed, "jobs"),
    boardUrl: (_matchedHost, slug) => `https://apply.workable.com/${slug}`,
  },
  {
    platform: "smartrecruiters",
    hosts: ["jobs.smartrecruiters.com", "careers.smartrecruiters.com"],
    listingUrl: (slug) => `https://api.smartrecruiters.com/v1/companies/${slug}/postings`,
    accepts: (parsed) => hasArray(parsed, "content"),
    boardUrl: (_matchedHost, slug) => `https://jobs.smartrecruiters.com/${slug}`,
  },
];

/**
 * Subdomain labels that mean "this brand may host a careers board here". Any
 * other subdomain in a nav (shop., api., www.) is not a careers board and is
 * skipped. Such a link is a lead only: it is fetched and must reveal a board.
 */
const CAREERS_LABELS: readonly string[] = ["careers", "jobs", "hiring"];

/** The default probe: shared fetch with the 8 s abort from the design doc. */
const defaultProbe: Probe = async (url) => {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return { ok: response.ok, contentType: response.headers.get("content-type"), body: await response.text() };
  } catch {
    return { ok: false, contentType: null, body: "" };
  }
};

/** A candidate whose documented listing endpoint we can probe directly. */
interface BoardCandidate {
  via: "nav" | "subdomain";
  platform: BoardPlatform;
  boardUrl: string;
  /** The URL to probe to prove the board is real. */
  probeUrl: string;
  /** Whether a 2xx response body proves this candidate. */
  acceptsBody: (body: string, contentType: string | null) => boolean;
}

/** A nav-named careers subdomain, fetched before it can become a board. */
interface LeadCandidate {
  leadUrl: string;
}

type RawCandidate = BoardCandidate | LeadCandidate;

function hasArray(parsed: unknown, key: string): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  return Array.isArray((parsed as Record<string, unknown>)[key]);
}

function parseJsonListing(body: string, accepts: (parsed: unknown) => boolean): boolean {
  try {
    return accepts(JSON.parse(body) as unknown);
  } catch {
    return false;
  }
}

function isHtmlPage(body: string, contentType: string | null): boolean {
  if (contentType !== null && !contentType.includes("html")) return false;
  return body.trim().length >= MIN_HTML_BYTES;
}

/** The first path segment of a URL — the slug a documented board shape carries. */
function slugFromUrl(url: URL): string | null {
  return url.pathname.split("/").find((part) => part.length > 0) ?? null;
}

function toUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** True when `host` is a subdomain of `domain` (e.g. careers.dropbox.com / dropbox.com). */
function isSubdomainOf(host: string, domain: string): boolean {
  const bareDomain = domain.replace(/^www\./, "");
  return host.endsWith(`.${bareDomain}`) && host !== bareDomain;
}

/** A board candidate for a matched board host and a slug taken from a URL. */
function boardCandidate(host: DocumentedHost, matchedHost: string, slug: string, via: "nav" | "subdomain"): BoardCandidate {
  return {
    via,
    platform: host.platform,
    boardUrl: host.boardUrl(matchedHost, slug),
    probeUrl: host.listingUrl(slug),
    acceptsBody: (body) => parseJsonListing(body, host.accepts),
  };
}

/**
 * Build the ordered candidate list from the nav links, without any network.
 * A direct ATS nav link becomes a probed board candidate; a careers subdomain
 * becomes a lead that `discoverBoard` fetches.
 */
function candidatesFor(navLinks: readonly string[], domain: string): RawCandidate[] {
  const candidates: RawCandidate[] = [];

  for (const link of navLinks) {
    const url = toUrl(link);
    if (url?.protocol !== "https:") continue;
    const host = url.hostname.toLowerCase();
    const host0 = host.replace(/^www\./, "");

    const documented = DOCUMENTED_HOSTS.find((h) => h.hosts.includes(host0));
    if (documented) {
      const slug = slugFromUrl(url);
      if (slug !== null) candidates.push(boardCandidate(documented, host0, slug, "nav"));
      continue;
    }

    const firstLabel = host.split(".")[0] ?? "";
    if (CAREERS_LABELS.includes(firstLabel) && isSubdomainOf(host, domain)) {
      candidates.push({ leadUrl: url.href });
    }
  }

  return candidates;
}

/** Documented board hosts embedded in a lead page's HTML, with their URL slug. */
function boardsInHtml(body: string): { host: DocumentedHost; matchedHost: string; slug: string }[] {
  const found: { host: DocumentedHost; matchedHost: string; slug: string }[] = [];
  for (const host of DOCUMENTED_HOSTS) {
    for (const hostName of host.hosts) {
      const escaped = hostName.replace(/\./g, "\\.");
      // Match the board host followed by a path slug, tolerating the scheme and
      // whatever quotes, angle brackets or escapes the HTML wraps the URL in.
      const pattern = new RegExp(`https?:\\/\\/${escaped}\\/(${SLUG_CLASS})`, "gi");
      for (const match of body.matchAll(pattern)) {
        const slug = match[1];
        if (slug !== undefined) found.push({ host, matchedHost: hostName, slug });
      }
    }
  }
  return found;
}

/**
 * Discover a brand's real job board from its nav links.
 *
 * Probes candidates in nav order and returns the first the listing endpoint
 * proves. A nav-named careers subdomain is followed only as far as a documented
 * board it reveals. Returns an honest `none` when the nav names no board, or
 * when every named shape fails its probe — never a guess.
 */
export async function discoverBoard(
  navLinks: readonly string[],
  domain: string,
  options: DiscoverOptions = {},
): Promise<DiscoveredBoard> {
  const probe = options.probe ?? defaultProbe;
  const candidates: BoardCandidate[] = [];

  for (const raw of candidatesFor(navLinks, domain)) {
    if ("leadUrl" in raw) {
      const page = await probe(raw.leadUrl);
      if (!page.ok || !isHtmlPage(page.body, page.contentType)) continue;
      for (const found of boardsInHtml(page.body)) {
        candidates.push(boardCandidate(found.host, found.matchedHost, found.slug, "subdomain"));
      }
      continue;
    }
    candidates.push(raw);
  }

  for (const candidate of candidates) {
    const response = await probe(candidate.probeUrl);
    if (!response.ok) continue;
    if (!candidate.acceptsBody(response.body, response.contentType)) continue;
    return { platform: candidate.platform, boardUrl: candidate.boardUrl, via: candidate.via };
  }

  return { platform: "none", boardUrl: null, via: "none" };
}

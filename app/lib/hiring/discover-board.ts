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
 * A board is accepted only when its documented listing endpoint answers 2xx
 * with a body that carries the platform's listing field. A 200 over an
 * unrelated page, or a documented shape whose probe 404s, is an honest `none`.
 *
 * Rule 5 of the issue: `navLinks` is an argument, so this module imports
 * nothing from the identity engine.
 */

/** A public ATS board host we recognise by its documented URL shape. */
export type BoardPlatform = "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters" | "self";

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
  /** How the board was found: from a nav ATS link, the brand's own subdomain, or neither. */
  via: "nav" | "subdomain" | "none";
}

export interface DiscoverOptions {
  /** Override the network probe (tests). Defaults to the shared 8 s fetch below. */
  probe?: Probe;
}

/** The 8-second deadline identity-card.md §Workflow assigns every probe. */
const PROBE_TIMEOUT_MS = 8_000;

/** A real browser UA: the identity probe found origins do not gate on it, but a
 *  bare default is refused by a few. Matching the probes recorded for #3885. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Minimum body length for an HTML careers page to count as parseable. */
const MIN_HTML_BYTES = 200;

interface DocumentedHost {
  /** The platform name written to `source.platform`. */
  platform: BoardPlatform;
  /** Hostnames this platform's public board lives on (exact match). */
  hosts: readonly string[];
  /** Build the documented listing endpoint for a slug (never a guessed slug). */
  listingUrl: (slug: string) => string;
  /** True when a parsed JSON body carries this platform's documented listing field. */
  accepts: (parsed: unknown) => boolean;
  /** The canonical board URL for a matched nav host + slug. */
  boardUrl: (host: string, slug: string) => string;
}

function hasArray(parsed: unknown, key: string): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  const value = (parsed as Record<string, unknown>)[key];
  return Array.isArray(value);
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
    hosts: [
      "boards.greenhouse.io",
      "job-boards.greenhouse.io",
      "boards-api.greenhouse.io",
      "job-boards.eu.greenhouse.io",
    ],
    listingUrl: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    accepts: (parsed) => hasArray(parsed, "jobs"),
    boardUrl: (host, slug) =>
      host.startsWith("job-boards.eu.")
        ? `https://job-boards.eu.greenhouse.io/${slug}`
        : `https://job-boards.greenhouse.io/${slug}`,
  },
  {
    platform: "lever",
    hosts: ["jobs.lever.co"],
    listingUrl: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
    // Lever's listing is a bare JSON array of postings.
    accepts: (parsed) => Array.isArray(parsed),
    boardUrl: (_host, slug) => `https://jobs.lever.co/${slug}`,
  },
  {
    platform: "ashby",
    hosts: ["jobs.ashbyhq.com"],
    listingUrl: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    accepts: (parsed) => hasArray(parsed, "jobs"),
    boardUrl: (_host, slug) => `https://jobs.ashbyhq.com/${slug}`,
  },
  {
    platform: "workable",
    hosts: ["apply.workable.com"],
    listingUrl: (slug) => `https://apply.workable.com/api/v1/widget/accounts/${slug}`,
    accepts: (parsed) => hasArray(parsed, "jobs"),
    boardUrl: (_host, slug) => `https://apply.workable.com/${slug}`,
  },
  {
    platform: "smartrecruiters",
    hosts: ["jobs.smartrecruiters.com", "careers.smartrecruiters.com"],
    listingUrl: (slug) => `https://api.smartrecruiters.com/v1/companies/${slug}/postings`,
    accepts: (parsed) => hasArray(parsed, "content"),
    boardUrl: (_host, slug) => `https://jobs.smartrecruiters.com/${slug}`,
  },
];

/**
 * Subdomain labels that mean "this brand hosts its own careers board". Any other
 * subdomain in a nav (shop., api., www.) is not a careers board and is skipped.
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

interface Candidate {
  via: "nav" | "subdomain";
  platform: BoardPlatform;
  boardUrl: string;
  /** The URL to probe to prove the board is real. */
  probeUrl: string;
  /** Whether a 2xx response body proves this candidate. */
  acceptsBody: (body: string, contentType: string | null) => boolean;
}

function parseJsonListing(body: string, accepts: (parsed: unknown) => boolean): boolean {
  try {
    return accepts(JSON.parse(body) as unknown);
  } catch {
    return false;
  }
}

function isHtmlListing(body: string, contentType: string | null): boolean {
  if (contentType !== null && !contentType.includes("html")) return false;
  return body.trim().length >= MIN_HTML_BYTES;
}

/** The first path segment of a URL — the slug a documented board shape carries. */
function slugFromUrl(url: URL): string | null {
  const segment = url.pathname.split("/").find((part) => part.length > 0);
  return segment ?? null;
}

/** True when `host` is a subdomain of `domain` (e.g. careers.dropbox.com / dropbox.com). */
function isSubdomainOf(host: string, domain: string): boolean {
  const bareDomain = domain.replace(/^www\./, "");
  return host.endsWith(`.${bareDomain}`) && host !== bareDomain;
}

function toUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Build the ordered candidate list from the nav links, without any network. */
function candidatesFor(navLinks: readonly string[], domain: string): Candidate[] {
  const candidates: Candidate[] = [];

  for (const link of navLinks) {
    const url = toUrl(link);
    if (url?.protocol !== "https:") continue;
    const host = url.hostname.toLowerCase();

    const host0 = host.replace(/^www\./, "");
    // 1. A documented public ATS board named by the nav.
    const documented = DOCUMENTED_HOSTS.find((h) => h.hosts.includes(host0));
    if (documented) {
      // Greenhouse redirects www.boards... -> job-boards; keep it exact anyway.
      const slug = slugFromUrl(url);
      if (slug !== null) {
        candidates.push({
          via: "nav",
          platform: documented.platform,
          boardUrl: documented.boardUrl(host0, slug),
          probeUrl: documented.listingUrl(slug),
          acceptsBody: (body) => parseJsonListing(body, documented.accepts),
        });
      }
      continue;
    }

    // 2. The brand's own careers subdomain, only when the nav named it.
    const firstLabel = host.split(".")[0] ?? "";
    if (CAREERS_LABELS.includes(firstLabel) && isSubdomainOf(host, domain)) {
      candidates.push({
        via: "subdomain",
        platform: "self",
        boardUrl: `${url.origin}${url.pathname}`,
        probeUrl: url.href,
        acceptsBody: isHtmlListing,
      });
    }
  }

  return candidates;
}

/**
 * Discover a brand's real job board from its nav links.
 *
 * Probes candidates in nav order and returns the first the listing endpoint
 * proves. Returns an honest `none` when the nav names no board, or when every
 * named shape fails its probe — never a guess.
 */
export async function discoverBoard(
  navLinks: readonly string[],
  domain: string,
  options: DiscoverOptions = {},
): Promise<DiscoveredBoard> {
  const probe = options.probe ?? defaultProbe;
  const candidates = candidatesFor(navLinks, domain);

  for (const candidate of candidates) {
    const response = await probe(candidate.probeUrl);
    if (!response.ok) continue;
    if (!candidate.acceptsBody(response.body, response.contentType)) continue;
    return { platform: candidate.platform, boardUrl: candidate.boardUrl, via: candidate.via };
  }

  return { platform: "none", boardUrl: null, via: "none" };
}

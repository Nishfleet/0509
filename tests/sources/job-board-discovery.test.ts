import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  ASHBY_API_URL,
  GREENHOUSE_API_URL,
  LEVER_API_URL,
  discoverJobBoard,
  findBoardInHtml,
  findCareersLink,
  guessBoardFromDomain,
} from "~/lib/sources/hiring/job-board-discovery.server";
import type {
  DiscoverOptions,
  FetchFn,
} from "~/lib/sources/hiring/job-board-discovery.server";
import type { SourceFetchContext } from "~/lib/sources/types";

/**
 * Job-board slug discovery (#2199). Fixtures are real HTML/JSON files; every
 * network call goes through an injected `fetchFn` (never `globalThis.fetch`).
 */

const FIXTURES = path.join(__dirname, "..", "fixtures", "job-boards");

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), "utf8");
}

const greenhouseHtml = readFixture("greenhouse.html");
const ashbyHtml = readFixture("ashby.html");
const leverHtml = readFixture("lever.html");
const subdomainHtml = readFixture("subdomain.html");
const noBoardHtml = readFixture("no-board.html");

const competitor: SourceFetchContext = {
  competitorId: "wl-1",
  competitorLabel: "Acme",
};

function urlOf(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** Injected fetch that records URLs and routes them to canned responses. */
function routedFetch(
  routes: Record<string, () => Response | Promise<Response>>,
): { fn: FetchFn; calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = urlOf(input);
    calls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    return route();
  }) as FetchFn;
  return { fn, calls };
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

describe("findBoardInHtml", () => {
  it("reads a boards.greenhouse.io/<slug> board from the homepage fixture", () => {
    expect(findBoardInHtml(greenhouseHtml)).toEqual({
      provider: "greenhouse",
      slug: "acme",
    });
  });

  it("reads a job-boards.greenhouse.io/<slug> board", () => {
    expect(
      findBoardInHtml(
        '<a href="https://job-boards.greenhouse.io/acme/jobs">Open roles</a>',
      ),
    ).toEqual({ provider: "greenhouse", slug: "acme" });
  });

  it("reads a jobs.ashbyhq.com/<slug> board from the homepage fixture", () => {
    expect(findBoardInHtml(ashbyHtml)).toEqual({
      provider: "ashby",
      slug: "gamma",
    });
  });

  it("reads a jobs.lever.co/<slug> board from the homepage fixture", () => {
    expect(findBoardInHtml(leverHtml)).toEqual({
      provider: "lever",
      slug: "beta",
    });
  });

  it("reads a bare <slug>.greenhouse.io host as a Greenhouse board", () => {
    expect(findBoardInHtml(subdomainHtml)).toEqual({
      provider: "greenhouse",
      slug: "delta",
    });
  });

  it("returns null for a page with no board (no-board.html)", () => {
    expect(findBoardInHtml(noBoardHtml)).toBeNull();
    expect(findBoardInHtml(readFixture("404.html"))).toBeNull();
    expect(findBoardInHtml("<p>Nothing to see here.</p>")).toBeNull();
    // A bare vendor host with no company slug is not a board.
    expect(findBoardInHtml('<a href="https://greenhouse.io">Greenhouse</a>')).toBeNull();
  });

  it("is case-insensitive and lowercases the slug it returns", () => {
    expect(
      findBoardInHtml('<a href="https://BOARDS.GREENHOUSE.IO/Acme/jobs/1">x</a>'),
    ).toEqual({ provider: "greenhouse", slug: "acme" });
    expect(
      findBoardInHtml('<a href="https://jobs.lever.co/Beta/abc-123">x</a>'),
    ).toEqual({ provider: "lever", slug: "beta" });
  });

  it("lowercases a mixed-case board URL from every provider shape", () => {
    expect(
      findBoardInHtml('<a href="https://jobs.ashbyhq.com/Gamma">Gamma</a>'),
    ).toEqual({ provider: "ashby", slug: "gamma" });
    expect(
      findBoardInHtml('<a href="https://job-boards.greenhouse.io/Acme">Acme</a>'),
    ).toEqual({ provider: "greenhouse", slug: "acme" });
    expect(
      findBoardInHtml('<a href="https://Delta.Greenhouse.IO">Delta</a>'),
    ).toEqual({ provider: "greenhouse", slug: "delta" });
  });

  it("still filters reserved platform slugs after lowercasing", () => {
    expect(
      findBoardInHtml('<a href="https://boards.greenhouse.io/EMBED">Apply</a>'),
    ).toBeNull();
    expect(
      findBoardInHtml('<a href="https://JOBS.greenhouse.io">Jobs</a>'),
    ).toBeNull();
  });

  describe("provider priority", () => {
    const lever = '<a href="https://jobs.lever.co/beta">Beta</a>';
    const ashby = '<a href="https://jobs.ashbyhq.com/gamma">Gamma</a>';
    const boards = '<a href="https://boards.greenhouse.io/acme">Acme</a>';
    const subdomain = '<a href="https://delta.greenhouse.io">Delta</a>';

    it("prefers Greenhouse over Lever and Ashby regardless of document order", () => {
      expect(findBoardInHtml(lever + ashby + boards)).toEqual({
        provider: "greenhouse",
        slug: "acme",
      });
      expect(findBoardInHtml(boards + lever + ashby)).toEqual({
        provider: "greenhouse",
        slug: "acme",
      });
    });

    it("prefers job-boards Greenhouse over Lever", () => {
      expect(
        findBoardInHtml(
          '<a href="https://job-boards.greenhouse.io/acme">Acme</a>' + lever,
        ),
      ).toEqual({ provider: "greenhouse", slug: "acme" });
    });

    it("prefers Lever over Ashby regardless of document order", () => {
      expect(findBoardInHtml(ashby + lever)).toEqual({
        provider: "lever",
        slug: "beta",
      });
      expect(findBoardInHtml(lever + ashby)).toEqual({
        provider: "lever",
        slug: "beta",
      });
    });

    it("prefers Ashby over a bare Greenhouse subdomain", () => {
      expect(findBoardInHtml(subdomain + ashby)).toEqual({
        provider: "ashby",
        slug: "gamma",
      });
    });

    it("prefers Lever over a bare Greenhouse subdomain", () => {
      expect(findBoardInHtml(subdomain + lever)).toEqual({
        provider: "lever",
        slug: "beta",
      });
    });

    it("keeps the fixture priority promise: one board, first provider by rank", () => {
      expect(findBoardInHtml(subdomain + ashby + lever + boards)).toEqual({
        provider: "greenhouse",
        slug: "acme",
      });
    });
  });

  describe("reserved platform slugs", () => {
    it("skips Greenhouse platform chrome slugs (embed, boards)", () => {
      expect(
        findBoardInHtml(
          '<a href="https://boards.greenhouse.io/embed/job_app?token=1">Apply</a>',
        ),
      ).toBeNull();
      expect(
        findBoardInHtml(
          '<a href="https://job-boards.greenhouse.io/boards">All boards</a>',
        ),
      ).toBeNull();
      // A bare, slug-less platform host is chrome too.
      expect(
        findBoardInHtml('<a href="https://boards.greenhouse.io">Boards</a>'),
      ).toBeNull();
    });

    it("still finds a real board after skipping reserved slugs", () => {
      expect(
        findBoardInHtml(
          '<a href="https://boards.greenhouse.io/embed/job_app?token=1">Apply</a>' +
            '<a href="https://jobs.lever.co/beta">See roles</a>',
        ),
      ).toEqual({ provider: "lever", slug: "beta" });
    });

    it("never mistakes the greenhouse.io API host for a company slug", () => {
      expect(
        findBoardInHtml(
          '<a href="https://boards-api.greenhouse.io/v1/boards/acme/jobs">API</a>',
        ),
      ).toBeNull();
    });
  });
});

describe("findCareersLink", () => {
  it("matches on anchor text /careers|jobs|join/i", () => {
    expect(
      findCareersLink('<a href="/about">Careers</a>', "https://acme.com"),
    ).toBe("https://acme.com/about");
    expect(
      findCareersLink('<a href="/team">Join us</a>', "https://acme.com"),
    ).toBe("https://acme.com/team");
    expect(
      findCareersLink("<a href='/team'>Join the team</a>", "https://acme.com"),
    ).toBe("https://acme.com/team");
  });

  it("matches on an href of /careers or /jobs even when the text does not", () => {
    expect(
      findCareersLink('<a href="/jobs">Work here</a>', "https://acme.com"),
    ).toBe("https://acme.com/jobs");
    expect(
      findCareersLink('<a href="/careers/">Work here</a>', "https://acme.com"),
    ).toBe("https://acme.com/careers/");
  });

  it("matches an absolute careers link on its resolved pathname", () => {
    expect(
      findCareersLink(
        '<a href="https://acme.com/careers">Open positions</a>',
        "https://acme.com",
      ),
    ).toBe("https://acme.com/careers");
    // With a trailing path, and on another host's absolute URL.
    expect(
      findCareersLink(
        '<a href="https://www.acme.com/jobs/all">Open positions</a>',
        "https://acme.com",
      ),
    ).toBe("https://www.acme.com/jobs/all");
    // A resolved pathname that is not /careers|/jobs still does not match.
    expect(
      findCareersLink(
        '<a href="https://acme.com/about">Open positions</a>',
        "https://acme.com",
      ),
    ).toBeNull();
  });

  it("resolves relative hrefs against the page URL", () => {
    expect(
      findCareersLink('<a href="careers">Careers</a>', "https://acme.com/company/"),
    ).toBe("https://acme.com/company/careers");
    expect(
      findCareersLink(
        '<a href="../jobs">Jobs</a>',
        "https://acme.com/company/team/",
      ),
    ).toBe("https://acme.com/company/jobs");
    expect(
      findCareersLink('<a href="/careers">Careers</a>', "https://acme.com/company/team"),
    ).toBe("https://acme.com/careers");
  });

  it("skips fragment and mailto hrefs, and empty hrefs", () => {
    expect(
      findCareersLink(
        '<a href="#careers">Careers</a><a href="mailto:jobs@acme.com">Careers</a><a href="">Jobs</a><a href="/jobs">Jobs</a>',
        "https://acme.com",
      ),
    ).toBe("https://acme.com/jobs");
  });

  it("returns null when nothing qualifies", () => {
    expect(
      findCareersLink(
        '<a href="/about">About</a><p>Careers page coming later.</p>',
        "https://acme.com",
      ),
    ).toBeNull();
    expect(findCareersLink("<p>No anchors at all</p>", "https://acme.com")).toBeNull();
    // An absolute board URL is not a careers link on the competitor's site.
    expect(
      findCareersLink(
        '<a href="https://jobs.lever.co/beta">Work with us</a>',
        "https://acme.com",
      ),
    ).toBeNull();
  });

  it("skips an unparsable href and still returns a later careers link", () => {
    expect(
      findCareersLink(
        '<a href="http://[bad/careers">Careers</a><a href="/careers">Careers</a>',
        "https://acme.com",
      ),
    ).toBe("https://acme.com/careers");
  });

  it("returns the first qualifying link in document order", () => {
    expect(
      findCareersLink(
        '<a href="/jobs">Jobs</a><a href="/careers">Careers</a>',
        "https://acme.com",
      ),
    ).toBe("https://acme.com/jobs");
  });

  it("finds the careers link in the homepage fixture and the no-board fixture", () => {
    expect(findCareersLink(greenhouseHtml, "https://acme.com")).toBe(
      "https://acme.com/careers",
    );
    expect(findCareersLink(noBoardHtml, "https://acme.com")).toBe(
      "https://acme.com/careers",
    );
  });
});

describe("guessBoardFromDomain", () => {
  function bodyResponse(status: number): Response {
    return new Response(status === 200 ? "{}" : null, { status });
  }

  it("probes Greenhouse, then Ashby, then Lever and keeps the first 200", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      calls.push(urlOf(input));
      // Greenhouse is not this company, Ashby is.
      return bodyResponse(calls.length === 1 ? 404 : 200);
    }) as unknown as FetchFn;

    await expect(guessBoardFromDomain("acme", fetchFn)).resolves.toEqual({
      provider: "ashby",
      slug: "acme",
    });
    expect(calls).toEqual([
      `${GREENHOUSE_API_URL}/v1/boards/acme/jobs`,
      `${ASHBY_API_URL}/posting-api/job-board/acme`,
    ]);
  });

  it("keeps the first 200 (Greenhouse) and stops probing", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      calls.push(urlOf(input));
      return bodyResponse(200);
    }) as unknown as FetchFn;

    await expect(guessBoardFromDomain("acme", fetchFn)).resolves.toEqual({
      provider: "greenhouse",
      slug: "acme",
    });
    expect(calls).toEqual([`${GREENHOUSE_API_URL}/v1/boards/acme/jobs`]);
  });

  it("returns null when all three providers answer non-200", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      calls.push(urlOf(input));
      return bodyResponse(404);
    }) as unknown as FetchFn;

    await expect(guessBoardFromDomain("acme", fetchFn)).resolves.toBeNull();
    expect(calls).toEqual([
      `${GREENHOUSE_API_URL}/v1/boards/acme/jobs`,
      `${ASHBY_API_URL}/posting-api/job-board/acme`,
      `${LEVER_API_URL}/v0/postings/acme?mode=json`,
    ]);
  });

  it("continues to the next provider when a probe throws or aborts", async () => {
    const aborted = () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    };
    const calls: string[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = urlOf(input);
      calls.push(url);
      if (url.startsWith(GREENHOUSE_API_URL)) aborted();
      return bodyResponse(200);
    }) as unknown as FetchFn;

    await expect(guessBoardFromDomain("acme", fetchFn)).resolves.toEqual({
      provider: "ashby",
      slug: "acme",
    });
    expect(calls).toEqual([
      `${GREENHOUSE_API_URL}/v1/boards/acme/jobs`,
      `${ASHBY_API_URL}/posting-api/job-board/acme`,
    ]);
  });

  it("continues past a thrown probe and a 404 to Lever", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = urlOf(input);
      calls.push(url);
      if (url.startsWith(GREENHOUSE_API_URL)) throw new Error("socket hang up");
      return bodyResponse(url.startsWith(ASHBY_API_URL) ? 404 : 200);
    }) as unknown as FetchFn;

    await expect(guessBoardFromDomain("acme", fetchFn)).resolves.toEqual({
      provider: "lever",
      slug: "acme",
    });
    expect(calls).toHaveLength(3);
  });

  it("lowercases the domain label before probing", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      calls.push(urlOf(input));
      return bodyResponse(200);
    }) as unknown as FetchFn;

    await expect(guessBoardFromDomain("ACME", fetchFn)).resolves.toEqual({
      provider: "greenhouse",
      slug: "acme",
    });
    expect(calls[0]).toBe(`${GREENHOUSE_API_URL}/v1/boards/acme/jobs`);
  });
});

describe("discoverJobBoard", () => {
  const home = "https://acme.com";
  const careers = "https://acme.com/careers";
  const greenhouseProbe = `${GREENHOUSE_API_URL}/v1/boards/acme/jobs`;
  const ashbyProbe = `${ASHBY_API_URL}/posting-api/job-board/acme`;
  const leverProbe = `${LEVER_API_URL}/v0/postings/acme?mode=json`;

  function discover(
    routes: Record<string, () => Response | Promise<Response>>,
  ): { result: ReturnType<typeof discoverJobBoard>; calls: string[] } {
    const { fn, calls } = routedFetch(routes);
    const opts: DiscoverOptions = { domain: "acme.com", fetchFn: fn };
    return { result: discoverJobBoard(null, competitor, opts), calls };
  }

  it("returns verified:true on a homepage HTML hit and never fetches a careers page", async () => {
    const { result, calls } = discover({ [home]: () => htmlResponse(greenhouseHtml) });

    await expect(result).resolves.toEqual({
      provider: "greenhouse",
      slug: "acme",
      verified: true,
    });
    expect(calls).toEqual([home]);
  });

  it("returns verified:true when the careers link carries the board", async () => {
    const { result, calls } = discover({
      [home]: () =>
        htmlResponse('<a href="/careers">Careers</a><p>No board here.</p>'),
      [careers]: () => htmlResponse(greenhouseHtml),
    });

    await expect(result).resolves.toEqual({
      provider: "greenhouse",
      slug: "acme",
      verified: true,
    });
    expect(calls).toEqual([home, careers]);
  });

  it("falls back to a label guess (verified:false) when neither page carries a board", async () => {
    const { result, calls } = discover({
      [home]: () => htmlResponse(noBoardHtml),
      [careers]: () => htmlResponse(noBoardHtml),
      [greenhouseProbe]: () => new Response("{}", { status: 200 }),
    });

    await expect(result).resolves.toEqual({
      provider: "greenhouse",
      slug: "acme",
      verified: false,
    });
    expect(calls).toEqual([home, careers, greenhouseProbe]);
  });

  it("returns { unavailable, site_unreachable } when the homepage fetch throws", async () => {
    const { result, calls } = discover({
      [home]: () => {
        throw new Error("ENOTFOUND");
      },
    });

    await expect(result).resolves.toEqual({
      unavailable: true,
      reason: "site_unreachable",
    });
    // One attempt, no retry, no careers page, no probe.
    expect(calls).toEqual([home]);
  });

  it("returns { unavailable, site_unreachable } when the homepage answers non-200", async () => {
    const { result, calls } = discover({
      [home]: () => htmlResponse("nope", 500),
    });

    await expect(result).resolves.toEqual({
      unavailable: true,
      reason: "site_unreachable",
    });
    expect(calls).toEqual([home]);
  });

  it("fetches exactly one careers page even when several links qualify", async () => {
    const { result, calls } = discover({
      [home]: () =>
        htmlResponse(
          '<a href="/careers">Careers</a><a href="/jobs">Jobs</a><a href="/join">Join</a>',
        ),
      [careers]: () => htmlResponse(leverHtml),
    });

    await expect(result).resolves.toEqual({
      provider: "lever",
      slug: "beta",
      verified: true,
    });
    expect(calls).toEqual([home, careers]);
    expect(calls).not.toContain("https://acme.com/jobs");
    expect(calls).not.toContain("https://acme.com/join");
  });

  it("does not retry a page that fails: one attempt per page", async () => {
    const { result, calls } = discover({
      [home]: () => htmlResponse(noBoardHtml),
      [careers]: () => htmlResponse("boom", 500),
      [greenhouseProbe]: () => new Response("{}", { status: 200 }),
    });

    await expect(result).resolves.toEqual({
      provider: "greenhouse",
      slug: "acme",
      verified: false,
    });
    expect(calls).toEqual([home, careers, greenhouseProbe]);
  });

  it("returns { board: null } when no board is found and no probe answers 200", async () => {
    const { result, calls } = discover({
      [home]: () => htmlResponse(noBoardHtml),
      [careers]: () => htmlResponse(noBoardHtml),
      [greenhouseProbe]: () => new Response(null, { status: 404 }),
      [ashbyProbe]: () => new Response(null, { status: 404 }),
      [leverProbe]: () => new Response(null, { status: 404 }),
    });

    await expect(result).resolves.toEqual({ board: null });
    expect(calls).toEqual([home, careers, greenhouseProbe, ashbyProbe, leverProbe]);
  });

  it("never fetches more than homepage + one careers page", async () => {
    const { result, calls } = discover({
      [home]: () => htmlResponse(noBoardHtml),
      [careers]: () => htmlResponse(noBoardHtml),
      [greenhouseProbe]: () => new Response(null, { status: 404 }),
      [ashbyProbe]: () => new Response(null, { status: 404 }),
      [leverProbe]: () => new Response(null, { status: 404 }),
    });

    await expect(result).resolves.toEqual({ board: null });
    const pageCalls = calls.filter((url) => !url.includes("api."));
    expect(pageCalls).toEqual([home, careers]);
  });

  it("normalizes a URL-ish domain to its host before fetching the homepage", async () => {
    const { fn, calls } = routedFetch({ [home]: () => htmlResponse(greenhouseHtml) });
    const result = await discoverJobBoard(null, competitor, {
      domain: "https://www.acme.com/",
      fetchFn: fn,
    });

    expect(result).toEqual({ provider: "greenhouse", slug: "acme", verified: true });
    expect(calls).toEqual([home]);
  });
});

import { describe, expect, it } from "vitest";

import {
  discoverBoard,
  type BoardPlatform,
  type DiscoverOptions,
  type Probe,
  type ProbeResponse,
} from "../../../app/lib/hiring/discover-board";

/** The platform names this module may report for a discovered board. */
const KNOWN_PLATFORMS: readonly BoardPlatform[] = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
  "self",
];

/**
 * Hiring board discovery (0509#4172, slice of #4162, charter #3842).
 *
 * The module turns the nav links the identity extractor already produced into
 * a real, proveable job-board URL, or an honest `none`. Two invariants are
 * under test and both are the point of the module:
 *
 *   1. The slug is read out of a nav link's documented URL shape and NEVER
 *      guessed from the domain. A probe of a constructed URL from a slug we
 *      invented is the bug this replaces.
 *   2. The brand's own careers subdomain is tried only when the nav names it.
 *      Enumerating subdomains is out of scope and not attempted.
 *
 * Every fixture response below is a verbatim excerpt of a real response taken
 * from this VPS on 2026-09-22 (see the live table in the PR body); the parser
 * accepts a board only when the documented listing field is present, so a 200
 * over an unrelated page is not a board.
 */

const OK_JSON: Pick<ProbeResponse, "ok" | "contentType"> = { ok: true, contentType: "application/json" };

/** A probe stub: maps a requested URL to a canned response, records the calls. */
function stubProbe(routes: Record<string, ProbeResponse | (() => ProbeResponse)>): {
  probe: Probe;
  calls: string[];
} {
  const calls: string[] = [];
  const probe = (async (url: string) => {
    calls.push(url);
    const hit = routes[url];
    if (hit === undefined) return { ok: false, contentType: null, body: "" };
    return typeof hit === "function" ? hit() : hit;
  }) as Probe;
  return { probe, calls };
}

describe("discoverBoard", () => {
  it("returns an honest none for an empty nav, without probing", async () => {
    const options: DiscoverOptions = { probe: stubProbe({}).probe };
    const board = await discoverBoard([], "gymshark.com", options);
    const platform: BoardPlatform | "none" = board.platform;
    expect(platform).toBe("none");
    expect(KNOWN_PLATFORMS).not.toContain(board.platform);
  });

  it("reads a greenhouse slug from the nav shape and probes the documented API", async () => {
    // Nav carries the EU board URL; the slug is the first path segment, and the
    // listing API is the US host (the EU API host does not resolve — 2026-09-22).
    const navLink = "https://job-boards.eu.greenhouse.io/gymshark/jobs/4981295101";
    const { probe, calls } = stubProbe({
      "https://boards-api.greenhouse.io/v1/boards/gymshark/jobs": {
        ...OK_JSON,
        body: '{"jobs":[{"absolute_url":"https://job-boards.eu.greenhouse.io/gymshark/jobs/4981295101"}]}',
      },
    });

    const board = await discoverBoard([navLink, "https://www.gymshark.com/"], "gymshark.com", { probe });

    expect(board).toEqual({
      platform: "greenhouse",
      boardUrl: "https://job-boards.eu.greenhouse.io/gymshark",
      via: "nav",
    });
    // Probed the documented greenhouse JSON API for the nav's own slug.
    expect(calls).toEqual(["https://boards-api.greenhouse.io/v1/boards/gymshark/jobs"]);
  });

  it("uses the US greenhouse API host when the nav board URL is not on the EU host", async () => {
    const navLink = "https://job-boards.greenhouse.io/stripe";
    const { probe, calls } = stubProbe({
      "https://boards-api.greenhouse.io/v1/boards/stripe/jobs": {
        ...OK_JSON,
        body: '{"jobs":[{"absolute_url":"https://stripe.com/jobs/search?gh_jid=1"}]}',
      },
    });

    const board = await discoverBoard([navLink], "stripe.com", { probe });
    expect(board.platform).toBe("greenhouse");
    expect(board.boardUrl).toBe("https://job-boards.greenhouse.io/stripe");
    expect(calls).toEqual(["https://boards-api.greenhouse.io/v1/boards/stripe/jobs"]);
  });

  it("maps the legacy boards.greenhouse.io host to the job-boards board URL", async () => {
    const { probe } = stubProbe({
      "https://boards-api.greenhouse.io/v1/boards/figma/jobs": { ...OK_JSON, body: '{"jobs":[]}' },
    });
    const board = await discoverBoard(["https://boards.greenhouse.io/figma"], "figma.com", { probe });
    expect(board).toEqual({ platform: "greenhouse", boardUrl: "https://job-boards.greenhouse.io/figma", via: "nav" });
  });

  it("reads a lever slug and accepts a JSON array listing", async () => {
    const navLink = "https://jobs.lever.co/spotify";
    const { probe, calls } = stubProbe({
      "https://api.lever.co/v0/postings/spotify?mode=json": {
        ...OK_JSON,
        body: '[{"id":"x","text":"Engineer","categories":{"team":"Eng"}}]',
      },
    });

    const board = await discoverBoard([navLink], "spotify.com", { probe });
    expect(board).toEqual({
      platform: "lever",
      boardUrl: "https://jobs.lever.co/spotify",
      via: "nav",
    });
    expect(calls).toEqual(["https://api.lever.co/v0/postings/spotify?mode=json"]);
  });

  it("reads an ashby slug and requires the documented jobs field", async () => {
    const navLink = "https://jobs.ashbyhq.com/ramp";
    const { probe, calls } = stubProbe({
      "https://api.ashbyhq.com/posting-api/job-board/ramp": {
        ...OK_JSON,
        body: '{"jobs":[{"id":"34413f8d","title":"Security Engineer, Cloud","department":"Engineering"}]}',
      },
    });

    const board = await discoverBoard([navLink], "ramp.com", { probe });
    expect(board).toEqual({ platform: "ashby", boardUrl: "https://jobs.ashbyhq.com/ramp", via: "nav" });
    expect(calls).toEqual(["https://api.ashbyhq.com/posting-api/job-board/ramp"]);
  });

  it("reads a workable account slug and accepts an empty but real jobs list", async () => {
    // A real workable account answers 200 with a valid, empty jobs array — a
    // real board, just with zero open roles. That is still discoverable.
    const navLink = "https://apply.workable.com/spotify/";
    const { probe, calls } = stubProbe({
      "https://apply.workable.com/api/v1/widget/accounts/spotify": {
        ...OK_JSON,
        body: '{"name":"Spotify","description":"","jobs":[]}',
      },
    });

    const board = await discoverBoard([navLink], "spotify.com", { probe });
    expect(board).toEqual({
      platform: "workable",
      boardUrl: "https://apply.workable.com/spotify",
      via: "nav",
    });
    expect(calls).toEqual(["https://apply.workable.com/api/v1/widget/accounts/spotify"]);
  });

  it("reads a smartrecruiters company slug and requires the content field", async () => {
    const navLink = "https://jobs.smartrecruiters.com/Visa";
    const { probe, calls } = stubProbe({
      "https://api.smartrecruiters.com/v1/companies/Visa/postings": {
        ...OK_JSON,
        body: '{"offset":0,"limit":100,"totalFound":0,"content":[]}',
      },
    });

    const board = await discoverBoard([navLink], "visa.com", { probe });
    expect(board).toEqual({
      platform: "smartrecruiters",
      boardUrl: "https://jobs.smartrecruiters.com/Visa",
      via: "nav",
    });
    expect(calls).toEqual(["https://api.smartrecruiters.com/v1/companies/Visa/postings"]);
  });

  it("tries the brand's own careers subdomain only when the nav names it", async () => {
    const navLink = "https://careers.dropbox.com/";
    const { probe, calls } = stubProbe({
      [navLink]: { ok: true, contentType: "text/html; charset=utf-8", body: "<html><body>".concat("x".repeat(400)) },
    });

    const board = await discoverBoard([navLink, "https://www.dropbox.com/"], "dropbox.com", { probe });
    expect(board).toEqual({ platform: "self", boardUrl: "https://careers.dropbox.com/", via: "subdomain" });
    // Probed exactly the nav-named subdomain, no enumeration.
    expect(calls).toEqual([navLink]);
  });

  it("returns an honest none when the board probe is a non-2xx", async () => {
    // A documented shape in the nav but the listing 404s: not a board we track.
    // The 404 reaches us as `ok: false`, which is the branch under test.
    const { probe } = stubProbe({
      "https://api.lever.co/v0/postings/netflix?mode=json": { ok: false, contentType: null, body: "" },
    });

    const board = await discoverBoard(["https://jobs.lever.co/netflix"], "netflix.com", { probe });
    expect(board).toEqual({ platform: "none", boardUrl: null, via: "none" });
  });

  it("returns an honest none for a 2xx that is missing the documented listing field", async () => {
    // A 200 that parses as JSON but is not a jobs/content listing is not a board.
    const { probe } = stubProbe({
      "https://api.ashbyhq.com/posting-api/job-board/notaboard": { ...OK_JSON, body: '{"error":"nope"}' },
    });

    const board = await discoverBoard(["https://jobs.ashbyhq.com/notaboard"], "notaboard.com", { probe });
    expect(board).toEqual({ platform: "none", boardUrl: null, via: "none" });
  });

  it("returns an honest none for nav links that name no board and no careers subdomain", async () => {
    const { probe, calls } = stubProbe({});
    const board = await discoverBoard(
      ["https://www.gymshark.com/", "https://www.gymshark.com/collections/all-products"],
      "gymshark.com",
      { probe },
    );
    expect(board).toEqual({ platform: "none", boardUrl: null, via: "none" });
    // Nothing matched a shape, so nothing was probed — no guessing, no enumeration.
    expect(calls).toEqual([]);
  });

  it("never guesses a slug from the domain when the nav omits the board", async () => {
    // The defect this module exists to prevent: constructing a board URL from a
    // guessed slug. gymshark HAS a greenhouse board, but if the nav does not say
    // so, we must not fetch boards-api.greenhouse.io/v1/boards/gymshark/jobs.
    const { probe, calls } = stubProbe({
      "https://boards-api.greenhouse.io/v1/boards/gymshark/jobs": { ...OK_JSON, body: '{"jobs":[]}' },
    });
    const board = await discoverBoard(["https://gymshark.com/", "https://gymshark.com/shop"], "gymshark.com", { probe });
    expect(board.via).toBe("none");
    expect(calls).toEqual([]);
  });

  it("does not treat an unrelated subdomain as a careers board", async () => {
    const { probe, calls } = stubProbe({
      "https://shop.gymshark.com/": { ok: true, contentType: "text/html", body: "<html>".concat("x".repeat(400)) },
    });
    const board = await discoverBoard(["https://shop.gymshark.com/"], "gymshark.com", { probe });
    expect(board.via).toBe("none");
    expect(calls).toEqual([]);
  });

  it("skips a failed ATS probe and accepts the next board the nav names", async () => {
    const { probe } = stubProbe({
      // First nav candidate: greenhouse shape whose listing 404s (non-2xx).
      "https://boards-api.greenhouse.io/v1/boards/typo/jobs": { ok: false, contentType: null, body: "" },
      // Second nav candidate: a real lever board.
      "https://api.lever.co/v0/postings/realbrand?mode=json": { ...OK_JSON, body: "[]" },
    });

    const board = await discoverBoard(
      ["https://job-boards.greenhouse.io/typo", "https://jobs.lever.co/realbrand"],
      "realbrand.com",
      { probe },
    );
    expect(board).toEqual({ platform: "lever", boardUrl: "https://jobs.lever.co/realbrand", via: "nav" });
  });

  it("ignores malformed nav URLs instead of throwing", async () => {
    const { probe } = stubProbe({
      "https://api.lever.co/v0/postings/ok?mode=json": { ...OK_JSON, body: "[]" },
    });
    const board = await discoverBoard(["not a url", "javascript:void(0)", "https://jobs.lever.co/ok"], "ok.com", {
      probe,
    });
    expect(board.platform).toBe("lever");
  });

  it("caps the careers-subdomain HTML body at a minimum parseable size", async () => {
    // A 2xx whose body is a near-empty stub page is not a listing we can read.
    const { probe } = stubProbe({
      "https://careers.tinybrand.com/": { ok: true, contentType: "text/html", body: "<html></html>" },
    });
    const board = await discoverBoard(["https://careers.tinybrand.com/"], "tinybrand.com", { probe });
    expect(board.via).toBe("none");
  });
});

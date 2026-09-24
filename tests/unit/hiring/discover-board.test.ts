import { describe, expect, it } from "vitest";

import { discoverBoard, type Probe, type ProbeResponse } from "../../../app/lib/hiring/discover-board";

const KNOWN_PLATFORMS = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters"] as const;

const JSON_TYPE = "application/json";

const HTML_TYPE = "text/html; charset=utf-8";

const GH_URL = (slug: string) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;

const GH_BODY = (title: string) => JSON.stringify({ jobs: [{ absolute_url: "https://job-boards.greenhouse.io/x", title }] });

function jsonResponse(body: string, ok = true): ProbeResponse {
  return { ok, contentType: JSON_TYPE, body };
}

function htmlResponse(body: string, ok = true): ProbeResponse {
  return { ok, contentType: HTML_TYPE, body };
}

function failingProbe(urls: readonly string[]): { probe: Probe; calls: string[] } {
  const calls: string[] = [];
  const probe = (async (url: string) => {
    calls.push(url);
    return { ok: false, contentType: null, body: "" };
  }) as Probe;
  void urls;
  return { probe, calls };
}

function recordingProbe(routes: Record<string, ProbeResponse | (() => ProbeResponse)>): { probe: Probe; calls: string[] } {
  const calls: string[] = [];
  const probe = (async (url: string) => {
    calls.push(url);
    const hit = routes[url];
    if (hit === undefined) return { ok: false, contentType: null, body: "" };
    return typeof hit === "function" ? hit() : hit;
  }) as Probe;
  return { probe, calls };
}

const NONE = { platform: "none", boardUrl: null, via: "none" } as const;

describe("discoverBoard", () => {
  it("returns none, probing nothing, for an empty nav", async () => {
    const { probe, calls } = recordingProbe({});
    const board = await discoverBoard([], "gymshark.com", { probe });
    expect(board).toEqual(NONE);
    expect(calls).toEqual([]);
    expect(KNOWN_PLATFORMS).not.toContain(board.platform);
  });

  it("reads a greenhouse slug out of the nav shape and probes the documented API", async () => {
    const { probe, calls } = recordingProbe({
      [GH_URL("gymshark")]: jsonResponse(GH_BODY("Department Manager - Bond Street, New York")),
    });

    const board = await discoverBoard(
      ["https://job-boards.eu.greenhouse.io/gymshark/jobs/4981295101", "https://www.gymshark.com/"],
      "gymshark.com",
      { probe },
    );

    expect(board).toEqual({
      platform: "greenhouse",
      boardUrl: `https://job-boards.eu.greenhouse.io/gymshark`,
      via: "nav",
    });
    expect(calls).toEqual([GH_URL("gymshark")]);
  });

  it("probes the US listing API whatever the board host the nav named", async () => {
    const { probe, calls } = recordingProbe({ [GH_URL("stripe")]: jsonResponse(GH_BODY("Full Stack Engineer")) });

    const board = await discoverBoard(["https://job-boards.greenhouse.io/stripe"], "stripe.com", { probe });

    expect(board.platform).toBe("greenhouse");
    expect(board.boardUrl).toBe("https://job-boards.greenhouse.io/stripe");
    expect(calls).toEqual([GH_URL("stripe")]);
  });

  it("keeps the board host the nav named, including a legacy boards host", async () => {
    const { probe } = recordingProbe({ [GH_URL("figma")]: jsonResponse(GH_BODY("Product Designer")) });

    const board = await discoverBoard(["https://boards.greenhouse.io/figma"], "figma.com", { probe });

    expect(board.boardUrl).toBe("https://boards.greenhouse.io/figma");
  });

  it("reads a lever slug and accepts the bare postings array", async () => {
    const { probe, calls } = recordingProbe({
      "https://api.lever.co/v0/postings/spotify?mode=json": jsonResponse(
        JSON.stringify([{ id: "f2f4e3b1-0000-0000-0000-000000000000", text: "Staff Engineer", categories: {} }]),
      ),
    });

    const board = await discoverBoard(["https://jobs.lever.co/spotify"], "spotify.com", { probe });

    expect(board).toEqual({ platform: "lever", boardUrl: "https://jobs.lever.co/spotify", via: "nav" });
    expect(calls).toEqual(["https://api.lever.co/v0/postings/spotify?mode=json"]);
  });

  it("reads an ashby slug and requires the documented jobs object", async () => {
    const { probe } = recordingProbe({
      "https://api.ashbyhq.com/posting-api/job-board/ramp": jsonResponse(
        JSON.stringify({ jobs: [{ id: "34413f8d", title: "Security Engineer, Cloud" }] }),
      ),
    });

    const board = await discoverBoard(["https://jobs.ashbyhq.com/ramp"], "ramp.com", { probe });

    expect(board).toEqual({ platform: "ashby", boardUrl: "https://jobs.ashbyhq.com/ramp", via: "nav" });
  });

  it("accepts a real workable account whose jobs list is empty", async () => {
    const { probe } = recordingProbe({
      "https://apply.workable.com/api/v1/widget/accounts/zapier": jsonResponse(
        JSON.stringify({ name: "Zapier", description: "", jobs: [] }),
      ),
    });

    const board = await discoverBoard(["https://apply.workable.com/zapier/"], "zapier.com", { probe });

    expect(board).toEqual({ platform: "workable", boardUrl: "https://apply.workable.com/zapier", via: "nav" });
  });

  it("reads a smartrecruiters company slug and requires the content field", async () => {
    const { probe } = recordingProbe({
      "https://api.smartrecruiters.com/v1/companies/Visa/postings": jsonResponse(
        JSON.stringify({ offset: 0, limit: 100, totalFound: 0, content: [] }),
      ),
    });

    const board = await discoverBoard(["https://jobs.smartrecruiters.com/Visa"], "visa.com", { probe });

    expect(board).toEqual({ platform: "smartrecruiters", boardUrl: "https://jobs.smartrecruiters.com/Visa", via: "nav" });
  });

  it("follows a nav-named careers lead to the board its page names, and probes only that", async () => {
    const leadUrl = "https://careers.webflow.com/";
    const { probe, calls } = recordingProbe({
      [leadUrl]: htmlResponse(
        `<a href="https://job-boards.greenhouse.io/webflow/jobs/6709861">Open role</a>` + "x".repeat(220),
      ),
      [GH_URL("webflow")]: jsonResponse(GH_BODY("Senior Account Executive")),
    });

    const board = await discoverBoard([leadUrl, "https://webflow.com/"], "webflow.com", { probe });

    expect(board).toEqual({ platform: "greenhouse", boardUrl: "https://job-boards.greenhouse.io/webflow", via: "subdomain" });
    expect(calls).toEqual([leadUrl, GH_URL("webflow")]);
  });

  it("probes a lead-revealed board once per distinct URL, never once per match", async () => {
    const leadUrl = "https://careers.webflow.com/";
    const { probe, calls } = recordingProbe({
      [leadUrl]: htmlResponse(
        `<a href="https://job-boards.greenhouse.io/webflow/jobs/6709861">one</a>` +
          `<a href="https://job-boards.greenhouse.io/webflow/jobs/7942745">two</a>` +
          `<a href="https://job-boards.greenhouse.io/webflow/jobs/8001004">three</a>` +
          "x".repeat(220),
      ),
      [GH_URL("webflow")]: jsonResponse(GH_BODY("Senior Account Executive")),
    });

    const board = await discoverBoard([leadUrl], "webflow.com", { probe });

    expect(board).toEqual({
      platform: "greenhouse",
      boardUrl: "https://job-boards.greenhouse.io/webflow",
      via: "subdomain",
    });
    expect(calls).toEqual([leadUrl, GH_URL("webflow")]);
  });

  it("probes a lead-revealed board once even when its listing probe fails", async () => {
    const leadUrl = "https://careers.webflow.com/";
    const { probe, calls } = recordingProbe({
      [leadUrl]: htmlResponse(
        `<a href="https://job-boards.greenhouse.io/webflow/jobs/6709861">one</a>` +
          `<a href="https://job-boards.greenhouse.io/webflow/jobs/7942745">two</a>` +
          `<a href="https://job-boards.greenhouse.io/webflow/jobs/8001004">three</a>` +
          "x".repeat(220),
      ),
      [GH_URL("webflow")]: jsonResponse(GH_BODY("Senior Account Executive"), false),
    });

    const board = await discoverBoard([leadUrl], "webflow.com", { probe });

    expect(board).toEqual(NONE);
    expect(calls).toEqual([leadUrl, GH_URL("webflow")]);
  });

  it("rejects a lead page that 200s but names no documented board", async () => {
    const leadUrl = "https://careers.airbnb.com/";
    const { probe, calls } = recordingProbe({
      [leadUrl]: htmlResponse(`<html><body><div id=root></div>${"x".repeat(3000)}</body></html>`),
      [GH_URL("airbnb")]: jsonResponse(GH_BODY("Anything")),
    });

    const board = await discoverBoard([leadUrl], "airbnb.com", { probe });

    expect(board).toEqual(NONE);
    expect(calls).toEqual([leadUrl]);
  });

  it("rejects a lead page whose body is not worth scanning", async () => {
    const leadUrl = "https://careers.tinybrand.com/";
    const { probe } = recordingProbe({ [leadUrl]: htmlResponse("<html></html>") });

    const board = await discoverBoard([leadUrl], "tinybrand.com", { probe });

    expect(board).toEqual(NONE);
  });

  it("returns none when the careers lead itself is a non-2xx", async () => {
    const leadUrl = "https://careers.gymshark.com/";
    const { probe } = recordingProbe({ [leadUrl]: { ok: false, contentType: null, body: "" } });

    const board = await discoverBoard([leadUrl], "gymshark.com", { probe });

    expect(board).toEqual(NONE);
  });

  it("returns none when a named board's listing answers non-2xx", async () => {
    const { probe, calls } = recordingProbe({
      "https://api.lever.co/v0/postings/netflix?mode=json": jsonResponse(
        JSON.stringify({ ok: false, error: "Document not found" }),
        false,
      ),
    });

    const board = await discoverBoard(["https://jobs.lever.co/netflix"], "netflix.com", { probe });

    expect(board).toEqual(NONE);
    expect(calls.length).toBe(1);
  });

  it("returns none when a 2xx listing body omits the documented field", async () => {
    const { probe } = recordingProbe({
      "https://api.ashbyhq.com/posting-api/job-board/notaboard": jsonResponse(JSON.stringify({ error: "Not Found" })),
    });

    const board = await discoverBoard(["https://jobs.ashbyhq.com/notaboard"], "notaboard.com", { probe });

    expect(board).toEqual(NONE);
  });

  it("skips a failed board and accepts the next one the nav names", async () => {
    const { probe } = recordingProbe({
      [GH_URL("typo")]: jsonResponse(GH_BODY("nope"), false),
      "https://api.lever.co/v0/postings/realbrand?mode=json": jsonResponse("[]"),
    });

    const board = await discoverBoard(
      ["https://job-boards.greenhouse.io/typo", "https://jobs.lever.co/realbrand"],
      "realbrand.com",
      { probe },
    );

    expect(board).toEqual({ platform: "lever", boardUrl: "https://jobs.lever.co/realbrand", via: "nav" });
  });

  it("never guesses a slug from the domain when the nav omits the board", async () => {
    const { probe, calls } = recordingProbe({ [GH_URL("gymshark")]: jsonResponse(GH_BODY("Anything")) });

    const board = await discoverBoard(["https://gymshark.com/", "https://gymshark.com/shop"], "gymshark.com", { probe });

    expect(board).toEqual(NONE);
    expect(calls).toEqual([]);
  });

  it("ignores nav links that name no board and no careers subdomain", async () => {
    const { probe, calls } = recordingProbe({});

    const board = await discoverBoard(
      ["https://www.gymshark.com/", "https://www.gymshark.com/collections/all-products"],
      "gymshark.com",
      { probe },
    );

    expect(board).toEqual(NONE);
    expect(calls).toEqual([]);
  });

  it("does not treat an unrelated subdomain as a careers board", async () => {
    const { probe, calls } = recordingProbe({
      "https://shop.gymshark.com/": htmlResponse(`<html>${"x".repeat(400)}</html>`),
    });

    const board = await discoverBoard(["https://shop.gymshark.com/"], "gymshark.com", { probe });

    expect(board).toEqual(NONE);
    expect(calls).toEqual([]);
  });

  it("follows a careers lead on the same registrable domain as the brand, under a two-part suffix (0509#4577)", async () => {
    const leadUrl = "https://careers.brand.co.uk/";
    const { probe, calls } = recordingProbe({
      [leadUrl]: htmlResponse(
        `<a href="https://job-boards.greenhouse.io/brand/jobs/1">Open role</a>` + "x".repeat(220),
      ),
      [GH_URL("brand")]: jsonResponse(GH_BODY("Store Manager")),
    });

    const board = await discoverBoard([leadUrl], "shop.brand.co.uk", { probe });

    expect(board).toEqual({ platform: "greenhouse", boardUrl: "https://job-boards.greenhouse.io/brand", via: "subdomain" });
    expect(calls).toEqual([leadUrl, GH_URL("brand")]);
  });

  it("does not accept a host that merely ends with the brand's domain", async () => {
    const { probe, calls } = recordingProbe({
      "https://careers.notgymshark.com/": htmlResponse(`<html>${"x".repeat(400)}</html>`),
    });

    const board = await discoverBoard(["https://careers.notgymshark.com/"], "gymshark.com", { probe });

    expect(board).toEqual(NONE);
    expect(calls).toEqual([]);
  });

  it("reads a documented board out of a lead page even when the link carries a fragment", async () => {
    const leadUrl = "https://careers.webflow.com/";
    const { probe } = recordingProbe({
      [leadUrl]: htmlResponse(
        `<a href="https://job-boards.greenhouse.io/webflow#openings">Open roles</a>` + "x".repeat(220),
      ),
      [GH_URL("webflow")]: jsonResponse(GH_BODY("Senior Account Executive")),
    });

    const board = await discoverBoard([leadUrl], "webflow.com", { probe });

    expect(board).toEqual({
      platform: "greenhouse",
      boardUrl: "https://job-boards.greenhouse.io/webflow",
      via: "subdomain",
    });
  });

  it("caps a lead-revealed fan-out at 20 probes per run", async () => {
    const leadUrl = "https://careers.acme.com/";
    const links = Array.from({ length: 50 }, (_, index) => `<a href="https://boards.greenhouse.io/slug${index}/jobs/1">role</a>`).join("");
    const { probe, calls } = recordingProbe({ [leadUrl]: htmlResponse(links + "x".repeat(220)) });

    const board = await discoverBoard([leadUrl], "acme.com", { probe });

    expect(board).toEqual(NONE);
    expect(calls).toHaveLength(20);
  });

  it("returns none, probing nothing, when every probe fails", async () => {
    const urls = [GH_URL("a"), "https://api.lever.co/v0/postings/b?mode=json"];
    const { probe, calls } = failingProbe(urls);

    const board = await discoverBoard(
      ["https://job-boards.greenhouse.io/a", "https://jobs.lever.co/b"],
      "brandirrelevant.com",
      { probe },
    );

    expect(board).toEqual(NONE);
    expect(calls).toHaveLength(2);
  });

  it("ignores malformed and non-https nav links instead of throwing", async () => {
    const { probe } = recordingProbe({ "https://api.lever.co/v0/postings/ok?mode=json": jsonResponse("[]") });

    const board = await discoverBoard(
      ["not a url", "javascript:void(0)", "http://jobs.lever.co/plain", "https://jobs.lever.co/ok"],
      "ok.com",
      { probe },
    );

    expect(board.platform).toBe("lever");
  });
});

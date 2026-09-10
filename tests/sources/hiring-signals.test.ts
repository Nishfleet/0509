import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  buildJobFeedUrl,
  computeCounts,
  fetchAshbyJobs,
  fetchGreenhouseJobs,
  fetchJobs,
  fetchLeverJobs,
} from "~/lib/sources/hiring/hiring-signals.server";
import type {
  FetchFn,
  FetchJobsResult,
  HiringJob,
  JobsFetch,
} from "~/lib/sources/hiring/hiring-signals.server";

/**
 * Hiring job-feed fetch + normalization (#2199). The three provider feeds come
 * from real JSON fixtures; every request goes through an injected `fetchFn`
 * (never `globalThis.fetch`) that records its calls so "ONE attempt" is
 * provable, not assumed.
 */

const FIXTURES = path.join(__dirname, "..", "fixtures", "job-boards");

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), "utf8");
}

const greenhouseBody = readFixture("greenhouse-jobs.json");
const ashbyBody = readFixture("ashby-jobs.json");
const leverBody = readFixture("lever-jobs.json");

const GREENHOUSE_URL =
  "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=false";
const ASHBY_URL = "https://api.ashbyhq.com/posting-api/job-board/gamma";
const LEVER_URL = "https://api.lever.co/v0/postings/beta?mode=json";

/** Injected fetch that records every request URL and answers from `handler`. */
function makeFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const mock = vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push(url);
    return handler(url);
  });
  return { fn: mock as unknown as FetchFn, mock, calls };
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Assert the result is the wrapped success payload (not an unavailable one). */
function wrappedOf(result: FetchJobsResult) {
  if (!("provider" in result)) {
    throw new Error(`expected a wrapped success payload, got ${JSON.stringify(result)}`);
  }
  return result;
}

interface ProviderCase {
  provider: "greenhouse" | "ashby" | "lever";
  slug: string;
  feed: string;
  fetchFeed: (slug: string, fetchFn?: FetchFn) => Promise<JobsFetch>;
}

const providerCases: ProviderCase[] = [
  {
    provider: "greenhouse",
    slug: "acme",
    feed: greenhouseBody,
    fetchFeed: fetchGreenhouseJobs,
  },
  {
    provider: "ashby",
    slug: "gamma",
    feed: ashbyBody,
    fetchFeed: fetchAshbyJobs,
  },
  {
    provider: "lever",
    slug: "beta",
    feed: leverBody,
    fetchFeed: fetchLeverJobs,
  },
];

describe("buildJobFeedUrl", () => {
  it("builds the Greenhouse feed URL with content=false", () => {
    const url = buildJobFeedUrl({ provider: "greenhouse", slug: "acme" });
    expect(url).toBe(GREENHOUSE_URL);
    expect(url).toContain("content=false");
    expect(url).not.toContain("content=true");
  });

  it("builds the Ashby job-board URL", () => {
    expect(buildJobFeedUrl({ provider: "ashby", slug: "gamma" })).toBe(ASHBY_URL);
  });

  it("builds the Lever postings URL in json mode", () => {
    expect(buildJobFeedUrl({ provider: "lever", slug: "beta" })).toBe(LEVER_URL);
  });

  it("never asks any provider for job content (no content=true anywhere)", () => {
    const urls = providerCases.map((c) =>
      buildJobFeedUrl({ provider: c.provider, slug: c.slug }),
    );
    for (const url of urls) {
      expect(url).not.toContain("content=true");
      expect(url.startsWith("https://")).toBe(true);
    }
    // The Greenhouse feed is the only content flag, and it must be off.
    expect(urls.filter((url) => url.includes("content="))).toEqual([
      GREENHOUSE_URL,
    ]);
  });
});

describe("fetchGreenhouseJobs", () => {
  it("normalizes the fixture into the documented job shape", async () => {
    const { fn, mock, calls } = makeFetch(() => jsonResponse(greenhouseBody));

    const result = await fetchGreenhouseJobs("acme", fn);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(calls[0]).toBe(GREENHOUSE_URL);
    expect(calls[0]).not.toContain("content=true");
    expect(result).toEqual({
      jobs: [
        {
          id: "4111111",
          title: "Engineering Manager",
          location: "Remote",
          department: "Engineering",
          url: "https://boards.greenhouse.io/acme/jobs/4111111",
          postedAt: "2026-01-02T00:00:00Z",
        },
        {
          id: "4111112",
          title: "Staff Designer",
          location: "London",
          department: "Design",
          url: "https://boards.greenhouse.io/acme/jobs/4111112",
          postedAt: "2026-01-03T00:00:00Z",
        },
      ],
    });
    if (!("jobs" in result)) throw new Error("expected jobs");
    expect(Object.keys(result.jobs[0])).toEqual([
      "id",
      "title",
      "location",
      "department",
      "url",
      "postedAt",
    ]);
  });
});

describe("fetchAshbyJobs", () => {
  it("normalizes jobUrl, location.name, department and team.name", async () => {
    const { fn, mock, calls } = makeFetch(() => jsonResponse(ashbyBody));

    const result = await fetchAshbyJobs("gamma", fn);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(calls[0]).toBe(ASHBY_URL);
    expect(result).toEqual({
      jobs: [
        {
          id: "a1",
          title: "Product Designer",
          location: "London",
          department: "Design",
          url: "https://jobs.ashbyhq.com/gamma/a1",
          postedAt: "2026-02-01T00:00:00Z",
        },
        {
          id: "a2",
          title: "Analytics Engineer",
          location: "Remote",
          department: "Data",
          url: "https://jobs.ashbyhq.com/gamma/a2",
          postedAt: "2026-02-02T00:00:00Z",
        },
      ],
    });
  });
});

describe("fetchLeverJobs", () => {
  it("normalizes the bare postings array (text, categories, hostedUrl)", async () => {
    const { fn, mock, calls } = makeFetch(() => jsonResponse(leverBody));

    const result = await fetchLeverJobs("beta", fn);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(calls[0]).toBe(LEVER_URL);
    expect(result).toEqual({
      jobs: [
        {
          id: "l1",
          title: "Account Executive",
          location: "New York",
          department: "Sales",
          url: "https://jobs.lever.co/beta/l1",
          postedAt: "2026-03-01T00:00:00Z",
        },
        {
          id: "l2",
          title: "Brand Copywriter",
          location: "Remote",
          department: "Marketing",
          url: "https://jobs.lever.co/beta/l2",
          postedAt: "2026-03-02T00:00:00Z",
        },
      ],
    });
  });

  it("treats a wrapped { jobs: [...] } body as a parse break (Lever is a bare array)", async () => {
    const wrapped = JSON.stringify({ jobs: JSON.parse(leverBody) });
    const { fn, mock } = makeFetch(() => jsonResponse(wrapped));

    await expect(fetchLeverJobs("beta", fn)).resolves.toEqual({
      unavailable: true,
      reason: "parse_break",
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe("404 means 'not this provider', never 'no jobs'", () => {
  it.each(providerCases)(
    "$provider: 404 -> { unavailable, not_found, 404 } and no jobs key",
    async ({ slug, fetchFeed }) => {
      const { fn, mock } = makeFetch(
        () => new Response("Not Found", { status: 404 }),
      );

      const result = await fetchFeed(slug, fn);

      expect(result).toEqual({
        unavailable: true,
        reason: "not_found",
        status: 404,
      });
      expect(result).not.toHaveProperty("jobs");
      // Not an empty list pretending the provider has no openings.
      expect(result).not.toEqual({ jobs: [] });
      expect(mock).toHaveBeenCalledTimes(1);
    },
  );
});

describe("error mapping", () => {
  it.each(providerCases)(
    "$provider: non-404 HTTP error -> fetch_error with the status",
    async ({ slug, fetchFeed }) => {
      const { fn, mock } = makeFetch(
        () => new Response("boom", { status: 503 }),
      );

      const result = await fetchFeed(slug, fn);

      expect(result).toEqual({
        unavailable: true,
        reason: "fetch_error",
        status: 503,
      });
      expect(result).not.toHaveProperty("jobs");
      expect(mock).toHaveBeenCalledTimes(1);
    },
  );

  it.each(providerCases)(
    "$provider: a thrown fetch -> fetch_failed, one attempt",
    async ({ slug, fetchFeed }) => {
      const { fn, mock } = makeFetch(() => {
        throw new Error("socket hang up");
      });

      const result = await fetchFeed(slug, fn);

      expect(result).toEqual({ unavailable: true, reason: "fetch_failed" });
      expect(result).not.toHaveProperty("jobs");
      expect(mock).toHaveBeenCalledTimes(1);
    },
  );

  it.each(providerCases)(
    "$provider: an aborted fetch -> fetch_failed, no retry",
    async ({ slug, fetchFeed }) => {
      const { fn, mock } = makeFetch(() => {
        throw new DOMException("The operation was aborted.", "AbortError");
      });

      const result = await fetchFeed(slug, fn);

      expect(result).toEqual({ unavailable: true, reason: "fetch_failed" });
      expect(mock).toHaveBeenCalledTimes(1);
    },
  );

  it.each(providerCases)(
    "$provider: a non-JSON body -> parse_break, one attempt",
    async ({ slug, fetchFeed }) => {
      const { fn, mock } = makeFetch(
        () => new Response("<html>gateway timeout</html>", { status: 200 }),
      );

      const result = await fetchFeed(slug, fn);

      expect(result).toEqual({ unavailable: true, reason: "parse_break" });
      expect(result).not.toHaveProperty("jobs");
      expect(mock).toHaveBeenCalledTimes(1);
    },
  );

  it("Greenhouse: a 200 body without a jobs array -> parse_break", async () => {
    const { fn, mock } = makeFetch(() => jsonResponse("{}"));

    await expect(fetchGreenhouseJobs("acme", fn)).resolves.toEqual({
      unavailable: true,
      reason: "parse_break",
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("Ashby: a 200 body without a jobs array -> parse_break", async () => {
    const { fn, mock } = makeFetch(() => jsonResponse('{"jobs": null}'));

    await expect(fetchAshbyJobs("gamma", fn)).resolves.toEqual({
      unavailable: true,
      reason: "parse_break",
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchJobs dispatcher", () => {
  it("wraps a Greenhouse success into { provider, slug, fetchedAt, jobs, counts }", async () => {
    const { fn, mock, calls } = makeFetch(() => jsonResponse(greenhouseBody));

    const wrapped = wrappedOf(
      await fetchJobs({ provider: "greenhouse", slug: "acme" }, fn),
    );

    expect(mock).toHaveBeenCalledTimes(1);
    expect(calls[0]).toBe(GREENHOUSE_URL);
    expect(wrapped.provider).toBe("greenhouse");
    expect(wrapped.slug).toBe("acme");
    expect(typeof wrapped.fetchedAt).toBe("string");
    expect(Number.isNaN(Date.parse(wrapped.fetchedAt))).toBe(false);
    expect(wrapped.jobs).toHaveLength(2);
    expect(wrapped.jobs[0]).toEqual({
      id: "4111111",
      title: "Engineering Manager",
      location: "Remote",
      department: "Engineering",
      url: "https://boards.greenhouse.io/acme/jobs/4111111",
      postedAt: "2026-01-02T00:00:00Z",
    });
    expect(wrapped.counts).toEqual({
      byDepartment: { Engineering: 1, Design: 1 },
      byLocation: { Remote: 1, London: 1 },
    });
    expect(wrapped).not.toHaveProperty("unavailable");
  });

  it("dispatches to Ashby and Lever feed URLs per provider", async () => {
    const ashby = makeFetch(() => jsonResponse(ashbyBody));
    const lever = makeFetch(() => jsonResponse(leverBody));

    await fetchJobs({ provider: "ashby", slug: "gamma" }, ashby.fn);
    await fetchJobs({ provider: "lever", slug: "beta" }, lever.fn);

    expect(ashby.calls).toEqual([ASHBY_URL]);
    expect(lever.calls).toEqual([LEVER_URL]);
  });

  it("passes an unavailable outcome through unwrapped", async () => {
    const { fn, mock, calls } = makeFetch(
      () => new Response("Not Found", { status: 404 }),
    );

    const result = await fetchJobs({ provider: "ashby", slug: "gamma" }, fn);

    expect(result).toEqual({
      unavailable: true,
      reason: "not_found",
      status: 404,
    });
    expect(result).not.toHaveProperty("provider");
    expect(result).not.toHaveProperty("slug");
    expect(result).not.toHaveProperty("fetchedAt");
    expect(result).not.toHaveProperty("jobs");
    expect(result).not.toHaveProperty("counts");
    expect(calls).toEqual([ASHBY_URL]);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("passes a fetch_error through unwrapped too", async () => {
    const { fn } = makeFetch(() => new Response("boom", { status: 500 }));

    const result = await fetchJobs({ provider: "lever", slug: "beta" }, fn);

    expect(result).toEqual({
      unavailable: true,
      reason: "fetch_error",
      status: 500,
    });
    expect(result).not.toHaveProperty("jobs");
  });
});

describe("computeCounts", () => {
  function job(partial: Partial<HiringJob>): HiringJob {
    return {
      id: "x",
      title: "Role",
      location: null,
      department: null,
      url: null,
      postedAt: null,
      ...partial,
    };
  }

  it("counts by department and by location", () => {
    const counts = computeCounts([
      job({ id: "1", location: "London", department: "Engineering" }),
      job({ id: "2", location: "London", department: "Engineering" }),
      job({ id: "3", location: "Remote", department: "Design" }),
    ]);

    expect(counts).toEqual({
      byDepartment: { Engineering: 2, Design: 1 },
      byLocation: { London: 2, Remote: 1 },
    });
  });

  it("buckets a missing department to (none)", () => {
    const counts = computeCounts([
      job({ id: "1", location: "London", department: null }),
      job({ id: "2", location: "London", department: "   " }),
      job({ id: "3", location: "London", department: "Sales" }),
    ]);

    expect(counts.byDepartment).toEqual({ "(none)": 2, Sales: 1 });
  });

  it("buckets a missing location to (remote)", () => {
    const counts = computeCounts([
      job({ id: "1", location: null, department: "Sales" }),
      job({ id: "2", location: "", department: "Sales" }),
      job({ id: "3", location: "New York", department: "Sales" }),
    ]);

    expect(counts.byLocation).toEqual({ "(remote)": 2, "New York": 1 });
  });

  it("returns empty buckets for no jobs", () => {
    expect(computeCounts([])).toEqual({ byDepartment: {}, byLocation: {} });
  });
});

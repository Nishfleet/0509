import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BET2_DOMAINS,
  SEARCH_RATE_LIMIT_WINDOW_MS,
} from "../scripts/bet2-live-verification.mjs";
import {
  CARDS_HEADERS,
  DAILY_HEADERS,
  RUNS_HEADERS,
  AUTH_HEADERS,
  FIRST_VALUE_HEADERS,
  FIRST_VALUE_PATH,
  FIRST_VALUE_PROBE_USER_AGENT,
  authOutcome,
  computeLatencyStats,
  detectFirstValueRegression,
  firstValueOutcome,
  formatFirstValueIssueBody,
  formatFirstValueLine,
  formatMetricLine,
  probeAnonymousFirstValue,
  probeAuthPages,
  runLatencyProbe,
} from "../scripts/search-latency-probe.mjs";

function htmlForRows(
  rows: Array<{
    tier: "verified" | "likely" | "unmatched";
    advertiser: string;
    summary: string;
  }>,
) {
  const rowMarkup = rows
    .map((row) => {
      const say =
        row.tier === "verified"
          ? row.summary
          : `${row.tier.charAt(0).toUpperCase()}${row.tier.slice(1)} — ${row.summary}`;
      return `<div class="f9-wk-row has-trail"><span class="f9-wk-say">${say}</span></div>`;
    })
    .join("");
  const verifiedCount = rows.filter((r) => r.tier === "verified").length;
  const headline =
    verifiedCount > 0
      ? `${verifiedCount} verified ads linked to test-domain.com`
      : "No verified ads for test-domain.com";
  return `<html><body><section class="f9-results-panel" data-f9-result-source="meta_library_browser" data-f9-result-cache-status="hit"><h2 class="f9-wk-sec-title">${headline}</h2>${rowMarkup}</section></body></html>`;
}

function readyResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html" },
  });
}

describe("search.latency.probe", () => {
  it("emits p95, p50, mean and a metric line from mocked fetch responses", async () => {
    let now = 0;
    const nowImpl = () => now;
    const sleepImpl = async () => {
      /* no-op for test */
    };
    const domainDelays: Record<string, number> = {
      "a.example": 800,
      "b.example": 1200,
      "c.example": 1600,
    };
    const domains = Object.keys(domainDelays);

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      const domain = url.searchParams.get("website") ?? "";
      const delay = domainDelays[domain] ?? 0;
      now += delay;
      return readyResponse(
        htmlForRows([{ tier: "verified", advertiser: "Test", summary: `Summary for ${domain}` }]),
      );
    }) as unknown as typeof fetch;

    const output = await runLatencyProbe({
      baseUrl: "https://test.example",
      domains,
      fetchImpl,
      sleepImpl,
      nowImpl,
    });

    expect(output.results).toHaveLength(3);
    expect(output.run.p95Ms).toBe(1600);
    expect(output.run.p50Ms).toBe(1200);
    expect(output.run.meanMs).toBe(1200);
    expect(output.run.samples).toBe(3);
    expect(output.run.totalBytes).toBeGreaterThan(0);

    // The expected metric (accept #5): a machine-readable line the CI and any
    // downstream consumer can grep, with the timing statistic named exactly
    // as the issue measures it.
    expect(output.metricLine).toContain("search_latency_probe");
    expect(output.metricLine).toContain(`run=${output.runAt}`);
    expect(output.metricLine).toContain("time_to_first_visible_card_p95_ms=1600");
    expect(output.metricLine).toContain("time_to_first_visible_card_p50_ms=1200");
    expect(output.metricLine).toContain("samples=3");
    expect(output.metricLine).toContain("total_response_bytes=");
    expect(output.metricLine).toContain("error_domains=0");
    expect(output.metricLine).toContain("rate_limited_domains=0");
  });

  it("measures time-to-first-visible-card as wall-clock, not HTML byte offset", async () => {
    const preamble = "x".repeat(50_000);
    const html = `${preamble}<div class="f9-wk-row"><span class="f9-wk-say">Sample</span></div>`;
    let now = 0;
    const fetchImpl = (async () => {
      now += 700;
      return readyResponse(html);
    }) as unknown as typeof fetch;
    const output = await runLatencyProbe({
      baseUrl: "https://test.example",
      domains: ["offset.example"],
      fetchImpl,
      sleepImpl: async () => {},
      nowImpl: () => now,
    });
    expect(output.run.p95Ms).toBe(700);
  });

  it("writes per-run, per-card and daily CSVs containing only timing and size", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-latency-"));
    try {
      let now = 0;
      const nowImpl = () => now;
      const fetchImpl = (async () => {
        now += 500;
        return readyResponse(
          htmlForRows([{ tier: "verified", advertiser: "Test", summary: "Summary" }]),
        );
      }) as unknown as typeof fetch;

      await runLatencyProbe({
        baseUrl: "https://test.example",
        domains: ["x.example"],
        outputDir: dir,
        fetchImpl,
        sleepImpl: async () => {},
        nowImpl,
      });

      const runs = readFileSync(join(dir, "runs.csv"), "utf8");
      expect(runs.split("\n")[0]).toBe(RUNS_HEADERS.join(","));
      expect(runs).toContain("https://test.example");
      expect(runs).toContain("500");

      const cards = readFileSync(join(dir, "cards.csv"), "utf8");
      expect(cards.split("\n")[0]).toBe(CARDS_HEADERS.join(","));
      expect(cards).toContain("x.example");
      expect(cards).toContain("time_to_first_visible_card_ms");
      expect(cards).toContain("500");
      expect(cards).toContain("response_size_bytes");

      const daily = readFileSync(join(dir, "daily.csv"), "utf8");
      expect(daily.split("\n")[0]).toBe(DAILY_HEADERS.join(","));
      expect(daily).toContain("500");

      // Accept #4: only the timing metric and response size are persisted.
      // The exact header lists are the schema contract; any new column is an
      // intentional change to the no-PII surface, not an accident.
      expect(RUNS_HEADERS).toEqual([
        "run_at",
        "run_date",
        "base_url",
        "domains",
        "p95_ms",
        "p50_ms",
        "mean_ms",
        "samples",
        "total_bytes",
        "error_domains",
        "rate_limited_domains",
      ]);
      expect(CARDS_HEADERS).toEqual([
        "run_at",
        "domain",
        "time_to_first_visible_card_ms",
        "response_size_bytes",
        "status",
        "outcome",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("paces the 25-domain set inside the 20 req / 10 min public-search window", async () => {
    let now = 0;
    const nowImpl = () => now;
    const sleepImpl = async (ms: number) => {
      now += ms;
    };
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      // Only the /search probes carry a `website` param; the auth-page probes
      // (issue #1692) share this fetch injection point and must not be counted
      // against the /search domain pacing assertion below.
      const website = url.searchParams.get("website");
      if (website) calls.push(website);
      return readyResponse(
        htmlForRows([{ tier: "verified", advertiser: "Test", summary: "Summary" }]),
      );
    }) as unknown as typeof fetch;

    // BET2_DOMAINS is the campaign's 25-domain list; the probe defaults to it.
    expect(BET2_DOMAINS).toHaveLength(25);
    await runLatencyProbe({
      baseUrl: "https://test.example",
      domains: BET2_DOMAINS,
      fetchImpl,
      sleepImpl,
      nowImpl,
    });

    expect(calls).toHaveLength(25);
    // The sliding-window limiter (20 max / 10 min) forces the 21st domain to
    // wait until the window rolls; a fake clock makes that wait instant here.
    expect(now).toBeGreaterThanOrEqual(SEARCH_RATE_LIMIT_WINDOW_MS);
  });

  it("keeps formatMetricLine and computeLatencyStats stable for downstream consumers", () => {
    const stats = computeLatencyStats([
      { firstCardAtMs: 1000, bodyBytes: 42, outcome: "verified" },
      { firstCardAtMs: 9000, bodyBytes: 43, outcome: "verified" },
      { firstCardAtMs: 3000, bodyBytes: 44, outcome: "verified" },
    ]);
    expect(stats.p95Ms).toBe(9000);
    expect(stats.p50Ms).toBe(3000);
    const line = formatMetricLine({ runAt: "2026-09-05T00:00:00.000Z", baseUrl: "https://0509.io", stats });
    expect(line).toBe(
      "search_latency_probe run=2026-09-05T00:00:00.000Z base_url=https://0509.io time_to_first_visible_card_p95_ms=9000 time_to_first_visible_card_p50_ms=3000 time_to_first_visible_card_mean_ms=4333 samples=3 total_response_bytes=129 error_domains=0 rate_limited_domains=0",
    );
  });

  it("records a non-200 auth-page status as an availability failure (issue #1692)", async () => {
    // A 503 on /auth/login (the transient status observed in issue #1692) and
    // a healthy /auth/signup exercise the availability classifier end to end.
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/auth/login") return new Response("<html>login</html>", { status: 503 });
      return new Response("<html>signup</html>", { status: 200 });
    }) as unknown as typeof fetch;

    const output = await runLatencyProbe({
      baseUrl: "https://test.example",
      domains: ["x.example"],
      fetchImpl,
      sleepImpl: async () => {},
      nowImpl: () => 0,
    });

    // The 503 must surface as a failure, never be silently swallowed.
    const login = output.authResults.find((r) => r.path === "/auth/login");
    expect(login).toBeDefined();
    expect(login!.status).toBe(503);
    expect(login!.outcome).toBe("error");
    const signup = output.authResults.find((r) => r.path === "/auth/signup");
    expect(signup!.status).toBe(200);
    expect(signup!.outcome).toBe("ok");
    expect(output.authMetricLine).toContain("auth_failures=1");
  });

  it("writes the auth-page statuses to auth.csv (issue #1692)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-latency-auth-"));
    try {
      const fetchImpl = (async (input: RequestInfo | URL) => {
        const url = new URL(input.toString());
        if (url.pathname === "/auth/signup") return new Response("<html>signup</html>", { status: 500 });
        return new Response("<html>ok</html>", { status: 200 });
      }) as unknown as typeof fetch;

      await runLatencyProbe({
        baseUrl: "https://test.example",
        domains: ["x.example"],
        outputDir: dir,
        fetchImpl,
        sleepImpl: async () => {},
        nowImpl: () => 0,
      });

      const auth = readFileSync(join(dir, "auth.csv"), "utf8");
      expect(auth.split("\n")[0]).toBe(AUTH_HEADERS.join(","));
      expect(auth).toContain("/auth/login,200,ok");
      expect(auth).toContain("/auth/signup,500,error");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("classifies auth statuses: 5xx and network errors are failures, 4xx is not", () => {
    expect(authOutcome(200)).toBe("ok");
    expect(authOutcome(302)).toBe("ok");
    expect(authOutcome(503)).toBe("error");
    expect(authOutcome(500)).toBe("error");
    expect(authOutcome(null)).toBe("fetch_error");
    // A 4xx is a misconfiguration, not a transient outage; it must not read as
    // a 5xx-style availability regression.
    expect(authOutcome(404)).toBe("ok");
  });

  it("paces auth-page probes low-frequently without touching the /search window", async () => {
    const sleepMs: number[] = [];
    await probeAuthPages({
      baseUrl: "https://test.example",
      fetchImpl: (async () => new Response("<html>auth</html>", { status: 200 })) as unknown as typeof fetch,
      sleepImpl: async (ms: number) => {
        sleepMs.push(ms);
      },
      nowImpl: () => 0,
    });
    // Two pages => one gap between them; the spacing keeps the pair low-volume.
    expect(sleepMs.length).toBeGreaterThanOrEqual(1);
    // The auth spacing must be applied between consecutive page fetches.
    expect(sleepMs[0]).toBeGreaterThan(0);
  });

  it("classifies anonymous first-value statuses: 429 is rate_limited, 5xx is error", () => {
    expect(firstValueOutcome(200)).toBe("ok");
    expect(firstValueOutcome(302)).toBe("ok");
    expect(firstValueOutcome(429)).toBe("rate_limited");
    expect(firstValueOutcome(503)).toBe("error");
    expect(firstValueOutcome(null)).toBe("fetch_error");
  });

  it("walks a fresh no-cookie /search and records 429 as a first-value miss", async () => {
    const seenHeaders: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (url.pathname === "/search" && url.searchParams.get("q") === "nike") {
        const headers = new Headers(init?.headers);
        seenHeaders.push(headers.get("cookie") ?? "");
        seenHeaders.push(headers.get("user-agent") ?? "");
        return new Response("Too many searches", {
          status: 429,
          headers: { "retry-after": "600" },
        });
      }
      return readyResponse(
        htmlForRows([{ tier: "verified", advertiser: "Test", summary: "Summary" }]),
      );
    }) as unknown as typeof fetch;

    const output = await runLatencyProbe({
      baseUrl: "https://test.example",
      domains: ["x.example"],
      fetchImpl,
      sleepImpl: async () => {},
      nowImpl: () => 0,
    });

    expect(output.firstValueResult.status).toBe(429);
    expect(output.firstValueResult.outcome).toBe("rate_limited");
    expect(output.firstValueResult.retryAfter).toBe("600");
    expect(output.firstValueResult.path).toBe(FIRST_VALUE_PATH);
    expect(output.firstValueMetricLine).toContain("outcome=rate_limited");
    // Fresh evaluator: no Cookie header, dedicated canary user-agent.
    expect(seenHeaders[0]).toBe("");
    expect(seenHeaders[1]).toBe(FIRST_VALUE_PROBE_USER_AGENT);
  });

  it("writes first-value.csv without consuming a Cookie header", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-latency-first-value-"));
    try {
      const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input.toString());
        if (url.pathname === "/search" && !url.searchParams.get("website")) {
          expect(new Headers(init?.headers).get("cookie")).toBeNull();
          return new Response("<html>ok</html>", { status: 200 });
        }
        return readyResponse(
          htmlForRows([{ tier: "verified", advertiser: "Test", summary: "Summary" }]),
        );
      }) as unknown as typeof fetch;

      await runLatencyProbe({
        baseUrl: "https://test.example",
        domains: ["x.example"],
        outputDir: dir,
        fetchImpl,
        sleepImpl: async () => {},
        nowImpl: () => 0,
      });

      const csv = readFileSync(join(dir, "first-value.csv"), "utf8");
      expect(csv.split("\n")[0]).toBe(FIRST_VALUE_HEADERS.join(","));
      expect(csv).toContain(",200,ok,");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fires the first-value edge detector on a 3-window red streak and stays quiet on an ongoing streak", () => {
    const red = (runAt: string) => ({
      runAt,
      path: FIRST_VALUE_PATH,
      status: 429,
      outcome: "rate_limited" as const,
    });
    const green = (runAt: string) => ({
      runAt,
      path: FIRST_VALUE_PATH,
      status: 200,
      outcome: "ok" as const,
    });

    const start = detectFirstValueRegression([
      green("2026-09-08T10:00:00Z"),
      red("2026-09-08T10:30:00Z"),
      red("2026-09-08T11:00:00Z"),
      red("2026-09-08T11:30:00Z"),
    ]);
    expect(start).not.toBeNull();
    expect(start!.previous).toEqual({ runAt: "2026-09-08T10:00:00Z" });
    expect(formatFirstValueIssueBody(start!)).toContain("429");

    expect(
      detectFirstValueRegression([
        red("2026-09-08T10:00:00Z"),
        red("2026-09-08T10:30:00Z"),
        red("2026-09-08T11:00:00Z"),
        red("2026-09-08T11:30:00Z"),
      ]),
    ).toBeNull();

    expect(
      detectFirstValueRegression([
        red("2026-09-08T10:00:00Z"),
        red("2026-09-08T10:30:00Z"),
      ]),
    ).toBeNull();

    expect(
      detectFirstValueRegression([
        red("2026-09-08T10:00:00Z"),
        red("2026-09-08T10:30:00Z"),
        red("2026-09-08T11:00:00Z"),
      ]),
    ).not.toBeNull();
  });

  it("does not send a Cookie header on the dedicated first-value walk", async () => {
    let cookieHeader: string | null = "sentinel";
    await probeAnonymousFirstValue({
      baseUrl: "https://test.example",
      fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        cookieHeader = new Headers(init?.headers).get("cookie");
        return new Response("ok", { status: 200 });
      }) as unknown as typeof fetch,
      nowImpl: () => 0,
    });
    expect(cookieHeader).toBeNull();
  });
});
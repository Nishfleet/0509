import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_THRESHOLD_MS,
  detectRegression,
  detectAuthRegression,
  detectMoneyPathRegression,
  filterUnfiledIncidents,
  formatIssueBody,
  formatAuthIssueBody,
  formatMoneyPathIssueBody,
  parseRuns,
  parseAuthRecords,
  parseMoneyPathRecords,
} from "../scripts/search-latency-regression-guard.mjs";
import {
  detectFirstValueRegression,
  formatFirstValueIssueBody,
} from "../scripts/search-latency-probe.mjs";

function makeRuns(values: Array<{ runAt: string; p95Ms: number }>) {
  return values.map((v) => ({
    runAt: v.runAt,
    p95Ms: v.p95Ms,
    baseUrl: "https://0509.io",
  }));
}

describe("search.latency.regression.guard", () => {
  it("detects a 3-run streak above the threshold", () => {
    const runs = makeRuns([
      { runAt: "2026-09-05T10:00:00Z", p95Ms: 4_000 },
      { runAt: "2026-09-05T10:30:00Z", p95Ms: 5_500 },
      { runAt: "2026-09-05T11:00:00Z", p95Ms: 5_700 },
      { runAt: "2026-09-05T11:30:00Z", p95Ms: 5_900 },
    ]);
    const regression = detectRegression(runs, DEFAULT_THRESHOLD_MS);
    expect(regression).not.toBeNull();
    expect(regression!.runs).toHaveLength(3);
    expect(regression!.previous).toBeTruthy();
    expect(regression!.previous!.p95Ms).toBe(4_000);
  });

  it("ignores an ongoing streak that was already reported", () => {
    const runs = makeRuns([
      { runAt: "2026-09-05T10:00:00Z", p95Ms: 5_500 },
      { runAt: "2026-09-05T10:30:00Z", p95Ms: 5_700 },
      { runAt: "2026-09-05T11:00:00Z", p95Ms: 5_900 },
      { runAt: "2026-09-05T11:30:00Z", p95Ms: 5_950 },
    ]);
    const regression = detectRegression(runs, DEFAULT_THRESHOLD_MS);
    expect(regression).toBeNull();
  });

  it("fires when the first three runs ever are all above the threshold", () => {
    const runs = makeRuns([
      { runAt: "2026-09-05T10:00:00Z", p95Ms: 5_500 },
      { runAt: "2026-09-05T10:30:00Z", p95Ms: 5_700 },
      { runAt: "2026-09-05T11:00:00Z", p95Ms: 5_900 },
    ]);
    const regression = detectRegression(runs, DEFAULT_THRESHOLD_MS);
    expect(regression).not.toBeNull();
    expect(regression!.previous).toBeNull();
  });

  it("does not fire when fewer than three runs exist", () => {
    const runs = makeRuns([
      { runAt: "2026-09-05T10:00:00Z", p95Ms: 5_500 },
      { runAt: "2026-09-05T10:30:00Z", p95Ms: 5_700 },
    ]);
    const regression = detectRegression(runs, DEFAULT_THRESHOLD_MS);
    expect(regression).toBeNull();
  });

  it("does not fire while the most recent runs are below the threshold", () => {
    const runs = makeRuns([
      { runAt: "2026-09-05T10:00:00Z", p95Ms: 5_500 },
      { runAt: "2026-09-05T10:30:00Z", p95Ms: 4_500 },
      { runAt: "2026-09-05T11:00:00Z", p95Ms: 4_200 },
      { runAt: "2026-09-05T11:30:00Z", p95Ms: 3_900 },
    ]);
    const regression = detectRegression(runs, DEFAULT_THRESHOLD_MS);
    expect(regression).toBeNull();
  });

  it("parses a real runs.csv written by the probe", () => {
    const dir = mkdtempSync(join(tmpdir(), "search-latency-guard-"));
    try {
      const csvPath = join(dir, "runs.csv");
      writeFileSync(
        csvPath,
        [
          "run_at,run_date,base_url,domains,p95_ms,p50_ms,mean_ms,samples,total_bytes,error_domains,rate_limited_domains",
          "2026-09-05T10:00:00.000Z,2026-09-05,https://0509.io,25,4000,1200,1600,25,100000,0,0",
          "2026-09-05T10:30:00.000Z,2026-09-05,https://0509.io,25,5500,1300,1700,25,100100,0,0",
          "2026-09-05T11:00:00.000Z,2026-09-05,https://0509.io,25,5700,1400,1800,25,100200,0,0",
          "2026-09-05T11:30:00.000Z,2026-09-05,https://0509.io,25,5900,1500,1900,25,100300,0,0",
        ].join("\n"),
      );
      const runs = parseRuns(csvPath);
      expect(runs).toHaveLength(4);
      expect(runs[0]?.p95Ms).toBe(4_000);
      expect(runs[3]?.p95Ms).toBe(5_900);
      const regression = detectRegression(runs, DEFAULT_THRESHOLD_MS);
      expect(regression).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drops rows with a non-numeric p95 instead of misfiring", () => {
    const dir = mkdtempSync(join(tmpdir(), "search-latency-guard-"));
    try {
      const csvPath = join(dir, "runs.csv");
      writeFileSync(
        csvPath,
        [
          "run_at,run_date,base_url,domains,p95_ms,p50_ms,mean_ms,samples,total_bytes,error_domains,rate_limited_domains",
          "2026-09-05T10:00:00.000Z,2026-09-05,https://0509.io,25,4000,1200,1600,25,100000,0,0",
          "2026-09-05T10:30:00.000Z,2026-09-05,https://0509.io,25,,1200,1600,0,0,25,25",
          "2026-09-05T11:00:00.000Z,2026-09-05,https://0509.io,25,5500,1300,1700,25,100100,0,0",
          "2026-09-05T11:30:00.000Z,2026-09-05,https://0509.io,25,5700,1400,1800,25,100200,0,0",
          "2026-09-05T12:00:00.000Z,2026-09-05,https://0509.io,25,5900,1500,1900,25,100300,0,0",
        ].join("\n"),
      );
      const runs = parseRuns(csvPath);
      expect(runs).toHaveLength(4);
      const regression = detectRegression(runs, DEFAULT_THRESHOLD_MS);
      // 4000 (green) -> 5500/5700/5900 (red): a fresh 3-run streak after a
      // reset, so the guard fires even though the run in between had no p95.
      expect(regression).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("formats an issue body with the run table and threshold", () => {
    const regression = {
      thresholdMs: DEFAULT_THRESHOLD_MS,
      runs: makeRuns([
        { runAt: "2026-09-05T10:30:00Z", p95Ms: 5_500 },
        { runAt: "2026-09-05T11:00:00Z", p95Ms: 5_700 },
        { runAt: "2026-09-05T11:30:00Z", p95Ms: 5_900 },
      ]),
      previous: { runAt: "2026-09-05T10:00:00Z", p95Ms: 4_000, baseUrl: "https://0509.io" },
    };
    const body = formatIssueBody(regression);
    expect(body).toContain("p95 time-to-first-visible-card");
    expect(body).toContain("5500");
    expect(body).toContain("Relates to #973");
    expect(body).toContain("Threshold: 5000 ms");
  });

  // --- auth-page availability guard (issue #1692) ---

  function makeAuthRecords(
    pages: Record<string, Array<{ runAt: string; status: number | null; outcome: string }>>,
  ) {
    const records: Array<{ runAt: string; path: string; status: number | null; outcome: string }> = [];
    for (const [path, runs] of Object.entries(pages)) {
      for (const r of runs) {
        records.push({ runAt: r.runAt, path, status: r.status, outcome: r.outcome });
      }
    }
    return records;
  }

  it("fails an issue when an auth page returns 5xx for 3+ consecutive runs", () => {
    const records = makeAuthRecords({
      "/auth/login": [
        { runAt: "2026-09-05T10:00:00Z", status: 200, outcome: "ok" },
        { runAt: "2026-09-05T10:30:00Z", status: 503, outcome: "error" },
        { runAt: "2026-09-05T11:00:00Z", status: 503, outcome: "error" },
        { runAt: "2026-09-05T11:30:00Z", status: 503, outcome: "error" },
      ],
      "/auth/signup": [
        { runAt: "2026-09-05T10:00:00Z", status: 200, outcome: "ok" },
        { runAt: "2026-09-05T10:30:00Z", status: 200, outcome: "ok" },
        { runAt: "2026-09-05T11:00:00Z", status: 200, outcome: "ok" },
        { runAt: "2026-09-05T11:30:00Z", status: 200, outcome: "ok" },
      ],
    });
    const regression = detectAuthRegression(records);
    expect(regression).not.toBeNull();
    expect(regression!.title).toContain("auth");
    expect(regression!.previous).toBeTruthy();
  });

  it("does not fire for an ongoing auth streak that was already reported", () => {
    const records = makeAuthRecords({
      "/auth/login": [
        { runAt: "2026-09-05T10:00:00Z", status: 503, outcome: "error" },
        { runAt: "2026-09-05T10:30:00Z", status: 503, outcome: "error" },
        { runAt: "2026-09-05T11:00:00Z", status: 503, outcome: "error" },
        { runAt: "2026-09-05T11:30:00Z", status: 503, outcome: "error" },
      ],
      "/auth/signup": [
        { runAt: "2026-09-05T10:00:00Z", status: 200, outcome: "ok" },
        { runAt: "2026-09-05T10:30:00Z", status: 200, outcome: "ok" },
        { runAt: "2026-09-05T11:00:00Z", status: 200, outcome: "ok" },
        { runAt: "2026-09-05T11:30:00Z", status: 200, outcome: "ok" },
      ],
    });
    // The streak is already red at the earliest run; the prior run (none) is
    // the only guard, so the edge detector must not re-fire.
    expect(detectAuthRegression(records)).toBeNull();
  });

  it("fires when the streak begins with the first three runs ever", () => {
    const records = makeAuthRecords({
      "/auth/signup": [
        { runAt: "2026-09-05T10:00:00Z", status: 503, outcome: "error" },
        { runAt: "2026-09-05T10:30:00Z", status: 503, outcome: "error" },
        { runAt: "2026-09-05T11:00:00Z", status: 503, outcome: "error" },
      ],
      "/auth/login": [
        { runAt: "2026-09-05T10:00:00Z", status: 200, outcome: "ok" },
        { runAt: "2026-09-05T10:30:00Z", status: 200, outcome: "ok" },
        { runAt: "2026-09-05T11:00:00Z", status: 200, outcome: "ok" },
      ],
    });
    expect(detectAuthRegression(records)).not.toBeNull();
  });

  it("does not fire with fewer than three runs", () => {
    const records = makeAuthRecords({
      "/auth/login": [
        { runAt: "2026-09-05T10:00:00Z", status: 503, outcome: "error" },
        { runAt: "2026-09-05T10:30:00Z", status: 503, outcome: "error" },
      ],
      "/auth/signup": [
        { runAt: "2026-09-05T10:00:00Z", status: 200, outcome: "ok" },
        { runAt: "2026-09-05T10:30:00Z", status: 200, outcome: "ok" },
      ],
    });
    expect(detectAuthRegression(records)).toBeNull();
  });

  it("does not fire while the most recent auth runs are healthy", () => {
    const records = makeAuthRecords({
      "/auth/login": [
        { runAt: "2026-09-05T10:00:00Z", status: 503, outcome: "error" },
        { runAt: "2026-09-05T10:30:00Z", status: 200, outcome: "ok" },
        { runAt: "2026-09-05T11:00:00Z", status: 200, outcome: "ok" },
        { runAt: "2026-09-05T11:30:00Z", status: 200, outcome: "ok" },
      ],
      "/auth/signup": [
        { runAt: "2026-09-05T10:00:00Z", status: 200, outcome: "ok" },
        { runAt: "2026-09-05T10:30:00Z", status: 200, outcome: "ok" },
        { runAt: "2026-09-05T11:00:00Z", status: 200, outcome: "ok" },
        { runAt: "2026-09-05T11:30:00Z", status: 200, outcome: "ok" },
      ],
    });
    expect(detectAuthRegression(records)).toBeNull();
  });

  it("formats an auth issue body naming the failing page and status", () => {
    const regression = detectAuthRegression(
      makeAuthRecords({
        "/auth/login": [
          { runAt: "2026-09-05T10:00:00Z", status: 503, outcome: "error" },
          { runAt: "2026-09-05T10:30:00Z", status: 503, outcome: "error" },
          { runAt: "2026-09-05T11:00:00Z", status: 503, outcome: "error" },
        ],
        "/auth/signup": [
          { runAt: "2026-09-05T10:00:00Z", status: 200, outcome: "ok" },
          { runAt: "2026-09-05T10:30:00Z", status: 200, outcome: "ok" },
          { runAt: "2026-09-05T11:00:00Z", status: 200, outcome: "ok" },
        ],
      }),
    );
    expect(regression).not.toBeNull();
    const body = formatAuthIssueBody(regression!);
    expect(body).toContain("/auth/login");
    expect(body).toContain("503");
    expect(body).toContain("Consecutive failing runs: 3");
  });

  it("parses a real auth.csv written by the probe", () => {
    const dir = mkdtempSync(join(tmpdir(), "search-latency-auth-guard-"));
    try {
      const csvPath = join(dir, "auth.csv");
      writeFileSync(
        csvPath,
        [
          "run_at,path,status,outcome,elapsed_ms",
          "2026-09-05T10:00:00.000Z,/auth/login,200,ok,42",
          "2026-09-05T10:00:00.000Z,/auth/signup,200,ok,41",
          "2026-09-05T10:30:00.000Z,/auth/login,503,error,43",
          "2026-09-05T10:30:00.000Z,/auth/signup,200,ok,44",
          "2026-09-05T11:00:00.000Z,/auth/login,503,error,45",
          "2026-09-05T11:00:00.000Z,/auth/signup,200,ok,46",
          "2026-09-05T11:30:00.000Z,/auth/login,503,error,47",
          "2026-09-05T11:30:00.000Z,/auth/signup,200,ok,48",
        ].join("\n"),
      );
      const records = parseAuthRecords(csvPath);
      expect(records).toHaveLength(8);
      const regression = detectAuthRegression(records);
      expect(regression).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fires the first-value edge detector on a 3-window 429 streak fixture and stays quiet on an ongoing streak", () => {
    // The scheduled guard CLI cannot grow a --first-value-csv flag in this
    // change: any edit of search-latency-regression-guard.mjs trips the
    // repo secrets guard (GH_TOKEN wiring). The edge detector lives on the
    // probe (same contract as detectAuthRegression) and is imported here so
    // this file's verify command covers the 3-window fixture.
    const red = (runAt: string) => ({
      runAt,
      path: "/search?q=nike&country=all",
      status: 429 as number | null,
      outcome: "rate_limited",
    });
    const green = (runAt: string) => ({
      runAt,
      path: "/search?q=nike&country=all",
      status: 200 as number | null,
      outcome: "ok",
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
  });

  it("parses a real first-value.csv row shape into the edge detector", () => {
    const dir = mkdtempSync(join(tmpdir(), "search-latency-first-value-guard-"));
    try {
      const csvPath = join(dir, "first-value.csv");
      writeFileSync(
        csvPath,
        [
          "run_at,path,status,outcome,retry_after,elapsed_ms",
          "2026-09-08T10:00:00.000Z,/search?q=nike&country=all,200,ok,,12",
          "2026-09-08T10:30:00.000Z,/search?q=nike&country=all,429,rate_limited,600,13",
          "2026-09-08T11:00:00.000Z,/search?q=nike&country=all,429,rate_limited,600,14",
          "2026-09-08T11:30:00.000Z,/search?q=nike&country=all,429,rate_limited,600,15",
        ].join("\n"),
      );
      const text = readFileSync(csvPath, "utf8");
      const lines = text.trim().split("\n").slice(1);
      const records = lines.map((line) => {
        const [runAt, path, status, outcome, retryAfter] = line.split(",");
        return {
          runAt,
          path,
          status: status === "" ? null : Number(status),
          outcome,
          retryAfter,
        };
      });
      const regression = detectFirstValueRegression(records);
      expect(regression).not.toBeNull();
      expect(regression!.runs).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe("search.latency.regression.guard: money-path canary (issue #2001)", () => {
  const moneyRecord = (runAt: string, path: string, status: number | null, location = "") => ({
    runAt,
    path,
    status,
    location,
    outcome: status == null ? "fetch_error" : status === 200 ? "ok" : "error",
  });

  it("fires when a money-path URL returns 500 twice within 10 minutes", () => {
    const records = [
      moneyRecord("2026-09-08T13:50:00Z", "/search?mode=advertiser&selected=1702938977100376", 200),
      moneyRecord("2026-09-08T13:55:00Z", "/search?mode=advertiser&selected=1702938977100376", 500),
      moneyRecord("2026-09-08T14:00:00Z", "/search?mode=advertiser&selected=1702938977100376", 500),
    ];
    const regression = detectMoneyPathRegression(records);
    expect(regression).not.toBeNull();
    expect(regression!.incidents).toHaveLength(1);
    expect(regression!.incidents[0]!.failures).toHaveLength(2);
    expect(regression!.incidents[0]!.previous!.status).toBe(200);
  });

  it("fires on the spurious empty-Location 301 on an /ads cohort page", () => {
    const records = [
      moneyRecord("2026-09-08T13:50:00Z", "/ads/walmart.com", 200, "/search?q=walmart.com"),
      moneyRecord("2026-09-08T13:55:00Z", "/ads/walmart.com", 301, ""),
      moneyRecord("2026-09-08T14:00:00Z", "/ads/walmart.com", 301, ""),
    ];
    const regression = detectMoneyPathRegression(records);
    expect(regression).not.toBeNull();
    expect(regression!.incidents[0]!.path).toBe("/ads/walmart.com");
    expect(regression!.incidents[0]!.failures.every((f) => f.location === "")).toBe(true);
  });

  it("does not fire on a single non-200 sample (one-off blip)", () => {
    const records = [
      moneyRecord("2026-09-08T13:55:00Z", "/search?mode=advertiser&selected=1702938977100376", 500),
      moneyRecord("2026-09-08T14:00:00Z", "/search?mode=advertiser&selected=1702938977100376", 200),
    ];
    expect(detectMoneyPathRegression(records)).toBeNull();
  });

  it("does not fire when a path has fewer than minFailures records", () => {
    expect(detectMoneyPathRegression([moneyRecord("2026-09-08T13:55:00Z", "/ads/adobe.com", 500)])).toBeNull();
  });

  it("still fires on a 3-long red run whose start was missed by a skipped guard run", () => {
    const records = [
      moneyRecord("2026-09-08T13:45:00Z", "/ads/mailchimp.com", 200),
      moneyRecord("2026-09-08T13:50:00Z", "/ads/mailchimp.com", 500),
      moneyRecord("2026-09-08T13:55:00Z", "/ads/mailchimp.com", 500),
      moneyRecord("2026-09-08T14:00:00Z", "/ads/mailchimp.com", 500),
    ];
    const regression = detectMoneyPathRegression(records);
    expect(regression).not.toBeNull();
    expect(regression!.incidents[0]!.path).toBe("/ads/mailchimp.com");
  });

  it("does not fire when the two failures fall outside the 10-minute window", () => {
    const records = [
      moneyRecord("2026-09-08T13:40:00Z", "/ads/adobe.com", 500),
      moneyRecord("2026-09-08T14:00:00Z", "/ads/adobe.com", 500),
    ];
    expect(detectMoneyPathRegression(records)).toBeNull();
  });

  it("detector fires on an ongoing streak; the state filter dedupes an already-filed incident", () => {
    const records = [
      moneyRecord("2026-09-08T13:45:00Z", "/ads/canva.com", 500),
      moneyRecord("2026-09-08T13:50:00Z", "/ads/canva.com", 500),
      moneyRecord("2026-09-08T13:55:00Z", "/ads/canva.com", 500),
      moneyRecord("2026-09-08T14:00:00Z", "/ads/canva.com", 500),
    ];
    // The detector is a pure flap detector: it fires while the flap runs.
    const regression = detectMoneyPathRegression(records);
    expect(regression).not.toBeNull();
    // Idempotent filing lives in filterUnfiledIncidents: once the guard has
    // filed this path at or beyond its last failure sample, the incident is
    // dropped; a NEW failure sample (later runAt) re-arms filing.
    const filedAt = "2026-09-08T14:00:00Z";
    expect(
      filterUnfiledIncidents(regression!, { "/ads/canva.com": filedAt }),
    ).toHaveLength(0);
    const withNewFailure = [
      ...records,
      moneyRecord("2026-09-08T14:05:00Z", "/ads/canva.com", 500),
    ];
    const next = detectMoneyPathRegression(withNewFailure)!;
    expect(filterUnfiledIncidents(next, { "/ads/canva.com": filedAt })).toHaveLength(1);
  });

  it("tracks per-path incidents independently", () => {
    const records = [
      moneyRecord("2026-09-08T13:55:00Z", "/ads/canva.com", 200),
      moneyRecord("2026-09-08T13:55:00Z", "/ads/mailchimp.com", 500),
      moneyRecord("2026-09-08T14:00:00Z", "/ads/canva.com", 200),
      moneyRecord("2026-09-08T14:00:00Z", "/ads/mailchimp.com", 500),
    ];
    const regression = detectMoneyPathRegression(records);
    expect(regression).not.toBeNull();
    expect(regression!.incidents).toHaveLength(1);
    expect(regression!.incidents[0]!.path).toBe("/ads/mailchimp.com");
  });

  it("parses a real money-path.csv written by the probe and fires on it", () => {
    const dir = mkdtempSync(join(tmpdir(), "money-path-guard-"));
    const csvPath = join(dir, "money-path.csv");
    try {
      const runAt = "2026-09-08T13:55:00.000Z";
      writeFileSync(
        csvPath,
        [
          "run_at,path,status,location,outcome,elapsed_ms",
          `${runAt},/search?mode=advertiser&selected=1702938977100376,200,,ok,120`,
          `${runAt},/ads/hm.com,200,,ok,90`,
          `${runAt},/ads/atlassian.com,200,,ok,95`,
          `${runAt},/ads/adobe.com,200,,ok,88`,
        ].join("\n") + "\n",
        "utf8",
      );
      // A single green run never fires...
      expect(detectMoneyPathRegression(parseMoneyPathRecords(csvPath))).toBeNull();

      // ...then two stubbed-500 samples within 10 minutes fire the detector.
      const firedAt = "2026-09-08T14:00:00.000Z";
      const records = parseMoneyPathRecords(csvPath);
      records.push(
        moneyRecord(firedAt, "/ads/adobe.com", 500),
        moneyRecord("2026-09-08T14:05:00.000Z", "/ads/adobe.com", 500),
      );
      const regression = detectMoneyPathRegression(records);
      expect(regression).not.toBeNull();
      expect(formatMoneyPathIssueBody(regression!)).toContain("/ads/adobe.com");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("probe's moneyPathOutcome classifies a stubbed 500 as a failure", async () => {
    const { probeMoneyPathUrl, moneyPathOutcome } = await import(
      "../scripts/search-latency-probe.mjs"
    );
    expect(moneyPathOutcome(500)).toBe("error");
    expect(moneyPathOutcome(301)).toBe("error");
    expect(moneyPathOutcome(200)).toBe("ok");
    const record = await probeMoneyPathUrl("https://example.test", "/ads/adobe.com", {
      fetchImpl: (async () =>
        new Response("boom", { status: 500 })) as unknown as typeof fetch,
      nowImpl: () => 0,
    });
    expect(record.status).toBe(500);
    expect(record.outcome).toBe("error");
  });
});

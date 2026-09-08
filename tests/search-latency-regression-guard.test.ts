import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_THRESHOLD_MS,
  detectRegression,
  detectAuthRegression,
  formatIssueBody,
  formatAuthIssueBody,
  parseRuns,
  parseAuthRecords,
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
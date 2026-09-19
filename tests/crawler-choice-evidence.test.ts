import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CRAWLER_CHOICE_API_MODEL,
  CRAWLER_CHOICE_MODEL,
  summarizeCrawlerChoiceRows,
  type CrawlerChoiceRow,
} from "../app/lib/crawler-choice-jev.server";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const evidencePath = join(repoRoot, "docs", "benchmarks", "jev-crawler-choice-2026-09.jsonl");
const reportPath = join(repoRoot, "docs", "jev-crawler-choice-2026-09.md");
const benchPath = join(repoRoot, "scripts", "bench", "jev-crawler-choice-2026-09.mjs");

function loadRows(): CrawlerChoiceRow[] {
  return readFileSync(evidencePath, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as CrawlerChoiceRow);
}

describe("crawler-choice evidence (issue #3618)", () => {
  const rows = loadRows();
  const report = readFileSync(reportPath, "utf8");

  it("has the committed run size the report claims", () => {
    expect(rows).toHaveLength(15);
    expect(report).toContain("| **Total** | **15** | **12** | **0.80** |");
  });

  it("recomputes the report's agreement exactly from the rows", () => {
    const summary = summarizeCrawlerChoiceRows(rows);
    expect(summary.total).toBe(15);
    expect(summary.agreed).toBe(12);
    expect(summary.agreementRate).toBeCloseTo(0.8, 6);
    expect(summary.byChoicePoint).toEqual({
      meta_library_scroll: { total: 3, agreed: 1 },
      meta_library_api_cursor: { total: 3, agreed: 3 },
      fullsite_sitemap_queue: { total: 1, agreed: 1 },
      fullsite_crawl_frontier: { total: 8, agreed: 7 },
    });
  });

  it("every row carries the fleet-helper shape plus crawler context", () => {
    for (const row of rows) {
      expect(row.site).toBe("crawler-choice");
      expect(row.ref).toBe("Nishfleet/0509#3618");
      expect(row.state_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof row.ms).toBe("number");
      expect(row.usage.input_tokens).toBeGreaterThan(0);
      expect(row.candidates).toContain("stop");
      // The pick must always have been offered.
      expect(row.candidates).toContain(row.jev_choice);
      expect(row.agreed).toBe(row.jev_choice === row.scripted);
      expect(typeof row.probabilities[row.jev_choice]).toBe("number");
    }
  });

  it("probabilities sum to one on every row", () => {
    for (const row of rows) {
      const sum = Object.values(row.probabilities).reduce((total, value) => total + value, 0);
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(0.02);
    }
  });

  it("records the three disagreements the report describes", () => {
    const summary = summarizeCrawlerChoiceRows(rows);
    expect(summary.disagreements).toHaveLength(3);
    const scrollStops = summary.disagreements.filter(
      (row) => row.choice_point === "meta_library_scroll" && row.jev_choice === "stop",
    );
    expect(scrollStops).toHaveLength(2);
    expect(scrollStops.every((row) => row.scripted === "scroll_pass")).toBe(true);
    const frontierMove = summary.disagreements.find(
      (row) => row.choice_point === "fullsite_crawl_frontier",
    );
    expect(frontierMove?.jev_choice).toBe("https://www.cloudflare.com/products/");
  });

  it("every row records the model the answer came from", () => {
    // The report names jev-1.13.0. Without the row's own model field that claim
    // is un-auditable, which the previous head shipped.
    expect(rows.every((row) => typeof row.model === "string" && row.model !== "")).toBe(true);
    expect(report).toContain("jev-1.13.0");
  });

  it("the bench script parses and never sends the Workers binding id to the HTTP API", () => {
    // A duplicate `const MODEL` shipped on the previous head; the bench was a
    // syntax error that no test ran. `node --check` is the cheap gate for that.
    const check = spawnSync("node", ["--check", benchPath], { encoding: "utf8" });
    expect(check.stderr).toBe("");
    expect(check.status).toBe(0);

    // The bench talks HTTP; the binding id is not a valid HTTP model selector
    // (the API answers `Unknown model: typesafe/jev`), and `typesafe/jev` is
    // imported by name only for the doc reference — it must never be the value
    // sent in the request body.
    const source = readFileSync(benchPath, "utf8");
    expect(CRAWLER_CHOICE_MODEL).toBe("typesafe/jev");
    expect(CRAWLER_CHOICE_API_MODEL).not.toBe(CRAWLER_CHOICE_MODEL);
    expect(source).toContain("process.env.TYPESAFE_MODEL ?? CRAWLER_CHOICE_API_MODEL");
    expect(source).not.toContain("?? CRAWLER_CHOICE_MODEL");
  });

  it("holds no stale probability prose: report numbers match the rows", () => {
    // The report is hand-written prose; a re-run moves the numbers under it.
    // Every p= figure it quotes must be a probability in the committed rows.
    const quoted = [...report.matchAll(/p=(\d\.\d+)/g)].map((m) => Number(m[1]));
    expect(quoted.length).toBeGreaterThan(0);
    const rowProbabilities = new Set(
      rows.flatMap((row) => Object.values(row.probabilities).map((p) => p.toFixed(2))),
    );
    for (const p of quoted) expect(rowProbabilities.has(p.toFixed(2))).toBe(true);
  });

  it("holds no credentials or customer data", () => {
    const raw = readFileSync(evidencePath, "utf8");
    expect(raw).not.toMatch(/Bearer|Authorization|api[_-]?key|TYPESAFE_API_KEY/i);
    expect(raw).not.toMatch(/\bsk-[A-Za-z0-9]/);
  });

  it("the report states the switch-on gate and the not-planned verdict", () => {
    expect(report).toMatch(/Switch-on \(not done\)/);
    expect(report).toMatch(/Not-planned for switch-on now/);
    expect(report).toContain("env.AI.run(\"typesafe/jev\"");
  });
});

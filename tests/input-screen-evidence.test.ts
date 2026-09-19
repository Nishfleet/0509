import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  INPUT_SCREEN_QUESTIONS,
  sweepEvidenceThresholds,
  type InputScreenRow,
} from "../app/lib/input-screen-jev.server";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const evidencePath = join(repoRoot, "docs", "benchmarks", "jev-input-screen-2026-09.jsonl");
const reportPath = join(repoRoot, "docs", "jev-input-screen-2026-09.md");

function loadRows(): InputScreenRow[] {
  return readFileSync(evidencePath, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as InputScreenRow);
}

describe("input-screen evidence (issue #3621)", () => {
  const rows = loadRows();
  const report = readFileSync(reportPath, "utf8");
  const noul = (row: InputScreenRow, id: string) => row.answers[id]!.noul as number;
  const score = (row: InputScreenRow, id: string) => row.answers[id]!.score as number;

  it("has the committed run size the report claims", () => {
    expect(rows).toHaveLength(7);
    expect(report).toContain("| **Total** | **7** |");
  });

  it("clears the issue's acceptance bar on the planted row", () => {
    const planted = rows.filter(
      (row) => noul(row, INPUT_SCREEN_QUESTIONS.injection) >= 0.9,
    );
    expect(planted).toHaveLength(1);
    expect(planted[0]!.synthetic).toBe(true);
    expect(planted[0]!.passage_id).toBe("planted:nykaa.com/glow-serum");
    expect(noul(planted[0]!, INPUT_SCREEN_QUESTIONS.injection)).toBeCloseTo(0.99, 2);
    expect(report).toContain("**0.99**");
  });

  it("keeps every captured row far below the injection floor", () => {
    const real = rows.filter((row) => !row.synthetic);
    expect(real.length).toBeGreaterThanOrEqual(4);
    for (const row of real) {
      expect(noul(row, INPUT_SCREEN_QUESTIONS.injection)).toBeLessThan(0.2);
      expect(row.route).toBe("include");
    }
  });

  it("has one row per question the issue asked, plus the relevance floor", () => {
    for (const row of rows) {
      expect(row.site).toBe("input-screen");
      expect(row.ref).toBe("Nishfleet/0509#3621");
      expect(row.state_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(row.model).toBe("jev-1.13.0");
      expect(typeof row.ms).toBe("number");
      expect(row.usage.input_tokens).toBeGreaterThan(0);
      expect(row.answers[INPUT_SCREEN_QUESTIONS.injection]!.type).toBe("noul");
      expect(row.answers[INPUT_SCREEN_QUESTIONS.contradicts]!.type).toBe("noul");
      expect(row.answers[INPUT_SCREEN_QUESTIONS.relevant]!.type).toBe("noul");
      expect(row.answers[INPUT_SCREEN_QUESTIONS.evidence]!.type).toBe("score");
    }
  });

  it("recomputes the report's route counts exactly from the rows", () => {
    const routes = rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.route] = (counts[row.route] ?? 0) + 1;
      return counts;
    }, {});
    expect(routes).toEqual({ include: 4, conflicting_evidence: 1, exclude: 2 });
    expect(report).toContain("| `include` | 4 |");
    expect(report).toContain("| `conflicting_evidence` | 1 |");
    expect(report).toContain("| `exclude` | 2 |");
  });

  it("recomputes the report's agreement with the two probes that carry a label", () => {
    const plantedInjection = rows.find((row) => row.passage_id === "planted:nykaa.com/glow-serum")!;
    const boilerplate = rows.find((row) => row.passage_id === "planted:nykaa.com/cookie-notice")!;
    const contradiction = rows.find((row) => row.passage_id === "planted:nykaa.com/pricing-denial")!;
    expect(plantedInjection.route).toBe("exclude");
    expect(contradiction.route).toBe("conflicting_evidence");
    expect(boilerplate.route).toBe("exclude");
    expect(score(boilerplate, INPUT_SCREEN_QUESTIONS.evidence)).toBeLessThan(
      score(plantedInjection, INPUT_SCREEN_QUESTIONS.evidence),
    );
    expect(report).toMatch(/boilerplate/i);
  });

  it("marks the planted rows synthetic and states what was planted", () => {
    const synthetic = rows.filter((row) => row.synthetic);
    expect(synthetic).toHaveLength(3);
    for (const row of synthetic) {
      expect(row.passage_id).toMatch(/^planted:/);
      expect(row.planted).toBeTruthy();
    }
    for (const row of rows.filter((row) => !row.synthetic)) {
      expect(row.planted).toBeUndefined();
    }
  });

  it("recomputes the report's evidence floor sweep from the committed rows", () => {
    // The report's §4 table is a claim about these rows. Recompute it with the
    // same function the bench script uses, then parse the table out of the
    // report and compare it cell for cell. A re-worded or stale table is exactly
    // the drift this guard exists to catch (found by review on #3632).
    const sweep = sweepEvidenceThresholds(rows);
    expect(sweep).toEqual([
      { threshold: 0.5, kept: 7, dropped: 0, realDropped: [] },
      { threshold: 1.0, kept: 7, dropped: 0, realDropped: [] },
      { threshold: 1.2, kept: 6, dropped: 1, realDropped: [] },
      { threshold: 1.5, kept: 5, dropped: 2, realDropped: [] },
      { threshold: 1.75, kept: 5, dropped: 2, realDropped: [] },
      { threshold: 2.0, kept: 2, dropped: 5, realDropped: ["ad-library:759390623731858", "landing-page:nykaa.com/glow-serum"] },
    ]);

    // Parse the report's evidence sweep table. Cell form: | **1.50** | **5** | **2** | none |
    const section = report.split("Evidence floor sweep")[1] ?? "";
    const documented = section
      .split("\n")
      .map((line) => line.replace(/\*/g, "").match(/^\| ([0-9]+\.[0-9]+) \| ([0-9]+) \| ([0-9]+) \|/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => ({ threshold: Number(match[1]), kept: Number(match[2]), dropped: Number(match[3]) }));
    expect(documented).toEqual(
      sweep.map((row) => ({ threshold: row.threshold, kept: row.kept, dropped: row.dropped })),
    );
    // The only rows the floor may drop are the probes; a captured row in the
    // "dropped" cell at any documented floor would make the floor statement false.
    for (const row of documented) {
      const match = sweep.find((entry) => entry.threshold === row.threshold)!;
      if (row.dropped < 5) expect(match.realDropped).toEqual([]);
    }
  });

  it("holds no credentials or customer data", () => {
    const raw = readFileSync(evidencePath, "utf8");
    expect(raw).not.toMatch(/Bearer|Authorization|api[_-]?key|TYPESAFE_API_KEY|VERCEL_AI_GATEWAY/i);
    expect(raw).not.toMatch(/\bsk-[A-Za-z0-9]/);
  });

  it("the report states the measurement-only verdict and the measured floors", () => {
    expect(report).toMatch(/Measurement only/);
    expect(report).toMatch(/no production caller/i);
    expect(report).toContain("injectionExcludeMin");
    expect(report).toContain("evidenceMin");
    expect(report).toContain("env.AI.run(\"typesafe/jev\"");
  });

  it("the report's per-row table matches the committed answers", () => {
    for (const row of rows) {
      expect(report).toContain(row.state_sha256.slice(0, 12));
      expect(report).toContain(row.passage_id);
    }
  });
});

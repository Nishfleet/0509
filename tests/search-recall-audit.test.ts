import { readFileSync } from "node:fs";

import { isbot } from "isbot";
import { describe, expect, it } from "vitest";

import {
  BET2_DOMAINS,
  SECTION_1_8_RERUN,
  summarizeResults,
} from "../scripts/bet2-live-verification.mjs";
import {
  evaluateRecallAudit,
  RECALL_AUDIT_USER_AGENT,
} from "../scripts/search-recall-audit.mjs";

/**
 * Issue #3014: the free-preview recall audit over the BET 2 25-domain set.
 * The live probe is the scheduled ops timer, not a unit test; these pin the
 * audit's verdict composition offline — the exact #3014 metric gates composed
 * from the BET 2 termination check and the §1.8 rerun verdict.
 */

function result(domain, rowCount, tiers, extra = {}) {
  return {
    domain,
    rowCount,
    tierCounts: { verified: tiers.verified ?? 0, likely: tiers.likely ?? 0, unmatched: tiers.unmatched ?? 0 },
    url: `https://0509.io/search?website=${domain}&country=all`,
    status: 200,
    isWarming: false,
    isDeadEnd: rowCount === 0,
    firstCardAtMs: rowCount > 0 ? 800 : null,
    outcome: rowCount > 0 ? "rows" : "dead_end",
    emptyReason: rowCount === 0 ? "no_results" : null,
    ...extra,
  };
}

function passingRun() {
  // 24 domains with verified rows, 1 with only likely-labelled rows (85%=25.
  const results = BET2_DOMAINS.map((domain, i) =>
    i === 4 ? result(domain, 3, { likely: 3 }) : result(domain, 3, { verified: 3 }),
  );
  results[0] = result("gymshark.com", 1, { verified: 1 });
  const rerun = SECTION_1_8_RERUN.map((domain) => result(domain, 2, { verified: 2 }));
  return { run: { results, summary: summarizeResults(results) }, rerun };
}

describe("search recall audit (issue #3014) verdict composition", () => {
  it("measures exactly the BET 2 25-domain cohort plus the §1.8 rerun riders", () => {
    expect(BET2_DOMAINS).toHaveLength(25);
    for (const observed of ["allbirds.com", "notion.so", "oura.com"]) {
      expect(BET2_DOMAINS).toContain(observed);
      expect(SECTION_1_8_RERUN).toContain(observed);
    }
    // The probe UA must (a) identify the probe in access logs and (b) NOT be
    // bot-classed by isbot — entry.server.tsx awaits renderToReadableStream's
    // allReady for bots, which would time the crawler path and block the
    // first card on the landing capture instead of measuring the streaming
    // visitor path (issue #3014).
    expect(RECALL_AUDIT_USER_AGENT).toMatch(/0509-recall-probe/);
    expect(isbot(RECALL_AUDIT_USER_AGENT)).toBe(false);
  });

  it("a green cohort with all §1.8 brands non-empty passes", () => {
    const { run, rerun } = passingRun();
    expect(evaluateRecallAudit(run, { results: rerun }).pass).toBe(true);
  });

  it("a red verified share below the 80% floor fails", () => {
    const { run, rerun } = passingRun();
    run.summary.verifiedShare = 0.6;
    const verdict = evaluateRecallAudit(run, { results: rerun });
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((c) => c.name === "verified_share_at_or_above_floor").ok).toBe(false);
  });

  it("a dead-end empty state over the cohort fails", () => {
    const { run, rerun } = passingRun();
    run.summary.deadEnds = 1;
    const verdict = evaluateRecallAudit(run, { results: rerun });
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((c) => c.name === "zero_dead_ends").ok).toBe(false);
  });

  it("an empty §1.8 brand (allbirds/notion/oura) fails even with green aggregates", () => {
    const { run } = passingRun();
    const rerun = SECTION_1_8_RERUN.map((domain, i) =>
      i === 6 ? result(domain, 0, { verified: 0 }) : result(domain, 2, { verified: 2 }),
    );
    const verdict = evaluateRecallAudit(run, { results: rerun });
    expect(verdict.pass).toBe(false);
    const check = verdict.checks.find((c) => c.name === "section_1_8_allbirds_notion_oura_non_empty");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("oura");
  });

  it("rate-limited probes are never a pass — 'cannot confirm' is not coverage", () => {
    const { rerun } = passingRun();
    const summary = summarizeResults([
      result("notion.so", 5, { verified: 5 }, { outcome: "rate_limited" }),
    ]);
    const verdict = evaluateRecallAudit({ results: [], summary }, { results: rerun });
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((c) => c.name === "no_rate_limit_blocks").ok).toBe(false);
  });

  it("the audit probes the 25-domain cohort exactly once — rerun domains are members, not additions", () => {
    // The anonymous /search budget is 20 req / 10 min per IP. Concatenating
    // BET2_DOMAINS + SECTION_1_8_RERUN (runLiveVerification does NOT dedupe)
    // double-probes 7 domains, spends 32 of the 20-request budget and 429s
    // the cohort tail into guaranteed-fail. Every rerun domain must already
    // be a cohort member so the single 25-probe pass covers both verdicts.
    for (const domain of SECTION_1_8_RERUN) {
      expect(BET2_DOMAINS).toContain(domain);
    }
  });

  it("the scheduled timer repeats on the HOUR field, not the minute-field step (fleet incident class)", () => {
    // 2026-09-11 senior-auditor incident (0509-sneaker-resale-recall-canary):
    // `OnCalendar=03:00/3:00` reads as every 3 MINUTES during hour 03, not
    // every 3 hours — 20 over-budget production probes per hour, guaranteed
    // fails. The audit timer must carry the step on the hour field in the
    // seconds-suffixed form (`01/6:30:00`), never `HH:MM/6:00`.
    const timer = readFileSync(
      new URL("../ops/search-recall-audit/0509-search-recall-audit.user.timer", import.meta.url),
      "utf8",
    );
    const onCalendar = timer
      .split("\n")
      .filter((line) => line.startsWith("OnCalendar="))
      .map((line) => line.slice("OnCalendar=".length));
    expect(onCalendar).toHaveLength(1);
    expect(onCalendar[0]).toMatch(/^\*-\*-\* \d+\/\d+:\d+:\d+ Asia\/Kolkata$/);
    // The minute field must be a plain value — no `/` step on it.
    const timePart = onCalendar[0].split(" ")[1];
    const minuteField = timePart.split(":")[1];
    expect(minuteField).not.toContain("/");
  });
});

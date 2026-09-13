import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Issue #3263: actionlint's entire verdict input is `.github/**`, so the
// actionlint job is gated by a changed-file detector that runs as the second
// step of the (always-running, required) semgrep job — no extra check run,
// no extra checkout. The gate is two couplings that must not silently decay:
//
// 1. the detector exports its verdict through the SEMGREP JOB'S `outputs:`
//    (needs.semgrep.outputs.actionlint). Without that block the expression
//    reads an empty string, `'' != 'false'` is always true, and the gate
//    silently runs on every PR again.
// 2. the actionlint job-level `if:` skips ONLY on the literal 'false' —
//    fail-open: a missing output (non-PR events, where the detector step is
//    skipped) or a detector failure (files API unavailable) runs the
//    linter, it never silently skips the required-adjacent gate.
//
// The detection itself must use a pattern that matches plain paths like
// `.github/workflows/ci.yml`; the bracket form avoids the doubled-`\\`
// backtracking that made the first cut of this gate never match.
const source = readFileSync(".github/workflows/semgrep-actionlint.yml", "utf8");
const parsed = parse(source) as {
  on?: Record<string, unknown>;
  jobs: Record<
    string,
    {
      if?: string;
      needs?: string | string[];
      permissions?: Record<string, string>;
      outputs?: Record<string, string>;
      steps?: { name?: string; id?: string; if?: string; run?: string }[];
    }
  >;
};

const semgrep = parsed.jobs.semgrep;
const actionlint = parsed.jobs.actionlint;
const detector = (semgrep.steps ?? []).find((step) => step.id === "changes");

describe("semgrep-actionlint actionlint gate (issue #3263)", () => {
  it("exports the changed-file detector's verdict through the job outputs", () => {
    expect(
      semgrep.outputs?.actionlint,
      "semgrep job must export steps.changes.outputs.actionlint or the if: reads an empty string and always runs",
    ).toBe("${{ steps.changes.outputs.actionlint }}");
    expect(detector, "the changes detector step must exist in the semgrep job").toBeDefined();
  });

  it("gates actionlint on the detector, skipping only on the literal 'false'", () => {
    expect(actionlint.needs).toBe("semgrep");
    expect(actionlint.if).toBe(
      "always() && needs.semgrep.outputs.actionlint != 'false'",
    );
  });

  it("the detector runs only on pull_request, writes both verdicts, and matches plain .github paths", () => {
    expect(detector?.if).toBe("github.event_name == 'pull_request'");
    expect(detector?.run).toContain("actionlint=true");
    expect(detector?.run).toContain("actionlint=false");
    expect(detector?.run).toContain("grep -q '^[.]github/'");
  });

  it("a detector failure is fail-open: the linter still runs", () => {
    expect(detector?.run).toContain("::warning::files API unavailable; running actionlint unconditionally");
  });

  it("the detector can read the PR files list (job grants pull-requests: read)", () => {
    expect(semgrep.permissions).toMatchObject({
      contents: "read",
      "pull-requests": "read",
    });
  });

  it("semgrep itself stays ungated: no workflow-level paths: on pull_request or merge_group", () => {
    // semgrep is a required-adjacent gate that must run on EVERY PR; the
    // moment someone adds a workflow-level paths: filter here, silent skips
    // become a merge-queue hazard. Expect the bare pull_request trigger.
    expect(parsed.on?.pull_request).toBeNull();
    // Same for merge_group: the required semgrep verdict on the queue's
    // gh-readonly-queue ref must never be narrowed there either. A bare key
    // parses as null.
    expect(parsed.on?.merge_group).toBeNull();
  });
});

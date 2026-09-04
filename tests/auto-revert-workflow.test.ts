import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("auto-revert workflow", () => {
  const workflow = readFileSync(".github/workflows/auto-revert.yml", "utf8");
  const parsed = parse(workflow) as {
    on?: { workflow_run?: { workflows?: string[]; types?: string[]; branches?: string[] } };
    concurrency?: { group?: string; "cancel-in-progress"?: boolean };
    permissions?: Record<string, string>;
    jobs?: {
      "auto-revert"?: {
        "if"?: string;
        "timeout-minutes"?: number;
        steps?: Array<{ name?: string; run?: string }>;
      };
    };
  };

  const job = parsed.jobs?.["auto-revert"];
  const revertStep = job?.steps?.find((step) => step.name === "Revert or halt");
  const run = revertStep?.run ?? "";

  it("fires only on a failed workflow_run conclusion for main", () => {
    expect(parsed.on?.workflow_run?.types).toEqual(["completed"]);
    expect(parsed.on?.workflow_run?.branches).toEqual(["main"]);
    expect(job?.if).toBe("github.event.workflow_run.conclusion == 'failure'");
  });

  it("serializes parallel failures through a single auto-revert concurrency group", () => {
    expect(parsed.concurrency).toEqual({
      group: "auto-revert",
      "cancel-in-progress": false,
    });
  });

  it("exits 0 from every halt branch after filing its issue (halt is a designed success)", () => {
    // 0509#1355: a halt files an issue and is the designed, successful
    // outcome — the filed issue is the signal. The workflow run must stay
    // green so a halt does not double a deploy-failure storm with its own
    // GitHub failure email. All four guards (loop, freshness, repeated
    // failure, non-assertion deploy failure) route through
    // `halt_and_exit`, which calls `halt` then
    // `exit 0`.
    expect(run).toContain("halt_and_exit ()");

    // Each guard calls halt_and_exit, not a bare `halt` followed by `exit 1`.
    const haltAndExitCalls = run.match(/halt_and_exit "/g) ?? [];
    expect(haltAndExitCalls.length).toBe(4);

    // The loop guard (revert commit itself is red on main).
    expect(run).toContain('halt_and_exit "AUTO-REVERT HALT: revert commit itself is red on main"');
    // The freshness guard (main moved after the red commit).
    expect(run).toContain('halt_and_exit "AUTO-REVERT HALT: main moved after the red commit"');
    // The repeated-failure guard (infra fault across consecutive commits).
    expect(run).toContain(
      'halt_and_exit "AUTO-REVERT HALT: $RUN_NAME failing across consecutive commits',
    );
    // The non-assertion deploy-failure guard (0509#1576 accept 2: a failed
    // Deploy production run in a preflight/env step files an issue instead
    // of reverting product code).
    expect(run).toContain(
      'halt_and_exit "AUTO-REVERT HALT: $RUN_NAME failed in a non-assertion step',
    );
  });

  it("does not exit 1 from any halt branch", () => {
    // No `exit 1` may appear inside a halt branch. The only legitimate
    // `exit 1` in the step is the genuine revert-machinery error below
    // (PR number parse failure), which is asserted separately.
    const haltBranches = [
      'halt_and_exit "AUTO-REVERT HALT: revert commit itself is red on main"',
      'halt_and_exit "AUTO-REVERT HALT: main moved after the red commit"',
      'halt_and_exit "AUTO-REVERT HALT: $RUN_NAME failing across consecutive commits',
      'halt_and_exit "AUTO-REVERT HALT: $RUN_NAME failed in a non-assertion step',
    ];
    for (const branch of haltBranches) {
      const idx = run.indexOf(branch);
      expect(idx).toBeGreaterThan(-1);
      // From each halt_and_exit call to the next halt_and_exit call (or end
      // of that guard block), there must be no `exit 1`.
      const nextHalt = run.indexOf("halt_and_exit", idx + branch.length);
      const segment = run.slice(idx, nextHalt === -1 ? idx + 400 : nextHalt);
      expect(segment).not.toContain("exit 1");
    }
  });

  it("keeps genuine revert-machinery errors exiting non-zero", () => {
    // The PR-number parse failure is a real machinery error, not a designed
    // halt — it must keep exiting 1 so a broken revert PR is loud.
    expect(run).toContain('echo "could not parse PR number from $pr_url" >&2');
    expect(run).toContain("exit 1");
    // The step runs under set -euo pipefail, so any unguarded machinery
    // failure (git push, gh pr create, gh api) aborts non-zero without an
    // explicit exit.
    expect(run).toContain("set -euo pipefail");
  });

  it("a halt that cannot record itself still fails loud", () => {
    // halt_and_exit calls `halt` (which runs `gh issue create`/`comment`)
    // BEFORE `exit 0`. Under `set -euo pipefail`, a failed `gh issue
    // create`/`comment` aborts non-zero before `exit 0` is reached, so a
    // halt that could not file or comment on its issue is still a red run
    // rather than a silent green one.
    const haltAndExitDef = run.match(/halt_and_exit \(\)\s*\{([\s\S]*?)\n\s*\}/);
    expect(haltAndExitDef).not.toBeNull();
    const body = haltAndExitDef?.[1] ?? "";
    expect(body).toContain('halt "$1" "$2"');
    expect(body).toContain("exit 0");
    // `halt` is called before `exit 0` — order matters for the
    // fail-loud-under-set-e property.
    expect(body.indexOf('halt "$1" "$2"')).toBeLessThan(body.indexOf("exit 0"));
  });

  it("reverts a failed Deploy production run only when every failed step is an assertion step", () => {
    // 0509#1576 accept 2: auto-revert reverts only when the failed run
    // failed in the assertion step. The release-gate assertion steps are
    // Typecheck, Test (the full unsharded vitest run), Deploy (the release
    // gate holding the post-deploy Gate C canaries), and Verify complete
    // release evidence set. All other steps — the secret/token/env preflight
    // (`missing+=()`), install, evidence materialization, canary-token sync,
    // archiving — are environment faults and must file an issue instead.
    expect(run).toContain('if [ "$RUN_NAME" = "Deploy production" ]; then');
    expect(run).toContain("actions/runs/$RUN_ID/jobs");
    expect(run).toContain('"Typecheck"|"Test"|"Deploy"|"Verify complete release evidence set"');
    expect(run).toContain("missing+=()");
    expect(run).toContain(
      'halt_and_exit "AUTO-REVERT HALT: $RUN_NAME failed in a non-assertion step',
    );
  });

  it("removes the auto-revert label positionally (the --name form aborts every run)", () => {
    // `gh pr remove-label PR LABEL` takes the label positionally. The old
    // `--name auto-revert` form is an unknown flag: it aborted the step
    // right after opening the revert PR, leaving the PR unmerged and the
    // Auto revert run red (run 33486589900 on 88270582, 0509#1576).
    expect(run).toContain('gh pr remove-label "$pr_number" auto-revert --repo "$REPO"');
    expect(run).not.toContain("--name auto-revert");
  });
});

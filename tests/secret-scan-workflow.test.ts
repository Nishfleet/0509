import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// `gitleaks git` without --log-opts runs `git log --all`: every fetched claim
// branch is scanned, so one fixture on an unrelated branch turned main red and
// the auto-revert organ merged a revert of an innocent PR (0509#1817 reverted
// #1787, 2026-09-06). Every event must therefore scope the scan explicitly.
describe("secret-scan workflow scopes every gitleaks scan", () => {
  const workflow = readFileSync(".github/workflows/secret-scan.yml", "utf8");
  const parsed = parse(workflow) as {
    jobs?: { gitleaks?: { steps?: Array<{ name?: string; run?: string }> } };
  };
  const run = parsed.jobs?.gitleaks?.steps?.find((step) => step.name === "Scan repository")?.run ?? "";
  const code = run
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

  it("scopes pull_request and merge_group scans to the PR's own base..head", () => {
    expect(code).toMatch(/^\s*pull_request\|merge_group\)\s*$/m);
    expect(code).toContain('log_opts=(--log-opts "${PR_BASE_SHA}..${PR_HEAD_SHA}")');
  });

  it("scopes push and dispatch scans to the authorized commit's ancestry, never every ref", () => {
    expect(code).toContain('log_opts=(--log-opts "--full-history HEAD")');
    expect(code).not.toMatch(/--all\b/);
    expect(code).not.toMatch(/^\s*log_opts=\(\)\s*$/m);
  });

  it("always hands the scope to the single gitleaks invocation", () => {
    const invocations = code.split("\n").filter((line) => /^\s*gitleaks git /.test(line));
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toContain('"${log_opts[@]}"');
  });
});

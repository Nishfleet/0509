import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// fleet-ops#6829: pins .github/workflows/dependency-review.yml, the Dependency
// Review gate adopted from GitHub's documented supply-chain practice — every
// pull request is diffed against known vulnerabilities and fails at severity
// high for runtime-scoped dependencies. The registration mechanism is this
// pin test (the same pattern tests/secret-scan-workflow.test.ts uses for the
// gitleaks gate): the workflow cannot silently disappear or be gutted without
// a red test.
describe("dependency-review workflow gate", () => {
  const workflow = readFileSync(".github/workflows/dependency-review.yml", "utf8");
  const parsed = parse(workflow) as {
    on?: Record<string, unknown>;
    permissions?: unknown;
    jobs?: {
      "dependency-review"?: {
        name?: string;
        if?: string;
        needs?: string | string[];
        "timeout-minutes"?: number;
        permissions?: Record<string, string>;
        steps?: Array<{ uses?: string; with?: Record<string, unknown> }>;
      };
    };
  };
  const job = parsed.jobs?.["dependency-review"];
  const step = job?.steps?.find((s) => s.uses?.startsWith("actions/dependency-review-action@"));

  it("fires on pull_request and merge_group so the queue build is gated too", () => {
    expect(parsed.on).toMatchObject({ pull_request: null, merge_group: null });
  });

  it("pins actions/dependency-review-action by commit SHA (v4.9.0), never a floating tag", () => {
    expect(step?.uses).toBe(
      "actions/dependency-review-action@2031cfc080254a8a887f58cffee85186f0e49e48",
    );
    expect(workflow).not.toMatch(/dependency-review-action@v\d/);
  });

  it("fails on high-severity findings in runtime-scoped dependencies", () => {
    expect(step?.with?.["fail-on-severity"]).toBe("high");
    expect(step?.with?.["fail-on-scopes"]).toBe("runtime");
  });

  it("wires the merge_group group SHAs into base-ref/head-ref", () => {
    expect(String(step?.with?.["base-ref"])).toContain("github.event.merge_group.base_sha");
    expect(String(step?.with?.["head-ref"])).toContain("github.event.merge_group.head_sha");
  });

  it("can never conclude SKIPPED and grants contents: read only", () => {
    expect(job).toBeDefined();
    expect(job!.if).toBeUndefined();
    expect(job!.needs).toBeUndefined();
    expect(parsed.permissions).toEqual({});
    expect(job!.permissions).toEqual({ contents: "read" });
  });
});

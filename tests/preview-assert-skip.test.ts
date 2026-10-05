import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// #5547: the preview-assert job skips setup-node, npm ci and the build when a
// pull request touches only docs/tests (the `scope` step sets skip=true), so
// every later step needs `if: steps.scope.outputs.skip != 'true'` — #5507
// added the bundle-budget assert without it and every docs-only PR went red
// on `npx vitest` with no node_modules. The test reads the real workflow
// file; a restated copy could pass forever against a job that moved on.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
}

describe("preview-assert docs/tests skip guard", () => {
  it("guards every step after `scope` with the skip flag", async () => {
    const yaml = await readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const steps = (parse(yaml) as { jobs: Record<string, { steps: Step[] }> }).jobs["preview-assert"].steps;
    const scopeAt = steps.findIndex((step) => step.id === "scope");
    expect(scopeAt).toBeGreaterThanOrEqual(0);
    const postScope = steps.slice(scopeAt + 1);
    expect(postScope.length).toBeGreaterThan(0);
    for (const step of postScope) {
      const guard = step.if ?? "";
      const guarded =
        guard.includes("steps.scope.outputs.skip != 'true'") ||
        // The failure-artifact upload must still run on a red non-skipped run.
        guard.startsWith("failure()");
      expect(guarded, `unguarded step: ${step.name ?? step.uses ?? "?"}`).toBe(true);
    }
  });
});

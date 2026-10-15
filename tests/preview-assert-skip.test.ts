import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

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
      const guarded = guard.includes("steps.scope.outputs.skip != 'true'") || guard.startsWith("failure()");
      expect(guarded, `unguarded step: ${step.name ?? step.uses ?? "?"}`).toBe(true);
    }
  });
});

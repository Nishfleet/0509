import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// #5547: the preview-assert job skips setup-node, npm ci and the build when a
// pull request touches only docs/tests (the `scope` step sets skip=true), so
// every later step needs `if: steps.scope.outputs.skip != 'true'` — #5507
// added the bundle-budget assert without it and every docs-only PR went red
// on `npx vitest` with no node_modules. The test reads the real workflow
// file; a restated copy could pass forever against a job that moved on.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// `readJob` extracts one job block as raw text: from `  <name>:` to the next
// two-space sibling job header (or EOF).
function readJob(yaml: string, name: string): string {
  const lines = yaml.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) throw new Error(`${name} job not found in ci.yml`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[a-z][a-z0-9_-]*:$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("preview-assert docs/tests skip guard", () => {
  it("guards every step after `scope` with the skip flag", async () => {
    const yaml = await readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const job = readJob(yaml, "preview-assert");
    const steps = job.split("\n      - ").slice(1);
    const scopeAt = steps.findIndex((step) => step.includes("id: scope"));
    expect(scopeAt).toBeGreaterThanOrEqual(0);
    const postScope = steps.slice(scopeAt + 1);
    expect(postScope.length).toBeGreaterThan(0);
    for (const step of postScope) {
      const guarded =
        step.includes("if: steps.scope.outputs.skip != 'true'") ||
        // The failure-artifact upload must still run on a red non-skipped run.
        step.includes("if: failure()");
      expect(guarded, `unguarded step: ${step.split("\n", 1)[0].trim()}`).toBe(true);
    }
  });
});

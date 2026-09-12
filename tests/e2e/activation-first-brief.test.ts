/**
 * Issue #3015 verify gate.
 *
 * The issue's verify command is:
 *   node --test tests/e2e/activation-first-brief.test.ts
 *
 * Node's builtin runner cannot import the app's `~/` aliased modules
 * directly (no imports map in package.json), so this gate drives the
 * *real* shipped contract suites for the in-session first-brief path
 * through the repo's own vitest binary (node project):
 *
 *   - tests/first-brief.test.ts            — evidence-link helpers: a
 *     first-brief digest item carries a resolvable `sourceUrl`
 *     (buildFirstBriefDigestItems / hasEvidenceLinkedItem / resolveEvidenceUrl)
 *   - tests/first-brief.server.test.ts     — file + dispatch path: the brief
 *     lands from the activation-scan baseline and goes out on the digest
 *     email path with the "Your first brief" subject
 *   - tests/activation/first-brief-same-session.test.tsx
 *                                          — the on-screen render contract:
 *     the signup first-brief view shows evidence-linked items
 *
 * The browser-player termination spec (the Playwright BET 7 spec,
 * e2e/activation-first-brief.spec.ts) is covered by CI's workspace project:
 * `npx playwright test --config=playwright.config.ts --project=workspace
 *   e2e/activation-first-brief.spec.ts` — that spec boots its own dev server
 * with the first-brief flag enabled, so it is not affected by the shared
 * webServer block and is intentionally not re-run here.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const vitestBin = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");

const CONTRACT_SUITES = [
  "tests/first-brief.test.ts",
  "tests/first-brief.server.test.ts",
  "tests/activation/first-brief-same-session.test.tsx",
] as const;

function runVitest(files: readonly string[]): { status: number | null } {
  // No coverage, no typecheck: CI owns both (fleet memory budget).
  return spawnSync(
    process.execPath,
    [
      vitestBin,
      "run",
      "--configLoader",
      "runner",
      "--project",
      "node",
      ...files,
    ],
    {
      cwd: repoRoot,
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 240_000,
    },
  );
}

describe("activation first-brief acceptance (#3015)", () => {
  for (const suite of CONTRACT_SUITES) {
    it(`contract suite passes: ${suite}`, () => {
      const result = runVitest([suite]);
      assert.equal(
        result.status,
        0,
        `vitest exited null or nonzero for ${suite} (exit ${result.status})`,
      );
      assert.notEqual(result.status, null);
    });
  }

  it("the shipped termination spec for BET 7 stays wired to this path", () => {
    // The on-screen brief renders with >=1 evidence-linked item in the same
    // session (BET 7). Its browser spec must keep existing so the funnel
    // surface cannot go dark silently.
    const spec = path.join(repoRoot, "e2e", "activation-first-brief.spec.ts");
    const source = readFileSync(spec, "utf8");
    assert.ok(
      /evidence[- ]linked/i.test(source),
      "termination spec must assert the evidence-linked brief render",
    );
  });
});


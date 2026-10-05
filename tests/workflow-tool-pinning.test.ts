import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The agent that lands these pull requests has Contents write and no Workflows
// permission, and Nish kept it that way (2026-10-05, 0509#7025). A workflow has
// to run every tool from the lockfile: a version written into the workflow
// itself is invisible to Dependabot and drifts on the next bump, and
// `npx --yes <pkg>@<version>` fetches a version that is in no lockfile at all.
// The same rule covers a remote rule file: a raw.githubusercontent.com URL
// holds a ref, and a branch there moves under us, so a push to that repo turns
// this repo's required check red with no change here (0509#7025). A commit SHA
// is the fix.

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKFLOW_DIR = path.join(ROOT, ".github/workflows");
const workflows = globSync("*.yml", { cwd: WORKFLOW_DIR }).sort();

function lines(file: string): string[] {
  return readFileSync(path.join(WORKFLOW_DIR, file), "utf8").split("\n");
}

// A tool pinned inside the workflow: `npx --yes ...` fetches outside the
// lockfile, and a literal like `wrangler@4.144.0` drifts from it.
const INLINE_TOOL_PIN = /\bnpx\s+--yes\b|\bwrangler@\d/;

// raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>, where <ref> must be a
// full commit SHA rather than a branch name.
const REMOTE_RULE_FILE = /raw\.githubusercontent\.com\/[^/\s]+\/[^/\s]+\/([^/\s]+)\//;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

function inlineToolPins(): string[] {
  return workflows.flatMap((file) =>
    lines(file).flatMap((line, index) => (INLINE_TOOL_PIN.test(line) ? [`${file}:${index + 1}`] : [])),
  );
}

function unpinnedRemoteRuleFiles(): string[] {
  return workflows.flatMap((file) =>
    lines(file).flatMap((line, index) => {
      const ref = REMOTE_RULE_FILE.exec(line)?.[1];
      if (ref === undefined) return [];
      return COMMIT_SHA.test(ref) ? [] : [`${file}:${index + 1}`];
    }),
  );
}

describe("workflow tools come from the lockfile (0509#7025)", () => {
  it("pins no tool inside a workflow", () => {
    expect(inlineToolPins()).toEqual([]);
  });

  it("fetches every remote rule file from a commit", () => {
    expect(unpinnedRemoteRuleFiles()).toEqual([]);
  });

  it("declares @lhci/cli in package.json", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>;
    };
    expect(pkg.devDependencies ?? {}).toHaveProperty("@lhci/cli");
  });

  it("resolves @lhci/cli from the lockfile", () => {
    expect(readFileSync(path.join(ROOT, "package-lock.json"), "utf8")).toContain('"node_modules/@lhci/cli"');
  });

  it("calls lhci by name in ci.yml", () => {
    const ci = readFileSync(path.join(WORKFLOW_DIR, "ci.yml"), "utf8");
    expect(ci).toContain("npx lhci collect");
    expect(ci).toContain("npx lhci assert");
  });

  it("installs from the lockfile in cloudflare-settings.yml", () => {
    const settings = readFileSync(path.join(WORKFLOW_DIR, "cloudflare-settings.yml"), "utf8");
    expect(settings).toContain("npm ci");
    expect(settings).not.toMatch(/\bWRANGLER:/);
  });
});

import { globSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKFLOW_DIR = path.join(ROOT, ".github/workflows");

const workflows = globSync(["*.yml", "*.yaml"], { cwd: WORKFLOW_DIR }).sort();

function lines(file: string): string[] {
  return readFileSync(path.join(WORKFLOW_DIR, file), "utf8").split("\n");
}

const INLINE_TOOL_PIN = /\bnpx\s+--yes\b|\bwrangler@\d/;

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
  it("scans every workflow file, .yml and .yaml", () => {
    const onDisk = readdirSync(WORKFLOW_DIR)
      .filter((file) => /\.ya?ml$/.test(file))
      .sort();
    expect(workflows).toEqual(onDisk);
    expect(workflows).toContain("ci.yml");
  });

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

  it("resolves @lhci/cli 0.15.1 from the lockfile", () => {
    const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8")) as {
      packages?: Record<string, { version?: string }>;
    };
    expect(lock.packages?.["node_modules/@lhci/cli"]?.version).toBe("0.15.1");
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

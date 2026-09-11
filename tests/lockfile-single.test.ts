import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// 0509#2959: the repo must carry exactly ONE dependency lockfile. npm is the
// package manager everywhere it matters — every CI/deploy workflow runs
// `npm ci` against package-lock.json, Dependabot is
// `package-ecosystem: npm`, and scripts/codex/setup-worktree.sh installs from
// package-lock.json. bun.lock was a stray without a single consumer, so it
// was deleted; this check fails the moment both it and package-lock.json
// (or any two of the known lockfiles) reappear, which would leave `npm ci`
// and any bun-style install silently diverging.
const KNOWN_LOCKFILES = [
  "package-lock.json",
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
] as const;

const repoRoot = join(import.meta.dirname, "..");

describe("single dependency lockfile (0509#2959)", () => {
  it("has exactly one lockfile at the repo root", () => {
    const present = KNOWN_LOCKFILES.filter((name) =>
      existsSync(join(repoRoot, name)),
    );
    expect(present, `duplicate lockfiles: ${present.join(", ")}`).toHaveLength(1);
  });

  it("uses npm: the sole lockfile is package-lock.json", () => {
    expect(existsSync(join(repoRoot, "package-lock.json"))).toBe(true);
    const parsed = JSON.parse(
      readFileSync(join(repoRoot, "package-lock.json"), "utf8"),
    ) as { lockfileVersion?: number };
    expect(parsed.lockfileVersion).toBeTypeOf("number");
  });
});

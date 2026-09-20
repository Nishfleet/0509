import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guard for issue #3215: ban absolute timestamps in test fixtures that feed
 * code compared against `Date.now()` / `new Date()`.
 *
 * Reports 2026-09-12: a hardcoded digest-sent timestamp aged past
 * staleness threshold on a clock tick
 *
 * A test file is time-bombed when it contains BOTH:
 *  - an ISO-8601 absolute timestamp literal, and
 *  - a reference to `Date.now()` or `new Date()` (the code-under-test or the
 *    assertion itself reads the wall clock), so the age gap drifts as real
 *    time passes.
 *
 * A file escapes the guard when it explicitly states it is safe:
 *  - every flagged literal carries a `// fixed-date: <why>` comment (same
 *    line or the line above) — genuinely historical fixtures; or
 *  - the file pins the clock with `vi.useFakeTimers` + `vi.setSystemTime`
 *    (the literal is then frozen-clock-relative and cannot age out); or
 *  - the file already pins clocks with `vi.useFakeTimers({ now: ... })`.
 */

const ISO_LITERAL = /20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d/;
const WALL_CLOCK = /\bDate\.now\(\)|\bnew Date\(\)/;
/**
 * Pinned-clock detector: a file that freezes the wall clock cannot age out.
 * Recognized as pinned when it either seeds `vi.useFakeTimers` with a fixed
 * `now`, or leaves the default fake clock but advances it to an explicit
 * instant via `vi.setSystemTime`.
 */
const FROZEN =
  /vi\.useFakeTimers\(\s*\{[\s\S]{0,200}?now:\s?|vi\.useFakeTimers\(\)[\s\S]{0,500}?vi\.setSystemTime\(/;

const TEST_EXTENSIONS = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

function listTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const stat = statSync(p);
    if (stat.isDirectory()) out.push(...listTestFiles(p));
    else if (TEST_EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(p);
  }
  return out;
}

describe("no absolute-vs-wall-clock time bombs in test fixtures (issue #3215)", () => {
  it("every test file with an ISO literal is either pinned, relative, or marked fixed-date", () => {
    const violations: string[] = [];
    for (const file of listTestFiles("tests")) {
      const text = readFileSync(file, "utf8");
      if (!ISO_LITERAL.test(text) || !WALL_CLOCK.test(text)) continue;
      // Frozen-clock files cannot age out: the wall clock is set to a fixed
      // instant for the whole file (cases that need real time call
      // vi.useRealTimers() inside the test and can't use absolute fixtures
      // against it).
      if (FROZEN.test(text)) continue;
      const lines = text.split("\n");
      const unannotated = lines.filter((line, i) => {
        if (!ISO_LITERAL.test(line)) return false;
        const above = lines[i - 1] ?? "";
        return (
          !line.includes("// fixed-date:") &&
          !line.includes("-- fixed-date:") &&
          !above.includes("// fixed-date:") &&
          !above.includes("-- fixed-date:")
        );
      });
      if (unannotated.length === 0) continue;
      violations.push(
        `${file}: ${unannotated.length} absolute timestamp literal(s) in a file that reads Date.now()/new Date(). Pin the clock (vi.useFakeTimers({ now: ... }) + restore in afterEach), rewrite the fixture relative to Date.now(), or add "// fixed-date: <why>" on/above each literal line ("-- fixed-date:" inside SQL template strings). First offender: line ${lines.indexOf(unannotated[0]) + 1}: ${unannotated[0].trim().slice(0, 120)}`,
      );
    }
    expect(violations).toEqual([]);
  });
});

/**
 * Guard for issue #3646: ban test fixtures that name a git object HEAD does
 * not keep.
 *
 * Report 2026-09-19: two deploy-gate fixtures pinned the rewritten-away
 * deploy head d16b1f00, an object that survives only on disposable
 * claim/backup branches. Warm clones kept resolving it, so the fixtures
 * stayed green for weeks; a clean PR checkout (merge ref, reachable history
 * only) genuinely lacks it, so both fixtures went red in CI. Same family as
 * #3215 — the fixture's input decays as the repo moves, not the wall clock.
 *
 * A literal is a bomb when it resolves to an object in THIS clone that is
 * not reachable from HEAD — kept today by a disposable ref, absent tomorrow.
 * A literal that does not resolve here is skipped: a fixture depending on an
 * absent object fails on its own, and an opaque string is not a dependency.
 * Ancestor commits and the trees/blobs reachable from them are kept by every
 * checkout, so they are always safe to name.
 *
 * Escape: `// dead-sha: <why>` on the literal line or the line directly
 * above it (`-- dead-sha:` inside SQL template strings, where `//` would be
 * string content) — for literals used as opaque strings that never go
 * through git object resolution.
 */

const GIT_OBJECT_LITERAL = /["'`]([0-9a-f]{7,40})["'`]/g;
const DEAD_SHA_NOTE = "// dead-sha:";

function reachableObjects(): Set<string> {
  const out = spawnSync("git", ["rev-list", "--objects", "HEAD"], {
    encoding: "utf8",
    // The whole reachable-object listing (~2MB at 39k objects) overflows the
    // 1MB default — ENOBUFFER surfaces as status null with empty stderr.
    maxBuffer: 64 * 1024 * 1024,
  });
  if (out.status !== 0) {
    throw new Error(
      `git rev-list --objects HEAD failed: ${out.stderr?.trim() ?? out.status}`,
    );
  }
  return new Set(
    out.stdout
      .split("\n")
      .map((line) => line.split(" ")[0])
      .filter((id) => /^[0-9a-f]{40}$/.test(id)),
  );
}

function resolveObjectName(
  name: string,
  cache: Map<string, string | null>,
): string | null {
  if (!cache.has(name)) {
    // Existence first: `rev-parse --verify` accepts a syntactically valid
    // 40-hex name without checking the object store, so sentinel literals
    // ("aaaa…", "1111…") would "resolve" to themselves. `cat-file -e` fails
    // unless the object is actually present and the name unambiguous.
    const exists = spawnSync("git", ["cat-file", "-e", name], {
      encoding: "utf8",
    });
    if (exists.status !== 0) {
      cache.set(name, null);
      return null;
    }
    const out = spawnSync(
      "git",
      ["rev-parse", "--verify", "--quiet", name],
      { encoding: "utf8" },
    );
    const sha = (out.stdout ?? "").trim();
    cache.set(name, /^[0-9a-f]{40}$/.test(sha) ? sha : null);
  }
  return cache.get(name) ?? null;
}

describe("no disposable-branch git objects in test fixtures (issue #3646)", () => {
  it("every git object a test file names is reachable from HEAD or marked dead-sha", () => {
    const reachable = reachableObjects();
    const resolveCache = new Map<string, string | null>();
    const dirs = ["tests", "e2e"].filter((d) => existsSync(d));
    const violations: string[] = [];
    for (const file of dirs.flatMap((d) => listTestFiles(d))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const match of line.matchAll(GIT_OBJECT_LITERAL)) {
          const resolved = resolveObjectName(match[1], resolveCache);
          if (!resolved || reachable.has(resolved)) continue;
          const above = lines[i - 1] ?? "";
          if (
            line.includes(DEAD_SHA_NOTE) ||
            line.includes("-- dead-sha:") ||
            above.includes(DEAD_SHA_NOTE) ||
            above.includes("-- dead-sha:")
          ) {
            continue;
          }
          violations.push(
            `${file}:${i + 1}: "${match[1]}" resolves to ${resolved}, an object HEAD does not keep — it survives only on disposable refs and a clean PR checkout may lack it (issue #3646). Fabricate the shape from kept objects (git commit-tree), name an ancestor, or add "// dead-sha: <why>" on/above the line when the literal is an opaque string never resolved through git.`,
          );
        }
      });
    }
    expect(violations).toEqual([]);
  });
});

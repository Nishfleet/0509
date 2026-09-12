import { readFileSync, readdirSync, statSync } from "node:fs";
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

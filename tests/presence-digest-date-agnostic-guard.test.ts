import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { join } from "node:path";

/**
 * Guard for issue #1954: the mention-digest resweep test hardcoded a
 * `2026-08-` calendar month inside the presence-digest idempotency-key
 * regex, so the suite broke on the September rollover. The key's date is
 * derived from `Date.now()` in app/lib/presence-digest.server.ts, so any
 * regex asserting that key must be date-agnostic (shape-only or derived
 * from the same clock expression).
 *
 * This guard fails if any test file embeds a regex literal that pairs the
 * `presence-digest:` key prefix with a hardcoded calendar date.
 */

function listTestFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listTestFiles(path);
    return entry.isFile() && /\.test\.[tj]sx?$/.test(entry.name) ? [path] : [];
  });
}

describe("presence-digest idempotency-key regexes are date-agnostic (#1954)", () => {
  it("no test embeds a presence-digest key regex with a hardcoded calendar date", () => {
    const offenders: string[] = [];
    for (const file of listTestFiles("tests")) {
      const source = readFileSync(file, "utf8");
      // Regex literals (slash-delimited, not string literals) that mention
      // the presence-digest key prefix AND a hardcoded `20XX-MM(-DD)` date.
      // Dates built from Date.now()/clock expressions never appear as
      // literals like this; mock idempotency-key *inputs* are plain strings
      // and are deliberately not flagged.
      const pattern = /(?<![\w"'])\/[^\n]*presence-digest:[^\n]*20\d{2}-(?:0[1-9]|1[0-2])(?:-\d{2})?[^\n]*\/[a-z]*/;
      if (pattern.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

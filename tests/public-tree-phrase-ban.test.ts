import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The public tree must measure, not confess.
 *
 * Nish (2026-09-12): "the status page lists all the weakness omfg fix them."
 * A public page that says what it "does not measure" is a weakness list. The
 * measured status surfaces now render real states (Operational / Degraded /
 * Down) sourced from probes and D1 rows, so this guard bans the confession
 * vocabulary from every public route plus the public-markdown feed.
 *
 * Scope: unauthenticated routes (files in app/routes/ whose name does not
 * start with `app.`, `api.`, or `auth`, plus the session-gated operator
 * console `ops.tsx` is excluded) and app/lib/public-markdown.ts. Authenticated
 * app.* routes and API resources are out of scope.
 */
const BANNED_PHRASES = [
  "unavailable",
  "not measured",
  "not live-checked",
  "does not measure",
  "limited today",
] as const;

const PUBLIC_MARKDOWN = "app/lib/public-markdown.ts";

function publicRouteFiles(): string[] {
  const routesDir = join(process.cwd(), "app", "routes");
  return readdirSync(routesDir)
    .filter((name) => /\.tsx?$/.test(name))
    .filter((name) => !/^(app\.|api\.|auth\.|auth-|ops\.)/.test(name))
    .map((name) => join("app", "routes", name));
}

describe("public tree phrase ban", () => {
  it("keeps the confession vocabulary out of every public route", () => {
    const offenders: string[] = [];
    for (const file of publicRouteFiles()) {
      const contents = readFileSync(join(process.cwd(), file), "utf8");
      for (const phrase of BANNED_PHRASES) {
        if (contents.toLowerCase().includes(phrase)) {
          offenders.push(`${file}: "${phrase}"`);
        }
      }
    }
    expect(
      offenders,
      `Status pages measure; they never confess. Remove the banned phrasing from:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps the confession vocabulary out of the public markdown feed", () => {
    const contents = readFileSync(join(process.cwd(), PUBLIC_MARKDOWN), "utf8");
    for (const phrase of BANNED_PHRASES) {
      expect(
        contents.toLowerCase().includes(phrase),
        `${PUBLIC_MARKDOWN} must not contain "${phrase}"`,
      ).toBe(false);
    }
  });
});

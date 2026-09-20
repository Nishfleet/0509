import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Issue #2817 (found during #2483 / PR #2815): every call site that attaches
 * `x-0509-canary-token` to an outbound request must (a) build the URL from the
 * canonical https://0509.io origin — validated, not string-concatenated — and
 * (b) fetch with `redirect: "manual"` plus per-hop revalidation, or an
 * equivalent guard like the `fetchCanary`/`validateCanonicalBaseUrl` pair the
 * deleted scripts/dodo-billing-canary.mjs provided. `fetch()` defaults to
 * `redirect: "follow"` and forwards custom headers cross-origin — that is the
 * leak #2483 fixed.
 *
 * The three script call sites this issue named were removed with `scripts/`
 * in the zero()/cut() commits, so today nothing sends the header outbound.
 * This guard keeps the pattern from coming back. `tests/` is not scanned:
 * mocked request headers there exercise the server-side read path, they are
 * not outbound sends. `docs/` and `legacy/` are historical records.
 */

const SOURCE_SUFFIX = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".react-router",
  "coverage",
  "tests",
  "docs",
  "legacy",
]);
const SKIP_FILES = new Set(["worker-configuration.d.ts"]);

// An attach site is a request-header object entry or a Headers.set/append call
// carrying the token. `headers.get(...)` reads are the server side and do not
// match.
const ATTACH =
  /(["']x-0509-canary-token["']|\[\s*CANARY_TOKEN_HEADER\s*\])\s*:|\.(?:set|append)\(\s*(?:["']x-0509-canary-token["']|CANARY_TOKEN_HEADER)/;
const REDIRECT_GUARD = /redirect:\s*["']manual["']/;
const CANONICAL_BASE = /validateCanonicalBaseUrl|CANONICAL_(?:BASE_)?URL|https:\/\/(?:www\.)?0509\.io/;
const GUARDED_HELPER = /fetchCanary|validateCanonicalBaseUrl/;
const GUARD_WINDOW_LINES = 25;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") && entry.name !== ".github") return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(path);
    }
    return SOURCE_SUFFIX.test(entry.name) && !SKIP_FILES.has(entry.name) ? [path] : [];
  });
}

describe("canary token redirect guard (#2817)", () => {
  it("never attaches x-0509-canary-token outbound without the canonical-origin and redirect guards", () => {
    const offenders: string[] = [];

    for (const path of sourceFiles(".")) {
      const lines = readFileSync(path, "utf8").split("\n");
      const attachLines = lines.flatMap((line, index) => (ATTACH.test(line) ? [index] : []));
      if (attachLines.length === 0) continue;

      const content = lines.join("\n");
      if (GUARDED_HELPER.test(content)) continue;

      const hasCanonicalBase = CANONICAL_BASE.test(content);
      for (const index of attachLines) {
        const window = lines
          .slice(Math.max(0, index - GUARD_WINDOW_LINES), index + GUARD_WINDOW_LINES + 1)
          .join("\n");
        if (!REDIRECT_GUARD.test(window) || !hasCanonicalBase) {
          offenders.push(`${path}:${index + 1}`);
        }
      }
    }

    expect(
      offenders,
      "these sites attach x-0509-canary-token without a guard; fetch() would forward the " +
        "token to a redirect target. Route through a guarded helper (fetchCanary/" +
        "validateCanonicalBaseUrl style), or build the URL from the canonical " +
        "https://0509.io origin and fetch with `redirect: \"manual\"` — see issue #2817.",
    ).toEqual([]);
  });
});

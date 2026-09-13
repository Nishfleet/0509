import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Vitest 4 removed the built-in `basic` reporter: running with that old long
 * flag Startup-Errors before a single test runs (issue #3370, vitest 4.1.11).
 * The tracked convention surfaces — the instruction entrypoint
 * (`AGENTS.md`, which every pickup reads before running anything) and
 * everything machine-read under `.github/` — must therefore stay on the bare
 * `npx vitest run <path>` form, which works on every vitest this repo pins.
 * Historical docs under `docs/` are intentionally not scanned: they record
 * what was true when written, not the convention.
 */

const TEXT_SUFFIX = /\.(?:md|ya?ml|json|cjs|mjs|js|jsx|ts|tsx|sh|txt)$/;

function textFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? textFilesUnder(path) : [path];
  });
}

describe("vitest reporter convention (#3370)", () => {
  it("keeps tracked convention surfaces on the bare vitest reporter form", () => {
    const surfaces = ["AGENTS.md", ...textFilesUnder(".github")].filter((path) =>
      TEXT_SUFFIX.test(path),
    );

    expect(surfaces.length).toBeGreaterThan(0);

    const offenders = surfaces.filter((path) => /--reporter=basic/.test(readFileSync(path, "utf8")));

    expect(
      offenders,
      "vitest 4 dropped the built-in basic reporter; write issue verify/termination " +
        "lines bare (`npx vitest run <path>`) — see issue #3370.",
    ).toEqual([]);
  });
});

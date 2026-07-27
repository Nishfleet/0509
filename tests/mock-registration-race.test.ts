import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guard for a suite-ordering flake class that red-lined production deploys.
 *
 * Vitest queues every `vi.doMock` call and flushes the queue before the next
 * dynamic import. `resolveMocks()` groups consecutive same-action entries and
 * resolves them with `Promise.all`, registering each one *after* its module-id
 * resolution settles. Two queued registrations for the same path therefore land
 * in settle order, not call order — so re-mocking a path that a shared setup
 * helper already queued is a race. It usually resolves in call order and passes;
 * under full-suite load the resolutions invert and the setup helper's default
 * silently wins.
 *
 * The fix is always the same: register each module path exactly once per test
 * and thread per-test behaviour through the setup helper.
 */

const TEST_DIR = "tests";

interface Clash {
  file: string;
  test: string;
  paths: string[];
}

function mockedPathsIn(source: string): string[] {
  return [...source.matchAll(/vi\.doMock\(\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]);
}

/** Top-level `function foo(...)` declarations whose body registers mocks. */
function collectMockingHelpers(lines: string[]): Map<string, Set<string>> {
  const helpers = new Map<string, Set<string>>();
  for (let index = 0; index < lines.length; index += 1) {
    const declaration = lines[index].match(/^(?:async )?function ([A-Za-z0-9_]+)/);
    if (!declaration) continue;
    let end = index + 1;
    while (end < lines.length && lines[end] !== "}") end += 1;
    const paths = mockedPathsIn(lines.slice(index, end).join("\n"));
    if (paths.length > 0) helpers.set(declaration[1], new Set(paths));
    index = end;
  }
  return helpers;
}

function findClashes(file: string, source: string): Clash[] {
  const lines = source.split("\n");
  const helpers = collectMockingHelpers(lines);
  if (helpers.size === 0) return [];

  const clashes: Clash[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opener = lines[index].match(/^(\s*)(?:it|test)(?:\.each\([^)]*\))?\(/);
    if (!opener) continue;
    let end = index + 1;
    const closer = `${opener[1]}});`;
    while (end < lines.length && !lines[end].startsWith(closer)) end += 1;
    const body = lines.slice(index, end + 1).join("\n");

    const helperMocked = new Set<string>();
    for (const [name, paths] of helpers) {
      if (new RegExp(`\\b${name}\\s*\\(`).test(body)) {
        for (const path of paths) helperMocked.add(path);
      }
    }
    const reRegistered = [...new Set(mockedPathsIn(body).filter((path) => helperMocked.has(path)))];
    if (reRegistered.length > 0) {
      clashes.push({ file, test: lines[index].trim().slice(0, 80), paths: reRegistered });
    }
    index = end;
  }
  return clashes;
}

describe("vi.doMock registration races", () => {
  it("never re-registers a module path a setup helper already mocked in the same test", () => {
    const files = readdirSync(TEST_DIR).filter((file) => /\.test\.tsx?$/.test(file));
    expect(files.length).toBeGreaterThan(0);

    const clashes = files.flatMap((file) =>
      findClashes(file, readFileSync(join(TEST_DIR, file), "utf8")),
    );

    expect(
      clashes.map(({ file, test, paths }) => `${file} — ${test} re-mocks ${paths.join(", ")}`),
    ).toEqual([]);
  });
});

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

// vi.doMock registrations are keyed by module path: the LAST registration in
// a test body silently wins. When a shared helper (e.g. mockDelivery in
// monthly-report.test.ts) already registers a module and the test body
// re-registers it to override one value, the test's meaning depends on
// registration order — which is exactly how the shard-2 monthly-report flake
// (issue 2928) filed a report for a Free workspace. One module path, one
// registration per test body; overrides go through helper parameters.
//
// Parsed with the `typescript` compiler API (a declared devDependency) rather
// than a parser pulled in transitively — the gate must typecheck under
// `tsc -b` like every other test file.
const TESTS_DIR = import.meta.dirname;

// Registered twice in one test body on main today. Each is deliberate
// layered mocking (a later registration deliberately narrows an earlier
// one), not the helper-then-override flake shape — but each is still
// order-dependent and worth converting. Observe-to-close: new files and new
// duplicates outside this list fail the gate, and an entry whose file is
// clean or gone fails too, so the list can only shrink.
const LEGACY_DUPLICATE_MOCK_FILES = new Set([
  "competitor-dossier.server.test.ts",
  "discovery-cache.test.ts",
  "plan-monitoring.test.ts",
  "search-ratelimit-ux.test.ts",
  "search.route.test.ts",
  "watchlists.route.actions.test.ts",
]);

// Call-shape suffixes that still denote one test: it.only, it.skip,
// it.each(cases)("name", fn), test.skipIf(cond), and friends. The unwrap in
// isTestCallee walks through it.each(cases) to the ("name", fn) call.
const TEST_MODIFIERS = new Set([
  "only",
  "skip",
  "each",
  "concurrent",
  "sequential",
  "todo",
  "fails",
  "skipIf",
  "runIf",
]);

function isTestCallee(expr: ts.Expression): boolean {
  // it.each(cases)("name", fn): the outer call's callee is itself a call.
  while (ts.isCallExpression(expr)) expr = expr.expression;
  if (ts.isIdentifier(expr)) return expr.text === "it" || expr.text === "test";
  if (ts.isPropertyAccessExpression(expr)) {
    // describe.it(...) / x.test(...)
    if (expr.name.text === "it" || expr.name.text === "test") return true;
    // it.only(...), it.each(...)(...), test.skipIf(...)(...) etc.
    if (TEST_MODIFIERS.has(expr.name.text)) return isTestCallee(expr.expression);
  }
  return false;
}

function duplicateDoMocks(source: string): string[] {
  const file = ts.createSourceFile(
    "under-scan.test.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const offenders: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTestCallee(node.expression)) {
      const callback = node.arguments.find(
        (a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a),
      );
      if (callback) {
        const counts = new Map<string, number>();
        const scan = (n: ts.Node): void => {
          if (
            ts.isCallExpression(n) &&
            ts.isPropertyAccessExpression(n.expression) &&
            ts.isIdentifier(n.expression.expression) &&
            n.expression.expression.text === "vi" &&
            (n.expression.name.text === "doMock" ||
              n.expression.name.text === "doUnmock")
          ) {
            const first = n.arguments[0];
            if (first && ts.isStringLiteral(first)) {
              counts.set(first.text, (counts.get(first.text) ?? 0) + 1);
            }
          }
          ts.forEachChild(n, scan);
        };
        scan(callback);
        for (const [mockPath, count] of counts) {
          if (count > 1) offenders.push(`${mockPath} registered ${count}x`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return offenders;
}

describe("mock registry hygiene: one vi.doMock per module path per test", () => {
  it("flags a test body that re-registers a mocked module", () => {
    const dup = duplicateDoMocks(`import { it, vi } from "vitest";
      it("dup", () => {
        vi.doMock("~/lib/plan.server", () => ({ a: 1 }));
        vi.doMock("~/lib/plan.server", () => ({ a: 2 }));
      });`);
    expect(dup).toEqual(["~/lib/plan.server registered 2x"]);
    // Distinct paths and re-registration across two different tests are fine.
    const clean = duplicateDoMocks(`import { it, vi } from "vitest";
      it("one", () => { vi.doMock("~/lib/a", () => ({})); });
      it("two", () => { vi.doMock("~/lib/a", () => ({})); });`);
    expect(clean).toEqual([]);
    // it.each(...)("name", fn) resolves to a test body too.
    const eachDup = duplicateDoMocks(`import { it, vi } from "vitest";
      it.each([1, 2])("case %s", () => {
        vi.doMock("~/lib/a", () => ({}));
        vi.doMock("~/lib/a", () => ({}));
      });`);
    expect(eachDup).toEqual(["~/lib/a registered 2x"]);
  });

  const testFiles = readdirSync(TESTS_DIR).filter(
    (f) =>
      f.endsWith(".test.ts") &&
      f !== "mock-registry-hygiene.test.ts" &&
      !LEGACY_DUPLICATE_MOCK_FILES.has(f),
  );

  it("scans the node suite (legacy duplicate-mock files excluded)", () => {
    expect(testFiles.length).toBeGreaterThan(50);
    for (const legacy of LEGACY_DUPLICATE_MOCK_FILES) {
      expect(
        testFiles.includes(legacy),
        `${legacy} is on the exclusion list but was filtered out by another rule`,
      ).toBe(false);
    }
  });

  for (const legacy of LEGACY_DUPLICATE_MOCK_FILES) {
    it(`exclusion ${legacy} still exists and still has a duplicate`, () => {
      let source: string;
      try {
        source = readFileSync(path.join(TESTS_DIR, legacy), "utf8");
      } catch {
        expect.unreachable(`${legacy} is gone — remove it from the exclusion list`);
        return;
      }
      const offenders = duplicateDoMocks(source);
      expect(
        offenders.length,
        `${legacy} no longer re-registers a module — remove it from the exclusion list`,
      ).toBeGreaterThan(0);
    });
  }

  for (const file of testFiles) {
    it(`${file} has no test body that re-registers a mocked module`, () => {
      const source = readFileSync(path.join(TESTS_DIR, file), "utf8");
      const offenders = duplicateDoMocks(source);
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    });
  }
});

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import { describe, expect, it } from "vitest";

// vi.doMock registrations are keyed by module path: the LAST registration in
// a test body silently wins. When a shared helper (e.g. mockDelivery in
// monthly-report.test.ts) already registers a module and the test body
// re-registers it to override one value, the test's meaning depends on
// registration order — which is exactly how the shard-2 monthly-report flake
// (issue 2928) filed a report for a Free workspace. One module path, one
// registration per test body; overrides go through helper parameters.
const TESTS_DIR = import.meta.dirname;

type Node = { type: string; name?: string; value?: unknown; [key: string]: unknown };

// Registered twice in one test body on main today. Each is deliberate
// layered mocking (a later registration deliberately narrows an earlier
// one), not the helper-then-override flake shape — but each is still
// order-dependent and worth converting. Observe-to-close: new files and new
// duplicates outside this list fail the gate.
// Follow-up tracked in Nishfleet/0509 (filed from issue 2928).
const LEGACY_DUPLICATE_MOCK_FILES = new Set([
  "competitor-dossier.server.test.ts",
  "discovery-cache.test.ts",
  "plan-monitoring.test.ts",
  "search-ratelimit-ux.test.ts",
  "search.route.test.ts",
  "watchlists.route.actions.test.ts",
]);

function duplicateDoMocks(source: string): string[] {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript"],
    allowReturnOutsideFunction: true,
  });
  const offenders: string[] = [];
  const walk = traverse as unknown as (ast: unknown, v: object) => void;
  walk(ast, {
    CallExpression: (path: {
      node: Node & { callee?: Node; arguments?: Node[] };
    }) => {
      const callee = path.node.callee;
      // it("...", fn) is a bare Identifier call; describe.it(...) a member.
      const isTestFnCall =
        (callee?.type === "Identifier" &&
          (callee.name === "it" || callee.name === "test")) ||
        (callee?.type === "MemberExpression" &&
          (callee.property as Node | undefined)?.type === "Identifier" &&
          ((callee.property as Node).name === "it" ||
            (callee.property as Node).name === "test"));
      if (!isTestFnCall) return;
      const callback = path.node.arguments?.find(
        (a) => a.type === "ArrowFunctionExpression" || a.type === "FunctionExpression",
      );
      if (!callback) return;
      const counts = new Map<string, number>();
      const visit = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          node.forEach(visit);
          return;
        }
        const n = node as Node;
        if (
          n.type === "CallExpression" &&
          n.callee &&
          (n.callee as Node).type === "MemberExpression"
        ) {
          const obj = (n.callee as Node).object as Node | undefined;
          const prop = (n.callee as Node).property as Node | undefined;
          if (
            obj?.type === "Identifier" &&
            obj.name === "vi" &&
            prop?.type === "Identifier" &&
            (prop.name === "doMock" || prop.name === "doUnmock")
          ) {
            const first = (n.arguments as Node[] | undefined)?.[0];
            if (first?.type === "StringLiteral" && typeof first.value === "string") {
              counts.set(first.value, (counts.get(first.value) ?? 0) + 1);
            }
          }
        }
        for (const key of Object.keys(n)) {
          if (key === "loc" || key === "start" || key === "end") continue;
          visit(n[key]);
        }
      };
      visit(callback);
      for (const [mockPath, count] of counts) {
        if (count > 1) offenders.push(`${mockPath} registered ${count}x`);
      }
    },
  });
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

  for (const file of testFiles) {
    it(`${file} has no test body that re-registers a mocked module`, () => {
      const source = readFileSync(path.join(TESTS_DIR, file), "utf8");
      const offenders = duplicateDoMocks(source);
      expect(offenders, `${file}: ${offenders.join("; ")}`).toEqual([]);
    });
  }
});

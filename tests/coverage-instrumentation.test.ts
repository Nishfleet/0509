import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import viteConfig from "../vite.config";

/**
 * Coverage instrumentation is measurement-only today — nothing gates on the
 * number. That is exactly why it needs a test: an unwatched, ungated config
 * block is the cheapest thing in the repo to delete, and the first symptom of
 * losing it is a diff-coverage gate that silently reports nothing months later.
 *
 * These assertions pin the contract a coverage consumer depends on: an lcov
 * report, written where it is expected, produced unconditionally by the CI
 * Test step and by `npm run test:coverage`. `npm test` itself is coverage-free
 * on purpose (fleet-ops#4891): coverage forks cost ~0.8 GB each on the 16 GB
 * fleet box and were pricing every autonomous worker at 2 GB of admission.
 */
const root = join(__dirname, "..");

async function resolveTestConfig() {
  const config = await (viteConfig as unknown as (env: {
    mode: string;
    command: "serve" | "build";
  }) => Promise<{ test: Record<string, unknown> }>)({
    mode: "test",
    command: "serve",
  });
  return config.test;
}

describe("coverage instrumentation", () => {
  it("emits an lcov report into ./coverage", async () => {
    const coverage = (await resolveTestConfig()).coverage as {
      provider: string;
      reporter: string[];
      reportsDirectory: string;
    };

    expect(coverage.provider).toBe("v8");
    // lcov is the machine-readable artifact every diff-coverage tool reads;
    // text-summary is what puts the number in the CI log.
    expect(coverage.reporter).toContain("lcov");
    expect(coverage.reporter).toContain("text-summary");
    expect(coverage.reportsDirectory).toBe("./coverage");
  });

  it("measures the product source, not the tests measuring it", async () => {
    const coverage = (await resolveTestConfig()).coverage as {
      include: string[];
      exclude: string[];
    };

    expect(coverage.include).toContain("app/**/*.{ts,tsx}");
    expect(coverage.include).toContain("workers/**/*.ts");
    expect(coverage.exclude).toContain("**/*.test.{ts,tsx}");
  });

  it("is produced unconditionally by the CI Test step and by test:coverage", () => {
    // If coverage only ran under an opt-in script nobody invokes, CI would keep
    // passing while producing no data at all — the failure mode this test
    // exists to block. `npm test` is deliberately coverage-free (fleet-ops#4891),
    // so the pin moves to where coverage actually runs: the ci.yml Test step
    // passes --coverage to the node project itself, and test:coverage keeps the
    // local lcov path alive.
    const packageJson = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string>; devDependencies: Record<string, string> };
    const ciWorkflow = readFileSync(
      join(root, ".github", "workflows", "ci.yml"),
      "utf8",
    );

    expect(packageJson.scripts["test:coverage"]).toContain("--coverage");
    expect(packageJson.scripts["test:coverage"]).toContain("--project node");
    expect(packageJson.scripts.test).not.toContain("--coverage");
    expect(ciWorkflow).toMatch(/--project node --coverage/);
    expect(packageJson.devDependencies["@vitest/coverage-v8"]).toBeTruthy();
  });

  it("still runs the workerd integration project, which cannot be instrumented", () => {
    // V8 coverage is impossible inside workerd (no node:inspector), so the two
    // projects run as two commands. Dropping the second command would delete
    // the entire real-D1 suite while leaving CI green.
    const packageJson = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.test).toContain("--project node");
    expect(packageJson.scripts.test).toContain("--project workers");
  });
});

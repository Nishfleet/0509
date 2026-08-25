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
 * report, written where it is expected, produced by the default `npm run test`.
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

  it("is produced by the default test command, not an opt-in flag", () => {
    // If coverage only ran under a separate script, CI would keep passing while
    // producing no data at all — the failure mode this test exists to block.
    const packageJson = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string>; devDependencies: Record<string, string> };

    expect(packageJson.scripts.test).toContain("--coverage");
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

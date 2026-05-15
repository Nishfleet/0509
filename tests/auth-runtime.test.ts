import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ACTIVE_RUNTIME_DIRS = ["app", "workers"];
const FORBIDDEN_ACTIVE_AUTH_REFERENCES = [
  "@supabase",
  "supabase",
  "stytch",
  "legacy/",
  "../legacy",
];

describe("auth runtime", () => {
  it("keeps active runtime on Better Auth instead of Supabase or Stytch", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    };

    expect(dependencies).toHaveProperty("better-auth");
    expect(Object.keys(dependencies).some((name) => name.includes("supabase"))).toBe(false);
    expect(Object.keys(dependencies).some((name) => name.includes("stytch"))).toBe(false);

    const activeRuntimeText = ACTIVE_RUNTIME_DIRS
      .flatMap((dir) => listSourceFiles(dir))
      .map((file) => readFileSync(file, "utf8").toLowerCase())
      .join("\n");

    for (const forbidden of FORBIDDEN_ACTIVE_AUTH_REFERENCES) {
      expect(activeRuntimeText).not.toContain(forbidden);
    }
  });
});

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      return listSourceFiles(path);
    }

    return /\.(ts|tsx|js|jsx)$/.test(path) ? [path] : [];
  });
}

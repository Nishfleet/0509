import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

describe("static home analytics", () => {
  it("stays eligible for the one edge beacon", () => {
    const html = readFileSync(join(REPO_ROOT, "public/index.html"), "utf8");
    const headers = readFileSync(join(REPO_ROOT, "public/_headers"), "utf8");
    const lines = headers.split("\n");
    const home = lines.findIndex((line) => line === "/");
    const cacheControl = lines
      .slice(home + 1)
      .map((line) => line.trim())
      .find((line) => line.startsWith("Cache-Control:"));
    const directives = (cacheControl ?? "")
      .slice("Cache-Control:".length)
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    expect(home).toBeGreaterThanOrEqual(0);
    expect(directives).toContain("public");
    expect(directives).toContain("max-age=300");
    expect(directives).not.toContain("no-transform");
    expect(html).not.toContain("cloudflareinsights.com");
    expect(lines.some((line) => line.trim().startsWith("#"))).toBe(false);
  });
});

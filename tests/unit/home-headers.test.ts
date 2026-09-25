import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

describe("static home analytics", () => {
  it("keeps / measurable and paints the headline with no document script", () => {
    const html = readFileSync(join(REPO_ROOT, "public/index.html"), "utf8");
    const headers = readFileSync(join(REPO_ROOT, "public/_headers"), "utf8");
    const lines = headers.split("\n");
    const home = lines.findIndex((line) => line === "/");
    if (home < 0) {
      throw new Error("public/_headers has no / block");
    }
    const cacheControl = lines
      .slice(home + 1)
      .map((line) => line.trim())
      .find((line) => line.startsWith("Cache-Control:"));
    if (cacheControl === undefined) {
      throw new Error("public/_headers / block has no Cache-Control");
    }
    const directives = cacheControl
      .slice("Cache-Control:".length)
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    expect(directives).not.toContain("no-transform");
    expect(html).toContain("Quietly, we");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("cloudflareinsights.com");
    expect(Buffer.byteLength(html)).toBeLessThan(8_000);
  });
});

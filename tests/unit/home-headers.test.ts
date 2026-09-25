import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function headerBlock(text: string, path: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === path);
  if (start < 0) return "";
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t") && !line.startsWith("#")) {
      break;
    }
    body.push(line);
  }
  return body.join("\n");
}

describe("static home cache header", () => {
  it("sets no-transform on / so the edge cannot inject a module beacon", () => {
    const headers = readFileSync(join(REPO_ROOT, "public/_headers"), "utf8");
    const cacheControl = headerBlock(headers, "/")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("Cache-Control:"));
    expect(cacheControl).toBe("Cache-Control: public, max-age=300, no-transform");
    expect(headerBlock(headers, "/assets/*")).not.toContain("no-transform");
    expect(headerBlock(headers, "/fonts/*")).not.toContain("no-transform");
  });
});

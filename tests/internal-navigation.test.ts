import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function appTsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) return appTsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("internal app navigation", () => {
  it("uses React Router links for same-app navigation anchors", () => {
    const rawInternalAnchors = appTsxFiles("app")
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        const matches = Array.from(source.matchAll(
          /<a\b[^>]*href=(?:"\/(?:app|auth|docs|help|search)\b[^"]*"|'\/(?:app|auth|docs|help|search)\b[^']*'|\{\s*"\/(?:app|auth|docs|help|search)\b[^"]*"\s*\}|\{\s*'\/(?:app|auth|docs|help|search)\b[^']*'\s*\}|\{\s*`\/(?:app|auth|docs|help|search)\b[^`]*`\s*\})[^>]*>/g,
        ));

        return Array.from(matches, (match) => `${path}: ${match[0]}`);
      });

    expect(rawInternalAnchors).toEqual([]);
  });
});

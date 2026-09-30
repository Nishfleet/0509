import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const APP_DIR = path.resolve(import.meta.dirname, "..", "..", "app");

function appFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return appFiles(full);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const FILES = appFiles(APP_DIR).map((file) => ({
  file: path.relative(APP_DIR, file),
  source: readFileSync(file, "utf8"),
}));

const OFF_TYPE = /text-lg font-semibold/;

describe("the row-name heading type (0509#5460)", () => {
  it("keeps the brief page's Previous briefs heading on the house row-name type", () => {
    const brief = FILES.find((entry) => entry.file === "routes/app.brief.tsx");
    if (brief === undefined) throw new Error("app/routes/app.brief.tsx is not readable");
    expect(brief.source).toContain(
      'const PREVIOUS_HEADING = "font-display text-row-name font-bold [overflow-wrap:anywhere]"',
    );
  });

  it("leaves no heading in app/ on the old text-lg font-semibold type", () => {
    const stale = FILES.filter((entry) => OFF_TYPE.test(entry.source)).map((entry) => entry.file);
    expect(stale).toEqual([]);
  });
});

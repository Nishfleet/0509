import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = new URL("../", import.meta.url).pathname;

const ALLOWED = [
  "app/lib/competitor-note.server.ts",
  "app/lib/data-export.server.ts",
  "app/lib/data/entity_note.server.ts",
  "app/routes/app.competitor.tsx",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("private competitor notes", () => {
  it("are read only by the note box, the owner's export and the competitor page", () => {
    const readers = [...sourceFiles("app"), ...sourceFiles("workers")]
      .filter((path) => /entity_note|readEntityNote/.test(readFileSync(join(ROOT, path), "utf8")))
      .sort();
    expect(readers).toEqual(ALLOWED);
  });

  it("stay out of the brief, alerts, email, API and agent code", () => {
    const leaks = ["app/lib/standing", "app/lib/agent", "app/lib/feeds", "workers"]
      .flatMap((dir) => sourceFiles(dir))
      .filter((path) => /entity_note|readEntityNote|competitor-note/.test(readFileSync(join(ROOT, path), "utf8")));
    expect(leaks).toEqual([]);
  });
});

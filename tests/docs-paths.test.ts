import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// A path named in the agent entry docs that does not exist sends the next agent
// grepping for it. Only the two files every agent reads first are checked.
const ENTRY_DOCS = ["CLAUDE.md", "README.md"] as const;
const PATH = /`((?:app|docs|workers|tests|e2e|migrations|\.agents)\/[\w./-]+[\w-])`/g;

describe("agent entry docs", () => {
  it.each(ENTRY_DOCS)("%s names only paths that exist", (doc) => {
    const text = readFileSync(new URL(`../${doc}`, import.meta.url), "utf8");
    const missing = [...text.matchAll(PATH)]
      .map((match) => match[1] ?? "")
      .filter((path) => !existsSync(new URL(`../${path}`, import.meta.url)));
    expect(missing).toEqual([]);
  });
});

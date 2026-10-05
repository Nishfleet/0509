import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// A path named in the agent entry docs that does not exist sends the next agent
// grepping for it. Only the two files every agent reads first are checked.
const ENTRY_DOCS = ["CLAUDE.md", "README.md"] as const;
const PATH = /`((?:app|docs|workers|tests|e2e|migrations|\.agents)\/[\w./-]+[\w-])`/g;

// 0509#7006: CLAUDE.md's "Rebuild rules" section claimed a hash-check mechanism
// that exists nowhere in the repo, described retired orchestration roles, sent
// lane posts to a closed issue, and gave a stale feature-map size. This is a
// wording gate, not a mechanism check: it catches the return of those exact
// claims. It fails on the old text and passes once the claims are gone. The live
// rules the section carried stay, so the deletion cannot take them with it.
const RETIRED = [
  /\bhash-checked\b/,
  /\bFable\b/,
  /\bOpus deputy\b/,
  /Two orchestrator sessions/,
  /#3842/,
  /about \d+ KB/,
] as const;

// The four live rules move from "Rebuild rules" into "Conventions", the
// gated-site rule moves to "Rules that are not about code", and the pre-wipe
// reuse rule stays as policy. None of them may leave the file with the section.
const LIVE = [
  /Stock only, at the version named in `docs\/dependencies\.md`/,
  /Jev decides every typed decision/,
  /Browser Rendering capped at 10/,
  /Guardrails/,
  /Nothing from the pre-wipe code is reused/,
  /site is gated until the audit passes/,
] as const;

describe("agent entry docs", () => {
  it.each(ENTRY_DOCS)("%s names only paths that exist", (doc) => {
    const text = readFileSync(new URL(`../${doc}`, import.meta.url), "utf8");
    const missing = [...text.matchAll(PATH)]
      .map((match) => match[1] ?? "")
      .filter((path) => !existsSync(new URL(`../${path}`, import.meta.url)));
    expect(missing).toEqual([]);
  });

  it("CLAUDE.md keeps no claim about a mechanism that does not exist", () => {
    const text = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");
    const found = RETIRED.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
    expect(found).toEqual([]);
  });

  it("CLAUDE.md keeps the live rules the retired section carried", () => {
    const text = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");
    const missing = LIVE.filter((pattern) => !pattern.test(text)).map((pattern) => pattern.source);
    expect(missing).toEqual([]);
  });
});

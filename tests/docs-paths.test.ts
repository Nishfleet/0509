import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// A path named in the agent entry docs that does not exist sends the next agent
// grepping for it. Only the two files every agent reads first are checked.
const ENTRY_DOCS = ["CLAUDE.md", "README.md"] as const;
const PATH = /`((?:app|docs|workers|tests|e2e|migrations|\.agents)\/[\w./-]+[\w-])`/g;

// 0509#7006: CLAUDE.md's "Rebuild rules" claimed a hash-check mechanism that
// exists nowhere in the repo, described retired orchestration roles, sent lane
// posts to a closed issue, and gave a stale feature-map size. Copy that a doc
// asserts about itself cannot be checked by a doc test (docs/REBUILD-DONE.md D),
// but a claim about a mechanism is different: the mechanism either exists in the
// repo or it does not. This gate fails on the old wording and passes once the
// claim, the retired roles and the stale figure are gone. The live rules the
// section carried stay, so the deletion cannot take them with it.
const RETIRED = [
  /\bhash-checked\b/,
  /\b668d2452c\b/,
  /\bfa9d48aa4\b/,
  /\bpre-wipe\b/,
  /\bFable\b/,
  /\bOpus deputy\b/,
  /Two orchestrator sessions/,
  /#3842/,
  /about \d+ KB/,
  /Rebuild rules/,
] as const;

// The four live rules move from "Rebuild rules" into "Conventions", and the
// gated-site rule moves to "Rules that are not about code". None of them may
// leave the file with the section.
const LIVE = [
  /Stock only, at the version named in `docs\/REBUILD-STACK\.md`/,
  /Jev decides every typed decision/,
  /Browser Rendering capped at 10/,
  /Guardrails/,
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

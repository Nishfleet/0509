import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// 0509#7005: Pi loads the first of AGENTS.override.md, AGENTS.md, AGENTS.MD,
// CLAUDE.md, CLAUDE.MD that exists and never falls through, so the one-line
// AGENTS.md shadowed the 185-line house rules from every Pi, Codex and Devin
// worker in this repo. AGENTS.md is the one canonical doc; CLAUDE.md is only
// Claude Code's stock `@AGENTS.md` import of it. The heading check fails if
// AGENTS.md loses its body, and the pointer check fails if CLAUDE.md grows a
// second body: either way the shadowing is back and this test is red.
describe("agent docs", () => {
  it("AGENTS.md is the canonical doc and carries the merge-gate rules", () => {
    const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
    expect(agents).toContain("## What gates a merge");
  });

  it("CLAUDE.md is only the @AGENTS.md import, never a second body", () => {
    const claude = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8").trim();
    expect(claude).toBe("@AGENTS.md");
  });
});

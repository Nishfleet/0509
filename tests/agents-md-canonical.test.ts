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

  // 0509#7085 (item 5): `verify:start` shipped an undeclared
  // `require('playwright-core').chromium.executablePath()` from `78e85158d` on
  // 2026-09-23 — playwright-core is only a transitive package, so the require is
  // true until a lockfile trim and then hangs. The fix changed the require to the
  // one declared package, `@playwright/test`, and the verify skill then taught the
  // old command — the same drift in the other direction. A skill's documented
  // command is only true while it equals the script it documents, so this gate
  // pins them.
  it("the verify skill documents the verify:start script verbatim", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const script = pkg.scripts?.["verify:start"] ?? "";
    expect(script, "package.json has no verify:start script").not.toBe("");
    // The skill quotes the command in prose, so compare on the executablePath
    // expression the two must agree on: `require('<pkg>').chromium.executablePath()`.
    const required = (text: string): string | undefined =>
      /require\('([^']+)'\)\.chromium\.executablePath\(\)/.exec(text)?.[1];
    const skill = readFileSync(new URL("../.agents/skills/verify/SKILL.md", import.meta.url), "utf8");
    expect(required(skill), "the verify skill quotes no playwright executablePath").toBeDefined();
    expect(required(skill), "the verify skill's executablePath must require the declared package").toBe(
      required(script),
    );
  });
});

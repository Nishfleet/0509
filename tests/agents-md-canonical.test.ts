import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("agent docs", () => {
  it("AGENTS.md is the canonical doc and carries the merge-gate rules", () => {
    const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
    expect(agents).toContain("## What gates a merge");
  });

  it("CLAUDE.md is only the @AGENTS.md import, never a second body", () => {
    const claude = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8").trim();
    expect(claude).toBe("@AGENTS.md");
  });

  it("the verify skill documents the verify:start script verbatim", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const script = pkg.scripts?.["verify:start"] ?? "";
    expect(script, "package.json has no verify:start script").not.toBe("");

    const required = (text: string): string | undefined =>
      /require\('([^']+)'\)\.chromium\.executablePath\(\)/.exec(text)?.[1];
    const skill = readFileSync(new URL("../.agents/skills/verify/SKILL.md", import.meta.url), "utf8");
    expect(required(skill), "the verify skill quotes no playwright executablePath").toBeDefined();
    expect(required(skill), "the verify skill's executablePath must require the declared package").toBe(
      required(script),
    );
  });
});

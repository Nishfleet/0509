import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

// A component's className utilities must resolve against app/app.css's @theme.
// `bg-accent` and `text-on-accent` are not in that @theme — the pre-#3984 accent
// names — so Tailwind emits no rule for them and the step-bar marker renders
// transparent while a test grepping for the literal `bg-accent` stays green.
// This is the detector that makes that class of defect fail in a gate: every
// colour/type utility the onboarding screen writes is compiled against the real
// stylesheet and must produce a rule.
//
// tests/unit/ is one level below tests/*.test.ts, so the repo root is two up.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const ONBOARDING_FILES = [
  "app/components/one-input.tsx",
  "app/components/onboarding/step-bar.tsx",
  "app/routes/onboarding._index.tsx",
  "app/routes/onboarding.identity.tsx",
];

// The two shared controls are the carriers of the painted utilities; the route
// modules are layout only and may legitimately name none.
const PAINTED_FILES = ["app/components/one-input.tsx", "app/components/onboarding/step-bar.tsx"];

// Only the colour/type namespaces, and only bare literary classes: a dynamic
// class built at runtime cannot be checked statically, and `size-[2.5]` is an
// arbitrary value Tailwind always accepts.
const UTILITY_SHAPE = /^(?:[a-z-]+:)*(?:bg|text|border|from|to|via|ring|fill|stroke|outline|decoration|caret)-[a-z][a-z0-9-]*$/;

function utilitiesIn(relativePath: string): string[] {
  const source = readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
  const found = new Set<string>();
  for (const match of source.matchAll(/className\s*=\s*"([^"]*)"|className\s*=\s*\{`([^`]*)`\}/g)) {
    const value = match[1] ?? match[2] ?? "";
    for (const token of value.split(/\s+/)) {
      if (UTILITY_SHAPE.test(token)) found.add(token);
    }
  }
  return [...found];
}

// `placeholder:text-ink-faint` resolves only if the base `text-ink-faint`
// token exists, and Tailwind's escaped variant selector (`.placeholder\:...`)
// is not a stable string to match, so the check compiles the base name.
function baseUtility(utility: string): string {
  return utility.replace(/^(?:[a-z-]+:)+/, "");
}

// Tailwind compiles the real app/app.css the way the build does, so a utility
// that resolves here resolves in the bundle and one that does not is the defect
// this test exists to catch.
async function compiledUtilities(utilities: readonly string[]): Promise<string> {
  const css = readFileSync(path.join(REPO_ROOT, "app/app.css"), "utf8");
  const { build } = await compile(css, {
    base: REPO_ROOT,
    loadStylesheet: async () => {
      const resolved = path.join(REPO_ROOT, "node_modules", "tailwindcss", "index.css");
      return { path: resolved, base: path.dirname(resolved), content: readFileSync(resolved, "utf8") };
    },
  });
  return build(utilities);
}

describe("the onboarding screen's classes resolve against the one stylesheet (#3996)", () => {
  it.each(ONBOARDING_FILES)("%s names no utility the theme leaves unresolved", async (file) => {
    const utilities = utilitiesIn(file);
    const compiled = await compiledUtilities(utilities.map(baseUtility));
    const unresolved = utilities.filter((utility) => {
      const selector = baseUtility(utility).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
      return !new RegExp(`\\.${selector}[ :{,]`).test(compiled);
    });
    expect(unresolved, `${unresolved.join(", ")} resolves to no CSS rule in app/app.css`).toEqual([]);
  });

  it.each(PAINTED_FILES)("%s does name at least one utility to check", (file) => {
    expect(utilitiesIn(file).length).toBeGreaterThan(0);
  });

  it("paints the step-bar marker with the registered green tokens", () => {
    const source = readFileSync(path.join(REPO_ROOT, "app/components/onboarding/step-bar.tsx"), "utf8");
    expect(source).toContain("bg-green");
    expect(source).toContain("text-on-green");
    // The retired accent names emit no rule; naming them is the defect.
    for (const retired of ["bg-accent", "text-on-accent", "border-accent"]) {
      expect(source, `${retired} is not a token in app/app.css`).not.toContain(retired);
    }
  });

  it("paints the one-input submit with the registered green fill", () => {
    const source = readFileSync(path.join(REPO_ROOT, "app/components/one-input.tsx"), "utf8");
    expect(source).toContain("bg-green");
    expect(source).toContain("text-on-green");
    for (const retired of ["bg-accent", "text-on-accent", "border-accent"]) {
      expect(source, `${retired} is not a token in app/app.css`).not.toContain(retired);
    }
  });

  it("uses the type scale's tokens rather than a hand-written size", () => {
    const stepBar = readFileSync(path.join(REPO_ROOT, "app/components/onboarding/step-bar.tsx"), "utf8");
    expect(stepBar).toContain("text-pill");
    expect(stepBar).not.toContain("text-[0.66rem]");

    const oneInput = readFileSync(path.join(REPO_ROOT, "app/components/one-input.tsx"), "utf8");
    expect(oneInput).toContain("text-meta");
    expect(oneInput).not.toContain("text-[0.72rem]");
  });
});

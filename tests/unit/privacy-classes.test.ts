import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRIVACY = path.join(REPO_ROOT, "app/components/legal-page.tsx");
const WORDMARK = 'className="bg-green px-[5px] text-on-green"';
const RETIRED_WORDMARK = 'className="bg-accent px-[5px] text-on-accent"';

const COLOUR_OR_TYPE = /^(?:bg|text|font|leading|tracking)-/;

function colourAndTypeClasses(source: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const match of source.matchAll(/className="([^"]*)"/g)) {
    for (const token of match[1].split(/\s+/)) {
      if (!COLOUR_OR_TYPE.test(token) || seen.has(token)) continue;
      seen.add(token);
      names.push(token);
    }
  }
  return names;
}

function hasRule(css: string, className: string): boolean {
  let escaped = "";
  for (const char of className) {
    escaped += /[A-Za-z0-9_-]/.test(char) ? char : `\\${char}`;
  }
  return css.includes(`.${escaped} {`);
}

async function classesWithNoRule(names: string[]): Promise<string[]> {
  const css = await readFile(path.join(REPO_ROOT, "app/app.css"), "utf8");
  const compiledCss = await compile(css, {
    base: REPO_ROOT,
    loadStylesheet: async (id) => {
      if (id !== "tailwindcss") {
        throw new Error(`app/app.css imported ${id}; this detector only resolves tailwindcss`);
      }
      const resolved = path.join(REPO_ROOT, "node_modules", "tailwindcss", "index.css");
      return {
        path: resolved,
        base: path.dirname(resolved),
        content: await readFile(resolved, "utf8"),
      };
    },
  });
  const compiled = compiledCss.build(names);
  return names.filter((name) => !hasRule(compiled, name));
}

describe("privacy colour and type utilities (#4309)", () => {
  it("emits a rule for every colour and type utility on the page", async () => {
    const source = await readFile(PRIVACY, "utf8");
    const names = colourAndTypeClasses(source);
    expect(source).toContain(WORDMARK);
    expect(names).toEqual(expect.arrayContaining(["bg-green", "text-on-green"]));
    expect(await classesWithNoRule(names)).toEqual([]);
  });

  it("fails when the wordmark is swapped back to the retired accent tokens", async () => {
    const source = await readFile(PRIVACY, "utf8");
    const retired = source.replace(WORDMARK, RETIRED_WORDMARK);
    expect(retired).not.toBe(source);
    expect(await classesWithNoRule(colourAndTypeClasses(retired))).toEqual(["bg-accent", "text-on-accent"]);
  });
});

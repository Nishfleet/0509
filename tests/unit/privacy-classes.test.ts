import { readFile } from "node:fs/promises";
import path from "node:path";

import { compileAppCss, REPO_ROOT } from "./compile-app-css";
import { describe, expect, it } from "vitest";

// #4309: the privacy wordmark used `bg-accent` / `text-on-accent` after #3984
// retired those tokens. Tailwind emits no rule for an unregistered colour, so
// the `09` span painted as a transparent box while a string assertion stayed
// green. This compiles the page's colour and type utilities against the real
// `app/app.css` and fails when one of them emits nothing.
//
// The scan reads static className="..." strings only. A className={...}
// expression, a template, or a class on an imported component is not seen.

const PRIVACY = path.join(REPO_ROOT, "app/routes/privacy.tsx");
const WORDMARK = 'className="bg-green text-on-green px-[5px]"';
const RETIRED_WORDMARK = 'className="bg-accent text-on-accent px-[5px]"';

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

// Tailwind's selector escapes every character outside [A-Za-z0-9_-]. The
// space before `{` is how `build()` prints a rule, and it keeps `text-ink`
// from matching `text-ink-soft`.
function hasRule(css: string, className: string): boolean {
  let escaped = "";
  for (const char of className) {
    escaped += /[A-Za-z0-9_-]/.test(char) ? char : `\\${char}`;
  }
  return css.includes(`.${escaped} {`);
}

async function classesWithNoRule(names: string[]): Promise<string[]> {
  const compiled = await compileAppCss(names);
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
    expect(await classesWithNoRule(colourAndTypeClasses(retired))).toEqual([
      "bg-accent",
      "text-on-accent",
    ]);
  });
});

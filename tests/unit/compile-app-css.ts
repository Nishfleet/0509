import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "tailwindcss";

// #4309: one Tailwind compile harness for tests/unit. privacy-classes.test.ts
// started as a second copy of theme.test.ts's compile pipeline, and two copies
// drift: a resolver change on one side leaves the suites compiling different
// CSS. theme.test.ts and privacy-classes.test.ts both call this.
//
// `tests/unit/` sits two directories below the repo root.

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Tailwind compiles app/app.css the way the build does, so the assertions are
// about the stylesheet as Tailwind emits it rather than about the source text.
export async function compileAppCss(utilities: string[]): Promise<string> {
  const css = await readFile(path.join(REPO_ROOT, "app/app.css"), "utf8");
  const { build } = await compile(css, {
    base: REPO_ROOT,
    // `@import "tailwindcss"` resolves through node_modules exactly as the Vite
    // plugin resolves it; no copy of the package is checked in. Any other
    // import is a harness bug, not a stylesheet to guess at, so it throws.
    loadStylesheet: async (id) => {
      if (id !== "tailwindcss") {
        throw new Error(`app/app.css imported ${id}; the compile harness resolves tailwindcss only`);
      }
      const resolved = path.join(REPO_ROOT, "node_modules", "tailwindcss", "index.css");
      return { path: resolved, base: path.dirname(resolved), content: await readFile(resolved, "utf8") };
    },
  });
  return build(utilities);
}

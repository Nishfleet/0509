import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// DESIGN.md §9 promises a 320ms push when you navigate into a brand, and no
// stylesheet drew one. The push is the browser's view transition, switched on
// by `viewTransition` on the links into a brand; this pins that the two
// pseudo-element rules read the §9 tokens and exist only for visitors who have
// not asked for reduced motion.

const CSS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "app", "app.css");

function block(css: string, opener: string): string {
  const start = css.indexOf(opener);
  if (start === -1) throw new Error(`app.css has no ${opener}`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    if (depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`app.css ${opener} never closes`);
}

describe("the push when navigating into a brand", () => {
  it("slides the new page in over the push token and fades the old one over the fade token", async () => {
    const css = await readFile(CSS_PATH, "utf8");
    const guarded = block(css, "@media (prefers-reduced-motion: no-preference)");

    expect(guarded).toContain("::view-transition-new(root)");
    expect(guarded).toMatch(/push-in var\(--duration-push\) var\(--ease-push\)/);
    expect(guarded).toMatch(/push-out var\(--duration-fade\) linear/);
  });

  it("keeps every view-transition rule inside the no-preference block", async () => {
    const css = await readFile(CSS_PATH, "utf8");
    const outside = css
      .replace(block(css, "@media (prefers-reduced-motion: no-preference)"), "")
      .replace(block(css, "@media (prefers-reduced-motion: reduce)"), "");

    expect(outside).not.toContain("::view-transition");
  });

  it("switches the browser's default cross-fade off for visitors who asked for reduced motion", async () => {
    const css = await readFile(CSS_PATH, "utf8");
    const reduced = block(css, "@media (prefers-reduced-motion: reduce)");

    expect(reduced).toMatch(/::view-transition-old\(\*\)/);
    expect(reduced).toMatch(/::view-transition-new\(\*\)/);
    expect(reduced).toMatch(/::view-transition-group\(\*\)/);
    expect(reduced).toMatch(/animation: none !important/);
  });
});

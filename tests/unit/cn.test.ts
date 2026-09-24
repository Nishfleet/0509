import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { cn, TYPE_SCALE } from "../../app/lib/utils";

// tailwind-merge only knows Tailwind's stock font sizes, so it read
// `text-pill` as a colour and dropped it beside `text-ink`: the landing's
// source pills rendered at body size (0509 landing PR, 2026-09-24). cn()
// extends the merger with the @theme type scale, and this keeps the two lists
// in step.

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const css = readFileSync(join(REPO_ROOT, "app/app.css"), "utf8");
const themeSizes = [...css.matchAll(/^\s*--text-([a-z0-9-]+):/gm)]
  .map((match) => match[1] ?? "")
  .filter((name) => !name.includes("--"));

describe("cn", () => {
  it("knows every font size the @theme block declares", () => {
    expect([...TYPE_SCALE].sort()).toEqual([...new Set(themeSizes)].sort());
  });

  it("keeps a type-scale size beside a text colour", () => {
    for (const size of TYPE_SCALE) {
      expect(cn(`text-${size}`, "text-ink")).toBe(`text-${size} text-ink`);
    }
  });

  it("lets a later type-scale size win over an earlier one", () => {
    expect(cn("text-pill text-ink", "text-meta")).toBe("text-ink text-meta");
  });
});

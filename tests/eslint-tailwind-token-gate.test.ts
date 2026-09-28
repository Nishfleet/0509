import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// DESIGN.md rule 8: the accent is one colour, and nothing else is coloured.
// A colour class that is not a `@theme` token in app/app.css used to be a
// review comment; the eslint-plugin-better-tailwindcss block on `app/**` in
// eslint.config.js makes it a lint failure (0509#5871). These probes boot the
// real config (same rig as eslint-catch-null-rule.test.ts): each one writes a
// component under app/, lints it with the project's own ESLint, and removes it.
// The negative cases are load-bearing — a gate that fires on every class list
// is a gate someone turns off.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PROBE = "app/components/probe-tw-tmp.tsx";
const UI_PROBE = "app/components/ui/probe-tw-tmp.tsx";

const ARBITRARY = "Arbitrary colour values are banned";
const PALETTE = "The Tailwind default palette is banned";
const UNKNOWN = "Unknown class detected";
const ORDER = "Incorrect class order";

function component(className: string): string {
  return `export function ProbeTwTmp() {
  return <div className="${className}" />;
}
`;
}

async function lintProbe(
  rel: string,
  code: string,
): Promise<{ ignored: boolean; messages: string[] }> {
  const file = path.join(REPO_ROOT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, code);
  try {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    if (await eslint.isPathIgnored(file)) {
      return { ignored: true, messages: [] };
    }
    const results = await eslint.lintFiles([file]);
    return {
      ignored: false,
      messages: results.flatMap((result) => result.messages.map((m) => m.message)),
    };
  } finally {
    await rm(file, { force: true });
  }
}

async function lintExisting(rel: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const results = await eslint.lintFiles([path.join(REPO_ROOT, rel)]);
  return results.flatMap((result) => result.messages.map((m) => m.message));
}

describe("eslint DESIGN.md colour gate (#5871)", () => {
  it("rejects a hex arbitrary colour value", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, component("bg-[#ff0000]"));
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(ARBITRARY))).toBe(true);
  });

  it("rejects rgb() and oklch() arbitrary colour values", { timeout: 60_000 }, async () => {
    const rgb = await lintProbe(PROBE, component("text-[rgb(1,2,3)]"));
    expect(rgb.messages.some((m) => m.includes(ARBITRARY))).toBe(true);
    const oklch = await lintProbe(PROBE, component("text-[oklch(0.5_0.2_30)]"));
    expect(oklch.messages.some((m) => m.includes(ARBITRARY))).toBe(true);
  });

  it("rejects an arbitrary value that smuggles a CSS variable", { timeout: 60_000 }, async () => {
    const bracket = await lintProbe(PROBE, component("bg-[var(--x)]"));
    expect(bracket.messages.some((m) => m.includes(ARBITRARY))).toBe(true);
    const paren = await lintProbe(PROBE, component("text-(--y)"));
    expect(paren.messages.some((m) => m.includes(ARBITRARY))).toBe(true);
  });

  it("rejects the Tailwind default palette, including under a variant", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, component("bg-red-500 dark:text-blue-600"));
    expect(result.messages.some((m) => m.includes(PALETTE))).toBe(true);
  });

  it("leaves a canonical class list of @theme tokens alone", { timeout: 60_000 }, async () => {
    const result = await lintProbe(
      PROBE,
      component("border-line bg-green text-[48px] tracking-[-0.02em] text-on-green"),
    );
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes("banned"))).toBe(false);
    expect(result.messages.some((m) => m.includes(UNKNOWN))).toBe(false);
    expect(result.messages.some((m) => m.includes(ORDER))).toBe(false);
  });

  it("rejects a misspelled @theme token outside the shadcn kit", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, component("text-ink-softt"));
    expect(result.messages.some((m) => m.includes(UNKNOWN))).toBe(true);
  });

  it("rejects a shadcn semantic token outside app/components/ui", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, component("bg-muted"));
    expect(result.messages.some((m) => m.includes(UNKNOWN))).toBe(true);
  });

  it("allows the stock shadcn and tw-animate tokens inside app/components/ui", { timeout: 60_000 }, async () => {
    const result = await lintProbe(UI_PROBE, component("bg-muted data-open:animate-in"));
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(UNKNOWN))).toBe(false);
  });

  it("rejects an out-of-order class list", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, component("text-ink-soft mt-2"));
    expect(result.messages.some((m) => m.includes(ORDER))).toBe(true);
  });

  it("allows Cloudflare's cf-turnstile widget class", { timeout: 60_000 }, async () => {
    const messages = await lintExisting("app/components/turnstile-widget.tsx");
    expect(messages.some((m) => m.includes(UNKNOWN))).toBe(false);
  });
});

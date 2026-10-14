import { describe, expect, it } from "vitest";

import { lintExisting, lintTextAt } from "./eslint-lint-text";

const PROBE = "app/components/share-button.tsx";
const UI_PROBE = "app/components/ui/button.tsx";

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

function constant(name: string, classes: string): string {
  return `const ${name} = "${classes}";

export function ProbeTwTmp() {
  return <div className={${name}} />;
}
`;
}

function lintProbe(rel: string, code: string) {
  return lintTextAt(rel, code);
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

  it(
    "rejects a shadcn token that has no @theme mapping, in and outside app/components/ui",
    { timeout: 60_000 },
    async () => {
      const outside = await lintProbe(PROBE, component("bg-sidebar-accent"));
      expect(outside.messages.some((m) => m.includes(UNKNOWN))).toBe(true);
      const inside = await lintProbe(UI_PROBE, component("bg-sidebar-accent"));
      expect(inside.messages.some((m) => m.includes(UNKNOWN))).toBe(true);
    },
  );

  it("accepts a shadcn name that @theme maps to a house token (0509#7071)", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, component("bg-muted"));
    expect(result.messages.some((m) => m.includes(UNKNOWN))).toBe(false);
  });

  it("allows the stock shadcn tokens inside app/components/ui", { timeout: 60_000 }, async () => {
    const result = await lintProbe(UI_PROBE, component("bg-muted data-starting-style:opacity-0"));
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(UNKNOWN))).toBe(false);
  });

  it(
    "rejects a tw-animate class inside app/components/ui, because the app never imports that package",
    { timeout: 60_000 },
    async () => {
      const result = await lintProbe(UI_PROBE, component("bg-muted data-open:animate-in"));
      expect(result.messages.some((m) => m.includes(UNKNOWN))).toBe(true);
    },
  );

  it("rejects an out-of-order class list", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, component("text-ink-soft mt-2"));
    expect(result.messages.some((m) => m.includes(ORDER))).toBe(true);
  });

  it("allows Cloudflare's cf-turnstile widget class", { timeout: 60_000 }, async () => {
    const messages = await lintExisting("app/components/turnstile-widget.tsx");
    expect(messages.some((m) => m.includes(UNKNOWN))).toBe(false);
  });

  it("rejects a banned colour inside a registered class-list constant", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, constant("ROW", "bg-[#ff0000] border-line"));
    expect(result.messages.some((m) => m.includes(ARBITRARY))).toBe(true);
  });

  it("rejects a banned colour behind a bracket variant", { timeout: 60_000 }, async () => {
    const arbitrary = await lintProbe(PROBE, component("max-[859px]:bg-[#ff0000]"));
    expect(arbitrary.messages.some((m) => m.includes(ARBITRARY))).toBe(true);
    const palette = await lintProbe(PROBE, component("[&:hover]:bg-red-500"));
    expect(palette.messages.some((m) => m.includes(PALETTE))).toBe(true);
  });
});

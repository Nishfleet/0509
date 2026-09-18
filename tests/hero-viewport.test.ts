import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Hero first-viewport contract (issue #3603).
 *
 * The issue's termination line is `npx vitest run tests/hero-viewport.test.ts`
 * exiting 0 when the desktop (1440×900) and mobile (390×844) first viewports
 * show the headline, value proposition, and a clickable CTA above the fold,
 * with zero console errors and no horizontal scroll.
 *
 * This repository's node vitest suite has no jsdom/layout engine, so a
 * rendered `scrollWidth === clientWidth` assertion here would be trivially
 * true and prove nothing — the same reason `tests/design-system/hero-viewport
 * .test.tsx` documents. The rendered first-viewport contract (real bounding
 * boxes above the fold, zero console errors, no horizontal overflow) is
 * enforced against a real browser by `tests/hero-fold.spec.ts` (playwright,
 * chromium + mobile-chromium projects) and `e2e/home-hero-viewport.spec.ts`.
 *
 * What this file locks instead:
 *  1. the rendered markup composition — a single buyer+job H1, the live-proof
 *     mechanic demoted to a strip beneath it, and the search input + CTA
 *     inside the first-viewport command form (in the #2321 order: wall →
 *     command → strip, so the strip can never push the CTA below the fold);
 *  2. the CSS mechanism that makes `scrollWidth === clientWidth` hold — the
 *     ticker's overflow clip + inline-size containment, the command's mobile
 *     column stack, and the wall's compressed mobile budget;
 *  3. the committed hero-viewport screenshots under public/hero-viewports/,
 *     PNG-IHDR-verified to the two acceptance viewports so a wrong-size or
 *     blank artefact cannot satisfy accept #4.
 */

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

function mockReactRouter() {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useRouteLoaderData: vi.fn().mockReturnValue({
        pricingPlans: [],
        usageBundles: [],
        session: null,
      }),
      useLoaderData: vi.fn().mockReturnValue({
        pricingPreview: { available: false },
        commercialLaunch: {
          scoutSaleOpen: true,
          starterSaleOpen: true,
          agencySaleOpen: false,
        },
        proofBrief: null,
      }),
    };
  });
}

async function renderMarketing(): Promise<string> {
  const { default: MarketingRoute } = await import("~/routes/marketing");
  return renderToStaticMarkup(createElement(MarketingRoute));
}

function heroH1(markup: string): string {
  return markup.match(/<h1[^>]*ld-wall[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? "";
}

function heroWallRows(h1: string): string[] {
  return Array.from(h1.matchAll(/<span class="ld-row[^"]*">/g)).map((match) => match[0]);
}

const css = readFileSync("app/app.css", "utf8");

/** Extract the body of one `@media (max-width: Npx)` block, balancing braces
 *  so nested rules are included and the block ends at its own closing brace.
 *  app.css carries several 600px blocks — `from` picks which occurrence:
 *  `"first"` or `"last"` (the first-viewport budget lives in the last one,
 *  the same convention tests/homepage-mobile-fold.test.ts uses via
 *  `lastMedia`; the `.ld-flag` pull-in lives in the first). */
function mediaBlock(width: 860 | 600, from: "first" | "last" = "last"): string {
  const needle = `@media (max-width: ${width}px) {`;
  const start = from === "last" ? css.lastIndexOf(needle) : css.indexOf(needle);
  expect(start, `expected an @media (max-width: ${width}px) block`).toBeGreaterThan(-1);
  let depth = 0;
  let i = start;
  for (; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return css.slice(start, i + 1);
}

/** The first top-level rule block for `selector` in app.css. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped} \\{[\\s\\S]*?\\n\\}`, "m").exec(css);
  expect(match, `expected a top-level CSS rule for \`${selector}\` in app/app.css`).not.toBeNull();
  return match![0];
}

const VIEWPORT_SHOTS = [
  { file: "public/hero-viewports/desktop-1440.png", width: 1440, height: 900 },
  { file: "public/hero-viewports/mobile-390.png", width: 390, height: 844 },
] as const;

/** PNG signature + IHDR dimensions. A committed screenshot proves the
 *  acceptance viewport only if the PNG's own header says it was captured at
 *  that size. */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(buf.subarray(0, 8).equals(pngSignature), `${path} is not a PNG`).toBe(true);
  expect(buf.toString("ascii", 12, 16), `${path} has no IHDR chunk`).toBe("IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
});

describe("hero first viewport — buyer+job headline (issue #3603 accept #3)", () => {
  it("renders a single ld-wall H1 that names the buyer and the job", async () => {
    mockReactRouter();
    const markup = await renderMarketing();

    expect(markup.match(/<h1[\s>]/g)?.length ?? 0).toBe(1);
    const h1 = heroH1(markup);
    expect(h1.length, "the hero wall h1.ld-wall is rendered").toBeGreaterThan(0);

    // Buyer: the product's named audience, not a proof hook.
    expect(h1, "H1 names the buyer").toMatch(/growth teams/i);
    // Job: the free live-search promise — the same phrases Gate-B journey
    // e2e pins (journey-1 / journey-6 /search-promise contract).
    expect(h1).toContain("See the Meta ads");
    expect(h1).toContain("any competitor is");
    expect(h1).toMatch(/running[\s\S]*right now/i);
    expect(h1).toContain("Free, no account.");

    // The wall keeps the #2170 structure: four rows, the indented callout
    // carrying the <ins> proof highlight.
    expect(heroWallRows(h1)).toHaveLength(4);
    expect(h1).toContain('<span class="ld-row ld-row-indent">');
    expect(h1).toContain('<ins class="ld-ins">');

    // The H1 never carries the proof mechanic itself — no hook, quote,
    // competitor address, or capture date.
    expect(h1).not.toContain("ld-proof-quote");
    expect(h1).not.toContain("nykaa.com");
    expect(h1).not.toMatch(/\b(Captured|checked)\b/);
  });

  it("demotes the live-proof mechanic to a strip beneath the H1", async () => {
    mockReactRouter();
    const markup = await renderMarketing();

    const wallIndex = markup.indexOf('class="ld-wall"');
    const stripIndex = markup.indexOf('class="ld-proof-strip"');
    expect(wallIndex, "the hero wall is rendered").toBeGreaterThan(-1);
    expect(stripIndex, "the demoted proof strip is rendered").toBeGreaterThan(-1);
    expect(stripIndex, "proof strip sits beneath the H1, not inside it").toBeGreaterThan(
      wallIndex,
    );
    // The strip is a labelled aside (live or cached proof brief), not part of
    // the headline.
    expect(markup).toMatch(/class="ld-proof-strip"[^>]*aria-label="[^"]*proof brief"/i);
  });
});

describe("hero first viewport — input + CTA above the fold (issue #3603 accept #1)", () => {
  it("keeps the #2321 order — wall, then command, then proof strip", async () => {
    mockReactRouter();
    const markup = await renderMarketing();

    const wallIndex = markup.indexOf('class="ld-wall"');
    const formIndex = markup.indexOf('class="ld-command"');
    const stripIndex = markup.indexOf('class="ld-proof-strip"');

    expect(formIndex, "the search command form is rendered").toBeGreaterThan(wallIndex);
    // The command leads the first viewport: nothing but the wall sits
    // between them, so a long proof strip can never push the CTA below the
    // fold (issue #2321).
    const betweenWallAndForm = markup.slice(wallIndex, formIndex);
    expect(betweenWallAndForm).not.toContain("ld-proof-strip");
    expect(betweenWallAndForm).not.toContain("ld-deck-copy");
    // The demoted strip follows the command — beneath the H1 but never
    // between the headline and the primary action.
    expect(stripIndex).toBeGreaterThan(formIndex);
  });

  it("renders the competitor-website input and its submit CTA inside the command", async () => {
    mockReactRouter();
    const markup = await renderMarketing();

    const formStart = markup.indexOf('class="ld-command"');
    const formEnd = markup.indexOf("</form>", formStart);
    expect(formEnd).toBeGreaterThan(formStart);
    const form = markup.slice(formStart, formEnd);

    expect(form).toContain('aria-label="Competitor website"');
    expect(form).toContain('name="website"');
    expect(form).toMatch(/<button[^>]*type="submit"/);
    expect(form).toContain("Preview available ads");
  });

  it("carries the value proposition in the deck copy beneath the command", async () => {
    mockReactRouter();
    const markup = await renderMarketing();

    const deck = markup.match(/<p class="ld-deck-copy">([\s\S]*?)<\/p>/)?.[1] ?? "";
    expect(deck.length, "the value-proposition deck copy is rendered").toBeGreaterThan(0);
    expect(deck, "the deck names what the product watches").toMatch(/watches competitors/i);
    expect(deck).toMatch(/page text[\s\S]*source link/);
    expect(deck).toContain("plus a screenshot when the capture includes one");
  });
});

describe("hero first viewport — CSS fold + overflow mechanism (issue #3603 accept #1, #2)", () => {
  it("contains the ticker belt so it cannot inflate the document scrollWidth", () => {
    // `scrollWidth === clientWidth` at 390px holds because `.ld-ticker`
    // clips the `width: max-content` belt and carries inline-size
    // containment — the mechanism the #971/#1262 fixes landed.
    const ticker = ruleBody(".ld-ticker");
    expect(ticker).toMatch(/overflow:\s*hidden/);
    expect(ticker).toMatch(/contain:\s*inline-size/);
    expect(ruleBody(".ld-ticker-belt")).toMatch(/width:\s*max-content/);
  });

  it("keeps the hero flag clipped inside its row on narrow viewports", () => {
    // The absolutely-positioned `.ld-flag` pill is clipped by the row's
    // `overflow-x: clip`, so it cannot punch 2–3px past the viewport edge.
    expect(ruleBody(".ld-wall .ld-row")).toMatch(/overflow-x:\s*clip/);
    expect(mediaBlock(600, "first")).toMatch(/\.ld-wall\s*\.ld-flag\s*\{[\s\S]*?right:\s*-0\.04em/);
  });

  it("compresses the mobile hero stack so the command clears the fold", () => {
    const m600 = mediaBlock(600);
    // The wall's mobile budget keeps the headline inside the first viewport.
    expect(m600).toMatch(/\.ld-hero-grid\s*\.ld-wall\s*\{[\s\S]*?font-size:\s*1\.75rem/);
    // The demoted strip compacts (head + hook only) so it stays a strip.
    expect(m600).toMatch(/\.ld-proof-trail,[\s\S]*?\.ld-proof-strip-foot\s*\{[\s\S]*?display:\s*none/);
    // The command input/button keep their compact mobile budget.
    expect(m600).toMatch(/\.ld-command\s+input\s*\{[\s\S]*?min-height:\s*44px/);
  });

  it("stacks the command vertically at ≤860px so the CTA sits under the input", () => {
    const m = mediaBlock(860, "first");
    expect(m).toMatch(/\.ld-command\s*\{[\s\S]*?flex-direction:\s*column/);
    expect(m).toMatch(/\.ld-command\s*\{[\s\S]*?max-width:\s*100%/);
  });
});

describe("hero first viewport — committed screenshots (issue #3603 accept #4)", () => {
  it("commits PNG captures at exactly the two acceptance viewports", () => {
    for (const shot of VIEWPORT_SHOTS) {
      expect(existsSync(shot.file), `${shot.file} is committed`).toBe(true);
      const size = pngSize(shot.file);
      expect(
        size,
        `${shot.file} was captured at ${shot.width}x${shot.height}`,
      ).toEqual({ width: shot.width, height: shot.height });
      // A blank/1x1 capture cannot satisfy "every visitor sees headline,
      // value proposition, and clickable CTA" — the artefact must be a real
      // render.
      expect(
        statSync(shot.file).size,
        `${shot.file} is a real rendered capture, not a blank`,
      ).toBeGreaterThan(10_000);
    }
  });
});

describe("hero first viewport — rendered gate stays in place", () => {
  it("keeps the playwright specs that assert the real fold, overflow, and console contract", () => {
    // Vitest cannot measure layout; the rendered contract (bounding boxes
    // above the fold at 1440x900 and 390x844, zero console errors, no
    // horizontal scroll) lives in these specs and must not silently drop.
    expect(existsSync(join("tests", "hero-fold.spec.ts"))).toBe(true);
    expect(existsSync(join("e2e", "home-hero-viewport.spec.ts"))).toBe(true);
    const foldSpec = readFileSync("tests/hero-fold.spec.ts", "utf8");
    expect(foldSpec).toContain("expectPrimaryActionAboveFold");
    expect(foldSpec).toContain("expectNoHorizontalOverflow");
    expect(foldSpec).toContain("pageErrors");
  });
});

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// app.css split in issue #2392: the public tree loads base.css + marketing.css.
const css = ["app/base.css", "app/marketing.css"]
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");

function ruleBody(selector: string): string {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  expect(match, `missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

function lastAtRule(prelude: string, needle: string): string {
  const escaped = prelude.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`@media ${escaped} \\{`, "g");
  let lastStart = -1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    const start = match.index + match[0].length;
    if (css.slice(start, start + 1600).includes(needle)) {
      lastStart = start;
    }
  }
  expect(lastStart, `missing @media ${prelude} block containing ${needle}`).toBeGreaterThan(-1);
  let depth = 1;
  let end = lastStart;
  while (end < css.length && depth > 0) {
    if (css[end] === "{") depth += 1;
    else if (css[end] === "}") depth -= 1;
    end += 1;
  }
  return css.slice(lastStart, end - 1);
}

function lastMedia(maxWidthPx: number, needle: string): string {
  return lastAtRule(`(max-width: ${maxWidthPx}px)`, needle);
}

describe("homepage mobile first viewport (#971)", () => {
  it("isolates the ticker marquee so width:max-content cannot inflate the document", () => {
    const ticker = ruleBody(".ld-ticker");
    expect(ticker).toMatch(/overflow:\s*hidden/);
    expect(ticker).toMatch(/max-width:\s*100%/);
    expect(ticker).toMatch(/contain:\s*inline-size/);
  });

  it("compresses the 600px homepage stack so input and CTA can sit above a 390px fold", () => {
    const budget = lastMedia(600, ".ld-hero-grid .ld-wall");
    expect(budget).toMatch(/\.ld-hero-grid \.ld-wall\s*\{[^}]*font-size:\s*1\.75rem/);
    expect(budget).not.toMatch(/\.ld-hero-grid \.ld-wall\s*\{[^}]*font-size:\s*2\.3rem/);
    expect(budget).toMatch(/\.f9-home \.ld-hero \.f9-announcement\s*\{[^}]*flex-direction:\s*row/);
    expect(budget).toMatch(/\.f9-home \.ld-hero \.f9-announcement\s*\{[^}]*min-height:\s*44px/);
    expect(budget).toMatch(/\.f9-home \.ld-hero \.f9-announcement span\s*\{[^}]*display:\s*none/);
    expect(budget).toMatch(/\.f9-home \.ld-command input\s*\{[^}]*min-height:\s*44px/);
    expect(budget).toMatch(/\.f9-home \.ld-command button\s*\{[^}]*min-height:\s*44px/);
    expect(budget).toMatch(/\.f9-home \.ld-hero \.f9-hero-proof-actions\s*\{[^}]*flex-direction:\s*row/);
    expect(budget).toMatch(/\.ld-hero \{ padding-top: 0; \}/);
    expect(budget).toMatch(/\.ld-hero-copy \.ld-command \{ margin-top: 0; \}/);
    expect(budget).toMatch(/\.f9-home \.ld-hero \.ld-case \{ margin-bottom: 6px; \}/);
    expect(budget).toMatch(/\.f9-home \.ld-hero \.ld-hero-callouts \{ margin-bottom: 0; \}/);
    expect(budget).not.toMatch(/\.ld-nav-links\s*\{[^}]*display:\s*none/);
    expect(budget).not.toMatch(/\.ld-command\s*\{[^}]*display:\s*none/);
    expect(budget).not.toMatch(/\.ld-honest\s*\{[^}]*display:\s*none/);
  });

  it("compacts the demoted proof strip instead of hiding it", () => {
    const budget = lastMedia(600, ".ld-proof-strip");
    expect(budget).toMatch(/\.ld-proof-trail,\s*\n\s*\.ld-proof-strip-foot \{ display: none; \}/);
    expect(budget).toMatch(/\.ld-proof-strip-body \{ grid-template-columns: 1fr; \}/);
    expect(budget).not.toMatch(/\.ld-proof-strip\s*\{[^}]*display:\s*none/);
  });

  it("caps the desktop wall so a proof strip can still leave the command in 1440x900", () => {
    const wall = ruleBody(".ld-hero-grid .ld-wall");
    // #1875: the cap was 3.2rem; with the live Nykaa-length proof strip
    // present the search command landed at ~993px on desktop. 2.7rem keeps
    // the H1 the dominant element while reclaiming ~25px so the CTA clears
    // the 900px fold with room to spare.
    expect(wall).toMatch(/font-size:\s*clamp\(2\.1rem, 3\.4vw, 2\.7rem\)/);
    expect(wall).not.toMatch(/font-size:\s*clamp\([^)]*4\.5rem\)/);
  });
});

describe("homepage desktop first viewport (#1212)", () => {
  it("keeps the hero callout row flex-wrapped beside the free-preview pill", () => {
    const row = ruleBody(".f9-home .ld-hero .ld-hero-callouts");
    expect(row).toMatch(/display:\s*flex/);
    expect(row).toMatch(/flex-wrap:\s*wrap/);
    const pills = ruleBody(".f9-home .ld-hero .ld-hero-callouts .f9-announcement");
    expect(pills).toMatch(/margin-bottom:\s*0/);
  });

  it("pins the hero grid to the top so the side stack cannot shove the command under the 1440 fold", () => {
    const grid = ruleBody(".ld-hero-grid");
    expect(grid).toMatch(/align-items:\s*start/);
    expect(grid).not.toMatch(/align-items:\s*center/);
  });

  it("keeps the homepage nav and case file compact enough for a Nykaa-length wall", () => {
    const nav = ruleBody(".f9-home .ld-nav");
    expect(nav).toMatch(/padding-top:\s*16px/);
    expect(nav).toMatch(/padding-bottom:\s*16px/);
    const heroCase = ruleBody(".f9-home .ld-hero .ld-case");
    expect(heroCase).toMatch(/margin-bottom:\s*10px/);
  });
});

describe("setup checklist mobile fold (#1383 reland)", () => {
  it("restacks the tracking CTA under the field at 640px so it cannot overlap at y=-32", () => {
    const budget = lastMedia(640, ".f9-evidence-setup-primary");
    expect(budget).toMatch(
      /\.f9-evidence-setup-primary > \.f9-evidence-cta \{\s*grid-column:\s*1;\s*grid-row:\s*2;/,
    );
    expect(budget).toMatch(
      /\.f9-evidence-setup-primary > \.f9-evidence-setup-hint \{\s*grid-column:\s*1;\s*grid-row:\s*3;/,
    );
    expect(budget).toMatch(/\.f9-evidence-setup-primary \{\s*grid-template-columns:\s*1fr;/);
  });
});

describe("homepage short-portrait first viewport (#2090)", () => {
  it("keeps the two hero pills on one 44px row at ≤600px so 375x812 still clears", () => {
    const budget = lastMedia(600, ".ld-hero-grid .ld-wall");
    // Live 375x812 with the Nykaa strip (2026-09-09): two wrapped pills are
    // 96px and the CTA bottom is 858, 46px past the Journey-1 fold. One row
    // of pills reclaims that without hiding the proof strip or the nav.
    expect(budget).toMatch(/\.f9-home \.ld-hero \.ld-hero-callouts\s*\{[^}]*flex-wrap:\s*nowrap/);
    expect(budget).toMatch(/\.ld-proof-strip-head \.ld-proof-time\s*\{[^}]*display:\s*none/);
  });

  it("compacts the wall and strip on short phones so 375x667 and 360x632 still clear", () => {
    const cssBudget = lastAtRule(
      "(max-width: 600px) and (max-height: 760px)",
      ".ld-hero-grid .ld-wall",
    );
    // Live 375x667 (2026-09-09): form.top=767, button.bottom=858, fold=667.
    // Width-only packing is not enough on SE-height phones. Shrink the wall
    // and the proof-strip body; do not hide the strip, the command, or the
    // primary nav (Journey 1 still has to see Search preview / Pricing).
    expect(cssBudget).toMatch(/\.ld-hero-grid \.ld-wall\s*\{[^}]*font-size:\s*1\.35rem/);
    expect(cssBudget).toMatch(/\.ld-ticker\s*\{[^}]*padding:\s*2px 0/);
    expect(cssBudget).toMatch(/\.ld-nav\s*\{[^}]*padding:\s*8px 16px/);
    expect(cssBudget).toMatch(/\.ld-deck-copy\s*\{[^}]*font-size:\s*0\.8rem/);
    expect(cssBudget).toMatch(/\.f9-home \.ld-command input\s*\{[^}]*min-height:\s*44px/);
    expect(cssBudget).toMatch(/\.f9-home \.ld-command button\s*\{[^}]*min-height:\s*44px/);
  });

  it("keeps the proof strip, the command, the deck, and the primary nav", () => {
    const cssBudget = lastAtRule(
      "(max-width: 600px) and (max-height: 760px)",
      ".ld-hero-grid .ld-wall",
    );
    expect(cssBudget).not.toMatch(/\.ld-proof-strip\s*\{[^}]*display:\s*none/);
    expect(cssBudget).not.toMatch(/\.ld-command\s*\{[^}]*display:\s*none/);
    expect(cssBudget).not.toMatch(/\.ld-nav-links\s*\{[^}]*display:\s*none/);
    expect(cssBudget).not.toMatch(/\.ld-deck-copy\s*\{[^}]*display:\s*none/);
    expect(cssBudget).toMatch(/\.ld-proof-strip-head \.ld-proof-time\s*\{[^}]*display:\s*none/);
    expect(cssBudget).toMatch(/\.ld-proof-hook \.ld-proof-attrib\s*\{[^}]*display:\s*none/);
  });
});

describe("homepage fold canary (#2090 termination)", () => {
  it("checks 375x667 as well as 390x844", () => {
    const script = readFileSync("scripts/check-homepage-mobile-fold.mjs", "utf8");
    // Structural: the canary reads both viewport sizes from the script source
    // and exercises the strip-hidden case, without pinning an exact literal.
    expect(script).toMatch(/width:\s*390,\s*height:\s*844/);
    expect(script).toMatch(/width:\s*375,\s*height:\s*667/);
    expect(script).toMatch(/\bstripHidden\b/);
  });
});

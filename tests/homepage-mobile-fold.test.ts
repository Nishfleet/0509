import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync("app/app.css", "utf8");

function ruleBody(selector: string): string {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  expect(match, `missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

function lastMedia(maxWidthPx: number, needle: string): string {
  const re = new RegExp(`@media \\(max-width: ${maxWidthPx}px\\) \\{`, "g");
  let lastStart = -1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    const start = match.index + match[0].length;
    if (css.slice(start, start + 1200).includes(needle)) {
      lastStart = start;
    }
  }
  expect(lastStart, `missing @media (max-width: ${maxWidthPx}px) block containing ${needle}`).toBeGreaterThan(-1);
  let depth = 1;
  let end = lastStart;
  while (end < css.length && depth > 0) {
    if (css[end] === "{") depth += 1;
    else if (css[end] === "}") depth -= 1;
    end += 1;
  }
  return css.slice(lastStart, end - 1);
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
    expect(wall).toMatch(/font-size:\s*clamp\(2\.2rem, 3\.6vw, 3\.2rem\)/);
    expect(wall).not.toMatch(/font-size:\s*clamp\([^)]*4\.5rem\)/);
  });
});

describe("homepage desktop first viewport (#1212)", () => {
  it("sits the MagicBrief callout on one row with the free-preview pill", () => {
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

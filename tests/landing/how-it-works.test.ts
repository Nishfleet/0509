import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HowItWorks } from "../../app/components/landing/how-it-works";

const TITLES = ["Paste your site or handle", "Meet who you’re up against", "Read one email on Monday"] as const;

function markup(): string {
  return renderToStaticMarkup(createElement(HowItWorks));
}

describe("landing how-it-works", () => {
  it("is one ordered list of the three true steps, in order", () => {
    const html = markup();
    expect(html).toContain('id="how-it-works"');
    expect(html).toContain("Three steps, no chores");
    expect(html).toContain("<ol");
    expect(html.match(/<li/g)).toHaveLength(3);
    const positions = TITLES.map((title) => html.indexOf(title));
    for (const position of positions) {
      expect(position).toBeGreaterThan(-1);
    }
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("is a ruled sequence, not three cards in a grid", () => {
    const html = markup();
    const list = html.slice(html.indexOf("<ol"), html.indexOf("</ol>"));
    expect(list).toContain("border-t");
    expect(html.match(/border-b/g)).toHaveLength(3);
    expect(list).not.toMatch(/grid-cols-3/);
    expect(list).not.toContain("grid-cols-2");
  });

  it("lets the display face carry the step and numbers each row in type", () => {
    const html = markup();
    const headings = [...html.matchAll(/<h3([^>]*)>/g)].map((match) => match[1] ?? "");
    expect(headings).toHaveLength(3);
    for (const heading of headings) {
      expect(heading).toContain("font-display");
      expect(heading).toContain("uppercase");
    }
    for (const [index] of TITLES.entries()) {
      expect(html).toContain(`>${String(index + 1).padStart(2, "0")}<`);
    }
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<img");
  });

  it("claims only what the product does today", () => {
    const html = markup();
    expect(html).toContain("Tap any field to fix it. The card is the form.");
    expect(html).toContain("one switch");
    expect(html).toContain("one email on Monday");
    expect(html).not.toMatch(/\bfree\b/i);
    expect(html).not.toContain("!");
  });
});

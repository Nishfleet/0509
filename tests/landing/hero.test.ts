import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Hero } from "../../app/components/landing/hero";
import { WATCHED_NOUNS } from "../../app/lib/coverage";

const HEADLINE = "Know where you stand. And who’s gaining on you.";
const SENTENCE = `We watch ${WATCHED_NOUNS} across your market, and we name the rivals for you, so you do not have to know them.`;
const MICROCOPY = "One input. Sixty seconds to your first standing.";

function markup(): string {
  return renderToStaticMarkup(createElement(Hero));
}

describe("landing hero", () => {
  it("names who it is for, the outcome, and what we watch, with no product name in the headline", () => {
    const html = markup();
    expect(html).toContain("For founders, brands and creators");
    expect(html).toContain(HEADLINE);
    expect(html).toContain(SENTENCE);
    expect(html).toContain('id="hero"');
    const headline = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
    expect(headline).not.toMatch(/0509|five to nine/i);
  });

  it("is the one input, the priced button, and the sixty-second line", () => {
    const html = markup();
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/login"');
    expect(html).toContain('name="subject"');
    expect(html).toContain('placeholder="your website, or a handle"');
    expect(html).toContain('aria-label="your website, or a handle"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>/);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain("€10/mo");
    expect(html).toContain(MICROCOPY);
    expect(html).not.toContain("7-day trial");
  });

  it("has no exclamation mark and does not say free", () => {
    const html = markup();
    expect(html).not.toContain("!");
    expect(html).not.toMatch(/\bfree\b/i);
  });
});

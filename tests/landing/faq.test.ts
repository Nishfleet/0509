import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Faq } from "../../app/components/landing/faq";
import { FAQ } from "../../app/lib/faq";

function markup(): string {
  return renderToStaticMarkup(createElement(Faq));
}

function escaped(text: string): string {
  return renderToStaticMarkup(createElement("span", null, text))
    .replace(/^<span>/, "")
    .replace(/<\/span>$/, "");
}

describe("landing faq", () => {
  it("renders the section shell with an h2 titled Questions", () => {
    const html = markup();
    expect(html).toContain('<section id="faq"');
    expect(html).toContain('aria-labelledby="faq-title"');
    const heading = html.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/);
    expect(heading).toBeDefined();
    expect(heading?.[0]).toContain('id="faq-title"');
    expect(heading?.[0]).toContain("Questions");
  });

  it("renders one h3 per FAQ entry, in order, each equal to the escaped question", () => {
    const html = markup();
    const headings = [...html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map((match) => match[1]);
    expect(FAQ.length).toBeGreaterThan(0);
    expect(headings).toHaveLength(FAQ.length);
    FAQ.forEach((entry, index) => {
      expect(headings[index]).toBe(escaped(entry.question));
    });
  });

  it("renders each answer in a paragraph right after its question", () => {
    const html = markup();
    const entries = [...html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>\s*<p\b[^>]*>([\s\S]*?)<\/p>/g)];
    expect(entries).toHaveLength(FAQ.length);
    FAQ.forEach((entry, index) => {
      expect(entries[index]?.[1]).toBe(escaped(entry.question));
      expect(entries[index]?.[2]).toBe(escaped(entry.answer));
    });
  });
});

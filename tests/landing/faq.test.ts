import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Faq } from "../../app/components/landing/faq";
import { FAQ } from "../../app/lib/faq";

function markup(): string {
  return renderToStaticMarkup(createElement(Faq));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

describe("landing faq", () => {
  it("renders the section shell with an h2 titled Questions", () => {
    const html = markup();
    expect(html).toContain('<section id="faq"');
    expect(html).toContain('aria-labelledby="faq-title"');
    expect(html).toMatch(/<h2 id="faq-title"[^>]*>Questions<\/h2>/);
  });

  it("renders one h3 per FAQ entry, in order, each equal to the escaped question", () => {
    const html = markup();
    const headings = [...html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map((match) => match[1]);
    expect(FAQ.length).toBeGreaterThan(0);
    expect(headings).toHaveLength(FAQ.length);
    FAQ.forEach((entry, index) => {
      expect(headings[index]).toBe(escapeHtml(entry.question));
    });
  });

  it("renders each answer in a paragraph right after its question", () => {
    const html = markup();
    FAQ.forEach((entry) => {
      const questionHtml = escapeHtml(entry.question);
      const questionIndex = html.indexOf(questionHtml);
      expect(questionIndex).toBeGreaterThan(-1);
      const afterQuestion = html.slice(questionIndex + questionHtml.length);
      const paragraph = afterQuestion.match(/<p\b[^>]*>([\s\S]*?)<\/p>/);
      expect(paragraph?.[1]).toBe(escapeHtml(entry.answer));
    });
  });
});

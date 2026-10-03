import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HiringRow, type HiringAlertItem } from "../app/components/hiring-row";

const HIRING: HiringAlertItem = {
  id: "sig_hiring_1",
  title: "Senior Backend Engineer",
  brand: "Zephyrwear",
  detail: "Senior designer",
  url: "https://boards.greenhouse.io/zephyr/jobs/1",
  at: "2026-09-25T09:00:00Z",
  when: "yesterday",
};

const ANCHOR = /<a\b[^>]*>[\s\S]*?<\/a>/;
const PARAGRAPH = /<p\b[^>]*>[\s\S]*?<\/p>/;
const TIME = /<time\b[^>]*>[\s\S]*?<\/time>/;

function render(hiring: HiringAlertItem): string {
  return renderToStaticMarkup(createElement(HiringRow, { hiring }));
}

function element(html: string, pattern: RegExp): string {
  return html.match(pattern)?.[0] ?? "";
}

function textOf(markup: string): string {
  return markup.replace(/<[^>]*>/g, "");
}

describe("HiringRow", () => {
  it("marks the article with the hiring id and the hiring-row test id", () => {
    const article = element(render(HIRING), /<article\b[^>]*>/);
    expect(article).toContain('id="sig_hiring_1"');
    expect(article).toContain('data-testid="hiring-row"');
  });

  it("opens the role on a new tab, safely, on a 44px tap target", () => {
    const heading = element(render(HIRING), /<h3\b[^>]*>[\s\S]*?<\/h3>/);
    const link = element(heading, /<a\b[^>]*>/);
    expect(link).toContain('href="https://boards.greenhouse.io/zephyr/jobs/1"');
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer nofollow"');
    expect(link).toContain("min-h-11");
  });

  it("names the new tab in the title link's accessible name", () => {
    const html = render(HIRING);
    expect(html).toContain('class="sr-only"');
    expect(textOf(element(html, ANCHOR))).toBe("Senior Backend Engineer (opens in a new tab)");
  });

  it("shows the posting title", () => {
    expect(render(HIRING)).toContain("Senior Backend Engineer");
  });

  it("joins the brand and the detail when the posting has one", () => {
    expect(textOf(element(render(HIRING), PARAGRAPH))).toBe("Zephyrwear is hiring · Senior designer");
  });

  it("leaves out the detail and the separator when the posting has none", () => {
    expect(textOf(element(render({ ...HIRING, detail: null }), PARAGRAPH))).toBe("Zephyrwear is hiring");
  });

  it("dates the row with the posting time and shows its age", () => {
    const html = render(HIRING);
    expect(element(html, /<time\b[^>]*>/)).toMatch(/datetime="2026-09-25T09:00:00Z"/i);
    expect(textOf(element(html, TIME))).toBe("yesterday");
  });
});

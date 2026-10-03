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

function render(hiring: HiringAlertItem): string {
  return renderToStaticMarkup(createElement(HiringRow, { hiring }));
}

function linkOpeningTag(html: string): string {
  return html.match(/<a\b[^>]*>/)?.[0] ?? "";
}

describe("HiringRow", () => {
  it("marks the article with the hiring id and the hiring-row test id", () => {
    expect(render(HIRING)).toContain('<article id="sig_hiring_1" data-testid="hiring-row"');
  });

  it("opens the role on a new tab, safely, on a 44px tap target", () => {
    const link = linkOpeningTag(render(HIRING));
    expect(link).toContain('href="https://boards.greenhouse.io/zephyr/jobs/1"');
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer nofollow"');
    expect(link).toContain("min-h-11");
  });

  it("names the new tab for a screen reader in the link", () => {
    expect(render(HIRING)).toContain('<span class="sr-only"> (opens in a new tab)</span>');
  });

  it("shows the posting title", () => {
    expect(render(HIRING)).toContain("Senior Backend Engineer");
  });

  it("joins the brand and the detail when the posting has one", () => {
    expect(render({ ...HIRING, detail: "Senior designer" })).toContain("Zephyrwear is hiring · Senior designer");
  });

  it("leaves out the detail and the separator when the posting has none", () => {
    const html = render({ ...HIRING, detail: null });
    expect(html).toContain("Zephyrwear is hiring<");
    expect(html).not.toContain(" · ");
  });

  it("dates the row with the posting time and shows its age", () => {
    const html = render(HIRING);
    expect(html).toContain('<time dateTime="2026-09-25T09:00:00Z"');
    expect(html).toContain("yesterday");
  });
});

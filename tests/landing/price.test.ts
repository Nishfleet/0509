import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Price } from "../../app/components/landing/price";
import { monthlyPrice, PLANS, TRIAL_TERMS } from "../../app/lib/billing/plans";

function markup(): string {
  return renderToStaticMarkup(createElement(Price));
}

describe("landing price", () => {
  it("renders every plan from the module with its name and price, inside the price section", () => {
    const html = markup();
    expect(html).toContain('id="price"');
    for (const plan of PLANS) {
      expect(html).toContain(plan.name);
      expect(html).toContain(`€${String(plan.monthlyPriceEur)}`);
    }
  });

  it("shows the trial line from the module", () => {
    const html = markup();
    expect(html).toContain(TRIAL_TERMS);
  });

  it("claims only what the product does today", () => {
    const html = markup();
    expect(html).not.toMatch(/\bfree\b/i);
    expect(html).not.toContain("!");
  });

  it("carries one filled Start watching button with the first plan's price", () => {
    const html = markup();
    expect(html.match(/href="\/login"/g)).toHaveLength(1);
    const anchor = html.match(/<a\b[^>]*href="\/login"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? "";
    expect(anchor).toContain("Start watching");
    expect(anchor).toContain(monthlyPrice(PLANS[0].monthlyPriceEur));
    expect(anchor).toContain("bg-ink");
    expect(anchor).not.toContain("bg-transparent");
  });
});

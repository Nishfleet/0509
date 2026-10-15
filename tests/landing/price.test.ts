import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Price } from "../../app/components/landing/price";
import { monthlyPrice, PLANS, TRIAL_TERMS } from "../../app/lib/billing/plans";

function markup(): string {
  return renderToStaticMarkup(createElement(Price));
}

function section(html: string): string {
  const start = html.indexOf('<section id="price"');
  const end = html.indexOf("</section>", start);
  return html.slice(start, end);
}

describe("landing price", () => {
  it("renders every plan from the module with its name and price, inside the price section", () => {
    const html = markup();
    expect(html).toContain('id="price"');
    const body = section(html);
    for (const plan of PLANS) {
      expect(body).toContain(plan.name);
      expect(body).toContain(`€${String(plan.monthlyPriceEur)}<`);
    }
  });

  it("opens each higher plan with what it builds on, so the lists do not repeat", () => {
    const cards = new Map(
      section(markup())
        .split("<h3")
        .slice(1)
        .map((card) => [card.slice(card.indexOf(">") + 1, card.indexOf("</h3>")), card]),
    );
    const cardOf = (id: string) => cards.get(PLANS.find((plan) => plan.id === id)?.name ?? "");
    expect(cardOf("scout")).not.toContain("Everything in");
    expect(cardOf("starter")).toContain("Everything in Scout, plus");
    expect(cardOf("agency")).toContain("Everything in Starter, plus");
  });

  it("draws every plan card the same, with no plan marked as the one to pick", () => {
    const cards = section(markup()).match(/<li class="min-w-0[^"]*"/g) ?? [];
    expect(cards).toHaveLength(PLANS.length);
    expect(new Set(cards).size).toBe(1);
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

  it("carries one filled Start watching link with the first plan's price", () => {
    const html = markup();
    expect(html.match(/href="\/login"/g) ?? []).toHaveLength(1);
    const anchor = /<a\b[^>]*href="\/login"[^>]*>[\s\S]*?<\/a>/.exec(html)?.[0] ?? "";
    expect(anchor).toContain("Start watching");
    expect(anchor).toContain(monthlyPrice(PLANS[0].monthlyPriceEur));
    expect(anchor).toContain("bg-ink");
    expect(anchor).not.toContain("bg-transparent");
  });
});

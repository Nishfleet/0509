import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StartButton, StartWatchingLabel } from "../../app/components/landing/start-button";
import { monthlyPrice, PLANS } from "../../app/lib/billing/plans";
import { buttonVariants } from "../../app/components/ui/button";

const [scout] = PLANS;

function markup(): string {
  return renderToStaticMarkup(createElement(StartButton));
}

describe("landing start button", () => {
  it("links to /login", () => {
    const anchor = markup().match(/<a\b[^>]*>/)?.[0];
    expect(anchor).toContain('href="/login"');
  });

  it("carries the primary large button classes", () => {
    const anchor = markup().match(/<a\b[^>]*>/)?.[0];
    expect(anchor).toContain(buttonVariants({ variant: "primary", size: "lg" }));
  });

  it("shows the label with the scout plan's monthly price", () => {
    const html = markup();
    expect(html).toContain("Start watching");
    expect(html).toContain(monthlyPrice(scout.monthlyPriceEur));
  });

  it("renders the label's price from the plan definition", () => {
    const label = renderToStaticMarkup(createElement(StartWatchingLabel));
    expect(label).toContain("Start watching");
    expect(label).toContain(monthlyPrice(scout.monthlyPriceEur));
  });
});

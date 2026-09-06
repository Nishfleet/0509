// Regression guard, issue #1499: the /pricing tier-card grid must render the
// Free plan as the FIRST card, so the "no card required" promise is visible
// in the card grid instead of buried in the prose note. This is a render
// contract for the shared PricingSection component (used by /pricing and the
// homepage), so the guard asserts against the SSR markup, not the live page.
//
// The live-termination equivalent is:
//   curl -sS https://0509.io/pricing | grep -oP '(?<=<div class="f9-commerce-grid[^>]*>).*' | grep -c 'f9-commerce-card'   # expect: 4
//   curl -sS https://0509.io/pricing | grep -c '<span>Free</span>'                                                      # expect: 1
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pricingPlans, usageBundles } from "~/lib/pricing";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const commercialLaunch = {
  scoutSaleOpen: true,
  starterSaleOpen: true,
  agencySaleOpen: false,
};

const rootData = {
  session: null,
  pricingPlans: pricingPlans(),
  usageBundles: usageBundles(),
};

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      useRouteLoaderData: () => rootData,
      useLoaderData: () => ({ pricingPreview: { available: false }, commercialLaunch }),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
    };
  });
});

async function renderPricingSection() {
  const { PricingSection } = await import("~/components/pricing-section");
  return renderToStaticMarkup(
    createElement(PricingSection, {
      commercialLaunch,
      initialPricingPreview: null,
    }),
  );
}

/** Region of the tier grid belonging to the card whose name span matches. */
function cardRegion(markup: string, cardName: string) {
  const start = markup.indexOf(`<span>${cardName}</span>`);
  if (start === -1) return "";
  const articleStart = markup.lastIndexOf("<article", start);
  const nextArticle = markup.indexOf("<article", articleStart + 1);
  return markup.slice(
    articleStart,
    nextArticle === -1 ? undefined : nextArticle,
  );
}

describe("/pricing tier-card grid (#1499)", () => {
  it("renders exactly four cards in the order Free, Scout, Starter, Agency", async () => {
    const markup = await renderPricingSection();

    const cards = [...markup.matchAll(/<article class="f9-commerce-card[^"]*"/g)];
    expect(cards).toHaveLength(4);

    // Card names are the first span inside each f9-commerce-card article.
    const names = [
      ...markup.matchAll(
        /<article class="f9-commerce-card[^"]*">\s*<span>([^<]+)<\/span>/g,
      ),
    ].map((match) => match[1]);
    expect(names).toEqual(["Free", "Scout", "Starter", "Agency"]);
  });

  it("renders exactly one <span>Free</span> in the grid markup", async () => {
    const markup = await renderPricingSection();
    expect(markup.match(/<span>Free<\/span>/g) ?? []).toHaveLength(1);
  });

  it("renders the Free card with the no-card promise, €0 price, and prose-matched features", async () => {
    const markup = await renderPricingSection();
    const freeCard = cardRegion(markup, "Free");

    expect(freeCard).toContain("<span>Free</span>");
    // Price "€0" and sub-label "free, forever" (issue #1499 accept 1).
    expect(freeCard).toContain("€0");
    expect(freeCard).toContain("free, forever");
    // The promise the card exists to surface (accept 4: Free card text
    // contains "no card required").
    expect(freeCard.toLowerCase()).toContain("no card required");
    // The feature list mirrors the ld-pricing-note prose paragraph.
    for (const feature of [
      "Watch 1 competitor",
      "Instant first scan",
      "Weekly proof-backed brief",
      "1 Collection",
    ]) {
      expect(freeCard).toContain(feature);
    }
    // CTA links to signup with the pricing-free source marker (accept 2).
    expect(freeCard).toContain("/auth/signup?source=pricing-free");
    expect(freeCard).toContain("Start free");
    // No is-recommended badge on Free; the family class only (accept 1).
    expect(freeCard).not.toContain("is-recommended");
  });

  it("leaves the Starter card untouched (same copy, same recommended badge, same slot)", async () => {
    const markup = await renderPricingSection();
    const starterCard = cardRegion(markup, "Starter");

    expect(starterCard).toContain("is-recommended");
    expect(starterCard).toContain("Recommended");
    // Published USD anchor unchanged (accept 3: no Starter copy change).
    expect(starterCard).toContain("$59 USD/mo");
    // Starter still comes after Free in the grid (no reordering).
    expect(markup.indexOf("<span>Free</span>")).toBeLessThan(
      markup.indexOf("<span>Starter</span>"),
    );
  });
});
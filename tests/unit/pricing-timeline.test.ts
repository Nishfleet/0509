import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PricingTimeline } from "../../app/components/pricing-timeline";
import { pricingTimeline } from "../../app/lib/pricing-timeline";
import type { SiteChangeView } from "../../app/lib/site-change";

function change(over: Partial<SiteChangeView>): SiteChangeView {
  return {
    id: "c1",
    entityId: "e1",
    isSelf: false,
    headline: "Acme changed its pricing page",
    page: "pricing page",
    url: "https://acme.example/pricing",
    observedAt: "2026-09-01T21:00:00.000Z",
    capturedAt: "2026-09-01 21:00 UTC",
    wordsChanged: 4,
    provenance: null,
    sentence: "",
    mark: { removed: "Starter €40", added: "Starter €46" },
    before: { missing: "" },
    after: { missing: "" },
    whyFlagged: null,
    ...over,
  };
}

describe("pricingTimeline", () => {
  it("keeps only rivals' priced pricing-page changes, oldest first", () => {
    const steps = pricingTimeline([
      change({ id: "late", observedAt: "2026-10-05T21:00:00.000Z", mark: { removed: "€46", added: "€52" } }),
      change({ id: "early" }),
      change({ id: "same-day-later", observedAt: "2026-09-01T23:00:00.000Z" }),
      change({ id: "blog", page: "blog" }),
      change({ id: "mine", isSelf: true }),
      change({ id: "one-sided", mark: { removed: null, added: "New plan" } }),
    ]);
    expect(steps.map((step) => step.id)).toEqual(["early", "same-day-later", "late"]);
    expect(steps[0]).toMatchObject({ day: "2026-09-01", from: "Starter €40", to: "Starter €46" });
  });

  it("renders nothing without steps and a dated list with them", () => {
    expect(renderToStaticMarkup(createElement(PricingTimeline, { steps: [] }))).toBe("");
    const html = renderToStaticMarkup(createElement(PricingTimeline, { steps: pricingTimeline([change({})]) }));
    expect(html).toContain("Pricing page over time");
    expect(html).toContain("Starter €40");
    expect(html).toContain("2026-09-01");
    expect(html).toMatch(/<span class="sr-only">Was <\/span><span class="[^"]*line-through[^"]*">Starter €40<\/span>/);
    expect(html).toContain(", now </span>Starter €46");
    expect(html).toContain('<span aria-hidden="true"> → </span>');
  });
});

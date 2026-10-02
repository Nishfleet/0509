import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { PlanSection } from "../../app/components/plan-settings";
import type { PlanSummary } from "../../app/lib/billing/plans";

function render(plan: PlanSummary): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => createElement(PlanSection, { plan }) }]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

describe("PlanSection", () => {
  it("offers the next plan to someone with no payment set up", () => {
    const html = render({ tier: "scout", status: "none", currentPeriodEnd: null, billed: false });
    expect(html).toContain("Upgrade to Starter");
    expect(html).toContain("€46/mo");
  });

  it("offers manage or cancel, not an upgrade, to a subscriber", () => {
    const html = render({ tier: "starter", status: "active", currentPeriodEnd: null, billed: true });
    expect(html).toContain("Manage or cancel plan");
    expect(html).not.toContain("Upgrade to");
  });
});

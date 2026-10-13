import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactRouterModule from "react-router";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { PlanSection } from "../../app/components/plan-settings";
import type { PlanSummary } from "../../app/lib/billing/plans";

// 0509#6741: the only message settings.billing.ts ever returns is the
// UNAVAILABLE failure, because a successful portal call redirects instead.
// So the fetcher data this form can hold is exactly this message, and the
// paragraph that renders it is an error line, not progress. The sibling
// failure on the same page moved to an alert for the same reason in #6671.
const PORTAL_UNAVAILABLE = "We couldn't open your billing page. Try again in a few minutes.";

// PlanSection reads its message off useFetcher().data, which a static
// render never holds: the data only lands once a real submission settles.
// So the fetcher is swapped for one pinned at the settled state the test
// names, the way plan-gate.test.ts does it for the sibling form.
const fetcher = vi.hoisted(() => ({
  value: { state: "idle" as "idle" | "submitting", data: undefined as { message: string } | undefined },
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  const Form = ({
    action,
    method,
    className,
    children,
  }: {
    action: string;
    method: string;
    className?: string;
    children: ReactNode;
  }) => createElement("form", { action, method, className }, children);
  return { ...actual, useFetcher: () => ({ state: fetcher.value.state, data: fetcher.value.data, Form }) };
});

function render(plan: PlanSummary): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => createElement(PlanSection, { plan }) }]);
  const html = renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
  fetcher.value = { state: "idle", data: undefined };
  return html;
}

const BILLED: PlanSummary = {
  tier: "starter",
  status: "active",
  currentPeriodEnd: null,
  trialing: false,
  billed: true,
};

// The <p> that renders the text, opening tag through closing tag, so the
// role assertions pin the region on the element that holds the message
// rather than on any other paragraph in the markup. The searches quote the
// unescaped text, but React does not escape the substrings that cross it, so
// they match the static markup either way.
function paragraphWrapping(html: string, text: string): string {
  const start = html.indexOf(text);
  if (start < 0) throw new Error(`no paragraph renders "${text}"`);
  const open = html.lastIndexOf("<p", start);
  const close = html.indexOf("</p>", start);
  if (open < 0 || close < 0) throw new Error(`no paragraph bounds around "${text}"`);
  return html.slice(open, close + "</p>".length);
}

describe("PlanSection", () => {
  it("offers the next plan to someone with no payment set up", () => {
    const html = render({ tier: "scout", status: "none", currentPeriodEnd: null, trialing: false, billed: false });
    expect(html).toContain("Upgrade to Starter");
    expect(html).toContain("€46/mo");
  });

  it("offers the next plan again, and keeps billing history, once a paid plan has ended", () => {
    const html = render({
      tier: "scout",
      status: "cancelled",
      currentPeriodEnd: "2026-09-15T00:00:00.000Z",
      trialing: false,
      billed: true,
    });
    expect(html).toContain("Your paid plan ended on 15 September 2026. You&#x27;re on Scout.");
    expect(html).toContain("Upgrade to Starter");
    expect(html).toContain("See billing history");
    expect(html).not.toContain("Manage or cancel plan");
  });

  it("offers to update the card, not an upgrade, when a renewal payment is on hold", () => {
    const html = render({ ...BILLED, status: "on_hold", currentPeriodEnd: "2026-10-20T00:00:00.000Z" });
    expect(html).toContain("Update payment method");
    expect(html).toContain("paused");
    expect(html).not.toContain("Upgrade to");
    expect(html).not.toContain("Manage or cancel plan");
  });

  it("offers the next plan again, with billing history, after a first payment failed", () => {
    const html = render({ ...BILLED, status: "failed" });
    expect(html).toContain("Upgrade to Agency");
    expect(html).toContain("See billing history");
  });

  it("offers the card update and no drop-to-Scout wording when a Scout plan is on hold", () => {
    const html = render({ ...BILLED, tier: "scout", status: "on_hold", currentPeriodEnd: "2026-10-20T00:00:00.000Z" });
    expect(html).toContain("Update payment method");
    expect(html).toContain("paused");
    expect(html).not.toContain("you&#x27;re on Scout");
    expect(html).not.toContain("Upgrade to");
  });

  it("offers Starter again after a failed Scout payment", () => {
    const html = render({ ...BILLED, tier: "scout", status: "failed" });
    expect(html).toContain("Upgrade to Starter");
    expect(html).toContain("See billing history");
  });

  it("does not offer to cancel a plan that is already cancelled but still paid for", () => {
    const html = render({ ...BILLED, status: "cancelled", currentPeriodEnd: "2099-10-20T00:00:00.000Z" });
    expect(html).toContain("then it stops");
    expect(html).toContain("Manage billing");
    expect(html).not.toContain("Manage or cancel plan");
  });

  it("offers manage or cancel, not an upgrade, to a subscriber", () => {
    const html = render(BILLED);
    expect(html).toContain("Manage or cancel plan");
    expect(html).not.toContain("Upgrade to");
  });

  it("announces the billing-page-unavailable message as an alert, not a polite status", () => {
    fetcher.value = { state: "idle", data: { message: PORTAL_UNAVAILABLE } };
    const html = render(BILLED);

    const paragraph = paragraphWrapping(html, "open your billing page");
    expect(paragraph).toContain('role="alert"');
    expect(paragraph).not.toContain('role="status"');
  });

  it("renders no message paragraph and no alert while the fetcher holds nothing", () => {
    const html = render(BILLED);

    expect(html).not.toContain("open your billing page");
    expect(html).not.toContain('role="alert"');
  });
});

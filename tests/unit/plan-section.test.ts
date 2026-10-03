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

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactRouterModule from "react-router";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { PlanSection } from "../../app/components/plan-settings";
import type { PlanSummary } from "../../app/lib/billing/plans";

const PORTAL_UNAVAILABLE = "We couldn't open your billing page. Try again in a few minutes.";

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

function render(plan: PlanSummary, countLine: string | null = null): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => createElement(PlanSection, { plan, countLine }) }]);
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

function paragraphWrapping(html: string, text: string): string {
  const start = html.indexOf(text);
  if (start < 0) throw new Error(`no paragraph renders "${text}"`);
  const open = html.lastIndexOf("<p", start);
  const close = html.indexOf("</p>", start);
  if (open < 0 || close < 0) throw new Error(`no paragraph bounds around "${text}"`);
  return html.slice(open, close + "</p>".length);
}

describe("PlanSection", () => {
  it("shows how many competitors the plan is watching, and nothing when it has no count", () => {
    const line = "Watching 3 of 15 competitors on your plan.";
    expect(render(BILLED, line)).toContain(`data-slot="plan-usage"`);
    expect(render(BILLED, line)).toContain(line);
    expect(render(BILLED)).not.toContain("plan-usage");
  });

  it("offers the next plan to someone with no payment set up", () => {
    const html = render({ tier: "scout", status: "none", currentPeriodEnd: null, trialing: false, billed: false });
    expect(html).toContain("Upgrade to Starter");
    expect(html).toContain("€46/month");
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

  it("names Dodo Payments as the seller of record and says where the invoices are", () => {
    const html = render(BILLED);
    expect(html).toContain("Dodo Payments is the seller of record.");
    expect(html).toContain("invoices are in the Dodo portal");
  });

  it("says nothing about the seller of record to a workspace with no card on file", () => {
    const html = render({ tier: "scout", status: "none", currentPeriodEnd: null, trialing: false, billed: false });
    expect(html).not.toContain("Dodo");
  });

  it("offers a paying Scout customer a switch to Starter that posts to the upgrade action", () => {
    const html = render({ ...BILLED, tier: "scout" });
    expect(html).toContain("Switch to Starter");
    expect(html).toContain('action="/app/upgrade"');
    expect(html).toContain('name="plan" value="starter"');
    expect(html).not.toContain("Upgrade to");
  });

  it("offers no switch on the top plan, during a trial or to someone who does not pay yet", () => {
    expect(render({ ...BILLED, tier: "agency" })).not.toContain("Switch to");
    expect(render({ ...BILLED, tier: "scout", trialing: true })).not.toContain("Switch to");
    expect(render({ ...BILLED, tier: "scout", billed: false })).not.toContain("Switch to");
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

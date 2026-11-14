import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactRouterModule from "react-router";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { PlanGate, UpgradeStatus } from "../../app/components/plan-gate";

const UPGRADE_UNAVAILABLE = "Upgrading isn't available right now. Try again in a few minutes.";

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

function renderPlanGate(returning = false, first = false): string {
  const Stub = createRoutesStub([
    {
      id: "plan-gate",
      path: "/",
      Component: () => createElement(PlanGate, { planId: "starter", returning, first }),
    },
  ]);
  const html = renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
  fetcher.value = { state: "idle", data: undefined };
  return html;
}

function paragraphWrapping(html: string, text: string): string {
  const start = html.indexOf(text);
  if (start < 0) throw new Error(`no paragraph renders "${text}"`);
  const open = html.lastIndexOf("<p", start);
  const close = html.indexOf("</p>", start);
  if (open < 0 || close < 0) throw new Error(`no paragraph bounds around "${text}"`);
  return html.slice(open, close + "</p>".length);
}

describe("PlanGate", () => {
  it("announces the upgrade-unavailable message as an alert, not a polite status", () => {
    fetcher.value = { state: "idle", data: { message: UPGRADE_UNAVAILABLE } };
    const html = renderPlanGate();

    const paragraph = paragraphWrapping(html, "available right now");
    expect(paragraph).toContain('role="alert"');
    expect(paragraph).not.toContain('role="status"');
  });

  it("promises the trial to a new customer and not to one who has had it", () => {
    expect(renderPlanGate()).toContain("7-day trial");
    const returning = renderPlanGate(true);
    expect(returning).not.toContain("7-day trial");
    expect(returning).toContain("already had your free trial");
  });

  it("offers a first plan as a trial with what the plan includes, and leaves the trial terms to the page", () => {
    const html = renderPlanGate(false, true);
    expect(html).toContain("Start 7-day Starter trial");
    expect(html).not.toContain("Upgrade to");
    expect(html).not.toContain("7-day trial.");
    expect(html).not.toContain("charged on day 8");
    expect(html).toContain("Everything in Scout, plus");
    expect(html).toContain("15 competitors watched at once");
  });

  it("renders no message paragraph and no alert while the fetcher holds nothing", () => {
    const html = renderPlanGate();

    expect(html).not.toContain("available right now");
    expect(html).not.toContain('role="alert"');
  });
});

describe("UpgradeStatus", () => {
  function renderStatus(tier: "starter", wanted: "starter" | "agency" | null): string {
    const Stub = createRoutesStub([
      {
        id: "upgrade-status",
        path: "/",
        Component: () => createElement(UpgradeStatus, { tier, wanted }),
      },
    ]);
    return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
  }

  it("keeps the current-plan line a polite status region", () => {
    const html = renderStatus("starter", "starter");

    const paragraph = paragraphWrapping(html, "It watches up to 15 competitors.");
    expect(paragraph).toContain('role="status"');
    expect(paragraph).not.toContain('role="alert"');
  });

  it("keeps the confirming line a polite status region while the provider answers", () => {
    const html = renderStatus("starter", "agency");

    const paragraph = paragraphWrapping(html, "Confirming your Agency plan with our payment provider.");
    expect(paragraph).toContain('role="status"');
    expect(paragraph).not.toContain('role="alert"');
  });
});

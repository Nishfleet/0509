import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactRouterModule from "react-router";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { PlanGate, UpgradeStatus } from "../../app/components/plan-gate";

// 0509#6671: the one message app.upgrade.ts ever returns is the
// UNAVAILABLE failure, because a successful checkout redirects instead.
// So the fetcher data this form can hold is exactly this message, and the
// paragraph that renders it is an error line, not progress.
const UPGRADE_UNAVAILABLE = "Upgrading isn't available right now. Try again in a few minutes.";

// PlanGate reads its message off useFetcher().data, which a static
// render never holds: the data only lands once a real submission settles.
// So the fetcher is swapped for one pinned at the settled state the test
// names, the way brief-pause-setting.test.ts does it.
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

function renderPlanGate(): string {
  const Stub = createRoutesStub([
    {
      id: "plan-gate",
      path: "/",
      Component: () => createElement(PlanGate, { planId: "starter" }),
    },
  ]);
  const html = renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
  fetcher.value = { state: "idle", data: undefined };
  return html;
}

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

describe("PlanGate", () => {
  it("announces the upgrade-unavailable message as an alert, not a polite status", () => {
    fetcher.value = { state: "idle", data: { message: UPGRADE_UNAVAILABLE } };
    const html = renderPlanGate();

    const paragraph = paragraphWrapping(html, "available right now");
    expect(paragraph).toContain('role="alert"');
    expect(paragraph).not.toContain('role="status"');
  });

  it("renders no message paragraph and no alert while the fetcher holds nothing", () => {
    const html = renderPlanGate();

    expect(html).not.toContain("available right now");
    expect(html).not.toContain('role="alert"');
  });
});

// The UpgradeStatus paragraphs are progress, so they stay polite status
// regions: these tests hold the fix to the error line in PlanGate only.
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
    // tier === wanted is the settled state: the plan turned on, so the
    // line reports what the user is on, which is progress, not an error.
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

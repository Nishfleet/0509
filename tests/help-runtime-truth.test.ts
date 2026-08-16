import { readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// Live holder read by the mocked `useRouteLoaderData` at render time, so a
// test can flip between anonymous and signed-in root data without re-mocking.
let rootData: unknown;

function mockRouter() {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useRouteLoaderData: () => rootData,
    };
  });
}

beforeEach(() => {
  rootData = undefined;
  vi.resetModules();
  mockRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("customer help runtime truth", () => {
  it("explains activation, recurring monitoring, and delivery proof without overclaiming", async () => {
    const { default: HelpRoute } = await import("~/routes/help");
    const markup = renderToStaticMarkup(createElement(HelpRoute));

    expect(markup).toContain("Free lets you watch one competitor");
    expect(markup).toContain("then a weekly check with a weekly");
    expect(markup).toContain("Paid plans add 3–6 hour checks, daily briefs, evidence, and more competitors");
    expect(markup).toContain("Email delivery is in product scope");
    expect(markup).toContain("does not measure live email-provider availability");
    expect(markup).toContain("A manual refresh confirms a fresh check only; it does not confirm recurring delivery.");
    expect(markup).toContain("If a scheduled digest does not arrive");
    expect(markup).not.toMatch(/email delivery is available/i);
    expect(markup).not.toMatch(/(?:Slack|WhatsApp) (?:delivery|notifications?) (?:is|are) available/i);
    expect(markup).not.toMatch(/manual refresh[^.]{0,60}(?:confirms|proves) (?:a )?(?:scheduled|recurring )?delivery/i);
  });

  it("keeps billing, cancellation, and deletion contracts exact", async () => {
    const { default: HelpRoute } = await import("~/routes/help");
    const markup = renderToStaticMarkup(createElement(HelpRoute));

    expect(markup).toContain("hosted billing portal");
    expect(markup).toContain("Plan changes and cancellation stay backed by");
    expect(markup).toContain("until portal subscription updates are confirmed");
    expect(markup).toContain("Cancellation stops future renewals, and access continues until the end of the period you have paid for.");
    expect(markup).toContain("Account deletion is a support request, not an automatic or in-app deletion.");
    expect(markup).toContain("Nothing is deleted automatically or in-app.");
    // Anonymous visitors (and crawlers) get the login destination directly,
    // so the support-case links never redirect.
    expect(markup).toContain("/auth/login?redirectTo=%2Fapp%2Fsupport%3Fcategory%3Dbilling");
    expect(markup).toContain("/auth/login?redirectTo=%2Fapp%2Fsupport%3Fcategory%3Dsecurity");
  });

  it("keeps direct app-route targets for signed-in customers", async () => {
    rootData = { session: { user: { id: "u1" } } };
    const { default: HelpRoute } = await import("~/routes/help");
    const markup = renderToStaticMarkup(createElement(HelpRoute));

    expect(markup).toContain('href="/app/notifications"');
    expect(markup).toContain('href="/app/support?category=delivery"');
    expect(markup).toContain('href="/app/billing"');
    expect(markup).toContain('href="/app/support?category=billing"');
    expect(markup).toContain('href="/app/support?category=security"');
    expect(markup).toContain('href="/app/support"');
  });

  it("does not expose candidate or frozen implementation claims in source or copy", async () => {
    const source = readFileSync("app/routes/help.tsx", "utf8");
    const { default: HelpRoute } = await import("~/routes/help");
    const markup = renderToStaticMarkup(createElement(HelpRoute));
    const customerCopy = `${source}\n${markup}`;

    expect(customerCopy).not.toMatch(/candidate|frozen|Journey [345]/i);
  });
});

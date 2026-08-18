import { readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useRouteLoaderData: () => undefined,
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("customer changelog", () => {
  it("renders customer outcomes with honest provider and billing boundaries", async () => {
    const { default: ChangelogRoute } = await import("~/routes/changelog");
    const markup = renderToStaticMarkup(createElement(ChangelogRoute));

    expect(markup).toContain("Updated public links and account-facing pages to use 0509.io.");
    expect(markup).toContain("Billing checks now keep account access tied to confirmed payment information.");
    expect(markup).toContain("WhatsApp notifications are not available yet");
    expect(markup).toContain("Slack notifications are not generally available yet");
    expect(markup).toContain("Workspace navigation now has five destinations");
    expect(markup).toContain("Brand pages at /ads/:domain now attribute every ad to its real advertiser");
    expect(markup).not.toMatch(/(?:Slack|WhatsApp) (?:delivery|notifications?) (?:is|are) (?:available|live|enabled)/i);
    expect(markup).not.toMatch(/live provider|provider availability/i);
  });

  it("keeps internal implementation language out of the source and rendered copy", async () => {
    const source = readFileSync("app/routes/changelog.tsx", "utf8");
    const { default: ChangelogRoute } = await import("~/routes/changelog");
    const markup = renderToStaticMarkup(createElement(ChangelogRoute));
    const customerCopy = `${source}\n${markup}`;

    expect(customerCopy).not.toMatch(/signed plan|record-pack grants|primary production domain/i);
    expect(customerCopy).not.toContain("redirect compatibility");
    expect(customerCopy).not.toMatch(/Journey [345]/i);
  });
});

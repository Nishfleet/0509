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
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("public documentation routes", () => {
  it("renders API docs with agent boundaries and write-key requirements", async () => {
    const { default: ApiDocsRoute } = await import("~/routes/api.docs");
    const markup = renderToStaticMarkup(createElement(ApiDocsRoute));

    expect(markup).toContain("First agent workflow");
    expect(markup).toContain("Audited action groups");
    expect(markup).toContain("Requires a write-enabled customer API key");
    expect(markup).toContain("Agent-blocked capabilities");
    expect(markup).toContain("customer API key creation, rotation, and revocation");
    expect(markup).toContain("broad public write APIs beyond audited workspace actions");
    expect(markup).not.toContain("fully general write API");
    expect(markup).not.toContain("hooks.slack.com/services/");
    expect(markup).not.toContain("BETTER_AUTH_SECRET");
  });

  it("renders help and trust support paths without unsupported claims", async () => {
    const { default: HelpRoute } = await import("~/routes/help");
    const { default: TrustRoute } = await import("~/routes/trust");
    const helpMarkup = renderToStaticMarkup(createElement(HelpRoute));
    const trustMarkup = renderToStaticMarkup(createElement(TrustRoute));

    expect(helpMarkup).toContain("Paid customer support paths");
    expect(helpMarkup).toContain("Billing changes and cancellation");
    expect(helpMarkup).toContain("Security and deletion requests");
    expect(trustMarkup).toContain("Agent tools also do not perform");
    expect(trustMarkup).toContain("secret-bearing integration setup");
    expect(trustMarkup).toContain("customer API key creation, rotation, and revocation");
    expect(trustMarkup).toContain("broad public write APIs beyond audited");
    expect(trustMarkup).toContain("does not currently claim");
    expect(trustMarkup).not.toContain("SOC 2 compliant");
    expect(helpMarkup).not.toContain("hooks.slack.com/services/");
    expect(trustMarkup).not.toContain("DODO_API_KEY");
  });
});

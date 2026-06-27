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
  it("renders API docs with customer-facing boundaries and write-key requirements", async () => {
    const { default: ApiDocsRoute } = await import("~/routes/api.docs");
    const markup = renderToStaticMarkup(createElement(ApiDocsRoute));

    expect(markup).toContain("Account actions");
    expect(markup).toContain("MCP for connected tools");
    expect(markup).toContain("POST /api/mcp");
    expect(markup).toContain("tools/list");
    expect(markup).toContain("Use a write-enabled key only when the tool should update supported account resources.");
    expect(markup).toContain("Requires a write-enabled customer API key");
    expect(markup).toContain("Restricted actions still require signed-in owner review");
    expect(markup).toContain("customer API key creation, rotation, and revocation");
    expect(markup).toContain("Not live yet: automated X, Reddit, LinkedIn, YouTube, TikTok, Google, or Pinterest ingestion.");
    expect(markup).toContain("Pull a collection as JSON into a team research note.");
    expect(markup).not.toContain("Pull a board as JSON");
    expect(markup).not.toContain("fully general write API");
    expect(markup).not.toContain("First agent workflow");
    expect(markup).not.toContain("hooks.slack.com/services/");
    expect(markup).not.toContain("format=slack");
    expect(markup).not.toContain("Slack-ready");
    expect(markup).not.toContain("Reddit observations");
    expect(markup).not.toContain("BETTER_AUTH_SECRET");
  });

  it("renders help and trust support paths without unsupported claims", async () => {
    const { default: HelpRoute } = await import("~/routes/help");
    const { default: TrustRoute } = await import("~/routes/trust");
    const { default: PresenceBotInfoRoute } = await import("~/routes/bots.presence");
    const helpMarkup = renderToStaticMarkup(createElement(HelpRoute));
    const trustMarkup = renderToStaticMarkup(createElement(TrustRoute));
    const presenceBotMarkup = renderToStaticMarkup(createElement(PresenceBotInfoRoute));

    expect(helpMarkup).toContain("Paid customer support paths");
    expect(helpMarkup).toContain("Billing changes and cancellation");
    expect(helpMarkup).toContain("Security and deletion requests");
    expect(trustMarkup).toContain("Connected tools also do not perform");
    expect(trustMarkup).toContain("secret-bearing integration setup");
    expect(trustMarkup).toContain("customer API key creation, rotation, and revocation");
    expect(trustMarkup).toContain("broad public write APIs");
    expect(trustMarkup).toContain("validates the D1 backup scripts");
    expect(trustMarkup).toContain("automated R2 backup scheduling and restore drills");
    expect(trustMarkup).toContain("remain owner-operated until recorded as verified");
    expect(trustMarkup).toContain("does not currently claim");
    expect(trustMarkup).not.toContain("SOC 2 compliant");
    expect(trustMarkup).not.toContain("Weekly D1 exports upload to R2");
    expect(helpMarkup).not.toContain("hooks.slack.com/services/");
    expect(trustMarkup).not.toContain("DODO_API_KEY");
    expect(presenceBotMarkup).toContain("support@0509.io");
    expect(presenceBotMarkup).not.toContain("support@0509.in");
  });
});

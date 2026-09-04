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

describe("public documentation routes", () => {
  it("renders task-oriented docs with honest source and plan boundaries", async () => {
    const { default: DocsRoute } = await import("~/routes/docs");
    const markup = renderToStaticMarkup(createElement(DocsRoute));

    expect(markup).toContain("Run a trustworthy first search");
    expect(markup).toContain("No evidence is not proof that a competitor has no active ads");
    expect(markup).toContain("Free plan scope: one competitor with an instant first scan, then a weekly scheduled check and a weekly email brief backed by one proof capture a month");
    expect(markup).toContain("Use Five to Nine from Claude, ChatGPT, and AI agents");
    expect(markup).toContain("https://0509.io/api/mcp");
    expect(markup).toContain("read-only API and MCP access works on Free and Scout");
    expect(markup).toContain("Starter plan scope: daily briefs, urgent alerts, evidence capture, and exports");
    expect(markup).toContain("Agency plan scope: client reports, share links, PDF delivery, branding, API/MCP access, and team seats");
    expect(markup).toContain("This documentation does not measure live provider availability");
    expect(markup).toContain("Provider availability can vary");
    expect(markup).toContain("documented plan entitlements, not a live availability guarantee");
    expect(markup).not.toContain("live-search example");
    expect(markup).not.toMatch(/(?:search|watchlists?|digests?|reports?|share links?|exports?|checkout|email) (?:is|are) available/i);
    expect(markup).not.toContain("Available today");
    expect(markup).not.toContain("Public competitor ad search from a website");
  });

  it("gives /docs an in-page table of contents that jumps to each block — distinct from /help", async () => {
    const { default: DocsRoute } = await import("~/routes/docs");
    const docsMarkup = renderToStaticMarkup(createElement(DocsRoute));

    // TOC nav with jump links whose targets match the block ids.
    expect(docsMarkup).toContain("f9-doc-toc");
    for (const id of [
      "first-search",
      "proof-labels",
      "troubleshoot",
      "plan-boundaries",
      "ai-agents",
      "coverage-trust",
      "key-docs",
    ]) {
      expect(docsMarkup).toContain(`href="#${id}"`);
      expect(docsMarkup).toContain(`id="${id}"`);
    }

    const { default: HelpRoute } = await import("~/routes/help");
    const helpMarkup = renderToStaticMarkup(createElement(HelpRoute));
    expect(helpMarkup).not.toContain("f9-doc-toc");
  });

  it("renders API docs with customer-facing boundaries and write-key requirements", async () => {
    const { default: ApiDocsRoute } = await import("~/routes/api.docs");
    const markup = renderToStaticMarkup(createElement(ApiDocsRoute));

    expect(markup).toContain("Account actions");
    expect(markup).toContain("Developer access");
    expect(markup).toContain("Read-only access is on Free and Scout. Writes and exports are on Starter+");
    expect(markup).toContain("Connected tools");
    expect(markup).toContain("Compatible tools connect with the same bearer token");
    expect(markup).toContain("POST /api/mcp");
    expect(markup).toContain("tools/list");
    expect(markup).toContain("Use a write-enabled key only when the tool should run approved account actions");
    expect(markup).toContain("Requires a write-enabled customer API key (Starter+ to create; agent actions on Agency)");
    expect(markup).toContain("any active customer API key");
    expect(markup).toContain("Tool tiers");
    expect(markup).toContain("list_web_mentions");
    expect(markup).toContain("create_watchlist");
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
    const { default: PrivacyRoute } = await import("~/routes/privacy");
    const { default: TrustRoute } = await import("~/routes/trust");
    const { default: PresenceBotInfoRoute } = await import("~/routes/bots.presence");
    const helpMarkup = renderToStaticMarkup(createElement(HelpRoute));
    const privacyMarkup = renderToStaticMarkup(createElement(PrivacyRoute));
    const trustMarkup = renderToStaticMarkup(createElement(TrustRoute));
    const presenceBotMarkup = renderToStaticMarkup(createElement(PresenceBotInfoRoute));

    expect(helpMarkup).toContain("Paid customer support paths");
    expect(helpMarkup).toContain("Billing changes and cancellation");
    expect(helpMarkup).toContain("Security and deletion requests");
    expect(trustMarkup).toContain("Connected tools also do not perform");
    expect(trustMarkup).toContain("secret-bearing integration setup");
    expect(trustMarkup).toContain("customer API key creation, rotation, and revocation");
    expect(trustMarkup).toContain("broad public write APIs");
    expect(trustMarkup).toContain("Cloudflare-managed storage");
    expect(trustMarkup).toContain("configured for hosting");
    expect(trustMarkup).toContain("configured for checkout");
    expect(trustMarkup).toContain("provider-dependent");
    expect(trustMarkup).toContain("External services and providers");
    expect(trustMarkup).toContain("Site Rep provides the assistant on anonymous public pages");
    expect(trustMarkup).toContain('href="https://siterep.net/privacy"');
    expect(trustMarkup).toContain('href="https://siterep.net/trust"');
    expect(trustMarkup).not.toContain("Subprocessors and providers");
    expect(privacyMarkup).toContain("Public pages include a Site Rep assistant");
    expect(privacyMarkup).toContain("any name, email, or follow-up details you choose to submit");
    expect(privacyMarkup).toContain('href="https://siterep.net/privacy"');
    expect(privacyMarkup).toContain('href="https://siterep.net/trust"');
    expect(privacyMarkup).toContain("Chrome extension");
    expect(privacyMarkup).toContain("activeTab");
    expect(privacyMarkup).toContain("reads the current tab&#x27;s URL locally");
    expect(privacyMarkup).toContain("does not persist the current URL or domain");
    expect(privacyMarkup).toContain("service providers needed to operate the selected action");
    expect(privacyMarkup).toContain("We do not sell this data");
    expect(privacyMarkup).toContain("Limited Use requirements");
    expect(trustMarkup).not.toMatch(/Dodo Payments: checkout/);
    expect(trustMarkup).toContain("Backup validation and restore drills");
    expect(trustMarkup).toContain("remain owner-operated until recorded as verified");
    expect(trustMarkup).not.toContain("validates the D1 backup scripts");
    expect(trustMarkup).not.toContain("automated R2 backup scheduling");
    expect(trustMarkup).toContain("does not currently claim");
    expect(trustMarkup).not.toContain("SOC 2 compliant");
    expect(trustMarkup).not.toContain("Weekly D1 exports upload to R2");
    expect(helpMarkup).not.toContain("hooks.slack.com/services/");
    expect(trustMarkup).not.toContain("DODO_API_KEY");
    expect(privacyMarkup).not.toMatch(/processor|subprocessor|retention window|DPA|consent/i);
    expect(presenceBotMarkup).toContain("support@0509.io");
    expect(presenceBotMarkup).not.toContain("support@0509.in");
  });
});

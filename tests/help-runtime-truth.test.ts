import { readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SUPPORTED_COUNTRIES } from "~/lib/countries";
import { getPlanEntitlements } from "~/lib/plan-entitlements";

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

// Whitespace in JSX text is preserved verbatim by renderToStaticMarkup, so
// buyer-copy assertions read the flattened text instead of raw markup: a
// re-wrapped paragraph is not a behaviour change and must not fail the gate.
function visibleText(markup: string): string {
  return markup
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// The buyer-evaluation contract (backlog 5428b11a0c): a visitor deciding
// whether to pay lands on /help with three questions the support runbook
// never answered — what it costs, what "verified" means, and what is actually
// tracked. Each assertion below is one of those answers.
describe("customer help buyer-evaluation answers", () => {
  it("answers what is tracked with the live competitor, country, and placement catalogs", async () => {
    const { default: HelpRoute } = await import("~/routes/help");
    const text = visibleText(renderToStaticMarkup(createElement(HelpRoute)));

    expect(text).toContain("Which competitors, categories, and countries are tracked?");
    // Watchlist limits are read from the entitlement catalog, never retyped.
    for (const [plan, label] of [
      ["free", "Free"],
      ["scout", "Scout"],
      ["starter", "Starter"],
      ["agency", "Agency"],
    ] as const) {
      expect(text).toContain(`${getPlanEntitlements(plan).watchlists} on ${label}`);
    }
    expect(text).toContain(`narrowed to ${SUPPORTED_COUNTRIES.length} specific ones`);
    expect(text).toContain("Facebook, Instagram, Audience Network, and Messenger");
    expect(text).toContain("no industry taxonomy and no category gate");
    expect(text).toContain(
      "Automated X, Reddit, LinkedIn, YouTube, TikTok, Google, or Pinterest ingestion is not live.",
    );
    expect(text).toContain(
      "Spend, reach, impressions, and ROAS are never inferred from public evidence.",
    );
  });

  it("defines verified as an evidence-trail claim, not a quality claim", async () => {
    const { default: HelpRoute } = await import("~/routes/help");
    const text = visibleText(renderToStaticMarkup(createElement(HelpRoute)));

    expect(text).toContain("Verified is a claim about the evidence trail");
    expect(text).toContain("Verified ad match");
    expect(text).toContain("resolves to the competitor domain you searched");
    expect(text).toContain("An ad that merely mentions the brand name in its text does not qualify.");
    expect(text).toContain("A stored screenshot, page record, or source link is attached");
    expect(text).toContain("No evidence is not proof that a competitor has no active ads");
  });

  it("names what each plan costs and what that plan actually buys", async () => {
    const { default: HelpRoute } = await import("~/routes/help");
    const text = visibleText(renderToStaticMarkup(createElement(HelpRoute)));

    expect(text).toContain("What does it cost?");
    expect(text).toContain("Free costs nothing and never asks for a card");
    for (const plan of ["scout", "starter", "agency"] as const) {
      const entitlements = getPlanEntitlements(plan);
      const name = plan.charAt(0).toUpperCase() + plan.slice(1);
      // Before the localized preview resolves, the fallback still tells the
      // buyer where the number comes from instead of inventing one.
      expect(text).toContain(`${name} — price loads in your local currency`);
      expect(text).toContain(`${entitlements.watchlists} competitors`);
      expect(text).toContain(
        `${entitlements.includedEvidenceChecksPerMonth.toLocaleString("en-US")} proof captures a month`,
      );
      expect(text).toContain(`${entitlements.collections} Collections`);
    }
    expect(text).toContain("annual billing is offered as 4 months free");
  });

  it("links the pricing section and never hardcodes a checkout amount", async () => {
    const source = readFileSync("app/routes/help.tsx", "utf8");
    const { default: HelpRoute } = await import("~/routes/help");
    const markup = renderToStaticMarkup(createElement(HelpRoute));

    expect(markup).toContain('href="/#pricing"');
    expect(markup).toContain('href="/search"');
    expect(markup).toContain('href="/#demo"');
    // Dodo localizes every amount at checkout: a currency literal in this
    // route would be a price the buyer may never be charged.
    expect(source).not.toMatch(/[$£€₹]\s?\d/);
  });

  it("keeps the support runbook reachable below the buyer answers", async () => {
    const { default: HelpRoute } = await import("~/routes/help");
    const markup = renderToStaticMarkup(createElement(HelpRoute));
    const text = visibleText(markup);

    // Buyer questions come first; the runbook still exists for customers.
    const costIndex = text.indexOf("What does it cost?");
    const supportIndex = text.indexOf("Paid customer support paths");
    expect(costIndex).toBeGreaterThan(-1);
    expect(supportIndex).toBeGreaterThan(costIndex);
    expect(text).toContain("Delivery setup");
    expect(text).toContain("Cancellation and deletion");
  });
});

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dedicated route-render surface for the /auth/signup WebPage JSON-LD and the
// truthfulness of the story column's plan promises. Markup-only: the mock
// fixture is the anonymous idle shell (no session, no link sent), and nothing
// here exercises magic-link/OAuth/Better Auth logic.

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// The loader's anonymous return: signed-out visitor on the signup shell.
const signupLoaderData = {
  redirectTo: "/app#setup-checklist",
  prefillEmail: "",
  linkSent: false,
};

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useLoaderData: vi.fn().mockReturnValue(signupLoaderData),
      useActionData: vi.fn().mockReturnValue(null),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function parseSingleLdJson(markup: string): Record<string, unknown> {
  const match = markup.match(/type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match?.[1]) {
    throw new Error("No application/ld+json block found in markup");
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("/auth/signup WebPage JSON-LD", () => {
  it("renders exactly one truthful WebPage JSON-LD aligned with the signup meta head", async () => {
    const { default: SignupRoute, meta } = await import("~/routes/auth.signup");
    const markup = renderToStaticMarkup(createElement(SignupRoute));

    // Sanity: the signup shell actually rendered.
    expect(markup).toContain("Send setup link");

    const ldJsonTags = markup.match(/type="application\/ld\+json"/g) ?? [];
    expect(ldJsonTags).toHaveLength(1);

    const ldJson = parseSingleLdJson(markup);
    expect(ldJson["@context"]).toBe("https://schema.org");
    expect(ldJson["@type"]).toBe("WebPage");
    expect(ldJson.name).toBe("Create account | Five to Nine");
    expect(ldJson.url).toBe("https://0509.io/auth/signup");
    expect(ldJson.isPartOf).toEqual({
      "@type": "WebSite",
      name: "Five to Nine",
      url: "https://0509.io",
    });

    // Same strings as the document head (publicSeoMeta title/description).
    const head = (meta as unknown as () => Array<{ title?: string; name?: string; content?: string }>)();
    const title = head.find((entry) => "title" in entry)?.title ?? "";
    const description = head.find((entry) => entry.name === "description")?.content ?? "";
    expect(ldJson.name).toBe(title);
    expect(ldJson.description).toBe(description);
  });

  it("asserts no unsupported schema types or invented claims in the JSON-LD", async () => {
    const { default: SignupRoute } = await import("~/routes/auth.signup");
    const markup = renderToStaticMarkup(createElement(SignupRoute));
    const ldJson = parseSingleLdJson(markup);
    const serialized = JSON.stringify(ldJson);

    // The shell page claims no session state, link delivery, or auth options —
    // the WebPage payload must not either.
    for (const unsupported of [
      "AggregateRating",
      "Product",
      "Offer",
      "Review",
      "Rating",
      "FAQPage",
      "ItemList",
      "SearchAction",
    ]) {
      expect(serialized).not.toContain(`"@type":"${unsupported}"`);
    }
    expect(serialized).not.toMatch(/price|offerCount|ratingValue|session|magic|oauth|passkey/i);
    expect(serialized).not.toMatch(/[$₹€£]\s?\d/);
    expect(Object.keys(ldJson)).not.toContain("mainEntity");
  });
});

describe("/auth/signup story column plan promises", () => {
  it("names the free weekly watch and paid-plan additions without inventing entitlements", async () => {
    const { default: SignupRoute } = await import("~/routes/auth.signup");
    const markup = renderToStaticMarkup(createElement(SignupRoute));

    // Free weekly watch: one competitor, activation scan, weekly check, weekly
    // email brief, no card — matches the plan-entitlements free catalog.
    expect(markup).toContain("Free weekly watch");
    expect(markup).toContain("Your free account watches one competitor");
    expect(markup).toContain("an activation scan when you add it");
    expect(markup).toContain("a weekly check with");
    expect(markup).toContain("weekly email brief");
    expect(markup).toContain("No card needed");

    // Paid cadence: Scout every 6, Starter every 3, and the Agency top-25 /
    // rest-of-6 split disclosed exactly as the pricing surface states it.
    expect(markup).toContain("Scout every 6, Starter every 3");
    expect(markup).toContain("top 25");
    expect(markup).toContain("the rest every 6");
    expect(markup).not.toContain("Starter and Agency every 3");

    // Collections + exports + daily briefs gate to the plans that own them.
    expect(markup).toContain("add collections");
    expect(markup).toContain("exports and daily briefs join on Starter and Agency");

    // Magic-link next step and brief schedule are plain-words and plan-true.
    expect(markup).toContain("the setup link arrives by email and verifies your work address");
    expect(markup).toContain("weekly on free and Scout, daily and weekly on Starter and Agency");
    expect(markup).toContain("pause or remove a watchlist any time");
  });
});

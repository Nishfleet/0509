import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dedicated route-render surface for the /auth/login WebPage JSON-LD.
// Markup-only: the mock fixture is the anonymous idle shell (no session, no
// link sent), and nothing here exercises magic-link/OAuth/Better Auth logic.

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// The loader's anonymous return: signed-out visitor on the login shell.
const loginLoaderData = {
  redirectTo: "/app",
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
      useLoaderData: vi.fn().mockReturnValue(loginLoaderData),
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

describe("/auth/login WebPage JSON-LD", () => {
  it("renders exactly one truthful WebPage JSON-LD aligned with the login meta head", async () => {
    const { default: LoginRoute, meta } = await import("~/routes/auth.login");
    const markup = renderToStaticMarkup(createElement(LoginRoute));

    // Sanity: the login shell actually rendered.
    expect(markup).toContain("Get a secure sign-in link");

    const ldJsonTags = markup.match(/type="application\/ld\+json"/g) ?? [];
    expect(ldJsonTags).toHaveLength(1);

    const ldJson = parseSingleLdJson(markup);
    expect(ldJson["@context"]).toBe("https://schema.org");
    expect(ldJson["@type"]).toBe("WebPage");
    expect(ldJson.name).toBe("Sign in | Five to Nine");
    expect(ldJson.url).toBe("https://0509.io/auth/login");
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
    const { default: LoginRoute } = await import("~/routes/auth.login");
    const markup = renderToStaticMarkup(createElement(LoginRoute));
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

import { readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publicSeoMeta } from "~/lib/seo";

// Dedicated route-render test for the /auth/login shell WebPage JSON-LD.
// Markup only: the route's loader/action (magic-link send, redirects, OAuth)
// is untouched and never exercised here.

const LOGIN_TITLE = "Sign in | Five to Nine";
const LOGIN_DESCRIPTION =
  "Sign in to access saved competitors, alerts, reports, and useful ad examples in Five to Nine.";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// The anonymous idle login loader return: no error, no link sent, no OAuth
// providers, no passkeys — the plain sign-in form shell.
const loginLoaderData = {
  redirectTo: "/app",
  prefillEmail: "",
  linkSent: false,
};

async function renderLogin() {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useLoaderData: vi.fn().mockReturnValue(loginLoaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });

  const { default: LoginRoute } = await import("~/routes/auth.login");
  return renderToStaticMarkup(createElement(LoginRoute));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/auth/login WebPage JSON-LD", () => {
  it("renders exactly one application/ld+json WebPage aligned with the head meta", async () => {
    const markup = await renderLogin();

    const scriptTags = markup.match(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/g,
    );
    expect(scriptTags).toHaveLength(1);

    const jsonLd = JSON.parse(
      scriptTags![0]!
        .replace(/^<script type="application\/ld\+json">/, "")
        .replace(/<\/script>$/, ""),
    );

    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("WebPage");

    // Same strings the document head already carries via publicSeoMeta.
    const headMeta = publicSeoMeta({
      title: LOGIN_TITLE,
      description: LOGIN_DESCRIPTION,
      pathname: "/auth/login",
    });
    const headTitle = headMeta[0] as { title: string };
    const headDescription = headMeta.find(
      (entry) => (entry as { name?: string }).name === "description",
    ) as { content: string };
    expect(jsonLd.name).toBe(headTitle.title);
    expect(jsonLd.description).toBe(headDescription.content);
    expect(jsonLd.url).toBe("https://0509.io/auth/login");
    expect(jsonLd.isPartOf["@type"]).toBe("WebSite");
    expect(jsonLd.publisher["@type"]).toBe("Organization");
  });

  it("emits only the truthful shell markup — no account, session, price, or rating claims", async () => {
    const markup = await renderLogin();

    // The plain sign-in form still renders exactly as before (markup-only).
    expect(markup).toContain("Get a secure sign-in link.");
    expect(markup).toContain('name="email"');
    expect(markup).toContain("Send sign-in link");
    expect(markup).not.toContain("Sending…");

    const scriptTags = markup.match(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/g,
    );
    expect(scriptTags).toHaveLength(1);
    const serialized = scriptTags![0]!.replace(
      /^<script type="application\/ld\+json">/,
      "",
    ).replace(/<\/script>$/, "");
    for (const unsupported of [
      "Product",
      "Offer",
      "AggregateRating",
      "ItemList",
      "SearchResultsPage",
      "Service",
    ]) {
      expect(serialized).not.toContain(`"@type": "${unsupported}"`);
    }
    expect(serialized).not.toMatch(/price|ratingValue|resultCount|numberOfItems|guarantee|rank/i);
    expect(serialized).not.toMatch(/[$₹€£]\s?\d/);
  });

  it("wires the script from the shared description const and head title", () => {
    const source = readFileSync("app/routes/auth.login.tsx", "utf8");

    // The same const feeds both the document head and the JSON-LD, and the
    // JSON-LD name is the same literal the head title uses.
    expect(source.match(/description: loginDescription/g)).toHaveLength(2);
    expect(source).toContain(`title: "${LOGIN_TITLE}"`);
    expect(source).toContain(`name: "${LOGIN_TITLE}"`);
    expect(source).toContain("webPageJsonLd(");
    expect(source).toContain('pathname: "/auth/login"');
  });
});

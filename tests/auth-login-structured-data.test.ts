import { readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { webPageJsonLd } from "~/lib/seo";

// Dogfood fce4fa3c00f1: the /auth/login shell used to render zero
// application/ld+json blocks. This file pins one truthful schema.org WebPage
// on the login markup — and only the markup. The loader, action, magic-link
// send, OAuth, and Better Auth behavior are untouched and untested here.
//
// These two strings must stay byte-for-byte identical to the strings the route
// passes to `publicSeoMeta` in its head; the deep-equal against
// `webPageJsonLd(...)` below fails if they drift.
const LOGIN_TITLE = "Sign in | Five to Nine";
const LOGIN_DESCRIPTION =
  "Sign in to access saved competitors, alerts, reports, and useful ad examples in Five to Nine.";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// The loader's idle anonymous login payload (no sent/error/oauth extras).
const loginLoaderData = {
  redirectTo: "/app",
  prefillEmail: "",
  linkSent: false,
};

async function renderLoginRoute() {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useLoaderData: vi.fn().mockReturnValue(loginLoaderData),
      // AuthForm derives "Sending…" from navigation.state; idle keeps the
      // plain "Send sign-in link" label.
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });

  const { default: LoginRoute } = await import("~/routes/auth.login");
  return renderToStaticMarkup(createElement(LoginRoute));
}

function jsonLdBlocks(markup: string) {
  const blocks: Array<{ type: string; body: string }> = [];
  for (const match of markup.matchAll(/<script\s+type="([^"]+)">([\s\S]*?)<\/script>/g)) {
    blocks.push({ type: match[1]!, body: match[2]! });
  }
  return blocks;
}

function collectTypes(value: unknown, into: Set<string>) {
  if (Array.isArray(value)) {
    for (const entry of value) collectTypes(entry, into);
    return;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record["@type"] === "string") into.add(record["@type"]);
    for (const entry of Object.values(record)) collectTypes(entry, into);
  }
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/auth/login structured data", () => {
  it("emits exactly one WebPage JSON-LD block aligned with the head meta on the login shell", async () => {
    const markup = await renderLoginRoute();

    // The login shell still renders — the script addition is markup only and
    // must not disturb the form.
    expect(markup).toContain("f9-auth-page");
    expect(markup).toContain("Send sign-in link");

    const blocks = jsonLdBlocks(markup).filter(
      (block) => block.type === "application/ld+json",
    );
    expect(blocks).toHaveLength(1);

    const parsed = JSON.parse(blocks[0]!.body) as Record<string, unknown>;
    expect(parsed).toEqual(
      webPageJsonLd({
        name: LOGIN_TITLE,
        description: LOGIN_DESCRIPTION,
        pathname: "/auth/login",
      }),
    );
    expect(parsed["@type"]).toBe("WebPage");
    expect(parsed.name).toBe(LOGIN_TITLE);
    expect(parsed.description).toBe(LOGIN_DESCRIPTION);
    expect(parsed.url).toBe("https://0509.io/auth/login");
  });

  it("claims no unsupported schema types, prices, or auth internals", async () => {
    const markup = await renderLoginRoute();
    const parsed = JSON.parse(
      jsonLdBlocks(markup).find((block) => block.type === "application/ld+json")!.body,
    ) as Record<string, unknown>;

    // Only the entity the page is (WebPage) plus the site and publisher
    // scoping it belongs to.
    const types = new Set<string>();
    collectTypes(parsed, types);
    expect([...types].sort()).toEqual(["Organization", "WebPage", "WebSite"]);

    // Name, description, and URL only — no price, rating, or auth internals.
    expect(Object.keys(parsed).sort()).toEqual([
      "@context",
      "@type",
      "description",
      "isPartOf",
      "name",
      "publisher",
      "url",
    ]);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toMatch(/price/i);
    expect(serialized).not.toMatch(/[$₹€£]\s?\d/);
    expect(serialized).not.toMatch(/\b(aggregateRating|ratingValue|review)\b/i);
    expect(serialized).not.toMatch(/token|secret|session/i);
  });

  it("wires the JSON-LD through the shared helpers on the route", async () => {
    const source = readFileSync("app/routes/auth.login.tsx", "utf8");
    expect(source).toContain("jsonLdScriptProps(");
    expect(source).toContain("webPageJsonLd({");
    expect(source).toContain(`name: "${LOGIN_TITLE}"`);
    expect(source).toContain("pathname: \"/auth/login\"");
  });
});

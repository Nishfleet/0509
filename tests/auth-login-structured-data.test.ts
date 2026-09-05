import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dedicated route-render test for the /auth/login WebPage JSON-LD. Markup
// only — it renders the login shell with mocked router primitives and never
// touches the loader/action, so session, magic-link, and Better Auth behavior
// stay out of scope.

const LOGIN_TITLE = "Sign in | Five to Nine";
const LOGIN_DESCRIPTION =
  "Sign in to access saved competitors, alerts, reports, and useful ad examples in Five to Nine.";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

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
      Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useLoaderData: vi.fn().mockReturnValue(loginLoaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });

  const { default: LoginRoute } = await import("~/routes/auth.login");
  return renderToStaticMarkup(createElement(LoginRoute));
}

/** All JSON-LD blocks rendered on the page, parsed back into objects. */
function parsedJsonLdBlocks(markup: string): unknown[] {
  const scriptPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  const blocks: unknown[] = [];
  for (const match of markup.matchAll(scriptPattern)) {
    blocks.push(JSON.parse(match[1] ?? ""));
  }
  return blocks;
}

/** Every schema.org @type on the page, top-level and nested. */
function collectTypes(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTypes(item, into);
    }
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "@type" && typeof entry === "string") {
        into.push(entry);
      } else {
        collectTypes(entry, into);
      }
    }
  }
  return into;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/auth/login — truthful WebPage JSON-LD", () => {
  it("emits exactly one WebPage block matching the document head", async () => {
    const markup = await renderLogin();
    const blocks = parsedJsonLdBlocks(markup);

    expect(blocks).toHaveLength(1);
    const [webPage] = blocks as [Record<string, unknown>];

    expect(webPage["@context"]).toBe("https://schema.org");
    expect(webPage["@type"]).toBe("WebPage");
    // name/description/url mirror the publicSeoMeta document head exactly.
    expect(webPage.name).toBe(LOGIN_TITLE);
    expect(webPage.description).toBe(LOGIN_DESCRIPTION);
    expect(webPage.url).toBe("https://0509.io/auth/login");
    expect(webPage.isPartOf).toMatchObject({ "@type": "WebSite", name: "Five to Nine" });
    expect(webPage.publisher).toMatchObject({ "@type": "Organization", name: "Five to Nine" });
  });

  it("uses the same strings as the page meta function", async () => {
    const markup = await renderLogin();
    const [webPage] = parsedJsonLdBlocks(markup) as [Record<string, unknown>];

    const { meta } = await import("~/routes/auth.login");
    const serializedHead = JSON.stringify((meta as () => unknown)());

    // The head title/description appear verbatim in the JSON-LD block.
    expect(serializedHead).toContain(LOGIN_TITLE);
    expect(serializedHead).toContain(LOGIN_DESCRIPTION);
    expect(webPage.name).toBe(LOGIN_TITLE);
    expect(webPage.description).toBe(LOGIN_DESCRIPTION);
  });

  it("claims no unsupported types, prices, or session behavior", async () => {
    const markup = await renderLogin();
    const blocks = parsedJsonLdBlocks(markup);

    // WebPage is the only top-level entity; WebSite and Organization appear
    // only as the isPartOf/publisher scaffolding every WebPage block has.
    expect(collectTypes(blocks)).toEqual(["WebPage", "WebSite", "Organization"]);

    const serialized = JSON.stringify(blocks);
    expect(serialized).not.toMatch(/[$₹€£]\s?\d/);
    // Structured data says nothing about link delivery, passwords, or OAuth —
    // the visible shell does not state those as page facts.
    expect(serialized).not.toMatch(/magic|password|oauth|passkey/i);
  });
});

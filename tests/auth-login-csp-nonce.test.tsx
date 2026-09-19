import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jsonLdScriptProps } from "../app/lib/seo";

// Issue #3379: the /auth/login WebPage JSON-LD is an inline <script> served
// under the per-request nonce CSP (/login and /auth/login are NOT edge-cached,
// so they ship `script-src … 'nonce-<per-request>'` — no hashes). These tests
// pin the two halves of the fix: jsonLdScriptProps accepts an optional nonce,
// and LoginRoute threads the root loader's per-request cspNonce into it.
// Markup-only: the loader fixture is the anonymous idle shell and no auth
// logic runs.

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const loginLoaderData = {
  redirectTo: "/app",
  prefillEmail: "",
  linkSent: false,
};

const ROOT_CSP_NONCE = "test-nonce-3379";

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useLoaderData: vi.fn().mockReturnValue(loginLoaderData),
      useRouteLoaderData: vi
        .fn()
        .mockImplementation((routeId: string) =>
          routeId === "root" ? { cspNonce: ROOT_CSP_NONCE } : undefined,
        ),
    };
  });
  vi.doMock("~/root", () => ({
    // Same contract as the real cspNonceForRender (it is pinned separately by
    // tests/root-csp-nonce-hydration.test.tsx): the server render gets the
    // nonce, the client pass gets "" because browsers hide a parsed nonce.
    cspNonceForRender: (nonce: string | undefined, isServerRender: boolean) =>
      isServerRender ? nonce : "",
  }));
  vi.doMock("~/components/auth-form", () => ({
    AuthForm: () => null,
  }));
  vi.doMock("~/components/brand-wordmark", () => ({
    BrandWordmark: () => null,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("jsonLdScriptProps nonce option", () => {
  it("spreads the nonce into the script props only when defined", () => {
    const withNonce = jsonLdScriptProps({ "@type": "WebPage" }, { nonce: "n-1" });
    expect((withNonce as { nonce?: string }).nonce).toBe("n-1");

    const without = jsonLdScriptProps({ "@type": "WebPage" });
    expect("nonce" in without).toBe(false);

    // "" is defined — the client hydration pass deliberately renders the
    // empty attribute (root-csp-nonce-hydration contract).
    const empty = jsonLdScriptProps({ "@type": "WebPage" }, { nonce: "" });
    expect((empty as { nonce?: string }).nonce).toBe("");
  });
});

describe("/auth/login JSON-LD CSP nonce", () => {
  it("stamps the root loader's per-request cspNonce onto the ld+json script", async () => {
    const { default: LoginRoute } = await import("../app/routes/auth.login");
    const markup = renderToStaticMarkup(createElement(LoginRoute));
    const ldJsonTag = /<script[^>]*type="application\/ld\+json"[^>]*>/u.exec(markup)?.[0];
    expect(ldJsonTag, "the WebPage JSON-LD block must be rendered").toBeTruthy();
    expect(ldJsonTag).toContain(`nonce="${ROOT_CSP_NONCE}"`);
  });
});

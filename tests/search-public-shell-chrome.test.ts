import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = {
  children?: ReactNode;
  to?: string;
  prefetch?: unknown;
} & Record<string, unknown>;

async function mockRouter() {
  return vi.doMock("react-router", async () => {
    const actual =
      await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: ({ children, to, prefetch, ...props }: MockLinkProps) =>
        React.createElement(
          "a",
          { ...props, href: typeof to === "string" ? to : "" },
          children,
        ),
      NavLink: ({
        children,
        to,
        end,
        prefetch,
        className,
        ...props
      }: MockLinkProps & { end?: boolean; className?: unknown }) =>
        React.createElement(
          "a",
          { ...props, href: typeof to === "string" ? to : "" },
          children,
        ),
      useLocation: () => ({
        pathname: "/search",
        search: "?q=nike&country=all",
        hash: "",
        state: null,
        key: "default",
      }),
      useNavigation: () => ({ state: "idle", location: undefined }),
      useRouteLoaderData: () => ({ session: null }),
    };
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/search public shell chrome", () => {
  it("exposes Sign up, Compare and /pricing in the persistent rail, not only in result CTAs", async () => {
    await mockRouter();
    const { DashboardShell } = await import("~/components/dashboard-shell");

    const markup = renderToStaticMarkup(
      createElement(
        DashboardShell,
        {
          accountDetail: "Find competitor ads",
          accountLabel: "Search",
          accountTitle: "Five to Nine",
          isPublic: true,
          pageClassName: "f9-find-page",
        },
        createElement("p", null, "Results"),
      ),
    );

    // Scope to the public rail so the assertion cannot be satisfied by a
    // result-body CTA or a one-off hardcode in search.tsx.
    const railMatch = markup.match(
      /<aside[^>]*class="[^"]*f9-cursor-rail[^"]*"[^>]*>[\s\S]*?<\/aside>/,
    );
    expect(railMatch).not.toBeNull();
    const rail = railMatch![0];

    expect(rail).toMatch(/href="\/auth\/signup"/);
    expect(rail).toMatch(/href="\/compare"/);
    expect(rail).toMatch(/href="\/pricing"/);
    expect(rail).not.toMatch(/href="\/#pricing"/);

    const links = Array.from(rail.matchAll(/href="([^"]*)"/g)).map(
      (match) => match[1],
    );
    expect(links).toContain("/auth/signup");
    expect(links).toContain("/compare");
    expect(links).toContain("/pricing");
    expect(links).not.toContain("/#pricing");

    // Sign up lives in the footer; Compare and Pricing ride the nav.
    const navMatch = rail.match(/<nav[^>]*aria-label="Search"[^>]*>[\s\S]*?<\/nav>/);
    expect(navMatch).not.toBeNull();
    const nav = navMatch![0];
    expect(nav).toMatch(/href="\/compare"/);
    expect(nav).toMatch(/href="\/pricing"/);
    expect(nav).not.toMatch(/href="\/#pricing"/);

    const footerMatch = rail.match(/class="f9-dash-rail-footer"[\s\S]*?<\/div>/);
    expect(footerMatch).not.toBeNull();
    const footer = footerMatch![0];
    expect(footer).toMatch(/href="\/auth\/signup"/);
  });
});

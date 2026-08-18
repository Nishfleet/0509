// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DashboardShell } from "~/components/dashboard-shell";

const appCss = readFileSync("app/app.css", "utf8");

function styleRulesFor(selectorFragment: string) {
  const cssWithoutComments = appCss.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...cssWithoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.includes(selectorFragment))
    .map(([, selector, body]) => ({ selector, body }));
}

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) {
    const currentRoot = root;
    await act(async () => currentRoot.unmount());
  }
  root = null;
  container = null;
  document.body.replaceChildren();
});

async function renderShell(
  initialPath: string,
  options: {
    isPublic?: boolean;
    showPresenceNav?: boolean;
    strict?: boolean;
  } = {},
) {
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: () =>
        createElement(DashboardShell, {
          accountLabel: "Workspace",
          accountTitle: "Five to Nine",
          accountDetail: "Starter plan",
          isPublic: options.isPublic,
          showPresenceNav: options.showPresenceNav,
          children: createElement("p", null, "Body content"),
        }),
    },
  ]);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const currentRoot = root;
  await act(async () => {
    const shell = createElement(Stub, { initialEntries: [initialPath] });
    currentRoot.render(options.strict ? createElement(StrictMode, null, shell) : shell);
  });
  return container;
}

describe("DashboardShell accessibility (WP-43)", () => {
  it("renders a skip link as the first focusable element, targeting the main content", async () => {
    const view = await renderShell("/app/watchlists");

    const shell = view.querySelector("main");
    expect(shell).not.toBeNull();
    const firstFocusable = shell?.querySelector(
      "a[href], button, input, select, textarea, [tabindex]",
    );
    expect(firstFocusable?.classList.contains("f9-skip-link")).toBe(true);
    expect(firstFocusable?.getAttribute("href")).toBe("#f9-main-content");
    expect(firstFocusable?.textContent).toBe("Skip to content");

    const target = view.querySelector("#f9-main-content");
    expect(target).not.toBeNull();
    expect(target?.classList.contains("f9-cursor-main")).toBe(true);
    // tabindex=-1 so the skip target can receive programmatic focus.
    expect(target?.getAttribute("tabindex")).toBe("-1");
  });

  it("marks the active nav link with aria-current=page", async () => {
    const view = await renderShell("/app/watchlists");

    const current = Array.from(view.querySelectorAll('a[aria-current="page"]'));
    expect(current.length).toBeGreaterThan(0);
    for (const link of current) {
      expect(link.getAttribute("href")).toBe("/app/watchlists");
    }
  });

  it("renders one mobile anchor bar without instructional swipe copy", async () => {
    const view = await renderShell("/app/watchlists");
    const tabBar = view.querySelector('nav[aria-label="Workspace sections"]');

    expect(tabBar).not.toBeNull();
    expect(tabBar?.querySelector('[role="group"]')).toBeNull();
    expect(tabBar?.querySelectorAll("nav")).toHaveLength(0);
    expect(tabBar?.querySelectorAll("button")).toHaveLength(1);
    expect(tabBar?.querySelector("button")?.textContent).toBe("Sign out");
    expect(view.textContent).not.toContain("Swipe for more");
  });

  it("omits entitlement-only routes from the default mobile row", async () => {
    const view = await renderShell("/app");
    const mobile = view.querySelector('nav[aria-label="Workspace sections"]');
    expect(mobile?.textContent).not.toContain("Presence");
    expect(mobile?.textContent).not.toContain("Ops");
  });

  it("keeps the mobile row to the five destinations — member pages live inside them", async () => {
    const view = await renderShell("/app/presence", {
      showPresenceNav: true,
    });
    const mobile = view.querySelector('nav[aria-label="Workspace sections"]');
    // PR-5a: Presence is a member of Watch, not a strip peer; staff ops
    // left the customer shell entirely (G4).
    expect(mobile?.textContent).not.toContain("Presence");
    expect(mobile?.textContent).toContain("Watch");
    expect(mobile?.textContent).toContain("Settings");
    expect(mobile?.textContent).not.toContain("Ops");
  });

  it("does not expose authenticated workspace navigation on the public shell", async () => {
    const view = await renderShell("/search", { isPublic: true });
    expect(view.querySelector('nav[aria-label="Workspace sections"]')).toBeNull();
  });

  it("keeps public-shell destinations reachable exactly once — Help is a nav item, not a footer duplicate", async () => {
    const view = await renderShell("/search", { isPublic: true });

    const links = Array.from(view.querySelectorAll("a")).map((link) => ({
      href: link.getAttribute("href"),
      text: link.textContent?.trim() ?? "",
    }));
    const navLinks = links.filter(({ text }) => text !== "");

    // Every public destination is reachable exactly once: Home, Search,
    // Pricing and Help ride the icon rail; Docs and Sign in ride the footer.
    for (const href of ["/", "/search", "/#pricing", "/help", "/docs", "/auth/login"]) {
      expect(navLinks.filter((link) => link.href === href)).toHaveLength(1);
    }
  });

  it("does not announce or steal focus during a StrictMode initial mount", async () => {
    const view = await renderShell("/app/watchlists", { strict: true });

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(document.activeElement).toBe(document.body);
    expect(view.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("keeps the route focus target ringless and monochrome without weakening interactive focus", () => {
    expect(appCss).toMatch(
      /\.f9-cursor-main:focus,\s*\.f9-cursor-main:focus-visible\s*\{\s*outline:\s*none;/s,
    );
    expect(appCss).toMatch(
      /a:focus-visible,\s*button:focus-visible,[\s\S]*?\[tabindex\]:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--green-ink\);/,
    );
    expect(appCss).toMatch(
      /\.f9-cursor-main:focus-visible\s*\{\s*box-shadow:\s*inset 0 3px 0 var\(--ink\);/,
    );
    expect(appCss).toMatch(
      /\.f9-cursor-main:target\s*\{\s*box-shadow:\s*inset 0 3px 0 var\(--ink\);/,
    );
  });

  it("keeps shell progress out of the work's green budget", () => {
    const routeProgressRules = styleRulesFor(".f9-route-progress");
    expect(routeProgressRules.some(({ body }) => /background:\s*var\(--ink\);/.test(body)))
      .toBe(true);
    expect(routeProgressRules).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: expect.stringMatching(/--green|#0aa982|#16c47f/),
        }),
      ]),
    );
  });

  it("keeps the authenticated shell and page canvas fluid", () => {
    expect(appCss).toMatch(
      /\.f9-dash-page-app \.f9-cursor-shell\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;/,
    );
    expect(appCss).toMatch(
      /\.f9-dash-content\s*\{[\s\S]*?width:\s*100%;/,
    );
    expect(appCss).not.toMatch(
      /\.f9-dash-content\s*\{[^}]*max-width:\s*1120px;/s,
    );
    expect(appCss).toMatch(
      /@media \(min-width: 761px\)\s*\{\s*\.f9-dash-page-public\.f9-find-page \.f9-cursor-shell\s*\{[\s\S]*?grid-template-columns:\s*218px minmax\(0, 1fr\);[\s\S]*?width:\s*min\(100%, 1390px\);/,
    );
    expect(appCss).not.toMatch(
      /(?<!public)\.f9-find-page \.f9-cursor-shell\s*\{[^}]*width:\s*min\(100%, 1390px\);/s,
    );
  });

  it("draws mobile navigation as sentence-case text with one hairline active state", () => {
    expect(appCss).toContain(
      "/* === BL-042 mobile top navigation (landing language) === */",
    );
    expect(appCss).toMatch(
      /\.f9-dash-page-app \.f9-dash-mobile-nav\s*\{[\s\S]*?border-bottom:\s*1px solid var\(--wk-rule\);[\s\S]*?background:\s*var\(--bone\);/,
    );
    expect(appCss).toMatch(
      /\.f9-dash-page-app \.f9-dash-mobile-nav a,[\s\S]*?font-family:\s*var\(--f9-font\);[\s\S]*?text-transform:\s*none;/,
    );
    expect(appCss).toMatch(
      /\.f9-dash-page-app \.f9-dash-mobile-nav a\[aria-current="page"\]\s*\{[\s\S]*?border-bottom-color:\s*var\(--ink\);[\s\S]*?background:\s*none;/,
    );
  });
});

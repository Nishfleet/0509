import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, Outlet, StaticRouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { SignedInFrame, signedInNav } from "../../app/components/nav";
import routeConfig from "../../app/routes";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SIGNED_IN_PAGES = [
  "app/routes/app.home.tsx",
  "app/routes/app.competitors.tsx",
  "app/routes/app.competitor.tsx",
  "app/routes/app.alerts.tsx",
  "app/routes/app.settings.tsx",
];

const WITHOUT_NAV = [
  "app/root.tsx",
  "app/routes/login.tsx",
  "app/routes/privacy.tsx",
  "app/routes/onboarding.tsx",
  "app/routes/unmatched.tsx",
  "app/routes/s.$slug.tsx",
  "app/routes/design.brand-chips.tsx",
  "app/routes/settings.card.tsx",
];

interface RegistryEntry {
  path?: string;
  children?: readonly RegistryEntry[];
}

function registeredPaths(entries: readonly RegistryEntry[], parent = ""): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    const segment = entry.path ?? "";
    const href = segment.length === 0 || segment.includes("*") ? parent : joinPath(parent, segment);
    if (segment.length > 0 && !segment.includes("*")) paths.push(href);
    if (entry.children) paths.push(...registeredPaths(entry.children, href));
  }
  return paths;
}

function joinPath(parent: string, segment: string): string {
  if (parent.length === 0) return `/${segment}`;
  return `${parent}/${segment}`;
}

function page(title: string): ReactNode {
  return createElement(SignedInFrame, null, createElement("h1", null, title));
}

const frameRoutes = [
  { path: "/app", element: page("Home") },
  { path: "/app/competitors", element: page("Competitors") },
  { path: "/app/competitors/:entityId", element: page("Competitor") },
  { path: "/app/alerts", element: page("Alerts") },
  {
    path: "/app/settings",
    element: createElement(
      SignedInFrame,
      null,
      createElement("h1", null, "Settings"),
      createElement(Outlet),
    ),
    children: [{ path: "card", element: createElement("h2", null, "Card") }],
  },
];

function registryRoutes(entries: readonly RegistryEntry[]) {
  return entries.map((entry) => ({
    path: entry.path,
    children: entry.children ? registryRoutes(entry.children) : undefined,
    loader() {
      if (entry.path === "*") throw new Response(null, { status: 404 });
      return null;
    },
  }));
}

async function renderFrame(urlPath: string): Promise<{ status: number; html: string }> {
  const handler = createStaticHandler(frameRoutes);
  const context = await handler.query(new Request(`https://0509.io${urlPath}`));
  if (context instanceof Response) return { status: context.status, html: "" };
  const router = createStaticRouter(handler.dataRoutes, context);
  return {
    status: context.statusCode,
    html: renderToStaticMarkup(createElement(StaticRouterProvider, { router, context })),
  };
}

function navHtml(html: string): string {
  const start = html.indexOf("<nav");
  const end = html.indexOf("</nav>");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end + "</nav>".length);
}

function anchors(block: string): { href: string; current: boolean }[] {
  const tags = block.match(/<a\b[^>]*>/g) ?? [];
  return tags.map((tag) => {
    const href = /href="([^"]*)"/.exec(tag)?.[1] ?? "";
    return { href, current: tag.includes('aria-current="page"') };
  });
}

describe("signed-in nav", () => {
  it("links Home, Competitors, Alerts and Settings, and marks only the current one", async () => {
    const cases = [
      { path: "/app", heading: "Home", current: "/app" },
      { path: "/app/competitors", heading: "Competitors", current: "/app/competitors" },
      { path: "/app/competitors/loopwell", heading: "Competitor", current: "/app/competitors" },
      { path: "/app/alerts", heading: "Alerts", current: "/app/alerts" },
      { path: "/app/settings", heading: "Settings", current: "/app/settings" },
      { path: "/app/settings/card", heading: "Settings", current: "/app/settings" },
    ];

    for (const item of cases) {
      const rendered = await renderFrame(item.path);
      expect(rendered.status).toBe(200);
      expect(rendered.html).toContain(`>${item.heading}<`);
      expect(rendered.html.split("<nav").length - 1).toBe(1);
      const links = anchors(navHtml(rendered.html));
      expect(links.map((link) => link.href)).toEqual(signedInNav.map((entry) => entry.href));
      expect(links.filter((link) => link.current).map((link) => link.href)).toEqual([item.current]);
    }
  });

  it("reaches each linked surface in one step from Home, and a missing path is a 404", async () => {
    const home = await renderFrame("/app");
    const hrefs = anchors(navHtml(home.html)).map((link) => link.href);
    expect(hrefs).toEqual(["/app", "/app/competitors", "/app/alerts", "/app/settings"]);

    for (const href of hrefs) {
      const next = await renderFrame(href);
      expect(next.status).toBe(200);
      expect(anchors(navHtml(next.html)).some((link) => link.href === href && link.current)).toBe(true);
    }

    const registered = registeredPaths(routeConfig);
    for (const href of hrefs) expect(registered).toContain(href);

    const handler = createStaticHandler(registryRoutes(routeConfig));
    for (const href of hrefs) {
      const context = await handler.query(new Request(`https://0509.io${href}`));
      expect(context).not.toBeInstanceOf(Response);
      if (context instanceof Response) continue;
      expect(context.statusCode).toBe(200);
    }

    const missing = await handler.query(new Request("https://0509.io/app/not-a-surface"));
    if (missing instanceof Response) {
      expect(missing.status).toBe(404);
    } else {
      expect(missing.statusCode).toBe(404);
    }
  });

  it("is on the signed-in pages and absent from public routes and the card child", () => {
    for (const file of SIGNED_IN_PAGES) {
      expect(readFileSync(path.join(ROOT, file), "utf8")).toContain("SignedInFrame");
    }
    for (const file of WITHOUT_NAV) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toContain("SignedInFrame");
      expect(source).not.toContain("components/nav");
    }
    expect(readFileSync(path.join(ROOT, "app/routes.ts"), "utf8")).not.toContain("nav.tsx");
  });

  it("keeps the bottom tab bar from covering a saved toast", () => {
    const css = readFileSync(path.join(ROOT, "app/app.css"), "utf8");
    expect(css).toContain('nav[aria-label="App"]');
    expect(css).toContain("--offset-bottom: 92px");
    expect(css).toContain("--mobile-offset-bottom: 92px");
  });
});

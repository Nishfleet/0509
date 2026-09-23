import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, Outlet, StaticRouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { SignedInFrame, signedInNav } from "../../app/components/nav";
import routeConfig from "../../app/routes";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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
      const block = navHtml(rendered.html);
      const links = anchors(block);
      expect(links.map((link) => link.href)).toEqual(signedInNav.map((entry) => entry.href));
      expect(links.filter((link) => link.current).map((link) => link.href)).toEqual([item.current]);
      const tags = block.match(/<a\b[^>]*>/g) ?? [];
      const currentTag = tags.find((tag) => tag.includes('aria-current="page"'));
      expect(currentTag).toContain(" underline ");
      expect(tags.filter((tag) => !tag.includes('aria-current="page"')).every((tag) => tag.includes("no-underline"))).toBe(
        true,
      );
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
    const competitors = routeConfig.find((entry) => entry.path === "app/competitors");
    const detail = routeConfig.find((entry) => entry.path === "app/competitors/:entityId");
    const settings = routeConfig.find((entry) => entry.path === "app/settings");
    expect(competitors?.children).toBeUndefined();
    expect(detail?.path).toBe("app/competitors/:entityId");
    expect(settings?.children?.some((entry) => entry.path === "card")).toBe(true);

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

  it("is on every app.* route and absent from the other route modules", () => {
    const routeDir = path.join(ROOT, "app/routes");
    const routeFiles = readdirSync(routeDir).filter((name) => name.endsWith(".tsx"));
    const shellFiles = routeFiles.filter((name) => name.startsWith("app."));
    const bareFiles = routeFiles.filter((name) => !name.startsWith("app."));
    expect(shellFiles.length).toBeGreaterThan(0);
    expect(bareFiles.length).toBeGreaterThan(0);
    for (const name of shellFiles) {
      expect(readFileSync(path.join(routeDir, name), "utf8")).toContain("SignedInFrame");
    }
    for (const name of [...bareFiles, "root.tsx"]) {
      const file = name === "root.tsx" ? path.join(ROOT, "app/root.tsx") : path.join(routeDir, name);
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("SignedInFrame");
      expect(source).not.toContain("components/nav");
    }
    const routesDiff = execFileSync("git", ["diff", "origin/main", "--", "app/routes.ts"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(routesDiff).toBe("");
  });

  it("keeps the bottom tab bar from covering a saved toast", () => {
    const css = readFileSync(path.join(ROOT, "app/app.css"), "utf8");
    expect(css).toContain("nav[data-app-nav]");
    expect(css).toContain("--app-nav-clearance: 92px");
    expect(css).toContain("--offset-bottom: var(--app-nav-clearance)");
    expect(css).toContain("--mobile-offset-bottom: var(--app-nav-clearance)");
  });
});

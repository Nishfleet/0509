import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AppShell } from "../../app/components/app-shell";

function render(path: string): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(AppShell, null, createElement("main", null, "content")),
    ),
  );
}

function anchor(html: string, href: string): string {
  const segment = html.split("<a ").find((part) => part.includes(`href="${href}"`));
  if (!segment) return "";
  return segment.slice(0, segment.indexOf(">") + 1);
}

describe("the app shell", () => {
  it("draws the nav on a signed-in route and marks that place current", () => {
    const html = render("/app/alerts");
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('href="/app"');
    expect(html).toContain('href="/app/competitors"');
    expect(html).toContain('href="/app/alerts"');
    expect(html).toContain('href="/app/settings"');
    expect(html).toContain("content");
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(anchor(html, "/app/alerts")).toContain('aria-current="page"');
  });

  it("marks Home current at /app and only Home", () => {
    const html = render("/app");
    expect(anchor(html, "/app")).toContain('aria-current="page"');
    expect(anchor(html, "/app/competitors")).not.toContain('aria-current="page"');
  });

  it("marks Competitors current on a nested competitor route and not Home", () => {
    const html = render("/app/competitors/abc");
    expect(anchor(html, "/app/competitors")).toContain('aria-current="page"');
    expect(anchor(html, "/app")).not.toContain('aria-current="page"');
  });

  it("puts a skip link before the nav and names the content wrapper", () => {
    const html = render("/app");
    const skipAt = html.indexOf('href="#app-content"');
    const navAt = html.indexOf("<nav");
    expect(skipAt).toBeGreaterThan(-1);
    expect(navAt).toBeGreaterThan(skipAt);
    expect(html).toContain('id="app-content"');
    expect(html).toContain('tabindex="-1"');
    expect(anchor(html, "#app-content")).toContain("min-h-11");
    expect(anchor(html, "#app-content")).toContain("sr-only");
    expect(anchor(html, "#app-content")).toContain("focus:not-sr-only");
  });
});

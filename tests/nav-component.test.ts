import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { Nav } from "../app/components/nav";

const PLACES = [
  { href: "/app", label: "Home" },
  { href: "/app/competitors", label: "Competitors" },
  { href: "/app/alerts", label: "Alerts" },
  { href: "/app/settings", label: "Settings" },
] as const;

function nav(location: string): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [location] }, createElement(Nav)));
}

function links(html: string): string[] {
  return html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
}

function attribute(link: string, name: "href" | "aria-current"): string {
  return link.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? "";
}

function label(link: string): string {
  return link.replace(/<[^>]*>/g, "");
}

describe("Nav", () => {
  it("renders one nav landmark, named Primary", () => {
    const html = nav("/app");
    expect(html.match(/<nav\b/g)).toHaveLength(1);
    expect(html.slice(html.indexOf("<nav"), html.indexOf("</nav>"))).toContain('aria-label="Primary"');
  });

  it("links the four places in order, each with its label", () => {
    const anchors = links(nav("/app"));
    expect(anchors).toHaveLength(4);
    expect(anchors.map((link) => attribute(link, "href"))).toEqual(PLACES.map((place) => place.href));
    expect(anchors.map(label)).toEqual(PLACES.map((place) => place.label));
  });

  it("marks only the place the reader is on as the current page", () => {
    const anchors = links(nav("/app/alerts"));
    expect(anchors.map((link) => attribute(link, "href"))).toEqual(PLACES.map((place) => place.href));
    expect(anchors.map((link) => attribute(link, "aria-current"))).toEqual(["", "", "page", ""]);
  });

  it("keeps Home out of the current page on a nested competitor route, because Home matches /app alone", () => {
    const anchors = links(nav("/app/competitors/x"));
    expect(attribute(anchors[0], "href")).toBe("/app");
    expect(attribute(anchors[0], "aria-current")).toBe("");
    expect(attribute(anchors[1], "href")).toBe("/app/competitors");
    expect(attribute(anchors[1], "aria-current")).toBe("page");
  });

  it("marks Home itself current on /app", () => {
    const anchors = links(nav("/app"));
    expect(anchors.map((link) => attribute(link, "aria-current"))).toEqual(["page", "", "", ""]);
  });

  it("gives every place a 44px tap target", () => {
    for (const link of links(nav("/app"))) {
      expect(link).toContain("min-h-11");
    }
  });
});

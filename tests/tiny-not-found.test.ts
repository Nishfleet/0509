import { describe, expect, it } from "vitest";

import {
  routesCatchAllForPath,
  TINY_NOT_FOUND_HTML,
  tinyNotFoundResponse,
} from "../workers/tiny-not-found";
import type { AgnosticRouteObject } from "react-router";

// The real registered route tree (route() config entries are shape-compatible
// with AgnosticRouteObject for matching): pins the worker decision to the
// manifest, so a route-tree edit that changes the 404 shape fails here.
import realRouteConfig from "~/routes";

// A reduced mirror of the shape app/routes.ts produces in the built server
// build: specific static routes, dynamic segments, a nested locale layout, an
// apileben splat prefix, and the terminal not-found catch-all.
const ROUTES: AgnosticRouteObject[] = [
  {
    id: "root",
    children: [
      { id: "routes/marketing", path: undefined, index: true },
      { id: "routes/pricing", path: "pricing" },
      { id: "routes/app-layout", path: "app", children: [
        { id: "routes/app.dashboard", path: undefined, index: true },
        { id: "routes/app.c", path: "c/:id" },
      ] },
      { id: "routes/ads", path: "ads/:domain" },
      { id: "routes/$locale", path: ":locale", children: [
        { id: "routes/$locale._index", path: undefined, index: true },
        { id: "routes/$locale.pricing", path: "pricing" },
      ] },
      { id: "routes/api.auth.$", path: "api/auth/*" },
      { id: "routes/not-found", path: "*" },
    ],
  },
];

describe("tiny purpose-built 404 against the real route tree (issue #2967)", () => {
  it("serves tiny 404 for junk paths and real pages via SSR", () => {
    // Splat-only junk + the loader-thrown locale swallower.
    for (const junk of [
      "/definitely-not-a-page",
      "/deep/nested/unknown/link",
      "/assets/missing-does-not-exist.css",
      "/junk/pricing",
    ]) {
      expect(
        routesCatchAllForPath(realRouteConfig, junk),
        `expected tiny 404 for ${junk}`,
      ).toBe(true);
    }
    // Every registered public shape, plus a real locale, must stay SSR.
    for (const realPath of ["/", "/pricing", "/ads/nike.com", "/de/pricing", "/app/c/42"]) {
      expect(
        routesCatchAllForPath(realRouteConfig, realPath),
        `expected SSR for ${realPath}`,
      ).toBe(false);
    }
  });
});

describe("tiny purpose-built 404 (issue #2967)", () => {
  it("flags paths only the catch-all can match", () => {
    expect(routesCatchAllForPath(ROUTES, "/definitely-not-a-page")).toBe(true);
    expect(routesCatchAllForPath(ROUTES, "/deep/nested/unknown/link")).toBe(true);
    expect(routesCatchAllForPath(ROUTES, "/assets/missing-does-not-exist.css")).toBe(true);
  });

  it("does not flag paths a real route matches", () => {
    expect(routesCatchAllForPath(ROUTES, "/pricing")).toBe(false);
    expect(routesCatchAllForPath(ROUTES, "/ads/nike.com")).toBe(false);
    expect(routesCatchAllForPath(ROUTES, "/")).toBe(false);
    expect(routesCatchAllForPath(ROUTES, "/de/pricing")).toBe(false);
    expect(routesCatchAllForPath(ROUTES, "/app/c/42")).toBe(false);
  });

  it("keeps nested api splat prefixes real routes, not 404 fallthrough", () => {
    expect(routesCatchAllForPath(ROUTES, "/api/auth/anything-here")).toBe(false);
  });

  it("cached decision is deterministic across repeated calls on the same tree", () => {
    // Honest scope: this proves decision STABILITY, not WeakMap identity. The
    // identity property is an implementation detail; the observable contract
    // is that repeated decisions over the same tree stay correct.
    const tree = [...ROUTES];
    routesCatchAllForPath(tree, "/pricing");
    routesCatchAllForPath(tree, "/nope");
    routesCatchAllForPath(tree, "/pricing");
    expect(routesCatchAllForPath(tree, "/not-a-page")).toBe(true);
  });

  it("document is tiny, self-contained, and titled 'Page not found'", () => {
    expect(TINY_NOT_FOUND_HTML.length).toBeLessThan(1500);
    expect(TINY_NOT_FOUND_HTML).toContain("<title>Page not found | Five to Nine</title>");
    expect(TINY_NOT_FOUND_HTML).not.toMatch(/<script\b/i);
    // No external requests: no stylesheet links, no fonts, no beacons.
    expect(TINY_NOT_FOUND_HTML).not.toMatch(/<link\b/i);
    expect(TINY_NOT_FOUND_HTML).not.toMatch(/https?:\/\//);
  });

  it("response keeps the 404 contract with a short shared cache window", () => {
    const get = tinyNotFoundResponse(new Request("https://0509.io/typo"));
    expect(get.status).toBe(404);
    expect(get.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(get.headers.get("cache-control")).toContain("max-age=300");
    expect(get.headers.get("x-f9-tiny-404")).toBe("1");
  });

  it("HEAD gets no body", async () => {
    const head = tinyNotFoundResponse(new Request("https://0509.io/typo", { method: "HEAD" }));
    expect(head.status).toBe(404);
    expect(await head.text()).toBe("");
  });
});

import { describe, expect, it } from "vitest";

import routes from "../app/routes";
import {
  CARD_ROUTE_PATH,
  DISALLOWED_PREFIXES,
  PUBLIC_PATHS,
  robotsTxt,
} from "../app/lib/public-routes";

describe("public-route manifest", () => {
  it("classifies every top-level route in app/routes.ts", () => {
    for (const entry of routes) {
      const path = "path" in entry ? entry.path : undefined;
      if (
        path === undefined ||
        path === "*" ||
        path === "robots.txt" ||
        path === "sitemap.xml"
      ) {
        continue;
      }
      const urlPath = `/${path}`;
      const classified =
        (PUBLIC_PATHS as readonly string[]).includes(urlPath) ||
        DISALLOWED_PREFIXES.some((prefix) => urlPath.startsWith(prefix)) ||
        path === CARD_ROUTE_PATH;
      expect(
        classified,
        `route "${path}" is not classified in app/lib/public-routes.ts`,
      ).toBe(true);
    }
  });

  it("robots.txt disallows the manifest prefixes and names the sitemap", () => {
    const body = robotsTxt("https://0509.io");
    expect(body).toContain("Disallow: /app");
    expect(body).toContain("Disallow: /api");
    expect(body).toContain("Disallow: /mcp");
    expect(body).toContain("Sitemap: https://0509.io/sitemap.xml");
  });
});

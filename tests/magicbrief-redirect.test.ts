import { describe, expect, it } from "vitest";

import routes from "~/routes";
import { SITEMAP_PATHS } from "~/lib/seo";
import { SWITCH_SLUGS } from "~/lib/switch-pages";
import {
  LEGACY_VENDOR_COMPARE_PATH,
  LEGACY_VENDOR_REDIRECT_TARGET,
  LEGACY_VENDOR_SWITCH_PATH,
  loader,
} from "~/routes/legacy-vendor-redirect";

type RouteNode = { path?: string; file?: string; id?: string; children?: RouteNode[] };

const REDIRECT_FILE = "routes/legacy-vendor-redirect.ts";

const LEGACY_URLS = [
  "/compare/magicbrief",
  "/switch/magicbrief",
  "/de/compare/magicbrief",
  "/ja/switch/magicbrief",
] as const;

function nodesFor(path: string, nodes: RouteNode[]): RouteNode[] {
  return nodes.filter((node) => node.path === path);
}

/**
 * MagicBrief wipe (issue #2127): the compare/switch pages, their docs, tests,
 * and every callout are gone. The two legacy URLs (and their locale twins)
 * must 301 to the /compare hub so indexed entries and external links never
 * 404.
 */
describe("MagicBrief legacy URLs 301 to /compare (issue #2127)", () => {
  it("names the wiped vendor paths and the hub as the target", () => {
    expect(LEGACY_VENDOR_COMPARE_PATH).toBe("compare/magicbrief");
    expect(LEGACY_VENDOR_SWITCH_PATH).toBe("switch/magicbrief");
    expect(LEGACY_VENDOR_REDIRECT_TARGET).toBe("/compare");
  });

  it.each(LEGACY_URLS)("301-redirects %s to /compare", (url) => {
    let captured: Response | null = null;
    try {
      loader({ request: new Request(`https://0509.io${url}`) } as Parameters<typeof loader>[0]);
    } catch (thrown) {
      captured = thrown as Response;
    }
    expect(captured, "loader must throw a redirect Response").not.toBeNull();
    expect(captured!.status).toBe(301);
    expect(captured!.headers.get("location")).toBe("/compare");
  });

  it("wires both EN paths and both locale twins to the redirect loader in routes.ts", () => {
    const top = routes as unknown as RouteNode[];
    const locale = top.find((node) => node.path === ":locale");
    expect(locale?.children, "the :locale layout must exist").toBeTruthy();
    for (const tree of [top, locale!.children!]) {
      for (const path of [LEGACY_VENDOR_COMPARE_PATH, LEGACY_VENDOR_SWITCH_PATH]) {
        const matches = nodesFor(path, tree);
        expect(matches, `${path} must be registered exactly once`).toHaveLength(1);
        expect(matches[0]?.file).toBe(REDIRECT_FILE);
      }
    }
    // Each registration needs its own id: React Router derives ids from the
    // file path, and four routes sharing one loader file would collide.
    const ids = [top, locale!.children!]
      .flatMap((tree) => tree.filter((node) => node.file === REDIRECT_FILE))
      .map((node) => node.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  it("is gone from the sitemap and the switch-page catalogue", () => {
    for (const path of ["/compare/magicbrief", "/switch/magicbrief"]) {
      expect(SITEMAP_PATHS as readonly string[]).not.toContain(path);
    }
    expect(SWITCH_SLUGS as readonly string[]).not.toContain("magicbrief");
  });
});

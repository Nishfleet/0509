import { describe, expect, it } from "vitest";

import routes from "~/routes";
import { SITEMAP_PATHS } from "~/lib/seo";
import { SWITCH_SLUGS } from "~/lib/switch-pages";
import {
  LEGACY_VENDOR_COMPARE_PATH,
  LEGACY_VENDOR_REDIRECT_TARGET,
  loader,
} from "~/routes/legacy-vendor-redirect";

type RouteNode = { path?: string; file?: string; id?: string; children?: RouteNode[] };

const REDIRECT_FILE = "routes/legacy-vendor-redirect.ts";

const LEGACY_URLS = ["/compare/magicbrief", "/de/compare/magicbrief"] as const;

function nodesFor(path: string, nodes: RouteNode[]): RouteNode[] {
  return nodes.filter((node) => node.path === path);
}

/**
 * MagicBrief wipe (issue #2127) and re-publish (issue #2887): the compare
 * page and its locale twins are gone for good and must 301 to the /compare
 * hub so indexed entries and external links never 404. /switch/magicbrief is
 * different — it is a live BET 8 wind-down page again, so it must serve the
 * real route file, never the redirect loader.
 */
describe("MagicBrief legacy URLs (issues #2127, #2887)", () => {
  it("names the wiped compare path and the hub as the target", () => {
    expect(LEGACY_VENDOR_COMPARE_PATH).toBe("compare/magicbrief");
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

  it("wires the EN compare path to the redirect loader in routes.ts", () => {
    const top = routes as unknown as RouteNode[];
    const matches = nodesFor(LEGACY_VENDOR_COMPARE_PATH, top);
    expect(matches, `${LEGACY_VENDOR_COMPARE_PATH} must be registered exactly once`).toHaveLength(
      1,
    );
    expect(matches[0]?.file).toBe(REDIRECT_FILE);
    // Issue #2962 (Branch B): the locale twin registration was deleted with
    // the untranslated buyer-surface locale cluster — /de/compare/magicbrief
    // now 301s via the $locale.tsx splat, so only the EN redirect loader
    // remains and the shared-file id-collision risk is gone with it.
    const ids = top
      .filter((node) => node.file === REDIRECT_FILE)
      .map((node) => node.id);
    expect(ids).toHaveLength(1);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  it("keeps /compare/magicbrief out of the sitemap but lists the live /switch page", () => {
    expect(SITEMAP_PATHS as readonly string[]).not.toContain("/compare/magicbrief");
    expect(SITEMAP_PATHS as readonly string[]).toContain("/switch/magicbrief");
    expect(SWITCH_SLUGS as readonly string[]).toContain("magicbrief");
  });

  it("registers /switch/magicbrief as a real route, never the redirect loader", () => {
    const top = routes as unknown as RouteNode[];
    // Issue #2962 (Branch B): EN route only — the $locale twin was deleted;
    // /de/switch/magicbrief 301s to the EN page via the $locale.tsx splat.
    const matches = nodesFor("switch/magicbrief", top);
    expect(matches, "switch/magicbrief must be registered exactly once").toHaveLength(1);
    expect(matches[0]?.file).toBe("routes/switch.magicbrief.tsx");
    expect(matches[0]?.file).not.toBe(REDIRECT_FILE);
  });
});

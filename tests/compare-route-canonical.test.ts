import { describe, expect, it } from "vitest";

import { COMPARE_CANONICAL_TARGETS } from "~/lib/seo";

/**
 * Canonicalization of the /compare alias routes (issue #2085).
 *
 * The three non-sitemap /compare URL variants
 * (/compare/visualping-ad-library, /compare/visualping, /compare/foreplay)
 * used to render HTTP 200 with a <title> identical to their sitemap canonical,
 * so two indexable URLs carried the same title on the acquisition compare
 * surface. They now 301-redirect to the sitemap canonical (the /ads alias
 * canonical-redirect pattern), so only the canonical serves indexable 200
 * content. This test is the prevention mechanism (fleet-ops#366): a
 * re-introduced duplicate-title compare variant cannot silently return 200.
 */

const ALIAS_TO_CANONICAL: ReadonlyArray<{ alias: string; canonical: string }> = [
  { alias: "/compare/visualping-ad-library", canonical: "/compare/visualping-ad-libraries" },
  { alias: "/compare/visualping", canonical: "/compare/visualping-ad-libraries" },
  { alias: "/compare/foreplay", canonical: "/compare/foreplay-spyder" },
];

/** The sitemap canonicals must keep serving indexable 200 content. */
const CANONICAL_SLUGS = [
  "/compare/visualping-ad-libraries",
  "/compare/foreplay-spyder",
] as const;

async function runLoader(routeId: string) {
  const { loader } = (await import(`~/routes/${routeId}`)) as {
    loader?: (args: unknown) => Promise<unknown>;
  };
  if (!loader) {
    // No loader means the route renders directly (indexable 200 content).
    return null;
  }
  return loader({} as never);
}

/** Runs the loader and returns the thrown redirect Response, or null if it rendered. */
async function loaderResponse(routeId: string): Promise<Response | null> {
  try {
    await runLoader(routeId);
    return null;
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }
}

describe("compare alias routes canonicalize to the sitemap winner (issue #2085)", () => {
  it.each(ALIAS_TO_CANONICAL)(
    "$alias 301-redirects to its sitemap canonical $canonical",
    async ({ alias, canonical }) => {
      const routeId = `compare.${alias.replace("/compare/", "")}`;
      const response = await loaderResponse(routeId);

      expect(response).toBeInstanceOf(Response);
      expect(response!.status).toBe(301);
      expect(response!.headers.get("Location")).toBe(canonical);
    },
  );

  it("the alias targets are the sitemap canonicals declared in seo.ts", () => {
    for (const { alias, canonical } of ALIAS_TO_CANONICAL) {
      expect(COMPARE_CANONICAL_TARGETS[alias]).toBe(canonical);
    }
  });

  it.each(CANONICAL_SLUGS)(
    "%s keeps serving indexable 200 content (no redirect)",
    async (canonical) => {
      const routeId = `compare.${canonical.replace("/compare/", "")}`;
      const response = await loaderResponse(routeId);
      expect(response).toBeNull();
    },
  );
});

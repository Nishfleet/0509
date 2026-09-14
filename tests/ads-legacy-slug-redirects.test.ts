import { describe, expect, it } from "vitest";

import { LEGACY_BRAND_SLUG_DOMAINS } from "~/routes/ads.$domain";

/**
 * Issue #3457 — the five originally-shipped bare-brand /ads URLs predate the
 * domain-keyed corpus and used to hard-404. Each dotless slug now 301s to its
 * dotted canonical (the ad-aggression-redirect.ts pattern); dotless slugs
 * NOT in the map keep their 404 — a bare slug never guesses a TLD.
 *
 * The redirect fires at the top of the loader, before normalization, rate
 * limiting or any cache read, so this test needs no module mocks: both the
 * 301 and the 404 throw before the loader reaches env resolution.
 */
async function runLoader(domain: string, query = ""): Promise<Response | null> {
  const { loader } = await import("~/routes/ads.$domain");
  try {
    await loader({
      context: { cloudflare: { env: {} } },
      params: { domain },
      request: new Request(`http://localhost/ads/${encodeURIComponent(domain)}${query}`),
    } as never);
    return null;
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }
}

describe("legacy dotless /ads slugs (issue #3457)", () => {
  it("the map is exactly the five shipped bare-brand slugs — no broader TLD guessing", () => {
    expect(Object.keys(LEGACY_BRAND_SLUG_DOMAINS).sort()).toEqual([
      "allbirds",
      "lenskart",
      "mamaearth",
      "nike",
      "nykaa",
    ]);
  });

  it.each([
    ["nike", "/ads/nike.com"],
    ["allbirds", "/ads/allbirds.com"],
    ["nykaa", "/ads/nykaa.com"],
    ["lenskart", "/ads/lenskart.com"],
    ["mamaearth", "/ads/mamaearth.com"],
  ])("301s /ads/%s to %s", async (slug, location) => {
    const response = await runLoader(slug);

    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(301);
    expect(response!.headers.get("Location")).toBe(location);
  });

  it.each(["adidas", "puma", "nikee", "nike.", "example"])(
    "keeps the 404 for unmapped dotless slug %s — never guess a TLD",
    async (slug) => {
      const response = await runLoader(slug);

      expect(response).toBeInstanceOf(Response);
      expect(response!.status).toBe(404);
    },
  );

  // Issue #3457 review: a plain-object lookup would treat inherited
  // Object.prototype members as map hits and 301 them to a garbage Location.
  // Object.hasOwn gates the lookup so these names keep the pinned 404.
  //
  // Precision note (review round on PR #3479): the loader lowercases the slug
  // before lookup, so the mixed-case names below (toString, valueOf, …) were
  // never real map hits — they lowercase to inert strings and 404'd even on
  // the pre-gate code. The two case-stable names that actually discriminate
  // the gate are "constructor" and "__proto__"; the rest pin the acceptance
  // contract for these URL shapes.
  it.each([
    "toString",
    "constructor",
    "valueOf",
    "hasOwnProperty",
    "toLocaleString",
    "propertyIsEnumerable",
    "isPrototypeOf",
    "__proto__",
  ])("keeps the 404 for Object.prototype member name %s", async (slug) => {
    const response = await runLoader(slug);

    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(404);
  });

  it("preserves the query string across the 301 (the /ads → /brands treatment, #2885)", async () => {
    const response = await runLoader("nike", "?utm_source=newsletter");

    expect(response!.status).toBe(301);
    expect(response!.headers.get("Location")).toBe("/ads/nike.com?utm_source=newsletter");
  });

  it("preserves multi-param, percent-encoded queries verbatim across the 301", async () => {
    const response = await runLoader("mamaearth", "?utm_source=x&utm_campaign=hello%20world");

    expect(response!.status).toBe(301);
    expect(response!.headers.get("Location")).toBe(
      "/ads/mamaearth.com?utm_source=x&utm_campaign=hello%20world",
    );
  });

  it("normalizes case/whitespace on the mapped slugs (URL params arrive un-normalized)", async () => {
    const response = await runLoader("Nike");

    expect(response!.status).toBe(301);
    expect(response!.headers.get("Location")).toBe("/ads/nike.com");
  });
});

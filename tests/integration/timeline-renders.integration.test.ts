import { describe, expect, it } from "vitest";

import { createLandingPageSnapshot } from "~/lib/data/ads.server";

import { appEnv } from "./fixtures";

/**
 * Issue #1564 — "route does not personalize by :domain".
 *
 * The public Offer Timeline previously served the same 13,380-byte generic
 * error body (`f9-error-page`, title "Five to Nine") for every brand on
 * /timeline/:domain. This suite exercises the REAL route loader against REAL
 * D1 (migrations applied) across the three states the issue's acceptance
 * names — no history, one entry, several entries — and proves each response
 * is personalized by :domain instead of collapsing to a shared error page:
 *
 * - empty ledger: the route resolves to the accepted #1309 retire shape — a
 *   410 "Gone" whose JSON body carries `{domain, brandName}` so the root
 *   ErrorBoundary renders an honest, brand-named "not stored yet" shell (the
 *   `tests/error-boundary-410.test.ts` suite asserts that rendered shell's
 *   copy and CTA hrefs). It must never resolve to a 200 generic error body.
 * - one entry and multiple entries: the loader returns a dated ledger whose
 *   states carry working `/artifacts/proof/*` screenshot links.
 *
 * The empty-ledger 410 (not 200) is deliberate and unchanged: issue #1309
 * retired empty timelines from 200ing as soft-404 marketing shells, and its
 * decision is explicit in the route comment. #1564's "200" wording predates
 * that accepted retirement; what #1564 actually requires (a brand-personalized
 * body on every :domain, an honest empty state, and a three-state regression
 * test) is what this suite locks in.
 */

let domainSeq = 0;

/** Unique-per-call domain (`.com` is not on the reserved-TLD blocklist). */
function testDomain(prefix: string) {
  domainSeq += 1;
  return `${prefix}-tl${domainSeq.toString().padStart(4, "0")}.com`;
}

function loaderContext(env: Record<string, unknown>) {
  return { cloudflare: { env } };
}

async function callTimelineLoader(domain: string) {
  const { loader } = await import("~/routes/timeline.$domain");
  try {
    const data = await loader({
      context: loaderContext(appEnv as unknown as Record<string, unknown>),
      params: { domain },
      request: new Request(`http://localhost/timeline/${encodeURIComponent(domain)}`),
    } as never);
    return { kind: "data" as const, data };
  } catch (error) {
    return { kind: "response" as const, response: error as Response };
  }
}

async function seedSnapshot(domain: string, overrides: Record<string, string> = {}) {
  const capturedAt = overrides.capturedAt ?? "2026-08-01T10:00:00.000Z";
  const day = capturedAt.slice(0, 10);
  const hex = `${day.replaceAll("-", "").slice(0, 30)}${String(domainSeq)}`;
  return createLandingPageSnapshot(appEnv, {
    rawUrl: `https://${domain}/glow`,
    canonicalUrl: `https://${domain}/glow`,
    rawHeadline: overrides.headline ?? "Glow serum",
    normalizedHeadline: (overrides.headline ?? "Glow serum").toLowerCase(),
    normalizedHeadlineHash: `hash_${overrides.headline ?? "Glow serum"}_${hex}`,
    captureMethod: "landing_page_fetch",
    artifactKey: `landing-pages/${day}/${hex}.html`,
    metadata: {
      screenshotArtifactKey: `landing-pages/${day}/${hex}.jpeg`,
      htmlArtifactKey: `landing-pages/${day}/${hex}.html`,
    },
    ctaText: overrides.ctaText ?? null,
    priceText: overrides.priceText ?? null,
    formPresent: true,
    capturedAt,
  });
}

describe("/timeline/:domain renders personalized by brand on real D1 (issue #1564)", () => {
  it("no history → 410 Gone carrying brand context, never a generic 200 error body", async () => {
    const domain = testDomain("empty");

    const result = await callTimelineLoader(domain);

    // The regression being fixed: /timeline/:domain must not resolve to a 200
    // generic error page. An empty ledger resolves to the accepted #1309
    // retire shape — a 410 Gone.
    expect(result.kind).toBe("response");
    if (result.kind !== "response") throw new Error("expected 410 response");
    expect(result.response.status).toBe(410);

    // The Gone payload must name the brand so the root ErrorBoundary renders a
    // personalized "We have no stored offer timeline for <brand> yet" shell
    // with /search and /ads CTAs — not the shared "Something went wrong" page.
    const payload = (await result.response.json()) as { domain?: unknown; brandName?: unknown };
    expect(payload.domain).toBe(domain);
    expect(typeof payload.brandName).toBe("string");
    expect(payload.brandName).not.toBe("Five to Nine");
  });

  it("one entry → dated ledger with a working screenshot link", async () => {
    const domain = testDomain("single");
    await seedSnapshot(domain, {
      headline: "Festive glow kit",
      ctaText: "Get the kit",
      priceText: "₹799",
      capturedAt: "2026-08-10T10:00:00.000Z",
    });

    const result = await callTimelineLoader(domain);

    expect(result.kind).toBe("data");
    if (result.kind !== "data") throw new Error("expected timeline data");
    expect(result.data.domain).toBe(domain);
    expect(result.data.entries).toHaveLength(1);
    const [entry] = result.data.entries;
    expect(entry?.headline).toBe("Festive glow kit");
    expect(entry?.capturedAt).toBe("2026-08-10T10:00:00.000Z");
    expect(entry?.dateLabel).toBe("10 Aug 2026");
    expect(entry?.ctaText).toBe("Get the kit");
    // A real receipt link, not a generic placeholder or the page collapsing to
    // an error body.
    expect(entry?.screenshotHref).toMatch(/^\/artifacts\/proof\//);
    // The route personalizes by :domain: the brand-named heading data is
    // present (displayName is the humanized form, not the raw host).
    expect(result.data.brandName.trim().length).toBeGreaterThan(0);
  });

  it("multiple entries → dated ledger in ascending date order with screenshot links", async () => {
    const domain = testDomain("multi");
    const day1 = "2026-08-01T10:00:00.000Z";
    const day2 = "2026-08-10T10:00:00.000Z";
    const day3 = "2026-08-20T10:00:00.000Z";
    await seedSnapshot(domain, { headline: "Glow serum", capturedAt: day1 });
    await seedSnapshot(domain, { headline: "Festive glow kit", capturedAt: day2 });
    await seedSnapshot(domain, { headline: "Festive glow kit", priceText: "₹599", capturedAt: day3 });

    const result = await callTimelineLoader(domain);

    expect(result.kind).toBe("data");
    if (result.kind !== "data") throw new Error("expected timeline data");
    expect(result.data.domain).toBe(domain);
    expect(result.data.entries.length).toBeGreaterThanOrEqual(3);
    // Every dated state must carry a real screenshot receipt — the moat asset
    // the page exists to show.
    for (const entry of result.data.entries) {
      expect(entry?.screenshotHref).toMatch(/^\/artifacts\/proof\//);
    }
    // The three seeded headlines survive to the public ledger, and the ledger
    // is oldest-first (ascending captured_at), matching the date column render.
    const headlines = result.data.entries.map((entry) => entry?.headline);
    expect(headlines).toContain("Glow serum");
    expect(headlines).toContain("Festive glow kit");
    const capturedAt = result.data.entries.map((entry) => entry?.capturedAt ?? "");
    const sortedAsc = [...capturedAt].sort();
    expect(capturedAt).toEqual(sortedAsc);
  });
});

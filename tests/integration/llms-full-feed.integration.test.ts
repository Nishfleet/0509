import { describe, expect, it } from "vitest";

import { createLandingPageSnapshot } from "~/lib/data/ads.server";
import {
  buildLlmsFullText,
  loadLlmsFullBrandTimelines,
} from "~/lib/llms-full.server";
import { SITEMAP_PATHS, publicSeoFileForPathname } from "~/lib/seo";
import { buildLlmsText } from "~/lib/public-markdown";

import { appEnv } from "./fixtures";

/**
 * The /llms-full.txt feed reads `landing_page_snapshot` read-only. Mocked D1
 * cannot see the schema, the proof gates, or the LIKE filters — this file
 * applies the real migrations, seeds real snapshot rows, and asserts the
 * regression the issue asks for (accept #4): the feed loads and at least one
 * tracked brand carries at least one dated offer state WITH an evidence link,
 * so a future regression that empties the feed fails loudly.
 */
describe("/llms-full.txt feed against real D1", () => {
  const NOW = new Date("2026-09-10T12:00:00.000Z");
  // Registrable domains: reserved TLDs (.example etc.) are deliberately
  // dropped by the feed's domain-recovery gate — the route would 404 on them.
  const DOMAIN = "llmsfull967.com";
  const SIBLING = "notllmsfull967.com";

  let seedIndex = 0;

  async function seedSnapshot(input: {
    canonicalUrl: string;
    headline: string;
    ctaText: string;
    priceText: string;
    capturedAt: string;
    withProof: boolean;
  }) {
    const day = input.capturedAt.slice(0, 10);
    // R2 keys are hex-shaped (`landing-pages/YYYY-MM-DD/<hex>.<ext>`); the
    // key-shape gates reject anything else. Distinct hex per seeded row.
    seedIndex += 1;
    const hex = seedIndex.toString(16).padStart(2, "0").repeat(16).slice(0, 32);
    return createLandingPageSnapshot(appEnv, {
      rawUrl: input.canonicalUrl,
      canonicalUrl: input.canonicalUrl,
      rawHeadline: input.headline,
      normalizedHeadline: input.headline.toLowerCase(),
      normalizedHeadlineHash: `hash_${input.headline}`,
      captureMethod: "landing_page_fetch",
      artifactKey: input.withProof ? `landing-pages/${day}/${hex}.html` : null,
      metadata: input.withProof
        ? {
            screenshotArtifactKey: `landing-pages/${day}/${hex}.jpeg`,
            htmlArtifactKey: `landing-pages/${day}/${hex}.html`,
          }
        : {},
      ctaText: input.ctaText,
      priceText: input.priceText,
      formPresent: true,
      capturedAt: input.capturedAt,
    });
  }

  it("renders at least one tracked brand with a dated offer state and evidence links", async () => {
    await seedSnapshot({
      canonicalUrl: `https://${DOMAIN}/glow`,
      headline: "Glow serum",
      ctaText: "Shop now",
      priceText: "₹499",
      capturedAt: "2026-09-01T10:00:00.000Z",
      withProof: true,
    });
    await seedSnapshot({
      canonicalUrl: `https://www.${DOMAIN}/glow`,
      headline: "Festive glow kit",
      ctaText: "Get the kit",
      priceText: "₹799",
      capturedAt: "2026-09-09T10:00:00.000Z",
      withProof: true,
    });
    // Honesty gates: a proof-less capture and a sibling domain never surface.
    await seedSnapshot({
      canonicalUrl: `https://${DOMAIN}/ghost`,
      headline: "Fabricated state must not render",
      ctaText: "Buy",
      priceText: "₹1",
      capturedAt: "2026-09-09T11:00:00.000Z",
      withProof: false,
    });
    await seedSnapshot({
      canonicalUrl: `https://${SIBLING}/glow`,
      headline: "Other brand",
      ctaText: "Buy",
      priceText: "₹2",
      capturedAt: "2026-09-09T12:00:00.000Z",
      withProof: true,
    });

    const sections = await loadLlmsFullBrandTimelines(appEnv);
    const tracked = sections.filter((section) => section.domain === DOMAIN);
    expect(tracked.length).toBeGreaterThanOrEqual(1);

    const text = buildLlmsFullText(sections, NOW);
    const section = tracked[0]!;

    // >=1 dated offer state with an evidence link (the regression gate).
    expect(section.entries.length).toBeGreaterThanOrEqual(2);
    expect(
      section.entries.every(
        (entry) => entry.screenshotHref !== null && entry.pageTextHref !== null,
      ),
    ).toBe(true);
    expect(text).toContain(`## ${DOMAIN}`);
    expect(text).toMatch(/As of 2026-09-01: "Glow serum"/);
    expect(text).toMatch(/As of 2026-09-09: "Festive glow kit"/);
    // The artifact keys are percent-encoded inside the evidence href
    // (proofScreenshotSrc/proofPageTextSrc encode the R2 key).
    expect(text).toMatch(
      /\[screenshot\]\(https:\/\/0509\.io\/artifacts\/proof\/landing-pages%2F/,
    );
    expect(text).toMatch(
      /\[page text\]\(https:\/\/0509\.io\/artifacts\/page-text\/landing-pages%2F/,
    );
    // Honesty: the proof-less state is absent; every rendered date is a real
    // stored capture date (YYYY-MM-DD), never invented.
    expect(text).not.toContain("Fabricated state must not render");
    expect(text).toMatch(/As of \d{4}-\d{2}-\d{2}/);
    expect(text).toContain("- Offer source: Meta Ad Library via public search");
    // Sibling domain only appears if IT has a qualifying section — its own
    // assertion, not DOMAIN's:
    const sibling = sections.filter((s) => s.domain === SIBLING);
    expect(sibling.length).toBe(1);
  });

  it("wires the feed for discovery: sitemap, llms.txt, and robots.txt name it", () => {
    // sitemap.xml: /llms-full.txt is a SITEMAP_PATHS entry.
    expect(SITEMAP_PATHS).toContain("/llms-full.txt");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    expect(sitemap?.body).toContain("https://0509.io/llms-full.txt");

    // llms.txt: a Pages-section entry referencing the full-text corpus.
    const llmsText = buildLlmsText();
    expect(llmsText).toContain("https://0509.io/llms-full.txt");

    // robots.txt: explicit Allow plus the full-text URL comment.
    const robots = publicSeoFileForPathname("/robots.txt");
    expect(robots?.body).toContain("Allow: /llms-full.txt");
    expect(robots?.body).toContain("https://0509.io/llms-full.txt");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockReactRouter } from "./helpers/mock-react-router";

beforeEach(() => {
  vi.resetModules();
  mockReactRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("guides how-to-monitor-competitor-landing-page-changes route (issue #2888)", () => {
  it("renders the honest guide: free by-hand check, the page-monitor route, and where pixel diffs break", async () => {
    const { default: GuideRoute } = await import(
      "~/routes/guides.how-to-monitor-competitor-landing-page-changes"
    );
    const markup = renderToStaticMarkup(createElement(GuideRoute));

    // The by-hand routine — never hidden that it is free.
    expect(markup).toContain("This method is free");
    expect(markup).toContain("Save a dated copy of the page");
    expect(markup).toContain("Revisit on a cadence you will keep");
    expect(markup).toContain("Compare by eye, field by field");
    // The page-monitor route: URL + condition prompt, with Visualping named.
    expect(markup).toContain("Paste the URL into a page-change monitor");
    expect(markup).toContain("Tell it what counts as a change");
    expect(markup).toContain("condition prompt");
    expect(markup).toContain("Visualping");
    // Where it breaks — pixel diffs, with Visualping's own published 83%
    // figure cited and linked to its source (accept: only verified, cited
    // competitor facts).
    expect(markup).toContain("Where pixel diffs break.");
    expect(markup).toContain("83% of detected changes as not important");
    expect(markup).toContain(
      'href="https://visualping.io/blog/how-visualping-cuts-false-positives"',
    );
    // The semantic-diff alternative positioned as the automated answer —
    // with the honest plan truth: Free is one first check + one first brief,
    // recurring checks are paid (plan-entitlements.ts, reviewer round).
    expect(markup).toContain("The automated answer: a semantic diff.");
    expect(markup).toContain("One competitor, one first check, free");
    expect(markup).toContain("Recurring checks on a schedule are a paid plan.");
    expect(markup).toContain("recurring checks are a paid plan");
    expect(markup).toContain("Fields, not pixels");
    // Never the stale sibling claim: Free is not a weekly watch.
    expect(markup).not.toContain("watched weekly, free");
    expect(markup).not.toContain("weekly email brief");
    // Links out to the published differentiator pages and the free preview.
    expect(markup).toContain('href="/capture-rules"');
    expect(markup).toContain('href="/no-phantom-changes"');
    expect(markup).toContain('action="/search"');
    expect(markup).toContain('name="source"');
    expect(markup).toContain('value="guide-landing-page-changes"');
    expect(markup).toContain('href="/search?source=guide-landing-page-changes"');
    // Honest scope: not a monitor for arbitrary URLs — a competitor-domain
    // watch. No any-URL or multi-platform claim.
    expect(markup).toContain("not a monitor for arbitrary URLs");
    expect(markup).toContain("Can Five to Nine monitor any page URL?");
    expect(markup).not.toMatch(/multi-platform/iu);
    expect(markup).not.toMatch(/all (major )?platforms/iu);
    expect(markup).not.toMatch(/WhatsApp/iu);
    // Only Visualping is intentionally named (cited); the rest of the
    // competitor-tool set stays out of the guide's own copy. Scope the check
    // to the page body between the header and footer, since the shared
    // chrome links the compare/switch cluster site-wide.
    const body = markup.split("</header>")[1]?.split("<footer")[0] ?? markup;
    expect(body).not.toMatch(/Panoramata|Foreplay|Spyder|AdSpyder/iu);
    // Shared marketing chrome.
    expect(markup).toContain("Named for 05:09");
  });

  it("declares the canonical URL and public SEO meta", async () => {
    const { links, meta } = await import(
      "~/routes/guides.how-to-monitor-competitor-landing-page-changes"
    );

    expect(links()).toEqual([
      {
        rel: "canonical",
        href: "https://0509.io/guides/how-to-monitor-competitor-landing-page-changes",
      },
    ]);

    const tags = meta({} as never) as Array<Record<string, string>>;
    const title = tags.find((tag) => "title" in tag)?.title;
    expect(title).toBe(
      "How to monitor a competitor's landing page changes | Five to Nine",
    );
    expect(tags).toContainEqual({
      property: "og:url",
      content: "https://0509.io/guides/how-to-monitor-competitor-landing-page-changes",
    });
  });

  it("is registered as a route and published in the sitemap", async () => {
    const { readFileSync } = await import("node:fs");
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain(
      'route("guides/how-to-monitor-competitor-landing-page-changes", "routes/guides.how-to-monitor-competitor-landing-page-changes.tsx")',
    );
    // The locale cluster registration keeps the guide serving 200 under
    // every buyer-surface prefix, matching its locale sitemap entry.
    expect(routes).toContain(
      'route("guides/how-to-monitor-competitor-landing-page-changes", "routes/$locale.guides.how-to-monitor-competitor-landing-page-changes.tsx")',
    );

    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    expect(sitemap?.body).toContain(
      "<loc>https://0509.io/guides/how-to-monitor-competitor-landing-page-changes</loc>",
    );
  });

  it("emits one FAQPage JSON-LD block whose mainEntity count matches the visible FAQ entries", async () => {
    const { default: GuideRoute, landingPageChangesFaqEntries } = await import(
      "~/routes/guides.how-to-monitor-competitor-landing-page-changes"
    );
    const markup = renderToStaticMarkup(createElement(GuideRoute));

    const ldBlocks = [
      ...markup.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      ),
    ];
    const faqBlocks = ldBlocks
      .map((match) => JSON.parse(match[1] ?? "{}"))
      .filter((data) => data["@type"] === "FAQPage");

    expect(faqBlocks).toHaveLength(1);
    const mainEntity = faqBlocks[0].mainEntity as Array<{ name: string }>;
    expect(mainEntity).toHaveLength(landingPageChangesFaqEntries.length);
    expect(mainEntity.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(landingPageChangesFaqEntries.map((e) => e.question)),
    );
  });

  it("allowlists the guide-landing-page-changes signup source marker", async () => {
    const { ALLOWED_SIGNUP_SOURCES, allowlistedSignupSource } = await import(
      "~/lib/signup-source"
    );
    expect(ALLOWED_SIGNUP_SOURCES).toContain("guide-landing-page-changes");
    expect(allowlistedSignupSource("guide-landing-page-changes")).toBe(
      "guide-landing-page-changes",
    );
    expect(allowlistedSignupSource("guide-landing-page-changes&x=1")).toBeNull();
  });

  it("is internally linked from /docs and /competitor-monitoring", async () => {
    const { readFileSync } = await import("node:fs");
    const docs = readFileSync("app/routes/docs.tsx", "utf8");
    const monitoring = readFileSync(
      "app/routes/competitor-monitoring.tsx",
      "utf8",
    );
    expect(docs).toContain('to="/guides/how-to-monitor-competitor-landing-page-changes"');
    expect(monitoring).toContain('to="/guides/how-to-monitor-competitor-landing-page-changes"');
  });
});

describe("guides #3093 trio — offer-change alert, prove-what-changed, standing watch", () => {
  const guides = [
    {
      slug: "how-to-get-alerted-when-a-competitor-changes-their-offer",
      module: "guides.how-to-get-alerted-when-a-competitor-changes-their-offer",
      title: "How to get alerted when a competitor changes their offer | Five to Nine",
      source: "guide-offer-change-alert",
      faqExport: "offerChangeAlertFaqEntries",
      // The alert-intent copy: by-hand check, monitor route, the named-field brief.
      copy: [
        "Find the page where the offer lives",
        "Set the reminder yourself",
        "Log the offer fields each visit",
        "Point a page monitor at the offer",
        "This method is free",
        "Where the alert breaks.",
        "The automated answer: an alert that names the field.",
        "One competitor, one first check, free",
        "Recurring checks on a schedule are a paid plan.",
        "83% of detected changes as not important",
        'href="https://visualping.io/blog/how-visualping-cuts-false-positives"',
        'href="/capture-rules"',
        'href="/no-phantom-changes"',
        'href="/compare/visualping-ad-libraries"',
        'href="/guides/how-to-monitor-competitor-landing-page-changes"',
        "not a monitor for arbitrary URLs",
      ],
    },
    {
      slug: "how-to-prove-what-changed-on-a-competitor-website",
      module: "guides.how-to-prove-what-changed-on-a-competitor-website",
      title: "How to prove what changed on a competitor's website | Five to Nine",
      source: "guide-prove-what-changed",
      faqExport: "proveWhatChangedFaqEntries",
      // The evidence-intent copy: archive route, own dated record, filed proof.
      copy: [
        "Check the public archive first",
        "Keep your own dated captures",
        "Write the before/after in your own words",
        "Use a monitor that keeps history",
        "This method is free",
        "Where the proof breaks.",
        "The automated answer: every confirmed change filed with its evidence.",
        "One competitor, one first check, free",
        "Recurring checks on a schedule are a paid plan.",
        'href="/capture-rules"',
        'href="/no-phantom-changes"',
        'href="/compare/visualping-ad-libraries"',
        'href="/guides/how-to-monitor-competitor-landing-page-changes"',
        "not a monitor for arbitrary URLs",
      ],
    },
    {
      slug: "how-to-turn-a-one-off-competitor-check-into-a-standing-watch",
      module: "guides.how-to-turn-a-one-off-competitor-check-into-a-standing-watch",
      title: "How to turn a one-off competitor check into a standing watch | Five to Nine",
      source: "guide-standing-watch",
      faqExport: "standingWatchFaqEntries",
      // The cadence-intent copy: recurring routine, scheduled tools, the watch definition.
      copy: [
        "Repeat the check on a fixed slot",
        "Keep the baseline from last time",
        "Log the delta, not the page",
        "Put the URL on a schedule",
        "This method is free",
        "Where a repeated check stops being a watch.",
        "The automated answer: the first check becomes the baseline.",
        "One competitor, one first check, free",
        "paid plan",
        'href="/capture-rules"',
        'href="/no-phantom-changes"',
        'href="/guides/how-to-monitor-meta-ad-library"',
        'href="/guides/how-to-monitor-competitor-landing-page-changes"',
      ],
    },
  ] as const;

  for (const guide of guides) {
    describe(`/guides/${guide.slug}`, () => {
      it("renders the honest guide copy and the free /search preview CTA", async () => {
        const mod = await import(`~/routes/${guide.module}`);
        const GuideRoute = mod.default;
        const markup = renderToStaticMarkup(createElement(GuideRoute));

        for (const fragment of guide.copy) {
          expect(markup, `missing copy: ${fragment}`).toContain(fragment);
        }
        // Never the stale claim: Free is not a recurring watch.
        expect(markup).not.toContain("watched weekly, free");
        expect(markup).not.toContain("weekly email brief");
        // CTA is the public /search preview carrying the allowlisted marker.
        expect(markup).toContain('action="/search"');
        expect(markup).toContain('name="source"');
        expect(markup).toContain(`value="${guide.source}"`);
        expect(markup).toContain(`href="/search?source=${guide.source}"`);
        // Shared marketing chrome.
        expect(markup).toContain("Named for 05:09");
      });

      it("declares the canonical URL and public SEO meta", async () => {
        const { links, meta } = await import(`~/routes/${guide.module}`);

        expect(links()).toEqual([
          {
            rel: "canonical",
            href: `https://0509.io/guides/${guide.slug}`,
          },
        ]);

        const tags = meta({} as never) as Array<Record<string, string>>;
        const title = tags.find((tag) => "title" in tag)?.title;
        expect(title).toBe(guide.title);
        expect(tags).toContainEqual({
          property: "og:url",
          content: `https://0509.io/guides/${guide.slug}`,
        });
      });

      it("is registered as a route (EN + locale cluster) and published in the sitemap", async () => {
        const { readFileSync } = await import("node:fs");
        const routes = readFileSync("app/routes.ts", "utf8");
        expect(routes).toContain(
          `route("guides/${guide.slug}", "routes/${guide.module}.tsx")`,
        );
        // The locale cluster registration keeps the guide serving 200 under
        // every buyer-surface prefix, matching its locale sitemap entry.
        expect(routes).toContain(
          `route("guides/${guide.slug}", "routes/$locale.${guide.module}.tsx")`,
        );

        const { publicSeoFileForPathname } = await import("~/lib/seo");
        const sitemap = publicSeoFileForPathname("/sitemap.xml");
        expect(sitemap?.body).toContain(
          `<loc>https://0509.io/guides/${guide.slug}</loc>`,
        );
      });

      it("emits one FAQPage JSON-LD block whose mainEntity count matches the visible FAQ entries", async () => {
        const mod = await import(`~/routes/${guide.module}`);
        const GuideRoute = mod.default;
        const faqEntries = mod[guide.faqExport] as ReadonlyArray<{ question: string }>;
        const markup = renderToStaticMarkup(createElement(GuideRoute));

        const ldBlocks = [
          ...markup.matchAll(
            /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
          ),
        ];
        const faqBlocks = ldBlocks
          .map((match) => JSON.parse(match[1] ?? "{}"))
          .filter((data) => data["@type"] === "FAQPage");

        expect(faqBlocks).toHaveLength(1);
        const mainEntity = faqBlocks[0].mainEntity as Array<{ name: string }>;
        expect(mainEntity).toHaveLength(faqEntries.length);
        expect(mainEntity.map((entry) => entry.name)).toEqual(
          expect.arrayContaining(faqEntries.map((e) => e.question)),
        );
      });

      it("emits the Article JSON-LD entity whose headline matches the visible h1", async () => {
        const mod = await import(`~/routes/${guide.module}`);
        const GuideRoute = mod.default;
        const markup = renderToStaticMarkup(createElement(GuideRoute));

        const ldBlocks = [
          ...markup.matchAll(
            /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
          ),
        ];
        const articleBlocks = ldBlocks
          .map((match) => JSON.parse(match[1] ?? "{}"))
          .filter((data) => data["@type"] === "Article");

        expect(articleBlocks).toHaveLength(1);
        const headline = articleBlocks[0].headline as string;
        // The Article headline is the rendered h1 (issue #2855: no drift).
        // React escapes ' as &#x27; in markup — normalise before comparing.
        const h1 = (markup.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "")
          .replace(/&#x27;/g, "'")
          .replace(/&amp;/g, "&");
        expect(h1).toContain(headline);
      });

      it(`allowlists the ${guide.source} signup source marker`, async () => {
        const { ALLOWED_SIGNUP_SOURCES, allowlistedSignupSource } = await import(
          "~/lib/signup-source"
        );
        expect(ALLOWED_SIGNUP_SOURCES).toContain(guide.source);
        expect(allowlistedSignupSource(guide.source)).toBe(guide.source);
        expect(allowlistedSignupSource(`${guide.source}&x=1`)).toBeNull();
      });

      it("is internally linked from /docs and /competitor-monitoring", async () => {
        const { readFileSync } = await import("node:fs");
        const docs = readFileSync("app/routes/docs.tsx", "utf8");
        const monitoring = readFileSync(
          "app/routes/competitor-monitoring.tsx",
          "utf8",
        );
        expect(docs).toContain(`to="/guides/${guide.slug}"`);
        expect(monitoring).toContain(`to="/guides/${guide.slug}"`);
      });
    });
  }
});

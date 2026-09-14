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

    const { buyerSurfaceHreflangLinks } = await import("~/lib/seo");
    expect(links()).toEqual([
      {
        rel: "canonical",
        href: "https://0509.io/guides/how-to-monitor-competitor-landing-page-changes",
      },
      ...buyerSurfaceHreflangLinks("guides/how-to-monitor-competitor-landing-page-changes"),
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

        const { buyerSurfaceHreflangLinks } = await import("~/lib/seo");
        expect(links()).toEqual([
          {
            rel: "canonical",
            href: `https://0509.io/guides/${guide.slug}`,
          },
          ...buyerSurfaceHreflangLinks(`guides/${guide.slug}`),
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

describe("guides meta-ad-library-api-limitations route (issue #3127)", () => {
  it("renders the cited explainer: the documented coverage, the non-UK/EU gap, and the public-surface answer", async () => {
    const { default: GuideRoute } = await import(
      "~/routes/guides.meta-ad-library-api-limitations"
    );
    const markup = renderToStaticMarkup(createElement(GuideRoute));

    // The documented coverage — each claim carries Meta's own URL inline.
    expect(markup).toContain("What the official API actually returns.");
    expect(markup).toContain("Political and issue ads — worldwide, seven years");
    expect(markup).toContain("Ads of any type — only where delivered to the UK or EU");
    expect(markup).toContain("ad_reached_countries");
    expect(markup).toContain(
      'href="https://www.facebook.com/ads/library/api/"',
    );
    expect(markup).toContain(
      'href="https://developers.facebook.com/docs/graph-api/reference/ads_archive/"',
    );
    expect(markup).toContain('href="https://www.facebook.com/ads/library/"');
    // The non-UK/EU gap, stated plainly.
    expect(markup).toContain("What that boundary means outside the UK and EU.");
    expect(markup).toContain("A US-only commercial ad does not come back");
    expect(markup).toContain("The commercial history is one year deep");
    // The facts-checked line (the #3019 cited-facts pattern).
    expect(markup).toContain("Facts checked 12 September 2026");
    // The complementary answer and the plan truth.
    expect(markup).toContain(
      "The complementary approach: capture the public surface on a cadence.",
    );
    expect(markup).toContain("One competitor, one first check, free");
    expect(markup).toContain("Recurring checks on a schedule are a paid plan.");
    expect(markup).toContain('href="/capture-rules"');
    expect(markup).toContain('href="/no-phantom-changes"');
    // CTA is the public /search preview carrying the allowlisted marker.
    expect(markup).toContain('action="/search"');
    expect(markup).toContain('name="source"');
    expect(markup).toContain('value="guide-api-limitations"');
    expect(markup).toContain('href="/search?source=guide-api-limitations"');
    // Shared marketing chrome.
    expect(markup).toContain("Named for 05:09");
    // Zero uncited competitor claims: no named competitor tools anywhere in
    // the page body (the shared chrome links the compare cluster site-wide,
    // so scope the check between header and footer).
    const body = markup.split("</header>")[1]?.split("<footer")[0] ?? markup;
    expect(body).not.toMatch(/Panoramata|Foreplay|Spyder|AdSpyder|Visualping|adlibrary\.com/iu);
  });

  it("declares the canonical URL and public SEO meta", async () => {
    const { links, meta } = await import(
      "~/routes/guides.meta-ad-library-api-limitations"
    );

    const { buyerSurfaceHreflangLinks } = await import("~/lib/seo");
    expect(links()).toEqual([
      {
        rel: "canonical",
        href: "https://0509.io/guides/meta-ad-library-api-limitations",
      },
      ...buyerSurfaceHreflangLinks("guides/meta-ad-library-api-limitations"),
    ]);

    const tags = meta({} as never) as Array<Record<string, string>>;
    const title = tags.find((tag) => "title" in tag)?.title;
    expect(title).toBe(
      "Meta Ad Library API limitations: what it covers and where | Five to Nine",
    );
    expect(tags).toContainEqual({
      property: "og:url",
      content: "https://0509.io/guides/meta-ad-library-api-limitations",
    });
  });

  it("is registered as a route (EN + locale cluster) and published in the sitemap", async () => {
    const { readFileSync } = await import("node:fs");
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain(
      'route("guides/meta-ad-library-api-limitations", "routes/guides.meta-ad-library-api-limitations.tsx")',
    );
    expect(routes).toContain(
      'route("guides/meta-ad-library-api-limitations", "routes/$locale.guides.meta-ad-library-api-limitations.tsx")',
    );

    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    expect(sitemap?.body).toContain(
      "<loc>https://0509.io/guides/meta-ad-library-api-limitations</loc>",
    );
  });

  it("emits one FAQPage JSON-LD block whose mainEntity count matches the visible FAQ entries", async () => {
    const { default: GuideRoute, apiLimitationsFaqEntries } = await import(
      "~/routes/guides.meta-ad-library-api-limitations"
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
    expect(mainEntity).toHaveLength(apiLimitationsFaqEntries.length);
    expect(mainEntity.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(apiLimitationsFaqEntries.map((e) => e.question)),
    );
  });

  it("emits the Article JSON-LD entity whose headline matches the visible h1", async () => {
    const { default: GuideRoute } = await import(
      "~/routes/guides.meta-ad-library-api-limitations"
    );
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
    const h1 = (markup.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "")
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&");
    expect(h1).toContain(headline);
  });

  it("allowlists the guide-api-limitations signup source marker", async () => {
    const { ALLOWED_SIGNUP_SOURCES, allowlistedSignupSource } = await import(
      "~/lib/signup-source"
    );
    expect(ALLOWED_SIGNUP_SOURCES).toContain("guide-api-limitations");
    expect(allowlistedSignupSource("guide-api-limitations")).toBe(
      "guide-api-limitations",
    );
    expect(allowlistedSignupSource("guide-api-limitations&x=1")).toBeNull();
  });

  it("is internally linked from /docs and /competitor-monitoring", async () => {
    const { readFileSync } = await import("node:fs");
    const docs = readFileSync("app/routes/docs.tsx", "utf8");
    const monitoring = readFileSync(
      "app/routes/competitor-monitoring.tsx",
      "utf8",
    );
    expect(docs).toContain('to="/guides/meta-ad-library-api-limitations"');
    expect(monitoring).toContain('to="/guides/meta-ad-library-api-limitations"');
  });
});

describe("guides can-ChatGPT-monitor-competitor-ads route (issue #3421)", () => {
  it("renders the honest answer: the three structural limits, what an AI chat does well, and what only a watch owns", async () => {
    const { default: GuideRoute } = await import(
      "~/routes/guides.can-ChatGPT-monitor-competitor-ads"
    );
    const markup = renderToStaticMarkup(createElement(GuideRoute));

    // The three fact blocks — structural limits, not effort or prompting
    // problems, stated as facts that hold for any AI chat.
    expect(markup).toContain("Three things an AI chat structurally cannot do.");
    expect(markup).toContain("A plain HTTP client gets a 403");
    expect(markup).toContain("One point in time — history is not in the window");
    expect(markup).toContain("Unattended vigilance — somebody has to be there at 03:00");
    // Fact (a) carries its checked date on the page (the #3019 cited-facts
    // pattern) with the checked source linked inline.
    expect(markup).toContain("re-checked live on 13 September 2026");
    expect(markup).toContain("The 403 re-checked 13 September 2026:");
    expect(markup).toContain('href="https://www.facebook.com/ads/library/"');
    expect(markup).toContain("returns HTTP 403.");
    // Fact (b): the Ad Library is one point in time — history is never in
    // the window, and a paused ad is gone for good.
    expect(markup).toContain("what the offer said on 12 June");
    expect(markup).toContain("History is not in the window.");
    // Fact (c): unattended vigilance — the 03:00 claim only a system that
    // actually ran can truthfully make.
    expect(markup).toContain("We checked 24 ads at 03:00 and nothing moved");
    expect(markup).toContain("only a system that actually ran can make");
    // The honest AI-strengths half — the AI is never disguised as useless.
    expect(markup).toContain("What an AI chat does well.");
    expect(markup).toContain("Summarising what it finds");
    expect(markup).toContain("Drafting angles");
    expect(markup).toContain("Explaining a diff once someone hands it one");
    // What only an always-on watch owns.
    expect(markup).toContain("What only an always-on watch owns.");
    expect(markup).toContain("The 03:00 check");
    expect(markup).toContain("The dated record");
    expect(markup).toContain("Before/after evidence with source links");
    // The honest plan truth: the free plan is one first check + one first
    // brief; scheduled checks are a paid plan.
    expect(markup).toContain("free plan watches one competitor");
    expect(markup).toContain("scheduled checks are a paid plan");
    // CTA is the public /search preview carrying the allowlisted marker —
    // the MARKER is lowercase even though the PATH slug keeps uppercase
    // ChatGPT (the marker pattern forbids uppercase; the path is deliberate).
    expect(markup).toContain('action="/search"');
    expect(markup).toContain('name="source"');
    expect(markup).toContain('value="guide-can-chatgpt-monitor-ads"');
    expect(markup).toContain('href="/search?source=guide-can-chatgpt-monitor-ads"');
    // Honest scope: Meta Ad Library only — no multi-platform claim.
    expect(markup).toContain("Meta Ad Library only");
    expect(markup).not.toMatch(/multi-platform/iu);
    expect(markup).not.toMatch(/all (major )?platforms/iu);
    // Shared marketing chrome.
    expect(markup).toContain("Named for 05:09");
    // No named competitor tools in the guide's own copy (the shared chrome
    // links the compare/switch cluster site-wide, so scope the check to the
    // page body between the header and footer).
    const body = markup.split("</header>")[1]?.split("<footer")[0] ?? markup;
    expect(body).not.toMatch(/Panoramata|Foreplay|Spyder|Visualping|AdSpyder/iu);
  });

  it("declares the canonical URL and public SEO meta", async () => {
    const { links, meta } = await import(
      "~/routes/guides.can-ChatGPT-monitor-competitor-ads"
    );

    const { buyerSurfaceHreflangLinks } = await import("~/lib/seo");
    expect(links()).toEqual([
      {
        rel: "canonical",
        href: "https://0509.io/guides/can-ChatGPT-monitor-competitor-ads",
      },
      ...buyerSurfaceHreflangLinks("guides/can-ChatGPT-monitor-competitor-ads"),
    ]);

    const tags = meta({} as never) as Array<Record<string, string>>;
    const title = tags.find((tag) => "title" in tag)?.title;
    expect(title).toBe("Can ChatGPT monitor competitor ads? | Five to Nine");
    expect(tags).toContainEqual({
      property: "og:url",
      content: "https://0509.io/guides/can-ChatGPT-monitor-competitor-ads",
    });
  });

  it("is registered as a route (EN + locale cluster) and published in the sitemap", async () => {
    const { readFileSync } = await import("node:fs");
    const routes = readFileSync("app/routes.ts", "utf8");
    // The EXACT uppercase slug is the pinned contract — ChatGPT stays
    // uppercase in the PATH (only the signup-source MARKER is lowercase).
    expect(routes).toContain(
      'route("guides/can-ChatGPT-monitor-competitor-ads", "routes/guides.can-ChatGPT-monitor-competitor-ads.tsx")',
    );
    expect(routes).toContain(
      'route("guides/can-ChatGPT-monitor-competitor-ads", "routes/$locale.guides.can-ChatGPT-monitor-competitor-ads.tsx")',
    );

    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    expect(sitemap?.body).toContain(
      "<loc>https://0509.io/guides/can-ChatGPT-monitor-competitor-ads</loc>",
    );
  });

  it("emits one FAQPage JSON-LD block whose mainEntity count matches the visible FAQ entries", async () => {
    const {
      default: GuideRoute,
      canChatGPTMonitorCompetitorAdsFaqEntries,
    } = await import("~/routes/guides.can-ChatGPT-monitor-competitor-ads");
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
    expect(mainEntity).toHaveLength(
      canChatGPTMonitorCompetitorAdsFaqEntries.length,
    );
    expect(mainEntity.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(
        canChatGPTMonitorCompetitorAdsFaqEntries.map((e) => e.question),
      ),
    );
  });

  it("emits the Article JSON-LD entity whose headline matches the visible h1", async () => {
    const { default: GuideRoute } = await import(
      "~/routes/guides.can-ChatGPT-monitor-competitor-ads"
    );
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
    const h1 = (markup.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "")
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&");
    expect(h1).toContain(headline);
  });

  it("allowlists the guide-can-chatgpt-monitor-ads signup source marker", async () => {
    const { ALLOWED_SIGNUP_SOURCES, allowlistedSignupSource } = await import(
      "~/lib/signup-source"
    );
    expect(ALLOWED_SIGNUP_SOURCES).toContain("guide-can-chatgpt-monitor-ads");
    expect(allowlistedSignupSource("guide-can-chatgpt-monitor-ads")).toBe(
      "guide-can-chatgpt-monitor-ads",
    );
    expect(allowlistedSignupSource("guide-can-chatgpt-monitor-ads&x=1")).toBeNull();
  });

  it("is internally linked from /docs and /competitor-monitoring", async () => {
    const { readFileSync } = await import("node:fs");
    const docs = readFileSync("app/routes/docs.tsx", "utf8");
    const monitoring = readFileSync(
      "app/routes/competitor-monitoring.tsx",
      "utf8",
    );
    expect(docs).toContain('to="/guides/can-ChatGPT-monitor-competitor-ads"');
    expect(monitoring).toContain('to="/guides/can-ChatGPT-monitor-competitor-ads"');
  });
});

// Issue #3122: production 404'd the #2888 third how-to while the sitemap
// still advertised it and the /guides hub hid it — a SPLIT deployment state.
// The per-guide tests above are enumerated (each guide hard-coded), so a
// guide added to the sitemap without a route, or hidden from the index,
// slipped through. This suite is mechanical: it derives the guide set from
// the sitemap source itself and demands triple agreement —
//   sitemap source (app/lib/sitemap.server.ts)
//     <-> route registration (app/routes.ts, EN + $locale)
//     <-> index card (GUIDE_ENTRIES in app/routes/guides.tsx)
// — so the sitemap can never again promise a URL the Worker does not serve,
// and the hub can never undersell the cluster.
describe("guides triple agreement: sitemap <-> route <-> index (issue #3122)", () => {
  const SITEMAP_GUIDE_RE = /"\/guides\/([a-z0-9-]+)"/g;
  const ROUTE_GUIDE_RE = /route\("guides\/([a-z0-9-]+)"/g;

  function uniqueSlugs(source: string, re: RegExp): string[] {
    return [...new Set([...source.matchAll(re)].map((m) => m[1]!))].sort();
  }

  it("registers a route (EN + $locale) and an index card for every /guides/* path the sitemap source lists", async () => {
    const { readFileSync } = await import("node:fs");
    const sitemapSlugs = uniqueSlugs(
      // #2030: the guide list's single source of truth now lives in
      // BUYER_SURFACE_GUIDE_PATHS (app/lib/locale-markets.ts); the #3122
      // gate reads both files so the move cannot blind it.
      readFileSync("app/lib/sitemap.server.ts", "utf8") +
        readFileSync("app/lib/locale-markets.ts", "utf8"),
      SITEMAP_GUIDE_RE,
    );
    // The cluster is 7 guides; grow this floor when the next how-to ships.
    expect(sitemapSlugs.length).toBeGreaterThanOrEqual(7);

    const routes = readFileSync("app/routes.ts", "utf8");
    for (const s of sitemapSlugs) {
      // #3122's observed failure: sitemap lists the URL, no EN route —
      // the catch-all renders "Page not found" for every stranger.
      expect(routes, `sitemap lists /guides/${s} but no EN route registers it`).toContain(
        `route("guides/${s}", "routes/guides.${s}.tsx")`,
      );
      // The $locale registration matches the guide's entry in the locale
      // sitemaps (same source list); without it the /de//ja/... variants 404.
      expect(routes, `sitemap lists /guides/${s} but no $locale route registers it`).toContain(
        `route("guides/${s}", "routes/$locale.guides.${s}.tsx")`,
      );
    }

    // Converse leg (the #2295 anti-drop direction): every guides/* route
    // registration is advertised by the sitemap source — a registered route
    // absent from the sitemap is invisible to crawlers.
    const routeSlugs = uniqueSlugs(
      readFileSync("app/routes.ts", "utf8"),
      ROUTE_GUIDE_RE,
    );
    expect(routeSlugs).toEqual(sitemapSlugs);

    // Third leg: the /guides index links every sitemap guide — a hub that
    // undersells its own cluster is the same #3122 fault from the other side.
    const { GUIDE_ENTRIES } = await import("~/routes/guides");
    const hubHrefs = GUIDE_ENTRIES.map((g) => g.href);
    for (const s of sitemapSlugs) {
      expect(hubHrefs, `/guides index hides its own sitemap guide /guides/${s}`).toContain(
        `/guides/${s}`,
      );
    }
  });
});

// Issue #3167: the corpus shipped as an orphan island — zero inbound links
// from non-guide public surfaces and zero sibling cross-links, so crawlers
// and answer engines could only reach it via sitemap.xml/llms.txt. The
// issue's verify is source-level (`git grep 'href="/guides/'`), so the
// corpus links ship as literal anchors — Link's `to=` renders identical
// markup but produces no `href="` source text for the grep to see. This
// suite pins both legs so the next guide cannot ship unlinked:
//   inbound  — >= 3 non-guide app/routes|app/components files carry literal
//              href="/guides/" links, and the bare /guides hub is linked;
//   internal — every sitemap guide's EN route file links at least one
//              sibling guide, and no file anywhere links a /guides/* path
//              the corpus does not serve.
describe("guides inbound-link invariant (issue #3167)", () => {
  const SITEMAP_GUIDE_RE = /"\/guides\/([a-z0-9-]+)"/g;
  const GUIDE_ARTICLE_HREF_RE = /href="(\/guides\/[a-z0-9-]+)"/g;
  const GUIDE_HUB_HREF_RE = /href="\/guides"/;

  function uniqueSlugs(source: string, re: RegExp): string[] {
    return [...new Set([...source.matchAll(re)].map((m) => m[1]!))].sort();
  }

  function guideArticleHrefs(source: string): string[] {
    return [...source.matchAll(GUIDE_ARTICLE_HREF_RE)].map((m) => m[1]!);
  }

  async function appSourceFiles(): Promise<string[]> {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return walk(path);
        return /\.tsx?$/.test(path) ? [path] : [];
      });
    return [...walk("app/routes"), ...walk("app/components")];
  }

  // The issue verify's own exclusions: the corpus's own routes
  // (app/routes/guides*, app/routes/$locale.guides*) are not inbound surfaces.
  function isInboundSurface(path: string): boolean {
    return (
      !/app\/routes\/guides[^/]*\.tsx?$/.test(path) &&
      !/app\/routes\/\$locale\.guides[^/]*\.tsx?$/.test(path)
    );
  }

  it("keeps at least 3 non-guide public surfaces linking into the corpus, /guides hub included", async () => {
    const { readFileSync } = await import("node:fs");
    const files = (await appSourceFiles()).filter(isInboundSurface);
    const linking = files.filter((path) =>
      guideArticleHrefs(readFileSync(path, "utf8")).length > 0,
    );

    expect(
      linking.length,
      `fewer than 3 non-guide surfaces carry literal href="/guides/" links — found: ${linking.join(", ") || "none"}`,
    ).toBeGreaterThanOrEqual(3);

    // The /guides hub itself must be reachable from at least one of them —
    // bare `href="/guides"` (no trailing segment) is the hub link.
    const hubLinked = linking.some((path) =>
      GUIDE_HUB_HREF_RE.test(readFileSync(path, "utf8")),
    );
    expect(hubLinked, "no inbound surface links the bare /guides hub").toBe(true);
  });

  it("keeps every sitemap guide's EN route file linked to at least one sibling guide", async () => {
    const { readFileSync } = await import("node:fs");
    const sitemapSlugs = uniqueSlugs(
      readFileSync("app/lib/sitemap.server.ts", "utf8") +
        readFileSync("app/lib/locale-markets.ts", "utf8"),
      SITEMAP_GUIDE_RE,
    );

    for (const slug of sitemapSlugs) {
      const path = `app/routes/guides.${slug}.tsx`;
      const hrefs = guideArticleHrefs(readFileSync(path, "utf8"));
      const siblings = hrefs.filter((href) => href !== `/guides/${slug}`);
      expect(
        siblings.length,
        `${path} carries no literal href="/guides/*" sibling link — the cluster is not internally connected`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("never links a /guides/* path the corpus does not serve", async () => {
    const { readFileSync } = await import("node:fs");
    const sitemapSlugs = uniqueSlugs(
      // #2030: same source move as the #3122 gate above — read both files.
      readFileSync("app/lib/sitemap.server.ts", "utf8") +
        readFileSync("app/lib/locale-markets.ts", "utf8"),
      SITEMAP_GUIDE_RE,
    );
    const knownPaths = new Set(sitemapSlugs.map((s) => `/guides/${s}`));

    for (const path of await appSourceFiles()) {
      const source = readFileSync(path, "utf8");
      for (const href of guideArticleHrefs(source)) {
        expect(
          knownPaths.has(href),
          `${path} links ${href} — not a live sitemap guide`,
        ).toBe(true);
      }
    }
  });
});

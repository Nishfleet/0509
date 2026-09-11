import { describe, expect, it } from "vitest";

import {
  isPublicMarkdownPage,
  LLMS_PAGES,
  LLMS_TEXT,
  PUBLIC_MARKDOWN,
  buildLlmsText,
  llmsPageForBrandPath,
  llmsPageForTimelinePath,
  publicMarkdownForPath,
  wantsPublicMarkdown,
} from "~/lib/public-markdown";
import { auditedAgentActionGroups } from "~/lib/agent-action-catalog";
import { AI_TRAINING_CRAWLERS, SITEMAP_PATHS, canonicalUrl } from "~/lib/seo";
// SITEMAP_TIMELINE_PATH_LIMIT caps the /timeline/:domain slice in buildLlmsText
// at the same crawl-budget ceiling the sitemap uses (issue #1929). The
// acceptance-6 test imports the constant directly so a future change that
// invents a parallel cap fails loudly.
import { SITEMAP_TIMELINE_PATH_LIMIT } from "~/lib/sitemap.server";

describe("public markdown", () => {
  it("supports same-url markdown negotiation for public pages", () => {
    expect(isPublicMarkdownPage("/")).toBe(true);
    expect(isPublicMarkdownPage("/help")).toBe(true);
    expect(isPublicMarkdownPage("/docs")).toBe(true);
    expect(isPublicMarkdownPage("/api/docs")).toBe(true);
    expect(isPublicMarkdownPage("/status")).toBe(true);
    expect(isPublicMarkdownPage("/changelog")).toBe(true);
    expect(isPublicMarkdownPage("/trust")).toBe(true);
    expect(isPublicMarkdownPage("/capture-rules")).toBe(true);
    expect(isPublicMarkdownPage("/proof")).toBe(false);
    expect(isPublicMarkdownPage("/search")).toBe(false);
    expect(isPublicMarkdownPage("/privacy")).toBe(true);
    expect(isPublicMarkdownPage("/terms")).toBe(true);
    expect(isPublicMarkdownPage("/app")).toBe(false);
    expect(isPublicMarkdownPage("/api/health")).toBe(false);
  });

  it("covers the issue #2299 pages AI engines most need clean text for", () => {
    // /methodology (the score formula), /pricing, and the /compare/* pages
    // linked from the /compare hub. /search stays excluded (noted in the
    // ticket, deliberately out of scope).
    expect(isPublicMarkdownPage("/methodology")).toBe(true);
    expect(isPublicMarkdownPage("/pricing")).toBe(true);
    expect(isPublicMarkdownPage("/compare/meta-ad-library")).toBe(true);
    expect(isPublicMarkdownPage("/compare/visualping-ad-libraries")).toBe(true);
    expect(isPublicMarkdownPage("/compare/spyland")).toBe(true);
    expect(isPublicMarkdownPage("/compare/pulzifi")).toBe(true);
    expect(isPublicMarkdownPage("/compare/foreplay-spyder")).toBe(true);
    expect(isPublicMarkdownPage("/compare/panoramata")).toBe(true);
    expect(isPublicMarkdownPage("/compare/adspyder")).toBe(true);
    expect(isPublicMarkdownPage("/compare/adspy")).toBe(true);
    // The /compare hub deliberately does not link /compare/visualping or
    // /compare/foreplay (they canonicalize to siblings, issue #1481), so they
    // stay out of the markdown set.
    expect(isPublicMarkdownPage("/compare/visualping")).toBe(false);
    expect(isPublicMarkdownPage("/compare/foreplay")).toBe(false);
    // /search stays excluded (noted in the ticket, deliberately out of scope).
    expect(isPublicMarkdownPage("/search")).toBe(false);
  });

  it("serves a dedicated per-page markdown body for the issue #2299 pages", () => {
    // The original ten pages keep the single PUBLIC_MARKDOWN body.
    expect(publicMarkdownForPath("/")).toBe(PUBLIC_MARKDOWN);
    expect(publicMarkdownForPath("/help")).toBe(PUBLIC_MARKDOWN);
    expect(publicMarkdownForPath("/terms")).toBe(PUBLIC_MARKDOWN);

    // /methodology is assembled from the aggression-score data.
    const methodology = publicMarkdownForPath("/methodology");
    expect(methodology).toContain("Ad Aggression Score methodology");
    expect(methodology).toContain("Velocity");
    expect(methodology).toContain("Testing");
    expect(methodology).toContain("Freshness");
    expect(methodology).toContain("Persistence");
    expect(methodology).toContain("Evidence floor");
    expect(methodology).toContain("14 days of observed history");
    expect(methodology).not.toBe(PUBLIC_MARKDOWN);

    // /pricing is assembled from the published pricing and plan data.
    const pricing = publicMarkdownForPath("/pricing");
    expect(pricing).toContain("Pricing");
    expect(pricing).toContain("Scout");
    expect(pricing).toContain("Starter");
    expect(pricing).toContain("Agency");
    expect(pricing).toContain("proof captures/month");
    expect(pricing).toContain("Proof capture packs");
    expect(pricing).not.toBe(PUBLIC_MARKDOWN);

    // Each /compare/* page gets a body assembled from its source citations.
    const comparePaths = [
      "/compare/meta-ad-library",
      "/compare/visualping-ad-libraries",
      "/compare/spyland",
      "/compare/pulzifi",
      "/compare/foreplay-spyder",
      "/compare/panoramata",
      "/compare/adspyder",
      "/compare/adspy",
    ];
    for (const path of comparePaths) {
      const body = publicMarkdownForPath(path);
      expect(body, path).toContain("Five to Nine vs");
      expect(body, path).toContain("## Sources");
      expect(body, path).toMatch(/\(https?:\/\//);
      expect(body, path).not.toBe(PUBLIC_MARKDOWN);
    }
  });

  it("detects clients asking for markdown", () => {
    expect(
      wantsPublicMarkdown(
        new Request("https://0509.io/", {
          headers: {
            Accept: "text/markdown, text/plain;q=0.8",
          },
        }),
      ),
    ).toBe(true);
    expect(wantsPublicMarkdown(new Request("https://0509.io/"))).toBe(false);
  });

  it("keeps agent-readable content aligned with launch truth", () => {
    expect(PUBLIC_MARKDOWN).toContain("Presence Desk tracks your brand and competitors across declared sources");
    expect(PUBLIC_MARKDOWN).toContain("Website/open-web is the active GA source");
    expect(PUBLIC_MARKDOWN).toContain("does not promise whole-internet scanning");
    expect(LLMS_TEXT).toContain("Presence Desk: website/open-web is the active GA source");
    expect(PUBLIC_MARKDOWN).toContain("verified access paths");
    expect(PUBLIC_MARKDOWN).toContain("visible plan caps");
    expect(PUBLIC_MARKDOWN).toContain("Public read-only search and the proof brief are buyer-evaluation paths before signup");
    expect(PUBLIC_MARKDOWN).toContain("public search is live at /search");
    expect(PUBLIC_MARKDOWN).toContain("The public proof brief renders real cached captures");
    expect(PUBLIC_MARKDOWN).toContain("Dodo checkout routes are deployed");
    expect(PUBLIC_MARKDOWN).toContain("live pricing canary passed");
    expect(PUBLIC_MARKDOWN).toContain("exports support CSV and JSON export");
    expect(PUBLIC_MARKDOWN).toContain("Customer-facing views lead with what changed");
    expect(PUBLIC_MARKDOWN).toContain("Watchlist and digest CSV exports include decision fields");
    expect(PUBLIC_MARKDOWN).not.toContain("Slack delivery can be connected from Integrations");
    expect(PUBLIC_MARKDOWN).toContain("Customer API keys can read account-owned setup status");
    expect(PUBLIC_MARKDOWN).toContain("approved workspace actions");
    expect(PUBLIC_MARKDOWN).toContain("Write-enabled customer API keys can perform");
    expect(PUBLIC_MARKDOWN).toContain("Restricted actions still require signed-in owner review");
    expect(PUBLIC_MARKDOWN).toContain("secret-bearing integration setup");
    expect(PUBLIC_MARKDOWN).toContain("customer API key creation, rotation, and revocation");
    expect(PUBLIC_MARKDOWN).toContain("Signed-in support cases cover paid-customer account help");
    expect(PUBLIC_MARKDOWN).toContain("Paid customer support paths cover");
    expect(PUBLIC_MARKDOWN).toContain("Public help, docs, API docs, status, changelog, trust, and proof-rules pages are available");
    expect(PUBLIC_MARKDOWN).toContain("summarizes customer-facing surfaces without exposing private account activity");
    expect(PUBLIC_MARKDOWN).toContain("Email delivery is in product scope for eligible accounts");
    expect(PUBLIC_MARKDOWN).toContain("Public Markdown separates local capability, configured paths, and live proof");
    expect(PUBLIC_MARKDOWN).toContain("public search is live at /search with real Meta Ad Library checks");
    // Cross-platform ad-library aggregators exist (adlibrary.com and similar);
    // both public markdown surfaces must state the Meta-only ad scope plainly
    // so no buyer or AI answer can over-claim multi-platform coverage.
    expect(PUBLIC_MARKDOWN).toContain("Ad monitoring covers the Meta Ad Library only");
    expect(PUBLIC_MARKDOWN).toContain("other platforms’ ad libraries are not aggregated");
    expect(LLMS_TEXT).toContain("Ad monitoring reads the Meta Ad Library only");
    expect(LLMS_TEXT).toContain("does not aggregate other platforms’ ad libraries");
    expect(LLMS_TEXT).toContain("not ad-library breadth");
    expect(PUBLIC_MARKDOWN).not.toMatch(/Email delivery is available/i);
    expect(PUBLIC_MARKDOWN).toContain("insight-depth summaries cover top hooks, media mix, observed campaign duration, manual metric evidence, creative timeline, and landing-page history");
    expect(PUBLIC_MARKDOWN).toContain("Manual external evidence links can store user-supplied visible spend, impression, and reach values");
    expect(PUBLIC_MARKDOWN).toContain("automated spend, reach, impression, and unsupported-channel benchmarks are not live");
    expect(PUBLIC_MARKDOWN).toContain("Starter is the recommended plan");
    expect(PUBLIC_MARKDOWN).toContain("Scout is the entry plan after the public read-only search and proof brief");
    expect(PUBLIC_MARKDOWN).toContain("6-hour scans, weekly Digest, and 50 proof captures/month");
    expect(PUBLIC_MARKDOWN).toContain("3-hour scans, daily and weekly Digests, email Notifications, exports, and 250 proof captures/month");
    expect(PUBLIC_MARKDOWN).toContain(
      "top 25 competitors checked every 3 hours and the rest every 6 hours",
    );
    expect(LLMS_TEXT).toContain("top 25 competitors every 3 hours (rest every 6 hours)");
    // Free-plan sentence must match the entitlement catalog in
    // app/lib/plan-entitlements.ts (1 watchlist, 1 Collection, 1 included
    // proof capture/month backing the weekly brief). The earlier
    // "(no proof captures/collections)" parenthetical denied what the same
    // sentence granted and contradicted shipped free-plan behavior.
    expect(LLMS_TEXT).toContain("one watchlist with an activation scan on add");
    expect(LLMS_TEXT).toContain("weekly email brief backed by one included proof capture a month");
    expect(LLMS_TEXT).toContain("plus one Collection");
    expect(LLMS_TEXT).not.toContain("(no proof captures/collections)");
    expect(PUBLIC_MARKDOWN).toContain("one included proof capture a month, with one Collection");
    expect(PUBLIC_MARKDOWN).not.toContain("no collections, proof captures");
    expect(PUBLIC_MARKDOWN).toContain("Proof capture packs add purchased proof captures that never expire");
    expect(PUBLIC_MARKDOWN).toContain("Included proof captures reset every month and do not roll over");
    expect(PUBLIC_MARKDOWN).toContain("Scheduled scans are included with your plan");
    expect(PUBLIC_MARKDOWN).toContain("each saved proof-backed capture counts toward your included or purchased proof captures");
    expect(PUBLIC_MARKDOWN).toContain("make monitoring unlimited");
    expect(PUBLIC_MARKDOWN).toContain("80% proof-capture usage");
    expect(PUBLIC_MARKDOWN).not.toContain("30-day");
    expect(PUBLIC_MARKDOWN).not.toContain("30 day");
    expect(PUBLIC_MARKDOWN).not.toContain("Starter includes 10 watchlists, 25 collections, weekly digest delivery");
    expect(PUBLIC_MARKDOWN).not.toContain("Monday scan, weekly Digest");
    expect(PUBLIC_MARKDOWN).not.toContain("any configured WhatsApp delivery proof");
    expect(PUBLIC_MARKDOWN).not.toContain("WhatsApp delivery is not launch-scoped yet");
    expect(PUBLIC_MARKDOWN).toContain("Tracking status is labeled honestly");
    expect(LLMS_TEXT).toContain("Recent results must not be described as fresh live results");
    expect(LLMS_TEXT).toContain("Customer-facing views lead with what changed");
    expect(LLMS_TEXT).toContain("Watchlist and digest CSV exports include priority");
    expect(LLMS_TEXT).toContain("Public read-only search and the proof brief are buyer-evaluation paths");
    expect(LLMS_TEXT).toContain("the proof brief renders real cached captures");
    expect(LLMS_TEXT).toContain("public search is live at /search");
    expect(LLMS_TEXT).toContain("Dodo checkout routes are deployed");
    expect(LLMS_TEXT).toContain("live pricing canary passed");
    expect(LLMS_TEXT).toContain("Public read-only analysis preview");
    expect(LLMS_TEXT).toContain("Signed-in saved analysis");
    expect(LLMS_TEXT).toContain("user-supplied metric context");
    expect(LLMS_TEXT).toContain("automated spend, reach, impression, and unsupported-channel benchmarks are not live");
    expect(LLMS_TEXT).toContain("setup status plus collection, watchlist, and digest exports");
    expect(LLMS_TEXT).toContain("Purchased proof captures never expire");
    expect(LLMS_TEXT).toContain("included proof captures reset monthly without rollover");
    expect(LLMS_TEXT).toContain("each saved proof-backed capture counts toward the cap");
    expect(LLMS_TEXT).not.toContain("usage bundles add 30-day");
    expect(LLMS_TEXT).not.toContain("Starter includes weekly digest delivery");
    expect(LLMS_TEXT).toContain("approved account actions");
    auditedAgentActionGroups().forEach((group) => {
      expect(PUBLIC_MARKDOWN).toContain(group.label);
      expect(LLMS_TEXT).toContain(group.label);
    });
    expect(LLMS_TEXT).toContain("customer API key creation, rotation, and revocation");
    expect(LLMS_TEXT).toContain("Signed-in support cases cover billing changes and cancellation");
    expect(LLMS_TEXT).not.toContain("Slack delivery can be connected from Integrations");
    expect(LLMS_TEXT).toContain("summarizes customer-facing surfaces without exposing private account activity");
    expect(LLMS_TEXT).toContain("Email delivery is in product scope for eligible accounts");
    expect(LLMS_TEXT).not.toMatch(/Email delivery is available/i);
    expect(LLMS_TEXT).not.toContain("WhatsApp delivery is not launch-scoped yet");
    expect(LLMS_TEXT).not.toContain("/api/mcp");
    expect(LLMS_TEXT).not.toContain("send_email");
    expect(LLMS_TEXT).not.toContain("MCP are not live yet");
    expect(LLMS_TEXT).not.toContain("Slack incoming-webhook delivery is live");
    expect(LLMS_TEXT).toContain("Social connectors remain disabled");
    expect(LLMS_TEXT).not.toContain("Automated TikTok, Google, YouTube, Reddit, X, LinkedIn, and Pinterest ingestion");
    expect(LLMS_TEXT).not.toContain("web/blog/Substack/Reddit observations");
    expect(LLMS_TEXT).not.toContain("Public analysis.");
    expect(`${PUBLIC_MARKDOWN}\n${LLMS_TEXT}`).not.toMatch(/pilot|self-serve/i);
    // AI access policy (docs/ai-crawler-policy.md): llms.txt documents that
    // answer engines are welcome while training crawlers are denied, so the
    // file cannot be read as implying unrestricted AI participation.
    expect(LLMS_TEXT).toContain("AI answer and reference engines may use this file");
    expect(LLMS_TEXT).toContain("ai-train=no");
    // The denied training-crawler list must match the shared constant
    // (app/lib/seo.ts AI_TRAINING_CRAWLERS); this pins every agent by name so
    // a removed entry fails loudly. Google-Extended is a grounding engine
    // (issue #2061), not a training crawler, so it must stay off this list.
    AI_TRAINING_CRAWLERS.forEach((agent) => {
      expect(LLMS_TEXT, `${agent} should be named in the llms.txt deny list`).toContain(agent);
    });
    expect(LLMS_TEXT).not.toContain("Google-Extended");
  });

  it("gives llms.txt a real link list on the canonical origin", () => {
    // The item this pins: llms.txt must not be prose-only — AI answer engines
    // need URLs they can actually fetch and verify.
    expect(LLMS_TEXT).toMatch(/\[[^\]]+\]\(https:\/\/0509\.io\//);

    // One entry per canonical public page, derived from the same SITEMAP_PATHS
    // constant that builds sitemap.xml, so the two surfaces cannot drift.
    expect(LLMS_PAGES.map((page) => page.path)).toEqual([...SITEMAP_PATHS]);
    LLMS_PAGES.forEach((page) => {
      expect(page.url).toBe(canonicalUrl(page.path));
      expect(LLMS_TEXT).toContain(`[${page.title}](${page.url}): ${page.description}`);
    });

    // Every markdown link in the static llms.txt fallback resolves to a
    // sitemap path — no invented or dead routes can sneak in. Dynamic
    // /ads/:domain entries are appended only via buildLlmsText.
    const linkedPaths = [...LLMS_TEXT.matchAll(/\]\((https:\/\/0509\.io[^)]*)\)/g)].map(
      (match) => new URL(match[1]).pathname,
    );
    expect(linkedPaths.length).toBe(SITEMAP_PATHS.length);
    for (const path of linkedPaths) {
      expect(SITEMAP_PATHS as readonly string[]).toContain(path);
    }
  });

  it("lists every dynamic sitemap brand path in rendered llms.txt", () => {
    const brandEntries = [
      { path: "/ads/nykaa.com" },
      { path: "/ads/nike.com" },
      { path: "/ads/gymshark.com" },
      { path: "/ads/lenskart.com" },
    ];
    const rendered = buildLlmsText(brandEntries);

    for (const entry of brandEntries) {
      const page = llmsPageForBrandPath(entry.path);
      expect(page).not.toBeNull();
      expect(rendered).toContain(`[${page!.title}](${page!.url}): ${page!.description}`);
      expect(page!.description).toContain("Meta Ad Library");
      expect(page!.description).toContain("7 days");
      expect(page!.description).toMatch(/not a worldwide/i);
    }

    const linkedPaths = [...rendered.matchAll(/\]\((https:\/\/0509\.io[^)]*)\)/g)].map(
      (match) => new URL(match[1]).pathname,
    );
    expect(linkedPaths).toEqual([...SITEMAP_PATHS, ...brandEntries.map((entry) => entry.path)]);
  });

  it("includes ad count and freshness in /ads/:domain llms descriptions", () => {
    const rendered = buildLlmsText([
      { path: "/ads/nykaa.com", adCount: 3, fetchedAt: "2026-08-26T14:40:00.000Z" },
      { path: "/ads/nike.com", adCount: 1, fetchedAt: "2026-08-25T10:00:00.000Z" },
    ]);

    expect(rendered).toContain("3 live Meta Ad Library ads for nykaa.com from public search, captured on 2026-08-26.");
    expect(rendered).not.toContain("1 live Meta Ad Library ad for nike.com");
    expect(rendered).not.toContain("https://0509.io/ads/nike.com");
    expect(rendered).toContain("Listed only while the capture is fresh enough to index (within 7 days)");
    expect(rendered).toMatch(/Not a worldwide/i);
    expect(rendered).not.toMatch(/worldwide coverage/i);
  });

  it("drops brand entries with fewer than 3 live Meta Ad Library ads (issue #2307)", () => {
    // One- and two-ad pages are the weakest possible citation and dilute the
    // file's authority. A brand entry is only listed once it has >=3 live
    // Meta Ad Library ads (the same count rendered in each llms.txt line).
    const rendered = buildLlmsText([
      { path: "/ads/nykaa.com", adCount: 3, fetchedAt: "2026-08-26T14:40:00.000Z" },
      { path: "/ads/nike.com", adCount: 2, fetchedAt: "2026-08-25T10:00:00.000Z" },
      { path: "/ads/puma.com", adCount: 1, fetchedAt: "2026-08-25T10:00:00.000Z" },
      { path: "/ads/adidas.com", adCount: 0, fetchedAt: "2026-08-25T10:00:00.000Z" },
    ]);

    expect(rendered).toContain("https://0509.io/ads/nykaa.com");
    expect(rendered).not.toContain("https://0509.io/ads/nike.com");
    expect(rendered).not.toContain("https://0509.io/ads/puma.com");
    expect(rendered).not.toContain("https://0509.io/ads/adidas.com");
    expect(rendered).not.toMatch(/1 live Meta Ad Library ad/);
    expect(rendered).not.toMatch(/2 live Meta Ad Library ads/);
  });

  it("does not list noindex /ads shells or non-brand paths in llms.txt", () => {
    const rendered = buildLlmsText([
      { path: "/ads" },
      { path: "/ads/nike.com/extra" },
      { path: "/search" },
      { path: "/ads/" },
    ]);

    expect(rendered).not.toContain("https://0509.io/ads/");
    expect(llmsPageForBrandPath("/ads")).toBeNull();
    expect(llmsPageForBrandPath("/ads/nike.com/extra")).toBeNull();
    expect(llmsPageForBrandPath("/ads/")).toBeNull();
    expect(buildLlmsText()).toBe(LLMS_TEXT);
  });

  it("emits no [undefined] title lines in llms.txt (issue #1575)", () => {
    // Every SITEMAP_PATHS entry must have a non-empty title and description
    // in LLMS_PAGE_DETAILS, so `buildLlmsText()` never stringifies `undefined`
    // into the public AI citation index.
    const rendered = buildLlmsText();
    expect(rendered).not.toContain("[undefined]");
    expect(rendered).not.toMatch(/: undefined\s*$/m);
    LLMS_PAGES.forEach((page) => {
      expect(page.title).not.toBe("undefined");
      expect(page.description).not.toBe("undefined");
      expect(page.title).not.toBe(null);
      expect(page.description).not.toBe(null);
    });
  });

  it("labels configured capability separately from live proof", () => {
    const markdown = `${PUBLIC_MARKDOWN}\n${LLMS_TEXT}`;

    // Public search and Dodo checkout are the live, AI-citable surfaces.
    // Dodo checkout is backed by deployed routes and the live pricing canary
    // passed against production with real Dodo bindings (monthly, annual, and
    // top-up prices validated in IN, US, and GB).
    expect(markdown).toContain("Public search and Dodo checkout are live");
    expect(markdown).toContain(
      "AI answer engines can cite public search as a live read-only buyer path",
    );
    expect(markdown).toContain("Dodo checkout routes are deployed");
    expect(markdown).toContain("live pricing canary passed");
    expect(markdown).toContain(
      "AI answer engines can cite Dodo checkout as the live billing path",
    );
    expect(markdown).not.toContain(
      "final owner-run provider smoke is recorded",
    );
    expect(markdown).toContain("this text does not claim live export success");
    expect(markdown).not.toMatch(
      /\b(?:saved watchlists?|digests?|reports?|share links?|exports?)\b[^.\n]{0,70}\b(?:is|are)\s+(?:live|available)\b/i,
    );
    expect(markdown).not.toMatch(
      /\bemail delivery\b[^.\n]{0,50}\b(?:is|are)\s+(?:live|available)\b/i,
    );
  });

  it("renders /timeline/:domain entries with newest-capture date, skips non-qualifying paths, and keeps the static fallback byte-identical (issue #1929)", () => {
    // Acceptance 5a: a single valid timeline entry renders with the
    // offer-timeline title, "at least one dated offer state" wording, and the
    // lastmod-derived capture date (reviewer-flagged honest singular form).
    const singleValid = buildLlmsText([], [
      { path: "/timeline/example.com", lastmod: "2026-08-26" },
    ]);
    const singleValidTimelineLine =
      "- [example.com offer timeline](https://0509.io/timeline/example.com): " +
      "Offer timeline for example.com with at least one dated offer state from public captures, last captured on 2026-08-26.";
    expect(singleValid).toContain(`Timelines:\n${singleValidTimelineLine}`);
    expect(singleValid).toContain("at least one dated offer state");
    expect(singleValid).toContain("last captured on 2026-08-26");

    // Acceptance 5b: paths that fail the regex must produce zero /timeline/
    // links, and llmsPageForTimelinePath must reject them directly so callers
    // cannot sneak them past the splice.
    const invalidOnly = buildLlmsText([], [
      { path: "/timeline/" },
      { path: "/de/timeline/example.com" },
      { path: "/timeline/a/b" },
    ]);
    expect(invalidOnly).not.toContain("Timelines:");
    expect(invalidOnly).not.toContain("https://0509.io/timeline/");
    expect(llmsPageForTimelinePath("/timeline/")).toBeNull();
    expect(llmsPageForTimelinePath("/de/timeline/example.com")).toBeNull();
    expect(llmsPageForTimelinePath("/timeline/a/b")).toBeNull();

    // Acceptance 5c: the empty-arg call must still be byte-identical to the
    // static funnel. Already pinned at line ~245 in the noindex-shells test;
    // re-asserted here so the new two-arg path is guarded explicitly.
    expect(buildLlmsText()).toBe(LLMS_TEXT);

    // Mixed input: brand and timeline entries coexist. The brand line keeps
    // its ad-count phrasing; the timeline line gets the new dated-offers
    // format; and the timeline line must render AFTER the brand line in the
    // absolute output (timeline section is spliced below the Pages section).
    const mixedBrandLine =
      "3 live Meta Ad Library ads for nike.com from public search, captured on 2026-08-26.";
    const mixedTimelineLine =
      "- [calendly.com offer timeline](https://0509.io/timeline/calendly.com): " +
      "Offer timeline for calendly.com with at least one dated offer state from public captures, last captured on 2026-08-25.";
    const mixed = buildLlmsText(
      [{ path: "/ads/nike.com", adCount: 3, fetchedAt: "2026-08-26T14:40:00.000Z" }],
      [{ path: "/timeline/calendly.com", lastmod: "2026-08-25" }],
    );
    expect(mixed).toContain(mixedBrandLine);
    expect(mixed).toContain(mixedTimelineLine);
    expect(mixed.indexOf(mixedBrandLine)).toBeLessThan(mixed.indexOf(mixedTimelineLine));
  });

  it("renders exactly one blank line between the Timelines section and 'Current product truth:' (issue #1929)", () => {
    // The reviewer-flagged splice risks double blank lines if a future change
    // touches the spacing. Pin the byte spacing: between the last -line of
    // the Timelines block and "Current product truth:" there must be exactly
    // ONE blank line — one \n worth of visible gap, so two \n characters in
    // the rendered string between those two lines.
    const rendered = buildLlmsText([], [
      { path: "/timeline/example.com", lastmod: "2026-08-26" },
    ]);
    const lines = rendered.split("\n");

    const timelineLine =
      "- [example.com offer timeline](https://0509.io/timeline/example.com): " +
      "Offer timeline for example.com with at least one dated offer state from public captures, last captured on 2026-08-26. " +
      "Listed only when a complete proof capture backs at least one dated offer state.";
    const lastTimelineIndex = lines.lastIndexOf(timelineLine);
    expect(lastTimelineIndex).toBeGreaterThan(-1);
    expect(lines[lastTimelineIndex + 1]).toBe("");
    expect(lines[lastTimelineIndex + 2]).toBe("Current product truth:");

    // And the gap between the last -line of Pages and the Timelines header
    // must be exactly one newline (no blank line between Pages: and
    // Timelines:); the splice uses a single `\n` prefix so pagesSection
    // ends right against `Timelines:`.
    const timelinesHeaderIndex = lines.indexOf("Timelines:");
    expect(timelinesHeaderIndex).toBeGreaterThan(-1);
    expect(lines[timelinesHeaderIndex - 1]).not.toBe("");

    // Belt-and-braces regex check that names both anchor lines so a future
    // rename of either header surfaces as a clear test failure rather than
    // a confusing index-out-of-bounds from the split-based assertions above.
    const sectionGap = rendered.match(/Timelines:[\s\S]*?Current product truth:/);
    expect(sectionGap).not.toBeNull();
    expect(sectionGap![0]).toMatch(
      /2026-08-26\.[^\n]*\n\nCurrent product truth:/,
    );
  });

  it("caps the rendered Timelines section at SITEMAP_TIMELINE_PATH_LIMIT entries (issue #1929, acceptance 6)", () => {
    // Acceptance 6: timeline output is bounded by the same crawl-budget
    // ceiling the sitemap uses. (limit + 10) fake entries with valid regex-
    // matching paths must render exactly `limit` /timeline/ links — the
    // filter-first slice order drops invalid paths before the cap is applied,
    // so we test the cap with all-valid input here.
    const overLimit = SITEMAP_TIMELINE_PATH_LIMIT + 10;
    const tooMany = Array.from({ length: overLimit }, (_, index) => ({
      path: `/timeline/domain-${index}.com`,
      lastmod: "2026-08-26",
    }));
    const rendered = buildLlmsText([], tooMany);

    const renderedTimelineLinks = rendered.match(/\]\(https:\/\/0509\.io\/timeline\//g);
    expect(renderedTimelineLinks).not.toBeNull();
    expect(renderedTimelineLinks!.length).toBe(SITEMAP_TIMELINE_PATH_LIMIT);

    // Filter-first slice order: invalid paths are dropped before slicing. Mix
    // N valid + M invalid entries (with M big enough that filtering drops
    // enough valid entries to slip under the cap) and assert the output has
    // exactly N /timeline/ links. The valid count is capped at
    // SITEMAP_TIMELINE_PATH_LIMIT so the test stays stable if the shared cap
    // moves (acceptance 6).
    const validCount = Math.min(200, SITEMAP_TIMELINE_PATH_LIMIT);
    const invalidCount = 400;
    const mixedInput = [
      ...Array.from({ length: validCount }, (_, index) => ({
        path: `/timeline/valid-${index}.com`,
        lastmod: "2026-08-26",
      })),
      ...Array.from({ length: invalidCount }, (_, index) => ({
        path: index % 2 === 0 ? "/timeline/" : `/timeline/extra-${index}/nested`,
        lastmod: "2026-08-26",
      })),
    ];
    expect(mixedInput.length).toBe(validCount + invalidCount);
    const mixedRendered = buildLlmsText([], mixedInput);
    const mixedTimelineLinks = mixedRendered.match(/\]\(https:\/\/0509\.io\/timeline\//g);
    expect(mixedTimelineLinks).not.toBeNull();
    expect(mixedTimelineLinks!.length).toBe(validCount);
  });

  it("keeps the brand-page contract unchanged when timelines are also passed (issue #1929)", () => {
    // Brand-page contract: passing brand entries (with or without timeline
    // entries) must emit the brand line; only the timeline entry moves the
    // timeline line. The two cases share the brand surface exactly so a
    // future change that accidentally re-orders the splice breaks here.
    const brandPage = llmsPageForBrandPath("/ads/nike.com");
    expect(brandPage).not.toBeNull();
    const brandLine = `- [${brandPage!.title}](${brandPage!.url}): ${brandPage!.description}`;

    const brandOnly = buildLlmsText([{ path: "/ads/nike.com" }]);
    const brandAndTimeline = buildLlmsText(
      [{ path: "/ads/nike.com" }],
      [{ path: "/timeline/calendly.com", lastmod: "2026-08-26" }],
    );

    expect(brandOnly).toContain(brandLine);
    expect(brandAndTimeline).toContain(brandLine);
    expect(brandOnly).not.toContain("https://0509.io/timeline/calendly.com");
    expect(brandAndTimeline).toContain("https://0509.io/timeline/calendly.com");
  });

  it("describes a capture-backed /timeline entry honestly and never lists a zero-state domain in llms.txt (issues #2021, #2881)", () => {
    // Issue #2881: llms.txt mirrors the sitemap's capture-backed-only set —
    // a domain with 0 recorded offer states (collecting page, noindex on the
    // route) is never listed, so no zero-state URL ships into an answer
    // engine's crawl surface.
    const rendered = buildLlmsText(
      [{ path: "/ads/gymshark.com" }],
      [],
    );
    expect(rendered).not.toContain("https://0509.io/timeline/gymshark.com");
    expect(rendered).not.toContain("no offer states recorded yet");

    // Capture-backed entries keep the dated-ledger wording.
    const backed = llmsPageForTimelinePath("/timeline/calendly.com", "2026-09-01");
    expect(backed!.description).toContain("at least one dated offer state");
    expect(backed!.description).toContain("last captured on 2026-09-01");

    const backedRendered = buildLlmsText(
      [{ path: "/ads/calendly.com" }],
      [{ path: "/timeline/calendly.com", lastmod: "2026-09-01" }],
    );
    expect(backedRendered).toContain("https://0509.io/timeline/calendly.com");
    expect(backedRendered).not.toMatch(
      /calendly\.com[^\n]*no offer states recorded yet/,
    );
  });
});

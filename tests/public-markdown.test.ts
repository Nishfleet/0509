import { describe, expect, it } from "vitest";

import {
  isPublicMarkdownPage,
  LLMS_PAGES,
  LLMS_TEXT,
  PUBLIC_MARKDOWN,
  buildLlmsText,
  llmsPageForBrandPath,
  wantsPublicMarkdown,
} from "~/lib/public-markdown";
import { auditedAgentActionGroups } from "~/lib/agent-action-catalog";
import { AI_TRAINING_CRAWLERS, SITEMAP_PATHS, canonicalUrl } from "~/lib/seo";

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
    // The denied training-crawler list must match the Cloudflare managed-robots
    // deny list and the shared constant (app/lib/seo.ts AI_TRAINING_CRAWLERS);
    // this pins every agent by name so a removed entry fails loudly.
    AI_TRAINING_CRAWLERS.forEach((agent) => {
      expect(LLMS_TEXT, `${agent} should be named in the llms.txt deny list`).toContain(agent);
    });
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
    expect(rendered).toContain("1 live Meta Ad Library ad for nike.com from public search, captured on 2026-08-25.");
    expect(rendered).toContain("Listed only while the capture is fresh enough to index (within 7 days)");
    expect(rendered).toMatch(/Not a worldwide/i);
    expect(rendered).not.toMatch(/worldwide coverage/i);
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
});

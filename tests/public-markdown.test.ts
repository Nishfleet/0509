import { describe, expect, it } from "vitest";

import {
  isPublicMarkdownPage,
  LLMS_TEXT,
  PUBLIC_MARKDOWN,
  wantsPublicMarkdown,
} from "~/lib/public-markdown";
import { auditedAgentActionGroups } from "~/lib/agent-action-catalog";

describe("public markdown", () => {
  it("supports same-url markdown negotiation for public pages", () => {
    expect(isPublicMarkdownPage("/")).toBe(true);
    expect(isPublicMarkdownPage("/help")).toBe(true);
    expect(isPublicMarkdownPage("/docs")).toBe(true);
    expect(isPublicMarkdownPage("/api/docs")).toBe(true);
    expect(isPublicMarkdownPage("/status")).toBe(true);
    expect(isPublicMarkdownPage("/changelog")).toBe(true);
    expect(isPublicMarkdownPage("/trust")).toBe(true);
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
    expect(PUBLIC_MARKDOWN).toContain("verified access paths");
    expect(PUBLIC_MARKDOWN).toContain("visible plan caps");
    expect(PUBLIC_MARKDOWN).toContain("Public read-only search and a sample brief");
    expect(PUBLIC_MARKDOWN).toContain("Public brief previews are sample-only");
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
    expect(PUBLIC_MARKDOWN).toContain("Public help, docs, API docs, status, changelog, and trust pages are available");
    expect(PUBLIC_MARKDOWN).toContain("summarizes customer-facing surfaces without exposing private account activity");
    expect(PUBLIC_MARKDOWN).toContain("Email delivery is available for eligible accounts");
    expect(PUBLIC_MARKDOWN).toContain("insight-depth summaries cover top hooks, media mix, observed campaign duration, manual metric evidence, creative timeline, and landing-page history");
    expect(PUBLIC_MARKDOWN).toContain("Manual external evidence links can store user-supplied visible spend, impression, and reach values");
    expect(PUBLIC_MARKDOWN).toContain("automated spend, reach, impression, and unsupported-channel benchmarks are not live");
    expect(PUBLIC_MARKDOWN).toContain("Starter is the recommended plan");
    expect(PUBLIC_MARKDOWN).toContain("Scout is the entry plan after the public read-only search and sample brief");
    expect(PUBLIC_MARKDOWN).toContain("Monday scan, weekly Digest, and 50 checks/month");
    expect(PUBLIC_MARKDOWN).toContain("daily scans, daily and weekly Digests, email Notifications, exports, and 250 checks/month");
    expect(PUBLIC_MARKDOWN).toContain("Check packs add purchased checks that never expire");
    expect(PUBLIC_MARKDOWN).toContain("Included checks reset every month and do not roll over");
    expect(PUBLIC_MARKDOWN).toContain("Scheduled scans are included with your plan");
    expect(PUBLIC_MARKDOWN).toContain("saved proof-backed captures use checks");
    expect(PUBLIC_MARKDOWN).not.toContain("30-day");
    expect(PUBLIC_MARKDOWN).not.toContain("30 day");
    expect(PUBLIC_MARKDOWN).not.toContain("Starter includes 10 watchlists, 25 collections, weekly digest delivery");
    expect(PUBLIC_MARKDOWN).not.toContain("any configured WhatsApp delivery proof");
    expect(PUBLIC_MARKDOWN).not.toContain("WhatsApp delivery is not launch-scoped yet");
    expect(PUBLIC_MARKDOWN).toContain("Tracking status is labeled honestly");
    expect(LLMS_TEXT).toContain("Recent results must not be described as fresh live results");
    expect(LLMS_TEXT).toContain("Customer-facing views lead with what changed");
    expect(LLMS_TEXT).toContain("Watchlist and digest CSV exports include priority");
    expect(LLMS_TEXT).toContain("Public read-only search is available");
    expect(LLMS_TEXT).toContain("sample brief previews are sample-only");
    expect(LLMS_TEXT).toContain("Public read-only analysis preview");
    expect(LLMS_TEXT).toContain("Signed-in saved analysis");
    expect(LLMS_TEXT).toContain("user-supplied metric context");
    expect(LLMS_TEXT).toContain("automated spend, reach, impression, and unsupported-channel benchmarks are not live");
    expect(LLMS_TEXT).toContain("setup status plus collection, watchlist, and digest exports");
    expect(LLMS_TEXT).toContain("Purchased checks never expire");
    expect(LLMS_TEXT).toContain("included checks reset monthly without rollover");
    expect(LLMS_TEXT).toContain("saved proof-backed captures use checks");
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
    expect(LLMS_TEXT).toContain("Email delivery is available for eligible accounts");
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
  });
});

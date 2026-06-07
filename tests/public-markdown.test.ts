import { describe, expect, it } from "vitest";

import {
  isPublicMarkdownPage,
  LLMS_TEXT,
  PUBLIC_MARKDOWN,
  wantsPublicMarkdown,
} from "~/lib/public-markdown";

describe("public markdown", () => {
  it("supports same-url markdown negotiation for public pages", () => {
    expect(isPublicMarkdownPage("/")).toBe(true);
    expect(isPublicMarkdownPage("/search")).toBe(false);
    expect(isPublicMarkdownPage("/privacy")).toBe(true);
    expect(isPublicMarkdownPage("/terms")).toBe(true);
    expect(isPublicMarkdownPage("/app")).toBe(false);
    expect(isPublicMarkdownPage("/api/health")).toBe(false);
  });

  it("detects clients asking for markdown", () => {
    expect(
      wantsPublicMarkdown(
        new Request("https://0509.in/", {
          headers: {
            Accept: "text/markdown, text/plain;q=0.8",
          },
        }),
      ),
    ).toBe(true);
    expect(wantsPublicMarkdown(new Request("https://0509.in/"))).toBe(false);
  });

  it("keeps agent-readable content aligned with launch truth", () => {
    expect(PUBLIC_MARKDOWN).toContain("verified access paths");
    expect(PUBLIC_MARKDOWN).toContain("visible plan caps");
    expect(PUBLIC_MARKDOWN).toContain("Public read-only live search trial");
    expect(PUBLIC_MARKDOWN).toContain("Public sample proof loop");
    expect(PUBLIC_MARKDOWN).toContain("example tracked competitor and digest preview before signup");
    expect(PUBLIC_MARKDOWN).toContain("/api/demo-proof");
    expect(PUBLIC_MARKDOWN).toContain("Public demo proof is sample-only, including the example tracked competitor and digest preview");
    expect(PUBLIC_MARKDOWN).toContain("exports support CSV, API JSON, and Slack-ready markdown");
    expect(PUBLIC_MARKDOWN).toContain("Slack incoming-webhook setup exists");
    expect(PUBLIC_MARKDOWN).toContain("successful live delivery proof");
    expect(PUBLIC_MARKDOWN).toContain("Customer API keys can read account-owned");
    expect(PUBLIC_MARKDOWN).toContain("insight-depth summaries cover top hooks, media mix, observed campaign duration, manual metric proof, creative timeline, and landing-page history");
    expect(PUBLIC_MARKDOWN).toContain("Manual external proof links can store user-supplied visible spend, impression, and reach values");
    expect(PUBLIC_MARKDOWN).toContain("automated spend, reach, impression, and unsupported-channel benchmarks are not live");
    expect(PUBLIC_MARKDOWN).toContain("Starter is the recommended plan");
    expect(PUBLIC_MARKDOWN).toContain("Scout is the entry plan after the public read-only search and sample proof loop");
    expect(PUBLIC_MARKDOWN).toContain("weekly digest delivery, and 50 evidence checks/month");
    expect(PUBLIC_MARKDOWN).toContain("Launch status is readiness-gated");
    expect(PUBLIC_MARKDOWN).toContain("any configured WhatsApp delivery proof");
    expect(PUBLIC_MARKDOWN).toContain("Customer WhatsApp delivery stays behind provider configuration");
    expect(PUBLIC_MARKDOWN).toContain("Tracking status is labeled honestly");
    expect(LLMS_TEXT).toContain("Recent results must not be described as fresh live proof");
    expect(LLMS_TEXT).toContain("Public read-only live search is available");
    expect(LLMS_TEXT).toContain("example tracked competitor and digest preview");
    expect(LLMS_TEXT).toContain("Public read-only analysis preview");
    expect(LLMS_TEXT).toContain("Account-gated saved analysis");
    expect(LLMS_TEXT).toContain("user-supplied metric proof");
    expect(LLMS_TEXT).toContain("automated spend, reach, impression, and unsupported-channel benchmarks are not live");
    expect(LLMS_TEXT).toContain("read-only /api/v1");
    expect(LLMS_TEXT).toContain("read-only /api/mcp");
    expect(LLMS_TEXT).toContain("broad launch still requires a configured Slack target");
    expect(LLMS_TEXT).toContain("Customer WhatsApp delivery must stay behind provider configuration");
    expect(LLMS_TEXT).not.toContain("MCP are not live yet");
    expect(LLMS_TEXT).not.toContain("Slack incoming-webhook delivery is live");
    expect(LLMS_TEXT).not.toContain("Public analysis.");
    expect(`${PUBLIC_MARKDOWN}\n${LLMS_TEXT}`).not.toMatch(/pilot|self-serve/i);
  });
});

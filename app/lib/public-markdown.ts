const PUBLIC_MARKDOWN_PATHS = new Set(["/", "/privacy", "/terms"]);

export const PUBLIC_MARKDOWN = `---
title: Five to Nine
description: Market intelligence for revenue teams.
---

# Five to Nine

Five to Nine turns competitor ads and visible landing-page changes into proof-backed morning intelligence.

## Product

- Competitor monitoring for growth teams.
- Public read-only live search trial and Public sample proof loop at /api/demo-proof for buyer evaluation.
- Account-gated saved search, retained monitoring, and reusable saved evidence.
- Saving competitor results, saved queries, watchlists, collections, reports, and delivery require an account.
- Authenticated collection, watchlist, and digest exports support CSV, API JSON, and Slack-ready markdown.
- Signed-in collections can store manual external proof links from TikTok, Google/YouTube, LinkedIn, Pinterest, Meta, landing pages, or other visible sources.
- Customer API keys can read account-owned collection, watchlist, and digest exports at /api/v1.
- Customer API keys can also use the read-only MCP endpoint at /api/mcp for account-owned collection, watchlist, and digest exports.
- Slack incoming-webhook delivery can send eligible digests and high-priority change alerts for configured account destinations.
- Account insight-depth summaries cover top hooks, media mix, observed campaign duration, creative timeline, and landing-page history from saved proof, watch events, and digest items.
- Alerts and reports should include evidence instead of unsupported AI summaries.
- Daily briefs and weekly digests should show priority, recommended next move, and proof trail.

## Current product truth

- Account access uses verified access paths.
- Public demo proof is sample-only. Public live search is read-only; retained monitoring and saved evidence require an account.
- Checkout, plan access, and evidence-check limits follow the configured billing provider and visible plan caps.
- Launch status is readiness-gated: billing is verified, but broad launch still depends on fresh proof capture, digest delivery, and provider-canary success.
- Tracking status is labeled honestly as live, recent, delayed, or sample data.
- Recent results must not be described as fresh live proof.
- Backup Meta access is optional, owner-provided, tested before saving, stored encrypted, and used only for that account.
- Slack webhook URLs are stored encrypted and are not shown again after saving.
- Observed campaign duration is based on first-seen and last-observed proof only. Manual external proof links are saved evidence, not automated non-Meta ingestion. Spend, impressions, reach, and unsupported-channel benchmarks are not live.
- Customer WhatsApp delivery stays behind opt-in, template-readiness, and webhook-readiness checks.

## Pricing

- Pricing display is localized from checkout preview for the buyer location.
- There is no free retained-monitoring plan. Public live search is read-only; saved monitoring requires an account.
- Starter is the recommended plan for retained competitor monitoring.
- Scout is the entry plan after the public read-only search and sample proof loop: 3 watchlists, 10 collections, account-gated research, weekly digest delivery, and 50 evidence checks/month.
- Starter includes 10 watchlists, 25 collections, weekly digest delivery, and 250 evidence checks/month.
- Agency includes 75 watchlists, 250 collections, daily and weekly briefs, and 2,500 evidence checks/month.
- Usage bundles add extra evidence checks for 30-day spikes. They do not make monitoring unlimited.
- Accounts warn after 80% evidence-check usage and hard-stop when paid capacity is exhausted.
- Tracking reliability stays visible in the account.

## Trust

Five to Nine should not claim SOC 2, HIPAA, GDPR compliance, zero retention, no training, or similar trust guarantees unless the policy, vendor configuration, and product behavior are verified.

## Contact

Use the visible product and founder contact paths on the site.
`;

export const LLMS_TEXT = `# Five to Nine

Five to Nine turns competitor ads and visible landing-page changes into proof-backed morning intelligence.

Current product truth:
- Market intelligence for revenue teams is the north-star product story.
- Public read-only live search is available for buyer evaluation, and public demo proof is sample-only at /api/demo-proof.
- Account access uses verified access paths.
- Checkout, plan access, and evidence-check limits follow the configured billing provider and visible plan caps.
- Launch status is readiness-gated: billing is verified, but broad launch still depends on fresh proof capture, digest delivery, and provider-canary success.
- Starter is the recommended plan. Paid plans have explicit caps: Scout includes weekly digest delivery and 50 evidence checks/month, Starter includes weekly digest delivery and 250 evidence checks/month, and Agency includes daily and weekly briefs plus 2,500 evidence checks/month; usage bundles add 30-day evidence-check capacity for spikes.
- Tracking status is labeled honestly as live, recent, delayed, or sample data.
- Recent results must not be described as fresh live proof.
- Backup Meta access is optional, owner-provided, tested before saving, stored encrypted, and used only for that account.
- Proof-backed digest items include priority, recommendation, timestamp, and confidence trail.
- Insight depth includes observed campaign duration only when first-seen and last-seen proof exists; manual external proof links can add visible non-Meta proof to saved collections, but spend, impressions, reach, and unsupported-channel benchmarks are not live. Automated non-Meta benchmarks are not live.
- Account export links support CSV, API JSON, and Slack-ready markdown for signed-in users.
- Customer API keys support read-only /api/v1 collection, watchlist, and digest exports for account-owned data.
- Customer API keys support the read-only /api/mcp endpoint for agent access to account-owned collection, watchlist, and digest exports.
- Slack incoming-webhook delivery is live for configured account destinations and can send eligible digests and high-priority change alerts.
- Slack webhook URLs are stored encrypted and are not shown again after saving.
- Customer WhatsApp delivery must stay behind opt-in, template-readiness, and webhook-readiness checks.
- Automated TikTok, Google, YouTube, LinkedIn, Pinterest ingestion and public write APIs are not live yet.
- Public copy should avoid unsupported security, compliance, traction, or model-routing claims.

Core layers:
- Public read-only analysis preview.
- Account-gated saved analysis.
- Retained monitoring.
- Reusable saved evidence.
`;

export function wantsPublicMarkdown(request: Request): boolean {
  return (request.headers.get("Accept") ?? "").toLowerCase().includes("text/markdown");
}

export function isPublicMarkdownPage(pathname: string): boolean {
  return PUBLIC_MARKDOWN_PATHS.has(pathname);
}

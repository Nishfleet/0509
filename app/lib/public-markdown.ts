import {
  AGENT_BLOCKED_CAPABILITIES,
  CUSTOMER_SUPPORT_PATHS,
  auditedAgentActionGroups,
} from "~/lib/agent-action-catalog";

const AUDITED_AGENT_ACTION_GROUPS = auditedAgentActionGroups();
const AUDITED_AGENT_ACTION_GROUP_SUMMARY = AUDITED_AGENT_ACTION_GROUPS.map((group) => group.label).join(", ");

const PUBLIC_MARKDOWN_PATHS = new Set([
  "/",
  "/help",
  "/docs",
  "/api/docs",
  "/status",
  "/changelog",
  "/trust",
  "/privacy",
  "/terms",
]);

export const PUBLIC_MARKDOWN = `---
title: Five to Nine
description: Market intelligence for revenue teams.
---

# Five to Nine

Five to Nine turns competitor ads and visible landing-page changes into proof-backed morning intelligence.

## Product

- Competitor monitoring for growth teams.
- Public read-only search and a sample proof preview are available before signup.
- Accounts unlock saved competitors, retained monitoring, reusable saved evidence, collections, digests, and reports.
- Saving competitor results, saved queries, watchlists, collections, reports, and delivery require an account.
- Customer-facing views lead with what changed, why it matters, urgency, proof status, source freshness, and the next action before raw data or settings.
- Authenticated collection, watchlist, and digest exports support CSV and JSON export. Watchlist and digest CSV exports include decision fields: priority, recommended next action, proof status, proof trail, source freshness, and source URL when available.
- Signed-in collections can store manual external proof links from TikTok, Google/YouTube, LinkedIn, Pinterest, Meta, landing pages, or other visible sources, including visible spend, impression, and reach values when a user supplies them.
- Customer API keys can read account-owned setup status, collection, watchlist, and digest exports.
- Write-enabled customer API keys can perform approved account actions: ${AUDITED_AGENT_ACTION_GROUP_SUMMARY}.
- Restricted actions still require signed-in owner review: ${AGENT_BLOCKED_CAPABILITIES.join(", ")}.
- Signed-in support cases cover paid-customer account help, with email fallback for users who cannot sign in.
- Paid customer support paths cover: ${CUSTOMER_SUPPORT_PATHS.map((path) => path.label).join(", ")}.
- Public help, docs, API docs, status, changelog, and trust pages are available at /help, /docs, /api/docs, /status, /changelog, and /trust.
- The public status page summarizes customer-facing surfaces without exposing private account activity.
- Email delivery is available for eligible accounts.
- Account insight-depth summaries cover top hooks, media mix, observed campaign duration, manual metric proof, creative timeline, and landing-page history from saved proof, watch events, and digest items.
- Alerts and reports should include evidence instead of unsupported AI summaries.
- Daily and weekly digests should show priority, recommended next move, proof status, source freshness, and proof trail.

## Current product truth

- Account access uses verified access paths.
- Public proof previews are sample-only. Public search is read-only; retained monitoring and saved evidence require an account.
- Checkout, plan access, and proof-capture limits follow the configured billing provider and visible plan caps.
- Tracking status is labeled honestly as live, recent, delayed, or sample data.
- Recent results must not be described as fresh live proof.
- Backup Meta access is optional, owner-provided, tested before saving, stored encrypted, and used only for that account.
- Observed campaign duration is based on first-seen and last-observed proof only. Manual external proof links can store user-supplied visible spend, impression, and reach values, but automated spend, reach, impression, and unsupported-channel benchmarks are not live.

## Pricing

- Pricing display is localized from checkout preview for the buyer location.
- There is no free retained-monitoring plan. Public live search is read-only; saved monitoring requires an account.
- Starter is the recommended plan for retained competitor monitoring.
- Scout is the entry plan after the public read-only search and sample proof loop: 3 watchlists, 10 collections, account-gated research, weekly digest delivery, and 50 proof captures/month.
- Starter includes 10 watchlists, 25 collections, daily and weekly digest delivery, and 250 proof captures/month.
- Agency includes 75 watchlists, 250 collections, daily and weekly digests, and 2,500 proof captures/month.
- Usage bundles add purchased proof captures that never expire. They do not change monthly included limits or make monitoring unlimited.
- Included proof captures reset monthly and do not roll over. Scheduled monitoring spends proof captures when Five to Nine creates a new landing-page proof capture.
- Accounts warn after 80% proof-capture usage and hard-stop when paid capacity is exhausted.
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
- Public read-only search is available for buyer evaluation, and proof previews are sample-only before signup.
- Account access uses verified access paths.
- Checkout, plan access, and proof-capture limits follow the configured billing provider and visible plan caps.
- Email delivery is available for eligible accounts.
- Starter is the recommended plan. Paid plans have explicit caps: Scout includes weekly digest delivery and 50 proof captures/month, Starter includes daily and weekly digest delivery and 250 proof captures/month, and Agency includes daily and weekly digests plus 2,500 proof captures/month. Purchased proof packs never expire, included proof captures reset monthly without rollover, and scheduled monitoring spends proof captures when Five to Nine creates a new landing-page proof capture.
- Tracking status is labeled honestly as live, recent, delayed, or sample data.
- Recent results must not be described as fresh live proof.
- Backup Meta access is optional, owner-provided, tested before saving, stored encrypted, and used only for that account.
- Proof-backed digest items include priority, recommendation, timestamp, and confidence trail.
- Customer-facing views lead with what changed, why it matters, urgency, proof status, source freshness, and the next action before raw data or settings.
- Insight depth includes observed campaign duration only when first-seen and last-seen proof exists; manual external proof links can add visible non-Meta proof and user-supplied metric proof to saved collections, but automated spend, reach, impression, and unsupported-channel benchmarks are not live. Automated non-Meta benchmarks are not live.
- Account export links support CSV and JSON export for signed-in users. Watchlist and digest CSV exports include priority, recommended next action, proof status, proof trail, source freshness, and source URL when available.
- Customer API keys support setup status plus collection, watchlist, and digest exports for account-owned data.
- Write-enabled customer API keys support approved account actions: ${AUDITED_AGENT_ACTION_GROUP_SUMMARY}.
- Restricted actions still require signed-in owner review: ${AGENT_BLOCKED_CAPABILITIES.join(", ")}.
- Signed-in support cases cover billing changes and cancellation, account access and team changes, migration and setup help, and security and deletion requests, with email fallback when a user cannot sign in.
- The public status page summarizes customer-facing surfaces without exposing private account activity.
- Automated TikTok, Google, YouTube, Reddit, X, LinkedIn, and Pinterest ingestion and broad public write APIs beyond approved account actions are not live yet.
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

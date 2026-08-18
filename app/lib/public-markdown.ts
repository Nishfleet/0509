import {
  AGENT_BLOCKED_CAPABILITIES,
  CUSTOMER_SUPPORT_PATHS,
  auditedAgentActionGroups,
} from "~/lib/agent-action-catalog";
// Shared with the robots.txt deny list in app/lib/seo.ts (docs/ai-crawler-policy.md)
// so robots.txt and llms.txt always name the same denied training crawlers.
import { AI_TRAINING_CRAWLERS } from "~/lib/seo";

const AUDITED_AGENT_ACTION_GROUPS = auditedAgentActionGroups();
const AUDITED_AGENT_ACTION_GROUP_SUMMARY = AUDITED_AGENT_ACTION_GROUPS.map((group) => group.label).join(", ");

export const PUBLIC_MARKDOWN_PATHS = [
  "/",
  "/help",
  "/docs",
  "/api/docs",
  "/status",
  "/changelog",
  "/trust",
  "/privacy",
  "/terms",
] as const;

const PUBLIC_MARKDOWN_PATH_SET = new Set<string>(PUBLIC_MARKDOWN_PATHS);

export const PUBLIC_MARKDOWN = `---
title: Five to Nine
description: Market intelligence for revenue teams.
---

# Five to Nine

Five to Nine turns competitor ads and visible landing-page changes into source-backed morning intelligence. Presence Desk adds proof-backed tracking for your brand and competitors across declared sources — website/open-web is active; social and marketplace sources are gated or planned.

## Product

- Competitor monitoring for growth teams plus proof-backed entity tracking (Presence Desk).
- Public read-only search and a sample brief are buyer-evaluation paths before signup; this text does not claim live availability.
- Signed-in accounts are the path for saved competitors, retained monitoring, reusable saved evidence, collections, digests, and reports; this text describes the capability, not live account availability.
- Saving competitor results, saved queries, watchlists, collections, reports, and delivery require an account.
- Customer-facing views lead with what changed, why it matters, urgency, source status, freshness, and the next action before raw data or settings.
- Authenticated collection, watchlist, and digest exports support CSV and JSON export when the account path is configured. Watchlist and digest CSV exports include decision fields: priority, recommended next action, source status, source trail, freshness, and source URL when available; this text does not claim live export success.
- Signed-in collections can store manual external evidence links from visible public sources, including visible spend, impression, and reach values when a user supplies them.
- Customer API keys can read account-owned setup status, collection, watchlist, and digest exports.
- Write-enabled customer API keys can perform approved workspace actions: ${AUDITED_AGENT_ACTION_GROUP_SUMMARY}.
- Restricted actions still require signed-in owner review: ${AGENT_BLOCKED_CAPABILITIES.join(", ")}.
- Signed-in support cases cover paid-customer account help, with email fallback for users who cannot sign in.
- Paid customer support paths cover: ${CUSTOMER_SUPPORT_PATHS.map((path) => path.label).join(", ")}.
- Public help, docs, API docs, status, changelog, and trust pages are available at /help, /docs, /api/docs, /status, /changelog, and /trust.
- The public status page summarizes customer-facing surfaces without exposing private account activity.
- Email delivery is in product scope for eligible accounts; this text does not measure live provider delivery.
- Account insight-depth summaries cover top hooks, media mix, observed campaign duration, manual metric evidence, creative timeline, and landing-page history from saved evidence, watch events, and digest items.
- Alerts and reports should include evidence instead of unsupported AI summaries.
- Daily and weekly digests should show priority, recommended next move, source status, freshness, and source trail.
- Presence Desk tracks your brand and competitors across declared sources. Website/open-web is the active GA source. X, Reddit, LinkedIn, YouTube, Amazon marketplace, and Context.dev are gated, planned, manual-only, or unavailable unless provider credentials, policy approval, and rollout gates are satisfied. The product does not promise whole-internet scanning, unsupported platform coverage, or client/product/creator entity kinds before entity-kind metadata ships.

## Current product truth

- Account access uses verified access paths.
- Public brief previews are sample-only. Public search is read-only; retained monitoring and saved evidence require an account.
- Checkout, plan access, and check limits follow the configured billing provider and visible plan caps; this text does not claim live checkout or provider proof.
- Public Markdown separates local capability, configured paths, and live proof. Public search, saved monitoring, digests, reports, share links, exports, checkout, and email need current account or provider proof before being described as live.
- Tracking status is labeled honestly as live, recent, delayed, or sample data.
- Recent results must not be described as fresh live results.
- Backup Meta access is optional, owner-provided, tested before saving, stored encrypted, and used only for that account.
- Observed campaign duration is based on first-seen and last-observed source evidence only. Manual external evidence links can store user-supplied visible spend, impression, and reach values, but automated spend, reach, impression, and unsupported-channel benchmarks are not live.

## Pricing

- Pricing display is localized from checkout preview for the buyer location.
- Free accounts can watch one competitor: a weekly scheduled check and a weekly email brief, with no collections, evidence checks, or instant alerts. Public search is read-only; saved monitoring requires an account, and this text does not claim live search availability.
- Starter is the recommended plan for retained competitor monitoring.
- Scout is the entry plan after the public read-only search and sample brief: 3 watchlists, 10 Collections, 6-hour scans, weekly Digest, and 50 checks/month.
- Starter includes 10 watchlists, 25 Collections, 3-hour scans, daily and weekly Digests, email Notifications, exports, and 250 checks/month.
- Agency includes 75 watchlists, 250 Collections, top 25 competitors checked every 3 hours and the rest every 6 hours, daily and weekly Digests, team workspace, API/MCP access, reports, branding, and 2,500 checks/month.
- Check packs add purchased checks that never expire. They do not change monthly included limits or make monitoring unlimited.
- Included checks reset every month and do not roll over. Scheduled scans are included with your plan; saved proof-backed captures use checks.
- Accounts warn after 80% check usage and hard-stop when paid volume is exhausted.
- Tracking reliability stays visible in the account.

## Trust

Five to Nine should not claim SOC 2, HIPAA, GDPR compliance, zero retention, no training, or similar trust guarantees unless the policy, vendor configuration, and product behavior are verified.

## Contact

Use the visible product and founder contact paths on the site.
`;

export const LLMS_TEXT = `# Five to Nine

Five to Nine turns competitor ads and visible landing-page changes into source-backed morning intelligence. Presence Desk tracks your brand and competitors across declared sources with proof-backed briefs.

Current product truth:
- Market intelligence for revenue teams is the north-star product story.
- Presence Desk: website/open-web is the active GA source; social and marketplace sources are gated, planned, or manual-only until provider approval.
- Public read-only search is a buyer-evaluation path, and sample brief previews are sample-only before signup; this text does not claim live search availability.
- Account access uses verified access paths.
- Checkout, plan access, and check limits follow the configured billing provider and visible plan caps; this text does not claim live checkout or provider proof.
- Email delivery is in product scope for eligible accounts; this text does not measure live provider delivery.
- Starter is the recommended plan. Free includes one watchlist with a weekly check and weekly email brief (no checks/collections). Paid plans have explicit caps: Scout includes 6-hour scans, weekly digest delivery, and 50 checks/month; Starter includes 3-hour scans, daily and weekly digest delivery, and 250 checks/month; Agency includes top 25 competitors every 3 hours (rest every 6 hours), daily and weekly digests, and 2,500 checks/month. Purchased checks never expire, included checks reset monthly without rollover, and saved proof-backed captures use checks.
- Tracking status is labeled honestly as live, recent, delayed, or sample data.
- Recent results must not be described as fresh live results.
- Backup Meta access is optional, owner-provided, tested before saving, stored encrypted, and used only for that account.
- Source-backed digest items include priority, recommendation, timestamp, and confidence trail.
- Customer-facing views lead with what changed, why it matters, urgency, source status, freshness, and the next action before raw data or settings.
- Insight depth includes observed campaign duration only when first-seen and last-seen evidence exists; manual external evidence links can add visible non-Meta evidence and user-supplied metric context to saved collections, but automated spend, reach, impression, and unsupported-channel benchmarks are not live. Automated non-Meta benchmarks are not live.
- Account export links support CSV and JSON export for signed-in users when the account path is configured; this text does not claim live export success. Watchlist and digest CSV exports include priority, recommended next action, source status, source trail, freshness, and source URL when available.
- Customer API keys support setup status plus collection, watchlist, and digest exports for account-owned data.
- Write-enabled customer API keys support approved workspace actions: ${AUDITED_AGENT_ACTION_GROUP_SUMMARY}.
- Restricted actions still require signed-in owner review: ${AGENT_BLOCKED_CAPABILITIES.join(", ")}.
- Signed-in support cases cover billing changes and cancellation, account access and team changes, migration and setup help, and security and deletion requests, with email fallback when a user cannot sign in.
- The public status page summarizes customer-facing surfaces without exposing private account activity.
- Social connectors remain disabled. Broad public write APIs beyond approved account actions are not live yet.
- Public copy should avoid unsupported security, compliance, traction, or model-routing claims.

Core layers:
- Public read-only analysis preview.
- Signed-in saved analysis.
- Retained monitoring.
- Reusable saved evidence.

AI access:
- AI answer and reference engines may use this file and public pages (search=yes, ai-input=yes, use=reference).
- AI training/fine-tuning crawlers are denied in robots.txt (ai-train=no): ${AI_TRAINING_CRAWLERS.join(", ")}.
- This policy is decided and recorded in docs/ai-crawler-policy.md.
`;

export function wantsPublicMarkdown(request: Request): boolean {
  return (request.headers.get("Accept") ?? "").toLowerCase().includes("text/markdown");
}

export function isPublicMarkdownPage(pathname: string): boolean {
  return PUBLIC_MARKDOWN_PATH_SET.has(pathname);
}

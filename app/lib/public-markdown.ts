import {
  AGENT_BLOCKED_CAPABILITIES,
  AGENT_FIRST_WORKFLOW,
  WRITE_ENABLED_API_KEY_REQUIREMENT,
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
- Public read-only live search trial and Public sample proof loop at /api/demo-proof for buyer evaluation, including an example tracked competitor and digest preview before signup.
- Account-gated saved search, retained monitoring, and reusable saved evidence.
- Saving competitor results, saved queries, watchlists, boards, reports, and delivery require an account.
- Authenticated board, watchlist, and digest exports support CSV, API JSON, and Slack-ready markdown.
- Signed-in boards can store manual external proof links from TikTok, Google/YouTube, LinkedIn, Pinterest, Meta, landing pages, or other visible sources, including visible spend, impression, and reach values when a user supplies them.
- Customer API keys can read account-owned readiness, collection, watchlist, and digest exports at /api/v1.
- Write-enabled customer API keys can also use /api/v1/actions and /api/mcp for narrow audited workspace actions: ${AUDITED_AGENT_ACTION_GROUP_SUMMARY}.
- Recommended first agent workflow: ${AGENT_FIRST_WORKFLOW.map((step) => step.label).join(" -> ")}.
- Live audited action groups: ${AUDITED_AGENT_ACTION_GROUP_SUMMARY}. ${WRITE_ENABLED_API_KEY_REQUIREMENT}
- Agent-blocked capabilities: ${AGENT_BLOCKED_CAPABILITIES.join(", ")}.
- Paid customer support paths cover: ${CUSTOMER_SUPPORT_PATHS.map((path) => path.label).join(", ")}.
- Public help, docs, API docs, status, changelog, and trust pages are available at /help, /docs, /api/docs, /status, /changelog, and /trust.
- Email delivery uses Cloudflare Email Service through the app's send_email binding.
- Slack incoming-webhook setup exists for configured account destinations; broad launch still requires at least one configured Slack target with successful live delivery proof.
- Account insight-depth summaries cover top hooks, media mix, observed campaign duration, manual metric proof, creative timeline, and landing-page history from saved proof, watch events, and digest items.
- Alerts and reports should include evidence instead of unsupported AI summaries.
- Daily briefs and weekly digests should show priority, recommended next move, and proof trail.

## Current product truth

- Account access uses verified access paths.
- Public demo proof is sample-only, including the example tracked competitor and digest preview. Public live search is read-only; retained monitoring and saved evidence require an account.
- Checkout, plan access, and evidence-check limits follow the configured billing provider and visible plan caps.
- Launch status is readiness-gated: billing is verified, but broad launch still depends on fresh proof capture, digest delivery, Slack delivery proof, and provider-canary success.
- Tracking status is labeled honestly as live, recent, delayed, or sample data.
- Recent results must not be described as fresh live proof.
- Backup Meta access is optional, owner-provided, tested before saving, stored encrypted, and used only for that account.
- Slack webhook URLs are stored encrypted and are not shown again after saving.
- Observed campaign duration is based on first-seen and last-observed proof only. Manual external proof links can store user-supplied visible spend, impression, and reach values, but automated spend, reach, impression, and unsupported-channel benchmarks are not live.
- Customer WhatsApp delivery is not launch-scoped today; it stays behind provider configuration, opt-in, validation, template-readiness, webhook-readiness, and successful delivery proof.

## Pricing

- Pricing display is localized from checkout preview for the buyer location.
- There is no free retained-monitoring plan. Public live search is read-only; saved monitoring requires an account.
- Starter is the recommended plan for retained competitor monitoring.
- Scout is the entry plan after the public read-only search and sample proof loop: 3 watchlists, 10 boards, account-gated research, weekly digest delivery, and 50 evidence checks/month.
- Starter includes 10 watchlists, 25 boards, weekly digest delivery, and 250 evidence checks/month.
- Agency includes 75 watchlists, 250 boards, daily and weekly briefs, and 2,500 evidence checks/month.
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
- Public read-only live search is available for buyer evaluation, and public demo proof is sample-only at /api/demo-proof with an example tracked competitor and digest preview.
- Account access uses verified access paths.
- Checkout, plan access, and evidence-check limits follow the configured billing provider and visible plan caps.
- Launch status is readiness-gated: billing is verified, but broad launch still depends on fresh proof capture, digest delivery, Slack delivery proof, and provider-canary success.
- Email delivery uses Cloudflare Email Service through the app's send_email binding.
- Starter is the recommended plan. Paid plans have explicit caps: Scout includes weekly digest delivery and 50 evidence checks/month, Starter includes weekly digest delivery and 250 evidence checks/month, and Agency includes daily and weekly briefs plus 2,500 evidence checks/month; usage bundles add 30-day evidence-check capacity for spikes.
- Tracking status is labeled honestly as live, recent, delayed, or sample data.
- Recent results must not be described as fresh live proof.
- Backup Meta access is optional, owner-provided, tested before saving, stored encrypted, and used only for that account.
- Proof-backed digest items include priority, recommendation, timestamp, and confidence trail.
- Insight depth includes observed campaign duration only when first-seen and last-seen proof exists; manual external proof links can add visible non-Meta proof and user-supplied metric proof to saved boards, but automated spend, reach, impression, and unsupported-channel benchmarks are not live. Automated non-Meta benchmarks are not live.
- Account export links support CSV, API JSON, and Slack-ready markdown for signed-in users.
- Customer API keys support /api/v1 readiness plus collection, watchlist, and digest exports for account-owned data.
- Write-enabled customer API keys support narrow audited workspace actions through /api/v1/actions and /api/mcp for ${AUDITED_AGENT_ACTION_GROUP_SUMMARY}.
- Recommended first agent workflow: ${AGENT_FIRST_WORKFLOW.map((step) => step.label).join(" -> ")}.
- Agent-blocked capabilities: ${AGENT_BLOCKED_CAPABILITIES.join(", ")}.
- Paid customer support paths cover billing changes and cancellation, account access and team changes, migration and setup help, and security and deletion requests.
- Slack incoming-webhook setup exists for configured account destinations; broad launch still requires a configured Slack target with successful live delivery proof.
- Slack webhook URLs are stored encrypted and are not shown again after saving.
- Customer WhatsApp delivery is not launch-scoped today and must stay behind provider configuration, opt-in, validation, template-readiness, webhook-readiness, and successful delivery proof.
- Automated TikTok, Google, YouTube, LinkedIn, Pinterest ingestion and broad public write APIs beyond audited workspace actions are not live yet.
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

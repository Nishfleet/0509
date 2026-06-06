const PUBLIC_MARKDOWN_PATHS = new Set(["/", "/privacy", "/terms"]);

export const PUBLIC_MARKDOWN = `---
title: Five to Nine
description: Market intelligence for revenue teams.
---

# Five to Nine

Five to Nine turns competitor ads and visible landing-page changes into proof-backed morning intelligence.

## Product

- Competitor monitoring for growth teams.
- Account-gated competitor ad search, retained monitoring, and reusable saved evidence.
- Search, competitor results, saved queries, watchlists, collections, reports, and delivery require an account.
- Alerts and reports should include evidence instead of unsupported AI summaries.
- Daily briefs and weekly digests should show priority, recommended next move, and proof trail.

## Current product truth

- Account access uses verified access paths.
- Checkout, plan access, and evidence-check limits follow the configured billing provider and visible plan caps.
- Launch status is readiness-gated: billing is verified, but broad launch still depends on fresh proof capture, digest delivery, and provider-canary success.
- Tracking status is labeled honestly as live, recent, delayed, or sample data.
- Recent results must not be described as fresh live proof.
- Backup Meta access is optional, owner-provided, tested before saving, stored encrypted, and used only for that account.
- Customer WhatsApp delivery stays behind opt-in, template-readiness, and webhook-readiness checks.

## Pricing

- Pricing display is localized from checkout preview for the buyer location.
- There is no free retained-monitoring plan. Search and saved monitoring require an account.
- Starter is the recommended plan for retained competitor monitoring.
- Scout is the entry plan for a focused watch set: 3 watchlists, 10 collections, search-led research, and 50 evidence checks/month.
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
- Account access uses verified access paths.
- Checkout, plan access, and evidence-check limits follow the configured billing provider and visible plan caps.
- Launch status is readiness-gated: billing is verified, but broad launch still depends on fresh proof capture, digest delivery, and provider-canary success.
- Starter is the recommended plan. Paid plans have explicit caps: Scout includes 50 evidence checks/month, Starter includes 250 evidence checks/month, and Agency includes 2,500 evidence checks/month; usage bundles add 30-day evidence-check capacity for spikes.
- Tracking status is labeled honestly as live, recent, delayed, or sample data.
- Recent results must not be described as fresh live proof.
- Backup Meta access is optional, owner-provided, tested before saving, stored encrypted, and used only for that account.
- Proof-backed digest items include priority, recommendation, timestamp, and confidence trail.
- Customer WhatsApp delivery must stay behind opt-in, template-readiness, and webhook-readiness checks.
- Public copy should avoid unsupported security, compliance, traction, or model-routing claims.

Core layers:
- Account-gated analysis.
- Retained monitoring.
- Reusable saved evidence.
`;

export function wantsPublicMarkdown(request: Request): boolean {
  return (request.headers.get("Accept") ?? "").toLowerCase().includes("text/markdown");
}

export function isPublicMarkdownPage(pathname: string): boolean {
  return PUBLIC_MARKDOWN_PATHS.has(pathname);
}

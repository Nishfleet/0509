const PUBLIC_MARKDOWN_PATHS = new Set(["/", "/search", "/privacy", "/terms"]);

export const PUBLIC_MARKDOWN = `---
title: Five to Nine
description: Market intelligence for revenue teams.
---

# Five to Nine

Five to Nine turns competitor ads and visible landing-page changes into proof-backed morning intelligence.

## Product

- Competitor monitoring for growth teams.
- Public analysis, retained monitoring, and reusable workspace memory.
- Search is public; saved queries, watchlists, collections, reports, and delivery live inside the workspace.
- Alerts and reports should include source proof instead of unsupported AI summaries.
- Daily briefs and weekly digests should show priority, recommended next move, and proof trail.

## Current product truth

- Workspace access uses verified access paths.
- Checkout, plan access, and proof-credit limits follow the configured billing provider and visible plan caps.
- Tracking status is labeled honestly as live, recent, delayed, or sample data.
- Recent results must not be described as fresh live proof.
- Workspace Meta access is optional, owner-provided, tested before saving, stored encrypted, and used only for that workspace.
- Customer WhatsApp delivery stays behind opt-in, template-readiness, and webhook-readiness checks.

## Pricing

- Pricing display is localized from checkout preview for the buyer location.
- There is no free retained-monitoring plan. Unpaid users can use public search but cannot keep workspace watchlists or collections.
- Starter is the recommended launch plan for retained competitor monitoring.
- Scout is the entry plan for a focused watch set: 3 watchlists, 10 collections, search-led research, and 50 proof captures/month.
- Starter includes 10 watchlists, 25 collections, weekly digest delivery, and 250 proof captures/month.
- Agency includes 75 watchlists, 250 collections, daily and weekly briefs, and 2,500 proof captures/month.
- Usage bundles add extra proof captures for 30-day spikes. They do not make monitoring unlimited.
- Workspaces warn after 80% proof-capture usage and hard-stop when paid capacity is exhausted.
- Tracking reliability stays visible in the workspace.

## Trust

Five to Nine should not claim SOC 2, HIPAA, GDPR compliance, zero retention, no training, or similar trust guarantees unless the policy, vendor configuration, and product behavior are verified.

## Contact

Use the visible product and founder contact paths on the site.
`;

export const LLMS_TEXT = `# Five to Nine

Five to Nine turns competitor ads and visible landing-page changes into proof-backed morning intelligence.

Current product truth:
- Market intelligence for revenue teams is the north-star product story.
- Workspace access uses verified access paths.
- Checkout, plan access, and proof-credit limits follow the configured billing provider and visible plan caps.
- Starter is the recommended launch plan. Paid plans have explicit caps: Scout includes 50 proof captures/month, Starter includes 250 proof captures/month, and Agency includes 2,500 proof captures/month; usage bundles add 30-day proof capacity for spikes.
- Tracking status is labeled honestly as live, recent, delayed, or sample data.
- Recent results must not be described as fresh live proof.
- Workspace Meta access is optional, owner-provided, tested before saving, stored encrypted, and used only for that workspace.
- Proof-backed digest items include priority, recommendation, timestamp, and confidence trail.
- Customer WhatsApp delivery must stay behind opt-in, template-readiness, and webhook-readiness checks.
- Public copy should avoid unsupported security, compliance, traction, or model-routing claims.

Core layers:
- Public analysis.
- Retained monitoring.
- Reusable workspace memory.
`;

export function wantsPublicMarkdown(request: Request): boolean {
  return (request.headers.get("Accept") ?? "").toLowerCase().includes("text/markdown");
}

export function isPublicMarkdownPage(pathname: string): boolean {
  return PUBLIC_MARKDOWN_PATHS.has(pathname);
}

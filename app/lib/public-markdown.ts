const PUBLIC_MARKDOWN_PATHS = new Set(["/", "/search", "/privacy", "/terms"]);

export const PUBLIC_MARKDOWN = `---
title: Five to Nine
description: Market intelligence for revenue teams.
---

# Five to Nine

Five to Nine turns competitor ad, offer, and landing-page changes into proof-backed morning intelligence.

## Product

- Competitor monitoring for growth teams.
- Public analysis, retained monitoring, and reusable workspace memory.
- Search is public; saved queries, watchlists, collections, reports, and delivery live inside the workspace.
- Alerts and reports should include source proof instead of unsupported AI summaries.
- Daily briefs and weekly digests should show priority, recommended next move, and proof trail.

## Current product truth

- Workspace access uses verified access paths.
- Checkout should appear only after the payment path and webhooks are verified.
- Commercial discovery status must be labeled honestly as live, cached live, degraded, or demo.
- Meta source coverage stays explicitly labeled until fresh discovery, proof capture, and digest canaries prove resilience.
- Fresh commercial discovery is a release gate; cached results must not be described as fresh live proof.
- Customer-facing Meta API fallback requires customer-owned Meta access. Customer tokens are test-before-save, stored encrypted, and platform Meta tokens are diagnostic-only unless an explicit exception is configured.
- Customer WhatsApp delivery must stay behind opt-in, template-readiness, and webhook-readiness checks.

## Pricing

- Pricing display is Dodo-backed and localized from checkout preview for the buyer location.
- There is no free retained-monitoring plan. Unpaid users can use public search but cannot keep workspace watchlists or collections.
- Scout includes 3 watchlists, 10 collections, search-led research, and 50 proof captures/month.
- Starter includes 10 watchlists, 25 collections, weekly digest delivery, and 250 proof captures/month.
- Agency includes 75 watchlists, 250 collections, daily and weekly briefs, and 2,500 proof captures/month.
- Usage bundles add extra proof captures for 30-day spikes. They do not make monitoring unlimited.
- Workspaces warn after 80% proof-capture usage and hard-stop when paid capacity is exhausted.
- Meta source access remains beta-gated.

## Trust

Five to Nine should not claim SOC 2, HIPAA, GDPR compliance, zero retention, no training, or similar trust guarantees unless the policy, vendor configuration, and product behavior are verified.

## Contact

Use the visible product and founder contact paths on the site.
`;

export const LLMS_TEXT = `# Five to Nine

Five to Nine turns competitor ad, offer, and landing-page changes into proof-backed morning intelligence.

Current product truth:
- Market intelligence for revenue teams is the north-star product story.
- Workspace access uses verified access paths.
- Checkout should appear only after the payment path and webhooks are verified.
- Dodo checkout and webhook routes exist for plan and usage-bundle purchases, but public copy should treat billing as verified-current only after live product ids, webhook secret, and signed webhook proof pass.
- Paid plans have explicit caps: Scout includes 50 proof captures/month, Starter includes 250 proof captures/month, and Agency includes 2,500 proof captures/month; usage bundles add 30-day proof capacity for spikes.
- Fresh commercial discovery is a release gate; cached results must be labeled as cached.
- Meta source coverage stays labeled until discovery, proof, and digest canaries prove reliability.
- Customer-facing Meta API fallback requires customer-owned Meta access. Customer tokens are test-before-save, stored encrypted, and platform Meta tokens are diagnostic-only unless an explicit exception is configured.
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

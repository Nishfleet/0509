const PUBLIC_MARKDOWN_PATHS = new Set(["/", "/search", "/privacy", "/terms"]);

export const PUBLIC_MARKDOWN = `---
title: Five to Nine
description: After-hours market intelligence for growth teams.
---

# Five to Nine

Five to Nine turns competitor ad, offer, and landing-page changes into proof-backed morning intelligence.

## Product

- After-hours competitor monitoring for growth teams.
- Public analysis, retained monitoring, and reusable workspace memory.
- Search is public; saved queries, watchlists, collections, reports, and delivery live inside the workspace.
- Alerts and reports should include source proof instead of unsupported AI summaries.
- Daily briefs and weekly digests should show priority, recommended next move, and proof trail.

## Current product truth

- Five to Nine is in pilot-readiness mode, not broad self-serve launch mode.
- Self-serve billing is not live yet. Razorpay Subscriptions for India and Dodo checkout for international customers are scaffolded behind env-gated routes; Dodo must use the separate 0509 brand config.
- Pilot access is activated manually after fit review.
- Commercial discovery status must be labeled honestly as live, cached live, degraded, or demo.
- Meta ads tracking is a beta feature until fresh discovery, proof capture, and digest canaries prove resilience.
- Fresh commercial discovery is a launch gate; cached results must not be described as fresh live proof.
- Customer-facing Meta API fallback requires customer-owned Meta access. Customer tokens are test-before-save, stored encrypted, and platform Meta tokens are diagnostic-only unless an explicit exception is configured.
- Customer WhatsApp delivery must stay behind opt-in, template-readiness, and webhook-readiness checks.

## Pricing

Pricing is region-aware for India and rest of world. Public prices are pilot pricing signals until Razorpay and Dodo checkout plus signed webhooks are verified.

## Trust

Five to Nine should not claim SOC 2, HIPAA, GDPR compliance, zero retention, no training, or similar trust guarantees unless the policy, vendor configuration, and product behavior are verified.

## Contact

Use the visible product and founder contact paths on the site.
`;

export const LLMS_TEXT = `# Five to Nine

Five to Nine turns competitor ad, offer, and landing-page changes into proof-backed morning intelligence.

Current product truth:
- After-hours market intelligence is the north-star product story.
- The product is in pilot-readiness mode, not broad self-serve launch mode.
- Self-serve billing is not live yet.
- Plan gating is scaffolded, and Razorpay/Dodo checkout and webhook routes should not be described as live until test-mode verification passes with the correct 0509 Dodo brand config.
- Fresh commercial discovery is a launch gate; cached results must be labeled as cached.
- Meta ads tracking is beta until discovery, proof, and digest canaries prove reliability.
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

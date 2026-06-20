# Five to Nine Launch Readiness

Last checked: 2026-06-15

## Current Verdict

Five to Nine is pilot-ready, but not broad launch-ready until Slack delivery proof is configured and green, the Dodo customer portal subscription-update setting is confirmed, and external uptime monitoring is set up.

The core app is real: public competitor search, authenticated workspace, watchlists, collections, digests, reports, share/export flows, operator health, Dodo-backed pricing/checkout, billing webhooks, email delivery, proof-first monitoring, workspace readiness, and narrow audited API/MCP agent actions all exist.

The remaining launch blockers are not hidden in code: production has no configured Slack delivery target, the Dodo portal setting is external-dashboard work, and external uptime monitoring needs to be created. WhatsApp is no longer launch-scoped while provider/customer/webhook readiness is disabled, and public copy must not claim WhatsApp delivery.

The public `/status` page summarizes coarse launch blockers and safety posture without rendering account activity, aggregate counts, or private canary evidence. Detailed monitoring, proof-capture, digest, Slack, Dodo, and uptime proof stays in private launch checks and signed-in operational views.

## Evidence From 2026-06-15

- `npm run typecheck` passes.
- `npm test` passes: 90 files and 716 tests.
- `npm run build` passes on Vite 8.
- `npm audit --omit=dev --audit-level=moderate` passes with zero vulnerabilities.
- `npm run canary:billing` passes against production: signed Dodo plan and proof-credit webhooks are accepted, plan cleanup is OK, proof-credit cleanup is OK, and 500 proof credits are granted then cleaned up.
- `npm run canary:proof -- --require-slack --json` creates a real proof capture and sends email, but fails Slack proof because no Slack target is configured.
- `npm run canary:prod -- --json` passes health, fresh-live search, and Meta ads beta readiness, but current deployed production still fails launch readiness on Slack delivery proof.
- Production health passes on `https://0509.io`, `https://www.0509.io`, and `https://api.0509.io`.
- Current live search returns fresh Ad Library results for Nykaa, boAt, Mamaearth, Swiggy, Zomato, and Meesho.
- Meta ads beta shows 866 successful samples, 0 failures, and `Ready to review graduation`.

## Hard Launch Gates

- `npm run typecheck` must pass.
- `npm test` must pass.
- `npm run build` must pass.
- `npm audit --omit=dev --audit-level=moderate` must pass.
- `npm run canary:billing` must pass.
- `npm run canary:prod` must pass.
- `npm run provider:bakeoff:launch` must stay green for `current_0509`.
- `CANARY_BYPASS_TOKEN` must be set locally and as a Worker secret.
- The private launch-readiness endpoint must show recent successful monitoring, proof capture, sent digest, configured Slack target, and recent Slack delivery.
- WhatsApp must stay out of launch claims while provider/customer/webhook readiness is disabled; if deliberately enabled, configured WhatsApp targets must have provider configuration, opt-in, webhook readiness, usable target status, and recent delivered proof.
- Public pricing display must come from Dodo local-price preview.
- Dodo checkout creation and signed webhook grant canaries must remain green.
- Public copy must not claim verified WhatsApp delivery, SOC 2, HIPAA, GDPR, zero retention, no training, or unverified model/provider behavior.
- Customer-facing Meta API fallback must use customer-owned Meta access. Customer tokens are test-before-save and stored encrypted.

## Slack Blocker

Production readiness currently reports:

- `slackDelivery.configuredTargets`: 0
- `slackDelivery.usableTargets`: 0
- `slackDelivery.recentSent`: 0

To clear this, add a Slack incoming webhook for Nish's own workspace in `/app/sources`. The app live-tests the webhook on save, stores it encrypted, and future canaries can then post proof-backed digests to Slack.

After adding the webhook, run:

```bash
npm run canary:proof -- --require-slack
npm run canary:prod
```

## WhatsApp Posture

Production readiness currently reports:

- `whatsappDelivery.configuredTargets`: 3
- `whatsappDelivery.providerConfigured`: false
- `whatsappDelivery.customerReady`: false
- `whatsappDelivery.webhookConfigured`: false
- `whatsappDelivery.usableTargets`: 0
- `whatsappDelivery.recentSent`: 0

Current branch posture: WhatsApp is not launch-scoped until the provider/customer/webhook lane is deliberately configured. Existing unready WhatsApp recipients should stay non-claimable, and customer setup stays hidden until provider, customer delivery, webhook readiness, opt-in, template eligibility, and delivered proof are present.

## Dodo Portal Manual Blocker

Dodo customer portal sessions are wired in `/app/billing`, but the Dodo dashboard must have Customer Portal subscription updates enabled before customers can change or cancel subscriptions without emailing support.

Required manual step: Dodo dashboard -> Settings -> Customer Portal -> enable Allow Subscription Updates and confirm cancellation is available.

## External Uptime Manual Blocker

The public health endpoint is `https://0509.io/api/health`. Create an external uptime monitor that checks this endpoint every 5 minutes and alerts Nish if it stops returning `ok`.

## Pilot-Safe Offer

Use this framing for the first customer:

> Five to Nine helps growth teams turn competitor website and Meta ad checks into proof-backed monitoring. Enter a competitor, capture landing-page proof, and get email-first change reports with source status shown honestly.

## Not Ready To Claim

- Broad launch until Slack proof is green, Dodo portal subscription updates are confirmed, and external uptime monitoring is set up.
- Customer WhatsApp delivery unless opt-in, template readiness, provider sends, and webhook reconciliation are verified.
- SOC 2, HIPAA, GDPR compliance, zero retention, no training, or similar trust guarantees.
- Automated TikTok, Google, YouTube, LinkedIn, Pinterest ingestion, automated spend/reach/impression benchmarks, or broad public write APIs beyond the narrow audited workspace actions.

## Next Slice

Add one real Slack webhook target for Nish's workspace, confirm the Dodo customer portal setting, create the external uptime monitor, then rerun the required delivery canaries and the full production canary.

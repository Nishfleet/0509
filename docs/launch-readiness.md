# Five to Nine Launch Readiness

Last checked: 2026-06-15

## Current Verdict

Five to Nine is pilot-ready, but not broad self-serve launch-ready until Slack delivery proof is configured and green.

The core app is real: public competitor search, authenticated workspace, watchlists, collections, digests, reports, share/export flows, operator health, Dodo-backed pricing/checkout, billing webhooks, email delivery, and proof-first monitoring all exist.

The remaining launch blocker is not hidden in code: production has no configured Slack delivery target, so the launch-readiness endpoint still reports `no_slack_delivery_target` and `no_recent_slack_sent`.

## Evidence From 2026-06-15

- `npm run typecheck` passes.
- `npm test` passes: 87 files and 669 tests.
- `npm run build` passes on Vite 8.
- `npm audit --omit=dev --audit-level=moderate` passes with zero vulnerabilities.
- `npm run canary:billing` passes against production: signed Dodo plan and proof-credit webhooks are accepted, plan cleanup is OK, proof-credit cleanup is OK, and 500 proof credits are granted then cleaned up.
- `npm run canary:proof -- --require-slack --json` creates a real proof capture and sends email, but fails Slack proof because no Slack target is configured.
- `npm run canary:prod -- --json` passes health, fresh-live search, and Meta ads beta readiness, but fails launch readiness on Slack only.
- Production health passes on `https://0509.in`, `https://www.0509.in`, and `https://api.0509.in`.
- Current live search returns fresh Ad Library results for Nykaa, boAt, Mamaearth, Swiggy, Zomato, and Meesho.
- Meta ads beta shows 703 successful samples, 0 failures, and `Ready to review graduation`.

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
- Any configured WhatsApp targets must have provider configuration, opt-in, webhook readiness, usable target status, and recent delivered proof.
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

## Pilot-Safe Offer

Use this framing for the first customer:

> Five to Nine helps growth teams turn competitor website and Meta ad checks into proof-backed monitoring. Enter a competitor, capture landing-page proof, and get email-first change reports with source status shown honestly.

## Not Ready To Claim

- Broad self-serve launch until Slack delivery proof is green.
- Customer WhatsApp delivery unless opt-in, template readiness, provider sends, and webhook reconciliation are verified.
- SOC 2, HIPAA, GDPR compliance, zero retention, no training, or similar trust guarantees.
- Automated TikTok, Google, YouTube, LinkedIn, Pinterest ingestion, automated spend/reach/impression benchmarks, or public write APIs.

## Next Slice

Add one real Slack webhook target for Nish's workspace, rerun the Slack-required proof canary, then rerun the full production canary.

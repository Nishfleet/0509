# GA Quality Report

Generated: 2026-06-24 (branch `cursor/ga-launch-customer-delight-20260624`)

## Automated gates

| Gate | Result |
|------|--------|
| `npm run typecheck` | PASS |
| `npm test` | PASS (see scorecard for count) |
| `npm run build` | PASS |
| `node scripts/validate-d1-backup.mjs` | PASS (dry-run) |
| Remote D1 migrations | Synced through `0053` |

## Test coverage highlights

| Area | Test file(s) |
|------|----------------|
| SKU catalog | `tests/billing-sku-catalog.test.ts` |
| Dodo pricing preview | `tests/dodo-pricing.server.test.ts` |
| Dodo billing webhooks | `tests/dodo-billing.server.test.ts` |
| Checkout guards | `tests/billing-page.route.test.ts` |
| Commercial launch gate | `tests/commercial-launch-gate.test.ts` |
| Plan entitlements | `tests/plan-entitlements.test.ts`, `tests/evidence-usage.test.ts` |
| Monitoring fan-out | `tests/monitoring-fanout*.test.ts` |
| Marketing honesty | `tests/marketing-rebuild.test.ts` |

## Security checks (unchanged from hardening)

- Parameterized D1 queries
- Dodo webhook signature + ledger dedupe
- Checkout double-subscription guard
- No secrets in repo docs
- Agency checkout gated without fan-out proof

## Known limitations

| Item | Risk | Mitigation |
|------|------|------------|
| Inline monitoring capacity | Agency watchlists may delay | Fan-out activation ladder |
| No bounce webhooks | List hygiene manual | Cloudflare dashboard |
| Meta ads source lane | Graduated 2026-08-12 (canary green on live worker) | Canary-gated; re-add beta caveat if canary turns red |
| WhatsApp not launch-scoped | Misleading if claimed | Hidden from marketing |

## Manual QA checklist (operator)

- [ ] Signup → first watchlist → first scan (staging or prod test account)
- [ ] Starter checkout in Dodo test mode
- [ ] Return URL banner activates plan
- [ ] Top-up purchase grants evidence checks
- [ ] Agency checkout returns held banner
- [ ] Pricing preview shows local currency

## Verdict

Code quality gates pass. **Commercial GA** blocked on ops + fan-out owner actions per scorecard.

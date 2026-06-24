# GA Support Runbook

## Customer contact

- Email: `support@0509.io` (`support@0509.in` redirects — use `.io` in replies)
- In-app: `/app/support?category=billing|delivery|account`

## Common requests

| Request | First response | Escalation |
|---------|----------------|------------|
| Checkout failed | Check Dodo receipt email; verify plan not already active | Billing support case |
| Agency unavailable | Explain fan-out capacity gate; offer Starter | Owner when Agency timeline needed |
| Evidence checks exhausted | Explain monthly reset + top-up packs | — |
| Portal won't open | Dodo portal setting may be disabled | Owner enables subscription updates |
| Slack not delivering | Verify target in `/app/sources`; plan must include Slack | `docs/launch-owner-actions.md` |
| Downgrade over limit | Watchlists auto-pause; newest kept | — |

## Billing support case flow

1. Customer opens `/app/support?category=billing`.
2. Support reviews `user_plan`, `dodo_webhook_event` ledger (operator D1).
3. Plan changes before portal confirmed: manual Dodo dashboard or support-assisted checkout.

## Evidence check disputes

- Scheduled monitoring does not consume checks.
- One check = one successful new landing-page proof capture.
- Top-up grants in `evidence_top_up_grant` never expire.

## Refund policy

Digital product — purchases final. Refund webhook handler revokes on full refund (goodwill/disputes only).

## Links

- Plan entitlements: `docs/plan-catalog.md`
- Top-ups: `docs/top-up-billing.md`
- Owner ops: `docs/launch-owner-actions.md`

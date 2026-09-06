# GA Support Runbook

## Customer contact

- Email: `support@0509.io`
- In-app: `/app/support?category=billing|delivery|account`

## Ops gates (operator)

| Gate | Command / URL | GA required? |
|------|---------------|--------------|
| Health | `https://0509.io/api/health` | Yes — 200 + `"status":"ok"` |
| Email proof | `npm run canary:proof` (no `--require-slack`) | Yes |
| Prod canary | `npm run canary:prod` | Yes |
| Slack proof | Live Starter+ channel (webhook delivery) | Yes — `isSlackWebhookDeliveryCustomerFacing()`; 2xx acceptance is the delivery proof |
| UptimeRobot | Dashboard check on `/api/health` | Yes — owner-verified (no API token) |
| D1 backup validate | `node scripts/validate-d1-backup.mjs` | Yes — CI dry-run |

Dormant-channel advisories on `/api/launch-readiness` do not block Scout or Starter GA while those channels are outside the customer offer.

## Common requests

| Request | First response | Escalation |
|---------|----------------|------------|
| Checkout failed | Check Dodo receipt email; verify plan not already active | Billing support case |
| Agency unavailable | Explain fan-out capacity gate; offer Starter | Owner when Agency timeline needed |
| Evidence checks exhausted | Explain monthly reset + top-up packs | — |
| Portal won't open | Dodo portal session failed or no linked customer exists | Support handles card/invoice/cancellation task manually |
| Email not delivering | Cloudflare Email Service Activity log; `delivery_attempt` for `channel = email` | `docs/ga-incident-runbook.md` § Email |
| Slack requested | Explain Slack is not part of the GA customer offer and route to owner for a future product decision | Owner only |
| Downgrade over limit | Watchlists auto-pause; newest kept | — |

## Billing support case flow

1. Customer opens `/app/support?category=billing`.
2. Support reviews `user_plan`, `dodo_webhook_event` ledger (operator D1).
3. For plan-change issues, check whether `/app/billing` submitted a Dodo plan change and whether the signed webhook updated the account; use manual Dodo dashboard only as the fallback.

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
- Uptime + backups: `docs/ops-backup-uptime.md`
- Incidents: `docs/ga-incident-runbook.md`

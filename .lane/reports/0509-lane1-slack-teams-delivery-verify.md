# Lane 1 report: Slack/Teams delivery of confirmed changes — already merged and live

**Status: already resolved on `origin/main`; this lane records the verification evidence.**

Branch: `0509-lane1-slack-teams-delivery-verify`
Base: `origin/main` at `abf2b3e1`

## Item

- [ ] Slack/Teams delivery of confirmed changes — Starter+ webhook delivery with deep links, fail-closed honest "not connected" states

## Verdict

No code change was warranted. The item was implemented, merged, and is live on
`origin/main` via three merged PRs:

- **PR #705** (`lane1/slack-teams-webhook-delivery`) — `211cb010` "feat(delivery):
  Slack + Teams webhook delivery of confirmed changes (Starter+)", plus
  `042257a0` (Teams provider mapping fix) and `8a7b4674` (teams test fixture
  fix). Merged 2026-08-15.
- **PR #748** (`0509-lane1-slack-teams-webhook-delivery`) — `f203c578` docs(lane):
  recorded the evidence report. Merged 2026-08-16.
- **PR #782** (`fix/gate-b-journey3-teams-delivery-surfaces`) — `1875cbb5`
  e2e follow-up updating Gate-B journey-3 digest/notifications assertions for
  the Slack+Teams surfaces. Merged 2026-08-17.

All three are ancestors of current `main` HEAD `abf2b3e1`.

## Evidence verified live on current main (2026-08-20)

| Requirement | Where in main | Verified |
|---|---|---|
| Slack webhook sender, fail-closed | `app/lib/slack-webhook.server.ts` | ✅ only literal `ok` response = delivered; non-2xx = hard failure; transport error = `provider_unknown` ambiguous |
| Teams webhook sender, fail-closed | `app/lib/teams-webhook.server.ts` | ✅ same semantics; URL validation for `webhook.office.com` webhookb2 + legacy connectors; ambiguous Workflow URLs rejected |
| Target save/pause/resume | `app/lib/slack.server.ts`, `app/lib/teams.server.ts` | ✅ present |
| Instant alert + digest dispatch, claim/dedupe parity | `app/lib/delivery.server.ts` | ✅ Slack+Teams digest and instant paths, channel→provider mapping, deep links |
| Deep links to watchlist event | `app/lib/delivery.server.ts` `buildWatchlistUrl` | ✅ `/app/watchlists?watchlist=…&event=…` |
| Starter+ plan gating | `app/lib/plan-entitlements.ts` | ✅ `slack_delivery`/`teams_delivery` in STARTER_FEATURES + AGENCY_FEATURES only; `tests/plan-delivery-branding-gates.test.ts` "rejects scout slack delivery configuration" passes |
| Migration | `migrations/0075_teams_delivery.sql` | ✅ present; widens channel CHECKs to include `teams`, adds `teams_enabled` toggles |
| Honest "not connected" UI | `app/routes/app.notifications.ui.tsx` | ✅ `connectedOrConnectCopy`/`"Not connected"`; setup test before save |
| Customer-claim registry aligned | `docs/customer-claim-surface-registry.json` | ✅ DELIVERY-CHANNEL-GATES names Slack+Teams as live Starter+ channels with fail-closed 2xx acceptance note; pinned SHA test passes |

## Tests (run on this tip)

- `tests/slack.server.test.ts` (10), `tests/teams.server.test.ts` (11),
  `tests/delivery-webhooks.test.ts` (5), `tests/instant-channel-delivery-claims.test.ts` (20): **46 passed**
- `tests/customer-claim-surface-registry.test.ts` (6),
  `tests/instant-alert-delivery-claims.test.ts` (7), `tests/digest-delivery-claims.test.ts` (10),
  `tests/instant-channel-delivery-claims.test.ts` (20), `tests/plan-delivery-branding-gates.test.ts` (10): **53 passed**

All green. No production change required.

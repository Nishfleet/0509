# Lane 1 report: Slack/Teams delivery of confirmed changes (Starter+)

## Outcome

**Implemented, pushed, and opened as PR #756** — Slack + Teams webhook
delivery of confirmed competitor changes on Starter+ plans, with fail-closed
honest "not confirmed" labeling and deep links.

- Branch: `lane1/slack-teams-webhook-delivery-20260815`
- PR: https://github.com/nish3451/0509/pull/756
- Base: fresh `origin/main` (this lane's work was previously stranded 21
  commits behind main in PR #705 / #637).

## What the PR delivers (maps 1:1 to the packet item)

- **Slack + Teams webhook delivery of confirmed competitor changes** on
  Starter+ plans:
  - Teams channel engine `app/lib/teams-webhook.server.ts`: validates
    `webhook.office.com/webhookb2` and legacy `outlook.office.com` connector
    shapes; rejects ambiguous Workflow URLs; a 2xx from the connector is the
    only proof of acceptance, non-2xx is a hard failure, unreadable/invalid
    responses record `provider_unknown`.
  - Teams target save/pause/resume in `app/lib/teams.server.ts`, mirroring
    the existing Slack path (`app/lib/slack.server.ts`), with encrypted
    webhook storage and a setup test send that must succeed before a target
    is considered connected.
  - Instant alert + digest delivery over Slack and Teams in
    `app/lib/delivery.server.ts` with claim/dedupe/dispatch parity, including
    the provider mapping (`microsoft_teams_incoming_webhook`) in the instant
    dispatch and claim paths.
- **Deep links**: every alert payload links to the watchlist event row
  (`/app/watchlists?watchlist=…&event=…`).
- **Fail-closed honest "not confirmed" labeling**: provisional batches render
  "Possible change at …" subjects; materiality copy derives only from
  events whose evidence resolves to `verified_change`; unverified webhooks
  surface honest "not connected" copy until a test send succeeds; missing,
  failed, or unordered evidence can never claim a verified move.
- Migration `0075_teams_delivery.sql` widens the `delivery_target` and
  `delivery_attempt` channel CHECKs to include `teams` and adds
  `teams_enabled` toggles (workspace + watchlist config).
- Plan gating: `teams_delivery` (and `slack_delivery`) are Starter+ features
  enforced at route (`app.notifications`, `app.watchlists`), agent-action,
  and config-save boundaries; execution-time entitlements strip Slack/Teams
  on downgrade.

## Verification (this run)

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ pass |
| Changed test files (12 files, 367 tests) | ✅ all pass |
| `npm run build` | ✅ pass |
| Full `npm test` | 21 pre-existing failures (`act is not a function`) reproduce identically on clean `origin/main` — unrelated to this change |

## Why a fresh branch/PR instead of reusing PR #705

The prior lane run for this same item (PR #705) was stranded: its branch was
21 commits behind `origin/main`, and its `required-verifier-integrity` check
never ran (shared-runner queue saturation). This run rebased the identical
file content onto fresh `origin/main` (byte-for-byte verified for all 33
files), re-ran the verification locally, and opened PR #756.

## Status of required checks on PR #756

All checks (codex-node-checks, Gitleaks, validate, required-verifier-integrity,
classify) are queued on the shared `vps-verify` runner pool, which is
saturated fleet-wide. This change does not touch any protected verifier file,
so the integrity gate should pass once a runner picks it up.

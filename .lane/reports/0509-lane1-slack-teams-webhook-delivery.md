# Lane 1 report: Slack/Teams delivery of confirmed changes (Starter+)

## Outcome

**The lane item is implemented, pushed, and opened as PR #705 — and is blocked
from merging solely by a saturated shared-runner queue, not by any defect in
the work.**

- Branch: `lane1/slack-teams-webhook-delivery` @ `bf90241456ab2f83edf63107502daae2a05ab525`
- PR: https://github.com/nish3451/0509/pull/705
  (title: `feat(delivery): Slack + Teams webhook delivery of confirmed changes (Starter+)`)
- The branch is fully current with `main` (`git rev-list bf902414..origin/main` = 0).

## What the PR delivers (maps 1:1 to the packet item)

- **Slack + Teams webhook delivery of confirmed competitor changes** on
  Starter+ plans:
  - Teams channel engine: `app/lib/teams-webhook.server.ts` (URL validation for
    `webhook.office.com` `webhookb2` + legacy `outlook.office.com` connector
    shapes; ambiguous Workflow URLs rejected), target save/pause/resume in
    `app/lib/teams.server.ts`, mirroring the existing Slack path.
  - Instant alert + digest delivery paths in `app/lib/delivery.server.ts`
    (claim/dedupe/dispatch parity with Slack), including a fix mapping the
    Teams channel to `microsoft_teams_incoming_webhook` in the instant dispatch
    and claim paths.
  - **Deep links**: alert payloads link to the watchlist event.
  - **Fail-closed honest "not configured" state**: a 2xx from the Teams
    connector is the only proof of acceptance; non-2xx is a hard failure,
    unreadable/invalid responses record `provider_unknown`, and unverified
    webhooks surface honest "not connected" copy until a test send succeeds.
  - Migration `0075_teams_delivery.sql` widens the `delivery_target` and
    `delivery_attempt` channel CHECKs to include `teams` and adds
    `teams_enabled` toggles.
  - Plan gating: `teams_delivery` (and `slack_delivery`) are Starter+ features
    enforced at route, agent-action, and config-save boundaries.
  - UI: `/app/notifications` + watchlist delivery settings surface the Slack
    and Teams webhook connection with honest unconfigured state and test sends.

## Verification state (as of 2026-08-14 23:19 UTC)

| Check | Status |
|---|---|
| `codex-node-checks` | ✅ success (2026-08-14T21:53:54Z) |
| `Gitleaks` | ✅ success (2026-08-14T21:33:25Z) |
| `validate` (D1 backup tooling) | ✅ success (2026-08-14T21:44:53Z) |
| `required-verifier-integrity` | ⏳ **queued** since 2026-08-14T21:00:56Z (run 31840539700) |

Branch protection on `main` requires `Gitleaks`, `codex-node-checks`, and
`required-verifier-integrity`. The first two are green; the third has not
started after >2h.

## The blocker: shared-runner queue saturation (control-plane, outside lane scope)

The `required-verifier-integrity` workflow runs on the shared self-hosted
`vps-verify` runners (netcup-rs2000-verify1/2/3). At 23:19 UTC:

- All three runners are online but continuously busy.
- **62 runs are queued** on the same workflow; the queue is not draining at a
  usable rate — runs created 19:01Z were completing only around 23:14-23:17Z
  (~1/hr throughput).
- PR #705's run (created 21:00:56Z) sits behind that backlog with
  `started_at: null`.

This matches the fleet-wide VPS runner contention already recorded in
`docs/PROJECT-HISTORY.md` (the 2026-08-14 sshd session-table exhaustion lane,
resolved by PR #712) — the shared verify pool is again the bottleneck. It is
not something this lane can resolve without touching shared control-plane
infrastructure, which the packet's single-lane scope forbids.

## Why no further push/PR was made

- The branch is already fully current with `main` (0 commits behind); the PR is
  already open. Re-pushing would only enqueue a *fresh* verify run behind the
  same 62-run backlog and make the merge wait longer.
- PR #637 (`feat/slack-teams-webhook-delivery`) is an earlier duplicate of the
  same work; PR #705 supersedes it with the provider-mapping fix and tests.

## Actions to unblock (for the orchestrator / Nish)

1. Let the queue drain, then merge PR #705 (it will merge cleanly; `mergeable:
   MERGEABLE`).
2. Or investigate the stalled shared `vps-verify` runner pool (the queue has
   been effectively frozen for runs created after 19:01Z — likely the same
   class of VPS session/runner exhaustion as PR #712).

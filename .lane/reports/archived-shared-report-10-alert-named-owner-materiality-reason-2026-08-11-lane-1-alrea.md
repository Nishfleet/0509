# Alert named owner + materiality reason (2026-08-11 lane 1) — already resolved by PR #571

**Status: already resolved; this lane records the evidence only.**

Branch: `report/lane1-alert-owner-materiality-already-resolved`
Base: `origin/main` at `7b618cdb`

## Item

- [ ] Add a named owner and materiality reason to every alert before
  delivery [research-desk 2026-08-08, risk: amber]

## Verdict

No code change was warranted. The item is already landed on `origin/main`:

- PR #571 — `47db20f4` "feat(alerts): named owner and materiality reason on
  every delivered alert", merged 2026-08-11 (commit date 2026-08-11 00:34
  +0530, before this worktree was created at 01:20). The resolving commit is
  an ancestor of the current `main` HEAD (`7b618cdb`), and no later commit
  touches the involved files (`app/lib/change-intelligence.ts`,
  `app/lib/delivery.server.ts`, `app/lib/digest-email.server.ts`,
  `app/lib/monitoring.server.ts`).

## Evidence on current main

The E2 alert increment (research-desk 2026-08-08) extended the briefs
accountability contract (PR #546, digest named owner + materiality reason +
next action, deployed 2026-08-09) to instant watchlist alerts. Every
customer-facing delivered alert now carries exactly one named owner and a
non-empty materiality reason before delivery:

- **Named owner**: `digestReviewerLabel` (in `change-intelligence.ts`)
  resolves exactly one accountable reviewer — the workspace owner identity
  when a profile name is known, else the truthful "Workspace owner" role
  fallback. The watchlist/competitor name is never used as the user identity
  (`monitoring.server.ts` now passes `profile?.name ?? null` instead of
  `?? watchlist.name`). Both `deliverWatchlistAlerts` (instant alerts) and
  every digest builder in `digest-email.server.ts` (changed, quiet,
  failed-check, no-record, presence) route through this one resolver.
- **Materiality reason**: `alertMaterialityReason` shares the digest event
  classification (`materialityClausesFromItems`), so an alert and a brief
  never disagree about what a change type means:
  - provisional alerts say the change is unconfirmed;
  - baseline snapshots say they are the starting point;
  - confirmed changes name what moved, derived from the filed events only;
  - a shape with no derivable statement renders an explicit fallback rather
    than an empty reason.
  The P1 follow-up (same PR) fails closed on unevidenced materiality:
  `deliverWatchlistAlerts` resolves every event to its customer evidence
  state via one bounded batched query (`listProofCapturePairsForEventIds`),
  and `buildInstantAlertContent` derives confirmed copy from `verified_change`
  items only — a confirmed status alone, missing/failed proof, an unordered
  capture pair, or an evidence-lookup failure all render the provisional
  block and never block delivery.
- **Every delivery channel**: alert emails render the labeled accountability
  block (Why this matters + Accountable reviewer) via the shared
  digest-email renderer; Slack alerts carry the same two lines
  (`renderInstantSlackText`); digest emails render the same block in every
  state including the explicit no-record failure state. WhatsApp is
  template-bound and not customer-facing in this codebase
  (`isWhatsAppDeliveryCustomerFacing()` is hardcoded `false` in
  `app/lib/ga-customer-surface.ts`), so no customer receives a WhatsApp
  alert without the contract; operator/internal alerts (cron failure,
  watchlist-failure, customer-at-risk, scheduled-work gap) are
  operator-facing infrastructure pages, not customer alert deliveries.

## Regression pins (on this tip)

- `tests/delivery.server.test.ts` — single/batched instant alert emails
  render "Why this matters" + "Accountable reviewer" (named owner identity
  and "Workspace owner" fallback); P1 evidence truth: confirmed alerts stay
  provisional when proof capture is missing, failed, or unordered; confirmed
  materiality renders only for a succeeded ordered capture pair; a mixed
  batch is never marked verified when only one event has evidence; a batch
  with no verified event says the alert is provisional.
- `tests/digest-email.test.ts` — briefs render materiality reason, reviewer,
  and next action (price change, CTA movement, shared triage explanation,
  failed-check periods); truthful "Workspace owner" fallback for blank
  recipient names; explicit failure state for an empty period with no
  heartbeat; alert materiality derived from the shared event vocabulary.
- `tests/change-intelligence.test.ts` does not exist as a standalone file;
  the shared classification is covered through the two suites above.

## Verification on this tip (origin/main `7b618cdb`)

- `tests/delivery.server.test.ts` + `tests/digest-email.test.ts`: 2 files,
  90/90 tests pass (2026-08-11 lane run).
- `tests/instant-alert-delivery-claims.test.ts` +
  `tests/instant-channel-delivery-claims.test.ts` +
  `tests/digest-intelligence.test.ts`: 3 files, 35/35 tests pass.

## Files

- `.lane/report.md` — evidence record only; no product code touched.

---

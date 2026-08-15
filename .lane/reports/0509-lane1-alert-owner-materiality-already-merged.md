# Lane 1 evidence: named owner + materiality reason on every alert — already merged

Item: "Add a named owner and materiality reason to every alert before delivery"
(research-desk 2026-08-08, risk: amber).
This lane records resolution evidence; no product code change was warranted.

## Resolution

The item is already merged to origin/main:

- PR #571 — commit `47db20f4` "feat(alerts): named owner and materiality reason
  on every delivered alert" (merged 2026-08-11), built on the digest-side PR
  #546 — commit `3484e7d8` "feat(digest): named owner, materiality reason, and
  next action on every brief" (merged 2026-08-09, the scout's own flag date).
  Both are ancestors of main HEAD `b21cc135`.

## What the merged code does

- `app/lib/change-intelligence.ts` — `alertMaterialityReason()` derives a
  non-empty, human-readable materiality reason from the filed events (never
  invented): provisional alerts state the change is unconfirmed, baseline
  snapshots state they are starting points, confirmed changes name what moved
  (pricing/offers, CTA, campaign start/stop, destination). Shares the digest
  event classification so alerts and briefs never disagree.
- `app/lib/delivery.server.ts` — `buildInstantAlertContent()` attaches the
  materiality reason plus exactly one accountable reviewer
  (`digestReviewerLabel` = workspace owner identity, truthful "Workspace
  owner" fallback, never the watchlist/competitor name) to every instant
  alert before delivery. Email renders the labeled accountability block
  ("Why this matters" + "Accountable reviewer") via the shared digest-email
  renderer; Slack alerts carry the same two lines
  (`renderInstantSlackText`). Reviewer and reason are added on every delivery
  channel in the customer surface.
- `app/lib/digest-email.server.ts` — digests/briefs carry materiality reason,
  reviewer, and next action (or an explicit failure state), via the shared
  `renderEmailAccountabilityBlock`.
- `app/lib/monitoring.server.ts` — callers pass the workspace-owner profile
  identity (never the watchlist name) into delivery.
- WhatsApp: remains template-bound and is not customer-facing in this
  codebase (`ga-customer-surface.ts` returns `false` for both Slack and
  WhatsApp), so it is unchanged — matching the PR's stated scope.

## Evidence of correctness on this tip

- 103/103 tests pass across `tests/delivery.server.test.ts` (43),
  `tests/digest-email.test.ts` (47), `tests/watch-event-evaluator.test.ts`
  (13), including PR #571's regression coverage: confirmed + missing proof,
  failed proof, unordered pair, succeeded ordered pair, mixed
  verified/unverified batches, offer/CTA/campaign-bearing creative copy,
  cosmetic creative copy, and baseline classification.
- The P1 follow-up within #571 (2026-08-10) fails closed on unevidenced
  materiality: only events whose customer evidence state resolves to
  `verified_change` may contribute confirmed materiality copy.

## Files touched by this lane

- `.lane/reports/0509-lane1-alert-owner-materiality-already-merged.md` —
  this evidence record.

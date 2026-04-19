# Proof-First Change Alerts Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `0509`'s existing watchlists and digests into a proof-first competitor monitoring loop with selective Browser Run capture, confirmed watch events, and equal-first email + WhatsApp delivery.

**Architecture:** Keep the current React Router + Workers app and reuse the existing watchlist, run, digest, and `watch_event` surfaces. Split the monitoring pipeline into four explicit layers: cheap scan, selective proof, event confirmation, and delivery. Keep `watch_event` as the durable customer-facing event record, treat `event_candidate` as audit/debug state only, and move per-watchlist proof/delivery execution into a Workflow-backed runner so the cron tick only discovers due work.

**Tech Stack:** React Router v7 on Cloudflare Workers, Cloudflare Workflows, Browser Run, D1, R2, Resend, WhatsApp Cloud API, TypeScript, Vitest

---

## Spec Reference

- `docs/superpowers/specs/2026-04-18-proof-first-change-alerts-design.md`

## Delivery Context

### Current Codebase Baseline

- Watchlists, runs, observations, events, digests, reports, sharing, and exports already exist.
- Fetch-based landing-page capture already stores HTML artifacts and structured landing-page fields.
- Monitoring currently emits only:
  - `ad_new`
  - `ad_inactive`
  - `landing_page_url_changed`
  - `landing_page_headline_changed`
- `runWatchlist(...)` still captures landing pages for every scanned ad, which is the exact behavior this plan must remove.
- `npm run build` and `npm test` pass in the launch-prep worktree.
- `npm run typecheck` is currently red because `tsconfig.node.json` does not cleanly cover the route-test imports.

### This Plan

- Restore a green baseline first.
- Add selective proof capture, proof-backed event confirmation, and trusted delivery without rewriting the whole app.
- Re-center the watchlists experience around watch events, proof, and send history.

### Out Of Scope

- AI Search product surfaces
- visual layout diffing
- creative performance prediction
- Slack delivery
- pricing/package redesign
- multi-platform expansion beyond email + WhatsApp

## Hardening Rules

### Core Doctrine

- The moat is not Browser Run alone.
- The moat is the full operating loop:
  - detect
  - prove
  - prioritize
  - deliver
- Build for trusted competitor-change operations, not for generic page diffing or generic ad search breadth.

### Canonical Landing-Page Identity Rules

- `proof_target` identity must be explicit from day one.
- Store both:
  - `canonical_page_identity`
  - `proof_target`
- `canonical_page_identity` must be derived from:
  - resolved final URL after redirects
  - lowercased hostname
  - normalized path
  - stripped default ports
  - stable trailing-slash handling
  - controlled query-param allowlist/striplist
- Strip known tracking parameters by default, including:
  - `utm_*`
  - `fbclid`
  - `gclid`
  - `mc_cid`
  - `mc_eid`
- `proof_target` should remain watchlist-aware and ad-aware even when two ads point at the same canonical page.
- The implementation must handle explicitly:
  - same ad, new URL
  - different ads, same canonical landing page
  - same landing page in multiple watchlists
  - resolved-final-URL changes caused only by redirect behavior

### Trust And Cost Guardrails

- Cost-control and false-positive control are first-class features, not cleanup work.
- Every proof-backed system path must support:
  - proof budgets
  - dedupe windows
  - idempotency keys
  - extractor versioning
  - extractor confidence
  - webhook-backed delivery reconciliation
  - internal false-positive review before broadening customer delivery

### V1 Proof Threshold Defaults

- The cheap scan must assign a candidate score from `0` to `100`.
- V1 does not expose raw numeric threshold controls to customers.
- V1 customer control is:
  - `Quiet`
  - `Balanced`
  - `Aggressive`
  - `Auto`
- Default proof thresholds:
  - `Quiet`: `85`
  - `Balanced`: `70`
  - `Aggressive`: `60`
  - `Auto`: fixed at `70` in v1
- `Auto` does not adapt in v1.
- Treat `Auto` as `Balanced` for the first release.
- Do not invent historical-learning, dismissal-based tuning, or feedback-based movement in v1.
- If adaptive movement is added later, it should be a separate spec slice.
- Proof must be forced for:
  - `landing_page_url_changed`
  - no prior successful proof for the current ad plus canonical page identity on non-quiet watchlists
- Suggested v1 score inputs:
  - landing-page URL change: `+60`
  - new ad with unseen canonical page identity: `+35`
  - competitor burst above threshold: `+25`
  - no successful proof inside freshness window: `+20`
  - high-priority watchlist: `+10`
  - repeated recent proof failures for same target: `-20`
- Low-signal unchanged ads must stay below threshold when:
  - canonical page identity is unchanged
  - key scan-side fields are unchanged
  - last successful proof is still fresh

### V1 Proof Budget Defaults

- V1 proof ceilings are conservative and fixed by default.
- Do not invent plan-specific budget math in v1 unless the product spec is updated.
- Default ceilings:
  - per watchlist run: `3` proof attempts
  - per watchlist day: `12` proof attempts
  - per workspace day: `60` proof attempts
- Default retry policy:
  - timeout/network/browser transient failures: `1` retry
  - extraction/parser/no-content failures: `0` retries
- Default circuit breaker:
  - if the last `20` proof attempts for a workspace fail at `>= 50%`, stop non-forced proof attempts for that workspace until the next day window
- Forced proof events may bypass normal budget ceilings only for:
  - `landing_page_url_changed`
- Forced proof events must still respect:
  - concurrency caps
  - timeout caps
  - idempotency rules

### Launch Gate

- Do not widen the customer lane until all of these are true over the current internal eval window:
  - proof success rate: `>= 80%`
  - false-positive rate on the eval set: `<= 5%`
  - provisional customer-send share: `<= 2%`
  - duplicate-send rate: `<= 0.1%`
  - webhook reconciliation lag p95: `<= 5 minutes`
  - provider/webhook reconciliation success: `>= 98%`

### Delivery Rollout Guardrail

- Product scope remains email plus WhatsApp from day one.
- Implementation rollout must not let WhatsApp provider or template issues block the rest of the delivery layer.
- Customer WhatsApp rollout must stay behind provider-readiness and template-readiness gates until:
  - templates are approved
  - opt-in state is working
  - internal eval quality is acceptable

### Workflow Fallback

- Default orchestration path: Cloudflare Workflows.
- Fallback if Workflows becomes the blocker:
  - keep the same single-watchlist executor
  - drive it from cron/manual entrypoints
  - use a D1-backed due-work queue plus idempotency keys
- Do not switch to a second orchestration model unless Workflows is the specific blocker.

## File Map

### Create

- `migrations/0007_proof_first_change_alerts.sql`
- `docs/superpowers/artifacts/0007_proof_first_change_alerts.rollback.sql`
- `workers/monitoring-workflow.ts`
- `app/lib/browser-run.server.ts`
- `app/lib/proof-policy.server.ts`
- `app/lib/watch-event-evaluator.server.ts`
- `app/lib/delivery-policy.server.ts`
- `app/lib/delivery.server.ts`
- `app/lib/whatsapp.server.ts`
- `app/routes/app.ops.tsx`
- `app/routes/api.delivery-status.$provider.ts`
- `docs/superpowers/artifacts/2026-04-18-proof-first-delivery-copy-matrix.md`
- `tests/proof-policy.test.ts`
- `tests/watch-event-evaluator.test.ts`
- `tests/delivery-policy.test.ts`
- `tests/watchlists.route.test.ts`
- `tests/landing-pages.browser-run.test.ts`
- `tests/monitoring-idempotency.test.ts`
- `tests/delivery-webhooks.test.ts`
- `tests/proof-evals.test.ts`
- `tests/proof-first-pipeline.test.ts`

### Modify

- `tsconfig.node.json`
- `app/routes.ts`
- `wrangler.jsonc`
- `workers/app.ts`
- `app/lib/env.server.ts`
- `app/lib/types.ts`
- `app/lib/data.server.ts`
- `app/lib/landing-pages.server.ts`
- `app/lib/monitoring.server.ts`
- `app/lib/landing-page-display.ts`
- `app/lib/search-selection.server.ts`
- `app/routes/app.watchlists.tsx`
- `app/routes/app.digests.tsx`
- `app/routes/app.dashboard.tsx`
- `app/routes/app.reports.tsx`
- `app/routes/marketing.tsx`
- `tests/onboarding.route.test.ts`
- `tests/plan-limits.route.test.ts`
- `tests/stripe-checkout.route.test.ts`
- `tests/search.route.test.ts`
- `tests/data.server.test.ts`
- `tests/monitoring.test.ts`
- `tests/plan-monitoring.test.ts`
- `tests/landing-page-display.test.ts`

### Verify

- `app/routes/share.$token.tsx`
- `app/routes/export.$resourceType.$resourceId.tsx`
- `app/lib/search-selection.server.ts`
- `app/routes/app.reports.tsx`
- `app/lib/report-builder.server.ts`

---

## Chunk 1: Restore Green Baseline And Land The Spec

### Task 1: Fix the existing `typecheck` blocker before feature work

**Files:**
- Modify: `tsconfig.node.json`
- Modify: `app/routes.ts`
- Modify: `tests/onboarding.route.test.ts`
- Modify: `tests/plan-limits.route.test.ts`
- Modify: `tests/stripe-checkout.route.test.ts`
- Verify: `docs/superpowers/specs/2026-04-18-proof-first-change-alerts-design.md`

- [ ] Freeze the spec content before touching the typecheck fix. If any further spec wording changes are needed, stop and land those separately before proceeding with the baseline work.
- [ ] Add `app/routes.ts` to the Node-side TypeScript project so the route-tree import in `tests/stripe-checkout.route.test.ts` is part of the build graph.
- [ ] Keep JSX-capable route tests inside the node build instead of suppressing them or excluding them.
- [ ] Replace the loose mock component props in `tests/plan-limits.route.test.ts` and `tests/stripe-checkout.route.test.ts` with typed props that explicitly accept `children` and `to`.
- [ ] Give `flattenRoutePaths(...)` in `tests/stripe-checkout.route.test.ts` an explicit string-array return type so recursive inference stops fighting TS 6.
- [ ] Run the full root verifier only: `npm run typecheck`
- [ ] Do not treat isolated Node-side `tsc`, route-only checks, or partial project builds as success for this task.
- [ ] Expected: PASS with no `--jsx is not set`, `TS6307`, worker-build, or route-tree type errors.
- [ ] Re-read the spec before the baseline commit and confirm the final edits are present:
  - `Current Codebase Baseline` wording is in place
  - watch event stays the primary product value object
  - watch event is the primary unit of value
  - WhatsApp delivery principles are explicit
  - post-v1 action layer is captured
- [ ] Stage the baseline fix plus the approved spec together once `npm run typecheck` is green.
- [ ] Commit: `git commit -m "chore: restore launch-prep baseline and land proof-first spec"`

---

## Chunk 2: Schema, Types, And Workflow Entry Points

### Task 3A: Add the proof-first SQL migration without changing app logic yet

**Files:**
- Create: `migrations/0007_proof_first_change_alerts.sql`
- Create: `docs/superpowers/artifacts/0007_proof_first_change_alerts.rollback.sql`

- [ ] Use the real next migration number from the live repo: `0007`.
- [ ] Do not reuse the missing `0004` gap.
- [ ] Create a migration that keeps existing watchlists/digests intact while adding the new proof-first primitives:
  - `event_candidate`
  - `proof_target`
  - `proof_capture`
  - `workspace_delivery_config`
  - `watchlist_delivery_config`
  - `delivery_target`
  - `delivery_attempt`
- [ ] Extend `watch_event` instead of creating a second customer-facing event table. Add fields for:
  - `status`
  - `importance_score`
  - `candidate_id`
  - `proof_capture_id`
  - `confirmed_at`
  - `suppressed_at`
  - `invalidated_at`
  - `last_evaluated_at`
- [ ] Track proof freshness on `proof_target`, not on the event:
  - `last_capture_attempt_at`
  - `last_successful_proof_at`
  - `last_successful_capture_id`
- [ ] Add proof-capture hardening columns from day one:
  - `extractor_version`
  - `field_confidence_json`
  - `extraction_warnings_json`
  - `render_mode`
  - `device_profile`
  - `idempotency_key`
- [ ] Add delivery-attempt hardening columns from day one:
  - `idempotency_key`
  - `provider_status_last_seen_at`
  - `webhook_status`
  - `payload_snapshot_json`
- [ ] Add explicit outcome/status values for skipped or degraded work:
  - `skipped_due_to_budget`
  - `skipped_due_to_rate_limit`
  - `skipped_due_to_dedupe`
  - `skipped_due_to_quiet_hours`
- [ ] Keep `digest_run` and `digest_item` as digest artifacts, but make `delivery_attempt` the general log for both instant alerts and digests.
- [ ] Keep `event_candidate` explicitly as audit/debug state and leave `watch_event` as the primary product event surface.
- [ ] Add the index plan needed for v1 query performance:
  - watch-event recent-by-watchlist/status index
  - proof-target identity lookup index
  - proof-capture recent-by-target/day index
  - delivery-attempt recent-by-target/channel index
  - workspace-delivery-config by `user_id`
  - unique idempotency-key indexes
- [ ] Write the inverse DDL in `docs/superpowers/artifacts/0007_proof_first_change_alerts.rollback.sql`.
- [ ] Treat D1 rollback as backup plus roll-forward first:
  - document the backup step before apply
  - keep the rollback SQL for emergency/manual recovery
- [ ] Run: `npm run typecheck`
- [ ] Expected: PASS or fail only on still-unimplemented app-layer type references, not on SQL syntax issues.

### Task 3B: Update TypeScript record types and enums for the new model

**Files:**
- Modify: `app/lib/types.ts`

- [ ] Update `app/lib/types.ts` with the new records and enums:
  - event statuses
  - sensitivity modes
  - delivery lanes
  - delivery channels
  - proof statuses
- [ ] Expand the `watch_event` type check so v1 event types include:
  - `landing_page_offer_changed`
  - `landing_page_cta_changed`
  - `landing_page_form_changed`
- [ ] Add explicit record types for:
  - `EventCandidateRecord`
  - `ProofTargetRecord`
  - `ProofCaptureRecord`
  - `WorkspaceDeliveryConfigRecord`
  - `WatchlistDeliveryConfigRecord`
  - `DeliveryTargetRecord`
  - `DeliveryAttemptRecord`
- [ ] Add typed outcome enums for:
  - proof-skip reasons
  - dedupe reasons
  - webhook reconciliation status
- [ ] Run: `npm run typecheck`
- [ ] Expected: PASS with compile-time coverage for the new record shapes before data access code changes.

### Task 3C: Update `data.server.ts` reads and writes for the new schema

**Files:**
- Modify: `app/lib/data.server.ts`

- [ ] Add row types, mappers, inserts, and list/get helpers for the new proof-first tables.
- [ ] Extend existing `watch_event` reads and writes so status, importance, proof linkage, and confirmation timestamps are persisted without breaking current consumers.
- [ ] Keep digest browsing helpers stable while routing actual send history through `delivery_attempt`.
- [ ] Persist canonical landing-page identity and proof-target identity as separate data concepts so freshness and dedupe logic do not collapse them together.
- [ ] Do not move monitoring orchestration into `data.server.ts`; this task is data access only.
- [ ] Run: `npm run typecheck`
- [ ] Expected: PASS with all new data helpers compiling cleanly.

### Task 3D: Add focused data-layer tests for the new schema

**Files:**
- Test: `tests/data.server.test.ts`

- [ ] Add focused `tests/data.server.test.ts` coverage for:
  - new table inserts/selects
  - expanded `watch_event` persistence
  - proof freshness timestamp handling
  - delivery-attempt logging primitives
  - proof-capture extractor metadata fields
  - delivery-attempt payload snapshot and webhook status fields
- [ ] Keep the tests narrow and data-layer only. Do not pull monitoring policy or UI behavior into this task.
- [ ] Run: `npm run test -- tests/data.server.test.ts`
- [ ] Expected: PASS with concrete assertions on new SQL bindings.
- [ ] Commit: `git commit -m "feat: add proof-first monitoring schema"`

### Task 3E: Add legacy defaults and backfill rules for live data

**Files:**
- Modify: `migrations/0007_proof_first_change_alerts.sql`
- Modify: `app/lib/data.server.ts`
- Test: `tests/data.server.test.ts`

- [ ] Default existing `watch_event` rows during migration to:
  - `status = confirmed`
  - `confirmed_at = created_at`
  - `last_evaluated_at = created_at`
  - `candidate_id = NULL`
  - `proof_capture_id = NULL`
- [ ] Backfill legacy `importance_score` for existing `watch_event` rows using a fixed map:
  - `landing_page_url_changed = 85`
  - `landing_page_headline_changed = 75`
  - `ad_new = 65`
  - `ad_inactive = 60`
- [ ] Create one `workspace_delivery_config` row per existing user with conservative defaults:
  - email enabled when a user email exists
  - WhatsApp disabled until opt-in exists
  - `Balanced` sensitivity
  - digest enabled
  - instant disabled
- [ ] Keep existing users on digest-first behavior by default.
- [ ] Do not enable customer instant alerts for legacy users during migration.
- [ ] Only allow customer instant alerts for legacy users after:
  - the launch gate is met
  - and the user explicitly enables instant delivery or a controlled rollout flag enables it
- [ ] If a controlled rollout flag exists for legacy instant alerts, it must default to `off`, and the migration/backfill must not turn it on.
- [ ] Backfill synthetic legacy email `delivery_attempt` rows from existing `digest_delivery` rows with:
  - `lane = customer`
  - `channel = email`
  - `webhook_status = legacy_unknown`
  - payload snapshot from the best available digest summary state
- [ ] Do not synthesize `proof_capture` rows for every historical landing-page snapshot.
- [ ] Preserve old landing-page snapshots as legacy renderable history, and let new proof-state tracking begin only when a new `proof_target` is created or explicitly seedable from an unambiguous latest snapshot.
- [ ] Run: `npm run test -- tests/data.server.test.ts`
- [ ] Expected: PASS with explicit coverage for legacy watch-event and digest backfill behavior.
- [ ] Commit: `git commit -m "feat: backfill proof-first defaults for live data"`

### Task 4: Add Workflow and provider bindings at the edges, not inline in business logic

**Files:**
- Create: `workers/monitoring-workflow.ts`
- Modify: `workers/app.ts`
- Modify: `wrangler.jsonc`
- Modify: `app/lib/env.server.ts`
- Test: `tests/monitoring-idempotency.test.ts`

- [ ] Add the Browser Run, Workflow, and WhatsApp provider bindings/secrets in the Worker env types and `wrangler.jsonc`.
- [ ] Keep provider-specific binding syntax isolated to the edge files:
  - `workers/app.ts`
  - `workers/monitoring-workflow.ts`
  - `app/lib/env.server.ts`
- [ ] Change the scheduled handler so the cron tick discovers due watchlists and enqueues per-watchlist workflow work instead of doing all proof + delivery inline.
- [ ] Keep manual watchlist refreshes calling the same single-watchlist executor so the manual and scheduled paths do not drift.
- [ ] Add idempotency keys for:
  - watchlist-run execution
  - proof-capture requests
- [ ] Prove that workflow retries or duplicate cron triggers do not create duplicate proof work.
- [ ] Keep the executor boundary clean enough that the D1-queue fallback can call the same single-watchlist entrypoint if Workflows becomes the blocker.
- [ ] Run: `npm run typecheck`
- [ ] Expected: PASS with all new env/binding types wired through the app.
- [ ] Run: `npm run test -- tests/monitoring-idempotency.test.ts`
- [ ] Expected: PASS with explicit duplicate-trigger protection.
- [ ] Commit: `git commit -m "feat: add workflow and provider entrypoints"`

---

## Chunk 3: Selective Proof Acquisition

### Task 5: Remove universal landing-page recapture from the scan path

**Files:**
- Modify: `app/lib/monitoring.server.ts`
- Test: `tests/monitoring.test.ts`
- Test: `tests/plan-monitoring.test.ts`

- [ ] Split the current `runWatchlist(...)` flow into:
  - cheap scan persistence
  - candidate generation
- [ ] Stop calling `captureLandingPageSnapshot(...)` for every scanned ad during the cheap scan.
- [ ] Keep ad persistence and creative-text reuse in place, but make landing-page proof opt-in through policy.
- [ ] Store enough scan-side observation data to decide whether proof is worth paying for:
  - ad id
  - current landing-page URL
  - active/inactive state
  - advertiser metadata
- [ ] Preserve the current `ad_new`, `ad_inactive`, and `landing_page_url_changed` scan-native behavior while shifting landing-page content changes behind proof.
- [ ] Do not wire proof policy, proof status transitions, or importance scoring in this task. This task ends with a clean candidate-only scan path.
- [ ] Run: `npm run test -- tests/monitoring.test.ts tests/plan-monitoring.test.ts`
- [ ] Expected: PASS with tests proving the scan path no longer forces universal landing-page capture.

### Task 6: Replace the fake browser fallback with real Browser Run proof capture

**Files:**
- Create: `app/lib/browser-run.server.ts`
- Modify: `app/lib/landing-pages.server.ts`
- Modify: `app/lib/env.server.ts`
- Test: `tests/landing-pages.browser-run.test.ts`

- [ ] Create `app/lib/browser-run.server.ts` as the only module that knows how to talk to Browser Run.
- [ ] Capture the default proof bundle for successful proof runs:
  - mobile-first screenshot
  - rendered HTML snapshot
  - normalized extracted fields
  - capture metadata
- [ ] Persist screenshot and HTML artifacts to R2 and return storage keys instead of giant in-memory blobs.
- [ ] Reuse the existing landing-page signal extraction path so fetch and browser-rendered HTML share the same CTA/offer/form parser.
- [ ] Store extractor hardening metadata on every successful proof capture:
  - extractor version
  - per-field confidence
  - extraction warnings
  - render mode
  - device profile
- [ ] Delete the current `fallback_not_configured` fake Browser Run result. Proof capture should now either succeed honestly or fail honestly.
- [ ] Run: `npm run test -- tests/landing-pages.browser-run.test.ts tests/data.server.test.ts`
- [ ] Expected: PASS with explicit success/failure coverage for the Browser Run wrapper.

### Task 7: Add proof policy and event evaluation

**Files:**
- Create: `app/lib/proof-policy.server.ts`
- Create: `app/lib/watch-event-evaluator.server.ts`
- Modify: `app/lib/monitoring.server.ts`
- Modify: `app/lib/types.ts`
- Test: `tests/proof-policy.test.ts`
- Test: `tests/watch-event-evaluator.test.ts`
- Test: `tests/monitoring.test.ts`

- [ ] Start from the candidate-only scan path produced in Task 5. Do not reintroduce landing-page capture into the cheap scan.
- [ ] Add a `proof policy` module that decides whether to spend proof budget based on exactly three buckets:
  - `event-triggered`
  - `freshness-triggered`
  - `priority-triggered`
- [ ] Enforce proof cost controls directly in the policy layer:
  - per-watchlist proof-attempt ceilings
  - per-workspace proof-attempt ceilings
  - concurrency caps
  - timeout classes
  - retry caps by failure class
  - failure-rate circuit breaker
- [ ] Implement the proof budget ledger for v1 using indexed `proof_capture` counts by watchlist/workspace/day unless profiling proves a separate counter table is required.
- [ ] Add a `watch-event evaluator` that compares current proof against the **last successful proof**, not the last failed attempt.
- [ ] Generate cheap `event_candidate` rows first, then transition them through:
  - `detected`
  - `proof_pending`
  - `confirmed`
  - `suppressed`
  - `invalidated`
  - `proof_failed`
- [ ] Add proof-backed confirmation rules for:
  - `landing_page_headline_changed`
  - `landing_page_offer_changed`
  - `landing_page_cta_changed`
  - `landing_page_form_changed`
- [ ] Add bounded importance scoring that considers:
  - event type
  - proof presence
  - burst activity
  - watchlist sensitivity
  - India-aware boosts
- [ ] Add dedupe and suppression rules explicitly:
  - same event type + same proof target + same normalized diff within a suppression window -> dedupe
  - repeated `detected` or `proof_failed` chains after threshold -> suppress
  - burst aggregation window by competitor + watchlist
- [ ] Record skipped or suppressed outcomes explicitly:
  - `skipped_due_to_budget`
  - `skipped_due_to_rate_limit`
  - `skipped_due_to_dedupe`
- [ ] Keep this task responsible only for:
  - proof targeting
  - proof-backed evaluation
  - event status transitions
  - importance scoring
- [ ] Do not change cheap scan behavior here beyond consuming the candidate records it now produces.
- [ ] Keep the event evaluator pure enough to unit test without D1 or Cloudflare bindings.
- [ ] Run: `npm run test -- tests/proof-policy.test.ts tests/watch-event-evaluator.test.ts tests/monitoring.test.ts`
- [ ] Expected: PASS with clear candidate-to-confirmed and invalidation coverage.
- [ ] Commit: `git commit -m "feat: add selective proof capture and event confirmation"`

### Task 7B: Build the proof eval harness before delivery work

**Files:**
- Create: `tests/proof-evals.test.ts`
- Modify: `tests/monitoring.test.ts`
- Modify: `tests/watch-event-evaluator.test.ts`

- [ ] Create a standing internal eval set before delivery wiring expands:
  - known headline changes
  - known CTA changes
  - known offer changes
  - known form-state changes
  - known non-changes
  - known template-noise cases
  - known cookie-banner or modal noise cases
- [ ] Make the eval set runnable against the proof policy and event evaluator modules directly.
- [ ] Use this harness to check:
  - proof success rate
  - extraction accuracy
  - false-positive rate
  - low-signal skip behavior
- [ ] Treat this task as the gate before customer-delivery logic expands.
- [ ] Run: `npm run test -- tests/proof-evals.test.ts tests/watch-event-evaluator.test.ts tests/monitoring.test.ts`
- [ ] Expected: PASS with explicit false-positive protection cases.
- [ ] Commit: `git commit -m "test: add early proof eval harness"`

---

## Chunk 4: Trusted Delivery

### Task 8: Add watchlist delivery settings, targets, and delivery policy

**Files:**
- Create: `app/lib/delivery-policy.server.ts`
- Modify: `app/lib/types.ts`
- Modify: `app/lib/data.server.ts`
- Test: `tests/delivery-policy.test.ts`
- Test: `tests/data.server.test.ts`

- [ ] Add workspace-default delivery config keyed by `user_id` for:
  - instant on/off
  - digest on/off
  - default channel toggles
  - default sensitivity mode
  - quiet hours
  - timezone
- [ ] Add watchlist-level delivery overrides for:
  - instant on/off
  - digest on/off
  - channel toggles
  - sensitivity mode
  - quiet hours
  - timezone
- [ ] Add channel-specific delivery targets with independent validation state for:
  - email
  - WhatsApp
- [ ] Encode the two-lane policy explicitly:
  - `internal`
  - `customer`
- [ ] Keep `Auto` fixed at `Balanced` in v1. Do not introduce adaptive behavior in this task.
- [ ] Batch by:
  - competitor
  - watchlist
  - short time window
- [ ] Make the policy rule explicit in code:
  - proof policy decides whether to capture
  - delivery policy decides whether to interrupt
- [ ] Run: `npm run test -- tests/delivery-policy.test.ts tests/data.server.test.ts`
- [ ] Expected: PASS with deterministic policy outputs for quiet/balanced/aggressive/auto modes.

### Task 9: Move delivery orchestration out of `monitoring.server.ts`

**Files:**
- Create: `app/lib/delivery.server.ts`
- Create: `app/lib/whatsapp.server.ts`
- Modify: `app/lib/monitoring.server.ts`
- Modify: `app/lib/env.server.ts`
- Modify: `app/routes/app.digests.tsx`
- Test: `tests/delivery-policy.test.ts`
- Test: `tests/plan-monitoring.test.ts`

- [ ] Extract `sendDigestEmail(...)` into `app/lib/delivery.server.ts` so monitoring no longer owns provider logic.
- [ ] Add a WhatsApp adapter that:
  - requires explicit opt-in
  - uses approved template sends
  - logs provider message ids and failures
  - returns honest failure states when the channel is not configured
- [ ] Keep WhatsApp v1 narrow:
  - customer WhatsApp supports conservative instant alerts and optional basic digests
  - no rich conversational workflow
  - no freeform message composition
- [ ] Keep customer email as the reliability baseline even while WhatsApp remains in v1 scope.
- [ ] Gate customer WhatsApp sends behind a provider/template readiness flag so template approval delays cannot block the email path or internal lane.
- [ ] Use predefined templates by event family instead of dynamic template selection at send time.
- [ ] If a template-safe send is impossible, skip WhatsApp, fall back to email where allowed, and log the WhatsApp attempt as failed or skipped with the exact reason.
- [ ] Use one WhatsApp adapter with lane-aware policy branching instead of separate internal/customer transport implementations.
- [ ] Store provider state at both layers:
  - `delivery_target` keeps current eligibility, opt-in, and pause state
  - `delivery_attempt` keeps the immutable payload snapshot, provider ids, and webhook-backed outcome
- [ ] Add idempotency keys for delivery attempts keyed by:
  - event batch
  - channel
  - target
  - send window
- [ ] Log every attempt to `delivery_attempt` with:
  - channel
  - lane
  - target
  - included event ids
  - provider message id
  - status
  - error
- [ ] Keep customer WhatsApp sends heavily biased toward `confirmed` events and make provisional customer sends rare and labeled.
- [ ] Keep internal delivery looser so it can surface `proof_failed` and other tuning signals without polluting the customer lane.
- [ ] Update digest generation so email and WhatsApp digests both use the same delivery log, while `digest_run` and `digest_item` remain the browsing surface.
- [ ] Add webhook-backed status reconciliation as explicit scope:
  - ingest delivery status callbacks where providers support them
  - update `delivery_attempt.webhook_status`
  - update `provider_status_last_seen_at`
  - reconcile final state without mutating the immutable payload snapshot
- [ ] Run: `npm run test -- tests/plan-monitoring.test.ts tests/delivery-policy.test.ts`
- [ ] Expected: PASS with separate internal/customer behavior and channel-specific delivery outcomes.
- [ ] Commit: `git commit -m "feat: add proof-first alert delivery"`

### Task 9C: Create the delivery copy matrix before customer sends widen

**Files:**
- Create: `docs/superpowers/artifacts/2026-04-18-proof-first-delivery-copy-matrix.md`

- [ ] Write one compact artifact that defines:
  - instant email copy families
  - digest email copy families
  - WhatsApp template families
  - provisional wording
  - fallback wording
  - blocked-template wording
- [ ] Keep the language trust-first:
  - short
  - confidence-aware
  - non-ambiguous
- [ ] Do not let product wording drift independently inside templates, UI, and digests after this file exists.
- [ ] Commit: `git commit -m "docs: add proof-first delivery copy matrix"`

### Task 9D: Add a lightweight internal operator surface

**Files:**
- Create: `app/routes/app.ops.tsx`
- Modify: `app/routes.ts`
- Modify: `app/lib/env.server.ts`
- Modify: `app/lib/data.server.ts`
- Create: `tests/ops.route.test.ts`

- [ ] Add one internal operator page that answers:
  - what is failing
  - what is stuck
  - what is paused by budget
  - what is blocked by provider or template state
  - which watchlists are degraded right now
- [ ] Keep it internal-facing and operational, not customer-polished.
- [ ] Gate the route with an explicit deploy-time email allowlist:
  - add `OPS_ALLOWLIST_EMAILS` to env parsing
  - treat it as a comma-separated list of allowed operator emails
- [ ] Require route-level protection:
  - enforce the gate in the route loader/action before any operator query runs
  - if the allowlist is unset or empty, return a denied response
  - if the authenticated user email is not allowlisted, return a denied response
  - do not rely on navigation hiding alone
- [ ] Keep the route out of normal customer navigation unless the current user is allowlisted.
- [ ] Add route tests for:
  - allowlisted access
  - denied authenticated access
  - denied access when the allowlist is unset
  - no operator data fetch when access is denied
- [ ] Reuse bounded indexed queries and recent windows; do not build a full analytics surface.
- [ ] Commit: `git commit -m "feat: add proof-first operator surface"`

### Task 9B: Add delivery webhook ingestion and reconciliation

**Files:**
- Create: `app/routes/api.delivery-status.$provider.ts`
- Modify: `app/routes.ts`
- Modify: `app/lib/delivery.server.ts`
- Modify: `app/lib/whatsapp.server.ts`
- Test: `tests/delivery-webhooks.test.ts`

- [ ] Add provider-status webhook ingestion routes needed for delivery reconciliation.
- [ ] Verify webhook signatures or provider auth where supported before mutating delivery state.
- [ ] Reconcile only mutable delivery-state fields from webhook events:
  - provider status
  - last seen time
  - terminal success/failure state
- [ ] Keep payload snapshots and idempotency keys immutable after the original send attempt is recorded.
- [ ] Run: `npm run test -- tests/delivery-webhooks.test.ts`
- [ ] Expected: PASS with duplicate webhook events handled idempotently.
- [ ] Commit: `git commit -m "feat: reconcile delivery webhooks"`

---

## Chunk 5: Watchlists Become The Control Panel

### Task 10: Rebuild the watchlists route around watch events, proof, and send state

**Files:**
- Create: `tests/watchlists.route.test.ts`
- Modify: `app/routes/app.watchlists.tsx`
- Modify: `app/lib/landing-page-display.ts`
- Modify: `app/lib/types.ts`
- Modify: `app/lib/data.server.ts`
- Test: `tests/landing-page-display.test.ts`

- [ ] Expand the watchlist loader so it returns:
  - delivery config
  - recent event candidates / events
  - proof summary
  - recent delivery attempts
- [ ] Prefer a few bounded indexed queries over one large multi-table join.
- [ ] Keep the default loader budget bounded to recent slices only:
  - recent events
  - recent proof summaries
  - recent delivery attempts
- [ ] Do not load full raw history into the main watchlist route.
- [ ] Keep the default watchlist UI focused on:
  - recent confirmed or salient events
  - proof summary
  - last send state
- [ ] Keep these as secondary or collapsed state in v1:
  - raw candidate history
  - verbose delivery logs
  - low-level operational diagnostics
- [ ] Do not expose the full operational model by default; show the minimum user-facing state needed for trust.
- [ ] Add watchlist actions for:
  - updating channel toggles
  - updating sensitivity
  - saving quiet hours/timezone
  - adding or pausing delivery targets
- [ ] Replace the bare recent-events list with cards that show:
  - event type
  - status
  - importance
  - proof summary
  - proof age
  - confidence band
  - one-line why-alerted explanation
  - last send state
- [ ] Keep the run history, but add summary counts for:
  - candidates detected
  - proofs attempted
  - events confirmed
  - sends triggered
- [ ] Preserve refresh, export, and share actions.
- [ ] Run: `npm run test -- tests/watchlists.route.test.ts tests/landing-page-display.test.ts`
- [ ] Expected: PASS with the watchlist route clearly behaving like a monitoring control panel.

### Task 11: Update digest/dashboard/marketing copy so the product story matches the shipped behavior

**Files:**
- Modify: `app/routes/app.digests.tsx`
- Modify: `app/routes/app.dashboard.tsx`
- Modify: `app/routes/marketing.tsx`
- Modify: `tests/plan-limits.route.test.ts`

- [ ] Change user-facing copy from research-dashboard language toward:
  - what changed
  - proof
  - delivery confidence
- [ ] Keep the digests route focused on digest history and channel status, not as the primary home for competitor monitoring.
- [ ] Update the marketing route so the wedge is `See what changed, with proof`.
- [ ] Keep pricing-lock behavior unchanged: the route tests should still prove no purchase CTA leaks into locked surfaces.
- [ ] Run: `npm run test -- tests/plan-limits.route.test.ts tests/watchlists.route.test.ts`
- [ ] Expected: PASS with new wording but unchanged access-control behavior.
- [ ] Commit: `git commit -m "feat: center watchlists on proof-backed events"`

---

## Chunk 6: Internal Eval And QA Loop

### Task 12: Use the eval harness to tune thresholds before broader customer rollout

**Files:**
- Modify: `tests/monitoring.test.ts`
- Modify: `tests/watch-event-evaluator.test.ts`

- [ ] Track eval outputs for:
  - proof success rate
  - extraction accuracy
  - false-positive rate
  - delivery-regret risk
- [ ] Enforce the launch gate numerically before wider customer rollout:
  - proof success rate `>= 80%`
  - false-positive rate `<= 5%`
  - provisional customer-send share `<= 2%`
  - duplicate-send rate `<= 0.1%`
  - webhook lag p95 `<= 5 minutes`
  - reconciliation success `>= 98%`
- [ ] Require a review pass on the eval set before broadening customer defaults or enabling aggressive delivery.
- [ ] Keep this eval set runnable in CI as a regression harness, even if small.
- [ ] Run: `npm run test -- tests/proof-evals.test.ts tests/watch-event-evaluator.test.ts tests/monitoring.test.ts`
- [ ] Expected: PASS with explicit low-signal and false-positive protection cases.
- [ ] Commit: `git commit -m "test: add proof-first internal eval harness"`

---

## Chunk 7: Final Verification And Regression Pass

### Task 13: Verify the full proof-first loop end to end

**Files:**
- Verify all touched files
- Test: `tests/proof-first-pipeline.test.ts`

- [ ] Run: `npm run test`
- [ ] Run: `npm run typecheck`
- [ ] Run: `npm run build`
- [ ] Smoke-check one manual watchlist refresh and confirm the flow is now:
  - cheap scan
  - selective proof
  - confirmed event creation
  - delivery logging
- [ ] Confirm unchanged low-signal ads no longer trigger proof capture.
- [ ] Confirm proof comparison uses the last successful proof, not the last attempt.
- [ ] Confirm duplicate runs do not duplicate proof work or duplicate sends.
- [ ] Confirm the same normalized proof diff does not repeatedly re-alert within the suppression window.
- [ ] Confirm extractor confidence degrades gracefully instead of turning low-confidence extraction into hard change claims.
- [ ] Confirm the customer lane rarely surfaces `proof_failed` directly.
- [ ] Confirm quiet hours and batching alter send timing the way the delivery policy says they should.
- [ ] Confirm WhatsApp template failures fail safely and fall back the way the delivery policy says they should.
- [ ] Run: `npm run test -- tests/proof-first-pipeline.test.ts`
- [ ] Expected: PASS with one full detect -> prove -> confirm -> deliver integration path.
- [ ] Verify the public search-selection path still renders landing-page capture state correctly after Browser Run changes.
- [ ] Verify the reports route still renders `watch_event` history correctly after the event-shape expansion.
- [ ] Verify the digests route still loads cleanly for both:
  - unlocked users
  - free-plan locked users
- [ ] Verify the share/export/report surfaces still render event summaries after the `watch_event` shape expansion.
- [ ] Summarize:
  - what changed in the data model
  - what changed in the monitoring pipeline
  - what changed in watchlists UX
  - what remains intentionally out of scope

## Notes For Execution

- Do not widen this into AI Search, visual diffing, or performance-prediction work.
- Do not add a second customer-facing event table if `watch_event` can be extended cleanly.
- Do not recapture every landing page on every run. The point of this plan is to remove that behavior.
- Keep Browser Run as the proof acquisition layer, not the user-facing story.
- Treat `proof_failed` as an internal-tuning signal first. Customer surfaces should rarely show it directly.
- If the Workflows integration turns out to need more Cloudflare shape than fits cleanly in this slice, keep the workflow boundary thin and reuse the same single-watchlist executor from both cron and manual paths.

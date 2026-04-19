# Proof-First Change Alerts Design

## Goal

Turn `0509` from a competitor ad search product into a competitor monitoring product for growth teams.

The core promise is:

- `See what changed, with proof.`

The product should feel like a monitoring service, not a dashboard that happens to have alerts.

## Current Codebase Baseline

This section describes the current checked-in system baseline observed in the repo.

It is implementation context, not a claim that every current artifact should survive unchanged in the final architecture.

- The Cloudflare-native rebuild is already live on React Router v7 + Workers.
- `0509` already has:
  - public ad search
  - onboarding
  - saved queries
  - watchlists
  - watchlist runs
  - watch events
  - weekly digests
  - collections
  - reports
  - share and export flows
- Monitoring already stores:
  - `Watchlist`
  - `WatchlistRun`
  - `AdObservation`
  - `WatchEvent`
  - `DigestRun`
  - `DigestDelivery`
- Landing-page capture already exists, including R2-backed artifact storage for fetched HTML.
- Current watch events already cover:
  - `ad_new`
  - `ad_inactive`
  - `landing_page_url_changed`
  - `landing_page_headline_changed`
- Current repo reality matters:
  - `browser_render` exists in types and UI language today
  - but the actual browser-render fallback is still a placeholder, not a real browser-proof path

## Problem

The category has two recurring failures:

- teams discover competitor changes too late
- existing tools rarely provide trusted, timely, proof-backed monitoring

That creates the real product gap:

- not better dashboards
- not more generic AI summaries
- but a trustworthy loop that:
  - scans cheaply
  - captures proof selectively
  - confirms meaningful changes
  - delivers them conservatively

## Product Thesis

`0509` should become the default competitor monitoring system for Indian growth teams and agencies.

The app is the control panel.

The real product is:

- watchlists
- monitoring runs
- proof capture
- change confirmation
- trusted delivery over email and WhatsApp

The primary unit of value in the product is the watch event, not the raw ad.

The moat is:

- selective rendered proof acquisition
- `Workflows` for reliability
- India-aware scoring for positioning and ranking

`Browser Run` is the proof acquisition layer in the architecture, not the external product story.

Externally, users should care about:

- what changed
- what proof exists
- how sure the system is

not the vendor name behind proof capture.

## Positioning

Do not frame `0509` as:

- an ad research product with alerts
- a generic AI agent for marketers
- an AI search layer over ad history

Frame it as:

- a competitor monitoring product for growth teams
- focused on what changed, why it matters, and what proof exists

Homepage and workspace language should shift toward:

- what changed
- how sure we are
- what proof we have
- what got sent or will be sent

## Locked V1 Scope

V1 includes:

- real Browser Run proof capture for selected cases
- selective proof recapture, never universal recapture on every scan
- event candidate detection from low-cost Meta scans
- proof-backed confirmation for meaningful landing-page changes
- event statuses:
  - `detected`
  - `proof_pending`
  - `confirmed`
  - `proof_failed`
  - `suppressed`
  - `invalidated`
- scan-native event types:
  - `ad_new`
  - `ad_inactive`
  - `landing_page_url_changed`
- proof-backed event types:
  - `landing_page_headline_changed`
  - `landing_page_offer_changed`
  - `landing_page_cta_changed`
  - `landing_page_form_changed`
- email and WhatsApp as equal first-class delivery channels from day one
- internal and customer delivery lanes
- quiet hours
- batching
- delivery logs
- watchlist-level delivery controls
- watchlist UX centered on recent changes, proof bundle, and delivery state
- bounded India-aware scoring as a ranking layer

V1 does not include:

- full AI Search product surfaces
- creative performance prediction
- visual layout diffing
- Slack
- broad multi-platform expansion
- pure outcome pricing
- “agent-native” as the customer-facing story

## Core Principle

Proof capture is selective, policy-driven, and event-triggered, not universal per scan.

Every due watchlist should not recapture every landing page on every run.

The product loop is:

1. run a cheap Meta scan
2. detect candidate changes
3. decide what deserves proof recapture
4. capture proof selectively
5. compare against the last successful proof
6. confirm or invalidate the event
7. decide whether to deliver now, later, or never

## Operating Model

The cleanest mental model is:

- monitoring finds possible changes
- proof confirms the meaningful ones
- delivery sends the right level of certainty to the right audience in the right channel

## Proof Policy And Event Model

### Event layers

The system has two event layers:

- `candidate events` from the low-cost Meta scan
- `confirmed events` after selective proof capture and evaluation

The cheap scan decides:

- what changed directly from ad-side data
- what is suspicious enough to justify proof recapture
- what can wait for digest or a later freshness pass

### Proof recapture buckets

Proof recapture should come from three policy buckets:

- `event-triggered`
- `freshness-triggered`
- `priority-triggered`

### Event-triggered proof

Default event-triggered proof should include:

- new ads that look important enough to verify
- landing-page URL changes
- major ad-level shifts that materially raise alert priority

### Freshness-triggered proof

The system must support slow freshness recaptures so it can detect landing-page changes even when ad-side metadata did not visibly change.

Freshness should rely primarily on the last successful proof, not the last failed attempt.

### Priority-triggered proof

Proof may also run when:

- a watchlist is high priority
- an advertiser becomes unusually active
- a candidate event is close to instant-alert eligibility

### Proof is not required for every event

`ad_new` and `ad_inactive` may exist without browser proof.

Landing-page content changes should usually become customer-facing only after proof succeeds.

### Event taxonomy

Customer-facing names should be:

- `ad_new`
- `ad_inactive`
- `landing_page_url_changed`
- `landing_page_headline_changed`
- `landing_page_offer_changed`
- `landing_page_cta_changed`
- `landing_page_form_changed`

Later, but not in v1:

- `visual_layout_changed`

If the implementation later needs a deeper internal label than `landing_page_url_changed`, use:

- `resolved_destination_url_changed`

but keep customer-facing language on landing-page terms.

### Event statuses

Every event needs a status, not just a type:

- `detected`
- `proof_pending`
- `confirmed`
- `proof_failed`
- `suppressed`
- `invalidated`

Use these meanings:

- `suppressed`: real enough to exist, intentionally not surfaced
- `invalidated`: candidate did not survive confirmation or policy evaluation

### Last good proof

Comparison must be against the last successful proof capture, not merely the last attempt.

The spec should explicitly track:

- `last_capture_attempt_at`
- `last_successful_proof_at`

## Delivery Model

### Shared event engine, separate lanes

Use one shared event engine with two delivery lanes:

- `internal`
- `customer`

Both lanes operate on the same underlying truth, but with different risk tolerance.

### Lane behavior

Internal lane:

- may receive earlier, noisier, or more operational alerts
- may include `proof_failed`
- may include more status-heavy wording and debug clues

Customer lane:

- should bias heavily toward clarity and trust
- should be almost entirely free of `proof_failed`
- should mostly receive proof-backed alerts

### Channel model

Email and WhatsApp are equal first-class channels from day one.

Each channel requires separate opt-in.

Users may enable:

- email only
- WhatsApp only
- both

### Settings model

Delivery settings should exist at:

- workspace-default level
- per-watchlist override level

In the current repo shape, workspace-default delivery config should be implemented as a user-scoped workspace config keyed by `user_id`.

Each watchlist should support:

- channels enabled
- instant alerts on or off
- digest alerts on or off
- sensitivity mode:
  - `Quiet`
  - `Balanced`
  - `Aggressive`
  - `Auto`
- quiet hours
- timezone
- recipient targets

Recipient targets are channel-specific and independently validated.

### WhatsApp-specific state

WhatsApp targets need explicit state for:

- opt-in
- opt-out or paused state
- template-eligible delivery
- last successful delivery

### WhatsApp delivery principles

Customer WhatsApp delivery must be:

- official
- opt-in
- template-safe

Use approved template messages where required.

Treat WhatsApp as a:

- high-urgency channel
- high-trust channel

Keep customer WhatsApp messages:

- short
- low-ambiguity
- mostly proof-backed

Push richer detail to:

- email
- a deep link into the workspace

Persist enough delivery state to support audit and safety, including:

- opt-in source
- opt-in timestamp
- template eligibility state
- last successful delivery
- paused or opt-out state
- provider message id
- webhook outcome when available

Customer WhatsApp should rarely send proof-pending items.

If internal WhatsApp delivery exists, it can be more permissive than customer WhatsApp.

### Proof policy vs delivery policy

Keep these separate:

- proof policy decides whether to spend proof budget
- delivery policy decides whether to interrupt the user

They share inputs, but they are not the same decision.

### Instant alerts

Default instant-alert behavior:

- internal lane may receive:
  - `confirmed`
  - selected `proof_pending`
  - selected `proof_failed`
- customer lane should mostly receive:
  - `confirmed`

A very high-value event may exceptionally ship as `detected` or `proof_pending` when delay would reduce user value, but it must be clearly labeled as provisional.

That should stay rare.

### Digests

Digests may include:

- confirmed events
- selected proof-pending events
- grouped lower-urgency changes

Digest is where useful monitoring value can still compound without causing interruption regret.

### Sensitivity modes

Use these defaults:

- `Quiet`: only the strongest confirmed changes
- `Balanced`: the default human-tuned mode
- `Aggressive`: more instant alerts, lower threshold
- `Auto`: default mode for most users

For v1:

- `Auto` should be fixed to `Balanced`
- `Auto` should not adapt yet
- no history-based movement should be invented in implementation

If adaptive behavior is added later, it should be specified in a separate slice.

### Channel feel

WhatsApp should feel like:

- this matters now

Email should feel like:

- here is the full context

For customer WhatsApp:

- keep messages short
- keep them high-trust
- keep them low-ambiguity
- keep richer context behind a link or in email

### Quiet hours and batching

Instant alerts should respect quiet hours.

Urgent-but-not-critical items during quiet hours should roll into the next allowed send window.

Batch primarily by:

- competitor
- watchlist
- short time window

Without batching, the product will feel spammy.

Without quiet hours, it will feel inconsiderate.

### Delivery logging

Every send attempt should track:

- lane
- channel
- target
- event ids
- status
- provider message id
- template used for WhatsApp if applicable
- sent at
- failed at
- failure reason

## Data Model

### Four-layer state model

Keep four explicit state layers:

- `scan state`
- `proof state`
- `event state`
- `delivery state`

This prevents:

- what we saw
- what we verified
- and what we sent

from collapsing into one overloaded record.

### New durable objects

On top of the current watchlist, run, and event model, introduce:

- `proof_target`
  - the thing eligible for proof recapture
  - likely keyed around watchlist, ad, and canonical landing-page identity
- `proof_capture`
  - one proof attempt
  - stores status, attempt time, success time, failure reason, screenshot key, html key, extracted fields, and capture metadata
- `event_candidate`
  - a cheap, durable, audit-friendly candidate signal
  - useful for debug and retry
  - not the main customer-visible event object
- `watch_event`
  - the durable customer-facing event record the app and delivery system use
  - stores event type, status, importance score, timestamps, and proof relationship
- `workspace_delivery_config`
  - workspace-default delivery settings keyed by `user_id` in the current repo shape
- `watchlist_delivery_config`
  - delivery settings for a watchlist
- `delivery_target`
  - channel-specific recipient target and validation state
- `delivery_attempt`
  - one concrete send attempt with provider metadata and result

### Identity caution

`proof_target` identity needs careful canonical wording in implementation, especially for:

- the same ad with a changed destination
- the same landing page reached by multiple ads
- the same proof-worthy page appearing in multiple watchlists

The final implementation plan must define canonical identity explicitly.

### Proof capture failure semantics

Keep both layers:

- `proof_capture` has attempt-level failure metadata
- `watch_event` may also enter `proof_failed` if confirmation depended on proof and proof did not complete

## Importance Scoring

Every `watch_event` should have an importance score.

Use it as a shared control signal for:

- proof priority
- instant versus digest eligibility
- batching priority

Inputs should include:

- event type
- watchlist sensitivity
- whether proof exists
- competitor activity burst
- India-aware relevance
- repetition of similar changes

## Workflow Architecture

### Minimal architecture principle

Stay inside the current `0509` stack wherever possible:

- Workers
- D1
- R2
- Workers AI
- Browser Run
- Workflows
- Resend
- WhatsApp provider layer

Do not introduce another major system unless a real blocker appears.

### Workflow shape

The core workflow should be:

1. scheduler selects due watchlists
2. cheap Meta scan runs
3. candidate events are created
4. proof policy decides what deserves Browser Run
5. Browser Run captures proof selectively
6. extracted proof is compared to the last successful proof
7. events become:
   - `confirmed`
   - `suppressed`
   - `invalidated`
   - or `proof_failed`
8. delivery policy decides what is eligible now
9. delivery fans out to email and WhatsApp
10. all attempts are logged

### Internal-first rollout

Internal lane should ship before customer lane.

That gives space to tune:

- proof policy
- wording
- importance scoring
- batching
- WhatsApp conservatism

before customer trust is on the line.

## Legacy Compatibility

The implementation must handle existing live data explicitly.

Defaults and backfill rules should be:

- existing `watch_event` rows default to:
  - `confirmed`
  - `confirmed_at = created_at`
  - `last_evaluated_at = created_at`
  - null proof linkage
- existing `watch_event` importance should be backfilled with a stable event-type map
- existing digest deliveries should backfill into synthetic legacy `delivery_attempt` rows where possible
- existing landing-page snapshots should remain renderable as legacy history
- the system should not fabricate full `proof_capture` rows for every historical snapshot unless a mapping is unambiguous

Legacy data should render honestly, even when it lacks new proof-state richness.

Existing users should remain on digest-first behavior by default.

Do not enable customer instant alerts for legacy users during migration.

Legacy customer instant alerts should only widen after:

- the launch gate is met
- and the user explicitly enables instant alerts or a controlled rollout flag enables them

If a controlled rollout flag exists for legacy instant alerts, it should default to `off`, and migration/backfill should not enable it.

## UI Surface

For v1, the UI should mostly answer:

1. what changed?
2. how sure are we?
3. what proof do we have?
4. who got alerted, or what will be sent?

Avoid over-expanding the UI into:

- broad research workflows
- heavy analytics panes
- extra dashboards that dilute the wedge

The main app surfaces should center on:

- watchlists
- watch events
- proof bundle
- delivery state

Trust UI should make confidence legible by default through:

- proof age
- confidence band
- one-line why-alerted explanation

Internal operators should also have a lightweight surface that answers:

- what is failing
- what is stuck
- what is paused by budget
- what is blocked by provider or template state
- which watchlists are degraded right now

without turning the main customer UI into an admin dashboard.

That operator surface should not be exposed to all authenticated users by default.

In the current repo shape, it should be gated by an explicit deploy-time operator email allowlist until a proper admin/staff model exists.

That gate should run in the route loader/action before any operator data is queried or rendered, not just by hiding navigation links.

## Launch Gate

Do not widen the customer lane until all of these are true over the current internal eval window:

- proof success rate is at least `80%`
- false-positive rate is at most `5%`
- provisional customer sends are at most `2%` of customer sends
- duplicate-send rate is at most `0.1%`
- webhook reconciliation lag p95 is at most `5 minutes`
- reconciliation success is at least `98%`

## Rollout Order

1. fix the current `typecheck` baseline issue
2. replace the fake browser fallback with real Browser Run proof capture
3. add selective proof targeting and last-good-proof comparison
4. add the new proof-backed event types
5. ship internal alert lane first
6. ship customer email and WhatsApp delivery with conservative rules
7. move workspace UX and homepage language toward `what changed, with proof`
8. deepen India-aware scoring and summaries after trust is solid

## Long-Term Vision

`0509` should not become “generic AI agents for marketing.”

It should become:

- the default competitor monitoring system for Indian growth teams

The app is the control panel.

The real product is:

- monitoring
- proof
- confirmation
- delivery

That opens the way for long-term leverage through:

- public change reports
- India ad teardown content
- proof-backed market intelligence

Distribution can compound later, but the product wedge stays:

- trusted competitor monitoring with proof

## Non-Goals

This spec is intentionally not trying to solve:

- all research workflows
- all creative analytics
- all agent workflows
- all channels
- all regions

It is trying to win one sharp workflow:

- tell a growth team what changed, prove it, and deliver it in a way they trust

## Platform Reality And External Notes

The spec is intentionally aligned with current vendor surfaces, not stale assumptions.

Cloudflare:

- Browser Run is the renamed Browser Rendering product and now supports Quick Actions, Browser Sessions, Playwright, Puppeteer, CDP, Live View, Human in the Loop, Session Recordings, and WebMCP:
  - [Browser Run overview](https://developers.cloudflare.com/browser-run/)
  - [Browser Run observability changelog](https://developers.cloudflare.com/changelog/post/2026-04-15-br-observability/)
  - [Browser Run snapshot endpoint](https://developers.cloudflare.com/browser-run/quick-actions/snapshot/)
  - [Browser Run screenshot endpoint](https://developers.cloudflare.com/browser-run/quick-actions/screenshot-endpoint/)
- Workflows limits increased on April 15, 2026, which matters for monitoring reliability:
  - [Workflows limits changelog](https://developers.cloudflare.com/changelog/post/2026-04-15-workflows-limits-raised/)
- AI Search built-in storage and per-tenant patterns are real, but treated as later complements rather than the v1 wedge:
  - [AI Search built-in storage](https://developers.cloudflare.com/ai-search/configuration/data-source/built-in-storage/)
  - [AI Search per-tenant search](https://developers.cloudflare.com/ai-search/how-to/per-tenant-search/)
- Flagship is useful for rollout safety, but not a customer-facing moat:
  - [Flagship get started](https://developers.cloudflare.com/flagship/get-started/)

WhatsApp:

- Customer WhatsApp should use official, opt-in, template-safe, webhook-backed delivery patterns from day one.
- Exact Meta implementation details should be re-verified during implementation because Meta docs and onboarding flows are operationally sensitive and may rate-limit unauthenticated fetches.

## What Comes After V1

Once proof-first change alerts are trusted, the next slices should likely be:

1. stronger India-aware taxonomy and ranking
2. richer proof-backed summaries
3. visual layout diffing
4. semantic retrieval across confirmed history
5. action layer:
   - why it matters
   - what to test next
   - optional draft assets

That order matters.

Do not add broad intelligence layers before the core monitoring, proof, and delivery loop feels trustworthy.

# Monitoring Trust Sprint Design

## Goal

Close out the remaining monitoring trust gaps after the main trust hardening already shipped. This follow-up keeps scope tight: expose better run diagnostics in the product, and rewrite the sprint docs so they describe the code that actually exists.

## What Is Already Done

- The Cloudflare-native rebuild is in place on React Router v7 + Workers.
- Better Auth + D1 back authentication and app data.
- Public analysis flow exists: search, structured fields, provenance, landing-page capture, collections, notes/tags, exports, and share links.
- Monitoring architecture exists: `Watchlist`, `WatchlistRun`, `AdObservation`, `WatchEvent`, `DigestRun`, `DigestDelivery`, scheduled scans, and manual refresh.
- Early India-first framing has been replaced by Dodo local-pricing preview as the visible pricing source.
- Source integrity is already tightened in code:
  - `searchAds(...)` has an explicit fallback contract.
  - public search can allow demo fallback.
  - monitoring disables fallback when a Meta token is configured.
- Digest integrity is already tightened in code and schema:
  - digest period uniqueness exists in `0002_monitoring_trust.sql`.
  - weekly digest generation reuses prior period runs and skips already-sent digests.
- Watchlist dedup already exists in code and schema:
  - active watchlists are unique per `user_id + target_fingerprint`.
  - `createWatchlist(...)` returns the existing row when a duplicate request comes in.
- Share ownership and digest rendering are already tightened:
  - collection/watchlist/digest share creation is owner-scoped.
  - digest snapshots render as digest cards instead of raw JSON.
- Repo truth is already updated in `README.md`, `MEMORY.md`, and `CLAUDE.md`.

## Problem Statement

The trust sprint spec became stale after most of the implementation landed.

The actual remaining product gap is narrower:

- watchlist run history exists and is visible, but it still omits the summary counts that explain what a run actually did
- the sprint design/plan docs still read like the already-shipped work is still pending

That is a smaller problem than the original trust gap, but it still matters because `monitoring` is supposed to feel explainable, not opaque.

## Scope For This Sprint

### 1. Watchlist Run Diagnostics

- Keep the existing run history surface.
- Add the run summary counts already stored in `summary_json`:
  - `adsSeen`
  - `events`
  - event-type breakdown when present
- Preserve the current timestamps, page count, baseline, and error messaging.

### 2. Sprint Truth Refresh

- Rewrite the trust sprint spec and implementation plan so they distinguish:
  - what was already shipped
  - what this closeout step still does
  - what comes after this step
- Keep README/MEMORY/CLAUDE as-is unless a newly-found mismatch appears.

## Out Of Scope For This Sprint

- Any reimplementation of already-shipped source-integrity, digest-integrity, watchlist-dedup, or share-authorization work
- OCR and creative text extraction improvements
- Translation
- Richer landing-page extraction beyond current headline fetch path
- Browser Rendering-backed landing-page capture
- Billing and entitlements
- Shared editing / roles / permissions
- Slack or external reporting integrations
- Multi-platform ad sources

## Design Decisions

### Run Summary Visibility

- `WatchlistRun.summary` is already the contract for what a run accomplished.
- The UI should expose the stored summary instead of forcing someone to inspect the database.
- The first visible fields should be the counts users care about most:
  - ads seen
  - total events
  - event-type mix when present

### Spec Honesty

- The sprint docs should stop listing completed trust work as if it were still pending.
- The plan should only describe the remaining closeout step, plus the next post-trust slice.

## Files Likely To Change

- `app/routes/app.watchlists.tsx`
- `docs/superpowers/specs/2026-03-30-monitoring-trust-sprint-design.md`
- `docs/superpowers/plans/2026-03-30-monitoring-trust-sprint.md`

## What Comes After This Sprint

Once monitoring is trustworthy, the next slice should be `analysis depth`, not more workflow chrome:

1. Better India-language handling
2. OCR / translated text slots populated for real
3. Richer landing-page extraction (`cta_text`, `price_text`, `form_present`)
4. Stronger agency-facing report/share outputs

That order matters. We should not add more “intelligence” features on top of a monitoring loop users cannot fully trust yet.

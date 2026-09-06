# Plan — Nishfleet/0509 #1498

BET 10 sub: /trust page enumerates "landing-page snapshots" as a stored data
category while `landing_page_snapshot` has 0 rows in production.

Path A (preferred, faster): drop the phrase from the /trust data-handled
enumeration. The timeline route is NOT live (`/timeline/nike.com` → 404), so no
hedged sentence is shipped — drop the phrase entirely. Copy lives in one place
(`app/routes/trust.tsx`); the locale route re-exports the same component.

No D1 schema change. No gate-owned CI path edit.

## Phases

- [ ] phase 1: drop "landing-page snapshots" from /trust data-handled block + add lock test `tests/trust-page-data-handled-claim.test.ts`

## Acceptance mapping

- accept: Path A — data-handled block no longer lists "landing-page snapshots"
- accept: lock test renders /trust and asserts the phrase is absent as a stored category
- accept: copy in one place (trust.tsx) — no surface-by-surface fix
- accept: no D1 schema change, no gate-owned CI edit

## Reviewer findings

(phase 1 reviewer output recorded here after review)

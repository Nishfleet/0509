# Plan — Nishfleet/0509#1498 (manager: pi-issue-0509-1498)

## Goal
Remove the false "landing-page snapshots" stored-data claim from the /trust "Data handled" block via Path A (drop the phrase), and lock it with a render test. Timeline route is NOT live (Path B deferred to #1449), so we DROP the phrase, never hedge. No D1 schema change. No gate-owned CI path. No new bin/ files.

## Facts (verified by manager, 2026-09-06)
- Copy lives in exactly ONE place: `app/routes/trust.tsx` lines 51-53, "Data handled" `PublicDocBlock` paragraph.
- `app/routes/$locale.trust.tsx` re-exports EN `TrustRoute` — one edit fixes all locales. No surface-by-surface fix.
- `TrustRoute` is purely static (no `useLoaderData`): renders via `renderToStaticMarkup(createElement(TrustRoute))`.
- Test convention: vitest, `.test.tsx` in `tests/`, pattern from `tests/brands-route.render.test.tsx` (`vi.doMock("react-router")` for `Link` + loader stubs; `renderToStaticMarkup`).
- This `.fleet/plan.md` previously held the stale #1446 plan; superseded by #1498.

## Phases
- [x] Phase 1 — Copy fix: in `app/routes/trust.tsx`, delete "landing-page snapshots, " (phrase + trailing comma+space) from the "Data handled" sentence so it reads "...proof-backed changes, source URLs, delivery attempts...". Do not touch /pricing, schema, CI gate, or bin/. — DONE by worker; diff verified by manager.
- [x] Phase 2 — Single-source check: confirm `$locale.trust.tsx` already re-exports `TrustRoute`; the /trust copy now lives in one place. — DONE (re-exports ./trust; no surface-by-surface edit).
- [x] Phase 3 — Lock test: add `tests/trust-page-data-handled-claim.test.ts` rendering /trust and asserting the "Data handled" block does NOT contain "landing-page snapshots". — DONE, mirrors brands-route.render.test.tsx.
- [x] Phase 4 — Run-proof: run the lock test green (vitest) and capture that rendered /trust no longer contains the phrase. — DONE: `npx vitest run --configLoader runner --project node tests/trust-page-data-handled-claim.test.ts` → Test Files 1 passed (1), Tests 1 passed (1).

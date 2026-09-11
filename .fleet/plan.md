# Issue 2473 — fix full-ISO capture timestamps on /competitor-monitoring (M48)

Judge binding: port the homepage full-ISO branch VERBATIM into competitor-monitoring.tsx `proofTimeLabel`.
Do NOT extract a shared module (marketing.tsx is off the files line).

- [x] phase 1 (DONE, RED proven): new tests/competitor-monitoring-timestamps.test.ts renders the route with proofBrief.proofTrail[0].capturedAt = "2026-09-07T06:18:00.000Z"; before the fix the trail rendered "Captured 11:48 AM" (bare clock, no date) and the "Sep 7" assertion failed
- [x] phase 2 (DONE, GREEN proven): app/routes/competitor-monitoring.tsx proofTimeLabel full-ISO branch now month:"short", day:"numeric", hour, minute, conditional year (getUTCFullYear compare), timeZone:"UTC" — verbatim shape of marketing.tsx's branch. Sweep result: the route's ONLY other toLocaleString is the date-only branch (lines 93-98), which per binding is untouched; no other hour/minute-only instances exist. GREEN: npx vitest run tests/competitor-monitoring-category.test.ts tests/competitor-monitoring-timestamps.test.ts = 14/14 passing. Not committed (per task instruction).
- [x] phase 3: GREEN run: npx vitest run tests/competitor-monitoring-category.test.ts (and any new test file); commit; PR with RED evidence, GREEN evidence, instance list; arm auto-merge

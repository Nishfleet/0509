fix(proof): home ticker and proof strip stamp freshness, never a bare clock (issue #1467)

## What changed and why

The home page ticker belt rendered a bare `6:18 AM` clock stamp for a 23-hour-old capture, and the proof strip rendered `On record · Meta Ad Library` with no freshness. A first-time visitor could misread both as "we just checked".

This PR makes every customer-facing timestamp on the home route either dated or relative:

- `buildTickerEvents` — on-record rows stamp the cache-check age (`Checked <checkedAgoLabel>` ≈ "Checked about 23 hours ago") instead of a bare clock; fresh rows keep the capture's explicit date.
- `proofTimeLabel` — the full-ISO branch now renders a full date (`Aug 27, 9:00 AM`) instead of a bare time, and appends the year for prior-year captures (matching the existing date-only branch). This also hardens the proof-trail and report-row timestamps that call the same helper.
- The proof strip `ld-proof-time` element now always carries freshness: `On record · checked <checkedAgoLabel>` when the capture is stale, `Live capture — <checkedAgoLabel>` when `freshForLiveClaim` is true, and `Checked <checkedAgoLabel> · captured <date>` otherwise.

Design system intact: ticker stays `aria-hidden="true"`, three items per cycle, same tags (`[ad library]` / `[source links]` / `[brief]`), same colours. No data, no D1, no auth change.

## Verification

`npx vitest run --configLoader runner --project node tests/homepage-timestamp.test.tsx` → **4 passed**

`npx vitest run --configLoader runner --project node tests/homepage-proof-capture-age.test.tsx tests/homepage-proof-date.test.tsx` → **8 passed** (the two pre-existing tests keep passing, as required)

`npx vitest run --configLoader runner --project node tests/ads-domain-ticker-dedup.test.tsx tests/homepage-hero-direction.test.tsx tests/demo-proof.route.test.ts` → **26 passed**

`sgscan` → **No new security findings.**

New regression test `tests/homepage-timestamp.test.tsx` asserts, with a pinned `now` (2026-08-30T06:00Z) matching the live observation:
1. no bare `H:MM AM/PM` stamp appears in the ticker belt;
2. the `ld-proof-time` element carries a non-empty relative (`about N hours/minutes ago`) or explicit dated string;
3. the ticker keeps its decorative shape (`aria-hidden`, 3 items × 2 cycles, same tags).

Mechanism: the regression test enforces the accept criteria — a future change that reintroduces a bare clock fails CI. This is the prevention mechanism for the observed gap; `mechanism-impossible` not applicable (a render-level regression test fully covers this surface).

Note: the issue's suggested `node --test` does not transpile `.tsx` (raises `ERR_UNKNOWN_FILE_EXTENSION`); the repo's actual runner is vitest, which is what the `test` script and CI use. The full `npm run typecheck` (`tsc -b` + cf-typegen + typegen) OOMs on this VPS (pre-existing resource limit), unrelated to this change.

Closes #1467

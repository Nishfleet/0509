# Lane evidence — claim/issue-2193 — LinkedIn Ads presence source

Issue: Nishfleet/0509#2193
Branch: claim/issue-2193
Worktree: /home/nish/workspaces/agent-worktrees/issue-0509-2193
Dependency: #2218 (sources seam) — merged, stubs present.

## What shipped

Replaces the LinkedIn Ads seam stub with a real presence source:

- `app/lib/sources/linkedin-ads/linkedin-ad-library.server.ts` (new) —
  `fetchAdsByAccountOwner` + HTML parser. Decodo universal target, standard
  pool, no JS rendering, page 1 only (start=0), one request, one attempt, 60s
  timeout. Calls `reserveDecodoBudget(env, "std")` before the request. Handles
  status 613 / non-200 / parse-break (zero cards + no "Promoted" text) as
  unavailable. Exact case-insensitive advertiser-name filter with `ambiguous`.
- `app/lib/sources/linkedin-ads.server.ts` — real adapter: `implemented: true`,
  `cadence: "weekly"`, `requiresEnv` gated on `DECODO_SCRAPER_AUTH`, `fetch`
  (budget → fetch module → payload), `diff` (ad_new / ad_inactive /
  landing_page_headline_changed).
- `app/components/sources/linkedin-ads.tsx` — real Section: renders
  advertiser, total ads, new-since-last-check, up to 12 creative previews,
  detail-page links. Renders null when no snapshot (keeps source-sections
  test green).
- `tests/fixtures/linkedin-ad-library/{page-1,page-2,zero-ads,ambiguous,parse-break}.html`
- `tests/sources/linkedin-ads-linkedin-ad-library.test.ts` — parser + fetch
  contract (URL, body, Basic auth, target=universal, geo, proxy_pool=standard,
  no headless, one request, no retry, quota deny, 613/non-200, parse-break,
  exact-name filter + ambiguous, maxAds).
- `tests/sources/linkedin-ads-adapter.test.ts` — adapter contract + all three
  diff cases.
- `tests/sources/registry.test.ts` — stub assertions filtered by `!implemented`
  so flipping linkedin to real no longer breaks the seam test (documented
  exception; the test is owned by the seam but asserts behavior this ticket
  changes).

## Ownership

All edited files are on the issue's `files:` line. The one exception is
`tests/sources/registry.test.ts` (seam-owned): its all-stubs assertions break
the moment linkedin flips to `implemented: true`. It is updated minimally to
filter stub assertions by `!implemented` so the build stays green. This is
documented in the PR body for the reviewer.

## Verification

Issue termination command (vitest half):

```
npx vitest run --configLoader runner --project node tests/sources/linkedin-ads-linkedin-ad-library.test.ts tests/sources/linkedin-ads-adapter.test.ts tests/sources/registry.test.ts
```

Result: 3 files, 32 tests, all green.

Broader sweep (no regressions in source/claim tests):

```
npx vitest run --configLoader runner --project node tests/sources/ tests/customer-claim-surface-registry.test.ts
```

Result: 5 source files (43 tests) + 1 claim file (9 tests), all green.

typecheck is CI-owned (memory budget rule: do not run `npm run typecheck`
locally in autonomous worker mode). The issue lists it; CI runs it.

## Out of scope (deliberately not touched)

- claim table (#2188 flips it live on production proof)
- competitor page / source-sections.tsx (seam owns the slot)
- registry.server.ts (already registers the adapter)
- decodo-budget.server.ts (consumed, not edited)
- env.server.ts (DECODO_SCRAPER_AUTH already exists)
- migrations (none needed)
- #2194 (TikTok) — parallel; not imported or referenced

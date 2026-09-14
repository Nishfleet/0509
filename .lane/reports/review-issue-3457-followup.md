# Lane evidence — review/issue-3457-followup (Nishfleet/0509#3457)

Unit: `pi-issue-0509-3457` · 2026-09-14 UTC · claim-loop survivor: the issue was
claimed 5× with StartLimitBurst releases (01:27Z–05:47Z), routed
`blocked-on: orchestrator` (fleet-ops#2772), released by the judge decision at
05:45:58Z (#6686 budget-wall classifier merged), then completed.

## Disposition

- **PR #3469 MERGED** (2026-09-14T09:26:52Z, merge commit `742ef8c71`): the five
  legacy dotless /ads slugs (`nike`, `allbirds`, `nykaa`, `lenskart`, `mamaearth`)
  301 to their domain-keyed canonicals via a static `LEGACY_BRAND_SLUG_DOMAINS`
  map at the top of the `ads.$domain.tsx` loader (the `ad-aggression-redirect.ts`
  pattern, issue #2022 precedent). Unmapped dotless slugs keep the 404; no
  sitemap changes (accept #4). The merge closed issue #3457.
- The claim session's review-round fixes were committed locally but the unit died
  (StartLimitBurst) before pushing — so #3469 merged WITHOUT them. **PR #3479**
  (`claim/issue-3457`) first carried the delta; after #3469 merged, pushes to the
  `claim/issue-3457` name started declining with `protected branch hook declined`
  (merged-claim guard — the recreation push slipped through, the second did
  not), so the PR re-seats on this branch with the review-round fixes included.
  Delta vs main: `Object.hasOwn` gates the map lookup (without it,
  `/ads/constructor`, `/ads/__proto__` resolve to inherited `Object.prototype`
  members and 301 to garbage — an accept-#2 violation on main) and the query
  string survives the 301 (the #2885 treatment). `Relates to #3457`.
- Reviewer round on #3479 (seat `litellm/senior` via `find_senior_seat`,
  2026-09-14): no criticals; act-on items (this lane record, test-comment
  precision, multi-param query pin) fixed before arming. One round, no loops.

## Verification (2026-09-14, worktree head = this branch)

- `npx vitest run tests/ads-legacy-slug-redirects.test.ts` (the issue's
  `termination:` line) → 22 tests passed (12 pre-review + 8 prototype-name 404
  pins + 2 query pins incl. multi-param percent-encoded).
- `npx vitest run tests/ads-brand-page.route.test.ts` → 51 passed.
- `npx vitest run --configLoader runner --project node --changed origin/main` →
  20 test files, 313 tests, all passed.
- `npx vitest run --configLoader runner --project node
  tests/lane-evidence-collision.test.ts` → this record is lane-unique
  (`.lane/reports/review-issue-3457-followup.md`).
- Post-merge live check of #3469's surface is the issue's `verify:` block
  (curl the five bare slugs → 301 + dotted `redirect_url`); this delta changes
  no mapped-slug behavior, only the unmapped edge and query passthrough.

## Notes

- Live-probe timestamps in the issue body (06:15Z/06:55Z) predate the #3469 merge
  (09:26:52Z); the 404s they report were fixed by that merge. The issue's verify
  block is the deploy-side check.
- The claim branch was deleted by the #3469 merge, recreated once by the
  follow-up push, then became push-protected (see above) — this branch is the
  surviving head; the reconciler cleans it post-merge.

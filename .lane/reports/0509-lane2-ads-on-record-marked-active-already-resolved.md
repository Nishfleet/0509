# Lane evidence — 0509 lane 2 (2026-08-21, item d5ebe1480b)

Packet item: Stop `/ads/:domain` "Ads on record" cell from rendering "N marked
active" on the public surface — signed-in vocabulary.

## Outcome: already resolved — re-verified at current main tip, evidence-only branch + PR

The defect was fixed and merged into main before this lane ran. This lane
verified the acceptance chain at the current main tip (`422fbd55`) instead of
duplicating the work.

## Findings

1. The "By the numbers" stat strip on the public `/ads/:domain` page lives in
   `app/components/ads/brand-stat-line.tsx`. The "Ads live"/"Ads on record"
   cell's context line renders the ad's observed Ad Library status
   (`ad_active_status`) as public copy: `"N active"` on a fresh capture and
   `"N active at last check"` once the capture ages — never "N marked active".
2. The signed-in wording was removed by merged PR #681 (commit `8725cf11`,
   merged 2026-08-13): `fix(ads): brand-page stat strip drops signed-in
   'marked active' copy`. That commit changed `brand-stat-line.tsx` and added
   the render-test lock.
3. The render test `tests/ads-brand-page.render.test.tsx` ("keeps the
   stat-strip context public (no signed-in 'marked active' language)") asserts
   both fresh and stale captures never contain "marked active", and that the
   public vocabulary renders: fresh `>6 active<`, stale `6 active at last check`.
4. Verified at current main tip (`422fbd55`): `tests/ads-brand-page.render.test.tsx`
   passes 20/20 via `npx vitest run tests/ads-brand-page.render.test.tsx`.
5. Full-repo grep for `marked active` outside tests: no matches. No other
   `/ads/:domain` surface renders signed-in "marked" vocabulary.

## Deliverables

- Branch: `0509-lane2-ads-on-record-marked-active-already-resolved` (from
  origin/main @ `422fbd55`), pushed.
- PR: opened against `main`.
- Lane evidence: this file (`.lane/reports/<branch>.md`) is the only file
  touched, matching sibling already-resolved lanes' tracked evidence files.
- Claims published to lane record before editing (single claim, this file's path).

## Verification

- `git diff --check` clean; evidence-only change; no product code touched.
- `npx vitest run tests/ads-brand-page.render.test.tsx` → 20/20 passed.
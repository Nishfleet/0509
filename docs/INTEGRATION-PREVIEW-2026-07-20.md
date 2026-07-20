# Integration Preview — Evening of 2026-07-20

**Purpose:** prove the day's staged branches merge into ONE coherent tree, pre-resolving every
seam so tonight's real landing is conflict-free. This is **disposable evidence** — branch
`preview/integration-eve-2026-07-20`, rooted at the frozen release candidate `origin/main`
(`3717419`). It must **never** be merged to `main`.

## Verdict

**The 12-branch stack is integration-proven as one tree.**

All twelve branches from the documented merge order merged cleanly or with fully-resolved seams,
following the resolution principles (refactor structure wins; feature deltas and tests re-applied
onto it; nothing dropped). Final combined tree:

- **Typecheck:** clean (`tsc -b`, exit 0) — after regenerating `worker-configuration.d.ts`
  (`wrangler types`) and `.react-router/types` (`react-router typegen`), both offline.
- **Full suite:** `350` test files / **`3737` tests** — all passing (baseline RC was `349` / `3690`;
  the stack added 1 file and 47 net tests).

> Note on count: the runbook framed this as "13 staged branches." The documented merge order lists
> **12** feature branches; the 13th input is the RC base (`origin/main`) they all sit on. All 12
> named branches were merged.

## Environment notes

- `npm`/`npx` are blocked in this environment. Tests run via `node ./node_modules/vitest/vitest.mjs run`.
- Typecheck runs `tsc` directly. The project's `npm run typecheck` also runs `wrangler types` +
  `react-router typegen` first; both codegens work offline and were run before each typecheck.
  Their outputs are gitignored, so they never interfere with merges.

## Merge-by-merge log

| # | Branch | Tip | Merge commit | Result |
|---|--------|-----|--------------|--------|
| 1 | test/clock-flake-hardening | `6bbcd57` | `9ef4b9e` | Clean |
| 2 | docs/changelog-honesty | `ed36f42` | `a3c42f8` | Clean |
| 3 | docs/ops-truth-sweep | `2d52f72` | `ea74c86` | Clean |
| 4 | fix/local-authenticated-realign | `aef5fdf` | `7c5399a` | Clean |
| 5 | ci/cross-browser-scheduled | `f3498e1` | `f83485e` | Clean |
| 6 | refactor/consolidation-2026-07-20 | `ae0b2f6` | `2f856d7` | Clean (auto-merged CLAUDE.md) |
| 7 | refactor/watchlists-split | `189b697` | `d9379e3` | **Conflict — resolved** (known seam with 6) |
| 8 | polish/email-render-pass | `386242c` | `b4aa734` | Clean |
| 9 | audit/new-surface-security | `e2554c1` | `df10bdd` | Clean (auto-merged onto 7's structure) |
| 10 | fix/megabrand-advertiser-resolution | `6f89b95` | `ee9644a` | Clean (auto-merged onto 6's structure) |
| 11 | feat/spec-leftovers-wp44-47 | `ede2377` | `0e375d7` | Clean |
| 12 | audit/a11y-sweep | `2153404` | `241e331` | **Conflict — resolved** (seam with 7) |

### Detail — clean merges (1–6, 8, 10, 11)

- **1** touched three test files only; the three suites passed (17 tests).
- **2** README + `changelog.tsx` (2 tests pass). **3** CLAUDE.md only. **4** carried the
  `e2e/local-authenticated.spec.ts` Playwright spec (not a vitest suite). **5** added
  `.github/workflows/cross-browser-matrix.yml`.
- **6** (the big consolidation refactor: `pill.tsx`, `search-display.ts`, `result-card.tsx`,
  `ai-guarded-generation.server.ts`; `search.tsx` heavily reduced) merged clean. Full suite +
  typecheck run here as a pre-seam checkpoint: clean, 3690 tests.
- **8** added `tests/email-render-gallery.test.ts`; email/delivery/digest/recap suites passed
  (406 tests across 43 files).
- **10** — see seam analysis below; git auto-merged all three `search.tsx` deltas onto 6's
  structure with no conflict. Verified by inspection + milestone run.
- **11** added two Refine-panel date inputs to `search.tsx` (post-6 structure held) plus
  `creative-text` / `language-classifier` / `normalize` / `search-rebuild` tests; auto-merged
  (incl. `normalize.test.ts`, which 10 also touched — non-overlapping regions). 62 touched tests pass.

### Detail — Merge 7 (KNOWN SEAM with 6): refactor/watchlists-split

Both 6 and 7 touch `app/routes/app.watchlists.tsx`: 6 migrated two pill call-sites to the new
`<Pill>` component; 7 extracted the watchlists route into `app/components/watchlists/*` +
`app/lib/watchlist-display.ts`. **Resolution principle applied: 7's extracted structure wins;
6's pill migrations re-applied inside the extracted components.**

Conflicts:

1. **`CLAUDE.md`** — additive "Key Files" list; both branches appended entries. Kept both.
2. **`app/routes/app.watchlists.tsx`** — two conflict blocks where 6's `<Pill>` edits landed on
   render code that 7 extracted into `<EventChangesSection>` / `<RecentChecksSection>` /
   `<CandidateHistory>`. Took 7's extracted-component structure for both blocks.

Re-applied 6's pill migrations inside 7's extracted files (the `Pill` component is the target API):
- `app/components/watchlists/event-changes-section.tsx`: `<span className="f9-status-pill">…importanceBandLabel…</span>` → `<Pill>…</Pill>` + import.
- `app/components/watchlists/recent-checks-section.tsx`: `<span className="f9-status-pill">…pagesScanned…</span>` → `<Pill>…</Pill>` + import.
- Removed the now-unused `Pill` import from `app.watchlists.tsx` (both its usages were extracted).

**Milestone after 7:** typecheck clean, full suite 3690 tests green.

### Detail — Merge 9 (possible seam with 7): audit/new-surface-security

Adds a `MAX_BULK_WATCHLIST_IDS = 200` cap constant and a bulk-action guard to the watchlists
route's top-level + `action()` — regions 7 kept in the route (7 extracted render/JSX and display
helpers, not the action). Git auto-merged onto 7's structure with **no conflict**. Bulk-action,
monthly-recap, and watchlists.route suites pass (49 tests). Also adds `docs/SECURITY-REVIEW-2026-07-20.md`.

### Detail — Merge 10 (seam with 6): fix/megabrand-advertiser-resolution

6 extracted `search-display.ts` + `result-card.tsx` from `search.tsx`; 10 edits `search.tsx`
loader/action/`SearchStateFields` (verified advertiser `pageId` → hidden form fields) plus
`search-v2.server.ts`, `meta-library-browser.server.ts`, `normalize.ts`, `types.ts`. All three
`search.tsx` spots 10 changed (loader return `filtersForForms`, action `pageId`, hidden input)
stayed in the route under 6's refactor, so **git auto-merged with no conflict**. Verified by
inspection: `verifiedAdvertiserPageId` block references in-scope `searchExecution`, `filters.pageId`
typed via 10's `SearchFilters` extension. Nothing from 10 landed in an extracted file, so no delta
was lost.

**Milestone after 10:** typecheck clean, full suite 350 files / 3732 tests green.

### Detail — Merge 12 (seam with 7): audit/a11y-sweep

Mostly-additive aria attributes across ~16 files. One conflict, in `app.watchlists.tsx`: a
move/modify tangle where 7 deleted the pre-refactor inline block (helpers now in
`watchlist-display.ts`; `FirstScanBanner` now in `first-scan-banner.tsx`) while 12 modified two
lines inside that region. **Resolution: took HEAD (drop the reintroduced inline block), then
re-applied 12's two aria deltas onto the final structure:**
- Delta #1 (`aria-live="assertive"` + `role="alert"` on the consecutive-failed-runs error `<div>`)
  **auto-merged** into the route render — verified present.
- Delta #2 (`role="status"` on the `FirstScanBanner` `<article>`) re-applied in the extracted
  `app/components/watchlists/first-scan-banner.tsx` (it already carried `aria-live="polite"`).

The other 15 a11y files auto-merged clean.

**Final milestone:** typecheck clean, full suite 350 files / 3737 tests green.

## SHAs

- Base (frozen RC / `origin/main`): `3717419864953f28acfb2a7017285675dabc2772`
- Preview HEAD: `241e33191b8d44a5fc29de4de351b6edabc5dd91`

Merge commits in order: `9ef4b9e` → `a3c42f8` → `ea74c86` → `7c5399a` → `f83485e` → `2f856d7` →
`d9379e3` → `b4aa734` → `df10bdd` → `ee9644a` → `0e375d7` → `241e331`.

## Guidance for tonight's real landing

The two seams that need active resolution when landing on `main` (everything else is
auto-mergeable in this order):

- **7 after 6:** re-apply 6's two `<Pill>` migrations inside 7's extracted
  `event-changes-section.tsx` and `recent-checks-section.tsx`; drop the now-dead `Pill` import
  from `app.watchlists.tsx`; keep both CLAUDE.md Key-Files entries.
- **12 after 7:** in `app.watchlists.tsx`, discard the a11y branch's reintroduced inline block
  (take the refactored/extracted side) and land `role="status"` in `first-scan-banner.tsx`; the
  `role="alert"`/`aria-live="assertive"` delta auto-merges into the route render.

9 and 10 look like seams but auto-merge cleanly in this order because 7 and 6 left the touched
regions (watchlists `action()`, search `loader`/`action`/`SearchStateFields`) in their routes.

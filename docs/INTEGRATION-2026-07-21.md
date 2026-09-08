# Integration — 2026-07-21: polish stack re-integrated onto current main

**Purpose:** land the 12-branch polish/audit stack (built, reviewed, and journey-proven
yesterday against the frozen RC `3717419`) onto **current** `origin/main`
(`15b361d`), which has since advanced ~8 commits (deploy-pipeline fixes + a scraper
ghost-card fix). Branch: `integration/polish-stack-2026-07-21`, rooted at `origin/main`
`15b361d`. **No PR, no `main` mutation** — this is the integrated candidate only.

## Verdict

**All 12 branches re-integrated cleanly on the newer base; the Journey-4 h2 fix is
included; every gate is green.**

- **Full vitest:** `350` files / **`3766`** tests passed (0 failures).
- **Typecheck:** clean — `wrangler types` + `react-router typegen` (both offline) then
  `tsc -b`, exit 0.
- **Gate-B canonical suite:** **66/66 passed, zero retries** via
  `node scripts/run-local-release-proof.mjs --journeys=1,2,3,4,5,6` — the exact canonical
  harness (`[local-release]` project, `--retries=0 --workers=1`, all six
  `e2e/journey-{1..6}-release.spec.ts`). The full harness exited `0`, i.e. the post-run
  release-state assertion, fixture-invariant check, and D1 scratch-restore drill all
  passed too. (The `[retention] delete failed` / injected `[WebServer]` errors in the log
  are deliberate Journey-6 fault injections that the recovery journeys assert against —
  those tests passed.)

> Test-count note: the RC-based preview proof recorded 3737 tests. This tree sits on the
> newer `main`, whose `#373` scraper fix added `tests/meta-library-browser.test.ts` cases
> (and other deploy-pipeline test files advanced in `3717419..15b361d`). 3766 is the
> combined tree on the newer base — expected to exceed the RC figure.

## Base advancement (`3717419` → `15b361d`)

Eight commits landed on `main` after the RC the stack was cut from. Files they touched
that are **not** in the stack's UI/product surface auto-composed with zero interaction:
`scripts/*`, `app/lib/data/launch-canary-cleanup.server.ts`,
`app/routes/api.launch-readiness.canary.ts`, `workers/primary-domain.ts`,
`tsconfig.node.json`, and the deploy-gate test files. The **only** file both the base
advancement (`#373`) and the stack (`fix/megabrand-advertiser-resolution`) touched is
`app/lib/meta-library-browser.server.ts` — reconciled below.

## Merge-by-merge log

Order per `docs/INTEGRATION-PREVIEW-2026-07-20.md`. Each is a `--no-ff` merge commit.

| # | Branch | Tip | Merge commit | Result |
|---|--------|-----|--------------|--------|
| 1 | test/clock-flake-hardening | `6bbcd57` | `742efb4` | Clean |
| 2 | docs/changelog-honesty | `ed36f42` | `852741b` | Clean |
| 3 | docs/ops-truth-sweep | `2d52f72` | `76ddbfb` | Clean |
| 4 | fix/local-authenticated-realign | `aef5fdf` | `bf7fe19` | Clean |
| 5 | ci/cross-browser-scheduled | `f3498e1` | `e9fc298` | Clean |
| 6 | refactor/consolidation-2026-07-20 | `ae0b2f6` | `5608d85` | Clean (CLAUDE.md auto-merged) |
| 7 | refactor/watchlists-split | `189b697` | `1c263da` | **Conflict — resolved** (seam with 6) |
| 8 | polish/email-render-pass | `386242c` | `e7cd00a` | Clean |
| 9 | audit/new-surface-security | `e2554c1` | `243d11e` | Clean (auto-merged onto 7) |
| 10 | fix/megabrand-advertiser-resolution | `6f89b95` | `550d88a` | **Conflict — resolved** (seam with base `#373`) |
| 11 | feat/spec-leftovers-wp44-47 | `ede2377` | `191aa10` | Clean |
| 12 | audit/a11y-sweep | `2153404` | `b7adf35` | **Conflict — resolved** (seam with 7) |
| — | Journey-4 h2 fix (cherry-pick `-x`) | `f5b4565` | `e6f1634` | Clean |

Integration HEAD: **`e6f1634`**.

## Seam resolutions

### Seam A — Merge 7 after 6 (watchlists refactor vs. Pill consolidation)

Both touch `app/routes/app.watchlists.tsx`. **Principle: 7's extracted structure wins;
6's `<Pill>` migrations re-applied inside the extracted components.**

- `CLAUDE.md` — both appended Key-Files entries; **kept both** blocks.
- `app.watchlists.tsx` — two conflict blocks where 6's `<Pill>` edits landed on render code
  7 extracted into `<EventChangesSection>` / `<CandidateHistory>` / `<RecentChecksSection>`.
  Took 7's extracted-component structure for both.
- Re-applied 6's Pill migrations inside the extracted files:
  - `app/components/watchlists/event-changes-section.tsx`: `f9-status-pill` span →
    `<Pill>{formatImportanceBandLabel(...)}</Pill>` + `import { Pill }`.
  - `app/components/watchlists/recent-checks-section.tsx`: `f9-status-pill` span →
    `<Pill>{run.pagesScanned} …</Pill>` + `import { Pill }`.
- Dropped the now-dead `import { Pill }` from `app.watchlists.tsx` (both usages extracted;
  the re-exported presentation helpers remain in use).
- Checkpoint: typecheck clean.

### Seam B — Merge 10 after base `#373` (scraper: `meta-library-browser.server.ts`)

The critical seam. Both changes had to be **kept in full**; they are orthogonal and now
compose. Git auto-merged every hunk except one "both inserted a new function in the same
slot" tangle (shared leading `/**` and trailing `);\n}`), which was resolved by hand to
emit **both** functions in sequence.

Kept from **base `#373`** (newer, live, critical ghost-card guards):
- `adHasUsableContent(ad)` export.
- Call-site in `searchMetaLibraryViaSessions`:
  `normalizeAndFilterExtractedCards(...).filter(adHasUsableContent)` **plus** the
  rendered-text re-derivation fallback when DOM discovery yields only content-free ghost
  cards (`extractTextCardsFromVisibleText(pageText)` re-run through the same pipeline).
- The `looksLikeAdCard` / `Sponsored`-marker guards on `roots.set(...)` in **both** the
  session extractor and the quick-action extractor (drops bare "Library ID: N" leaf roots).

Kept from **stack `fix/megabrand-advertiser-resolution`** (pageId scoping):
- `import { normalizeNumericPageId }`.
- The Relay `pageIdByLibraryId` map + `numericPageIdFromCard(card)` in **both** extractor
  scripts, and the `pageId: pageIdByLibraryId.get(libraryId) ?? numericPageIdFromCard(card)`
  field on each emitted card object.
- `advertiserPageId: card.pageId ?? null` persisted in `normalizeExtractedCard`.
- `rankExtractedCardsByAdvertiserMatch` (+ `normalizeBrandMatchToken`,
  `advertiserMatchesBrandTerm`) and its use inside `normalizeAndFilterExtractedCards`.
- `buildSearchUrl` `view_all_page_id` / `search_type=page` scoping when a verified numeric
  page id is present.

**Merged pipeline shape** (both sets compose, no behavior lost):

```
// searchMetaLibraryViaSessions (base #373 call-site wraps stack pipeline):
let ads = normalizeAndFilterExtractedCards(extractedCards, query)   // stack: ranking + pageId
  .filter(adHasUsableContent);                                      // base #373: drop ghosts
if (ads.length === 0 && normalizedExtraction.pageText) {            // base #373: text fallback
  const textAds = normalizeAndFilterExtractedCards(
    extractTextCardsFromVisibleText(normalizedExtraction.pageText), query,
  ).filter(adHasUsableContent);
  if (textAds.length > 0) ads = textAds;
}

// normalizeAndFilterExtractedCards (stack ranking now leads the chain):
return rankExtractedCardsByAdvertiserMatch(cards, query)           // stack
  .filter(statusPredicate)
  .map((card) => normalizeExtractedCard(card, query))              // stack: advertiserPageId
  .filter(...);

// two new sibling functions kept side by side where git tangled them:
export function adHasUsableContent(ad: AdRecord): boolean { ... }              // base #373
export function rankExtractedCardsByAdvertiserMatch(cards, query) { ... }      // stack
```

`search.tsx` and `tests/meta-library-browser.test.ts` auto-merged (6's route refactor and
base's + stack's non-overlapping test additions). Checkpoint after this merge: typecheck
clean; `meta-library-browser` + `search-rebuild` + `normalize` suites 93/93.

### Seam C — Merge 12 after 7 (a11y sweep vs. watchlists refactor)

`audit/a11y-sweep` was cut from the RC base, so it carried the pre-refactor inline helper
block (delivery-channel helpers, run/label formatters, and the inline `FirstScanBanner`)
that 7 had extracted into `~/lib/watchlist-display.ts` + `~/components/watchlists/*`. The
merge produced one large move/modify conflict in `app/routes/app.watchlists.tsx` (HEAD side
empty; 12 reintroduced the whole block). **Resolution: took HEAD — discarded the
reintroduced inline block — then re-applied 12's two a11y deltas onto the final structure:**
- Delta #1 (`aria-live="assertive"` + `role="alert"` on the consecutive-failed-runs error
  `<div>`): **auto-merged** into the route render — verified present.
- Delta #2 (`role="status"` on the first-scan banner `<article>`): **re-applied** in the
  extracted `app/components/watchlists/first-scan-banner.tsx` (which already carried
  `aria-live="polite"`).

The other ~15 a11y-touched files (`app.css`, `report-view.tsx`, `ads.$domain.tsx`,
`app.account/billing/digests.tsx`, `share.$token.tsx`, …) auto-merged clean.

### Journey-4 fix (`f5b4565`, cherry-picked `-x`)

`audit/a11y-sweep` promoted the report Decision-summary heading `h3`→`h2`, creating two
level-2 headings with the identical accessible name (the top event's title) — a WCAG
duplicate that tripped Playwright strict mode on Journey 4's anonymous share/re-review
check. The fix reverts just those three Decision-summary headings back to `<h3>` in
`app/components/report-view.tsx` (watchlist topEvent + empty-state, and collection
summary); every other a11y improvement is untouched. Cherry-picked cleanly.

## Restore-scope confirmation

The stack does **not** touch any restore/deploy-gate scope. Verified empty diff
`origin/main..HEAD` for: `migrations/` (chain unchanged, still through `0070`),
`wrangler.jsonc` (`SEARCH_ROLLOUT_MODE` stays `"shadow"`),
`scripts/d1-restore-transform.mjs`, and `scripts/verify-remote-restore-evidence.mjs`.

## SHAs

- Base (`origin/main`): `15b361d`
- Integration HEAD: `e6f1634` (this file added on top)
- Merge commits in order: `742efb4` → `852741b` → `76ddbfb` → `bf7fe19` → `e9fc298` →
  `5608d85` → `1c263da` → `e7cd00a` → `243d11e` → `550d88a` → `191aa10` → `b7adf35`, then
  cherry-pick `e6f1634`.

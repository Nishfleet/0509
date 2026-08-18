# Stop Meta Ad Library chrome ("Menu") from rendering as the ad CTA — already resolved

**Status: already resolved; this lane records the evidence only.**

Branch: `lane1/meta-library-menu-cta-already-resolved`
Base: `origin/main` at `ab7b5f96` (#723)

## Item

- [ ] Stop Meta Ad Library chrome ("Menu") from rendering as the ad CTA on
  public search (scout 2026-08-09, risk: amber).

## Verdict

No code change was warranted. The item is already landed on `origin/main` as
three merged fixes, each an ancestor of the current `main` HEAD (`ab7b5f96`):

- **PR #552** — `1ee24c70` "fix(search): stop Ad Library chrome ('Menu') from
  rendering as the ad CTA", merged 2026-08-09 (the scout's own flag date):
  the write-side choke point.
- **PR #657** — `f243e676` "fix(search): stop persisted Ad Library chrome from
  rendering as the ad CTA", merged 2026-08-13: the read-side choke point for
  rows persisted before the write guard landed.
- **PR #717** — `370e5417` "fix: treat zero-width chrome CTAs as Ad Library
  chrome", merged 2026-08-14: closes the residual `"Menu\n\u200B"` variant
  recorded in `docs/sol-postmerge-657-waiting-room-close.md`.

## Evidence on current main

- **Write-side gate**: `isAdLibraryChromeCta` in
  `app/lib/meta-library-rendered-card-parser.server.ts` (FIX-14) is applied in
  `normalizeExtractedCard` (`app/lib/meta-library-browser.server.ts:2072`), the
  single normalization point for every live scrape path (Browser Run session
  extraction, Browserless, rendered-text fallback). It strips zero-width /
  format characters (U+200B–U+200D, U+2060, U+FEFF) and whitespace, then
  exact-matches against the chrome token list (`menu`, `open drop-down`,
  `see ad details`, `see summary details`, `view ad details`, `meta ad library
  result`, `more`, `report ad`). Real advertiser CTAs ("Shop now", …) never
  collide — exact match only.
- **Read-side gate**: `listAdsByIds` in `app/lib/ad-persistence.server.ts:181`
  applies the same helper, so rows captured before the write guard landed
  blank their chrome CTA on every read — feeding public search selection,
  creative walls, digests, reports, and exports.
- **CTA pickers**: both `pickCtaFromCard` implementations (session extraction
  script and Browser Run fallback, `app/lib/meta-library-browser.server.ts`)
  filter chrome buttons by exact label before picking the CTA verb; a
  chrome-only card returns no CTA at all. The rendered-text fallback
  (`extractTextCardsFromVisibleText` → `inferCta`) cannot produce "Menu"
  because `inferCta` only matches the real CTA verbs, and the card body
  chrome is excluded by `isTextCardUiLine` / `extractAdBodyLines`.
- **Public-search trace**: `app/routes/search.tsx` → `prepareSearchResultSelection`
  (`app/lib/search-selection.server.ts`) → `hydrateAdsWithPersistedCreatives` →
  `listAdsByIds` (guarded read) for persisted hydration; live scrapes flow
  through `normalizeExtractedCard` (guarded write). The share/report surfaces
  (`share.$token.tsx`, `report-builder.server.ts`, `creative-wall.tsx`)
  consume the same persisted hydration. No unguarded CTA sink found.

## Regression pins (all passing)

- `tests/meta-library-browser.test.ts`:
  - "skips Ad Library chrome buttons when the session extraction script picks
    the CTA" — live 2026-08-09 DOM shape: chrome "Menu" / "See ad details"
    buttons skipped, real CTA "Sign up" picked; chrome-only card CTA is `""`
    (never "Menu").
  - "drops Ad Library chrome captured as the CTA (FIX-14)" — `normalizeExtractedCard`
    blanks `"Menu"`, `"Open Drop-down"`, `"See ad details"`, `"View ad details"`.
  - "flags Menu with a trailing zero-width space (U+200B) as chrome" —
    `isAdLibraryChromeCta("Menu\n\u200B")` and `("Menu\u200B")` are true.
- `tests/ad-persistence-ratchet.test.ts`:
  - "drops Meta Ad Library chrome captured as the CTA from persisted rows
    (FIX-14 read side)" — persisted `cta: "Menu"` and `"Menu\n\u200B"`
    (production value `metaAdId: "chrome-zwsp-menu"`) blank on read.
  - "never drops a real advertiser CTA from persisted rows (FIX-14 read side)".

## Verification run (this lane)

Run on current main in this worktree (no product changes; evidence branch only):

```
$ npx vitest run --configLoader runner tests/meta-library-browser.test.ts tests/ad-persistence-ratchet.test.ts
 Test Files  2 passed (2)
      Tests  87 passed (87)
```

## Files

- `.lane/reports/0509-lane1-meta-library-menu-cta-already-resolved.md` — this
  evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.

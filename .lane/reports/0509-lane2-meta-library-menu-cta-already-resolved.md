# Stop Meta Ad Library chrome ("Menu") from rendering as the ad CTA — already resolved

**Status: already resolved on origin/main; this lane records the evidence only.**

Branch: `lane2/meta-library-menu-cta-already-resolved`
Base: `origin/main` at `422fbd55` (#806)

## Item

- [ ] Stop Meta Ad Library chrome ("Menu") from rendering as the ad CTA on
  public search (scout 2026-08-09, risk: amber).

## Verdict

No product code change was warranted. The defect is already fixed on
`origin/main` by three merged fixes, each verified as an ancestor of the
current main HEAD (`422fbd55`) in this worktree:

- **PR #552** — `1ee24c70` "fix(search): stop Ad Library chrome ('Menu') from
  rendering as the ad CTA", merged 2026-08-09 (the scout's own flag date):
  the write-side choke point.
- **PR #657** — `f243e676` "fix(search): stop persisted Ad Library chrome from
  rendering as the ad CTA", merged 2026-08-13: the read-side choke point for
  rows persisted before the write guard landed.
- **PR #717** — `370e5417` "fix: treat zero-width chrome CTAs as Ad Library
  chrome", merged 2026-08-14: closes the residual `"Menu\n\u200B"` variant
  recorded in `docs/sol-postmerge-657-waiting-room-close.md`.

## Verification on current main (this lane)

Ancestry check against fresh `origin/main`:

```
$ git merge-base --is-ancestor 370e5417 origin/main && echo 717-in-main
717-in-main
$ git merge-base --is-ancestor f243e676 origin/main && echo 657-in-main
657-in-main
$ git merge-base --is-ancestor 1ee24c70 origin/main && echo 552-in-main
552-in-main
$ git log -1 --format='%h %ad %s' --date=short origin/main
422fbd55 2026-08-21 fix(proof): real-proof surfaces — ...
```

Code-path trace on current main:

- **Write-side gate**: `isAdLibraryChromeCta` in
  `app/lib/meta-library-rendered-card-parser.server.ts` (FIX-14) is applied in
  `normalizeExtractedCard` (`app/lib/meta-library-browser.server.ts:2215`),
  the single normalization point every live scrape path flows through
  (Browser Run session extraction, Browserless, rendered-text fallback,
  Quick Actions — all route via `normalizeAndFilterExtractedCards` →
  `normalizeExtractedCard`). It strips zero-width / format characters
  (U+200B–U+200D, U+2060, U+FEFF) and whitespace, then exact-matches against
  the chrome token list (`menu`, `open drop-down`, `see ad details`,
  `see summary details`, `view ad details`, `meta ad library result`,
  `more`, `report ad`). Real advertiser CTAs ("Shop now", …) never collide —
  exact match only.
- **Read-side gate**: `listAdsByIds` in `app/lib/ad-persistence.server.ts:181`
  applies the same helper, so rows captured before the write guard landed
  blank their chrome CTA on every read. Public search hydration
  (`hydrateAdsWithPersistedCreatives` → `listAdsByIds`) never overwrites
  `cta`, so the guarded read value is what renders.
- **CTA pickers**: both `pickCtaFromCard` implementations (session extraction
  script and Browser Run fallback, `app/lib/meta-library-browser.server.ts`)
  filter chrome buttons by exact label before picking the CTA verb; a
  chrome-only card returns no CTA at all. The rendered-text fallback
  (`extractTextCardsFromVisibleText` → `inferCta`) cannot produce "Menu"
  because `inferCta` only matches the real CTA verbs.
- **Demo data**: `app/lib/demo-data.ts` carries only real advertiser CTAs
  ("Shop now", "Buy now", …) — no chrome.
- **Public-search trace**: `app/routes/search.tsx` →
  `executeSearchWithRelevance` (`app/lib/search-execution.server.ts`) →
  `searchAdsViaSourceResolver` (`app/lib/ad-source.server.ts`) →
  browser/API/demo providers. Every provider's `cta` passes a guarded
  choke point before it can reach the `selectedAd.cta` render surface at
  `app/routes/search.tsx:2111`. The "Primary CTA" row at line 2161 is the
  landing-page CTA (destination site), a different surface — not Meta
  Ad Library chrome.

## Regression pins (all passing, run in this worktree on this branch)

```
$ npx vitest run --configLoader runner tests/meta-library-browser.test.ts tests/ad-persistence-ratchet.test.ts
 Test Files  2 passed (2)
      Tests  99 passed (99)

$ npx vitest run --configLoader runner tests/search.route.test.ts tests/search-actions-integrity.test.ts
 Test Files  2 passed (2)
      Tests  45 passed (45)
```

Pinned behaviors:

- `tests/meta-library-browser.test.ts` — "skips Ad Library chrome buttons
  when the session extraction script picks the CTA" (chrome "Menu" / "See ad
  details" skipped, real CTA picked; chrome-only card CTA is `""`); "drops
  Ad Library chrome captured as the CTA (FIX-14)"; "flags Menu with a
  trailing zero-width space (U+200B) as chrome"; "never flags real advertiser
  CTAs".
- `tests/ad-persistence-ratchet.test.ts` — "drops Meta Ad Library chrome
  captured as the CTA from persisted rows (FIX-14 read side)" (persisted
  `cta: "Menu"` and `"Menu\n\u200B"` blank on read); "never drops a real
  advertiser CTA from persisted rows".
- `tests/search.route.test.ts` / `tests/search-actions-integrity.test.ts` —
  public search route + selection actions stay green.

## Files

- `.lane/reports/0509-lane2-meta-library-menu-cta-already-resolved.md` — this
  lane-unique evidence record (the only file touched by this lane; the shared
  `.lane/report.md` is untouched).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.

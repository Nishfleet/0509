# Render-blocking resources on home (dogfood da0f9f345221) — already resolved

**Status: already resolved; this lane records the evidence only.**

Branch: `lane1/render-blocking-already-resolved`
Base: `origin/main` at `f0e8e7f9` (#743)

## Item

- [ ] [dogfood da0f9f345221] Render-blocking resources on home
  [dogfood 20260809T013017Z-msl4lamt]

## Verdict

No code change was warranted. The finding was fixed on `origin/main` before
this lane ran, by two merged PRs, both ancestors of the current `main` HEAD
(`f0e8e7f9`):

- **PR #611** — `0f7573f0` "fix(perf): load the Google Fonts stylesheet
  without blocking first render", merged 2026-08-11: moved the Google Fonts
  css2 stylesheet off the render-blocking path (preload `as=style` +
  print-media stylesheet + inline swap script + noscript fallback).
- **PR #647** — `389c0e55` "fix(fonts): stop print→all stylesheet swap from
  failing hydration", merged after #611: keeps the same non-blocking pattern
  while making the pre-hydrate media flip hydration-safe
  (`suppressHydrationWarning` on the stylesheet link).

The dogfood engine (SEO Fix Kit) fires "Render-blocking resources on home"
only at **two or more** render-blocking candidates. The pre-fix page carried
exactly two: `/assets/root-*.css` and the fonts css2 request. After #611/#647
the only remaining blocking candidate is `/assets/root-*.css` — the app's own
CSS bundle, which styles first paint itself and is deliberately kept
render-blocking (the fix's own guidance: "load secondary styles after the
page can render" applies to the fonts sheet, not to the stylesheet that
defines the initial layout).

## Evidence on current main (`f0e8e7f9`)

- **Fonts stylesheet moved off the critical path** —
  `app/root.tsx` `links()` returns only favicons and font preconnects; the
  css2 stylesheet is no longer a link descriptor. `GoogleFontsStylesheet()`
  renders in the Layout `<head>`:
  `<link rel="preload" as="style" href={GOOGLE_FONTS_STYLESHEET_HREF} />`
  (high-priority fetch, non-blocking),
  `<link id="f9-font-stylesheet" rel="stylesheet" ... media="print" />`
  (Chrome reports print-media stylesheets non-blocking),
  `FONT_SWAP_SCRIPT` inline (flips `media="print"` → `"all"` on load, and
  immediately when the sheet is already cached), plus a `<noscript>` plain
  stylesheet fallback that only applies when JS is off (never delays first
  paint).
- **First paint stays correct** — the page renders fully in fallback fonts
  (`display=swap` on every requested face: Inter 400/500/600/700, Bricolage
  Grotesque 600/700/800, IBM Plex Mono 400/500/600) and swaps in web fonts
  when the sheet lands; nothing visible depends on the sheet for first
  render.
- **Hydration parity** — the swap can land before React hydrates (cached
  css2 + preload), so the stylesheet link carries `suppressHydrationWarning`
  (the same pattern `Layout` already uses for `THEME_BOOT_SCRIPT`), keeping
  the release gate free of `browser_hydration_error:console` attribute
  mismatches.
- **Global surface** — the pattern lives in the root `Layout` head, so every
  public page (`/`, `/search`, `/help`, `/docs`, `/status`, `/auth/login`)
  gets the same non-blocking treatment, not just home.

## Regression pins (all passing)

- `tests/root-fonts-async.test.ts` (3 tests, suite name carries the dogfood
  id):
  - "keeps the font preconnects but drops the render-blocking stylesheet
    from links()" — `links()` has zero stylesheet descriptors and no
    googleapis href.
  - "preloads the font sheet, applies it after load, and keeps a no-JS
    fallback" — markup contains the preload, the print-media stylesheet,
    the swap script (`load` listener + cached-sheet `if(l.sheet)` branch),
    `suppressHydrationWarning`, and the noscript fallback.
  - "wires the non-blocking font sheet into the rendered Layout head" —
    rendered `<head>` carries preload + print sheet + swap script +
    noscript, and every non-noscript googleapis link is a preload,
    preconnect, or print-media stylesheet.

## Verification run (this lane)

Run on fresh `origin/main` in this worktree (no product changes; evidence
branch only):

```
$ npx vitest run --configLoader runner tests/root-fonts-async.test.ts
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

## Files

- `.lane/reports/0509-lane1-render-blocking-home-already-resolved.md` — this
  evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.

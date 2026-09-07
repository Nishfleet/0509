# Lane 1 — dogfood da0f9f345221 "Render-blocking resources on home": already resolved (fresh re-verification, 2026-08-15)

**Item**: [dogfood da0f9f345221] Render-blocking resources on home
[dogfood 20260809T013017Z-msl4lamt]

**Verdict**: Already implemented and merged. Evidence record only; no product
code touched.

## What the investigation found

The full fix is on `origin/main` (verified `git merge-base --is-ancestor` for
both commits against current `origin/main` at `68ec15ff`):

- **PR #611** (`0f7573f0`) — moved the Google Fonts css2 stylesheet off the
  render-blocking path in `app/root.tsx`: high-priority `preload as=style`,
  print-media stylesheet (non-render-blocking), inline `FONT_SWAP_SCRIPT`
  that flips `media="print"` → `"all"` on load (and immediately when cached),
  and a `<noscript>` fallback. Applied globally in the `Layout` head, so it
  covers home, `/search`, `/help`, `/docs`, `/status`, `/auth/login`, and
  every other public page.
- **PR #647** (`389c0e55`) — fixed the print→all swap hydration parity
  (`suppressHydrationWarning` on the stylesheet link) so the cached-sheet
  case does not fail release readiness.

## Fresh verification on this tip (2026-08-15)

### Code state at `origin/main` `68ec15ff`

- `app/root.tsx` still carries the non-blocking sequence:
  `GOOGLE_FONTS_STYLESHEET_HREF`, `FONT_SWAP_SCRIPT`,
  `GoogleFontsStylesheet` (preload + `media="print"` sheet + swap script +
  noscript fallback), wired into `Layout` heads.
- `links()` exports only favicon/apple-touch-icon and the two font
  preconnects — no render-blocking stylesheet descriptors.
- Regression suite passes:

```
$ npx vitest run --configLoader runner tests/root-fonts-async.test.ts
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

### Live production (https://0509.io/, HTTP 200, fetched 2026-08-15)

Home HTML head contains exactly one render-blocking stylesheet —
`/assets/root-Dk0WtRnZ.css` — which styles first paint itself and is
deliberately kept blocking. The Google Fonts css2 request is served
non-blocking:

- `<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?..."/>`
- `<link id="f9-font-stylesheet" rel="stylesheet" href="...css2?..." media="print"/>`
- inline swap script (`l.media="all"`), `f9-font-stylesheet` id present
- `<noscript>` plain-stylesheet fallback (only applies when scripts are off)

The dogfood engine's "Render-blocking resources on home" finding fires only
at two or more render-blocking candidates; with the css2 request now
non-blocking, home reports just the root stylesheet and the finding no
longer fires.

## Deliverables

- Branch `0509-lane1-render-blocking-home-reverified` pushed; PR opened.
- Evidence record: `.lane/reports/0509-lane1-render-blocking-home-reverified.md`
  (only file in the PR; unique to this lane).
- Lane claims published to `/home/nish/workspaces/agent-state/lanes/0509/lane-1.json`.

## Rollback

N/A — evidence-only change.

# Lane 6 — dogfood da0f9f345221 "Render-blocking resources on home": already resolved (re-verification, 2026-08-21)

**Item**: [dogfood da0f9f345221] Render-blocking resources on home
[dogfood 20260809T013017Z-msl4lamt]

**Verdict**: Already implemented and merged on `origin/main`. Evidence record
only; no product code touched.

## What the investigation found

The fix is already on `origin/main` and is an ancestor of the current worktree
HEAD (`422fbd55`):

- **PR #611** (`0f7573f0`) — moved the Google Fonts css2 stylesheet off the
  render-blocking path in `app/root.tsx`: high-priority `preload as=style`,
  print-media stylesheet (Chrome reports non-blocking), inline
  `FONT_SWAP_SCRIPT` that flips `media="print"` → `"all"` on load (and
  immediately when the sheet is already cached via `if(l.sheet){apply();}`),
  and a `<noscript>` fallback. Wired into the global `Layout` head so it
  covers home plus `/search`, `/help`, `/docs`, `/status`, `/auth/login`, and
  every other public page.
- **PR #647** (`389c0e55`) — added `suppressHydrationWarning` on the print-media
  stylesheet link so the cached-sheet pre-hydrate flip does not trip
  `browser_hydration_error:console` and fail release readiness.

```
$ git merge-base --is-ancestor 0f7573f0 HEAD && echo OK
OK
$ git merge-base --is-ancestor 389c0e55 HEAD && echo OK
OK
```

## Why the fix clears the finding

The SEO Fix Kit dogfood engine fires "Render-blocking resources on home" only
at **two or more** render-blocking candidates. The pre-fix page carried exactly
two:

- `/assets/root-*.css` — the app's own CSS bundle, which styles first paint
  itself and is deliberately kept render-blocking. The fix's own guidance
  ("load secondary styles after the page can render") does not apply to this
  stylesheet: removing it would unstyle first paint.
- `https://fonts.googleapis.com/css2?...` — the Google Fonts stylesheet, a
  secondary style. The page renders fully in fallback fonts because every
  requested face uses `display=swap`; nothing visible depends on the sheet for
  first render.

After #611/#647 the only blocking candidate on `/` is `/assets/root-*.css`.
The fonts stylesheet is now served non-blocking (preload + print-media +
inline swap script), so the engine no longer fires the finding.

## Fresh verification on this tip (2026-08-21)

### Code state at HEAD `422fbd55`

- `app/root.tsx` `links()` exports only favicons and the two font preconnects
  — no stylesheet descriptors, no `googleapis` href.
- `GoogleFontsStylesheet()` is rendered inside the `Layout` head (both the
  default branch and the `shouldReloadForSiteRepWidget` branch) and emits
  the preload + print-media stylesheet + `FONT_SWAP_SCRIPT` +
  `noscript` fallback sequence.
- The `FONT_SWAP_SCRIPT` keeps both branches: `load` listener and the
  cached-sheet `if(l.sheet){apply();}` immediate-apply branch.
- Regression suite passes:

```
$ env -u NODE_ENV ./node_modules/.bin/vitest run \
    tests/root-fonts-async.test.ts tests/funnel-seo.test.ts
 Test Files  2 passed (2)
      Tests  13 passed (13)
```

`tests/root-fonts-async.test.ts` (suite name carries the dogfood id, 3 tests)
locks all three guarantees: `links()` has no render-blocking stylesheet
descriptors, the rendered `GoogleFontsStylesheet()` carries preload +
print-media sheet + swap script + noscript fallback + `suppressHydrationWarning`,
and the rendered `<head>` keeps the same shape with no leftover blocking
googleapis stylesheet.

### Live production (https://0509.io/, HTTP 200, fetched 2026-08-21)

Home HTML head contains exactly one render-blocking stylesheet —
`/assets/root-lQBL2jVF.css` — which styles first paint itself and is
deliberately kept blocking. The Google Fonts css2 request is served
non-blocking:

```
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous"/>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&amp;family=IBM+Plex+Mono:wght@400;500;600&amp;display=swap"/>
<link id="f9-font-stylesheet" rel="stylesheet" href="https://fonts.googleapis.com/css2?...&amp;display=swap" media="print"/>
<script>... l.media="all" ...</script>
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?...&amp;display=swap"/></noscript>
```

The `media="print"` link is what Chrome reports non-blocking. The
`<noscript>` fallback only applies when JS is off, so it can never delay
first paint. The engine's "Render-blocking resources on home" finding
needs two-or-more candidates to fire; with the css2 request now
non-blocking, home reports just the root stylesheet and the finding does
not fire.

## Deliverables

- Branch `0509-lane6-render-blocking-home-already-resolved` created on fresh
  `origin/main` `422fbd55`.
- Evidence record: `.lane/reports/0509-lane6-render-blocking-home-already-resolved.md`
  (the only file in the PR; unique to this lane).
- Lane claims published to
  `/home/nish/workspaces/agent-state/lanes/0509/lane-6.json`.

## Rollback

N/A — evidence-only change.

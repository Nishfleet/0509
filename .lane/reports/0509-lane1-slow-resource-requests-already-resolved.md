# Slow resource requests on home (dogfood a08b8427701d) — already resolved

**Status: already resolved on `origin/main`; this lane records the evidence only.**

Branch: `0509-lane1-slow-resource-requests-already-resolved`
Base: `origin/main` at `b21cc135` (#643)

## Item

- [ ] [dogfood a08b8427701d] Slow resource requests on home
  [dogfood 20260808T074205Z-msk2fl3n]

## Verdict

No code change was warranted. The item is already landed on `origin/main`
via **PR #603** (`67c11c1c`, merge of `1ced110d`, merged 2026-08-11), and
`git merge-base --is-ancestor 1ced110d origin/main` is true.

## What the fix does

The SEO Fix Kit dogfood run flagged "Slow resource requests on home"
(evidence from `runs/20260808T074205Z-msk2fl3n.json`: `pricing-preview`
2626ms, then `install (1262ms); config (1262ms)`).

- **PR #542** already deferred the `/api/pricing-preview` fetch until the
  pricing section nears the viewport.
- **PR #603** (`1ced110d` "fix(perf): move non-critical Site Rep widget
  requests out of home's initial-load window") installs the embedded Site
  Rep support widget (`siterep.net/widget.js`, which makes
  `/api/public/install` + `/api/public/config` calls that intermittently
  exceed 1s) `SITE_REP_WIDGET_DELAY_MS` (5s) after hydration instead of at
  hydration — the finding's own "move non-critical requests later"
  guidance. `installSiteRepWidget` keeps its immediate default (`delayMs`
  0) for other callers, and cleanup cancels a pending delayed install.

## Evidence on current main

- `app/lib/siterep-widget.ts:20` — `SITE_REP_WIDGET_DELAY_MS = 5000`, with
  the PERF comment citing dogfood `a08b8427701d` and the run evidence.
- `app/root.tsx:170-179` — `installSiteRepWidget(widget, …, { delayMs:
  SITE_REP_WIDGET_DELAY_MS })` schedules the widget script via
  `setTimeout(install, delayMs)` after the page settles; the PERF comment
  at `app/root.tsx:172-175` cites the same dogfood id.
- Widget scope unchanged: `shouldLoadSiteRepWidget` still limits the
  widget to the documented public paths (`/`, `/help`, `/docs`, `/status`,
  `/changelog`, `/trust`, `/privacy`, `/terms`, `/compare/magicbrief`),
  and it stays disabled for authenticated sessions and isolated paths.

## Regression pins (all passing, run in this worktree)

- `tests/siterep-widget.test.ts`, "deferred install (dogfood
  a08b8427701d: slow resource requests on home)" describe block:
  - "still installs synchronously by default and with an explicit zero
    delay" — immediate path preserved.
  - "installs the documented widget script exactly
    SITE_REP_WIDGET_DELAY_MS after the call" — fake timers prove the
    script is appended exactly at the delay boundary, with the documented
    script config.
  - "cleanup cancels a pending deferred install so nothing is appended
    later" — no late third-party requests after teardown.

```
$ npx vitest run --configLoader runner tests/siterep-widget.test.ts
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

## Files

- `.lane/reports/0509-lane1-slow-resource-requests-already-resolved.md` —
  this evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.

# Lane evidence — claim/issue-2421 (Nishfleet/0509 #2421)

Goal: close the parked literal-accessibility items from
`docs/A11Y-SWEEP-2026-07-20.md` (D-03 44px density, D-04 quiet-tone contrast
re-measurement, D-05 long watchlist-detail outline) per the judge-edited
spec.

## What changed

- `app/app.css`
  - `.f9-mode-toggle label` `min-height` 42px -> 44px (the "Track as" radio
    pair on the watchlist Setup tab was the one sub-44px target on the
    surface; `.f9-wk-tab`, `.f9-wk-rowlink`, `.f9-wk-row-lead label`,
    `.f9-wk-btn`, `.f9-wk-lnk`, `.f9-wk-nav-a`, `.f9-wk-more`, `.f9-wk-search`
    were already 44px).
  - `.f9-wk-row-confirm` gained explicit `min-width/min-height: 44px` (it
    previously inherited the floor only from the paired `.f9-wk-lnk`).
  - `--ink-faint` light `#6e6a5e` -> `#6a665b`; dark `#8a867c` -> `#8c887e`;
    dark `--wk-on-band-dim` `#89846f` -> `#8d8873`.
- `app/components/watchlists/detail-tab-bar.tsx` — WAI-ARIA tabs pattern:
  `ul[role=tablist]` > `li[role=none]` > `a[role=tab]` with `aria-selected`,
  `aria-controls="competitor-panel-<id>"`, `id="competitor-tab-<id>"`,
  roving `tabIndex` (active 0, rest -1), ArrowLeft/Right/Home/End move focus
  (manual activation — the tabs are real links; Enter navigates).
- `app/components/watchlists/competitor-detail.tsx` — the panel switched
  `role="region"` -> `role="tabpanel"` with
  `aria-labelledby="competitor-tab-<activeTab>"` and `tabIndex={0}`;
  `aria-label`/`panelLabel` dropped (the tab now names it).
- `docs/A11Y-SWEEP-2026-07-20.md` — D-03/D-04/D-05 marked resolved.
- `docs/design-system-ratchet.json` — deliberately untouched. The raw-hex
  count is unchanged at 258 (an earlier revision of this lane accidentally
  dropped the dark `--wk-band-rule` token, which read as a -1; restoring it
  keeps the count flat). `ratchet-auto-tighten.yml` owns ceiling moves on
  main, and editing the file trips the gate-integrity gate-owned-path rule.
- `tests/watchlists.route.test.ts` — tab assertions moved to the tabs
  pattern; new `it` runs axe-core (4.13.0) over the rendered opened-detail
  markup in happy-dom and asserts zero violations (page-chrome rules that
  cannot apply to a fragment are disabled).
- `tests/workspace-dark-mode.test.ts` — dark `--ink-faint` pin updated.
- `package.json`/`package-lock.json` — `axe-core@^4.13.0` devDependency.

## Measured contrast (WCAG AA target: >= 4.5:1)

| Tone / ground | Before | After |
|---|---|---|
| `--ink-faint` on `--card` (light) | 5.32 | 5.64 |
| `--ink-faint` on `--bone` (light) | 4.78 | 5.07 |
| `--ink-faint` on `--wk-sunk` (light, row hover/selected) | 4.33 FAIL | 4.59 |
| `--ink-faint` on `--card` (dark) | 4.49 FAIL | 4.61 |
| `--ink-faint` on `--bone` (dark) | 4.99 | 5.12 |
| `--ink-faint` on `--wk-sunk` (dark) | 4.58 | 4.70 |
| `--wk-on-band-dim` on `--wk-band` (light) | 5.28 | 5.28 (unchanged) |
| `--wk-on-band-dim` on `--wk-band-2` (light) | 4.69 | 4.69 (unchanged) |
| `--wk-on-band-dim` on `--wk-band` (dark) | 5.21 | 5.50 |
| `--wk-on-band-dim` on `--wk-band-2` (dark, rail hover) | 4.48 FAIL | 4.72 |

## Hit targets on /app/watchlists

`f9-wk-tab` 44x44, `f9-wk-rowlink` 44x44 (stretches over the whole row via
`::after`), row-lead checkbox label 44x44, `f9-wk-btn`/`f9-wk-lnk`/
`f9-wk-nav-a`/`f9-wk-more`/`f9-wk-search` 44 min-height, watchdetail CTAs
44x44, `f9-watchdetail-back` 44 — all already at floor. Fixed: mode-toggle
labels 42 -> 44; `f9-wk-row-confirm` now carries its own 44x44.

## Scope note

The judge's binding edit prescribes `role=tablist/tab/tabpanel`; the panel
element lives in `competitor-detail.tsx` (outside the literal `files:`
list), so it received the minimal `tabpanel`/`aria-labelledby` edit the
pattern requires.

# Lane report — claim/issue-3845 (devin-issue lane, 0509-3845)

Issue: Nishfleet/0509#3845 — REBUILD P1 design: references + three directions as
real HTML pages, screenshotted. Umbrella #3842.

## What shipped

`docs/design-directions/` — three directions, each a real HTML page for
landing / signed-in Home / one competitor page, shot at 1440×900 and 390×844:

- `a-morning-file/` (safe) — warm editorial paper; Fraunces + Instrument Sans +
  IBM Plex Mono; persimmon accent; ruled rows, "this morning's file" preview.
- `b-nightwatch/` (bold) — dark live wire; Anton + Archivo + JetBrains Mono;
  volt accent; capture-feed framing, stamps, striped "you" bar.
- `c-league/` (weird-but-plausible) — market as a league season; Oswald +
  Barlow; pitch accent; standings table, form dots, match report, head-to-head.

`README.md` carries the 8+3 reference shortlist (from the issue comment),
anti-references, and a per-direction note naming references kept/rejected.
No winner picked — Nish's call.

Charter constraints honored in every direction: one accent, characterful
display face + readable body, no purple-blue gradients, no equal card grids,
first viewport = who it's for + next action, per-brand tracking switch
(on the competitor page and in Home's standings/rank rows; off = dimmed,
history kept), 4-place nav (slim rail desktop / bottom tab bar mobile).

## Verification

Playwright 1.63 chromium via the main checkout's node_modules (no script file
added — inline `node -e` driver, `file://` URLs, `document.fonts.ready`,
500 ms settle). 18/18 renders: 0 console errors, 0 px horizontal overflow.
Screenshots committed beside the pages (`<page>-desktop-1440.png`,
`<page>-mobile-390.png`).

Inner-loop fixes made after viewing the PNGs: A/B bar-chart `height:100%` +
in-flow value labels (bars were collapsing to zero height); C mobile standings
grid specificity (`.standings .table .trow` needed the 3-class selector) and
club-cell flex→grid so domain text stacks instead of widening the row.

## Out of scope / notes

- Pages are static concepts — `href="#"` placeholders, no JS beyond the pure-CSS
  switch. Production wiring is P3.
- Old `f9-wk`/`f9-ed` design system deliberately not reused: the current app is
  an explicit anti-reference in the packet. Voice rules (sentence case, verbs on
  buttons, no exclamation marks in app) kept.
- memoryctl binary absent on this host (`~/.local/bin/memoryctl` ENOENT) — the
  shared-memory context/outcome calls could not run. Flagged for fleet-ops.
- Found stale failed unit `devin-issue@0509-3659` — its PR #3836 had already
  merged (`574871d64`, now origin/main); the unit died post-merge on timeout.
  Failed state had already unloaded; failed list now empty. No repair needed.

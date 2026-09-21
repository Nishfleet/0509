# Lane evidence — claim/issue-3878

**Packet:** Nishfleet/0509#3878 — REBUILD P3 design brief (Direction A in the
existing 0509 landing skin, no production code). Umbrella #3842.

## Delivered

- `docs/DESIGN.md` — the rebuild design brief, written wholesale (the path did
  not exist on main; §0 records where every skin token was read from).
- `docs/design-directions/a-final/` — `landing.html`, `home.html`,
  `competitor.html`, one shared `style.css`, six PNG renders.
- This record.

## Proof

**Render command** (verbatim, from the worktree):

```
$ npx playwright screenshot --browser chromium --viewport-size "1440, 900" --wait-for-timeout 3500 "file://$PWD/docs/design-directions/a-final/landing.html" docs/design-directions/a-final/landing-desktop-1440.png
Navigating to file:///home/nish/workspaces/agent-worktrees/issue-0509-3878/docs/design-directions/a-final/landing.html
Waiting for timeout 3500...
Capturing screenshot into docs/design-directions/a-final/landing-desktop-1440.png
```

The other five renders used the identical command with
`--viewport-size "390, 844"` and the corresponding page/output path.

**PNG inventory** — `ls -la docs/design-directions/a-final/`:

```
-rw-rw-r-- 1 competitor-desktop-1440.png   113740
-rw-rw-r-- 1 competitor-mobile-390.png      ~46000 (re-rendered after overflow fix)
-rw-rw-r-- 1 home-desktop-1440.png         125037
-rw-rw-r-- 1 home-mobile-390.png            51430
-rw-rw-r-- 1 landing-desktop-1440.png       ~81000 (re-rendered after wall fix)
-rw-rw-r-- 1 landing-mobile-390.png         52471
-rw-rw-r-- 1 competitor.html                 6336
-rw-rw-r-- 1 home.html                      18474
-rw-rw-r-- 1 landing.html                    7689
-rw-rw-r-- 1 style.css                      26186
```

**Console errors + horizontal overflow** — measured with Playwright
(chromium-1243, repo-pinned @playwright/test 1.63.0): per page per width,
`console` `error` events + `pageerror` counted, then
`document.documentElement.scrollWidth − clientWidth` and
`document.body.scrollWidth − clientWidth` evaluated after a 3.5s settle
(`document.fonts.status === "loaded"` confirmed). Result at both widths, all
three pages: **0 console errors, 0px overflow, no element leaks past the
viewport edge.** One defect was caught and fixed in-loop: `.dev.shot-dev`
overflowed 46px at 390 before the mobile stack rule; re-measured clean.

**Display face provenance** — Bricolage Grotesque is the face in the repo's
landing today: `app/app.css:39` (`--ld-display: "Bricolage Grotesque", …`) and
the font link at `app/root.tsx:157` (opsz `12..96`, weights `600;700;800`,
`display=swap`). IBM Plex Mono: `app/app.css:38` (`--ld-mono`). Colour tokens:
`app/app.css:3–17` (light) and `app/app.css:6722–6736` (dark). Mark mechanics:
`.ld-wall`/`.ld-del`/`.ld-ins`/`.ld-flag`/`.ld-change-mark`/`.ld-command`,
`app/app.css:2626–3042`.

## Scope notes

- Nothing outside the packet's three paths was touched. No `app/`, `workers/`,
  `migrations/`, `tests/`, `e2e/`, `.github/`, no `package.json` edit, no
  scripts/helpers anywhere.
- The four-week standing chart is drawn statically in the concept page and is
  captioned on-page as the Recharts production render (SSR'd per DESIGN.md §7 —
  this also resolves the packet's "name Recharts" + "<20KB client chart"
  tension).
- Open decision surfaced, not silently picked (DESIGN.md §0/§10): body face is
  Instrument Sans — the packet bans the landing's literal Inter body; swap is
  one line if Nish prefers otherwise.
- The 390 home render deliberately shows the expanded-row **sheet** open (spec
  §5 "row expansion as a sheet"); the in-place expansion is on the 1440 render.

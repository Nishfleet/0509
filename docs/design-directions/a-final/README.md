# Direction A, final — the 0509 visual language

Issue #3878 · umbrella #3842. Nish picked Direction A's structure (#3845) and swapped
its skin for the old landing's: cream ground, heavy black grotesk in caps, mono eyebrows,
ONE accent = the green marker, red strikethrough for "before". Fraunces and persimmon are
gone. The build brief these pages illustrate is `DESIGN.md` at the repo root.

These are concept pages, not production code. The rebuild generates the app fresh
(React Router 8 + Tailwind 4 + shadcn on Base UI) and **nothing from the old app is
reused** — `style.css` here is standalone and re-declares its tokens from scratch. The
hex values and font names were read off the old landing at `668d2452c` before the wipe
(`app/app.css` `:root`, line 2473 onward) and are restated in `DESIGN.md` §3–4 as the
new build's source of truth.

## Pages

| File | Shows |
|---|---|
| `landing.html` | Hero with the live proof column, the mark, the public standing card, how it works, sources, price |
| `onboarding.html` | One input → the identity card drawing itself → who you're up against |
| `home.html` | Greeting, **Read this first** (three marks, own-site first), chip row, four-week standing, ranked rows with per-row marks and source pills, one row expanded in place |
| `competitor.html` | Tracking switch, snapshot, the week's biggest move, developments feed with type chips, peers rail |
| `alerts.html` | Open own-site incident, type chips, day-grouped chronological rows with captures |

The market is fictional and shared with the three original directions: Loopwell (you),
Kindred, Bramble, Fieldset, Northbeam, and Casetta (paused). The capture plates stand in
for stored screenshots; production serves real R2 captures.

## Nish's five depth fixes, and where each one is

1. **Read this first** — `home.html`, directly under the greeting: three Jev-picked
   before-and-after marks with source, capture and verdict line. The own-site item leads.
2. **A mark on every ranked row** — each row carries its own before-and-after for the
   week's biggest move, with a "Why it moved" sentence.
3. **Rows expand in place** — the "you" row on `home.html` is shown open, with type tabs
   over the week's evidence. On mobile this is a sheet.
4. **Four weeks of standing, one line per brand** — `home.html`, yours as an ink line
   over a green marker band, every line labelled at its own end. Not this week's bars.
5. **Source pills per row** — where the week's noise came from, with dim pills for
   sources that produced nothing or are degraded.

## Re-render

Playwright is no longer in this repo. Use a one-off stock invocation from anywhere:

```
npx playwright@1.63.0 screenshot --browser chromium \
  --viewport-size "1440,900" --wait-for-timeout 2200 \
  "file://$PWD/docs/design-directions/a-final/home.html" /tmp/home.png
```

Widths: `1440,900` (desktop) and `390,844` (mobile), first viewport.

## Verification

All 10 renders, Playwright 1.63.0 chromium, `document.fonts.ready` awaited:
**0 console errors, 0 failed requests, 0 px horizontal overflow at both widths**, measured
by comparing `documentElement.scrollWidth` with `clientWidth` on every page at every width.

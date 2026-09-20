# REBUILD P1 — Design directions (issue #3845 · umbrella #3842)

**Phase:** references → three directions → Nish picks. No production code in this
PR; these are rendered HTML concept pages screenshotted at 1440px and 390px.
**Nish picks the winner — nothing here is pre-chosen.**

**The job:** a calm tracking product a founder opens every morning. "Watches you
across the internet and tells you where you stand. You, and your competition."
One input builds the watch; competitors auto-populate; every brand carries one
obvious tracking switch (off = dimmed, history kept). Nav is four places: Home,
Competitors, Alerts, Settings — slim left rail on desktop, bottom tab bar on
mobile. Motion budget: only what iOS would do.

## Reference shortlist (chosen for the job)

| # | Reference | What it lends |
|---|---|---|
| 1 | Bloom — "Add your brand" (Mobbin flow) | One input → "shaping your workspace" → overview. This IS our onboarding. |
| 2 | Clay — generate business context from a domain | Auto-built, editable identity card. |
| 3 | Semrush Competitor Research | "You" chip + competitor chips + one chart + three tabs. Keep the chip row and single chart; reject the 14-item sidebar. |
| 4 | Peec AI overview | Ranked table of brands with position and movement — the "where you stand" hook. |
| 5 | Hootsuite competitive analysis | Compare-with row, one table — keep the sparseness. |
| 6 | Perplexity Finance ticker | "Latest developments" with source + age; "Peers" list on the right. |
| 7 | Record Club activity | Type chips + chronological rows + small thumbnails. |
| 8 | Buffer Feeds | Source chips (Reddit, news, ads) + card with excerpt and age. |

**Anti-references:** Wix Benchmarks (dense sidebar + radar-chart noise) · Google
Analytics snapshot (dashboard sprawl) · **current 0509 landing and workspace**
(over-populated, intertwined). Every direction below deliberately avoids equal
card grids, purple-blue gradients, and nav wider than four places.

## Direction A — "The Morning File" (safe) · `a-morning-file/`

The product as a morning paper you read with coffee: warm paper, hairline
rules, one quiet column, the day already filed.
Type: **Fraunces** (display, italic accents) · **Instrument Sans** (body) ·
**IBM Plex Mono** (data). One accent: **persimmon** `#D9490B`.
Remixed: Bloom/Clay (one input → built-for-you card), Semrush (you-chip +
competitor chips + ONE chart), Peec (ranked rows with movement), Perplexity
(latest-developments feed + peers rail), Buffer (source chips).
Kept: ruled rows instead of cards; the switch as a quiet per-row control; the
landing's "this morning's file" slab as the payoff preview.
Rejected: Wix sidebar density, GA sprawl, gamified onboarding, exclamation
energy, second accent color.
Where it could bore: safest of the three — the typography has to carry the
whole personality, and it assumes "calm" is the buying reason.

## Direction B — "Nightwatch" (bold) · `b-nightwatch/`

The product works the night shift: a dark live wire you open to what was
captured while you slept. Loud condensed type, mono data labels, glowing "you".
Type: **Anton** (display) · **Archivo** (body) · **JetBrains Mono** (data).
One accent: **volt** `#C8F542`.
Remixed: Record Club/Buffer → the wire feed (type chips + timestamps as a
capture log), Peec → standings-as-big-numbers, Perplexity → developments with
mono ages + evidence links, Clay → the input rendered as a terminal field.
Kept: status stamps ("loudest this week"), striped "you" chart bar, hatch
pattern for paused brands, single glowing switch.
Rejected: spy kitsch (it's evidence, not a spy movie), card grids, the old
app's green-marker shorthand, any second hue — even down-movement stays
neutral ink.
Where it could misfire: reads "dev tool" if the audience isn't
terminal-comfortable; the dark commits hard — no half-measure light mode in
this concept.

## Direction C — "The League" (weird-but-plausible) · `c-league/`

Your market rendered as a season: a standings table, form dots, match reports,
head-to-head. Weird — and plausible, because "where you stand" is already the
product's literal question and a table is the densest honest answer.
Type: **Oswald** (condensed display + data) · **Barlow** (body).
One accent: **pitch green** `#177D3F`.
Remixed: Peec's ranked table taken literally (it IS a league table), Semrush's
chip row becomes the teamsheet, Perplexity's developments become the match
report, the charter's tracking switch becomes squad selection (off the
teamsheet, record kept).
Kept: position badges, form dots (last 5 weeks), striped "you" row, head-to-head
mentions panel, "the table" as the competitor-page rail.
Rejected: literal sports kitsch (no badges, balls, or pitch textures), jargon
that hides the data (every metaphor maps to a real metric), card grids.
Where it could misfire: the metaphor is the design — if it reads gimmicky to a
non-sports founder, the whole direction goes with it. If it lands, it's the
only one a user could describe to a friend in one sentence.

## Files & re-render

Each direction directory holds `landing.html`, `home.html`, `competitor.html`,
a shared `style.css`, and six PNGs (`<page>-desktop-1440.png`,
`<page>-mobile-390.png`, first viewport, 1440×900 / 390×844).

Pages are self-contained (Google Fonts via CDN); re-shoot any page with stock
Playwright, no repo scripts:

```
npx playwright screenshot --viewport-size "1440, 900" "file://$PWD/docs/design-directions/a-morning-file/landing.html" /tmp/a.png
```

## Verification

All 18 renders: Playwright 1.63 (chromium), `document.fonts.ready` awaited —
**0 console errors, 0 px horizontal overflow at both widths.** The shared
fictional market (Loopwell + 5 competitors, one paused) is identical across
directions so the choice is purely about the design language.

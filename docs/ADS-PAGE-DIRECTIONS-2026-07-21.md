# `/ads/:domain` Redesign — References & Three Directions (WP-C1)

Date: 2026-07-21
Author: Claude (reviewer/coordinator role)
Workflow phase: **references → three directions rendered in Chrome → Nish picks the winner.**
This doc is the pre-code deliverable for WP-C1 in `docs/INTENT-AUDIT-2026-07-21.md`
(the single worst page in the product — `/ads/nike.com`, intent score **2/10**).
**No production code was written.** Nish picks the winner before any build.

---

## The brief (what the page must do)

`/ads/:domain` is the public **programmatic-SEO acquisition surface** — a stranger
lands here from a Google search like *"nike facebook ads"* with zero context and zero
account. The business job:

> Make that first-time visitor feel **"this brand is under live surveillance — and I
> can point the exact same thing at MY competitors"** — with **honest freshness
> labels** and a **signup CTA that carries the domain** they searched.

### Hard constraints that shaped every direction
- **Zero-cost render.** The live route (`app/routes/ads.$domain.tsx`) renders ONLY from
  the existing discovery cache — no scraping, no Meta API, no Browser Rendering on a
  public hit. So freshness is always *"cached N ago"*, never *"live right now"*. Every
  direction states this honestly instead of faking a live pull.
- **Honesty is the brand.** "Caught in the act" public system, DESIGN.md: coverage and
  freshness labeled and can vary by source; the cache-miss shell stays honest
  ("we haven't checked … recently"). The Aggression Score formula is public by design.
- **Real data shape** (grounds the fake-but-plausible Nike content): `AdRecord[]` with
  advertiser / headline / hook / format / `variantCount` / longevity; a `teaser`
  (total, active, longest-running hook + days, formats); `checkedAgo` freshness string;
  and the **Ad Aggression Score** (`app/lib/aggression-score.ts`) — 0–100, four
  components of 0–25 each (velocity, testing, freshness, persistence), bands Quiet
  0–25 / Steady 26–50 / Aggressive 51–75 / All-out 76–100.
- CTAs must be **exactly two**: primary `Watch {domain}` → signup carrying the domain;
  secondary `Run a live search` → `/search?website=`.

### What's broken today (verified live, 2026-07-21, 1440px)
The page rendered its **cache-miss shell**: an off-brand system-bold sentence-case
title ("Nike on Five to Nine"), a generic dotted white card, an apologetic empty state
("We haven't checked nike.com recently"), and ~70% dead whitespace below the fold.
Even the *populated* branch (`BrandAdsResults`) uses generic `f9-detail-grid` /
`f9-discovery-banner` chrome — none of the landing's Bricolage / cream / ink / green
poster language. It reads like a 404, not an acquisition page.

---

## Reference shortlist (Mobbin, examined by image — not metadata)

Chosen for the **business job**, not beauty. Each direction remixes ≥3; none is copied.

| # | Reference | Link | The one ingredient we want |
|---|-----------|------|----------------------------|
| 1 | **X — Radar** (seed) | [screen](https://mobbin.com/screens/d7d48e13-9d74-46ff-99f7-9f8e88117b70) | Query → **activity chart + live feed** spine: a brand as a monitored subject with a pulse. |
| 2 | **Indeed — Company snapshot** (seed) | [screen](https://mobbin.com/screens/90872944-c916-4994-9a65-2a3d98fc67a8) | A single **headline score + supporting metric cards** — our Aggression Score as the hero number. |
| 3 | **Zillow — Value history** (seed) | [screen](https://mobbin.com/screens/89650663-9814-4574-9aae-784e79ad7170) | **Time-series as narrative** — "here's how this moved," which reframes freshness as a story, not an apology. |
| 4 | **OpenAI Platform — Service health** | [screen](https://mobbin.com/screens/56b53d75-8efb-42c0-9921-3f0c97f43306) | **Green live-pulse + incident-history feed** — the "under active watch" trust cue and a change-log pattern. |
| 5 | **Better Stack — Status page** | [screen](https://mobbin.com/screens/fccc7b7d-5552-4da0-9d0d-0e5f1143d9b4) | **Operational banner + honest 90-day uptime bars** — freshness/monitoring shown as a trust signal, labeled. |
| 6 | **AWS — Health Dashboard service history** | [screen](https://mobbin.com/screens/2e83f4b0-7503-4d6e-b103-d61712d69cde) | **Dense time-grid** feel — a subject continuously observed across a window. |
| 7 | **Whop — Creatives gallery** | [screen](https://mobbin.com/screens/8fc72525-f19d-48df-93f3-959f2d79ed6b) | **A wall of real ad creatives** with format tags — the "these are their actual ads" payload. |
| 8 | **Pinterest — Ad account history** | [screen](https://mobbin.com/screens/e8a676ea-367a-40c8-a230-fd04fa01f2ed) | **Before/after change log with timestamps** — "what changed" as evidence, the retention hook made visible. |

### Anti-references (what to avoid)
- **Reddit / X Ads-Manager dashboards** — [example](https://mobbin.com/screens/1ddf9f18-43df-4562-9927-df29a806ad06).
  Equal-weight KPI-card rows + line charts. Cold, undifferentiated — *could be any ad
  tool*. A stranger feels sold a dashboard, not shown a rival exposed. **Fails the
  specificity gate.**
- **The current `/ads` dotted empty card** (live) + generic media-library placeholders
  like [HoneyBook Library](https://mobbin.com/screens/462e83e7-fd44-4a45-bef5-ddb4203b8f8f).
  Dotted borders, gray squares, apologetic copy, vast whitespace. This is exactly what
  scored 2/10. **Never again.**

---

## The three directions (real HTML, rendered in Chrome @ 1440px)

All three share the exact public tokens (bone `#F4F1E8`, ink `#0E0D0A`, signal-green
`#16C47F`, diff-red `#E0442C`, card `#FFFDF8`, 2–2.5px ink borders), the type system
(Bricolage Grotesque 800 uppercase display · Inter body · IBM Plex Mono
labels/timestamps), and the same honest Nike payload (34 ads, Aggression Score **78 =
All-out**, longevity pills, `×N variants`, "cached 2h ago"). Files live in
`/tmp/0509-ads-directions/`. **The fake data is clearly labeled "sample figures shown
for concept" in each footer.**

### Direction 1 — "The Case File" · **SAFE**
`direction-1-case-file.html`

The most direct extension of the landing's evidence/case-file poster. Capture ticker →
mono freshness eyebrow → Bricolage headline **"Nike is running 34 Meta ads right now"**
(green-highlit number) beside a **stamped Aggression Score card** (ALL-OUT wax-stamp,
four component bars, public-formula note) → full-width black **"Watch nike.com"** strip
with green CTA → the **wall of 6 evidence cards** (format tag, longevity pill, variant
count, "proof saved" badge) → honest footer.

| Ingredient | Kept | Rejected |
|---|---|---|
| Landing evidence/case-file framing (tape, stamps, mono timestamps) | ✅ the whole spine | — |
| Indeed score + metric cards (#2) | ✅ Aggression Score as a stamped dossier card | ✗ Indeed's neutral corporate calm |
| Whop creative wall (#7) | ✅ 3-col evidence-card grid | ✗ its plain filename captions |
| X Radar live feed (#1) | ✅ only the top capture ticker | ✗ the dark app chrome |

**Why it fits:** lowest risk, maximum brand continuity — a visitor who came from the
landing feels one product. Honest-by-construction. **Risk:** it's *tasteful but quiet* —
closest to "a very good version of the current idea," least likely to make a stranger
gasp. (This is why a louder Direction 2 exists — "the landing page needs to LAND.")

### Direction 2 — "Under Surveillance" · **BOLD** (the louder variant)
`direction-2-under-surveillance.html`

Inverts to a **full-bleed ink-dark hero** with a faint surveillance grid, a pulsing
green **"● nike.com is under watch"** banner with honest cadence ("last swept 2h ago ·
next sweep in 4h"), a giant Bricolage headline **"34 live ads. And nike.com knows none
are hidden,"** and a **score-gauge panel** (78/100, band meter, climbing new-ads-per-week
sparkline). Below, back on bone: a **"What changed this week" change-log feed** with
green NEW / red-strikethrough diff semantics and source tags, then a tight 4-up ad wall,
then a full-width poster closer **"Your competitor is running ads right now. You just
can't see them."**

| Ingredient | Kept | Rejected |
|---|---|---|
| X Radar (#1) live-feed + activity chart | ✅ pulse banner + climbing sparkline | ✗ literal radar sweep animation (gimmick) |
| OpenAI / Better Stack status (#4/#5) | ✅ green live-pulse + band meter as trust | ✗ uptime %; we don't claim uptime |
| Pinterest ad-account-history (#8) | ✅ the change-log feed with diff colors | ✗ its raw before/after table density |
| Diff-red `#E0442C` | ✅ strictly as deletion semantic in the feed | ✗ red as decoration |

**Why it fits:** this is the one that **LANDS** — it *feels* like surveillance the
instant it loads, which is precisely the emotion the brief asks for, and the dark hero
is a genuine change of register from the landing so the funnel has rhythm. **Risk:**
the inverted hero is a bigger departure; must stay disciplined (one accent, red only as
diff) or it tips into "spy-movie" cliché. The dark band also needs a light/dark
contrast pass and a mobile stack check before build.

### Direction 3 — "The Scoreboard" · **WEIRD-BUT-PLAUSIBLE**
`direction-3-scoreboard.html`

Reframes competitive ad activity as a **live sports box-score**. A black **scoreboard**
header — **NIKE (home) vs YOUR BRAND (the field)**, Aggression Score **78** as the score
vs a **"—"** ("not on the board yet"), ALL-OUT status, blinking LIVE dot, formula line
along the bottom → confident headline **"Nike is winning the ad game. Are your
competitors beating you 2–0?"** with a bordered **"Put it on my board"** CTA → **"The
stat line"** (5-cell box score: ads live, new/wk, tests, longest run, formats) →
**"Play by play"** feed in light sports-commentary voice ("3 variants off the bench,"
"full-court press") but honest + source-linked → **"The lineup"** — numbered ranked ad
cards.

| Ingredient | Kept | Rejected |
|---|---|---|
| Sports box-score (cultural form) | ✅ scoreboard, stat line, play-by-play, lineup | ✗ team-logo/mascot kitsch |
| Indeed snapshot (#2) | ✅ the 5-cell stat row | ✗ its flat card styling |
| Zillow history (#3) | ✅ "play by play" as time-narrative | ✗ literal price chart |
| Whop wall (#7) | ✅ "the lineup" with jersey numbers | ✗ plain grid |

**Why it fits:** the you-vs-them framing is *inherently* the product's emotional core —
it makes the stranger the underdog who's currently *losing* and hands them the scoreboard
to fight back. Most memorable, most shareable, most differentiated (specificity gate:
passes hardest). **Risk:** the metaphor is load-bearing — if the voice slips from
"confident sports desk" to "cutesy," honesty suffers; and "winning/losing" language
needs care so it stays truthful (we don't actually score the visitor's brand). Highest
craft cost to get right.

---

## Recommendation

**Ship Direction 2 ("Under Surveillance") as the winner, borrowing Direction 1's
evidence-card wall and honest freshness eyebrow.**

Reasoning:
1. **It answers the brief most literally.** The single sentence in the brief is *"feel
   this brand is under live surveillance."* Direction 2 delivers that emotion in the
   first viewport — the pulse, the "under watch" banner, the score gauge — where
   Direction 1 makes you *read* to get there and Direction 3 makes you decode a metaphor
   first.
2. **It respects the funnel rhythm rule.** The landing is a bone/ink poster; a dark
   surveillance hero on `/ads/*` is a deliberate register change that still uses the same
   type + accent, so the funnel feels authored, not repeated (variability gate).
3. **The change-log feed is the retention story made visible.** "Monitoring is the
   retention loop" (product shape) — Direction 2 is the only one that puts *"what changed
   this week"* above the ad wall, which is the exact value a paying customer buys. That
   makes it the strongest *conversion* argument, not just the prettiest page.
4. **Honesty survives the boldness.** Because the hero leads with cadence ("last swept 2h
   ago · next sweep in 4h") and the score's public formula, the loud treatment never
   overpromises — the drama is all true.

Direction 1 is the **safe fallback** if Nish wants minimum risk / fastest build — it's
90% reusable landing components. Direction 3 is the **high-ceiling bet** — if Nish loves
the scoreboard, it's the most viral, but budget extra craft time and a truth pass on the
"winning/losing" voice.

**Suggested winner = D2 hero + feed, D1 wall.** One build, both strengths.

Nish picks. Then: build brief → build in the "Caught in the act" system → web-design +
polish audit → live desktop/mobile proof (whole-funnel rule — the cache-miss shell and
the auth pages it links to ship in the same system, same PR series).

---

## Winner + build brief

**Nish's pick (2026-07-21):** Direction 1 "The Case File" as the base, **grafting in**
D2's "what changed this week" change-log/diff feed, plus D3's stat line and play-by-play
— with copy re-optimized and sections repositioned. His words: *"lets add the what
changed this week, play by play and the stat line to 1. I liked 1 the most. BUT optimise
the copywriting and reposition as seen fit."*

Final concept: **`/tmp/0509-ads-directions/direction-final-case-file-hybrid.html`**
(**revised v3** — Nish gave three fixes on v1, then a further correction on the creatives;
all landed and re-rendered @1440px, 4 viewports top-to-bottom: hero+score, stat line +
play-by-play timeline, ad wall of **real Nike creatives**, closer). This section is the
spec the production builder implements against post-merge `main` (the real route is
`app/routes/ads.$domain.tsx`).

### Nish's reviews → fixes (all applied)
1. **Killed the investigation framing.** *"stop treating this like an investigation lmao."*
   All case-file / EXHIBIT / forensic / detective language is gone. Every label and
   section lead is now confident **product voice** in the landing's register ("THEY CUT
   THE PRICE… before your alarm goes off") — direct, punchy, about *the reader's
   advantage*. Kept D1's **visual** language (poster type, cream/ink, stamps, green
   accent). "Proof saved" chips → **"Screenshot saved"** (literal product truth).
   Approved leads retained: "All 34 ads, on the wall", "What changed this week",
   "The reason to watch".
2. **The ads are now REAL ads** (v2 used CSS mocks; Nish: *"not real-looking — REAL ads"*).
   The concept embeds **Nike's actual currently-running creatives pulled from the public
   Meta Ad Library** (page-scoped view, `view_all_page_id=15087023444`): real 600×600
   creative JPEGs downloaded to `/tmp/0509-ads-directions/creatives/` (black & white
   Air Monarch IV, Sportswear Tee, Charge shin guards), each card carrying the ad's
   **real primary copy** ("Run through summer with gear that can take the heat.", "Ball's
   in your court. Get the gear that never misses.", "Unlock the latest from Nike &
   Jordan.", "Get the gear that goes hard on and off the field.", "Get the gear not
   afraid to put in the work."), the **real destination domain** (nike.com /
   play.google.com / itunes.apple.com), and **real run-lengths** from "Started running
   on" dates as longevity chips (16 days for the 5-Jul batch; 126 days for the shin
   guards). This is exactly `creativeImageUrl` in production — so the concept is now an
   honest preview of the live page, not a lookalike. A 6th tile is a green "+29 more ads
   live → Watch nike.com" conversion cell (honest: only cached creatives are shown).
   Cards **never look broken** because real photos fill the media area; the **all-CSS
   mock treatment survives only as the documented no-thumbnail fallback** (see proof
   architecture).
3. **Stat line + play-by-play restored as distinct, visible elements** (an earlier draft
   buried them by fusing into the score). The stat line is its **own horizontal 6-cell
   strip** with box-score energy; the play-by-play is its **own titled day-by-day
   timeline** inside "What changed this week." **Coherence note:** because the wall is now
   real Nike products, the ticker, stat line and play-by-play were rewritten to reference
   those actual products (Air Monarch IV summer push, "Ball's in your court" colourway
   swap with a red-strikethrough diff, Sportswear Tee Shop-Now link, shin guards
   returning after a pause) — no phantom SKUs. Fabricated specifics (the 78 score, weekly
   counts) stay labeled "sample for this preview."

### Voice decision (per mandate)
Product / marketing-intel voice throughout — **not sports-announcer, not detective.** The
play-by-play reads as an analyst's weekly rundown: *what* happened, *when*, and *why it
matters* in one muted second line ("their steepest discount in 60 days — read it as a
volume push," "a margin move, not a discount"). That gives the reader an *edge* to act on,
which is the point, without either costume.

### Final section order (and why)
1. **Capture ticker** (brand-specific, mono, green timestamps) — motion before a word is
   read; "this is live and ongoing." Reused from landing.
2. **Hero — the verdict + the score card.** Left: mono freshness eyebrow (live dot +
   "Tracking nike.com · last checked 2 hours ago"), Bricolage verdict headline ("Nike ran
   3 new ads while you slept."), one-line subhead ending in an inked-highlight promise.
   Right: the **Aggression Score card** — 78 / ALL-OUT / four component bars /
   public-formula line (score ONLY now; stat line pulled out into its own section). *Why
   first:* the score is the "gasp" and it's honest.
3. **Primary CTA strip** (black band, green "Watch nike.com — free" button) — the
   domain-carrying conversion action, above the fold on most laptops, right when the score
   creates the itch.
4. **Stat line — "Nike, by the numbers"** — a distinct full-width **6-cell horizontal
   strip**, box-score energy: Ads live · New this week (green "hot" cell) · Longest run ·
   Formats · Split-testing · Offer changes. Each cell = big Bricolage number + mono
   caption + one muted context line. *Why here:* it's the quantified proof that backs the
   score, sitting between the score and the narrative.
5. **"What changed this week"** (eyebrow: THE REASON TO WATCH) — the **play-by-play
   day-by-day timeline** (Mon→Fri day badges, today's in green; each row: a diff/NEW/offer
   badge, a Bricolage one-line move with red-strikethrough price diffs, a muted "why it
   matters" line, a source tag). *Why this high:* monitoring is the retention loop;
   "what changed while you weren't looking" **is** the product promise.
6. **"All 34 ads, on the wall"** (eyebrow: RUNNING RIGHT NOW) — the creative grid (rich
   CSS-mock/real-thumbnail media, format tag, longevity pill, variant count, "Screenshot
   saved" chip), ordered longest-running → newest so proven runners land first.
7. **Closer** — full-width poster line ("Nike cut their price *last night.* Who told
   you?") + primary CTA repeated + secondary "run a live search first" + honest
   cache/coverage footnote. Echoes the landing's "LAST NIGHT" energy.
8. **Footer** — one honest line ("05:09 · the brief is filed before your alarm goes off").

### Type rhythm (faces / sizes / tracking per section)
- **Display — Bricolage Grotesque 800, uppercase, tracking −0.03em.** Hero H1 ~74px.
  Section H2 ~32px. Closer H2 ~52px. Score number 90px (−0.04em). Stat-line numbers 46px
  (−0.035em). Timeline "move" line: Bricolage **700**, ~16.5px. Ad-card titles: Bricolage
  **700**, ~18px (a step down from billboards). In-creative overlay headlines: Bricolage
  800 uppercase, white, text-shadow — these carry the "ad" energy.
- **Body — Inter 400/500.** Subhead 19px/1.5; ad hooks 13.5px; timeline "why it matters"
  13px; stat context line 11.5px.
- **Mono — IBM Plex Mono 500, uppercase, tracking +0.05–0.14em.** ALL labels: eyebrows,
  freshness stamp, day badges, timestamps, source tags, stat captions, format chips,
  "Screenshot saved" chips, formula note, footer. Mono = the evidence/label layer;
  Bricolage = the verdict/headline layer; Inter = the explanation layer. Never cross roles.
- One green highlight span per big headline maximum (hero, closer) — never two.

### The one accent rule (page chrome vs. inside-the-ad)
**Page chrome:** signal-green `#16C47F` is the ONLY accent, marking exactly (a)
live/fresh/positive-confirmation state (live dot, "Screenshot saved" chip, freshness
stamp, NEW badge, the green "hot" stat cell, score fill bars, today's timeline day badge),
(b) the one highlighted phrase per big headline, (c) the primary CTA fill. **Diff-red
`#E0442C` is NOT a decorative accent — strictly the removed/cut semantic** (price
strikethroughs, PRICE CUT badge, the ALL-OUT score stamp as a hot alarm). Ink = structure
(2–2.5px borders, black CTA band). No third hue in chrome; no gradients in chrome.
**Exception, scoped:** the **ad-creative media rectangles** may use full brand color
(Nike black/volt/orange/blue/etc.) — they mimic real ad thumbnails, which are full-color
by nature. That color is quarantined inside the `.thumb` media area and never leaks into
page chrome, labels, borders, or type. This mirrors production, where a real
`creativeImageUrl` photo sits in exactly that rectangle.

### CTA hierarchy (per scroll position)
- **Primary, everywhere:** `Watch {domain}` → `/auth/signup?redirectTo=/app/onboard?website={domain}`.
  Green fill, Bricolage. Appears at the hero strip (#3), as the "+N more ads live" wall
  tile (#6), and in the closer (#7) — **one action, same destination**, placed at the
  three natural decision moments (after the score, after seeing the ads, at the end). This
  is reinforcement of a single CTA, not the competing-CTA problem the audit flagged (which
  was *different* actions fighting). The wall tile doubles as honest overflow ("+29 more"
  = `teaser.totalCount` − shown).
- **Secondary, once:** `Run a live search first` → `/search?website={domain}`. Ghost/mono
  underline in the closer only.
- **No third CTA.** Nav "Open app" / "Sign in" are chrome, not page actions.

### Proof architecture (which claim ← which real field; and the cache-miss teach state)
Every number traces to a real field in the loader (`BrandPageLoaderData` /
`buildBrandIntelTeaser` / `aggression-score.ts`). Nothing invented; nothing implies a
capability the product lacks.

| On-page element | Real data source | If missing |
|---|---|---|
| Freshness eyebrow "last checked 2h ago" | `checkedAgo` (`formatBrandPageCheckedAgo`) | Null → render the teaching cache-miss state (below). |
| Aggression Score 78 + band + stamp | `aggression-score.ts` (needs ≥14-day window) | `< MIN_AGGRESSION_WINDOW_DAYS` / `not_enough_history` → **hide the score card, show "Not enough history yet to score — 14 days of watching required."** Never a score on thin evidence. |
| 4 component bars (22/19/20/17) | `AggressionScoreComponents` | Hide with the score. |
| **Stat-line cells** (ads live / active / longest run / formats / split-testing) | `teaser.totalCount` / `activeCount` / `longestRunningDays` / `formats` / share of `variantCount>1` | Render only cells with data; **drop empty cells** (grid reflows), never zero-stuff. If <2 cells survive, drop the whole strip. |
| Stat-line "New this week" (6/wk) | `facts.adsPerWeek` | Hide the cell if window too short. |
| Stat-line "Offer changes" (2) | count of confirmed offer/price change events in window | Hide the cell if no change history. |
| **Play-by-play timeline rows** (day · badge · move · why · source) | confirmed change events (monitoring diff records: type, timestamp, field, before/after, source) | No change history (new/uncached brand) → **hide the whole "What changed" section** rather than show an empty card. The "why it matters" line is a per-change-type template string, not a model inference — keep it factual. |
| Price-cut strikethrough ($159→$129) | before/after values on a price-diff event | Only render the strike when a real before-value exists. |
| **Ad-card media (the creative)** | **`AdRecord.creativeImageUrl` — the REAL creative image (primary path).** In the concept these are Nike's actual Ad Library JPEGs; in production it's the scraped thumbnail on `raw_json`. `object-fit:cover` in a 16:10 frame. | **No thumbnail → the CSS-mock treatment is the FALLBACK ONLY** (format-tinted backdrop + overlay headline from `previewHeadline` + format chip), so a card is NEVER a flat gray box or ghost text. |
| Ad-card copy (headline) | ad's **real primary/body text** (`previewHeadline` / body from the Ad Library card) | Fall back to advertiser + format if absent. |
| Ad-card destination chip | real link display domain (nike.com / play.google.com / itunes.apple.com) | Omit if unknown. |
| Ad-card longevity / ×variants | `AdLongevityPill` from "Started running on" date / `variantCount` ("This ad has multiple versions") | Longevity pill self-hides when first-seen unknown (already honest in `ad-longevity-pill.tsx`); "×N variants" hidden when `variantCount<=1`. |
| "Screenshot saved" chip / "New · 2h" | presence of a saved snapshot / `firstSeenAt` | Omit chip if no snapshot / not newly-seen. |
| "+N more ads live" tile | `teaser.totalCount` − cards shown | Omit tile if all cached ads fit on the wall. |

**Production note on creatives (important):** the rich media the builder ships is the
**real `creativeImageUrl`** (already on `AdRecord.raw_json`, added round-3) — the concept
proves this by embedding Nike's *actual* Ad Library creatives, not lookalikes. Implement a
`<AdCreative>` component: render the real image when present; render the CSS mock (backdrop
tint keyed to `format`, overlay `previewHeadline`, format chip, conditional play/dots for
video/carousel) **only when the image is absent**. This guarantees cards **never look
broken** — the point of Nish's fix — while the honest, on-brand default is always the
brand's real ad. (Video ads: use the poster frame as the image; the play affordance is the
fallback's cue, not a fake.)

**Cache-miss / empty state MUST TEACH (per intent audit SF-3 — no dotted apology).**
When `hasCachedAds` is false, do NOT render today's apologetic dotted card. Render the
**same poster shell with a taught preview**: keep the ticker + nav, a product-voice
headline ("We haven't watched {domain} yet — but here's what you'd wake up to."), then a
**greyed/blurred sample score card + one sample timeline row + a couple of CSS-mock ad
cards, all clearly labeled "Example"**, with the primary CTA "Run a free live search"
(→ `/search?website=`). Honest ("Example", noindex per the route's existing rules) and
teaching, not empty — WP-B2 applied to the public surface. **No case-file language here
either** ("We haven't watched…", not "We haven't opened a file…").

### Mobile behavior (per section; stack order + collapses)
- **Global:** single column < 900px; page never scrolls horizontally; 2–2.5px ink borders
  stay; the score card's 8px box-shadow offset drops to 3px < 600px.
- **Ticker:** unchanged (marquee); font 11px < 600px.
- **Hero:** score card stacks **below** the verdict headline (words hook first on a
  phone). H1 `clamp(38px, 11vw, 74px)`; subhead full-width.
- **Primary CTA strip:** flex → column; button full-width below the copy.
- **Stat line:** 6-col → **3-col** < 760px → **2-col** < 460px; keep "Ads live" +
  "New this week" (the green cell) in the first row; the internal borders switch from
  right-only to a full grid so cells stay boxed.
- **Play-by-play timeline:** 3-col (day / move / source) → stacked block per row — day
  badge becomes a mono kicker above the move; source tag drops to its own left-aligned
  line. No horizontal scroll.
- **Ad wall:** 3-col → **2-col** < 768px → **1-col** < 480px; creative media keeps its
  16:10 aspect ratio and overlay composition at every width (font-size of in-creative
  overlay headline clamps down so it never overflows the card).
- **Closer:** H2 `clamp(30px, 8vw, 52px)`; CTA row stacks, primary full-width, secondary
  ghost centered beneath.

### Whole-funnel note
The cache-miss teach-state and the two pages this links to (`/auth/signup`, `/search`)
must ship in the same "Caught in the act" system in the same PR series — a visitor who
clicks "Watch nike.com" and lands on an off-system signup breaks the spell.

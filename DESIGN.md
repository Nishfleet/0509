# Design brief — the 0509 rebuild

Umbrella #3842. Issue #3878. Author: the Opus deputy (design lead). Checked by Fable.
Decided by Nish: Direction A's structure (#3845), the old landing's visual language,
the five depth fixes, no free tier (#3896), and the feel — "stupid simple, flowy,
intuitive yet exhaustive, like iOS".

This replaces the old design document wholesale. The app that document described is
gone: `fa9d48aa4` emptied the tree and the rebuild is generated fresh — React Router 8
on Workers, Tailwind 4, shadcn/ui on Base UI. **No component, stylesheet, token file or
class name survives.** What survives is the *visual language*, restated below as values
and names so the new build can be made from this page alone.

Concept pages proving it: `docs/design-directions/a-final/` (landing, onboarding, Home,
competitor, alerts — rendered at 1440 and 390).

---

## 1. The rules that decide arguments

1. **One tap to anything.** Four places: Home, Competitors, Alerts, Settings. Everything
   else is reached by tapping a thing, not by navigating to a section.
2. **Depth by tapping in, never by more chrome.** A row that has more to say expands in
   place (desktop) or opens a sheet (mobile). It never sends you to a different page to
   find out why it said what it said.
3. **No dead ends.** Every claim on screen can be opened to the evidence that produced
   it: the capture pair, the ad, the post, the diff.
4. **No legends.** If a screen needs a key to be read, the screen is wrong. Series are
   labelled at the line's own end; states are labelled in words on the control.
5. **No forms.** The card is the form. Fields are edited in place, one action per screen,
   and back always works and loses nothing.
6. **One mark, everywhere.** A change is always the same object: the old value struck in
   red, the new value on a green marker, with a capture and a source. Landing, Home, row,
   alert, email — same object, different size.
7. **Honesty is a design element.** A degraded source says so on the row. A low-confidence
   judgment sits low and says "possibly". A paused brand shows the date it was paused.
   We never round a gap up into a clean number.
8. **The accent is one colour.** Green marker. Red exists only as the strike on a
   "before" and the rule on an open incident. Nothing else is coloured, ever.

---

## 2. Surfaces: section order and the first viewport

Above-fold composition is specified at 1440×900 and 390×844 — the two widths every
render is checked at.

### 2.1 Landing (`/`)

Order: ticker → header → hero (copy + live proof) → the mark → the live share image →
how it works → what we watch → price → footer.

**First viewport must contain, in this order:** who it is for (mono eyebrow), the
outcome (the display headline), one sentence saying what we watch, the one input with the
price on its button, the microcopy under it, and three real marks caught this morning —
one of which is the user's *own site*.

**The headline is one outcome in plain words and never contains the product name.** The
pattern is Dovetail's "Finally, all of your customer feedback in one place", Canny's
"Build the features that close deals", Visitors' "Fast, private, realtime web analytics"
and StackAI's "From process to AI agent, in minutes" — an outcome, or a from → to with a
time, never a description of the software. Ours: **"Know where you stand. And who's
gaining on you."** It states the outcome, it carries the creator positioning Nish wrote
("see where you stand, and who is gaining on you"), and it works for a company and a
creator without a second headline. The two runners-up, kept for a future test: "Your
brand, your rivals, the whole internet, every Monday" and "See where you stand against
the brands you compete with."

The sub is **one sentence**: what we watch (ads, mentions, site changes, hiring) and that
we name the rivals so you do not have to know them. Under the CTA, one line of microcopy
in the Canny pattern ("No credit card required" → ours: **"One input. Sixty seconds to
your first standing."**). No exclamation marks anywhere on the page.

- Hero is a two-column grid at ≥1080px (1.15fr copy / 0.85fr proof), stacked below.
- The proof column is live data from a public workspace we run ourselves, re-rendered
  weekly (the share image, §2.8). It is never sample data and never says "sample".
- "What we watch" is a wrapped pill row, not a card grid. Sources we cannot currently
  reach are shown dimmed with the reason, on the landing as in the app.
- Exactly one filled button per viewport. The section CTA repeats the hero's.

### 2.2 Sign in (`/login`)

One screen, centred, max 420px. The wordmark, one line of what happens next, one email
field, one button ("Email me a link"), and "use a passkey instead" as the quiet second
action. No password field exists. No social-proof, no marketing, no second column.

After submit the same screen becomes the sent state in place — it does not navigate.
The sent state says which address, how long the link lasts, and offers one "send it
again" that is disabled for 30 seconds with the count visible.

### 2.3 Onboarding

Three screens, each one action, per `docs/REBUILD-ONBOARDING.md`. A mono step bar with
the current step on the marker runs across the top of all three.

1. **One input.** Placeholder "your website, or a handle". Nothing else on screen.
2. **Your card.** The heading is "This is you. Fix anything we got wrong." The card
   draws itself field by field as each source lands — each row that has not arrived yet
   says what will fill it ("logo: looking on the site"), never a spinner and never a
   skeleton block. Fields Jev was unsure about (D7 between) sit on the green wash and
   read "check this". Every row is tap-to-edit. One action: "That's me".
3. **Who you're up against.** Accepted competitors (D1 p ≥ 0.9) listed ON with a
   one-line reason each; maybes below on the bone ground, off, with Jev's reason and its
   probability. "Add one we missed" is the same one input, inline, at the bottom of the
   list. One action: "Start watching — €10/mo".

First viewport of screen 2 at 390 shows the card header and the first four fields. First
viewport of screen 3 shows the heading and three candidates.

### 2.4 Home

Order: greeting → **Read this first** → chip row → four-week standing → ranked rows →
footer line.

**First viewport (1440×900):** the date eyebrow, the greeting with the rank on the
marker, the why-line, and the first of the three read-this-first marks complete with its
capture. At 390 the fold ends inside the first mark — that is deliberate: the first thing
a phone shows is one real thing that happened, not a summary of summaries.

- **Greeting.** `Good morning. You're #2 of 6 this week.` — rank on the green marker.
  Under it, the why-line from `docs/REBUILD-STANDING.md` (D4's top reason), including the
  consequence of any paused brand so a jump is never a mystery.
- **Read this first.** Three items, chosen by Jev D4, each a full mark: capture plate,
  brand and source pills, age, the struck-and-marked line, the take, and the Jev verdict
  line in mono (question id, p, reason). An own-site item, when there is one, is first and
  sits on the green wash. The block header carries the honest denominator: "3 of 41
  noteworthy · picked by Jev".
- **Chip row.** You first with the accent monogram, then each competitor, off brands
  dashed and dimmed, then "+ Add a competitor". Tapping a chip goes to that brand.
- **Four-week standing.** One line per ON brand, rank 1 at the top, yours drawn as an
  ink line over a green marker band so it reads as "you" without a legend. Every line is
  labelled at its own right end; yours is labelled `YOU` on the marker. A brand that went
  off ends its line at the pause with the word "paused" — it does not fall to zero.
  X axis: four week-start dates in mono caps.
- **Ranked rows.** Each row is: position, monogram, name and domain, movement, the
  switch — then, underneath, *that brand's own before-and-after mark for the week's
  biggest move*, a "Why it moved" sentence, and the source pills for where the week's
  noise came from. A source that produced nothing is shown dim ("Reddit — none"); a
  source that is failing is shown dim with "degraded".
- **Expansion.** Tapping a row expands it in place, revealing type tabs (Site changes /
  Ads / Mentions / Hiring with counts) over the week's evidence rows, each with its
  capture. The expanded row is marked by a 4px accent bar on its left edge. Nothing
  navigates.
- **Your own row** sits in rank order like any other, on the green wash, with the switch
  disabled and labelled "You".
- **Footer line**, mono: what was checked, when the brief comes, when the own-site
  re-check runs.

### 2.5 Competitor page

Order: breadcrumb → identity and switch → six-cell snapshot → the week's biggest move →
developments feed (with type chips) → peers rail → facts → sources → "still a competitor?".

**First viewport:** the name, the tracking switch with its consequence spelled out
beside it, the snapshot row, and the top of the biggest-move slab.

- The switch is the first interactive thing on the page and it is never a menu item.
  Next to it, always: "Off stops the watching and the alerts. The history stays, and
  turning it back on picks up where it left off."
- Developments are chronological and mixed by default, filtered by the type chips
  (All / Ads / Site changes / Mentions / Hiring, each with its count). Ads, site changes,
  mentions and hiring are *filters on one feed*, not four tabs with four layouts.
- Right rail at ≥1080px, stacked underneath below that: Peers (the standing, tappable,
  off brands dimmed), Thirty days (facts), Sources on this brand (live/degraded pills
  with the reason), and Jev's last "still a competitor?" verdict with its date and p.
- An OFF brand's page renders identically, with the switch off, a line under the title
  saying when it was paused, and the feed frozen at the pause date with a rule across it.

### 2.6 Alerts

Order: heading → open own-site incident (if any) → type chips → day-grouped rows.

**First viewport:** the heading, the one line that explains the page's contract ("One
thing here interrupted you by email: your own site"), and the open incident if there is
one.

- **The incident block** is the only element in the product that carries red: a 5px red
  offset shadow, an "OPEN INCIDENT" tag, the mark, what we did, when we re-check, and two
  actions — "Open your site →" (the own-site probe takes no screenshot, so the live page is the evidence) and "I meant to do this". It stays pinned until
  acknowledged or closed.
- **Type chips**: All, Site changes, Ads, Mentions, Hiring, Your site — each with a count.
- **Rows** follow the notification pattern Deel, Qatalog and Fireflies use: the **first
  line, in display bold, is who did what** — "Bramble changed its pricing", "Kindred
  started selling on price", "Fieldset posted two growth roles". Then the mark where there
  is one, then **one plain sentence** of context, then the source pill and the relative
  time. Never a question id, never a probability, never a confidence label.
- **Grouping** is **New / Yesterday / Earlier**, as mono day markers — not calendar dates.
  A row moves from New to Yesterday on its own; nothing is marked read by hand.
- Low-confidence items sit on the bone ground rather than the card and say so in words
  ("We were not sure this mattered, so it sits here rather than in your brief"), with
  "Why we flagged this" behind a tap. They are never deleted.
- Off brands produce nothing here. The footer line says so by name, so an absence is
  never mistaken for a failure.

### 2.7 Settings

Three settings and nothing else (`docs/REBUILD-DELIVERY.md`), as three ruled rows, each
edited in place:

1. Brief day, time and timezone, and **Pause the brief** / **Resume the brief** (paused: "Paused since <date>. Your ranking still updates; the email doesn't come.").
2. Immediate alerts for your own site — on (default) / off.
3. Delivery email address.

Then **"Connect your agent"** (§2.11) as its own block: the MCP server row with the URL,
its own switch and the Claude / Cursor / ChatGPT pills, and the API key row with the
masked key, "Rotate", and the last-used line.

Under both, quiet rows that are **not** settings, set in the body face rather than the
display face so they read as information: the plan with its price and one "Change plan";
"Suggestions you dismissed" with the count and a way back; and "Delete everything" with
exactly what it removes. Per-brand tracking is **not** repeated here — it is the same
switch that lives on the brand, and the page says so in its opening line.

### 2.8 The share image

No public card page (Nish, 2026-09-24). The owner shares a picture, made from Home in the
signed-in app, the way Spotify shares work: the brand's monogram and name, the rank line
with the rank on its green marker, the week label in mono, and the `05|09` wordmark with
`0509.io`, on the real cream ground. No competitor names, no captures, no marks, no counts
table. Per `docs/REBUILD-STANDING-CARD.md`.

**It is a square composition (`app/components/share-image.tsx`) drawn with the same tokens,
fonts and built stylesheet as Home**, screenshotted by Cloudflare Browser Rendering at
1080x1080 on demand when the owner taps **Share my rank**. No second renderer, no second
stylesheet, no hand-maintained SVG twin. On a phone the share sheet opens with the image;
elsewhere it downloads.

---

## 2.10 Machinery the user never sees

Jev is how the product decides; it is not how the product talks. **No customer surface
ever shows a question id, a decision code, a probability, an importance score or the word
"Jev" as a system.** This applies to Home, Competitors, Alerts, the brief and the share
image.

| Never | Instead |
|---|---|
| `Jev D3 noteworthy p 0.94, kind: pricing` | "Our read: a real price move, not a test — it is live for everyone and it is their deepest discount yet." |
| `Jev D3s own_site_breakage p 0.81` | "Our read: this looks like a mistake, not a decision — a conversion page lost its only button and nothing replaced it." |
| `Jev was unsure at p 0.42` | "We were not sure this mattered, so it sits here rather than in your brief." |
| `D4 importance 8.6` | (nothing — it decides the order, it is not shown) |
| "3 of 41 noteworthy · picked by Jev" | "3 of 41 worth knowing" |

Every one of those plain lines carries a **"Why we flagged this"** tap beneath it: a
small mono link that opens a sheet with the evidence, what was compared, the confidence,
and the decision that was made. The machinery is one tap away and never in the way —
this is the "depth by tapping in" rule applied to our own reasoning.

Written as "our read", not "the AI thinks". The product did the work; it says what it
concluded.

---

## 2.11 Agent-native

**Everything a person can see on Home, Competitors and Alerts is available to an agent
through the same API, at the same moment.** Not an export, not a subset, not a delayed
feed — the same reads. This is a product property, so it gets surface in three places:

1. **Settings → "Connect your agent"** (§2.7): the MCP server URL with a copy action, a
   read-only API key shown once and rotatable, the last-used line ("Last used 11 minutes
   ago by Claude"), a link to the API docs, and one row of what it works with —
   **Claude, Cursor, ChatGPT**.
2. **Landing → "Built for your agents too"**: one short section, the same three names,
   the MCP URL, an example question an agent can answer from it, and "Read the API docs".
   Reference: Bloom's "Connect MCP" row. It sits between "What we watch" and the price.
3. **The API docs**, linked from both, never embedded.

Rules: the key is read-only and shown once; rotating breaks the old key immediately and
says so; the MCP server has its own switch so it can be turned off without deleting the
key; agent reads count toward nothing the user pays per-unit for. The three names are set
as **mono pills, not logos** — we do not use another company's mark to borrow credibility.

---

## 3. Typography

The faces, read off the old landing's stylesheet before the wipe
(`git show 668d2452c:app/app.css`, `--ld-display` and `--ld-mono` at line 2483):

| Role | Face | Weights | Use |
|---|---|---|---|
| Display | **Bricolage Grotesque** (variable, `opsz 12..96`) | 700, 800 | Every heading, the rank, the mark, brand names, button labels. **Caps for h1 and h2.** |
| Body | **Instrument Sans** | 400, 500, 600 | Sentences, takes, descriptions, table text |
| Mono | **IBM Plex Mono** | 400, 500, 600 | Eyebrows, source pills, ages, counts, ids, Jev verdict lines, axis labels |

Bricolage Grotesque at 800 is the "heavy black grotesk" Nish picked. It was already the
old landing's display face, so this is continuity, not a new choice. **Inter is gone**:
it was the old body face and it is exactly the system-font sameness the anti-AI rule
bans. Instrument Sans replaces it — narrower, denser in tables, and it carries no
dashboard-template associations. This is the one face the brief chooses rather than
inherits, because Nish reserved display, eyebrow, accent and strike, not body.

The faces are self-hosted under `public/fonts/` — no Google `<link>`, no preconnect.
Latin subset, `font-display: swap`, three families, served from the app's own origin.
**Scale** (rem, 16px root). Display sizes are fluid; the clamp is given, not the endpoints.

| Token | Size | Line height | Tracking | Where |
|---|---|---|---|---|
| `display-1` | `clamp(2.35rem, 4.6vw, 4.1rem)` | 1.04 | −0.045em | Landing h1, caps |
| `display-2` | `clamp(1.8rem, 4vw, 3rem)` | 1.04 | −0.04em | Home greeting, competitor name, caps |
| `display-3` | `clamp(1.7rem, 3.6vw, 2.8rem)` | 1.06 | −0.035em | Landing section h2, caps |
| `mark-lg` | `clamp(1.4rem, 3.4vw, 2.5rem)` | 1.1 | −0.02em | The mark on landing and the biggest move |
| `mark-md` | `clamp(1rem, 1.9vw, 1.45rem)` | 1.1 | −0.02em | The mark in read-this-first, incidents |
| `mark-sm` | `1rem` | 1.1 | −0.02em | The mark on a ranked row or an alert |
| `title` | `1.15rem` | 1.1 | 0.02em | Block headings, caps |
| `row-name` | `1.02rem` | 1.2 | −0.015em | Brand name on a row |
| `body` | `1rem` | 1.55 | 0 | Sentences |
| `body-sm` | `0.88rem` | 1.5 | 0 | Takes, feed copy |
| `eyebrow` | `0.72rem` | 1.4 | 0.16em | Mono, caps |
| `pill` | `0.66rem` | 1.3 | 0.08em | Mono, caps |
| `meta` | `0.68rem` | 1.4 | 0.06em | Mono ages, ids, Jev lines |

Rhythm: vertical spacing is a 4px base — 4 / 8 / 12 / 16 / 22 / 30 / 40 / 64. Block
headings get 30–40 above and 14 below. Rows are 15–18 of internal padding with a 1px
hairline between, never a gap, never a shadow, never a rounded corner. **Radius is 0
everywhere.** Borders are 1px hairline inside a component and 1.5px ink on its outer edge.

---

## 4. Colour

Values carried from the old landing's `:root` (same commit), re-declared here as the
rebuild's own tokens. Tailwind 4 `@theme` in one stylesheet; no second source.

### Light (default)

| Token | Value | Use |
|---|---|---|
| `--bone` | `#f4f1e8` | Page ground. Cream, never white |
| `--card` | `#fffdf6` | Raised surface: cards, rows, rails |
| `--ink` | `#0e0d0a` | Text, borders, the filled button. Near-black, never `#000` |
| `--ink-soft` | `#55524a` | Secondary text, thin chart lines. 6.3:1 on bone |
| `--ink-faint` | `#8e8878` | Hairline text, axis numbers, disabled. **2.9:1 — decorative only** |
| `--line` | `#ddd6c6` | Hairlines, gridlines |
| `--green` | `#16c47f` | **The accent.** Marker fill, on-state track, "you" |
| `--green-ink` | `#064d31` | Text on the green wash. 8.7:1 on wash |
| `--green-wash` | `#d9f6e8` | Own-site and "you" ground |
| `--red` | `#e0442c` | The strike on a "before", the incident rule. **Nothing else** |
| `--on-green` | `#0e0d0a` | Ink on the marker. 8.6:1 |

### Dark

Declared under both `@media (prefers-color-scheme: dark)` scoped to
`:root:not([data-theme="light"])` and `:root[data-theme="dark"]`.

| Token | Value | Note |
|---|---|---|
| `--bone` | `#14130f` | Warm near-black, never `#000` |
| `--card` | `#1c1a15` | |
| `--ink` | `#f2efe4` | Warm off-white, never `#fff` |
| `--ink-soft` | `#a9a294` | |
| `--ink-faint` | `#7b7568` | |
| `--line` | `#322e25` | |
| `--green` | `#2ee59c` | Lifted: the light green is too dark to carry ink at this ground |
| `--green-ink` | `#9ff0cd` | |
| `--green-wash` | `#10281f` | |
| `--red` | `#ff7a63` | Lifted for the strike to read |
| `--on-green` | `#0e0d0a` | Ink stays dark on the marker in both themes |

### Colour rules

- **One accent.** If a second hue appears anywhere, it is a bug. Movement up is
  `--green-ink`; movement down is `--ink-soft`, not red. Down is not bad news.
- **`--red` is the strike and the incident rule only.** It is 3.6:1 on bone, which is
  enough for a rule and a large mark and **not** enough for body text. Never set body
  copy in red.
- **The struck "before" is `--ink-soft`, not `--ink-faint`.** The old landing used the
  faint token there at display size and landed at 2.9:1, just under the 3:1 large-text
  floor. Fixed here deliberately; do not restore it.
- **`--ink-faint` never carries meaning** — axis numbers, disabled state and hairline
  furniture only, always with the same information available in text elsewhere.
- Source pills are never colour-coded by source. A pill turns green only to mean "live"
  and dims only to mean "nothing" or "degraded".

---

## 5. CTA hierarchy

1. **Primary** — filled ink, square, display 700, one per viewport. Always a verb.
   **The price is on the button** wherever the action starts or changes a subscription:
   `Start watching  €10/mo`. List prices from the ledger, localized at checkout by
   Dodo: **Scout €10/month, Starter €46/month, Agency €136/month.** There is no free
   plan and no "free" anywhere in the copy (#3896). **Trial copy is decided** (Nish,
   2026-09-22, #3912 item 2): every paid plan carries a 7-day trial through Dodo, card up
   front, charged on day 8 unless cancelled. Say exactly that. Never "try it free": there
   is no free plan.
2. **Secondary** — ghost: ink hairline, transparent, green wash on hover. Reserved for
   the alternative to the primary ("See the live card", "I meant to do this").
3. **Tertiary** — mono caps, underlined, no box. In-feed actions: "See the three ads →",
   "Open the capture pair →".
4. **Inline** — tap-to-edit fields, chips, switches. No button chrome at all.

A plan gate appears only when a paid thing is asked for, in place, with the price on the
button and one line saying what it unlocks. Never as an interstitial, never as a banner.

---

## 6. The per-brand switch

One control, everywhere, with the same three states. 38×22, square, ink hairline, ink
thumb, 180ms travel.

| State | Track | Thumb | Label | Row treatment |
|---|---|---|---|---|
| **On** | green fill | right | `ON` | normal |
| **Off** | card fill | left | `OFF` | row dimmed to `--ink-faint`, monogram hairline goes `--line`, chip becomes dashed, sub-line reads "paused <date> · history kept" |
| **You** | green wash, disabled | right | `YOU` | row on green wash; the control is visible but not operable |

A **dismissed** suggestion is not a switch state — it leaves the list entirely and is
recorded so it is never suggested again. Dismissal is undone only from Settings →
"suggestions you dismissed", which is a list, not a setting.

Turning a brand off never asks for confirmation: it is reversible, and the consequence is
printed next to the control before it is touched.

---

## 7. Empty states

Never "No data". Every empty state says **what will fill it and when**, or gives the one
action that fills it.

| Where | Copy |
|---|---|
| Home, second zero | "We're gathering the first week. Your first read-this-first lands by 14:20 today; the brief comes Monday 08:00." (a real Workflow time, never "soon") |
| Read this first, quiet week | "Quiet week. 61 mentions, 2 site changes and no new ads checked — nothing crossed the bar." with the counts tappable |
| Fewer than two ON brands | "Add a competitor to see where you stand." with the one input inline |
| A row's evidence tab with nothing | "No site changes this week. We checked /pricing and /home daily — last at 06:02." |
| Competitor page, just added | "Watching from today. The first ads and mentions land within the hour; site changes need a second snapshot, so the first mark comes tomorrow." |
| Alerts, nothing yet | "Nothing has interrupted you. When your own site breaks you'll get an email; everything else waits here." |
| A degraded source | "X has been rate-limiting us since Friday. We show it as degraded rather than pretend the count is complete." |

**A chart with one week of data is never hidden.** It renders with its single point and
the line labelled "first week". This is the rule the other empty states are a special case
of: a surface that has *some* truth shows that truth at whatever size it is, because
hiding it teaches the user the product is not running. Applies to the standing chart on
Home and in the share image.
| Identity card, field pending | "logo: looking on your site" / "we'll fill this on the first crawl, within the hour" |

---

## 8. Mobile

Breakpoints: `1080px` (rails and hero collapse to one column), `860px` (app shell becomes
single column, rail becomes the bottom tab bar).

- **Bottom tab bar** below 860px: four equal cells, ink hairline top, card ground,
  `env(safe-area-inset-bottom)` padding, mono caps labels with a 5px state dot. Fixed.
  Content gets 92px of bottom padding so nothing hides behind it.
- **Row expansion is a sheet**, not an in-place expansion: it slides up from the bottom,
  85% height, ink hairline top edge, dragged or tapped away. The row stays where it was.
- **No horizontal scroll at 390.** `html, body { max-width: 100%; overflow-x: hidden }`
  is the safety net, not the mechanism: every grid child carries `min-width: 0`, every
  chip and pill row wraps, long names get `text-overflow: ellipsis`, long URLs get
  `overflow-wrap: anywhere`. Verified by measuring `documentElement.scrollWidth` against
  `clientWidth` on every render, not by looking at a screenshot.
- **Capture plates shrink** from 104×74 to 76×56 rather than dropping out. The evidence
  never disappears on a phone.
- **Identity-card fields** restack to label-above-value below 860px.
- Tap targets are 44px minimum; the switch's hit area extends to its label.

---

## 9. Motion budget

Only what iOS does: **push, sheet, fade.** Nothing else exists.

| Motion | Duration | Curve |
|---|---|---|
| Push (navigate into a brand) | 320ms | `cubic-bezier(.32,.72,0,1)` |
| Sheet up / down | 380ms / 280ms | same |
| Row expand in place (height + fade) | 220ms | same |
| Switch thumb and track | 180ms | same |
| Fade in of an arriving field or row | 160ms | `linear` |
| Button press | 140ms | `cubic-bezier(.32,.72,0,1)`, 1px lift only |

Rules: nothing bounces, nothing scales, nothing parallaxes, nothing auto-plays, no
skeleton shimmer (a pending field says what will fill it in words instead). Onboarding's
card fills field by field as data lands — that is real progress, not a staged animation.
The landing ticker is the single looping element in the product and it stops under
`prefers-reduced-motion`, which disables every transition and animation globally.

---

## 10. Performance budget

Numbers, measured on production, failing the build of a surface that misses them.
The bar exists because the old landing served in 4.50s (#3842, 2026-09-21 14:50 IST).

| Budget | Limit |
|---|---|
| LCP, landing and Home, simulated 4G | **< 1.5 s** |
| Home JavaScript, gzipped | **< 150 KB** |
| Chart library, gzipped, on the Home route | **< 30 KB** |
| Home loader, p95 over 100 loads | < 500 ms |
| Console errors, any of the seven screens | 0 |
| Horizontal overflow at 390 | 0 px |
| CLS | < 0.05 |

How each is kept:

- Fonts: self-hosted under `public/fonts/` — the exact latin files Google's css2 API
  served for the project link, OFL — so the display face fetches in parallel with the
  CSS from the app's own origin instead of behind a two-host render-blocking chain.
  `font-display: swap` stays. The landing route preloads the display face, which is the
  LCP element's face.
- The chart is the only client library on Home, and it is **uPlot**. It is maintained,
  it is a line chart library rather than a chart framework, and it lands comfortably
  inside the 30 KB gzipped budget where a React chart framework does not. **Recharts is
  out** — it ships well past the budget even when tree-shaken — and so is a hand-rolled
  inline SVG chart, which is glue by another name. The four-week standing line is a uPlot
  line chart, styled entirely from the tokens in §4: `--ink-soft` hairlines for the other
  brands, the accent marker band under an ink stroke for "you", `--line` gridlines,
  mono axis labels. Measure the route's gzipped cost before it ships; do not assume it.
- Captures are R2 objects served through Images with explicit `width`/`height` and
  `loading="lazy"` below the fold; the first read-this-first plate is eager.
- No client-side data fetching: React Router loaders own every read, so Home is one
  request. Row expansion uses data already in the loader payload.

---

## 11. Component map

Everything below is shadcn/ui on Base UI primitives, copied into the repo as source we
own. **Nothing in the right column is hand-rolled.** Versions are the ones the audit
pinned on 2026-09-20; `docs/REBUILD-STACK.md` was deleted in the wipe and is being
re-issued, so the library names and versions are restated here as the contract.

| Our thing | Built from | Notes |
|---|---|---|
| Four-place nav (rail + tab bar) | `navigation-menu` + React Router `NavLink` | One component, two layouts by breakpoint |
| Ranked row | `collapsible` | Expansion in place; open state is a URL param so a row survives reload |
| Row expansion on mobile | `drawer` (Base UI dialog, bottom side) | The sheet |
| Type chips / source filters | `toggle-group`, single and multiple | Counts are children, not badges |
| Brand chips | `badge` + `avatar` | Avatar carries logo.dev with the monogram fallback |
| Per-brand switch | `switch` | The label is part of the control's hit area |
| The mark | our composition of `<s>` + `<ins>` on tokens | Semantic HTML, not a component; it appears at four sizes |
| Capture plate | `aspect-ratio` + `img` | Opens `dialog` for the before/after pair |
| Four-week standing chart | **uPlot** | Line chart only, styled from the tokens. Recharts and hand-rolled SVG are both out — see §10 |
| Snapshot cells, facts | `card` with dividers | Never a stat "tile" with a shadow |
| Identity card fields | `popover` + `input` for tap-to-edit | No `form` wrapper, no labels above fields |
| Competitors list, alerts feed | `@tanstack/react-table` 9.2.4 headless + our row | Headless only; no themed table library |
| Developments feed | plain list + `toggle-group` | Chronological; filters do not change the layout |
| Incident block | `alert` | The only red in the product |
| Settings rows | `card` + `switch` + `select` + `popover` | Three settings, then the agent block, then the quiet rows |
| Key / URL with copy | `input` readonly + `button` + `tooltip` | Never a custom clipboard widget |
| "Why we flagged this" | `drawer` on mobile, `popover` on desktop | The machinery, one tap away |
| Sheets, dialogs, tooltips, menus | `dialog`, `sheet`, `tooltip`, `dropdown-menu` | Base UI 1.8.0 under all of them |
| Toasts | `sonner` | Only for "saved" and "undo"; never for alerts |
| Share image | **Cloudflare Browser Rendering**, screenshotting `app/components/share-image.tsx` at 1080x1080 | One design, not a twin. See §2.8 |
| Icons | `lucide-react` 1.47.0 | Sparingly: the product's vocabulary is type, not icons |
| Class merging | `cn` 0.3.0 | |
| Any input that validates | **TanStack Form 1.33.5 + zod 4.6.5** | The same schema parses `formData` in the action |
| Tokens | **Tailwind 4.3.3** `@theme` in one stylesheet | No `tailwind.config.ts` theme, no `@apply` component classes |

Rules: no component gets a variant that changes its meaning; a new surface composes
existing components or the surface is wrong. If something here needs to be hand-built,
that is a decision for Fable, recorded in the PR, not a silent divergence.

---

## 12. Open decisions (not taken here)

These need Nish, and the brief deliberately stops rather than picking:

1. **The name.** Three concepts rebranded the product to "Five to Nine"; the charter says
   rebuild in place and says nothing about a rename. The concept pages use the `05|09`
   wordmark, which works for either answer. Unresolved.
2. **A trial.** Decided 2026-09-22 (#3912 item 2): a 7-day trial on every paid plan through
   Dodo, card up front, charged on day 8 unless cancelled. No free tier. Landing and pricing
   copy say so (#4014, #4132).
3. **The landing's sample brand.** The live share image needs one recognisable brand
   with active public competition, in a workspace we own. Not chosen.

---

## 13. Voice

Unchanged from the previous document and still binding. The product speaks like a sharp
colleague who did the work — confident, specific, plain words, lightly warm, zero
hedging, zero jargon-as-authority. It watched the ads, read the pages and took the
screenshots; the copy should sound like the person who did that, not the system that
scheduled it.

1. **Verbs over nouns.** "We checked 24 ads", not "24 ads were checked".
   The product does things; say so in active voice.
2. **Name the thing.** "Screenshot", not "evidence artifact". "Check", not
   "scan operation". Exception: where the proof vocabulary is load-bearing —
   *evidence checks* as a billing unit, *proof* on billed surfaces — keep the
   precise term, because it maps to what the customer pays for.
3. **No exclamation marks in the app.** Confidence is quiet. (Marketing
   surfaces may earn one; the workspace never.)
4. **Sentence case** for body copy, buttons, labels, and headings inside the
   app. Title Case is reserved for proper nouns (Meta Ad Library, Competitors).
   The display face is set in caps as a typographic treatment; the underlying
   copy is still sentence case.
5. **Empty states always say what happens next.** Never a bare "No data".
   State what will fill the space and when, or give the one action that fills it.
6. **Errors say three things:** what happened, what we're doing about it, and
   what you can do. In that order, in plain words.
7. **Never blame the user.** "We couldn't read text off this creative", not
   "Invalid input". The system explains itself; it doesn't scold.
8. **Buttons start with a verb.** "See ads", "Track this competitor",
   "Send test email". Never "Submit". Never a bare noun when a verb fits.
9. **No system-speak in customer surfaces.** "Waiting for a monitoring
   worker", "queued for dispatch", "resolve", "workspace readiness gaps" —
   these belong in ops logs, not in the product. Say what it means for the
   customer: "in line to run", "we're retrying", "a few things left to set up".
10. **Specific beats generic, everywhere.** Email subjects lead with the
    competitor or the number, not with the product name. "Nike added 3 new
    ads" beats "Your watchlist digest".
11. **Honesty is untouchable.** Voice changes tone, never facts. A claim that
    was carefully scoped ("no confirmed changes", "demo data — sample results")
    keeps its exact meaning after any rewrite.

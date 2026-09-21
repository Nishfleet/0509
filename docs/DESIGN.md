# DESIGN.md — the rebuild brief

**Direction A "The Morning File" structure in the existing 0509 landing skin.**
Nish's pick (#3845, final comment): keep A's structure — greeting with rank, chip
row, one chart, ranked rows with the per-brand switch, four-place nav, the calm —
wearing the shipped landing's visual language instead of A's. Umbrella #3842;
build packet #3878. The judgment bar (#3842 addendum): **stupid simple, flowy,
intuitive, yet exhaustive, like iOS — one tap to anything, depth by tapping in,
no legends, no forms.**

Proof renders live in `docs/design-directions/a-final/` (landing, home,
competitor at 1440×900 and 390×844). Nothing here is production code; this file
is what the rebuild builds to.

Voice carries over unchanged from the ratified rules in `/DESIGN.md` (verbs over
nouns, no exclamation marks in the app, empty states say what fills them and
when). This brief replaces the layout, type, colour, and component language only.

---

## 0. The skin — where it comes from

Every token below is read out of the shipped landing, not invented:

- Tokens: `app/app.css` `:root` (`--bone`, `--card`, `--ink`, `--ink-soft`,
  `--ink-faint`, `--line`, `--green`, `--green-ink`, `--green-wash`, `--red`,
  `--red-wash`) and the `[data-f9-theme="dark"]` overrides (app.css:6722).
- Display face: `--ld-display` = **Bricolage Grotesque** (app.css:39), loaded in
  `app/root.tsx:157` at opsz 12..96, weights **600/700/800** — 800 is the
  hero type-wall weight.
- Data/eyebrow face: `--ld-mono` = **IBM Plex Mono** 400/500/600 (app.css:38,
  root.tsx:157).
- Mark mechanics: `.ld-wall` (caps type wall), `.ld-del` (muted before-value
  with the rotated red strike bar), `.ld-ins` (green marker fill on the new
  value), `.ld-flag` (tilted ink annotation pill), `.ld-change-mark`
  (`<s>`→`<ins>`), `.ld-command` (the 2.5px-ink command input), `.ld-kicker`
  (mono eyebrow), `.ld-step` (green-wash mono chip) — app.css:2626–3042.

Body face: the landing's literal body is Inter 400–700 (root.tsx:157) and this
packet bans Inter. The brief picks **Instrument Sans** 400/500/600/700 — it was
Direction A's own body face and is the body of REBUILD-STACK §3 pairing A, so
this is the lowest-drift sanctioned fill. If Nish wants a different body it is
a one-line font link; everything else is untouched by the choice.

The one accent rule, restated plainly: **green is semantic, not decorative.** It
marks the new value in a before/after mark, your own line/row/chip, live states,
and focus rings. Buttons are ink. Nothing else is green. Red means one of two
things only: the struck "before" value, or a your-site flag that needs a human.

---

## 1. Section order and above-fold composition

Nav is four places, always: **Home · Competitors · Alerts · Settings.** Slim
left rail ≥861px, bottom tab bar ≤860px. No legends anywhere — charts label
their own lines; no forms beyond a single input.

### Landing (`/`)
1. Top bar — wordmark, three anchor links, "Sign in".
2. Hero — mono eyebrow, caps type wall ("Watches you across the internet. Tells
   you where you stand." with the green marker on the payoff phrase), one-line
   sub leading with "You, and your competition.", the command input
   (`yourwebsite.com` + "Build my watch →"), one-line honesty note. The whole
   pitch fits the first viewport.
3. **Caught change** — the before/after mark with its captured screenshot, one
   competitor variant and one your-site variant side by side. This is the
   product's whole idea in one element.
4. **This morning's file** — the slab preview of Home's digest rows.
5. How it works — three numbered steps (green-wash mono chips).
6. What we watch — source pills, ads family tinted.
7. Final CTA — "One input. One file a day." + command input again.
8. Footer.

### `/login`
One centered card on the cream ground, nothing else: wordmark, one email input
in the command pattern, "Email me a sign-in link", mono footnote "no password —
the link signs you in", Google/Microsoft OAuth row below the rule. The whole
flow is one field and one button; error states use the voice rules.

### Onboarding (one input → identity card → competitors)
A single forward flow, three states of one screen — never a form:
1. **The input** — the same command bar as the landing, pre-filled if the user
   arrived through it.
2. **Identity card** — "Here's who you are" card assembled from the domain
   (name, what you sell, who it's for, voice words) with inline edit affordance
   per field; status line "shaping your workspace…" while building.
3. **The set** — "Here's who you're up against": auto-populated competitor
   rows, each with its switch on; dismissible with one tap; primary CTA
   "Start watching". Anything uncertain is marked `Check` and is one tap to fix.

### Home (`/app` — the morning file)
1. Greeting header — mono date eyebrow, caps greeting with your rank in the
   green marker ("Good morning — you're #2 of 6 this week."), one-line "who
   moved" summary.
2. **Read this first** — the three things that matter this week, picked with
   full context, each a before/after mark + captured screenshot + why-it-matters
   line. Leads with a site-change mark when one exists; a your-site flag
   (red border, `unintended?`) outranks competitor news when something looks
   broken.
3. Chip row — you-chip (green-wash) + competitor chips + off chips dimmed +
   dashed "Add a competitor".
4. **The last four weeks** — one standing line per brand, yours in the accent,
   paused brands dashed; end labels instead of a legend.
5. **The week, ranked** — one row per brand: position, monogram, name +
   movement, the week's biggest move as a mini before/after mark, one-line "why
   it moved", per-brand source pills, the tracking switch. Rows expand **in
   place** to the week's evidence (ads, site changes, mentions, hiring, each
   with its screenshot) — no dead ends.
6. Ghost row for dismissed brands ("out of your set · Undo").
7. Footer line — development count + when the weekly brief lands.

### Competitor page (`/app/competitors/<brand>`)
1. Crumb back to Competitors.
2. Identity — monogram, caps brand name, domain + "tracked since" mono, and the
   single obvious tracking switch (large) with the "off keeps the history" note.
3. Snapshot strip — rank this week, movement, mentions, new ads, site changes
   (Bricolage numerals, mono labels).
4. Latest developments — chronological feed; changes render as marks with the
   captured screenshot attached; every item has a source pill and a "see it"
   link.
5. Right rail — Peers (the rest of the set with movement), Quick facts
   (30-day counts), Tracking note.

### Alerts
Type chips across the top (All · Ads · Site changes · Mentions · Hiring · Your
site), then chronological rows — thumbnail, mark or headline, source pill, age.
A row opens its capture. Not a dashboard: a feed.

### Settings
Plain stacked sections with mono labels: Account · Your watch set (every brand
with its switch, including the your-site watch toggle) · Delivery (email
default; Slack/Teams) · What we alert on · Plan · Data (export, delete). No
wizards, no nested navigation — one scrollable page of honest controls.

---

## 2. Typography rhythm

Three faces only, all Google Fonts `<link>` with `display=swap`, latin subset:

| Role | Face | Weight | Treatment |
|---|---|---|---|
| Display | Bricolage Grotesque (opsz 12..96) | 700–800 | **caps**, tight tracking |
| Body | Instrument Sans | 400/500/600 | sentence case |
| Eyebrow/data | IBM Plex Mono | 400/500/600 | caps, letterspaced |

Scale (desktop / the scale itself, not per-page values):

| Token | Size | LH | Track | Use |
|---|---|---|---|---|
| `wall` | clamp(2.75rem, 8.4vw, 7.625rem) | 0.95 | −0.045em | landing hero wall only |
| `display-xl` | clamp(1.9rem, 4.2vw, 3.4rem) | 1.02 | −0.03em | section heads, page titles |
| `display-l` | 1.6rem | 1.05 | −0.02em | card/section titles in app |
| `mark` | clamp(1.3rem, 3.4vw, 2.6rem) | 1.1 | −0.02em | before/after marks (800) |
| `lead` | 18.5px | 1.55 | 0 | hero sub, page summary |
| `body` | 16px | 1.5 | 0 | default text |
| `small` | 13.5–14.5px | 1.5 | 0 | secondary rows, notes |
| `eyebrow` | 0.72rem mono | 1 | +0.16em caps | section kickers, ctx lines |
| `data` | 10.5–13px mono | 1 | +0.06–0.09em caps | ages, counts, source pills |

Rhythm rules: display is always caps in this skin (sentence case inside the app
applies to body copy, not the Bricolage display voice); eyebrows precede every
section head; numerals of consequence are Bricolage (rank, snapshot cells);
everything timestamped is mono.

---

## 3. Colour tokens

Light (canonical, from app.css `:root`):

| Token | Value | Use |
|---|---|---|
| `bone` | `#f4f1e8` | page ground |
| `card` | `#fffdf8` | raised surfaces |
| `ink` | `#171611` | text, heavy borders, primary buttons |
| `ink-soft` | `#55524a` | secondary text |
| `ink-faint` | `#6a665b` | captions, muted rows |
| `del-ink` | `#97917f` | struck "before" values |
| `line` | `#e0ddd4` | hairline rules |
| `green` | `#16c47f` | **the one accent** — marker fill, your line, on-state, focus |
| `green-ink` | `#064d31` | text on/near accent, links-in-context |
| `green-wash` | `#d9f6e8` | you-chip/row wash, step chips |
| `red` | `#b42318` | strike bar, your-site flags |
| `red-wash` | `#fff8f7` | flag card ground |

Dark (`[data-f9-theme="dark"]`, app.css:6722): `ink #ece9e2`,
`ink-soft #b5b1a6`, `ink-faint #8c887e`, `line #33312c`, `card #21201c`,
`bone #171611`, `green #16c47f` (unchanged), `green-ink #7ee2b8`,
`green-wash #103326`, `red #ff8577`, `red-wash #2a1512`. `del-ink` dark =
`ink-faint` (the struck value fades, the strike stays red).

Hard lines: no purple-blue anywhere; no pure `#000`/`#fff` (bone and ink are
the poles); no second accent hue — down-movement and deltas stay quiet ink,
never red (red is reserved for the mark grammar and your-site flags).

Borders: section edges and cards use 2–2.5px solid ink (the landing's heavy
rule); inside lists, 1px `line` hairlines; dashed `line` separates an expanded
row's evidence from the list.

---

## 4. CTA hierarchy, switch states, empty states

**CTA hierarchy** — one primary per surface:
- Primary: ink-filled button, Bricolage 700 caps, green arrow glyph (the
  command-button idiom). On cards/rows: same fill, `small` size.
- Secondary: ghost — 2px ink border, body 600, sentence case.
- Tertiary: mono uppercase underlined links ("See the diff →", "Undo").
- Destructive: red text action, never a filled red button outside confirm.

**The per-brand switch** (the one obvious control):
- **On** — green track, label "Tracking"; row at full ink.
- **Off** — neutral track, row dimmed to 45%, chip dimmed; history kept and the
  row still opens to it. Label "Off".
- **Dismissed** — out of the set entirely: ghost row, struck name, "removed
  from watch · date", mono `Undo` affordance. Dismissed brands don't rank and
  don't file history.

**Empty states** always name what fills them and when:
- Alerts empty → "Quiet so far. The first alert lands here when a tracked brand
  moves — the weekly brief still lands Friday 06:00."
- Standing chart before a full week → "The four-week line fills in as the weeks
  land — week one is drawing now."
- Read this first with nothing material → the section collapses to the single
  biggest confirmed mark; it never renders empty chrome.
- Competitor page with no developments → "Nothing caught yet — the first
  confirmed change files here with its source and screenshot."
- No competitors after onboarding → impossible state by design (the set is
  auto-populated); if reached, the add-competitor chip is the whole section.

---

## 5. Mobile behaviour

- Bottom tab bar, four places, dot under the active one, backdrop-blurred cream;
  it hides while a sheet is up.
- Rows still carry their mark/why/sources at 390 — stacked under the name, not
  truncated away.
- **Row expansion is a sheet**: tapping a ranked row slides a bottom sheet
  (max 78vh, grabber, dimmed backdrop) holding the week's evidence — the same
  content as the desktop in-place expansion — with the switch and "Open page"
  pinned at the foot.
- Development/marks stack: the screenshot thumb goes below the text full-width
  (max 300px), never beside it.
- No horizontal scroll at 390 — verified: `documentElement.scrollWidth
  − clientWidth = 0` on all three concept pages.
- Type scale keeps its shape; only `wall` drops to clamp(2.4rem, 12.5vw, 4rem).

---

## 6. Motion budget

Only what iOS would do — three moves, no more:

| Move | Where | Duration | Curve |
|---|---|---|---|
| Push | nav drill-in (row → competitor page) | 280ms | ease-out |
| Sheet | row expansion, confirm dialogs | 320ms slide + 160ms backdrop fade | ease-out |
| Fade | section reveals, live-dot blink (1.4s ambient) | 120ms | linear |

Switch toggles transition 180ms. No spring physics beyond the sheet's natural
curve, no parallax, no animated counters. `prefers-reduced-motion` collapses
everything to 0ms (the repo already enforces this globally — keep it).

---

## 7. Performance budget

- **LCP < 1.5s on 4G** on landing and Home. The hero wall is text — keep it that
  way; concept-page screenshots are the only raster content and lazy-load below
  the fold.
- **JS < 150KB gz on Home.** Route-level code splitting; Alerts/Settings/Competitor
  ship their own chunks.
- **The standing chart ships server-rendered.** Recharts (named in
  REBUILD-STACK §5) renders `<LineChart>` to SVG in the React Router SSR pass
  with fixed width/height — what ships is the same static SVG the concept page
  draws by hand. The client chart JS (~0KB for the render) stays inside the
  budget's "no client chart library heavier than 20KB" line: hover/tooltip
  enhancement hydrates lazily and is the only client chart code. If SSR proves
  impractical in the build, fall back to loading Recharts lazily below the
  fold and count it against the 150KB Home budget — not a third way.
- Fonts: the three families in one `<link>` each, `display=swap`, latin subset,
  `preconnect` to fonts.gstatic.com — same pattern as root.tsx today.
- Images: captures served from R2 as compressed WebP thumbnails; full-size on
  demand only.

---

## 8. Component map — shadcn on Base UI, nothing hand-rolled

Stack pins per `docs/REBUILD-STACK.md`: shadcn/ui 4.21.0 on Base UI 1.8.0,
Tailwind 4.3.3 `@theme` tokens (the §3 table compiles 1:1 to `@theme`),
Recharts 3.10.1, TanStack Form + zod, lucide-react icons, tw-animate-css.

| Surface element | shadcn block / Base UI primitive |
|---|---|
| Command input (landing/onboarding) | `input` + `button` composed in the `.ld-command` idiom |
| Tracking switch | `switch` (Base UI Switch) |
| Chip row / source pills | `badge` (variants: you = accent-wash, off = dimmed, add = dashed) |
| Ranked rows | `item` rows in a plain list; expansion = `collapsible` (desktop) |
| Bottom sheet (mobile row expansion) | `sheet` pinned to bottom (Base UI Dialog) |
| Before/after mark | text primitive (`<s>`/`<ins>` styled by token classes) — it is typography, not a widget |
| Screenshot card | `card` + `aspect-ratio`; flag = `badge` rotated |
| Standing chart | `chart` block wrapping Recharts `<LineChart>`, SSR'd (§7) |
| Snapshot cells / quick facts | `card` + `separator` |
| Alerts feed | `item` list + `toggle-group` for the type chips |
| Identity card (onboarding) | `card` + inline `input` fields + `badge` |
| Settings sections | `form` primitives + `switch` + `radio-group` + `separator` |
| Empty states | `empty` |
| Loading | `skeleton` |
| Confirm/undo feedback | `sonner` toast |
| Overflow menus (row kebab, if any) | `dropdown-menu` (Base UI Menu) |
| Rail/tab bar | app chrome — layout composition of `button` links, no library |

Explicitly not built: no custom chart code, no custom tooltip/popover, no
hand-rolled switch or dialog, no icon set beyond lucide-react. If a surface
needs something the registry doesn't ship, that surfaces as a DESIGN.md
amendment — not a hand-rolled widget.

---

## 9. The site-change surfaces (#3842 addendum)

Two variants of the same mark, both drawn in the concept pages:

**Competitor variant** — "caught change". Context line in mono (`BRAND — page ·
caught <time>`), the mark (`<s>old</s> → <ins>new</ins>`), the captured
screenshot card flagged `after`, source + "see the diff" links. Lives in Read
this first, ranked-row expansions, and the developments feed.

**Your-site variant** — the watch turned inward. Same mark grammar, but the
card's border goes red and the flag reads `unintended?`; the note names why it
looks accidental (a CTA that vanished, a price that disappeared) and what to do
("roll back or confirm it was deliberate"). It is a breakage flag, not intel —
it never mixes into the competitor ranking, and in Read this first it outranks
competitor news.

Both are sample-labelled when no real stored event qualifies, same honesty
rule as the landing's `.ld-change-sample` pill today.

---

## 10. What this brief does not decide

- **Body face** — Instrument Sans is the sanctioned lowest-drift pick (§0);
  swapping it is one line if Nish prefers otherwise.
- Anything the rebuild code touches that isn't visual order/type/colour/
  motion/components above — data models, pipelines, pricing, plan gates —
  is out of this brief's scope on purpose.

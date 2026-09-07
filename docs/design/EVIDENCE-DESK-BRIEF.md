# Workspace redesign build brief — "The Evidence Desk" (2026-07-27)

Winner of the three-direction exploration run for BL-003 (safe "The Ledger" /
**bold "The Evidence Desk"** / weird "The Dossier"). Picked by Nish on
2026-07-27. This is step 3 of the design workflow: the brief that every
Evidence Desk work package builds against. **No product code was written for
this brief** — it governs the packages listed in `docs/BACKLOG.md`.

Inputs this brief is cut from:

- The rendered concept pages and their rationale:
  `0509-audit-artifacts/2026-07-27-directions/direction-2-bold.html`
  (+ `.desktop.png` / `.mobile.png`) and `directions-summary.md`.
- The per-route gap table from the full signed-in visual audit (BL-002):
  `0509-audit-artifacts/2026-07-27/audit-gap-table.md` — 102 screenshots,
  51 route-states x 2 viewports.
- `DESIGN.md` (voice rules, volume split, WP-A3 header-action rule, WP-A4
  badge semantics, WP-B1 plan gates) and `docs/design/landing-caught-brief.md`.

---

## 1. References — the only sources any claim in this brief may cite

Every pattern below names the reference it was remixed from. These are the
eight Mobbin references chosen in step 1 for the **business job**, plus the
four anti-references. Nothing else may be cited as justification, and no
source layout, brand or copy is reproduced.

| Ref | Source | Ingredient this brief takes |
|---|---|---|
| **R1** | [incident.io — incident detail](https://mobbin.com/screens/590e4229-15d9-4d12-808b-2e5479a1d804) ([2nd state](https://mobbin.com/screens/ca90dd4d-0c1a-4e24-afef-77c9516c9e1e)) | One **status strip** (lifecycle steps + severity + "ongoing for" in a single row) instead of scattered status cards; anchor **tab bar**; missing values as inline muted strings |
| **R2** | [Better Stack — incident timeline](https://mobbin.com/screens/2749fa0d-db70-4cf6-ac48-47e4311bb8a6) | One vertical spine at **mixed weights**: machine events as one-liners, real findings as full cards, attachments inline |
| **R3** | [Obvious — Q1 Design Recap](https://mobbin.com/screens/48ebdb36-0d47-4585-8e92-fee7b45133f8) | Report **cover discipline**: title, one-line standfirst, byline, date; prose executive summary; right-hand contents rail |
| **R4** | [Linear — product document](https://mobbin.com/screens/c36fa084-f27b-4812-8550-b56544f39e93) | Numbered sections, one narrow reading column, near-zero chrome around text |
| **R5** | [Dovetail — record + inspector](https://mobbin.com/screens/aac9827e-b12f-4fe5-908a-2efd0acfcc11) | The **honest inline degrade** — one muted sentence where a value is missing, never an empty card |
| **R6** | [Adaline — Insight Summarizer](https://mobbin.com/screens/67794230-da90-4eff-8233-51adf67771c1) | Setup as a **persistent in-workspace checklist card**, not a separate full-screen onboarding page |
| **R7** | [Neon — Schema Diff](https://mobbin.com/screens/5fb28d4d-e574-43e5-9ea4-79cbee893e0f) + [Figma — Compare changes](https://mobbin.com/screens/ebb90bf9-735a-4f5f-968a-8152ff58dde8) | Base/compare framing, added-vs-removed colour semantics, the changed **token** highlighted rather than the whole object |
| **R8** | [HODINKEE — Watch 101](https://mobbin.com/screens/1057b224-5cf9-4e01-9571-fcaf5fcc1740) | Standing index rail in a wide margin; publication rhythm (used only in the report contents rail) |
| — | [Zillow — listing detail](https://mobbin.com/screens/0acd2b7b-541a-47bc-ba60-0caa589603a4) | Fallback IA: anchor tabs over one long page + persistent action card, if a full detail split is deferred |

**Anti-references — patterns that are forbidden by name:**

| Ref | Source | Banned because |
|---|---|---|
| **A1** | [Better Stack — logs live tail](https://mobbin.com/screens/3aa16c05-2b1f-4eaf-80b5-8f71398a5225) | Dark monospace firehose. Density without reading hierarchy — the current `/app/digests` and `/app/reports/:id` defect |
| **A2** | [Replit — analytics tab](https://mobbin.com/screens/31347222-26b6-4eba-b651-fbb61c2d2985) | Equal grid of empty cards. This *is* the 6-box "Insight depth" block; it advertises what the product could not tell you |
| **A3** | [Typeform](https://mobbin.com/screens/648d4700-8592-4be4-8b65-5931ac44fd17) · [Klarna](https://mobbin.com/screens/ab5556c1-f9bd-4e69-92fb-2c9e0b2edda3) · [Quicken](https://mobbin.com/screens/b8661d09-4bc5-42de-a026-f3d227fd10c9) empty states | Mascot + one line + one button in a void. Hides what the product will produce; a cartoon on an evidence brand |
| **A4** | [Workable — "Regenerate with AI"](https://mobbin.com/screens/45c3cbe5-8e5e-459f-bd60-bfb7e35de838) | Lavender/violet AI gradient — the exact purple-blue AI look banned by the anti-AI-look rules |

---

## 2. The concept in one paragraph

The landing page sells one mechanic: *we caught them, here is the before and
the after, here is the time we caught it.* The Evidence Desk carries that
mechanic across the sign-in line. Competitors stops being a settings page and
becomes a **watch board** — one full-width band per competitor, each with a
30-day **capture strip** you can read at a glance. A caught change opens as a
full-width **diff plate**: before on the left struck in red, after on the
right marked in green, capture time stamped on both (R7). A check that found
nothing is **one dashed line**, not a "Pending" box — quiet is a finding, not
a gap (R2, R5). The agency report opens on an ink cover with the finding as
the headline, three numbers big enough to read across a meeting room, then
evidence as numbered plates with capture times (R3, R4). Setup lives as a
checklist card on the real first screen, not a separate page (R6).

---

## 3. One system, two volumes

D2 deliberately overrides the previous "workspace stays calm" convention. The
governing rule now lives in `DESIGN.md` ("One system, two volumes") and is
summarised here because every package depends on it:

| Volume | Surfaces | Treatment |
|---|---|---|
| **Full (1.0)** | `/`, `/search`, `/auth/*`, legal, errors, `/share/:token` (+ PDF), and the **agency report cover + evidence plates** inside `/app` | Landing display sizes, capture ticker, ink-filled cover blocks, 8px offset shadows |
| **Workspace (0.7)** | Everything else under `/app/*` | Same faces, same rules, same one accent, ~70% display sizes; ticker only on the watch board; 5px offset shadows; no marquee anywhere else |
| **Plain (quiet)** | Long-dwell settings surfaces: `/app/account`, `/app/billing`, `/app/team`, `/app/clients`, `/app/notifications`, `/app/source-access`, `/app/developer-access`, `/app/shares`, `/app/support`, `/app/ops` | Same tokens, but no ink-filled headers, no offset shadows, no uppercase display above 22px. Structure and CTA hierarchy only |

The named risk, kept on the record: an intense workspace fatigues a daily
user. The Plain volume is the mitigation, and it is not optional — loudness is
reserved for evidence and deliverables.

---

## 4. Token delta

All tokens are **semantic aliases over the existing `app/app.css` variables**
(`--ink`, `--ink-soft`, `--ink-faint`, `--bone`, `--card`, `--line`, `--green`,
`--red`). This is a hard requirement: `/app` and `/search` carry a dark theme
via `[data-f9-theme="dark"]` (root.tsx `THEME_BOOT_SCRIPT`), and the Evidence
Desk must flip with it. No Evidence Desk rule may hardcode a hex value.

### 4.1 New variables

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ed-rule` | `var(--ink)` | `var(--ink)` (flips to `#ece9e2`) | Every structural 2.5px rule |
| `--ed-rule-soft` | `rgba(ink, .12)` | `rgba(ink, .16)` | Fact-row hairlines, inner dividers |
| `--ed-rule-dashed` | `rgba(ink, .30)` | `rgba(ink, .28)` | Quiet lines, reserved slots |
| `--ed-surface` | `var(--card)` | `var(--card)` | Panel/plate ground |
| `--ed-surface-sunk` | `var(--bone)` | `var(--bone)` | Band ground, side rails, mock frames |
| `--ed-fill` | `var(--ink)` | `var(--ink)` | Ink-filled headers, covers, primary button |
| `--ed-on-fill` | `var(--bone)` | `var(--bone)` | Text on ink fill |
| `--ed-accent` | `var(--green)` `#16c47f` | same | The ONE accent |
| `--ed-deletion` | `var(--red)` | `var(--red)` | Diff deletion only |
| `--ed-shadow` | `5px 5px 0 var(--ed-rule)` | `5px 5px 0 rgba(ink, .22)` | Opened/interactive containers |
| `--ed-shadow-lg` | `8px 8px 0 var(--ed-rule)` | `8px 8px 0 rgba(ink, .22)` | Page-level container (report, watch board shell) |
| `--ed-shadow-cta` | `3px 3px 0 var(--ed-accent)` | same | Primary button only — the single sanctioned green-on-clickable exception |

A solid bone offset shadow glares in dark mode; the alpha form above is the
required dark value. Every package must screenshot both themes.

### 4.2 Faces

Unchanged from the public system — **no new font requests**. `app/root.tsx`
already loads Inter 400/500/600/700, Bricolage Grotesque 600/700/800 and
IBM Plex Mono 400/500/600 globally with `display=swap`.

- **Display** — Bricolage Grotesque 800, uppercase, negative tracking.
- **Body / UI** — Inter, sentence case (`DESIGN.md` voice rule 4).
- **Evidence** — IBM Plex Mono: timestamps, capture labels, fact keys, button
  labels, tab labels. **Cap mono weight at 600** — 700 is not in the loaded
  subset and must not be added for this redesign (performance budget, §12).

### 4.3 Type scale — Workspace volume (0.7)

| Role | Face / weight | Size | Tracking | Case | Notes |
|---|---|---|---|---|---|
| Page title | Bricolage 800 | `clamp(28px, 3.2vw, 46px)` | -0.03em | UPPER | max 14ch, line-height 1.02 |
| Big number | Bricolage 800 | `clamp(34px, 4vw, 58px)` | -0.04em | — | tabular; accent mark allowed |
| Section heading | Bricolage 800 | `clamp(22px, 2.2vw, 31px)` | -0.03em | UPPER | max 20ch |
| Finding headline | Bricolage 800 | `clamp(20px, 1.8vw, 25px)` | -0.02em | UPPER | max 22ch, line-height 1.05 |
| Band name | Bricolage 800 | 23px | -0.02em | UPPER | competitor name only |
| Panel title | Inter 600 | 16px | -0.01em | sentence | inside Plain volume too |
| Body | Inter 400 | 15px / 1.5 | normal | sentence | max 60ch |
| Body secondary | Inter 400 | 14px / 1.5 | normal | sentence | `--ink-soft` |
| Micro label | Plex Mono 600 | 10px | 0.18em | UPPER | section/kicker labels |
| Evidence line | Plex Mono 400–500 | 10.5–11.5px | 0.06–0.14em | as written | timestamps, capture ids |
| Fact key | Plex Mono 600 | 9.5px | 0.14em | UPPER | left column of a fact row |
| Fact value | Plex Mono 600 | 11px | 0.04em | as written | right-aligned |
| Button label | Plex Mono 600 | 11px (small 10px) | 0.13em | UPPER | see §5 |
| Tab label | Plex Mono 600 | 11px | 0.12em | UPPER | count suffix in accent |

### 4.4 Type scale — Full volume (report cover, `/share/:token`)

| Role | Size |
|---|---|
| Cover headline | `clamp(33px, 4.4vw, 60px)` Bricolage 800 UPPER, max 15ch |
| Standfirst | 17px Inter 400 / 1.55, max 56ch, on-fill at 78% opacity |
| Headline-strip number | `clamp(30px, 3.4vw, 46px)` Bricolage 800, -0.04em |
| Report section heading | `clamp(22px, 2.4vw, 29px)` UPPER |
| Report body | 15.5px / 1.68, max 60ch (R4 single reading column) |

### 4.5 Colour

**One accent: green `#16c47f`.** It marks *state and insertion* only —
capture bars for a change awaiting you, the "now" side of a diff, a highlight
mark on a number, a tab's count. Consistent with `DESIGN.md` WP-A4: green
never means "recommended", and **nothing green is clickable** — with the one
declared exception of the primary button's `--ed-shadow-cta` offset, which is
decoration behind an ink-filled button, not the affordance itself.

Red `#e0442c` / `--red` is **diff-deletion semantic only** plus genuine error
states. It is never a plan gate (WP-B1), never a "danger" flourish, never a
count badge. No third colour enters the system. No gradients (A4).

### 4.6 Geometry

| Property | Value |
|---|---|
| Radius | **0** on every Evidence Desk surface — bands, plates, panels, buttons, tabs, inputs. (Delta from the Vercel section of `DESIGN.md`, which the workspace previously followed at 6/8/12px.) |
| Structural rule | 2.5px solid `--ed-rule` |
| Inner frame | 2px solid `--ed-rule` (plate frames, mock frames) |
| Hairline | 1.5px `--ed-rule-soft` (fact rows, list separators) |
| Quiet / reserved | 2px dashed `--ed-rule-dashed` |
| Offset shadow | `--ed-shadow` (5px) opened containers · `--ed-shadow-lg` (8px) page-level · 4px on mobile · none in the Plain volume |
| Spacing scale | 4 · 8 · 12 · 16 · 22 · 26 · 34 · 42 · 60 |
| Spacing rules | band cell padding 16–18 · panel padding 22–26 · report reading column 34–42 · section gap 24 desktop / 18 mobile |

### 4.7 What the workspace stops doing

Retired on sight in any file a package touches: card radius + drop shadows on
Evidence Desk surfaces; the full-width black button bar; the four
interchangeable button styles; the 6-box "Insight depth" grid (A2); repeated
equal card grids and any 3+1 / 2+1 orphan tile hole; stacked
`MICRO-LABEL: value` debug dumps (A1); mid-page inlined glossaries; bare "No
data" / "Pending" / "not available yet" boxes (A3).

---

## 5. CTA hierarchy — three ranks, one primary per screen

The audit's defect #4 was four-plus button styles used interchangeably. There
are now exactly three ranks, plus one non-button.

### Rank 1 — Primary (ink fill + green offset)

`background: --ed-fill`, `color: --ed-on-fill`, 2.5px rule, `--ed-shadow-cta`,
mono 600 11px uppercase, padding 10x16.

**Allowed:** exactly once per screen, for the single thing the page exists to
do — "Add competitor" on the watch board, "Send to client" on a report,
"Start the first check" on a first-run empty state, "Upgrade to Agency" inside
a `LockedFeature` gate (WP-B1). It sits in the `DashboardPageHeader` action
slot or in the primary panel, never both, and never as a cross-navigation
shortcut to another sidebar destination (`DESIGN.md` WP-A3).

**Forbidden:** full-width (max-width is content + padding); two on one screen;
inside a repeating list row; as a link to a surface the visitor cannot open.

### Rank 2 — Secondary (hairline)

`background: --ed-surface`, 2.5px rule, no shadow, same mono label.

**Allowed:** repeatable actions that live inside a card, band or plate — "Open
the capture", "Package for client", "Pause watching", "Open the file", "Send
test email". Two or three may appear in one action row. This is the default
rank; when in doubt, a button is Rank 2.

### Rank 3 — Tertiary (underlined text)

No border, no fill, `text-decoration: underline` 2px in `--ed-accent`,
underline-offset 4px, same mono label at 10–11px.

**Allowed:** reversible, in-row, low-frequency actions — "Mark reviewed",
"Check now", "Show earlier checks", "Change delivery". The green here is an
underline rule, not a fill, and is the only place accent touches an
interactive element besides the Rank-1 offset.

### Non-button — Navigation

Tabs, band rows and the contents rail are navigation, not CTAs, and never
borrow a button treatment. Tab labels are mono uppercase; the active tab is
ink-filled (R1).

### Retired styles (never ship again)

Full-width black bar · price text used as a button label (`/app/billing` pack
cards) · floating unstyled upgrade text link (`/app/collections` right rail) ·
the chip-that-is-secretly-a-button · any fourth style nobody can name.

### Rule enforcement

Every package must be able to answer, per screen: *what is the one Rank-1
action, and why is it that one?* A screen with zero Rank-1 actions is
legitimate (a settings page in the Plain volume). A screen with two is a bug.

---

## 6. Pattern specs

### 6.1 Competitor band (R1 status row + R2 mixed weights; replaces the checkbox rail)

One **full-width band per competitor** — never a card grid, so a 3+1 orphan
hole cannot exist (audit cross-cutting #7).

- Grid: `230px | 1fr | 250px` desktop; single column stacked on mobile.
- **Left cell:** state stamp (`CAUGHT` ink-filled with accent text / `QUIET`
  muted outline / `WATCHING` accent fill), competitor name at Band-name size,
  then three mono meta lines: market, cadence, watch age.
- **Middle cell:** the capture strip (§6.2) with its one-line legend.
- **Right cell:** at most two actions — one Rank 2 plus one Rank 3.
- **Open state:** band gains `--ed-surface` + `--ed-shadow`, and the detail
  panel (§6.4 tab bar) attaches directly beneath it with `border-top: 0`.
- Selection replaces checkboxes: bulk actions appear in a bar above the board
  only after a band is selected, and read as counts ("2 competitors selected").

### 6.2 Capture strip (30 days)

A row of 9px bars, 34px tall, gap 3px, right-aligned to today.

| Bar | Meaning | Token |
|---|---|---|
| Short (8px), faint | Checked, nothing changed | `rgba(ink,.14)` |
| Tall, ink | A change we captured | `--ed-rule` |
| Tall, accent | A change waiting on you | `--ed-accent` |
| Gap in the row | We did not check that day — labelled, never silently absent | dashed 1px |

Legend is one mono line under the strip, and it always says what the pattern
means in product voice: *"Short bar = checked, nothing changed. Tall bar = a
change we captured. Green = waiting on you."* A long quiet run is stated as a
finding: *"Nothing has changed here in 26 days. That is a finding, not a gap."*
(R2, and `DESIGN.md` voice rule 5.)

### 6.3 Status strip (R1) — replaces seven scattered status cards

One horizontal row, full container width, 2.5px ruled, sitting directly under
the page title. Left to right: lifecycle state stamp → the one number that
matters → last check (relative, `LocalTime`) → next check → a single Rank-3
action. Maximum five cells. It is the **only** place page-level status renders;
`TrackingStatusCard`, capacity notes, staleness notes and paused-reason banners
collapse into it. If a cell has no value it renders the honest inline value
(§6.6), never a spinner and never a card.

### 6.4 Anchor tab bar (R1; Zillow fallback)

Mono uppercase labels, 2.5px rule between tabs, active tab ink-filled, an
optional accent count suffix. Fixed order for a competitor:
**What changed · Evidence · Creative · Delivery · Setup.** Tabs are real
navigation (URL-addressable, deep-linkable, back-button correct) — this is
what breaks the 9,047px mobile scroll into readable surfaces. On mobile the
bar scrolls horizontally within its own container and must never cause page
horizontal scroll.

### 6.5 Diff plate (R7) — the signature object

The product's most important card. It renders a **single changed token**, not
a whole object dump.

```
┌ ink header ───────────────────────────────────────────────┐
│ CAUGHT 27 JUL · 06:05 UTC   OFFER PAGE      VERIFIED · … │
├───────────────────────────────────────────────────────────┤
│ Finding headline (UPPER, max 22ch)                        │
│ One sentence of why it matters (15px, max 60ch)           │
│ ┌ BEFORE ─────────────────┬ NOW ───────────────────────┐  │
│ │ 26 Jul 04:00            │ 27 Jul 06:05               │  │
│ │  ₹1,499 (struck, red)   │  ₹1,199 (accent mark)      │  │
│ │ quoted stored copy      │ quoted stored copy         │  │
│ │ capture note (mono)     │ capture note (mono)        │  │
│ └─────────────────────────┴────────────────────────────┘  │
│ [Rank 2] [Rank 2]  Rank 3                                 │
└───────────────────────────────────────────────────────────┘
```

Rules:

1. **Two panes, equal width**, split by a 2.5px rule; `before` carries a 5%
   red wash, `now` a 12% accent wash. On mobile they stack, before on top,
   with the rule moving to the bottom edge of the before pane.
2. The changed value uses Big-number type: deletion `<s>` in `--ed-deletion`
   with 3px strike; insertion marked with an accent background span.
3. **Both panes carry their own capture timestamp** in mono. A diff without
   two timestamps does not render — it degrades to a quiet line (§6.7).
4. Quoted page copy is presented as **stored capture text**, with the standing
   honesty note: *"This is the stored capture, not a re-render."*
5. Never more than one diff plate per finding. Multiple changed fields render
   as additional rows inside the same plate's `now` pane, not as new plates.
6. Red appears nowhere else in the plate.

### 6.6 Fact rail and honest inline values (R5)

A fact row is `mono 9.5px uppercase key` | `mono 11px value`, separated by a
1.5px hairline. When a value is unknown the row still renders, with the value
in `--ink-faint`, regular weight, sentence case: `not published`, `none yet`,
`we could not read this one`. **This single rule deletes the 6-box "Insight
depth" grid from `/app/watchlists`, `/app/collections`, `/app/digests` and
`report-view`** — six empty boxes become six honest rows in one rail (A2, R5).

Maximum 8 rows per rail. A rail is edited down to what an agency would quote,
not everything the loader returns (this is the explicit rejection of R1's
right-rail-of-everything).

### 6.7 Quiet line (R2) — a check that found nothing

`2px dashed --ed-rule-dashed`, padding 11x14, mono 11.5px, `--ink-soft`,
one line, no card, no icon:

```
26 Jul · 04:00   Checked. Ads, offer page and landing page all matched the previous capture.
25 Jul · 04:00   Checked. Nothing changed.
```

Quiet lines collapse after the fifth into a Rank-3 `Load 41 earlier checks`.
They are load-bearing product value and are never apologised for, never
styled as a warning, and never omitted — the complete audit trail is the
retention argument.

### 6.8 Designed empty state — the specimen plate (replaces A3 and A2)

An empty state is a **panel, not a void**, and has exactly four parts:

1. **Ink header strip** stating the real state in mono: `OKARA · FIRST CAPTURE
   RUNNING · STARTED 03:12 UTC`.
2. **A headline and one honest paragraph** in product voice saying what will
   fill the space and when: *"About ten minutes. We take the ads, the offer
   page and the price — the 'before' that every future change gets measured
   against."*
3. **A dimmed specimen or a reserved slot**: the real component it will become,
   rendered from sample data at ~45% opacity and desaturated, with a
   `PLATE 01 — PENDING` mono header and an accent scan line. The slot keeps
   its number so the state reads as *reserved*, not *broken*.
4. **One Rank-1 action, at most one Rank-2** — the thing worth doing meanwhile.

Forbidden in every empty state: illustrations or mascots (A3), a bare "No
data" (`DESIGN.md` voice rule 5), more than one empty panel per screen, and
any grid of empty boxes (A2). Where several things are missing at once, they
become fact rows in one rail (§6.6) — never parallel empty cards.

Per-surface one-liners (the Dovetail honest-degrade voice, R5) each package
must ship, replacing the current boxes:

| Surface | Current | Replacement one-liner |
|---|---|---|
| Watchlist, no evidence yet | "No evidence yet" box x6 | `Nothing filed yet — the first capture is running and lands in about ten minutes.` |
| Watchlist, quiet period | "Pending" boxes | `Checked every day since 16 Jun. Nothing has changed. That is the finding.` |
| Collection, empty | "Nothing saved yet" + dashed box | `Nothing saved here yet. Anything you save from a search or a watchlist shows up here with the capture that proves it.` |
| Brief, source unavailable | "source unavailable" x8 | `We could not read this source on 27 Jul. Everything else in this brief was checked.` |
| Report, insight missing | 6-box grid mostly empty | fact rows: `not published`, `none yet` |
| Reports index, Starter | full-width gate + 1000px void | `LockedFeature` panel + one dimmed specimen report (WP-B1) |

### 6.9 Evidence plate (report; R3 + R7)

Numbered, stamped, quotable. Ink header `PLATE 01 — OFFER PAGE · VERIFIED` on
the left, capture timestamp right. Body is a two-column split: the stored
capture rendered as a mock frame on `--ed-surface-sunk` (left, 1.1fr) and its
fact rail (right, 0.9fr) — what changed, first seen, source, still live.
Footnote in mono under the rail carries the provenance sentence. Plates are
numbered sequentially across the whole report and referenced by number in the
prose (R4), which is what makes the report quotable in a client email.

### 6.10 Report cover + headline strip + contents rail (R3, R4, R8)

- **Cover:** ink-filled block. Mono kicker (`COMPETITOR EVIDENCE REPORT ·
  26–27 JULY 2026`), the **finding as the headline** (never "Report for X"),
  a two-line standfirst, then a byline row: prepared by / for / evidence
  count / history length. This is the R3 discipline; the byline row is what
  makes it a document rather than a screen.
- **Headline strip:** exactly **three** numbers in a 3-up band directly under
  the cover, each with a 26ch note beneath. Three, because a 3-up band cannot
  produce the 3+1 orphan hole the audit found; if there is a fourth number it
  belongs in a fact rail.
- **Reading column:** numbered sections (`01 — WHAT WE FOUND`, `02 — THE
  EVIDENCE`, `03 — WHAT WE RECOMMEND`, `04 — EVERY CAPTURE`, `05 — HOW THIS
  WAS CHECKED`), one column, max 60ch (R4).
- **Contents rail:** right, sticky, mono numerals (R8/R3), plus the client
  action card (Rank 1 `Send to client`, Rank 2 `Download PDF`) and the branding
  note. The glossary moves to the end of the document or to a link — never
  inlined mid-report (current defect).
- **"Our read" callout:** accent-filled block containing the verdict in
  display type, placed *before* any number in section 01.

### 6.11 Setup checklist card (R6) — the onboarding decision

**Decision: `/app/onboard` is removed as a destination.** The dark navy page
with native disclosure triangles is the worst first-run surface in the product
(audit S1) and cannot be re-skinned into this system without inventing a
fourth volume.

- Setup becomes a **persistent checklist card on `/app`** (Overview), in the
  workspace volume: ink header `SETUP · 2 OF 4 DONE`, one row per step with a
  done/pending state stamp, one Rank-1 action pointing at the *next* step, and
  a Rank-3 `dismiss until tomorrow` once the blocking steps are done.
- The card is present until every blocking step is complete, then disappears
  permanently (no "you're all set" tombstone).
- `/app/onboard` becomes a **redirect to `/app`** with the checklist scrolled
  into view; the route file and its loader are deleted only after the redirect
  and its test land. Every existing link, email CTA and post-signup redirect
  that targets `/app/onboard` must be repointed in the same package.
- The activation state currently rendered by `first-run-spine` /
  `first-run-wait` / `first-run-wire` folds into this card or into a §6.8
  specimen plate; nothing else may introduce a second first-run pattern.

---

## 7. Section order and above-fold composition

**Watch board (`/app/watchlists`)** — ticker (the only ticker in the
workspace) → page title + caught count → status strip → watch board bands →
opened detail (tab bar → change feed | fact rail).
*Above the fold at 1440x900:* title, caught count, status strip, and at least
one full band including its capture strip.

**Competitor detail (`/app/watchlists/:id`, tabbed)** — tab bar → the newest
diff plate → quiet lines → `Load N earlier checks`; right rail: 1 number card,
1 fact rail, 1 delivery card.
*Above the fold:* the tab bar and the whole first diff plate including both
timestamps.

**Report (`/app/reports/:id`, `/share/:token`)** — cover → 3-number headline
strip → 01 what we found (+ "Our read" callout) → 02 the evidence (plates) →
03 what we recommend → 04 every capture → 05 how this was checked; contents
rail right.
*Above the fold:* cover headline + standfirst + byline row.

**Overview (`/app`)** — greeting + the one number → setup checklist card (until
complete) → what changed since you last looked (diff plates, max 3) → watch
board summary → one Rank-1 action.
*Above the fold:* greeting, the number, and either the checklist card or the
first change.

**Collections (`/app/collections`)** — the IA inverts: saved items first as
full-width bands, the create form demoted to a Rank-2 action that reveals a
panel. Right rail carries one fact rail, not five inconsistent actions.

**Briefs (`/app/digests`)** — one designed brief component per brief: date
header → the finding in display type → diff plates for what changed → quiet
lines for what did not → one fact rail. Filters are a single mono row above,
not a form.

**Plain-volume settings pages** — a section list down the page, each section a
titled panel with its own inline Rank-2 action; no full-width buttons, no
repeated identical cards, no headline inside a form card.

---

## 8. Proof architecture — what may be claimed

Non-negotiable; this is the brand.

1. **Every number and quote in the UI traces to a stored capture.** If the
   capture is missing, the surface degrades to a quiet line (§6.7) or an
   honest inline value (§6.6). It never estimates and never interpolates.
2. **Two timestamps or no diff** (§6.5.3).
3. **Sample and demo data are labelled inline**, in mono, adjacent to the
   thing itself — `SAMPLE`, `DEMO DATA — SAMPLE RESULTS` — never only in a
   footnote. Existing scoped honesty copy keeps its exact meaning after any
   restyle (`DESIGN.md` voice rule 11).
4. **Every report ends with "05 — HOW THIS WAS CHECKED"**: cadence, sources,
   date range, and the sentence *"Where a number was not published by the
   source, this report says so rather than estimating it."*
5. **No unsourced proof claims anywhere** — no invented customer counts, no
   "trusted by", no accuracy percentages, no imagery that is not a real
   capture. A claim without a source is a hold, not a ship.
6. Reference claims in design review cite R1–R8 / A1–A4 by name (§1).

---

## 9. Mobile behaviour rules (390px reference)

1. **No horizontal page scroll, ever.** Wide objects (tab bar, capture strip,
   fact tables) scroll inside their own `overflow-x: auto` container.
2. **The 9,047px scroll is the headline defect.** Any `/app` route must come
   in **under 4,000px** of mobile document height in the populated fixture
   state, and the watch board detail under 3,000px. Packages report the
   measured before/after number.
3. Bands, diff plates, report main and plate bodies **all collapse to one
   column**; every vertical 2.5px rule becomes a horizontal one on the cell
   that loses it (never disappears).
4. Diff plate stacks **before above now**. Capture strips keep 9px bars and
   scroll horizontally rather than shrinking below tap legibility.
5. Offset shadows drop 5px→4px, 8px→4px. Display type uses the `clamp()` floor
   values in §4.3.
6. Touch targets ≥ 44px on all three CTA ranks; Rank-3 underlines get 10px
   vertical padding.
7. The ticker keeps one line and clips; it does not wrap and it pauses under
   `prefers-reduced-motion`.
8. The two-row scrolling top tab strip on `/app` mobile ("Swipe for more",
   audit S3) is replaced by the same anchor tab bar pattern (§6.4).

---

## 10. Accessibility gates (every package)

- Contrast ≥ 4.5:1 for body text and ≥ 3:1 for the 2.5px rules, **in both
  themes**. Accent `#16c47f` is a background/marker colour only — never
  accent-on-bone text below 20px.
- Colour is never the only channel: the diff plate labels `BEFORE` / `NOW` in
  text; the capture strip legend names each bar in words.
- Tabs are real links or a proper `tablist` with arrow-key support; the ink
  fill is not the only active-state signal (`aria-current` / `aria-selected`).
- Focus is visible on every rank of CTA and on tabs; the offset shadow is not
  a focus ring.
- Strike-through deletions carry an accessible label (`<s>` plus text), not
  strike styling alone.

---

## 11. Performance budget

- **Zero new font families and zero new weights.** All three faces are already
  loaded in `app/root.tsx`; mono caps at 600 (§4.2).
- CSS only — no images, no icon fonts, no chart library, no CSS-in-JS
  (`CLAUDE.md` stack rule). Capture strips, scan lines and tickers are DOM +
  CSS.
- The Evidence Desk layer is expected to be **net-neutral or negative** on
  `app/app.css` size: every package deletes the rules it replaces in the same
  PR. A package that only adds CSS has not finished.
- No new client-side JS beyond what tabs and disclosure require; the tab bar is
  URL-driven, not state-driven.
- Animation: the ticker and the empty-state scan line only, both paused under
  `prefers-reduced-motion`.

---

## 12. Out of scope / explicitly rejected

- R7's raw code-diff density (A1 risk — the reader is a marketer, not an SRE).
- R1's right-rail-of-everything; facts are edited down (§6.6).
- All illustration, mascots and stock imagery (A3).
- Any second accent colour; any gradient (A4).
- A dark "app" surface distinct from the existing dark theme — the theme flips
  tokens, it does not introduce a second visual language.
- Server/loader redesign. Packages are presentation-layer; where a loader must
  change (e.g. to expose a second capture timestamp) it is called out in the
  package and covered by a unit test.

---

## 13. Conformance checklist — every Evidence Desk PR must show

1. One Rank-1 action per screen, named in the PR body with its justification.
2. Zero Vercel-era radii, drop shadows and full-width black bars left on the
   routes touched.
3. Zero empty boxes: every missing value is a fact row, a quiet line or a
   specimen plate.
4. Both themes screenshotted, desktop 1440 and mobile 390.
5. Zero console errors, zero horizontal scroll, measured mobile document
   height reported before/after.
6. Unit tests updated for every re-worded string and every removed component.
7. Deleted CSS listed alongside added CSS.
8. Any reference-based justification cites R1–R8 / A1–A4 by name.

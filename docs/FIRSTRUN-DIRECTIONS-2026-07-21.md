# WP-C2 — First-Run Journey · Reference + Directions Phase

**Date:** 2026-07-21 · **Author:** Reviewer/coordinator (Claude) · **Phase:** references → three directions (pre-code). NISH PICKS the winner; no production code is written in this phase.

**Scope.** The ground-up redesign of the arc a brand-new signup walks:
**`/app` Overview (empty) → adding the first competitor → the first-scan wait → the first brief landing.**
Per the intent audit (`docs/INTENT-AUDIT-2026-07-21.md`, §C2), this cluster is the product's weakest *designed* experience even after the B2/B3 coherence fixes improved the individual pieces. The goal is **one designed arc, not four adequate screens** — a new customer should feel momentum and inevitability ("my first brief is coming, and it will be worth paying for") inside 60 seconds of signup.

**What already shipped (do not redesign, build on it).** The live `/app` today already reflects `COHERENCE-SPEC` WP-B3: a single "Build your brief" hero with one search box, a compact "2 of 7 setup checks" progress strip, "Competitors"/"Briefs" naming. These directions extend that spine into a full arc — they don't undo it.

**Design tokens (sampled live from the dark workspace, 2026-07-21).**
bg `#171611` · panel `#21201C` · panel border `#33312C` · ink text `#ECE9E2` · dark-mode green eyebrow `#7EE2B8` · accent green `#16C47F` · red reserved for diff/error only. Type: Bricolage Grotesque (display) / Inter (body) / IBM Plex Mono (evidence + timestamps). Marketing energy sampled from the new `/ads/nike.com` quality bar (green highlight marker on Bricolage caps, mono case-file stamps, dashed evidence frames, the 72/100 ad-aggression score with 4-part velocity/testing/freshness/persistence breakdown, "here's what you'd wake up to" payoff-first framing).

---

## 1. Reference shortlist (chosen for the JOB, not for beauty)

All examined as images via Mobbin, not from metadata. The job at each beat: **turn an empty account into felt momentum, sell the wait, and make the first payoff feel worth paying for.**

| # | Reference | What it does for the job | Beat it informs |
|---|---|---|---|
| 1 | **Rise — "Analyzing your data… this may take 30s"** (ios) | Dark screen with an honest live checklist of the *actual* sub-steps being run (get sources → process → calculate). Turns a wait into visible, trustworthy work. | The first-scan wait |
| 2 | **Bolt Food — order timeline** (ios) | Timestamped, checkmarked event timeline ("2:10 confirmed → 2:14 ready → arrived"). The canonical "your thing is being prepared, here's exactly where it is." | The wait + the assembly spine |
| 3 | **DoorDash / Glovo — "Preparing your order"** (ios) | Horizontal 3-step status rail (prep → pickup → delivery) with an ETA window. A spatial promise the eye can track. | The arc's progress spine |
| 4 | **One (banking) — "$25 setup bonus · Next: make a purchase"** (ios) | A forward-moving momentum tracker with checked dots and a single "Next" — setup framed as a rewarded run, not a chore. | Add-competitor + queue-more |
| 5 | **Pipedrive — "You're on the right track"** (web) | Reassurance copy + progress that tells the user their effort is compounding ("users who complete these go on to close deals"). | Overview hierarchy |
| 6 | **Evernote onboarding — "Personalizing your experience" + payoff preview** (ios) | Shows a *filled* version of the product early (a populated home) so the user sees the destination before they've earned it. | Show-the-payoff-early tease |
| 7 | **Yazio — "Analyzing…" with skeleton result** (ios) | The result scaffolds into view (image + skeleton cards) *during* the wait — the payoff is literally assembling in front of you. | The wait's payoff-preview |
| 8 | **Ultrahuman — "Analysing your connected ring"** (ios) | A calm, premium device-readout that makes a technical process feel composed and high-end, not a spinner. | Wait tone (Direction C) |

**Anti-references (what to avoid):**

- **A1 — Typeform empty workspace** ("Come on in, Jane" + a tumbleweed dog illustration over a blank grid). The exact *empty-dashboard-with-tumbleweed* the audit warns about: charming but says "you have nothing," zero momentum.
- **A2 — Outseta / Uxcel / Wix generic getting-started checklists** (web). The *generic checklist onboarding* anti-pattern: a flat 7–8-row list of setup chores with a % bar. It's a to-do list, not a story — precisely the flat, hierarchy-less thing the audit flagged on the old Overview. (Direction A deliberately *demotes* this into a one-line strip rather than leading with it.)

Remix rule honored: every direction blends **3+** references and copies no source's layout, brand, or copy.

---

## 2. The three directions (rendered HTML concept pages, 1440px, screenshotted top-to-bottom)

Each concept is a **single scrollable storyboard** showing all four beats staged in the real dark-workspace styling (sidebar rail + content, real tokens, Bricolage Grotesque, Inter, IBM Plex Mono, green accent). Files:

| Direction | File |
|---|---|
| A — Safe | `/tmp/0509-firstrun-directions/direction-a-filing-desk.html` |
| B — Bold | `/tmp/0509-firstrun-directions/direction-b-stakeout.html` |
| C — Weird-but-plausible | `/tmp/0509-firstrun-directions/direction-c-overnight-wire.html` |

Re-render any of them: `cd /tmp/0509-firstrun-directions && python3 -m http.server 8823`, then open at 1440px.

### Direction A — "The Filing Desk" (SAFE)

**One quiet spine, four beats.** Keep the Vercel-calm workspace exactly as-is in temperature, and add one thing the four screens don't have today: a **forward-only brief-assembly spine** (`Add a competitor → First scan → First brief`) that renders on every beat and never resets. Beat 1's empty Overview leads with one dominant paste box + a *dimmed real brief* preview ("this is what lands once we've watched them"). Beat 2 advances the spine and invites queueing more while the first cooks. Beat 3 is a Rise-style honest sub-step checklist + a Bolt-style timestamped feed ("0:19 · 14 ads in rotation"). Beat 4 lands the real payoff (72/100 aggression score, 4-part bars, today's new-creative event, creative thumbnails) with the spine fully green.

- **References remixed:** Bolt Food (timestamped timeline) · Rise (honest sub-step wait) · DoorDash (horizontal status rail) · Pipedrive (progress reassurance) · Evernote (dimmed payoff preview).
- **Kept:** persistent forward-only spine as the connective tissue; the wait's "here's exactly what's happening right now"; demote the 7-row checklist *into* the spine.
- **Rejected:** gamified badges, confetti, mascots, %-complete guilt (anti-ref A2). The tool feels earned, not cheered.
- **Why it fits Five to Nine:** lowest-risk evolution of what shipped today — it doesn't change the workspace's temperature, it just gives the four disjoint screens one backbone that *is* the product promise made visible. Best if we want intent without turning up the volume.

### Direction B — "The Stakeout" (BOLD) — *recommended, see §3*

**Catch them from minute one.** Brings the `/ads/nike.com` poster energy *inside* the workspace so the first 60 seconds match why the customer signed up. The arc is staged as a live stakeout with an order-tracking-style rail: **Pick a target → Staking out → Evidence filed.** Beat 1: a big Bricolage headline with the green highlight marker — "WHO DO YOU WANT TO **CATCH IN THE ACT?**" — over a dashed evidence frame teasing a watched target (72/100 + rotated "AGGRESSIVE" stamp). Beat 2: "rival.com is **UNDER WATCH**," confirm + queue. Beat 3: a live **"REC 00:47"** capture feed — ad tiles scanning with a green scan-line, a running dispatch log, counters (14 active / 9 captured / 3 new), and the line "They don't know they're **on camera.**" Beat 4: "CAUGHT: rival.com is **TESTING HARD**" as a green-glowing case file with the full aggression breakdown and creative thumbnails.

- **References remixed:** 0509's own poster (marker headlines, mono case-file stamps, dashed evidence frames) · DoorDash/Glovo (order-tracking status rail) · One banking (rewarded momentum tracker) · Life Reset (dark bold Day-1 cards).
- **Kept:** the marker-highlight headline + rotated stamps; order-tracking rail as the spine; a live "recording" capture feed that sells the wait; payoff-first framing.
- **Rejected:** the bone poster background (workspace stays dark); red as decoration (stays diff/error only); literal spy kitsch — it's *evidence*, not a spy movie.
- **Why it fits Five to Nine:** the audit's headline note is *"the landing needs to LAND"* and the connective tissue is too quiet. This makes the first run **feel like the poster promised** — same voice, marks, and swagger carry from marketing into the product. Highest energy, most ownable, most on-brand.

### Direction C — "The Overnight Wire" (WEIRD-BUT-PLAUSIBLE)

**Tonight's edition, typeset in front of you.** Five to Nine is named for 05:09 — *your brief, filed before the workday.* This makes that literal: the workspace is a private wire service. A **masthead** ("THE FIVE·NINE WIRE — competitor moves · filed before 05:09 · sourced or it doesn't run") persists across all four beats as the spine. Beat 1's empty state is a **blank front page** — "TONIGHT'S EDITION — NOT YET ASSIGNED / Who should tonight's edition cover?" — with ghosted example columns beneath, reframing *absence* as *anticipation*. Beat 2 "assigns the beat." Beat 3 is "**GOING TO PRESS**": dispatches tick in ("ON THE WIRE") while the lead **typesets live** ("rival.com is testing hard" composing with a cursor). Beat 4 lands a real **front page** — a lead headline, a standfirst, and three columns (aggression lead 72/100 · new-creative column · offer-watch column showing a `$0 → $29/mo` price change).

- **References remixed:** wire/newsroom metaphor (masthead, edition line, columns — typographic, not skeuomorphic) · Rise (honest dispatch sub-steps) · Ultrahuman (composed device-readout tone) · ABY Journal (warm single-question intro).
- **Kept:** the masthead as the persistent spine; "typesetting live" as the wait's payoff-preview; front-page columns for the brief; the 05:09 "filed before you wake" truth made ownable.
- **Rejected:** literal paper texture / sepia / serif newsprint (stays Bricolage on dark); mascots; printing-press animation kitsch.
- **Why it fits Five to Nine:** no competitor onboarding uses a wire-service metaphor, and it's *true* — it's the brand's own name and promise. Reframes "you have nothing" into "tonight's edition is waiting for its lead story." Highest differentiation; the risk is the metaphor must stay disciplined or it tips twee.

---

## 3. Recommendation

**Lead with Direction B (The Stakeout), and fold in Direction A's forward-only spine.**

Reasoning:

1. **It answers the actual audit finding.** The owner's verdict was "it does NOT feel built with intent," and the audit's structural note is that the workspace "looks designed in the hero and the terminal, and assembled in the middle." B is the only direction that carries the *hero's* proven voice (the shipped `/ads/nike.com` bar) straight into the middle. The design-workflow rule is explicit: if the safe winner feels tasteful-but-quiet, push the louder direction before settling — B is that louder direction, and the first run is exactly where the product needs to LAND.

2. **The spine is the single strongest momentum device**, and it's in A. B's order-tracking rail already *is* a spine; adopting A's rule that it is **forward-only and never resets** across all four beats is what converts "four staged screens" into "one arc." So the build brief is B's art direction on A's spine mechanic — not a coin toss between them.

3. **It's the most ownable and the least generic.** B cannot be mistaken for Typeform's tumbleweed or Outseta's checklist (both anti-refs). It reuses marks the product already ships, so it's coherent with the public funnel on day one (whole-funnel rule) rather than a second visual language.

4. **Borrow two things from C regardless of the pick:** the **"sourced or it doesn't run" honesty line** and the **05:09 "filed before you wake"** framing are true, on-brand, and reinforce "worth paying for." They drop cleanly into B's Beat 3/4 without the full wire metaphor.

**When to pick A instead:** if we decide the workspace must stay deliberately calm (daily-use tool, DESIGN.md's "logged-in workspaces may stay calmer") and we want the lowest-risk change. A is a complete, shippable arc on its own — it is the safe fallback, not a throwaway.

**When to pick C instead:** if maximum brand distinctiveness is the priority and we're willing to invest in executing the metaphor with restraint. C is the highest-ceiling, highest-variance option; it's the one that would make the first-run experience genuinely unforgettable, but it needs the most careful copy discipline to avoid twee.

**Not recommended:** shipping any of them as flat per-page empty states (today's state) — the whole point of C2 is that the arc is designed as one journey.

**Next step after Nish picks:** write the WP-C2 build brief (section/beat order, exact copy, the spine's state machine, real vs. sample data rules for the first-scan wait, mobile behavior, and how the four beats map to the real routes `/app` + `/app/watchlists` + `/app/digests`), then implement in the dark workspace system — extending the WP-B3 hero already live, not replacing it.

---

# WP-C2 — Winner + Build Brief

**Decision (Nish, 2026-07-21):** **Direction B's structure and energy WIN, with all customer-facing copy REPLACED by Direction C's "Overnight Wire" voice.** Fold in Direction A's forward-only spine mechanic. This section is the implementation contract: a builder implements it without improvising copy or making judgment calls. **No production code in this phase — this is the brief the coordinator reviews before any build starts.**

> **Base-branch gate (read first).** This brief assumes `integration/polish-stack-2026-07-21` (the COHERENCE-SPEC parts a+b) has merged to `main`, i.e. the live WP-B3 Overview hero, the `Pill`, `EmptyState`, and dashboard-navigation systems, and the "Competitors"/"Briefs" naming spine are all present. Confirm with `git log --oneline -5 origin/main` before branching. Branch: `spec/wp-c2-first-run-arc`. One PR (or a small ordered stack: spine component → Overview → wait → brief). Never `npm run deploy`.

## 0. Voice lock — "The Wire register" (C-voice), with the naming spine protected

**Register:** calm, confident, editorial — a private wire service that files your competitor brief before the workday. **Never** cop-show / surveillance: **banned customer-facing strings** — "stakeout", "staking out", "under watch", "REC", "on camera", "caught in the act", "surveillance", "target acquired", "case file", "case #".

**Approved motif vocabulary (flavor only):** "filed", "files before 05:09 / before you wake", "sourced or it doesn't run", "going to press", "on the wire", "dispatch(es)", "the front page", "the lead", "reading {domain} now".

**NAMING-SPINE GUARDRAIL (hard rule — protects SF-1, the audit's #1 failure).** WP-A1 made **"brief"** and **"competitor"** the single canonical customer nouns (sidebar "Competitors" / "Briefs", routes, titles). The Wire register is **atmosphere, not renaming**:
- The clickable/deliverable noun is **always "brief"** — never "edition" as the primary or action noun. Button reads **"Read the full brief →"**, not "Read the full edition".
- **"edition"** may appear **only** as an atmospheric mono eyebrow (e.g. `TODAY'S EDITION`) — never in nav, page titles, the primary CTA, or as a synonym a new user must decode.
- **"the front page"** describes a *layout* (the brief's hero + column composition), not a new product noun.
- The masthead-lite wire mark is a **mono kicker** (`THE 5·9 WIRE`), **not** the full bordered-newspaper masthead from Direction C (that was C *structure*, which was not selected — B structure was). See §11.

**Kept from B (structure/visuals, copy-swapped):** marker-highlight Bricolage headlines (one per beat), one rotated classification stamp on the brief (e.g. `AGGRESSIVE` — a real score label, editorial not spy), the order-tracking status rail as the arc spine, the live dispatch feed during the wait, payoff-first framing, the green-glowing first-brief panel.

## 1. Beats → real routes + anchors

| Beat | Route / file | Real anchors to extend |
|---|---|---|
| 1 — Empty Overview | `app/routes/app.dashboard.tsx` | free-first-run banner (`plan === "free" && competitorCount === 0`, lines ~562–570); `marketDeskBrief` hero (lines ~590–644); readiness strip (`readinessGaps.slice(0,5)`, ~644–659). `competitorCount = watchlists.length` (~487). |
| 2 — Add first competitor | `app/routes/app.dashboard.tsx` (hero search `<Form>` → `Search ads`, ~631–639) + `queueFirstWatchlistScan` (~411–413) | the add path is the existing search/add flow; confirmation returns to the Overview with `firstScanQueued` truthy. |
| 3 — First-scan wait | `app/routes/app.watchlists.tsx` (existing first-scan polling: `firstScanPollingKey` ~2101–2131, running copy ~2046, failure states `first_scan_dispatch_failed`/`first_scan_setup_failed`/`first_scan_retry_exhausted` ~2051–2196) **and** a compact mirror on the Overview | reuse the existing poll + status machine; do not build a second scan-status source of truth. |
| 4 — First brief filed | `app/routes/app.digests.tsx` (Briefs) + the populated `marketDeskBrief` on the Overview | the brief content, aggression score, events, and creatives are **existing** builder output — render real data, never hardcode. |

**Shared across all four beats:** a new `<FirstRunSpine>` component (§2).

## 2. The spine — shared component + state machine

**Create `app/components/first-run-spine.tsx`**, exported `FirstRunSpine`. Three fixed nodes, left→right, order never changes:

1. `Add a competitor`  · sub: `Paste a website`
2. `First scan`  · sub (idle) `We read their ads + page` / (active) `Reading {domain} now`
3. `First brief`  · sub `Filed to your inbox`

**Props:** `{ furthest: "add" | "scan" | "brief"; scanDomain?: string }`. Render is a pure function of `furthest`.

**Node status rules:**
- A node is `done` (green fill, ✓) if it is *before* `furthest`, or if `furthest === "brief"` (all done).
- The node *equal to* `furthest` is `now` (ring + `--green-lite` glow) while its work is in flight; `done` once its milestone record exists.
- Nodes *after* `furthest` are `idle` (grey outline).
- The connector track between two done nodes is solid green; between done→now it is a 50% gradient; after now it is grey.

**`furthest` derivation (server-side, durable, monotonic — this is the "never-resets" guarantee):**
- `add` when the workspace has ≥1 competitor OR has ever queued a first scan.
- `scan` when the first scan run status is `queued|running` (active) — and stays ≥`scan` once any first scan has *completed*.
- `brief` when ≥1 brief record has ever existed for the workspace.
- `furthest` = the **maximum** milestone ever reached, computed from durable records (`has-competitor`, `first-scan-run-status`, `has-any-brief`). Because those facts are monotonic during onboarding, the rail can only advance. **Never render an earlier node as `now`/`idle` than the furthest durable milestone**, even mid-request, even if the user just deleted their only competitor.

**Retirement:** the spine renders **only during the first-run window** — from empty workspace until the first brief has ever been filed. Once `has-any-brief` is true on a later visit, **do not render the spine at all**; the Overview shows its normal populated state. (No migration needed — derive `has-any-brief` from existing brief records. If a cheap boolean is wanted, a durable flag is acceptable but not required; prefer derivation.)

**[corrected in review 2026-07-21, round 2] — a completed scan is NOT a brief.** `has-any-brief` must derive from real brief/digest records (`digests.length > 0`), never from scan completion. A completed scan advances the spine into the **`filing`** milestone: node 1 done, node 2 done, node 3 **pending** ("First brief"), and the spine stays visible until a real brief files (for free, the weekly Competitor Watch digest IS that brief). This adds a fourth milestone to the pure function: `add → scan → filing → brief`.

**Placement:** the spine is **additive chrome above the hero card** on the Overview, and a compact variant at the top of the first-scan wait view and the empty Briefs view. It is **not a CTA** and introduces no new action (protects WP-B3's "one dominant action" win).

## 3. Beat-by-beat structure + EXACT copy (write every string verbatim)

Marker = the green highlight-marker span (`background:var(--green)` / dark-green text) applied to the bracketed phrase. Mono = IBM Plex Mono eyebrow.

### BEAT 1 — Empty Overview (`/app`, first run)
- Keep existing `WakeGreeting`.
- Wire eyebrow (mono): **`THE 5·9 WIRE · NOTHING FILED YET`**
- H1 (Bricolage, marker on bracket): **`Name one competitor. [We file the first brief before you wake.]`** — **[corrected in review 2026-07-21, round 2]** this is a DAILY-cadence promise. "Before you wake" (05:09 daily) is only truthful for Starter/Agency. For weekly plans (free default, Scout) the marker is **`We file your first weekly brief.`** and the sub anchors to what actually happens (we pull ads now, check weekly). Gate on `planAllowsDigestCadence(plan, "daily")`. Never promise same-night/guaranteed inbox delivery to a weekly plan.
- Sub: **`Paste a website — a competitor's or your own. We pull their live Meta ads and landing page, then file a brief the moment their offer, creative, or CTA moves.`**
- Reuse the **existing** hero search `<Form>` as the add path. Input placeholder: **`https://competitor.com`**
- Primary button label: **`Assign the beat →`** (keep the existing submit action; only the label changes; existing `pendingLabel` → **`Filing…`**).
- Plan hint (free only, mono hint slot): **`Free includes one watchlist — activation scan, weekly check, weekly email brief.`** — **[corrected in review 2026-07-21]** the earlier draft string (`Free includes one activation watchlist and one first scan.`) *understated* the plan and contradicted the shipped claim registry: the **free Weekly Competitor Watch (PR #360) includes a recurring weekly email brief**, not just a one-off scan. Free is `digestCadence: "weekly"` in `plan-entitlements.ts`. This hint is a reuse/condensation of the live free-plan claim, not invented copy — do not invent plan mechanics, and do not understate the weekly brief.
- Payoff tease (dimmed real-brief preview, B structure): frame eyebrow (mono) **`WHAT LANDS ONCE WE'VE FILED — A REAL BRIEF, DIMMED`**; show the aggression-score tile (`72/100` placeholder is acceptable **only** because it is explicitly a labelled dimmed *sample*; keep the "DIMMED / sample" label visible) + two creative thumb placeholders labelled `Their headline, saved to the pixel` / `Every video creative, poster frame and all`.

### BEAT 2 — First competitor added (`/app`, `firstScanQueued` truthy)
- Wire eyebrow (mono): **`THE 5·9 WIRE · BEAT ASSIGNED`**
- H1 (marker on bracket): **`{domain} is [on the wire.]`**
- Confirmation banner (green): heading **`We're covering {domain}.`** · body **`The first scan is running now — you don't have to wait on this page.`** · meta line (mono): **reuse the existing confirmation/delivery string** for source + destination (do not hardcode "daily"; free gets one scan — reuse plan-accurate copy already emitted by the add flow).
- Queue-more card: eyebrow (mono) **`A BIGGER BRIEF`** · title **`Add another competitor`** · body **`Cover three to five and the brief compares their offers side by side.`** · input placeholder **`https://another-competitor.com`** · button **`Add another`**. — **[corrected in review 2026-07-21, round 2]** capacity-gate this: the add form only renders when `competitorCount < getPlanLimit(plan, "watchlists")`. Free is a **one-watchlist** plan, so at Beat 2 it is already at capacity — show the upgrade affordance (**`Watch more competitors`** / **`View plans`** → `/app/billing?source=dashboard-limit#plans`), never an add form that `checkPlanLimit` would reject.

### BEAT 3 — First-scan wait / "going to press" (`/app/watchlists` first-scan view + Overview mirror)
- Wire eyebrow (mono): **`THE 5·9 WIRE · GOING TO PRESS`**
- H1 (marker optional on `[now.]`): **`We're reading {domain} [now.]`**
- Sub: **`This takes a minute or two — close the tab if you like. Your brief appears here the moment the scan finishes.`** — **[corrected in review 2026-07-21, round 2]** the earlier draft (`…the brief lands in your inbox either way.`) promised guaranteed + immediate email delivery, which is false for weekly plans and for fallible delivery generally. Anchor to the workspace (the scan result appears here when it finishes); the weekly email brief files on the plan's cadence. Also **[corrected round 2]**: `Reading {domain} now` may render ONLY for a `running` scan — a queued scan shows a truthful queued line (`{domain} is next in line.` / spine sub `Queued — next in line`); delayed/paused fall through to the existing failure UI.
- Spine node 2 sub becomes: **`Reading {domain} now`**.
- Dispatch feed panel — header (mono): **`ON THE WIRE`**. Lines are **honesty-gated (see §4)** — render a line only when its fact exists:
  - **`Found {domain} in the Meta Ad Library`** · sub **`{n} active ads`** *(only if n is known)*
  - **`Saved every creative — image and video`** *(only once creatives are captured)*
  - **`Read their landing page`** · sub **`CTA and price captured`** *(only if captured)*
  - **`Scoring ad aggression`** — the `now` line while scoring
  - **`Filing your first brief`** — pending line
- "Honest deal" side panel: eyebrow (mono) **`WHILE WE FILE`** · heading **`Sourced or it doesn't run.`** · body **`Every line in your brief is backed by a screenshot, the page text, and the link. If nothing's moving, the brief says so plainly — we don't invent a story.`**
- "Setting the lead" preview: **skeleton bars only** (Bricolage-height placeholder lines). **Never** render a fabricated headline before the brief exists.
- Elapsed timer (e.g. `Started 47s ago`) is allowed (real elapsed time). Per-line timestamps are **forbidden** unless the run emits real per-step times (§4).
- **Failure:** on any `first_scan_*` failure/retry-exhausted state, show the **existing** honest failure UI from `app.watchlists.tsx` — do not show progress or a partial feed.

### BEAT 4 — First brief filed / the front page (`/app/digests` + Overview populated)
- Eyebrow (mono): **`FIRST BRIEF · FILED {real filed time}`** — use the **real** completion time. Do **not** stamp "05:09" on an on-demand first brief.
- H1: **the brief's own lead**, data-driven from the existing brief/`marketDeskBrief` output — **do not hardcode** a headline. If the existing builder does not yet emit a single lead sentence, the H1 falls back to **`Your first brief on {domain} is filed.`**
- The score card (aggression `/100`, velocity/testing/freshness/persistence), the "today" event, and the creative thumbnails are **existing real data** — render them; never invent numbers.
- One rotated classification stamp reusing the real score label (e.g. `AGGRESSIVE`) — editorial, from real data only.
- CTAs: primary **`Read the full brief →`**; secondary **`Add a competitor to compare`**. — **[corrected in review 2026-07-21, round 2]** the primary CTA must be FUNCTIONAL, not a no-op back to the current URL: it is a same-page anchor **`#first-brief-detail`** that jumps to the full brief detail panel (which carries `id="first-brief-detail"`). And the front-page framing must **show once, then retire**: gate on `digests.length === 1` **AND** arrival from the first-run arc (`?firstrun=1`, carried by the Overview "Your first brief is ready" bridge). Ordinary Briefs navigation (no flag) always shows the standard master-detail; a second digest also retires it. No migration.
- Recurring-cadence footer (mono): **only for DAILY-cadence plans** — **`Tomorrow's brief files automatically before 05:09.`** **[corrected in review 2026-07-21]** the "before 05:09" promise is the **daily** cadence (Starter / Agency, `digestCadence: daily_and_weekly`). Free and Scout are **weekly** (`digestCadence: weekly`) and DO receive a recurring weekly brief — so the footer is gated on `planAllowsDigestCadence(plan, "daily")`, and for weekly plans the footer stays **absent** (absence is honest; asserting a daily cadence they don't have, or an upgrade line that denies their weekly brief, is not). Do **not** describe free as "one-scan": free is recurring-weekly.
- The spine shows all three nodes `done`, then retires on subsequent visits.

## 4. Real-vs-sample data — honesty gate (wait beat)

**Hard rule: never fake progress. Only show scan sub-steps that are actually happening.**
- Each ON-THE-WIRE dispatch line **must bind to a real field** on the first-scan run/watchlist record (ad count, creatives-saved count, landing CTA/price). If the field is absent, **omit the line** — no placeholder number, no invented text, no "…".
- If the run record does not yet expose granular sub-steps, ship the **reduced honest feed**: `Queued → Reading {domain} → Filing your first brief`, driven by the existing `firstScanPollingKey` status (`queued|running|complete|failed`). Flag the richer per-field feed as a follow-up that needs the scan to emit sub-step events (§11).
- Elapsed timer: real only. Per-line timestamps: only if the run emits them.
- "Setting the lead" preview: skeleton only until the brief exists.
- **Demo/unconfigured discovery:** if the discovery provider is unconfigured (demo mode), the existing labelled-demo convention applies — never present demo output as a real scan (`ad-source.server.ts` / `searchAds` `allowDemoFallback` default `false`; do not change).
- The dimmed Beat-1 payoff tease is the **only** place sample-looking numbers may appear, and it must stay visibly labelled as a dimmed sample.

## 5. How it extends the live WP-B3 hero (not replace)

- **Keep:** `WakeGreeting`; the single hero search box as the one dominant add action; the compact `readinessGaps.slice(0,5)` setup strip. Do **not** reintroduce the 7-row checklist or the four competing add-competitor CTAs (SF-5) — the spine is chrome, not a CTA, and adds **zero** new action targets.
- **Change:** the hero **eyebrow/headline/sub/button-label** to the Beat-1 copy above; add `<FirstRunSpine furthest="add" />` above the hero card. Beats 2–4 are state variants of the same region driven by `competitorCount`, `firstScanQueued`, first-scan status, and `has-any-brief`.
- The `marketDeskBrief` populated state (Beat 4) is unchanged in data; only its framing eyebrow + the spine retirement are layered on.

## 6. Mobile behavior (≤640px)

- Spine: horizontal 3-node rail collapses to a compact **`Step 2 of 3 · First scan`** pill + a thin progress bar; no horizontal scroll.
- Hero paste row: input full-width, button below (already stacks).
- Wait beat: feed + honest-deal two-column → single column, feed first.
- Brief front page: 3 columns → single-column stack (lead score → new-creative → offer-watch).
- 44px min touch targets; no new horizontal scroll at 375px; verify.

## 7. Anti-AI-look + Vercel/DESIGN.md constraints

- Type: Bricolage Grotesque (display) + Inter (body) + IBM Plex Mono (eyebrows/evidence/timestamps). No Inter-only sameness.
- One accent: green `#16C47F` (`--green-lite`/`#7EE2B8` for dark-mode eyebrows). **Red stays diff-deletion/error only** — never on the spine, stamps, or CTAs.
- Dark workspace tokens: bg `#171611`, panel `#21201C`, border `#33312C`, ink `#ECE9E2`. No pure black/white, no purple-blue gradients.
- Vercel-calm restraint: reuse existing `.f9-app-panel` shadow-ring + 8px radii. The marker-highlight and the one classification stamp are the **single expressive move per screen** — one marker per beat headline, one stamp on the brief. No equal-repeated card grids; each beat has a distinct composition.
- First viewport (Beat 1) shows who it's for, what it does, and the one next action.
- Pure CSS in `app/app.css` (additive class blocks, e.g. `.f9-first-run-spine`, `.f9-wire-eyebrow`, `.f9-dispatch-feed`); icons via `app/components/icons.tsx`. **No new npm deps, no Tailwind, no CSS-in-JS.**

## 8. Acceptance criteria (behavioral + visual)

- Fresh free workspace, `/app`: renders `THE 5·9 WIRE · NOTHING FILED YET`, the plan-aware H1 [corrected in review 2026-07-21, round 2: daily plans (Starter/Agency) get `Name one competitor. We file the first brief before you wake.`; weekly plans (free, Scout) get `Name one competitor. We file your first weekly brief.` — free/Scout are weekly cadence and must never see the daily promise], one primary `Assign the beat →` button, and `<FirstRunSpine>` with node 1 `now`, nodes 2–3 `idle`. Exactly **one** dominant add action (the search box); no second add-competitor CTA in the hero region.
- After adding a competitor: Overview shows `{domain} is on the wire.`, the confirmation banner, and the spine advanced to node 2 `now` (node 1 `done`, solid green connector). No page requires the user to wait on it [corrected in review 2026-07-21, round 2: the wait copy is workspace-anchored — `Your brief appears here the moment the scan finishes.` — never a guaranteed-immediate-email claim].
- During the first scan (`/app/watchlists` first-scan view **and** the Overview mirror): spine node 2 is `now`; the ON-THE-WIRE feed shows **only** dispatch lines whose facts exist; no fabricated numbers, no per-line timestamps unless real; the honest-deal panel reads `Sourced or it doesn't run.`; on failure the existing `first_scan_*` failure UI shows instead of progress.
- First brief filed: eyebrow shows the **real** filed time (not "05:09"); score, event, and creatives are real data; primary CTA reads `Read the full brief →` → `/app/digests`; spine all `done`. Recurring-cadence footer appears **only** for recurring plans.
- On a later visit with `has-any-brief` true: the spine does **not** render; the normal populated Overview shows.
- **Banned-string check:** grep of customer-facing JSX/strings finds **none** of `stakeout|staking out|under watch|REC|on camera|caught in the act|surveillance|target acquired|case #`.
- **Naming-spine check:** the deliverable is called **"brief"** in every clickable/nav/title/CTA surface; "edition" appears only in a mono eyebrow; no route/title/param renamed.
- Dark + light both render cleanly (workspace defaults dark; account may switch to light — verify no contrast failure). No new horizontal scroll at 375px. No console errors on `/app`.

## 9. Guardrails

- **No route renames, no migrations** (derive `has-any-brief`, `first-scan-status`, `competitorCount` from existing records). If a durable first-run flag is later judged necessary, STOP and flag — do not add a migration silently.
- **Naming spine is law** (§0). Do not reintroduce SF-1 drift. "Competitor"/"Brief" canonical; Wire vocabulary is flavor only.
- **Honesty convention** (§4) is non-negotiable: no faked progress, no unsourced numbers, demo stays labelled.
- **Reuse existing plan-accurate strings** for any plan/cadence claim; invent none.
- Reuse the existing first-scan status machine (`firstScanPollingKey` + `first_scan_*` states); do **not** build a parallel scan-status source of truth.
- No new npm deps; pure CSS + existing icons; `npm test` + `npm run build` green before done; never `npm run deploy`.
- Immutability + file size (200–400 lines typical) per repo conventions; the spine is its own small component file.

## 10. Tests to add/update

- `tests/dashboard.route.test.ts` / `tests/dashboard-v2.test.ts` / `tests/dashboard-activation.route.test.ts` — Beat 1/2 copy + single-primary-CTA + spine node states.
- `tests/watchlists.route.test.ts` — Beat 3 wait copy, honesty-gated feed (assert a dispatch line does **not** render when its field is absent), failure-state fallthrough.
- `tests/digest-route-presentation.test.ts` — Beat 4 real-data brief, `Read the full brief →` CTA, no "05:09" stamp on on-demand first brief.
- New `tests/first-run-spine.test.ts` — the `furthest`→node-status pure function (forward-only; never renders an earlier `now`; retires when `has-any-brief`).
- Grep-guard test — assert none of the §0 banned strings appear in customer-facing route output; assert "brief" (not "edition") is the CTA/nav noun.

## 11. Out of scope / flagged for the coordinator

1. **Full Direction-C masthead chrome** (bordered-newspaper masthead) is **not** built — B structure was selected, not C structure. The Wire identity is carried by a mono kicker only. Flag if Nish actually wants the full masthead (that would be a structure change beyond the pick).
2. **Naming-spine vs. "edition" tension** — resolved conservatively here (brief = canonical noun; edition = atmospheric eyebrow only) to protect SF-1. Coordinator: confirm this reading matches Nish's intent before build.
3. **Richer per-field dispatch feed** depends on the first-scan run emitting sub-step events/counts. If the current run record does not expose them, ship the reduced honest feed (§4) and track the richer feed as a follow-up — do not fabricate to fill it.
4. **On-demand vs. 05:09 timing** — the first brief files whenever the on-demand scan completes, not at 05:09. Copy reflects real time; the "before 05:09" promise is reserved for the true **daily** recurring cadence (Starter / Agency). **[corrected in review 2026-07-21]** the "reserved for paid" framing in the original draft was imprecise: **free is recurring-weekly, not one-scan**, and Scout is weekly too — so the daily 05:09 footer is gated on daily cadence (`planAllowsDigestCadence(plan, "daily")`), not on `plan !== "free"`. Free/Scout weekly plans get the front page and a real filed-time eyebrow, just no daily 05:09 promise. Confirm no marketing surface implies the *first* brief arrives at 05:09.

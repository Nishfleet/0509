# 0509 Backlog

The single source of unattended work. Rules: agents pull ONLY from this queue —
never self-invented work; every run ends with a PR link or a named blocker.

## ACTIVE PROGRAM: design unification (Nish, ratified 2026-08-08)

The tri-audit (Sol + Grok + Fable, 2026-08-07/08) superseded the remaining
BL phase plan. This section of `docs/BACKLOG.md` is the canonical design-
unification program state for the repo. The "Next:" line below is the
sequenced to-do. The `agent-state/0509-design-unification-ledger.md` file
was once named as the source of truth here but was never created. The
BACKLOG is the only ledger.

Ratified by Nish, non-negotiable:

1. The v4 landing language (`f9-wk-*`) is the ONLY design system. The
   Evidence Desk (`f9-ed-*`) and every older era are being wiped — report
   documents included, proof semantics preserved exactly.
2. The 5-destination IA: Today / Watch / Library / Deliver / Settings.
   Presence merges into Watch; locked features are hidden from nav
   (gate-visibility); member pages keep URLs with owning-row active state.
3. Free plan = weekly watch (implemented behavior wins; all copy derives).
4. `scripts/design-system-ratchet.mjs` + `docs/design-system-ratchet.json`
   enforce exact-match legacy-marker ceilings in CI — the program's
   terminal condition is every ceiling at zero, plus a zero-S1/S2 fresh
   tri-audit. A fourth design era cannot ship while the gate exists.
5. Dual review (Sol + Grok) before merge for every program PR; tri-council
   (Sol + Grok + Fable) resolves splits; drafts until verdicts land.

Landed so far: PR #530+#531 (truth: unproven cannot render as proven,
evidence render contract), #532 (safety: fixture guards fail closed, ops
extracted from the customer app), #533 (the ratchet), #534 (subtraction:
dormant/dead surfaces deleted), #535 (the 5-destination IA shell).
Next: deep destination rebuilds (Today decision queue, Watch merge with
one history object, Settings consolidation, Deliver merge), the report
document re-set with frozen proof semantics, `/search` into the one
shell, the CSS endgame, and the email/copy-catalog pass. The order is
the "Next:" line above. Re-anchor this section after every landed PR.

## Historical note

Everything below this line predates the design-unification ratification
and is retained as history. The "Evidence Desk" program (BL-005..BL-020)
is CLOSED; the BL-030..BL-042 landing-language rollout shipped but its
phase numbering drifted from git reality (BL-032..035 shipped as different
packages than planned here). Do not plan from the sections below.

---

## Continuous program (standing order, Nish 2026-07-27)

The queue no longer stops when empty — it REFILLS, on evidence only:

1. **Drain:** packages run continuously — one builder + one independent
   adversarial reviewer each, consolidated-remediation lineage, full Gate-B
   proof per package, merge only on APPROVE, every merge deploys via CI.
   Parallel packages must own disjoint files.
2. **Refill trigger:** when ≤2 packages remain unstarted, run the
   **Full Customer Experience Audit (FCEA)**: EVERYTHING a customer can
   touch, click, see, or receive — every route in every plan tier and state
   (desktop + mobile, light + dark), every EMAIL template rendered and
   screenshotted (alerts, digests, heartbeats, dunning, at-risk, welcome —
   emails ARE the monthly product), PDFs, share links, unsubscribe, checkout
   return, error/404/empty/loading states, onboarding, exports, API docs.
   The bar: "built with intent, built to delight" — the customer must feel
   valued and keep paying month over month for outsized value.
3. **Repopulate:** audit findings (screenshot-evidenced, severity-ranked)
   become new packages via a PR to this file. No finding, no package —
   self-invented work stays banned; the audit verdict is the only refill
   source.
3b. **Anti-theater gates on every refill (Nish, 2026-07-27):**
   - Every finding is adversarially challenged by a DIFFERENT model than the
     auditor with one question: "would a paying customer actually notice or
     care?" Findings that fail die; only survivors become packages.
   - Every package names the specific customer moment it improves (the
     renewal lens); a package that can't name one doesn't exist.
   - FCEA evidence sources MUST include real-world signals, not just the
     fixture: edge-data states (many watchlists, long names, non-Latin
     scripts, empty/huge workspaces), the customer-at-risk and business-
     numbers operator emails, scan-failure rates, and billing lifecycle
     events. Emails are the monthly product — every rendered template is
     in scope every audit.
   - Refill rounds must SHRINK. A refill larger than the previous round is
     itself a finding about the process and pauses the program for the
     tech lead + Nish to inspect.
   - Design-language fidelity check: after each program phase, Nish eyeballs
     2-3 live surfaces; his "off track" verdict pauses new design packages.
4. **Nish's standing gates:** he can veto/reorder anytime; pricing, product
   direction, and new-feature ideas park in the lane below for his explicit
   promotion; a design re-direction (new visual language) still requires his
   pick. Program pauses instantly on his word.
5. **Terminal condition:** an FCEA that produces zero S1/S2 findings across
   all surfaces = the program idles (heartbeat audits only, monthly cadence).

## Done (2026-07-27)

- **BL-001 — Land the recovery-branch net-new value.** ✅ Reconciled against
  main and merged: digests `LockedFeature` gate parity, product-voice `/status`
  copy, stricter test hardenings kept; 49 superseded files dropped; the
  dashboard-shell-a11y suite-ordering flake fixed; recovery branch retired.
- **BL-002 — Full-product visual audit at the "built with intent" bar.** ✅
  102 screenshots (51 route-states x desktop 1440 + mobile 390) from the repo's
  own local e2e fixture harness, plus a per-route gap table with severities and
  seven cross-cutting defects —
  `0509-audit-artifacts/2026-07-27/audit-gap-table.md`.
- **BL-003 — Workspace design direction.** ✅ Eight Mobbin references + four
  anti-references, then three directions rendered as real HTML pages at 1440px
  and 390px. Nish picked **Direction 2 — "The Evidence Desk"**. Build brief:
  `docs/design/EVIDENCE-DESK-BRIEF.md`; the volume split is now `DESIGN.md`
  "One system, two volumes".

## Done (2026-07-28)

- **BL-024 — Workspace shell: kill the first-load focus ring, go full
  width.** ✅ Direct Nish feedback. The signed-in route-focus target keeps its
  screen-reader announcement without painting a workspace-sized ring, and the
  signed-in shell plus page canvas no longer stop at the 1480px shell cap or
  the nested 1120px content cap.
- **BL-025 — de-slop the Overview setup moment; Evidence Desk treatment for
  `/search`.** ⏸️ PARKED as PR #416. Its visual pass was overtaken by the
  design re-direction below; its three certified behaviour fixes were salvaged
  into BL-030 and the rest of the branch is retired.

## Done (2026-07-29) — the Evidence Desk program, closed

Direction 2 "The Evidence Desk" (`docs/design/EVIDENCE-DESK-BRIEF.md`) shipped
as **BL-005** (token layer, three CTA ranks, pattern primitives), **BL-006**
(competitors watch board), **BL-007** (competitor detail tab bar + fact rail),
**BL-008** (change feed: diff plates, quiet lines), **BL-009** (the agency
report as a deliverable), **BL-013** (shared report + PDF at full volume),
**BL-014** (collections IA inversion), **BL-015** (briefs as one designed
brief), **BL-016** (setup checklist card; `/app/onboard` retired) and
**BL-017** (overview completion pass). **BL-018**, **BL-019** and **BL-020**
never started.

On 2026-07-28 Nish rejected the workspace language it produced on sight — the
design-language fidelity check in rule 3b — and the program stopped. The
Evidence Desk primitives are NOT deleted: every surface whose rebuild phase has
not landed still runs on them, and each phase deletes only the rules it stops
consuming. `docs/design/EVIDENCE-DESK-BRIEF.md` stays in the repo as the record
of what those surfaces are built to until their phase arrives.

## P1 — the landing-language rebuild (direction picked 2026-07-29)

The Evidence Desk program is CLOSED (see the Done section above). On
2026-07-28 Nish rejected the workspace language it produced on sight and
mandated a total rehash of the signed-in app inspired by the landing page
("the landing page is sooo good!"). Four concept rounds followed; he picked
**v4**. The v4 concepts are the reference implementation and the Component &
Motion DNA notes are law:

- `0509-audit-artifacts/REBUILD-PROGRAM-DRAFT.md` — program rules.
- `0509-audit-artifacts/landing-rehash-concepts/CONCEPT-NOTES.md` — the full
  history: ingredient list, references, the v2 intent audit, the Component &
  Motion DNA, the v3 Mobbin calibration, the v4 delta.
- `concept-overview-v4.html` + `concept-watchlists-v4.html` — the CSS that is
  the styling source of truth.

**v1, v2 and v3 are documented FAILURE MODES and reviewers cite them by
name:** v1 was a busy dashboard wearing the landing's clothes; v2 corrected by
cutting elements but spent the recovered space on scale, which is a landing
page with a nav rail; v3 kept the right ratios but re-decorated the survivors.
The cure in v4 is the boringness budget below. Do not regress into any of
them.

**Program rules (additive to the standing rules further down):**

- **The intent audit is a deliverable.** Every package's PR carries the
  element -> justification table for its surfaces: why it exists, why here, why
  this size, what a customer loses without it. A long table means the surface
  is too busy, which means it is not done.
- **The boringness budget.** Build each surface as if it were literally
  Linear — quiet, sentence-case, hairline, almost boring at first glance —
  then spend character in exactly four sanctioned slots: Bricolage Grotesque
  on the page title and on watched-entity names; ONE green mark per viewport,
  always the caught change; radius 0; the Snap/Settle/Land motion curves with
  a `prefers-reduced-motion` kill. Caps-mono kickers: three per page maximum.
  ONE rule weight on the page, and it is 1px.
- **Orchestrator eyeballs every render before Nish; Nish eyeball-gates each
  phase.** No phase starts before its predecessor is gated.
- **Cross-model review per package** (Grok via cursor-agent is back in
  rotation), plus the full acceptance floor in the standing rules.
- **Old CSS is deleted in the same PR that stops consuming it,** with the
  deleted-vs-added ledger in the report. Surfaces whose phase has not landed
  keep running on the old system — coexistence is proved with a capture of an
  untouched route in every phase report.

**Phases. Each one is a Nish gate before the next.**

### BL-030 — P0: DNA foundation + the two reference surfaces ✅ LANDED (PR #421)
**Owns:** the new `--wk-*` token layer and `.f9-wk-*` primitives in
`app/app.css`, `app/components/workspace/*`, `app/components/dashboard-shell.tsx`,
`app/lib/dashboard-navigation.ts`, `app/routes/app.watchlists.tsx`,
`app/routes/app.dashboard.tsx`, `app/lib/competitor-list-display.ts`,
`app/lib/change-mark.ts`, `app/lib/overnight-sentence.ts`.
**Delivers:** the token/primitive layer (type scale, one 1px rule weight,
monochrome rail palette, radius 0, the three motion curves with the
reduced-motion kill, the single-green-mark discipline; primitives for the
working page header, ruled list row, detail pane and feedback strip); the v4
nav shell (nine visible rows, the "Workspace & account" disclosure holding the
seven long-dwell settings routes, a visible ⌘K affordance wired to the
existing quick-add palette, a workspace footer block); Competitors
(`/app/watchlists`) as a ruled list plus a URL-addressable peek pane, keeping
the `?watchlist=` contract and the five-tab detail system; Overview (`/app`)
as working header + Overnight sentence + What changed + Still running + one
quiet operational line. Also salvages PR #416's certified behaviour fixes
(fetcher-based no-navigate refusal, latest-answer-wins feedback precedence,
the `SubmitButton` pending prop, their regression tests).

### BL-031 — P1: the daily surfaces
Briefs, Search, Collections, Reports (in-app), Presence — each its own package
built on the BL-030 primitives, each with its own intent audit.

- **`/search` — 🚧 IN REVIEW.** The results list is a ruled list, the selected
  ad is one Linear-peek evidence pane instead of a summary card plus a detail
  aside rendering the same header twice, the search form is DNA frames with a
  refine disclosure that stays shut until a filter is on, and the pre-search
  state is a sentence and one text action (no specimen). The second palette,
  the page gradient and the UPPERCASE headings that `.f9-search-page` pinned
  onto this route are deleted with a ledger. Report:
  `0509-audit-artifacts-bl031/BUILD-REPORT.md`.
- Briefs, Collections + Reports (in-app), Presence, and the full detail-surface
  rebuild remain, in that order.

### BL-032 — P2: settings cluster + secondary desks
Account, team, client rooms, notifications, shares, source access, developer
access, support. These are the "Plain volume" surfaces: zero Rank-1 actions is
legitimate here.

### BL-033 — P3: the workflows pass
Activation (first run -> first evidence), scan/refresh, report handoff,
share/PDF deliverables (document language may intentionally diverge from the
workspace — the decision is recorded when this phase is reached), and the
in-app feedback strip per DNA §4 applied across every action.

### BL-034 — P4: notifications + emails
The monthly product. Every template re-set in the new language — subjects,
hierarchy, the one green moment — with BL-022 and BL-023 folded in.

### BL-035 — P5: conformance sweep + a fresh FCEA at the new bar
The program idles on a zero-S1/S2 audit, per the continuous-program terminal
condition.

**Standing rules for every package (do not restate in the PR, satisfy them):**

- Build to the v4 concepts and the Component & Motion DNA. Cite the DNA
  section and the concept file when justifying a choice; cite the v1-v3
  failure modes when refusing one.
- Presentation layer only. A loader change must be called out and unit-tested.
- **Acceptance floor, identical for all packages:** `npm test` and
  `npm run typecheck` green; the FULL Gate-B proof (`npm run e2e:local:release`)
  green on a first attempt; unit tests updated for every re-worded string and
  every deleted component; live proof captured from the local fixture harness
  showing desktop 1440 AND 1920 plus mobile 390, **both themes**, **zero
  console errors**, **zero horizontal scroll from 320 to 2560**; the intent
  audit table; the deleted-CSS ledger.
- Any package that changes a canonical URL must update RELEASE_COVERAGE_MATRIX in the same PR (Gate-B asserts exact URLs; lesson of the 2026-07-27 deploy blockage).
- Full `npm test` before every PR — including CI/scripts/docs-only changes; guard tests assert workflow-file structure (lesson of deploy run 30327319587).
- Dependency PRs run `launch:readiness:predeploy` locally before merge — raw vitest+typecheck is not the deploy gate (lesson of run 30416112116).
- Accessibility outranks concept fidelity where they collide: every actionable
  control keeps a 44x44px target even when the concept draws it smaller, and
  the deviation is named in the intent audit rather than quietly taken.
- IDs 010-012 are the pre-existing P2 engineering-health items; 005-020 belong
  to the closed Evidence Desk program and are listed in Done.


### BL-021 — siterep.net widget 403s on 9 marketing pages ⛔ GATE: Nish decides
Console-noise only, first-party wired (`app/lib/siterep-widget`, `root.tsx`).
Fix the key or remove the widget — open question 1 from the gap table. One
small session either way; not part of the Evidence Desk program.


### BL-022 — Instant-alert evidence honesty (email)
From the challenged email audit (artifacts: 0509-audit-artifacts/email-audit/,
CHALLENGE-VERDICT.md). Surviving S1s, one builder class: instant confirmed +
instant batched alerts render Before/Now claims with NO capture timestamps
("when was this true?" unanswerable at the moment a customer may act on
pricing); scan-trouble mail claims "Retries are already running automatically"
without retry proof. Fix: capture times on every emailed diff row (or honest
degrade per brief §6.5/§8), and outage copy that states only what the system
can prove. **Customer moment:** the highest-urgency mail the product sends;
acting on an alert same-day. Acceptance: re-rendered templates + screenshots,
unit tests on builders, no unproved claims.

### BL-023 — Monthly recap CTA points at evidence, not billing
Surviving S2: the paid monthly recap's only button goes to /app/billing.
Rank-1 becomes "Review this month's evidence" (digests/watchlists surface);
billing drops to secondary. **Customer moment:** the "was this worth it?"
renewal skim. XS scope per CHALLENGE-VERDICT.md; acceptance evidence:
monthly-recap-active/quiet renders + screenshots.

## P2 — engineering health

### BL-010 — Split app/lib/data.server.ts by domain
~9,000 lines, flagged overdue in CLAUDE.md. Behavior-preserving, test-backed,
in reviewable slices (≤800 lines per file per repo convention).

### BL-011 — Split app/lib/customer-agent-actions.server.ts
~2,600 lines. Same treatment as BL-010.

### BL-012 — Hardcoded-date sweep across tests
Class fix from the evidence-usage time bomb (anchor dates that roll past and
break the suite monthly). Find all fixed-date assertions; convert to fake
timers.
The `tests/workspace-readiness.server.test.ts` billing flake noted here was NOT
a date bomb — it was a `vi.doMock` registration race and is fixed separately.
Vitest resolves consecutively queued mock registrations in parallel and
registers each after its module-id resolution settles, so re-mocking a path a
setup helper already queued lands in settle order, not call order. Guarded by
`tests/mock-registration-race.test.ts`. The date sweep itself is still open.

## P3 — Nish-only (console/dashboard access required)

- UptimeRobot monitor on /api/health (docs/ops-backup-uptime.md)
- Dodo dashboard: "Allow Subscription Updates" customer-portal toggle
- WhatsApp Meta-side setup (only if WhatsApp delivery is ever un-gated)

## Parking lane

Ideas land here first and need Nish's explicit promotion into P1/P2 before any
agent may work on them. (Empty.)

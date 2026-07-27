# 0509 Backlog

The single source of unattended work. Rules: agents pull ONLY from this queue —
never self-invented work; every nightly run ends with a PR link or a named
blocker; an empty queue means nothing runs. Design-code items were gated on a
Nish-picked direction; that gate cleared on 2026-07-27 with Direction 2, "The
Evidence Desk" (`docs/design/EVIDENCE-DESK-BRIEF.md`). Ranked by Nish;
maintained by the tech-lead session.

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

## P1 — the Evidence Desk program (gate cleared, ordered)

Every package below is one builder session. They are ordered by the audit's
severity ranking (watchlists → agency report/share → collections + digests →
onboarding removal + overview → settings cluster) and, apart from the
foundation, are independent enough to hand to different builders once BL-005
has landed.

**Standing rules for every package (do not restate in the PR, satisfy them):**

- Build to `docs/design/EVIDENCE-DESK-BRIEF.md`. Cite its section numbers in
  the PR body; cite references as R1–R8 / A1–A4 when justifying a choice.
- Presentation layer only. A loader change must be called out and unit-tested.
- **Acceptance floor, identical for all packages:** `npm test` and
  `npm run typecheck` green; unit tests updated for every re-worded string and
  every deleted component; live proof captured from the local fixture harness
  (`npm run e2e:prepare:local` + the `e2e:serve:local` env line, Playwright
  Chromium, 1440x900 and 390x844) showing **desktop + mobile in both themes**,
  **zero console errors**, **zero horizontal scroll**, and the measured mobile
  document height before/after; deleted CSS listed next to added CSS; brief
  §13 conformance checklist answered line by line.
- IDs skip 010–012 — those are the pre-existing P2 engineering-health items.

### BL-005 — Evidence Desk foundation: tokens, CTA ranks, pattern primitives
**Cluster:** none directly; the workspace shell + `/app` prove it.
**Owns:** `app/app.css` (new `--ed-*` alias layer + the dark-theme block),
`app/components/dashboard-page.tsx`, `app/components/pill.tsx`, new
`app/components/evidence/` primitives (`diff-plate`, `capture-strip`,
`status-strip`, `quiet-line`, `fact-rail`, `specimen-empty-state`,
`evidence-plate`, `cta` ranks), `tests/` new unit specs.
**Patterns:** brief §4 (token delta, dark-theme aliasing), §5 (three CTA
ranks), §6.2, §6.3, §6.5, §6.6, §6.7, §6.8, §6.9 as reusable components.
**Done when:** every primitive has a unit test covering its honest-degrade
path (missing timestamp → quiet line, missing value → muted fact row); no
`--ed-*` rule hardcodes a hex; the three CTA ranks exist as the only button
API the workspace exports; `/app` renders unchanged in behaviour with the new
shell tokens; both themes screenshotted.

### BL-006 — Competitors watch board (`/app/watchlists`, list surface)
**Cluster:** watchlists list — the S1 monster (~5,000px desktop, 9,047px
mobile).
**Owns:** `app/routes/app.watchlists.tsx` (list half), `app/lib/watchlist-display.ts`, `app/components/watchlists/bulk-select-bar.tsx`,
`first-scan-banner.tsx`, `watchlist-proof-age.tsx`, `tests/watchlists.route.test.ts`, `tests/watchlists-bulk-action.test.ts`,
`tests/watchlist-proof-age-hydration.test.tsx`.
**Patterns:** §6.1 competitor band, §6.2 capture strip, §6.3 status strip,
§7 watch-board section order, §5 (one Rank-1: "Add competitor").
**Done when:** the checkbox rail is gone (selection is band-level, bulk bar
appears only with a selection and reads as counts); one band per competitor
with a working 30-day capture strip and its worded legend; the seven scattered
status cards collapse into one status strip; the workspace ticker exists here
and nowhere else; mobile document height for the populated fixture is under
4,000px (from 9,047px) and the number is reported.

### BL-007 — Competitor detail IA: tab bar + fact rail (`/app/watchlists/:id`)
**Cluster:** watchlists detail — the other half of the S1 split.
**Owns:** `app/routes/app.watchlists.tsx` (detail half; extract if it grows
past the 800-line ceiling), `app/components/watchlists/tracking-status-card.tsx`, `delivery-settings-card.tsx`, `delivery-targets-section.tsx`,
`watchlist-setup-card.tsx`, `app/components/competitor-dossier.tsx`,
`tests/watchlists.route.test.ts`, `tests/watchlist-links.test.ts`.
**Patterns:** §6.4 anchor tab bar (What changed · Evidence · Creative ·
Delivery · Setup), §6.6 fact rail edited to ≤8 rows, §6.3 status strip, §7
detail composition.
**Done when:** tabs are URL-addressable and back-button correct; settings,
delivery config, glossary and explainers live behind their own tab instead of
the single scroll; the right rail is one number card + one fact rail + one
delivery card, nothing else; detail mobile height under 3,000px.

### BL-008 — Change feed: diff plates, quiet lines, insight-grid removal
**Cluster:** watchlists change/evidence surfaces.
**Owns:** `app/components/watchlists/event-changes-section.tsx`,
`recent-checks-section.tsx`, `recent-evidence-checks-card.tsx`,
`candidate-history.tsx`, `app/components/creative-wall.tsx`,
`app/components/insight-depth-panel.tsx` (deleted from this route),
`app/components/proof-glossary.tsx` (moved out of the flow),
`tests/watchlists.route.test.ts`, `tests/evidence-usage.test.ts`.
**Patterns:** §6.5 diff plate (two timestamps or no diff), §6.7 quiet line
with "load N earlier checks", §6.6 honest inline values, §6.8 specimen empty
state, §8 proof architecture.
**Done when:** a captured change renders as a diff plate with both capture
timestamps and the stored-capture honesty note; a check that found nothing is
one dashed line; the 6-box "Insight depth" block no longer renders on this
route; no "Pending" / "No evidence yet" box survives anywhere in the cluster.

### BL-009 — The agency report as a deliverable (`/app/reports`, `/app/reports/:id`)
**Cluster:** the money page (S1) — 4,400px of micro-label rows today.
**Owns:** `app/components/report-view.tsx`, `app/routes/app.reports.tsx`,
`app/routes/app.reports.index.ui.tsx`, `app/components/locked-feature.tsx`,
`app/components/share-brand-identity.tsx`, `tests/report-view.test.ts`,
`tests/reports-index.route.test.tsx`, `tests/report-approval.test.ts`,
`tests/collections-reports-plan-controls.test.ts`.
**Patterns:** §6.10 cover + 3-number headline strip + contents rail + "Our
read" callout, §6.9 numbered evidence plates, §4.4 full-volume type, §8.4
"how this was checked" section, §5 (Rank-1 = "Send to client").
**Done when:** the report opens on an ink cover whose headline is the finding;
exactly three headline numbers (no 3+1 orphan hole); evidence renders as
numbered plates referenced by number in the prose; the glossary is out of the
reading flow; the duplicate floating "I reviewed this evidence" checkboxes are
resolved to one control; the Starter gate renders through `LockedFeature` with
a dimmed specimen instead of a 1,000px void.

### BL-013 — Shared report + PDF at full volume (`/share/:token`, PDF)
**Cluster:** the artefact a client's client sees.
**Owns:** `app/routes/share.$token.tsx`, `app/routes/share.$token.pdf.ts`,
`app/lib/report-pdf.server.ts`, `app/components/public-doc-shell.tsx`,
`tests/share-branding-ui.test.ts`, `tests/share-pdf-variant.test.ts`,
`tests/share-pdf.route.test.ts`, `tests/share-pdf-interaction.test.ts`.
**Patterns:** §3 volume table (share = full volume), §6.9, §6.10, §8.
**Done when:** the shared view and the PDF carry the same cover, three
numbers and numbered plates as BL-009, at full volume; agency branding still
renders per plan; the PDF variant is visually verified page by page, not only
snapshot-tested; expired/revoked link states use the §6.8 empty-state pattern.
**Depends on:** BL-009.

### BL-014 — Collections IA inversion + the overflow/overlap bug (`/app/collections`)
**Cluster:** collections (S1: 1,539px desktop overflow, button overlap).
**Owns:** `app/routes/app.collections.tsx`, `app/components/result-quick-save.tsx`, `app/components/empty-state.tsx`, `app/lib/data/shares.server.ts`
(only if a loader field is needed), `tests/collections-route-feedback.test.ts`,
`tests/collections-reports-plan-controls.test.ts`.
**Patterns:** §7 collections order (content first, create form demoted to a
Rank-2 reveal), §6.1 full-width bands, §6.6 one fact rail replacing the
five-action rail, §6.8 empty state, §5 (retire the floating "Upgrade to
Agency" text link).
**Done when:** desktop `scrollWidth === innerWidth` at 1440 (the S1 overflow
is gone) and no control overlaps a card at any width from 320–1600px; saved
items are the first thing on the page; the left dead zone below the create
form is gone; the insight cards no longer wrap at 2–3 words per line.

### BL-015 — Briefs as one designed brief (`/app/digests`)
**Cluster:** the flagship "brief" (S2 debug dump, A1).
**Owns:** `app/routes/app.digests.tsx`, `app/components/digest-intelligence.tsx`, `app/components/digest-strategy-note.tsx`,
`app/components/partial-data-notice.tsx`, `app/components/insight-depth-panel.tsx` (**deleted** — last consumer), `app/components/proof-glossary.tsx`,
`tests/digest-route-presentation.test.ts`, `tests/digest-intelligence.test.ts`,
`tests/digest-plan-controls.test.ts`, `tests/digest-provenance.test.ts`.
**Patterns:** §7 brief composition (date header → finding in display type →
diff plates → quiet lines → one fact rail), §6.6 (kills the repeated "evidence
unavailable" / "source unavailable" strings), §6.5, §6.7, §8.3 sample
labelling.
**Done when:** no `MICRO-LABEL: value` stack survives on the route; the
"source unavailable" repetition is replaced by the §6.8 one-liner; the 6-box
insight component is deleted from the codebase (zero importers) in this PR;
filters are one mono row, not a form.

### BL-016 — Setup checklist card; retire `/app/onboard`
**Cluster:** first-run (S1 — the dark navy alien page).
**Owns:** `app/routes/app.onboard.tsx` (→ redirect, then delete),
`app/routes/app.dashboard.tsx`, `app/components/first-run-spine.tsx`,
`first-run-wait.tsx`, `first-run-wire.tsx`, `app/components/quick-add-palette.tsx`, every link/email CTA targeting `/app/onboard`,
`tests/onboarding.route.test.ts`, `tests/dashboard-activation.route.test.ts`.
**Patterns:** §6.11 (the decision), R6, §6.8 specimen empty state, §5.
**Done when:** `/app/onboard` 302s to `/app` with the checklist in view and
the old dark page renders nowhere; the checklist card shows step state, one
Rank-1 action pointing at the next step, and disappears permanently once the
blocking steps are done; no post-signup flow, email or in-app link still
points at the old page; only one first-run pattern exists in the codebase.

### BL-017 — Overview completion pass (closes BL-004)
**Cluster:** `/app` — the best page, still not "built with intent".
**Owns:** `app/routes/app.dashboard.tsx`, `app/components/dashboard-shell.tsx`, `app/components/dashboard-page.tsx`, `app/components/watchlist-trends.tsx`, `tests/dashboard.route.test.ts`, `tests/dashboard-v2.test.ts`,
`tests/dashboard-shell-a11y.test.tsx`.
**Patterns:** §7 overview order, §6.5 (max three change plates), §6.8 (the
"Open source access" giant empty card becomes a specimen or a fact row), §5
(one Rank-1), §9.8 (the two-row mobile tab strip becomes the §6.4 tab bar).
**Done when:** the lopsided setup-alert row, the sparse "Useful examples"
orphan column and the mixed CTA styles are gone; every stat band is 3-up or
full-width so no 2+1 / 3+1 orphan hole can form; mobile top navigation no
longer needs "Swipe for more".
**Note:** BL-004 is this package; do not schedule both.

### BL-018 — Settings-page pattern: account, team, client rooms
**Cluster:** the S2 form-page-syndrome cluster, Plain volume.
**Owns:** `app/routes/app.account.tsx`, `app/routes/app.team.tsx`,
`app/routes/app.clients.tsx`, `app/routes/workspace-settings.shared.tsx`,
`app/components/account-branding-section.tsx`, `account-branding-form.tsx`,
`app/components/confirm-button.tsx`, `app/components/submit-button.tsx`,
`tests/clients.route.test.ts`, `tests/team-route-feedback.test.ts`,
`tests/account-brand-logo.test.ts`, `tests/e2e-j6-team.route.test.ts`.
**Patterns:** §3 Plain volume, §7 settings composition (section list, titled
panels, inline Rank-2 actions), §5 (no full-width buttons; the dead "See
plans" text becomes a real Rank-3 link or is deleted), §6.6, §6.8.
**Done when:** zero full-width buttons across the three routes; no headline
lives inside a form card; input and button heights match on every row; the
"agency name on reports" dead end resolves; the bare red inline error string is
replaced by the three-part error pattern (`DESIGN.md` voice rule 6); each page
shows what a populated state looks like via §6.8 rather than empty boxes.

### BL-019 — Secondary desks: presence, notifications, access pages, shares, sources
**Cluster:** the remaining S2/S3 Plain-volume routes.
**Owns:** `app/routes/app.presence.tsx`, `app/routes/app.presence.$entityId.tsx`, `app/routes/app.notifications.ui.tsx`, `app/routes/app.source-access.ui.tsx`, `app/routes/app.developer-access.ui.tsx`, `app/routes/app.shares.tsx`,
`app/routes/app.sources.tsx` (→ redirects), `app/routes/app.support.tsx`,
`tests/presence.route.test.ts`, `tests/presence-customer-copy.test.ts`,
`tests/presence-entity-brief.test.ts`, `tests/share-links.test.ts`.
**Patterns:** §6.6 (the six identical "this source is not available for
customer checks yet" cards become six fact rows in one rail), §6.8, §5, §3
Plain volume.
**Done when:** `/app/sources` is a 301/302 redirect pair rather than a
tombstone page (open question 3 in the gap table — take the redirect unless
Nish says otherwise); the presence right rail is one rail, not six dead cards;
notification tiles have no orphan hole; `/app/shares` and `/app/support` carry
designed empty states; every remaining full-width black bar in the workspace
is gone.

### BL-020 — Conformance sweep: full-surface re-capture
**Cluster:** all of `/app` + `/share/:token`.
**Owns:** the audit harness invocation and any residual CSS cleanup in
`app/app.css`; no route logic.
**Patterns:** brief §13 across every route.
**Done when:** all 51 route-states are re-captured desktop + mobile in both
themes; a diff table against
`0509-audit-artifacts/2026-07-27/audit-gap-table.md` shows every S1 and S2
closed with the screenshot that proves it; zero console errors and zero
horizontal scroll across the whole set; the Vercel-era rules that no longer
have a consumer are deleted from `app/app.css` and the `DESIGN.md` retirement
note is updated to say what still remains, if anything.

### BL-021 — siterep.net widget 403s on 9 marketing pages ⛔ GATE: Nish decides
Console-noise only, first-party wired (`app/lib/siterep-widget`, `root.tsx`).
Fix the key or remove the widget — open question 1 from the gap table. One
small session either way; not part of the Evidence Desk program.

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

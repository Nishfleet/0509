# 0509 Backlog

The single source of unattended work. Rules: agents pull ONLY from this queue —
never self-invented work; every nightly run ends with a PR link or a named
blocker; an empty queue means nothing runs. Design-code items are gated on a
Nish-picked direction (see the design workflow policy). Ranked by Nish;
maintained by the tech-lead session.

## P0 — in flight (night of 2026-07-27)

### BL-001 — Land the recovery-branch net-new value (reconciled)
The recovery/0509-parity-2026-07-22 tree was triaged (25 failing tests → 24
stale expectations + 2 infra), fixed to a green 3,873-test suite, then
reconciled against main — which had independently re-landed most of the same
work. Net-new kept: digests LockedFeature gate parity, product-voice /status
copy, and strictly-more-protective test hardenings. 49 files dropped as
superseded; a wholesale apply would have reverted newer main fixes (delivery-
target masking, email re-opt chain, CI workflows).
**Done when:** this PR merged, CI deploy green end-to-end, recovery branch and
its checkout retired.
**Status:** landing tonight (this commit). Includes a fix for the pre-existing
dashboard-shell-a11y suite-ordering flake that entered main via [skip ci].

### BL-002 — Full-product visual audit at the "built with intent" bar
Origin (Nish, 2026-07-27): "in 0509 signed-in sessions, only overview was
redesigned, everything else looks the same old stale app… even overview doesn't
look complete i.e. built with intent." The July council audits covered public
pages only — no signed-in surface has ever been visually audited.
Screenshot EVERY surface — all signed-in routes (dashboard/overview,
watchlists, collections/boards, digests, reports, billing, account, clients,
team, support, onboarding, presence, ops, shares) plus public pages — desktop
AND mobile, via the repo's local e2e harness. Compare each against DESIGN.md
(Vercel aesthetic) and the redesigned Overview; catalogue per-route gaps with
severity. No claims without screenshots.
**Done when:** screenshot set + per-route gap table delivered to Nish.
**Status:** queued tonight, starts after BL-001's suite is green (one heavy
harness at a time on the VPS).

## P1 — next (gates marked)

### BL-003 — Workspace design direction ⛔ GATE: Nish picks the winner
Mobbin references (6–8 for the business job + 2 anti-references), then THREE
directions (safe / bold / weird-but-plausible) as real rendered HTML concept
pages at 1440px — never chat-widget mockups. Document the marketing-vs-workspace
calmness split in DESIGN.md. Prepared so Nish can pick in the morning; no
design code before the pick.

### BL-004 — Overview "built with intent" completion pass
The redesigned Overview itself doesn't clear the bar (Nish, 2026-07-27).
Concrete gaps come from BL-002; fixes follow the BL-003 direction.

### BL-005…N — Per-route workspace redesign packages
Cut from the BL-002 gap table once BL-003 is decided. Each package: one route
cluster, built to the picked direction, with tests + live proof (desktop and
mobile screenshots, zero console errors, no horizontal scroll).

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

## P3 — Nish-only (console/dashboard access required)

- UptimeRobot monitor on /api/health (docs/ops-backup-uptime.md)
- Dodo dashboard: "Allow Subscription Updates" customer-portal toggle
- WhatsApp Meta-side setup (only if WhatsApp delivery is ever un-gated)

## Parking lane

Ideas land here first and need Nish's explicit promotion into P1/P2 before any
agent may work on them. (Empty.)

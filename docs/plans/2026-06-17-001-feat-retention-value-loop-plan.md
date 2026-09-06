---
title: "feat: Surface 0509 retention value loop"
type: feat
date: 2026-06-17
origin: docs/brainstorms/2026-06-17-0509-retention-value-loop-requirements.md
---

# feat: Surface 0509 retention value loop

## Summary

Add a first retained-value slice for Five to Nine by setting onboarding expectations and making the dashboard show the loop customers are paying for: watched, checked, changed, proved, and delivered.

---

## Problem Frame

0509 already has the mechanics for retained competitor monitoring. The missing product surface is the user's quick understanding that 0509 looked for them, what it found, what proof exists, and what still needs setup. This plan keeps the first slice presentation-only and uses existing loader data to avoid a speculative lifecycle system.

---

## Requirements

- R1. Onboarding explains what happens after the first competitor is added.
- R2. Onboarding and dashboard copy stay truthful about current proof, digest, Slack, and WhatsApp readiness.
- R3. Dashboard presents the retained loop using existing account data for watched competitors, checked volume or next scan, proof, digest delivery, and delivery setup.
- R4. Existing first-watchlist creation, plan-cap gating, and first-scan queueing behavior remain unchanged.
- R5. Focused tests cover the new customer-facing copy and guard against losing the value-loop surface.

---

## Key Technical Decisions

- **Presentation-first slice:** Use existing route data and CSS classes instead of adding new persistence or lifecycle jobs. This reduces risk and keeps outbound automation deferred until the in-app truth is right.
- **Dashboard as the recurring proof surface:** Put the value loop near the existing setup checklist and lifecycle nudges so users see retained value before deeper activity lists.
- **Truthful status labels:** Derive labels from current watchlist, proof, digest, and delivery data. Quiet states must say "watching" or "next sweep" rather than imply a change exists.
- **Test with existing route-file checks:** Extend the repo's current static route tests instead of adding brittle rendered-dashboard mocks for a presentation-only change.

---

## Implementation Units

### U1. Preserve retention framing artifacts

- **Goal:** Add durable requirements and plan files that explain why this retention slice exists.
- **Requirements:** R1, R2, R3
- **Dependencies:** None
- **Files:** Create `docs/brainstorms/2026-06-17-0509-retention-value-loop-requirements.md`; create `docs/plans/2026-06-17-001-feat-retention-value-loop-plan.md`
- **Approach:** Capture the value-loop requirements, the first in-scope product slice, and the larger lifecycle ideas deferred to later.
- **Patterns to follow:** Compound Engineering markdown artifacts under `docs/brainstorms/` and `docs/plans/`.
- **Test scenarios:** Test expectation: none -- documentation artifact only.
- **Verification:** The docs use repo-relative paths, stable IDs, and no mutable status fields.

### U2. Set onboarding expectations

- **Goal:** Make first-run setup explain what 0509 does after a competitor is added.
- **Requirements:** R1, R2, R4, R5
- **Dependencies:** U1
- **Files:** Modify `app/routes/app.onboard.tsx`; modify `app/app.css`; modify `tests/onboarding.route.test.ts`
- **Approach:** Add a compact "What happens next" sequence below the two setup steps. Keep the existing create-watchlist form and paid-plan gating intact.
- **Patterns to follow:** Existing `f9-onboard-*`, `f9-app-kicker`, and `f9-muted-copy` layout patterns.
- **Test scenarios:** Render the onboarding route with free-plan gating and assert the retained setup copy appears while the create-watchlist path remains hidden.
- **Verification:** Onboarding still communicates competitor setup first, and the capped-plan test passes with the new expectation copy.

### U3. Surface the dashboard value loop

- **Goal:** Show the recurring retained-value state as looked, changed, proved, and delivered.
- **Requirements:** R2, R3, R5
- **Dependencies:** U1
- **Files:** Modify `app/routes/app.dashboard.tsx`; modify `app/app.css`; modify `tests/app-rebuild.test.ts`
- **Approach:** Build a value-loop list from existing dashboard variables: active watchlists, overnight checked volume or next scan, recent changes, proof usage or captures, sent digests, and delivery targets.
- **Patterns to follow:** Existing dashboard panel, setup-card, work-list, and status-card patterns.
- **Test scenarios:** Static app-surface test asserts the dashboard contains the value-loop section title and its core status labels.
- **Verification:** Dashboard users can scan the retained loop without opening watchlists, digests, or sources.

### U4. Verify and simplify

- **Goal:** Confirm the presentation slice is covered and does not disturb unrelated behavior.
- **Requirements:** R4, R5
- **Dependencies:** U2, U3
- **Files:** Modify test files listed in U2 and U3 only if coverage requires it.
- **Approach:** Run focused route tests and typecheck. Review the diff for accidental scope creep into billing, auth, provider setup, or outbound messaging.
- **Patterns to follow:** Existing Vitest and TypeScript verification scripts from `package.json`.
- **Test scenarios:** `tests/onboarding.route.test.ts` passes; `tests/app-rebuild.test.ts` passes; typecheck completes.
- **Verification:** No new external services, secrets, billing behavior, or outbound lifecycle sends are introduced.

---

## Scope Boundaries

### Deferred to Follow-Up Work

- Add automated lifecycle touchpoints after day 1, day 3, day 6, and day 10.
- Add testimonial asks after repeated proof-backed value moments.
- Add churn-risk analytics or customer-success operator surfaces.
- Build a detailed historical timeline of each retained-value touchpoint.

### Outside This Product's Identity

- Guaranteed growth claims.
- Generic nurture automation unrelated to competitor proof.
- Customer WhatsApp delivery claims before verified provider, opt-in, webhook, and delivered proof readiness.

---

## Risks & Dependencies

- Existing CSS uses large-radius card treatments, so the new surface should match surrounding app panels rather than introduce a new design system.
- Static route tests guard copy but do not prove dashboard runtime data states; this is acceptable because the first slice only derives labels from data the loader already returns.
- Outbound automation stays deferred because message cadence changes customer experience and should be planned after the in-app truth is visible.

---

## Sources / Research

- Origin requirements: `docs/brainstorms/2026-06-17-0509-retention-value-loop-requirements.md`
- Existing surfaces: `app/routes/app.onboard.tsx`, `app/routes/app.dashboard.tsx`, `tests/onboarding.route.test.ts`, `tests/app-rebuild.test.ts`, `app/app.css`
- Retention playbook signal: Kai Stone video published 2026-06-13, summarized into the product loop of expectation, first value, visible recurring value, and touchpoints.
